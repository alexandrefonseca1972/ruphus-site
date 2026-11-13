import "server-only";
import { randomInt, randomUUID } from "node:crypto";
import { FieldValue, Timestamp, type DocumentReference, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { AtendysForaDoAr, chaveDeEnvio, ErroAtendys, statusDaMensagem } from "@/lib/atendys";
import { paradoNaProspeccao, registrarMensagem } from "@/lib/crm";
import { CADENCIA, ETAPA_DO_MODELO, TOQUES_MAX, type EtapaCadencia } from "@/lib/crm-tipos";
import { dateIn } from "@/lib/datetime";
import { ErroPrevisto } from "@/lib/erro-previsto";
import { escolherVariante, varianteDoNegocio } from "@/lib/prospeccao";
import { travada } from "@/lib/prospeccao-biblioteca";
import { COLECAO, lerBiblioteca, marcadoresDoLead } from "@/lib/prospeccao-biblioteca.server";
import { configProspeccao, contarNoDia, enviarProspeccao, resumoDoErro, travarCanal, type ConfigProspeccao } from "@/lib/prospeccao-agente.server";
import { CanalProibido } from "@/lib/prospeccao-canal";
import { ABERTOS, desistirDaReconciliacao, espalhar, FILA, formaDoEnvio, ItemFila, JANELA_META_MS, naJanela, proximaReconciliacao, RECONCILIAR, TemplatesFila, type MotivoCancelamento } from "@/lib/prospeccao-fila";
import { ETAPAS_VARIANTE, linksPermitidos, nichoDe, normalizarSaida, preencher, problemasDaResposta, type Variante } from "@/lib/prospeccao-variantes";
import { paraSlug, paraTelefoneNorm, paraVarianteId, type TelefoneNorm } from "@/lib/tipos-marca";

// Produtor (cron às 7h) e consumidor (cron a cada minuto) da fila da prospecção (F5). Desenho de
// concorrência (a revisão Opus confere):
//  - produtor: create() em prospeccaoFila/{slug}__{etapa} numa transação que confere de novo o dedupe por
//    telefoneNorm (um item aberto por telefone) e escreve na conversa do telefone (dois produtores se
//    serializam ali); texto gerado fora de qualquer transação; a cota desconta o que ainda está aberto;
//  - consumidor, um item por execução:
//    1. uma transação lê config/prospeccao (ativo, cota do dia, espaçamento global), o item (o reservado com
//       lease vencido primeiro, senão o vencido mais antigo) e os envios do telefone; grava o item como
//       reservado com leaseToken novo e o contador/espaçamento em config/prospeccao. Toda reserva escreve
//       em config/prospeccao: duas execuções em paralelo se serializam ali (uma refaz e vê o espaçamento);
//    2. o POST sai fora da transação, com idempotency-key = chaveDeEnvio("prospeccao-fila", id, crmEnvioId);
//    3. a conclusão é outra transação que só grava se o leaseToken ainda for o mesmo;
//    4. prazo/rede no POST: o item fica reservado com incertoEm; vencido o lease, a próxima reserva repete
//       o POST com a mesma chave e o mesmo texto (do item): o atendys devolve a mensagem já aceita
//       (unique tenantId+idempotencyKey), sem segunda mensagem. Sem messageId (o POST não respondeu),
//       o status no atendys só é alcançável pela própria chave, e o atendys não tem consulta por chave:
//       item retomado nunca volta a pendente; cancelado ou falhou, fica com talvezEnviado;
//    5. recusa antes de sair (canal, instância desconectada: 409): volta a pendente sem gastar tentativa
//       nem cota;
//  - atrasado mais de 2 h: reagendado para a próxima janela, espalhado (não sai em rajada), e a reserva
//    nunca pega um aberto com mais de 2 h de atraso;
//  - cancelamento: opt-out e resposta (agente), PARE no CRM (marcarContato) e naoContatarEm/respondeuEm/
//    estágio (conferidos no envio). O disjuntor não cancela: desligado, nada sai; religado, o
//    reagendamento espalha o atrasado.

/** Limites da fila. A cota e o espaçamento podem vir de config/prospeccao (cotaDiaria, espacamentoMs),
 *  sempre dentro do teto e do piso daqui. Por destinatário: o padrão do atendys no tenant de prospecção
 *  (3 por dia, 10 por semana; decisão 2 da F3). */
export const LIMITES_FILA = {
  cotaPadrao: 20,
  cotaMax: 50,
  espacamentoPadraoMs: 120_000,
  espacamentoMinMs: 60_000,
  leaseMs: 120_000,
  atrasoMaxMs: 2 * 3_600_000,
  tentativasMax: 3,
  porDestinatarioDia: 3,
  porDestinatarioSemana: 10,
} as const;

const DIA_MS = 86_400_000;
const RETENCAO_MS = 365 * DIA_MS;
const CONFIG = "config/prospeccao";

/** O que a fila guarda em config/prospeccao além da config do agente. Campo torto vira ausente. */
const ConfigFila = z.object({
  ativo: z.boolean().catch(false),
  enviadosHoje: z.object({ dia: z.string(), n: z.number().int().min(0) }).optional().catch(undefined),
  proximoEnvioPermitido: z.number().optional().catch(undefined),
  cotaDiaria: z.number().int().min(0).optional().catch(undefined),
  espacamentoMs: z.number().int().optional().catch(undefined),
  /** template aprovado na Meta por etapa (fora da janela de 24 h só sai template); sem ele, nada sai
   *  fora da janela */
  templates: TemplatesFila.optional().catch(undefined),
});
type ConfigFila = z.infer<typeof ConfigFila>;

export const cotaDe = (c: ConfigFila) => Math.min(c.cotaDiaria ?? LIMITES_FILA.cotaPadrao, LIMITES_FILA.cotaMax);
export const espacamentoDe = (c: ConfigFila) => Math.max(c.espacamentoMs ?? LIMITES_FILA.espacamentoPadraoMs, LIMITES_FILA.espacamentoMinMs);

const celular = (t: TelefoneNorm) => /^55\d{2}9\d{8}$/.test(t);
const MODELO: Record<EtapaCadencia, string> = Object.fromEntries(Object.entries(ETAPA_DO_MODELO).map(([m, e]) => [e, m])) as Record<EtapaCadencia, string>;
/** Data do doc em ms (serverTimestamp, Date ou número); ausente ou torta, 0. */
const msDe = (v: unknown) => (v instanceof Timestamp ? v.toMillis() : v instanceof Date ? v.getTime() : typeof v === "number" ? v : 0);
const toquesDe = (crm: DocumentSnapshot) => (typeof crm.get("toques") === "number" ? (crm.get("toques") as number) : 0);

// ————— produtor —————

export type ResultadoProdutor = { criados: number; duplicados: number; ignorados: Record<string, number>; motivo?: "desligado" };

/** O pool do escolherVariante no produtor: sem as já tentadas e nunca as travadas do A/B da F1 (essas só
 *  saem pelo varianteAB, no salão e no primeiro contato). */
export const candidatasDoProdutor = (ativas: readonly Variante[], tentadas: ReadonlySet<string>) => ativas.filter((a) => !travada(a.id) && !tentadas.has(a.id));


/** Cria os itens do dia: só quem deu opt-in (marketing) no número de prospecção (prospeccaoConversas
 *  com optinEm, a evidência da F3) e tem o slug confirmado pelo telefone. Ignora naoContatarEm (na
 *  conversa, no CRM ou em outro telefone do negócio), escalada, fechado/perdido, resposta no CRM, os 3
 *  toques já dados, telefone que não é celular válido e negócio sem nota no Google. No máximo a cota
 *  do dia; horários espalhados na janela. */
export async function produzir(db: Firestore, dep: { agora?: number; aleatorio?: () => number } = {}): Promise<ResultadoProdutor> {
  const agora = dep.agora ?? Date.now();
  const aleatorio = dep.aleatorio ?? (() => randomInt(0, 2 ** 32) / 2 ** 32);
  const r: ResultadoProdutor = { criados: 0, duplicados: 0, ignorados: {} };
  const ignora = (motivo: string) => void (r.ignorados[motivo] = (r.ignorados[motivo] ?? 0) + 1);
  const cfg = await configProspeccao(db);
  if (!cfg?.ativo) return { ...r, motivo: "desligado" };
  // o que ainda vai sair (de outro dia, reagendado ou reservado) gasta a cota de hoje
  const abertos = (await db.collection(FILA).where("status", "in", [...ABERTOS, "reservado"]).count().get()).data().count;
  const cota = Math.max(0, cotaDe(ConfigFila.parse((await db.doc(CONFIG).get()).data() ?? {})) - abertos);

  // F4: as ativas de prospeccaoVariantes; coleção sem texto, a biblioteca do código
  const { ativas, stats } = await lerBiblioteca(db);

  const conversas = (await db.collection("prospeccaoConversas").where("optinEm", ">", 0).get()).docs;
  const telefones = new Set<string>();
  const novos: { ref: DocumentReference; dados: Omit<ItemFila & { status: "pendente" }, "agendadoPara"> }[] = [];
  for (const conv of conversas) {
    if (novos.length >= cota) break;
    const telefone = paraTelefoneNorm(conv.id);
    if (!telefone || !celular(telefone)) { ignora("sem_celular"); continue; }
    if (conv.get("naoContatarEm")) { ignora("nao_contatar"); continue; }
    if (conv.get("escaladoEm")) { ignora("escalado"); continue; }
    const slug = paraSlug(String(conv.get("slug") ?? ""));
    if (!slug) { ignora("sem_slug"); continue; }
    if (telefones.has(telefone)) { ignora("telefone_repetido"); continue; }
    const [tenant, crm] = await Promise.all([db.doc(`tenants/${slug}`).get(), db.doc(`crm/${slug}`).get()]);
    const estagio = String(crm.get("estagio") ?? "novo");
    if (crm.get("naoContatarEm")) { ignora("nao_contatar"); continue; }
    if (estagio === "fechado" || estagio === "perdido") { ignora("fora_do_funil"); continue; }
    if (crm.get("respondeuEm")) { ignora("respondeu"); continue; }
    const toques = toquesDe(crm);
    if (toques >= TOQUES_MAX) { ignora("toques"); continue; }
    const marcadores = marcadoresDoLead(slug, tenant, crm);
    if (!marcadores) { ignora("sem_nota"); continue; }
    if (await paradoNaProspeccao(db, slug)) { ignora("nao_contatar"); continue; }
    // dedupe por telefone: um item aberto (ou reservado) por vez
    const aberto = await db.collection(FILA).where("telefoneNorm", "==", telefone).where("status", "in", [...ABERTOS, "reservado"]).limit(1).get();
    if (!aberto.empty) { ignora("telefone_na_fila"); continue; }
    // a cadência: nada antes da proximaData combinada, e o lembrete e a última só depois dos dias do
    // toque anterior (3 e 7, CADENCIA), contados do último envio
    const proxima = crm.get("proximaData");
    if (typeof proxima === "string" && proxima > dateIn(new Date(agora))) { ignora("cadencia"); continue; }
    if (toques > 0) {
      const ultimo = Math.max(msDe(crm.get("ultimoContatoEm")), msDe(crm.get("ultimoEnvio.em")));
      if (!ultimo || agora - ultimo < CADENCIA[MODELO[ETAPAS_VARIANTE[toques - 1]]].dias * DIA_MS) { ignora("cadencia"); continue; }
    }

    const etapa = ETAPAS_VARIANTE[toques];
    const anteriores = await db.getAll(...ETAPAS_VARIANTE.map((e) => db.doc(`${FILA}/${slug}__${e}`)));
    const recebidas = [...anteriores.map((d) => d.get("varianteId")), crm.get("varianteId")].filter((v): v is string => typeof v === "string");
    if (!marcadores.nome) { ignora("texto_invalido"); continue; }
    // A/B da F1: salão no primeiro contato leva a variante do hash do slug (varianteAB), a mesma da
    // gaveta e do registrarMensagem; sem candidata alternativa. Fora disso, escolherVariante
    const ab = etapa === "primeiro" ? varianteDoNegocio(slug, tenant.get("gerado.sub")) : null;
    // o texto final passa pelo mesmo validador do agente; inválido (dado do lead), a próxima candidata
    const tentadas = new Set<string>();
    let escolha: { variante: Variante; texto: string } | null = null;
    for (;;) {
      const v = ab
        ? (tentadas.has(ab.id) ? null : ab)
        : escolherVariante({ nicho: nichoDe(tenant.get("gerado.sub")), recebidas }, etapa, stats, aleatorio, candidatasDoProdutor(ativas, tentadas)).variante;
      if (!v) break;
      const t = preencher(v, marcadores);
      // M-3: sai o texto normalizado, o mesmo que o validador conferiu
      if (!problemasDaResposta(t, linksPermitidos(slug)).length) { escolha = { variante: v, texto: normalizarSaida(t) }; break; }
      tentadas.add(v.id);
    }
    if (!escolha) { ignora(tentadas.size ? "texto_invalido" : "sem_variante"); continue; }
    const { variante, texto } = escolha;
    telefones.add(telefone);
    novos.push({
      ref: db.doc(`${FILA}/${slug}__${etapa}`),
      dados: {
        status: "pendente", slug, etapa, telefoneNorm: telefone, varianteId: variante.id, texto, tentativas: 0, criadoEm: agora, crmEnvioId: randomUUID(), toques,
        // as variáveis do template (fora da janela de 24 h): o link do site só depois do primeiro contato
        templateParametros: etapa === "primeiro" ? [marcadores.nome] : [marcadores.nome, marcadores.site],
      },
    });
  }

  const horarios = espalhar(novos.length, agora);
  for (const [i, { ref, dados }] of novos.entries()) {
    const item = ItemFila.parse({ ...dados, agendadoPara: horarios[i] });
    // o dedupe de novo, na transação que cria: dois produtores em paralelo leem e escrevem a conversa
    // do telefone, então se serializam e o segundo vê o item do primeiro
    const conv = db.doc(`prospeccaoConversas/${item.telefoneNorm}`);
    const feito = await db.runTransaction(async (tx) => {
      const [existe, aberto] = [await tx.get(ref), await tx.get(db.collection(FILA).where("telefoneNorm", "==", item.telefoneNorm).where("status", "in", [...ABERTOS, "reservado"]).limit(1))];
      await tx.get(conv);
      // a variante relida aqui: pausada depois do lerBiblioteca, o item não nasce (a pausa que grava
      // depois desta leitura refaz a transação, e a que cancela depois acha o item)
      const variante = await tx.get(db.doc(`${COLECAO}/${item.varianteId}`));
      // o item desta etapa já existe (outro produtor, ou dia anterior)
      if (existe.exists) return "duplicado" as const;
      if (!aberto.empty) return "telefone_na_fila" as const;
      if (variante.get("status") === "pausada") return "variante_pausada" as const;
      tx.create(ref, { ...item, expiraEm: Timestamp.fromMillis(agora + RETENCAO_MS) });
      tx.set(conv, { filaItem: ref.id }, { merge: true });
      return "criado" as const;
    });
    if (feito === "criado") r.criados++;
    else if (feito === "duplicado") r.duplicados++;
    else ignora(feito);
  }
  return r;
}

// ————— consumidor —————

export type ResultadoConsumidor =
  | "sem_config" | "desligado" | "fora_da_janela" | "recusada" | "nada" | "cota" | "espacamento" | "adiado"
  | "enviado" | "incerto" | "falhou" | "cancelado" | "lease_perdido" | "sem_template";

/** retomada: o item já estava reservado (lease vencido); um POST anterior pode ter saído. */
type Reserva = { ref: DocumentReference; token: string; retomada: boolean; item: ItemFila & { status: "reservado" }; templates?: TemplatesFila };

/** Reagenda o que passou mais de 2 h do horário: espalhado na próxima janela, nunca tudo junto. */
export async function reagendarAtrasados(db: Firestore, agora: number, limite = 50) {
  const q = await db.collection(FILA).where("status", "in", [...ABERTOS]).where("agendadoPara", "<", agora - LIMITES_FILA.atrasoMaxMs).orderBy("agendadoPara").limit(limite).get();
  const horarios = espalhar(q.size, agora);
  let n = 0;
  for (const [i, d] of q.docs.entries()) {
    const antes = d.get("agendadoPara");
    const ok = await db.runTransaction(async (tx) => {
      const atual = await tx.get(d.ref);
      if (!(ABERTOS as readonly string[]).includes(String(atual.get("status"))) || atual.get("agendadoPara") !== antes) return false;
      tx.update(d.ref, { status: "reagendado", reagendadoEm: agora, agendadoPara: horarios[i] });
      return true;
    });
    if (ok) n++;
  }
  return n;
}

/** Passo 1: a transação da reserva. Devolve a reserva ou por que não reservou. */
export async function reservar(db: Firestore, agora: number): Promise<Reserva | "desligado" | "nada" | "cota" | "espacamento" | "adiado" | "falhou"> {
  const cfgRef = db.doc(CONFIG);
  return db.runTransaction(async (tx) => {
    const conf = ConfigFila.parse((await tx.get(cfgRef)).data() ?? {});
    // relido na reserva: desligado depois que a execução começou, nada é reservado
    if (!conf.ativo) return "desligado" as const;
    // o reservado com lease vencido primeiro: pode ter saído (reconcilia com a mesma chave)
    const vencido = await tx.get(db.collection(FILA).where("status", "==", "reservado").where("leaseAte", "<=", agora).orderBy("leaseAte").limit(1));
    // nunca o que passou de 2 h: esse espera o reagendamento (50 por execução), não sai atrasado
    const proximo = vencido.empty
      ? await tx.get(db.collection(FILA).where("status", "in", [...ABERTOS]).where("agendadoPara", ">=", agora - LIMITES_FILA.atrasoMaxMs).where("agendadoPara", "<=", agora).orderBy("agendadoPara").limit(1))
      : null;
    const doc = vencido.docs[0] ?? proximo?.docs[0];
    if (!doc) return "nada" as const;
    const lido = ItemFila.safeParse(doc.data());
    // item torto não trava a fila: sai dela como falhou
    if (!lido.success) {
      tx.update(doc.ref, { status: "falhou", falhouEm: agora, erro: "schema" });
      return "falhou" as const;
    }
    const item = lido.data;
    const retomada = item.status === "reservado";
    const dia = dateIn(new Date(agora));
    const hoje = conf.enviadosHoje?.dia === dia ? conf.enviadosHoje.n : 0;
    if ((conf.proximoEnvioPermitido ?? 0) > agora) return "espacamento" as const;
    if (!retomada && hoje >= cotaDe(conf)) return "cota" as const;
    if (item.tentativas >= LIMITES_FILA.tentativasMax) {
      tx.update(doc.ref, { status: "falhou", falhouEm: agora, erro: `${item.tentativas} tentativas sem confirmação`, ...(retomada && { talvezEnviado: true }) });
      return "falhou" as const;
    }
    if (!retomada) {
      // por destinatário (o atendys recusaria): o que já saiu ou está saindo para o telefone, e o que
      // falhou ou foi cancelado com talvezEnviado (um POST sem resposta pode ter chegado)
      const doTelefone = await tx.get(db.collection(FILA).where("telefoneNorm", "==", item.telefoneNorm).where("status", "in", ["reservado", "enviado", "falhou", "cancelado"]));
      const quando = doTelefone.docs
        .filter((d) => d.id !== doc.id && (d.get("status") === "reservado" || d.get("status") === "enviado" || d.get("talvezEnviado") === true))
        .map((d) => Number(d.get("enviadoEm") ?? d.get("reservadoEm") ?? d.get("falhouEm") ?? d.get("canceladoEm") ?? 0));
      const noDia = quando.filter((t) => t > agora - DIA_MS).length;
      const naSemana = quando.filter((t) => t > agora - 7 * DIA_MS).length;
      if (noDia >= LIMITES_FILA.porDestinatarioDia || naSemana >= LIMITES_FILA.porDestinatarioSemana) {
        tx.update(doc.ref, { status: "reagendado", reagendadoEm: agora, agendadoPara: espalhar(1, agora + DIA_MS)[0] });
        return "adiado" as const;
      }
    }
    const token = randomUUID();
    const reservado = { status: "reservado" as const, leaseToken: token, leaseAte: agora + LIMITES_FILA.leaseMs, reservadoEm: retomada ? item.reservadoEm : agora, tentativas: item.tentativas + 1 };
    // o motivo do reagendamento (sem_template) não segue com o item
    tx.update(doc.ref, { ...reservado, motivo: FieldValue.delete() });
    tx.set(cfgRef, { enviadosHoje: { dia, n: hoje + (retomada ? 0 : 1) }, proximoEnvioPermitido: agora + espacamentoDe(conf) }, { merge: true });
    return { ref: doc.ref, token, retomada, item: { ...item, ...reservado }, templates: conf.templates };
  });
}

/** Passo 3: muda o item só se o leaseToken ainda é o desta execução (e ele segue reservado). */
export async function concluir(db: Firestore, ref: DocumentReference, token: string, dados: Record<string, unknown>) {
  return db.runTransaction(async (tx) => {
    const atual = await tx.get(ref);
    if (atual.get("status") !== "reservado" || atual.get("leaseToken") !== token) return false;
    tx.update(ref, dados);
    return true;
  });
}

/** Recusa antes do POST, na primeira reserva: volta a pendente (ou ao destino) sem gastar tentativa nem
 *  a cota do dia. */
async function devolver(db: Firestore, ref: DocumentReference, token: string, item: Reserva["item"], destino: Record<string, unknown> = { status: "pendente" }) {
  const cfgRef = db.doc(CONFIG);
  return db.runTransaction(async (tx) => {
    const [atual, cfg] = [await tx.get(ref), await tx.get(cfgRef)];
    if (atual.get("status") !== "reservado" || atual.get("leaseToken") !== token) return false;
    tx.update(ref, { ...destino, tentativas: item.tentativas - 1, leaseToken: FieldValue.delete(), leaseAte: FieldValue.delete(), reservadoEm: FieldValue.delete() });
    const hoje = ConfigFila.parse(cfg.data() ?? {}).enviadosHoje;
    if (hoje && hoje.dia === dateIn(new Date(item.reservadoEm)) && hoje.n > 0) tx.set(cfgRef, { enviadosHoje: { dia: hoje.dia, n: hoje.n - 1 } }, { merge: true });
    return true;
  });
}

/** Por que o item não pode mais sair (null = pode). Refeito no momento do envio. */
async function motivoParaCancelar(db: Firestore, item: ItemFila): Promise<MotivoCancelamento | null> {
  const [conv, crm] = await Promise.all([db.doc(`prospeccaoConversas/${item.telefoneNorm}`).get(), db.doc(`crm/${item.slug}`).get()]);
  if (conv.get("naoContatarEm") || crm.get("naoContatarEm")) return "naoContatar";
  if (conv.get("escaladoEm")) return "escalado";
  const estagio = String(crm.get("estagio") ?? "novo");
  if (estagio === "fechado" || estagio === "perdido") return "fora_do_funil";
  if (crm.get("respondeuEm")) return "resposta";
  // toque ou contato por fora (gaveta, proposta) depois que o item nasceu: a cadência mudou
  if ((item.toques !== undefined && toquesDe(crm) !== item.toques) || msDe(crm.get("ultimoContatoEm")) > item.criadoEm) return "cadencia";
  // mensagem do lead depois que o item nasceu: a conversa é com o agente ou com uma pessoa
  const respondeu = await db.collection(`prospeccaoConversas/${item.telefoneNorm}/recebidas`).where("em", ">", item.criadoEm).limit(1).get();
  if (!respondeu.empty) return "resposta";
  if (await paradoNaProspeccao(db, item.slug)) return "naoContatar";
  return null;
}

/** Recusa do atendys que não passa repetindo: o item falha. Prazo, 429, 5xx e IDEMPOTENCY_CONFLICT (409
 *  pelo conteúdo: o igual pode ter saído) ficam para a reconciliação; os outros 409 (instância) e a
 *  credencial recusada (401, FORBIDDEN, INVALID_API_KEY, UNAUTHORIZED) são do canal, não do item. */
const definitiva = (e: unknown) => e instanceof ErroAtendys && e.status !== 409 && e.status !== 429 && e.status < 500;
const CREDENCIAL = new Set(["FORBIDDEN", "INVALID_API_KEY", "UNAUTHORIZED"]);
const recusaDoCanal = (e: unknown) =>
  e instanceof CanalProibido ||
  (e instanceof ErroAtendys && ((e.status === 409 && e.codigo !== "IDEMPOTENCY_CONFLICT") || e.status === 401 || (e.codigo !== null && CREDENCIAL.has(e.codigo))));
/** Status do atendys em que a mensagem já saiu; "queued" sem retryAt é o aceite normal (sai em seguida). */
const SAIU = new Set(["sent", "delivered", "read"]);

/** O toque no CRM (cadência, variante escolhida), uma vez por item (o crmEnvioId). Falhou: crmPendente,
 *  e o consumidor tenta de novo (reconciliarCrm), senão o toque nunca entra e o lead fica parado na etapa.
 *  Recusa prevista do CRM (PARE, limite de toques, a gaveta registrou o mesmo toque): não tenta mais. */
async function registrarToque(db: Firestore, ref: DocumentReference, item: ItemFila, agora: number) {
  const varianteId = paraVarianteId(item.varianteId) ?? undefined;
  try {
    // template: o rótulo que o atendys também guarda (não há texto livre)
    const textoEnviado = item.templateNome ? `[${item.templateNome}] ${(item.templateParametros ?? []).join(" · ")}` : item.texto;
    await registrarMensagem(db, item.slug, MODELO[item.etapa], item.telefoneNorm, "fila-prospeccao", { envioId: item.crmEnvioId, textoEnviado, editado: false }, agora, { varianteId });
  } catch (e) {
    console.error(`[fila prospecção] ${ref.id}: enviado, mas o CRM não registrou o toque. ${resumoDoErro(e)}`);
    await ref.update(e instanceof ErroPrevisto ? { crmPendente: FieldValue.delete(), crmErro: resumoDoErro(e) } : { crmPendente: true });
    return;
  }
  if (item.status === "enviado" && item.crmPendente) await ref.update({ crmPendente: FieldValue.delete() });
}

/** Enviado com o CRM pendente, poucos por execução: o que espera o status da mensagem (aguardaStatus)
 *  pergunta ao atendys; saiu, conta no dia e registra o toque; failed/cancelled, o item vira falhou.
 *  O resto só tenta o CRM de novo. Um item com erro não trava os outros nem o envio: cada passagem
 *  empurra o reconciliarApos (o mais antigo vencido vem primeiro) e, no limite (RECONCILIAR), o item
 *  sai com crmErro. */
export async function reconciliarCrm(db: Firestore, cfg: ConfigProspeccao, agora: number, limite = 5) {
  const q = await db.collection(FILA).where("status", "==", "enviado").where("crmPendente", "==", true).where("reconciliarApos", "<=", agora).orderBy("reconciliarApos").limit(limite).get();
  for (const d of q.docs) {
    try {
      const lido = ItemFila.safeParse(d.data());
      if (!lido.success || lido.data.status !== "enviado") {
        console.error(`[fila prospecção] ${d.id}: crmPendente fora do schema; sai da reconciliação para conferência`);
        await d.ref.update({ crmPendente: FieldValue.delete(), crmErro: "fora do schema" });
        continue;
      }
      const item = lido.data;
      if (desistirDaReconciliacao(item, agora)) {
        const erro = `reconciliação esgotada (${item.tentativasCrm ?? 0} de ${RECONCILIAR.tentativasMax} tentativas)${item.aguardaStatus ? "; saída da mensagem não confirmada" : ""}`;
        console.error(`[fila prospecção] ${d.id}: ${erro}`);
        await d.ref.update({ crmPendente: FieldValue.delete(), aguardaStatus: FieldValue.delete(), crmErro: erro });
        continue;
      }
      const n = (item.tentativasCrm ?? 0) + 1;
      await d.ref.update({ tentativasCrm: n, reconciliarApos: proximaReconciliacao(n, agora) });
      if (item.aguardaStatus) {
        const s = (await statusDaMensagem({ atendysApiKey: cfg.apikey, instanceId: cfg.instancia }, item.envioId)).status;
        if (s === "failed" || s === "cancelled") {
          await d.ref.update({ status: "falhou", falhouEm: agora, erro: `atendys: ${s}`, crmPendente: FieldValue.delete(), aguardaStatus: FieldValue.delete() });
          continue;
        }
        if (!SAIU.has(s)) continue;
        // a confirmação conta no dia uma vez: dois consumidores em paralelo, só quem tirou o aguardaStatus
        const primeiro = await db.runTransaction(async (tx) => {
          if ((await tx.get(d.ref)).get("aguardaStatus") !== true) return false;
          tx.update(d.ref, { aguardaStatus: FieldValue.delete() });
          tx.set(db.doc(`prospeccaoDias/${dateIn(new Date(agora))}`), { enviadas: FieldValue.increment(1) }, { merge: true });
          return true;
        });
        if (!primeiro) continue;
      }
      await registrarToque(db, d.ref, item, agora);
    } catch (e) {
      console.error(`[fila prospecção] ${d.id}: reconciliação do CRM falhou; tenta na próxima execução. ${resumoDoErro(e)}`);
    }
  }
}

/** Passo 2 e 3: confere de novo, envia com a chave do item e conclui pelo token. */
async function processar(db: Firestore, cfg: ConfigProspeccao, r: Reserva, agora: number): Promise<ResultadoConsumidor> {
  const { ref, token, retomada } = r;
  let item = r.item;
  // retomado, um POST anterior pode ter saído e o atendys não consulta pela chave: não sai e fica marcado
  const talvez = retomada ? { talvezEnviado: true } : {};
  const motivo = await motivoParaCancelar(db, item);
  if (motivo) return (await concluir(db, ref, token, { status: "cancelado", canceladoEm: agora, motivo, ...talvez })) ? "cancelado" : "lease_perdido";
  // janela de 24 h da Meta: sem mensagem recebida do lead nesse prazo, só template aprovado
  const recente = await db.collection(`prospeccaoConversas/${item.telefoneNorm}/recebidas`).where("em", ">", agora - JANELA_META_MS).limit(1).get();
  const forma = formaDoEnvio(item, r.templates, !recente.empty, retomada);
  if (forma.tipo === "sem_template") {
    // não sai e não gasta cota nem tentativa: tenta de novo no próximo dia útil (o dono configura o template)
    if (!(await devolver(db, ref, token, item, { status: "reagendado", reagendadoEm: agora, agendadoPara: espalhar(1, agora + DIA_MS)[0], motivo: "sem_template" }))) return "lease_perdido";
    console.warn(`[fila prospecção] ${ref.id}: fora da janela de 24 h e sem template da etapa ${item.etapa}; reagendado`);
    return "sem_template";
  }
  if (forma.tipo === "template" && !item.templateNome) {
    // gravado antes do POST: a retomada repete o mesmo template com a mesma chave
    const escolhido = { templateNome: forma.nome, templateIdioma: forma.idioma };
    if (!(await concluir(db, ref, token, escolhido))) return "lease_perdido";
    item = { ...item, ...escolhido };
  }
  const conteudo = forma.tipo === "template" ? { nome: forma.nome, idioma: forma.idioma, parametros: forma.parametros } : item.texto;
  const chave = chaveDeEnvio("prospeccao-fila", ref.id, item.crmEnvioId);
  let envio: Awaited<ReturnType<typeof enviarProspeccao>>;
  try {
    // trava de novo (travarCanal) e naoContatarEm relido logo antes do POST, dentro de enviarProspeccao
    envio = await enviarProspeccao(db, cfg, item.telefoneNorm as TelefoneNorm, conteudo, chave, agora, { ativo: true });
  } catch (e) {
    if (recusaDoCanal(e)) {
      // nada saiu agora. Na primeira reserva volta para a fila; retomado, fica reservado (o lease vence
      // e a próxima retomada repete a chave), sem gastar a tentativa
      if (retomada) await concluir(db, ref, token, { tentativas: item.tentativas - 1 });
      else await devolver(db, ref, token, item);
      console.error(`[fila prospecção] ${ref.id}: canal recusado. ${resumoDoErro(e)}`);
      return "recusada";
    }
    if (definitiva(e)) {
      // retomado, o POST anterior (sem resposta) pode ter saído: falhou com talvezEnviado
      await concluir(db, ref, token, { status: "falhou", falhouEm: agora, erro: resumoDoErro(e), ...talvez });
      console.error(`[fila prospecção] ${ref.id}: ${resumoDoErro(e)}`);
      return "falhou";
    }
    if (e instanceof AtendysForaDoAr || e instanceof ErroAtendys) {
      // pode ter saído: fica reservado; vencido o lease, a próxima reserva repete com a mesma chave
      await concluir(db, ref, token, { incertoEm: agora });
      console.warn(`[fila prospecção] ${ref.id}: sem confirmação do atendys (${resumoDoErro(e)}); reconcilia no próximo ciclo`);
      return "incerto";
    }
    throw e;
  }
  if (!envio) return (await concluir(db, ref, token, { status: "cancelado", canceladoEm: agora, motivo: "naoContatar", ...talvez })) ? "cancelado" : "lease_perdido";
  // aceito sem sair agora (retryAt, awaiting_manual, outro status): o CRM e a conta do dia esperam o
  // status da mensagem (reconciliarCrm)
  const saiu = SAIU.has(envio.status) || (envio.status === "queued" && !envio.retryAt);
  if (!(await concluir(db, ref, token, { status: "enviado", enviadoEm: agora, envioId: envio.messageId, reconciliarApos: agora, ...(!saiu && { crmPendente: true, aguardaStatus: true }) }))) return "lease_perdido";
  if (!saiu) {
    console.warn(`[fila prospecção] ${ref.id}: aceito pelo atendys como ${envio.status}${envio.retryAt ? ` (retryAt ${envio.retryAt})` : ""}; o CRM espera o status`);
    return "enviado";
  }
  // uma vez por item: só quem concluiu como enviado conta (a retomada e o lease perdido não somam)
  await contarNoDia(db, "enviadas", dateIn(new Date(agora)));
  await registrarToque(db, ref, item, agora);
  return "enviado";
}

/** Uma execução do consumidor: no máximo um item. Sem config ativa, nada sai e nada é cancelado:
 *  religado, o reagendamento espalha o que atrasou. */
export async function consumirUm(db: Firestore, dep: { agora?: number } = {}): Promise<ResultadoConsumidor> {
  const agora = dep.agora ?? Date.now();
  const cfg = await configProspeccao(db);
  if (!cfg) return "sem_config";
  if (!cfg.ativo) return "desligado";
  await reconciliarCrm(db, cfg, agora);
  if (!naJanela(agora)) return "fora_da_janela";
  await reagendarAtrasados(db, agora);
  // trava antes de reservar: canal recusado não gasta cota nem tentativa
  try {
    await travarCanal(db, cfg);
  } catch (e) {
    if (!(e instanceof CanalProibido)) throw e;
    console.error(`[fila prospecção] canal recusado (${cfg.instancia}): nada sai. ${resumoDoErro(e)}`);
    return "recusada";
  }
  const r = await reservar(db, agora);
  return typeof r === "string" ? r : processar(db, cfg, r, agora);
}
