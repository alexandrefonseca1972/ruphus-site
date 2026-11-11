import "server-only";
import { randomBytes } from "node:crypto";
import { FieldValue, type Transaction } from "firebase-admin/firestore";
import { adminDb } from "@/lib/admin";
import { avisar } from "@/lib/avisos.server";
import { CobrancaErro, gerarCobranca } from "@/lib/cobranca";
import {
  CONFIG_PADRAO, configDoNegocio, deltaDoConsumo, deveAvisar, ehDaPlataforma, diasNoMes, previsaoDeSaldo, somaDias, textoDoAvisoDeSaldo, mascararDestino, MODOS_SEM_SALDO, podeEnviar, precoDe, quandoFoi, RECARGA_MAXIMA_CENTS, RECARGA_MINIMA_CENTS, statusDoAtendys, avanca,
  type Canal, type ConfigMensagens, type NivelSaldo, type Previsao, type Destinatario, type Pacote, type StatusEnvio, type TipoEnvio, type Via,
} from "@/lib/consumo";
import { efeitoNoAviso, saidaCobre, SAIU, type AvisoFalhou } from "@/lib/aviso-cliente";
import { dateIn, formatBRL } from "@/lib/datetime";
import { SITE_BASE } from "@/lib/dominio";
import { montarEmail, type Email } from "@/lib/email-layout";
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
type AvisoSaldo = { texto: string; saldo: number; previsao: Previsao };
function gravarConta(tx: Transaction, slug: string, conta: Conta, saldo: number, consumido: number, agora: Date, extra: Record<string, unknown> = {}) {
  const hoje = dateIn(agora);
  const dias = consumoDias(conta.dados, hoje, consumido);
  const previsao = previsaoDe(conta.cfg, saldo, dias, hoje);
  const antes = ((conta.dados.previsao as { nivel?: NivelSaldo } | undefined)?.nivel ?? "ok") as NivelSaldo;
  const recarga = "ultimaRecargaEm" in extra ? (extra.ultimaRecargaEm as number) : ms(conta.dados.ultimaRecargaEm);
  const aviso: AvisoSaldo | null = deveAvisar(antes, previsao.nivel, ms(conta.dados.avisadoSaldoBaixoEm), recarga) ? { texto: textoDoAvisoDeSaldo(saldo, previsao), saldo, previsao } : null;
  tx.set(
    contaRef(slug),
    { saldoCents: saldo, consumoDias: dias, previsao, ...(aviso && { avisadoSaldoBaixoEm: agora.getTime() }), ...extra, atualizadoEm: FieldValue.serverTimestamp() },
    { mergeFields: ["saldoCents", "consumoDias", "previsao", ...(aviso ? ["avisadoSaldoBaixoEm"] : []), ...Object.keys(extra), "atualizadoEm"] },
  );
  if (aviso) tx.create(creditoRef(slug, `aviso:${agora.getTime()}`), { tipo: "aviso", valorCents: 0, saldoAposCents: saldo, em: agora, mes: quandoFoi(agora).mes, motivo: aviso.texto });
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

/** Saldo em atenção ou crítico: push para quem gere, e-mail ao dono e, no canal oficial, o template
 *  ruphus_saldo_baixo no WhatsApp pessoal do dono (fora da janela de 24 h). Template ainda não aprovado
 *  na Meta: a recusa só vai para o log, o push e o e-mail já saíram. Nunca lança. */
async function avisarSaldoBaixo(slug: string, a: AvisoSaldo) {
  await avisar(adminDb, slug, { title: "Saldo de mensagens", body: a.texto, url: `/${slug}`, tag: `saldo-${slug}` }, { soGestores: true }).catch((e) => console.error(`[consumo] push do saldo de ${slug}`, e));
  await emailAoDono(slug, (nome) => ({
    assunto: `Saldo de mensagens baixo · ${nome}`,
    faixa: "Mensagens pré-pagas",
    titulo: a.saldo <= 0 ? "Seu saldo de mensagens acabou" : "Seu saldo de mensagens está baixo",
    subtitulo: nome,
    previa: a.texto,
    blocos: [{ destaque: formatBRL(a.saldo), rotulo: "Saldo agora", nota: a.texto }],
    acao: { texto: "Recarregar por Pix", url: `${SITE_BASE}/${slug}/consumo/recarga` },
    motivo: `Você recebe este e-mail por ser o dono do ${nome} na Ruphus. Avisamos uma vez a cada recarga.`,
  }));
  try {
    // import na hora: canal-oficial e whatsapp importam atendys, que importa este arquivo
    const [{ conexaoOficial, templateSaldoBaixo }, { lerConfigWhatsApp }, { enviarTemplate, OPTIN_DONO }, { soDigitosComDDI }] = await Promise.all([
      import("@/lib/canal-oficial.server"), import("@/lib/whatsapp.server"), import("@/lib/atendys"), import("@/lib/telefone"),
    ]);
    const oficial = await conexaoOficial(adminDb, slug);
    const dono = soDigitosComDDI(String((await lerConfigWhatsApp(adminDb, slug))?.ownerPhone ?? ""));
    if (!oficial || !dono) return;
    const negocio = String((await adminDb.doc(`tenants/${slug}`).get()).get("name") ?? "").trim() || slug;
    await enviarTemplate(oficial, dono, templateSaldoBaixo({ negocio, slug, saldoCents: a.saldo, previsao: a.previsao }), OPTIN_DONO);
  } catch (e) {
    console.error(`[consumo] aviso de saldo pelo WhatsApp de ${slug}`, e);
  }
}

/** E-mail ao dono no layout da Ruphus (o conteúdo recebe o nome do negócio). Nunca lança. */
async function emailAoDono(slug: string, conteudo: (nome: string) => Email) {
  try {
    const t = await adminDb.doc(`tenants/${slug}`).get();
    const dono = t.get("ownerId");
    const email = typeof dono === "string" && dono ? (await adminDb.doc(`tenants/${slug}/members/${dono}`).get()).get("email") : null;
    if (typeof email !== "string" || !email) return;
    const e = montarEmail(conteudo(String(t.get("name") ?? "").trim() || slug));
    await enviarEmail({ para: email, assunto: e.assunto, texto: e.texto, html: e.html });
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

/** Aviso ao cliente que não chegou: a agenda mostra "Aviso não chegou" com o wa.me no horário
 *  (avisoFalhou). Decide na transação, relendo o envio (o status atual, não o de quem chamou: duas
 *  transações de status do mesmo envio podem chegar fora de ordem) e comparando o momento com o da
 *  marca: só marca se a marca existente não for mais nova; só limpa com um envio mais novo que a
 *  marca e que a cubra (saidaCobre). A mesma marca não é regravada (o cron do lembrete repete).
 *  Agendamento que não existe fica como está. ref.envioId: sem ele (recusa antes de virar envio),
 *  não há o que reler. Nunca lança. */
export async function marcarAviso(slug: string, agendamentoId: string, efeito: NonNullable<ReturnType<typeof efeitoNoAviso>>, ref: { envioId?: string; em: number }): Promise<void> {
  try {
    const agRef = adminDb.doc(`tenants/${slug}/appointments/${agendamentoId}`);
    const marcou = await adminDb.runTransaction(async (tx) => {
      const [a, e] = await Promise.all([tx.get(agRef), ref.envioId ? tx.get(envioRef(slug, ref.envioId)) : null]);
      if (!a.exists) return false;
      if (e) {
        const atual = e.get("status") as StatusEnvio;
        const vale = efeito.acao === "marca" ? atual === "falhou" || atual === "sem-saldo" : SAIU.includes(atual);
        if (!vale) return false;
      }
      const marca = a.get("avisoFalhou") as AvisoFalhou | undefined;
      if (efeito.acao === "limpa") {
        if (marca && ref.em > Number(marca.em ?? 0) && saidaCobre(efeito.tipo, marca.tipo)) tx.update(agRef, { avisoFalhou: FieldValue.delete() });
        return false;
      }
      if (marca && Number(marca.em ?? 0) > ref.em) return false;
      const motivo = efeito.motivo.slice(0, 160);
      if (marca && marca.tipo === efeito.tipo && marca.motivo === motivo && (marca.envioId ?? null) === (ref.envioId ?? null)) return false;
      tx.update(agRef, { avisoFalhou: { tipo: efeito.tipo, em: ref.em, motivo, ...(ref.envioId && { envioId: ref.envioId }), ...(efeito.optOut && { optOut: true }) } });
      return true;
    });
    // SMS de reserva (negócio no modo "SMS só quando o WhatsApp não puder"): a confirmação ou o
    // lembrete pelo WhatsApp falhou de vez. Quem pediu SAIR não é procurado por outro canal. Import na
    // hora: sms-agendamento importa este arquivo. Sem esperar: quem marca pode ser o webhook do atendys,
    // que precisa do 200 rápido (smsDeReserva nunca lança; o servidor é contínuo, a promessa termina)
    if (marcou && efeito.acao === "marca" && !efeito.optOut && (efeito.tipo === "confirmado" || efeito.tipo === "lembrete")) {
      const tipo = efeito.tipo;
      void import("@/lib/sms-agendamento.server").then(({ smsDeReserva }) => smsDeReserva(adminDb, slug, agendamentoId, tipo)).catch((e) => console.error(`[consumo] sms de reserva ${slug}/${agendamentoId}`, e));
    }
  } catch (e) {
    console.error(`[consumo] marca do aviso no agendamento ${agendamentoId} de ${slug}`, e);
  }
}

/** Grava o envio, soma no mês e, no pré-pago com conta aberta, debita o saldo — tudo numa transação.
 *  O mesmo id outra vez (idempotency-key devolve a mensagem já aceita) não soma de novo. Nunca lança. */
export async function registrarEnvio(slug: string, n: NovoEnvio, agora = new Date()): Promise<void> {
  try {
    const aviso = await adminDb.runTransaction(async (tx) => {
      const [existe, conta] = await Promise.all([tx.get(envioRef(slug, n.id)), contaDe(slug, tx)]);
      if (existe.exists) return null;
      const { cfg } = conta;
      // aviso de saldo e confirmação do dono são da plataforma: não custam ao negócio
      const precoCents = cfg.cobrar && !ehDaPlataforma(n.tipo) ? precoDe(cfg, n.canal, !!n.servico) : 0;
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
  // fora da transação do consumo: a marca no agendamento não pode desfazer o registro (e repetir
  // a marca de um envio repetido só confirma o mesmo fato)
  const efeito = efeitoNoAviso(n);
  if (efeito && n.agendamentoId) await marcarAviso(slug, n.agendamentoId, efeito, { envioId: n.id, em: agora.getTime() });
}

/** Status novo (webhook message.status, conferência logo depois do aceite): atualiza o envio, acerta o
 *  mês dele e o saldo (falhou estorna o que foi debitado; parado que voltou à fila debita).
 *  at: quando o fato aconteceu; um mais velho que o último aplicado não mexe. Nunca lança. */
export async function atualizarEnvio(slug: string, id: string, statusAtendys: string, erro?: string | null, at = Date.now()): Promise<void> {
  const para = statusDoAtendys(statusAtendys);
  if (!para) return;
  // o envio como ficou (só quando o status mudou): a marca do aviso no agendamento sai dele
  let mudou: Parameters<typeof efeitoNoAviso>[0] | null = null;
  try {
    const aviso = await adminDb.runTransaction(async (tx) => {
      mudou = null;
      const d = await tx.get(envioRef(slug, id));
      if (!d.exists) return null;
      const de = d.get("status") as StatusEnvio;
      if (!avanca(de, para) || Number(d.get("statusEm") ?? 0) > at) return null;
      // limpar só na primeira passagem para "saiu" (enviado/entregue/lido): entregue e lido depois
      // de enviado não fazem outra leitura no agendamento
      if (para === "falhou" || !SAIU.includes(de)) mudou = { canal: d.get("canal"), destinatario: d.get("destinatario"), tipo: d.get("tipo"), agendamentoId: d.get("agendamentoId"), status: para, erro: erro ?? d.get("erro") };
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
    return;
  }
  const m = mudou as Parameters<typeof efeitoNoAviso>[0] | null;
  const efeito = m && efeitoNoAviso(m);
  if (efeito && m?.agendamentoId) await marcarAviso(slug, m.agendamentoId, efeito, { envioId: id, em: at });
}

type Credito = { tipo: "recarga" | "ajuste" | "boas-vindas"; valorCents: number; ref?: Record<string, string>; motivo?: string; por?: string };

/** Lança crédito (ou débito de ajuste) com id próprio, numa transação. Abre a conta. O mesmo id outra
 *  vez não lança de novo (devolve null). Recarga libera um novo aviso de saldo (ultimaRecargaEm). */
async function creditar(slug: string, id: string, c: Credito, confere?: (tx: Transaction) => Promise<void>): Promise<number | null> {
  const r = await adminDb.runTransaction(async (tx) => {
    const [ja, conta] = await Promise.all([tx.get(creditoRef(slug, id)), contaDe(slug, tx)]);
    if (confere) await confere(tx);
    if (ja.exists) return null;
    const agora = new Date();
    const saldo = (conta.saldoCents ?? 0) + c.valorCents;
    // a previsão volta a valer com o saldo novo; a recarga libera um novo aviso
    const aviso = gravarConta(tx, slug, { ...conta, saldoCents: saldo }, saldo, 0, agora, c.tipo === "recarga" ? { ultimaRecargaEm: agora.getTime() } : {});
    tx.create(creditoRef(slug, id), { ...c, saldoAposCents: saldo, em: new Date(agora.getTime() + 1), mes: quandoFoi(agora).mes });
    return { saldo, aviso };
  });
  // ajuste para baixo pode piorar o nível: o mesmo aviso do consumo
  if (r?.aviso) await avisarSaldoBaixo(slug, r.aviso);
  return r ? r.saldo : null;
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
    if (valorCents > RECARGA_MAXIMA_CENTS) throw new ErroPrevisto(`A recarga máxima é de ${formatBRL(RECARGA_MAXIMA_CENTS)}.`);
  }
  const { id, token } = await gerarCobranca(adminDb, { slug, tipo: "recarga", competencia: null, valorCents, recarga: { pacoteId, bonusCents } });
  return { id, token, valorCents, bonusCents, url: `${SITE_BASE}/pagar/${id}?t=${token}` };
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
    await emailAoDono(slug, (nome) => ({
      assunto: `Recarga de mensagens confirmada · ${nome}`,
      faixa: "Mensagens pré-pagas",
      titulo: "Recarga confirmada",
      subtitulo: `Recebemos o seu Pix. O crédito já está no saldo do ${nome}.`,
      previa: `Saldo de mensagens: ${formatBRL(saldo)}.`,
      blocos: [
        { destaque: formatBRL(saldo), rotulo: "Saldo de mensagens agora" },
        { dados: [["Pix recebido", formatBRL(valor)], ...(bonus ? [["Bônus", formatBRL(bonus)] as [string, string]] : []), ["Crédito", formatBRL(valor + bonus)]] },
        { p: "O crédito não vence. Obrigado!" },
      ],
      acao: { texto: "Ver saldo e extrato", url: `${SITE_BASE}/${slug}/consumo/recarga` },
      motivo: `Recibo da recarga de mensagens do ${nome} na Ruphus.`,
    }));
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
