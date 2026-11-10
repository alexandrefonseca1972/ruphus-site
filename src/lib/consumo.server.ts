import "server-only";
import { randomBytes } from "node:crypto";
import { FieldValue, type Transaction } from "firebase-admin/firestore";
import { adminDb } from "@/lib/admin";
import { avisar } from "@/lib/avisos.server";
import { CobrancaErro, gerarCobranca } from "@/lib/cobranca";
import {
  CONFIG_PADRAO, configDoNegocio, deltaDoConsumo, deveAvisar, diasNoMes, previsaoDeSaldo, somaDias, textoDoAvisoDeSaldo, mascararDestino, MODOS_SEM_SALDO, podeEnviar, precoDe, quandoFoi, RECARGA_MINIMA_CENTS, statusDoAtendys, avanca,
  type Canal, type ConfigMensagens, type NivelSaldo, type Destinatario, type Pacote, type StatusEnvio, type TipoEnvio, type Via,
} from "@/lib/consumo";
import { dateIn, formatBRL } from "@/lib/datetime";
import { SITE_BASE } from "@/lib/dominio";
import { enviarEmail } from "@/lib/email.server";
import { ErroPrevisto } from "@/lib/erro-previsto";

// Mensagens pré-pagas. Cada mensagem que sai vira tenants/{slug}/envios/{id} e soma no mês
// (tenants/{slug}/consumo/{YYYY-MM}); no pré-pago o custo sai do saldo (tenants/{slug}/privado/mensagens)
// na mesma transação, com o lançamento no extrato (tenants/{slug}/creditos/{id}). Regras em consumo.ts.
//
// Extrato: o consumo é um documento por dia (consumo:YYYY-MM-DD, somado com increment), o estorno
// também (estorno:YYYY-MM-DD); recarga, ajuste e boas-vindas são documentos próprios. saldoAposCents
// é o saldo logo depois do último lançamento daquele documento.
//
// Conta aberta: o saldo só vale (e só bloqueia envio) para o negócio que tem saldoCents em
// privado/mensagens — o crédito de boas-vindas, uma recarga ou um ajuste do /admin abrem a conta.
// Negócio de antes do pré-pago segue enviando (e registrando o consumo) até ter a conta aberta.

const DOC_CONFIG = "config/mensagens";
const VALIDADE_MS = 60_000;
let cache: { em: number; leitura: Promise<ConfigMensagens> } | null = null;

const inteiro = (v: unknown, padrao: number) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : padrao);
function lerConfigDe(d: { get(c: string): unknown }): ConfigMensagens {
  const c = CONFIG_PADRAO;
  const pacotes = d.get("pacotes");
  return {
    cobrar: typeof d.get("cobrar") === "boolean" ? (d.get("cobrar") as boolean) : c.cobrar,
    modelo: d.get("modelo") === "pospago" ? "pospago" : d.get("modelo") === "prepago" ? "prepago" : c.modelo,
    whatsappUtilityCents: inteiro(d.get("whatsappUtilityCents"), c.whatsappUtilityCents),
    whatsappServiceCents: inteiro(d.get("whatsappServiceCents"), c.whatsappServiceCents),
    smsCents: inteiro(d.get("smsCents"), c.smsCents),
    avisoSaldoCents: inteiro(d.get("avisoSaldoCents"), c.avisoSaldoCents),
    boasVindasCents: inteiro(d.get("boasVindasCents"), c.boasVindasCents),
    semSaldo: (MODOS_SEM_SALDO as readonly unknown[]).includes(d.get("semSaldo")) ? (d.get("semSaldo") as ConfigMensagens["semSaldo"]) : c.semSaldo,
    limiteNegativoCents: inteiro(d.get("limiteNegativoCents"), c.limiteNegativoCents),
    pacotes: Array.isArray(pacotes) ? (pacotes as Pacote[]) : c.pacotes,
  };
}

/** config/mensagens (editada no /admin); sem ela, CONFIG_PADRAO. Cache de 60 s. */
export function lerConfigMensagens(): Promise<ConfigMensagens> {
  if (!cache || Date.now() - cache.em > VALIDADE_MS) {
    const leitura = adminDb.doc(DOC_CONFIG).get().then(lerConfigDe, (e) => {
      console.error("[consumo] não li config/mensagens", e);
      cache = null;
      return CONFIG_PADRAO;
    });
    cache = { em: Date.now(), leitura };
  }
  return cache.leitura;
}

export async function salvarConfigMensagens(c: ConfigMensagens, por: string) {
  await adminDb.doc(DOC_CONFIG).set({ ...c, atualizadoEm: FieldValue.serverTimestamp(), por });
  cache = null;
}

// as folhas do delta viram increment (set com merge soma em mapas aninhados)
type Arvore = { [k: string]: number | Arvore };
const incrementos = (a: Arvore): Record<string, unknown> =>
  Object.fromEntries(Object.entries(a).map(([k, v]) => [k, typeof v === "number" ? FieldValue.increment(v) : incrementos(v)]));

const envioRef = (slug: string, id: string) => adminDb.doc(`tenants/${slug}/envios/${id}`);
const consumoRef = (slug: string, mes: string) => adminDb.doc(`tenants/${slug}/consumo/${mes}`);
const contaRef = (slug: string) => adminDb.doc(`tenants/${slug}/privado/mensagens`);
const creditoRef = (slug: string, id: string) => adminDb.doc(`tenants/${slug}/creditos/${id}`);

/** Saldo da conta (null = conta não aberta), a config que vale para o negócio e o documento cru. */
async function contaDe(slug: string, tx?: Transaction) {
  const [geral, d] = await Promise.all([lerConfigMensagens(), tx ? tx.get(contaRef(slug)) : contaRef(slug).get()]);
  const saldo = d.get("saldoCents");
  return { cfg: configDoNegocio(geral, d.data() ?? null), saldoCents: typeof saldo === "number" ? saldo : null, dados: d.data() ?? {} };
}
type Conta = { cfg: ConfigMensagens; saldoCents: number; dados: Record<string, unknown> };

// consumo por dia guardado na própria conta (35 dias): a previsão sai sem ler o extrato
const DIAS_GUARDADOS = 35;
function consumoDias(dados: Record<string, unknown>, hoje: string, somar: number) {
  const atual = (dados.consumoDias ?? {}) as Record<string, number>;
  const corte = somaDias(hoje, -DIAS_GUARDADOS);
  const novo = Object.fromEntries(Object.entries(atual).filter(([d]) => d > corte));
  if (somar) novo[hoje] = Math.max(0, (novo[hoje] ?? 0) + somar);
  return novo;
}
const previsaoDe = (cfg: ConfigMensagens, saldoCents: number, dias: Record<string, number>, hoje: string) =>
  previsaoDeSaldo({ saldoCents, consumoPorDia: Object.entries(dias).map(([dia, cents]) => ({ dia, cents })), hoje, diasNoMes: diasNoMes(hoje), pacotes: cfg.pacotes, avisoSaldoCents: cfg.avisoSaldoCents });
const ms = (v: unknown) => (typeof v === "number" ? v : (v as { toMillis?: () => number } | undefined)?.toMillis?.() ?? null);

/** Grava saldo, consumo do dia e previsão na conta (mergeFields: o mapa de dias é regravado inteiro).
 *  Quando o nível piora para atenção/crítico sem aviso desde a última recarga, marca o aviso e lança
 *  "aviso" (valor 0) no extrato; devolve o texto para quem chamou avisar depois da transação. */
function gravarConta(tx: Transaction, slug: string, conta: Conta, saldo: number, consumido: number, agora: Date, extra: Record<string, unknown> = {}) {
  const hoje = dateIn(agora);
  const dias = consumoDias(conta.dados, hoje, consumido);
  const previsao = previsaoDe(conta.cfg, saldo, dias, hoje);
  const antes = ((conta.dados.previsao as { nivel?: NivelSaldo } | undefined)?.nivel ?? "ok") as NivelSaldo;
  const recarga = "ultimaRecargaEm" in extra ? (extra.ultimaRecargaEm as number) : ms(conta.dados.ultimaRecargaEm);
  const aviso = deveAvisar(antes, previsao.nivel, ms(conta.dados.avisadoSaldoBaixoEm), recarga) ? textoDoAvisoDeSaldo(saldo, previsao) : null;
  tx.set(
    contaRef(slug),
    { saldoCents: saldo, consumoDias: dias, previsao, ...(aviso && { avisadoSaldoBaixoEm: agora.getTime() }), ...extra, atualizadoEm: FieldValue.serverTimestamp() },
    { mergeFields: ["saldoCents", "consumoDias", "previsao", ...(aviso ? ["avisadoSaldoBaixoEm"] : []), ...Object.keys(extra), "atualizadoEm"] },
  );
  if (aviso) tx.create(creditoRef(slug, `aviso:${agora.getTime()}`), { tipo: "aviso", valorCents: 0, saldoAposCents: saldo, em: agora, mes: quandoFoi(agora).mes, motivo: aviso });
  return aviso;
}

/** Lança no saldo dentro da transação (valor < 0 debita) no documento do dia. Devolve o saldo novo e o
 *  texto do aviso, quando ele cabe agora. */
function lancar(tx: Transaction, slug: string, conta: Conta, valorCents: number, tipo: "consumo" | "estorno", agora: Date) {
  const saldo = conta.saldoCents + valorCents;
  const dia = quandoFoi(agora);
  const aviso = gravarConta(tx, slug, conta, saldo, -valorCents, agora);
  tx.set(
    creditoRef(slug, `${tipo}:${dia.mes}-${dia.dia}`),
    { tipo, valorCents: FieldValue.increment(valorCents), saldoAposCents: saldo, em: agora, mes: dia.mes, ref: { dia: `${dia.mes}-${dia.dia}` } },
    { merge: true },
  );
  return { saldo, aviso };
}

/** Saldo em atenção ou crítico: ao dono pelo canal oficial quando ele escreveu nas últimas 24 h (texto na
 *  janela); fora dela não há template de saldo aprovado, então fica no painel (previsão), no push para
 *  quem gere e no e-mail. Nunca lança. */
async function avisarSaldoBaixo(slug: string, texto: string) {
  await avisar(adminDb, slug, { title: "Saldo de mensagens", body: texto, url: `/${slug}`, tag: `saldo-${slug}` }, { soGestores: true }).catch((e) => console.error(`[consumo] push do saldo de ${slug}`, e));
  await emailAoDono(slug, "Saldo de mensagens", texto);
  try {
    // import na hora: canal-oficial e whatsapp importam atendys, que importa este arquivo
    const [{ conexaoOficial }, { lerConfigWhatsApp }, { enviarTexto, OPTIN_DONO }, { soDigitosComDDI }] = await Promise.all([
      import("@/lib/canal-oficial.server"), import("@/lib/whatsapp.server"), import("@/lib/atendys"), import("@/lib/telefone"),
    ]);
    const oficial = await conexaoOficial(adminDb, slug);
    const dono = soDigitosComDDI(String((await lerConfigWhatsApp(adminDb, slug))?.ownerPhone ?? ""));
    if (!oficial || !dono) return;
    const recentes = await adminDb.collection(`tenants/${slug}/whatsappInbox`).where("receivedAt", ">", Date.now() - 23 * 3_600_000).orderBy("receivedAt", "desc").limit(50).get();
    if (!recentes.docs.some((d) => soDigitosComDDI(String(d.get("phone") ?? "")) === dono)) return;
    await enviarTexto(oficial, dono, texto, OPTIN_DONO, undefined, { resposta: true });
  } catch (e) {
    console.error(`[consumo] aviso de saldo pelo WhatsApp de ${slug}`, e);
  }
}

async function emailAoDono(slug: string, assunto: string, texto: string) {
  try {
    const t = await adminDb.doc(`tenants/${slug}`).get();
    const dono = t.get("ownerId");
    const email = typeof dono === "string" && dono ? (await adminDb.doc(`tenants/${slug}/members/${dono}`).get()).get("email") : null;
    if (typeof email !== "string" || !email) return;
    await enviarEmail({ para: email, assunto: `${assunto} · ${String(t.get("name") ?? slug)}`, texto });
  } catch (e) {
    console.error(`[consumo] e-mail ao dono de ${slug}`, e);
  }
}

export type DadosEnvio = { canal: Canal; destinatario: Destinatario; tipo: TipoEnvio; servico?: boolean };

/** Antes de enviar: a mensagem pode sair? Lê a conta fora de transação (o débito confere de novo). */
export async function verificarEnvio(slug: string, d: DadosEnvio): Promise<{ envia: boolean; motivo?: string }> {
  try {
    const { cfg, saldoCents } = await contaDe(slug);
    if (saldoCents === null) return { envia: true };
    return podeEnviar({ ...cfg, saldoCents, custoCents: cfg.cobrar ? precoDe(cfg, d.canal, !!d.servico) : 0, destinatario: d.destinatario, tipo: d.tipo });
  } catch (e) {
    // conta ilegível não para o aviso ao cliente: sai e o débito tenta de novo no registro
    console.error(`[consumo] conferência do saldo de ${slug}`, e);
    return { envia: true };
  }
}

/** Sem saldo: a mensagem não sai. ErroPrevisto: quem chama mostra a frase como está. */
export class SemSaldo extends ErroPrevisto {}

export type NovoEnvio = DadosEnvio & {
  id: string;
  via: Via;
  template?: string;
  /** telefone do destino: só a máscara é gravada */
  fone: string;
  agendamentoId?: string;
  status: StatusEnvio;
  erro?: string;
};

/** Grava o envio, soma no mês e, no pré-pago com conta aberta, debita o saldo — tudo numa transação.
 *  O mesmo id outra vez (idempotency-key devolve a mensagem já aceita) não soma de novo. Nunca lança. */
export async function registrarEnvio(slug: string, n: NovoEnvio, agora = new Date()): Promise<void> {
  try {
    const aviso = await adminDb.runTransaction(async (tx) => {
      const [existe, conta] = await Promise.all([tx.get(envioRef(slug, n.id)), contaDe(slug, tx)]);
      if (existe.exists) return null;
      const { cfg } = conta;
      const precoCents = cfg.cobrar ? precoDe(cfg, n.canal, !!n.servico) : 0;
      const { mes, dia } = quandoFoi(agora);
      const delta = deltaDoConsumo({ canal: n.canal, via: n.via, tipo: n.tipo, precoCents, dia }, null, n.status);
      const custoCents = Number((delta as { custoCents?: number }).custoCents ?? 0);
      const prepago = cfg.cobrar && cfg.modelo === "prepago" && conta.saldoCents !== null;
      const lanc = prepago && custoCents > 0 ? lancar(tx, slug, { ...conta, saldoCents: conta.saldoCents! }, -custoCents, "consumo", agora) : null;
      tx.create(envioRef(slug, n.id), {
        canal: n.canal,
        via: n.via,
        tipo: n.tipo,
        ...(n.template && { template: n.template }),
        destino: mascararDestino(n.fone),
        destinatario: n.destinatario,
        ...(n.agendamentoId && { agendamentoId: n.agendamentoId }),
        status: n.status,
        ...(n.erro && { erro: n.erro }),
        precoCents,
        custoCents,
        // o que saiu do saldo: o estorno devolve no máximo isto
        prepago,
        debitadoCents: lanc ? custoCents : 0,
        moeda: "BRL",
        em: agora,
        mes,
        atualizadoEm: FieldValue.serverTimestamp(),
      });
      tx.set(consumoRef(slug, mes), { mes, ...incrementos(delta), atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
      return lanc?.aviso ?? null;
    });
    if (aviso !== null) await avisarSaldoBaixo(slug, aviso);
  } catch (e) {
    console.error(`[consumo] não registrou o envio ${n.id} de ${slug}`, e);
  }
}

/** Status novo (webhook message.status, conferência logo depois do aceite): atualiza o envio, acerta o
 *  mês dele e o saldo (falhou estorna o que foi debitado; parado que voltou à fila debita).
 *  at: quando o fato aconteceu; um mais velho que o último aplicado não mexe. Nunca lança. */
export async function atualizarEnvio(slug: string, id: string, statusAtendys: string, erro?: string | null, at = Date.now()): Promise<void> {
  const para = statusDoAtendys(statusAtendys);
  if (!para) return;
  try {
    const aviso = await adminDb.runTransaction(async (tx) => {
      const d = await tx.get(envioRef(slug, id));
      if (!d.exists) return null;
      const de = d.get("status") as StatusEnvio;
      if (!avanca(de, para) || Number(d.get("statusEm") ?? 0) > at) return null;
      const prepago = d.get("prepago") === true;
      const conta = prepago ? await contaDe(slug, tx) : null;
      const e = { canal: d.get("canal") as Canal, via: d.get("via") as Via, tipo: d.get("tipo") as TipoEnvio, precoCents: Number(d.get("precoCents") ?? 0), dia: "" };
      const delta = deltaDoConsumo(e, de, para);
      const dCusto = Number((delta as { custoCents?: number }).custoCents ?? 0);
      const debitado = Number(d.get("debitadoCents") ?? 0);
      // estorno: devolve o que saiu do saldo; cobrança nova (voltou à fila): debita
      const noSaldo = conta?.saldoCents == null || !dCusto ? 0 : dCusto < 0 ? Math.min(-dCusto, debitado) : -dCusto;
      const lanc = noSaldo ? lancar(tx, slug, { ...conta!, saldoCents: conta!.saldoCents! }, noSaldo, noSaldo > 0 ? "estorno" : "consumo", new Date()) : null;
      tx.update(d.ref, {
        status: para,
        statusEm: at,
        ...(para === "falhou" ? (erro ? { erro } : {}) : { erro: FieldValue.delete() }),
        ...(dCusto && { custoCents: FieldValue.increment(dCusto) }),
        ...(noSaldo && { debitadoCents: FieldValue.increment(-noSaldo) }),
        atualizadoEm: FieldValue.serverTimestamp(),
      });
      tx.set(consumoRef(slug, String(d.get("mes"))), { ...incrementos(delta), atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
      return lanc?.aviso ?? null;
    });
    if (aviso !== null) await avisarSaldoBaixo(slug, aviso);
  } catch (e) {
    console.error(`[consumo] não atualizou o envio ${id} de ${slug}`, e);
  }
}

type Credito = { tipo: "recarga" | "ajuste" | "boas-vindas"; valorCents: number; ref?: Record<string, string>; motivo?: string; por?: string };

/** Lança crédito (ou débito de ajuste) com id próprio, numa transação. Abre a conta. O mesmo id outra
 *  vez não lança de novo (devolve null). Recarga libera um novo aviso de saldo (ultimaRecargaEm). */
async function creditar(slug: string, id: string, c: Credito, confere?: (tx: Transaction) => Promise<void>): Promise<number | null> {
  return adminDb.runTransaction(async (tx) => {
    const [ja, conta] = await Promise.all([tx.get(creditoRef(slug, id)), contaDe(slug, tx)]);
    if (confere) await confere(tx);
    if (ja.exists) return null;
    const agora = new Date();
    const saldo = (conta.saldoCents ?? 0) + c.valorCents;
    // a previsão volta a valer com o saldo novo; a recarga libera um novo aviso
    gravarConta(tx, slug, { ...conta, saldoCents: saldo }, saldo, 0, agora, c.tipo === "recarga" ? { ultimaRecargaEm: agora.getTime() } : {});
    tx.create(creditoRef(slug, id), { ...c, saldoAposCents: saldo, em: new Date(agora.getTime() + 1), mes: quandoFoi(agora).mes });
    return saldo;
  });
}

/** Crédito de boas-vindas do negócio novo (cobrar e pré-pago). Uma vez só por negócio. Nunca lança. */
export async function boasVindas(slug: string): Promise<void> {
  try {
    const cfg = await lerConfigMensagens();
    if (!cfg.cobrar || cfg.modelo !== "prepago") return;
    await creditar(slug, "boas-vindas", { tipo: "boas-vindas", valorCents: cfg.boasVindasCents });
  } catch (e) {
    console.error(`[consumo] boas-vindas de ${slug}`, e);
  }
}

/** Ajuste do /admin (+ ou −), com motivo. */
export async function ajustarSaldo(slug: string, valorCents: number, motivo: string, por: string) {
  if (!Number.isInteger(valorCents) || valorCents === 0) throw new ErroPrevisto("Informe um valor diferente de zero.");
  if (!motivo.trim()) throw new ErroPrevisto("Informe o motivo do ajuste.");
  return creditar(slug, `ajuste:${Date.now()}-${randomBytes(3).toString("hex")}`, { tipo: "ajuste", valorCents, motivo: motivo.trim().slice(0, 200), por });
}

/** Cobrança Pix da recarga (pacote ou valor livre ≥ R$ 10). O crédito entra na baixa (creditarRecarga). */
export async function criarRecarga(slug: string, pedido: { pacoteId: string } | { valorCents: number }) {
  const cfg = await lerConfigMensagens();
  let valorCents: number;
  let bonusCents = 0;
  let pacoteId: string | null = null;
  if ("pacoteId" in pedido) {
    const p = cfg.pacotes.find((x) => x.id === pedido.pacoteId && x.ativo);
    if (!p) throw new ErroPrevisto("Esse pacote não está mais disponível.");
    ({ valorCents, bonusCents } = p);
    pacoteId = p.id;
  } else {
    valorCents = pedido.valorCents;
    if (!Number.isInteger(valorCents) || valorCents < RECARGA_MINIMA_CENTS) throw new ErroPrevisto(`A recarga mínima é de ${formatBRL(RECARGA_MINIMA_CENTS)}.`);
  }
  const { id, token } = await gerarCobranca(adminDb, { slug, tipo: "recarga", competencia: null, valorCents, recarga: { pacoteId, bonusCents } });
  return { id, url: `${SITE_BASE}/pagar/${id}?t=${token}` };
}

/** Depois da baixa (marcarPaga no /admin): o valor pago mais o bônus entram no saldo, uma vez. Recibo
 *  por e-mail ao dono. Devolve o saldo novo (null: já creditada). */
export async function creditarRecarga(cobrancaId: string): Promise<number | null> {
  const c = await adminDb.doc(`cobrancas/${cobrancaId}`).get();
  if (c.get("tipo") !== "recarga") return null;
  const slug = String(c.get("slug"));
  const valor = Number(c.get("valorCents"));
  const bonus = Number(c.get("bonusCents") ?? 0);
  const saldo = await creditar(slug, `recarga:${cobrancaId}`, { tipo: "recarga", valorCents: valor + bonus, ref: { cobrancaId } }, async (tx) => {
    if ((await tx.get(c.ref)).get("status") !== "paga") throw new CobrancaErro("Recarga ainda não paga.");
  });
  if (saldo !== null) {
    await emailAoDono(
      slug,
      "Recarga de mensagens confirmada",
      `Recebemos o Pix de ${formatBRL(valor)}${bonus ? ` (mais ${formatBRL(bonus)} de bônus)` : ""}. Saldo de mensagens: ${formatBRL(saldo)}.\n\nObrigado!\nRuphus`,
    );
  }
  return saldo;
}

/** Override por negócio (/admin): cobrar e preços próprios; null volta ao geral. */
export async function definirMensagensDoNegocio(slug: string, o: { cobrar: boolean | null; precos: Partial<Record<"whatsappUtilityCents" | "whatsappServiceCents" | "smsCents", number>> | null }) {
  await contaRef(slug).set(
    { cobrar: o.cobrar ?? FieldValue.delete(), precos: o.precos && Object.keys(o.precos).length ? o.precos : FieldValue.delete(), atualizadoEm: FieldValue.serverTimestamp() },
    { merge: true },
  );
}
