import "server-only";
import { adminDb } from "@/lib/admin";
import { listarCobrancas } from "@/lib/cobranca";
import { configDoNegocio, type Canal, type ConfigMensagens, type Destinatario, type Pacote, type Precos, type Previsao, type StatusEnvio, type TipoEnvio, type Via } from "@/lib/consumo";
import { lerConfigMensagens } from "@/lib/consumo.server";
import { dateIn } from "@/lib/datetime";

// O que a tela de consumo do painel (/[slug]/consumo) e a gaveta do /admin leem. A conta e a config
// de preços só o servidor lê (regras): tudo sai daqui pronto para a tela, sem telefone inteiro.

/** Teto de envios lidos por mês: acima disso a tela avisa que a lista está cortada. */
const TETO_ENVIOS = 3000;
/** Agendamentos ligados aos envios que a tela mostra com nome do cliente e serviço. */
const TETO_AGENDAMENTOS = 300;

export type EnvioTela = {
  id: string;
  em: number;
  canal: Canal;
  via: Via;
  tipo: TipoEnvio;
  destino: string;
  destinatario: Destinatario;
  status: StatusEnvio;
  erro: string | null;
  custoCents: number;
  /** quando o status atual chegou (lido: a hora da leitura) */
  statusEm: number | null;
  agendamento: { cliente: string; servico: string; inicio: number } | null;
};

export type CreditoTela = { id: string; tipo: string; valorCents: number; saldoAposCents: number; em: number; motivo: string | null; pacote: { valorCents: number; bonusCents: number } | null };

export type RecargaAberta = { id: string; valorCents: number; vencimento: string };

export type Conta = {
  /** conta aberta: o saldo vale e bloqueia; fechada, as mensagens só são registradas */
  aberta: boolean;
  saldoCents: number | null;
  previsao: Previsao | null;
  /** o último crédito (recarga ou boas-vindas) e o saldo logo depois dele */
  ultimaRecarga: { valorCents: number; em: number; saldoAposCents: number } | null;
  /** cobrança e preços do negócio (o override do /admin já aplicado) */
  cobrar: boolean;
  modelo: ConfigMensagens["modelo"];
  semSaldo: ConfigMensagens["semSaldo"];
  avisoSaldoCents: number;
  precos: Precos;
  /** override do /admin só para este negócio (null: segue o geral) */
  proprio: { cobrar: boolean | null; precos: Partial<Precos> | null };
};

const ms = (v: unknown): number | null => (typeof v === "number" ? v : ((v as { toMillis?: () => number } | undefined)?.toMillis?.() ?? null));

const mesAnterior = (mes: string) => {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** "Maria Silva" → "Maria S." */
const nomeCurto = (n: string) => {
  const p = n.trim().split(/\s+/).filter(Boolean);
  return p.length > 1 ? `${p[0]} ${p.at(-1)!.charAt(0).toUpperCase()}.` : (p[0] ?? "");
};

export async function contaDoNegocio(slug: string): Promise<Conta> {
  const [geral, d] = await Promise.all([lerConfigMensagens(), adminDb.doc(`tenants/${slug}/privado/mensagens`).get()]);
  const dados = d.data() ?? null;
  const cfg = configDoNegocio(geral, dados);
  const saldo = dados?.saldoCents;
  const precos = dados?.precos && typeof dados.precos === "object" ? (dados.precos as Partial<Precos>) : null;
  return {
    aberta: typeof saldo === "number",
    saldoCents: typeof saldo === "number" ? saldo : null,
    previsao: (dados?.previsao as Previsao | undefined) ?? null,
    ultimaRecarga: null,
    cobrar: cfg.cobrar,
    modelo: cfg.modelo,
    semSaldo: cfg.semSaldo,
    avisoSaldoCents: cfg.avisoSaldoCents,
    precos: { whatsappUtilityCents: cfg.whatsappUtilityCents, whatsappServiceCents: cfg.whatsappServiceCents, smsCents: cfg.smsCents },
    proprio: { cobrar: typeof dados?.cobrar === "boolean" ? dados.cobrar : null, precos: precos && Object.keys(precos).length ? precos : null },
  };
}

export async function extratoDoNegocio(slug: string, limite = 60): Promise<CreditoTela[]> {
  const snap = await adminDb.collection(`tenants/${slug}/creditos`).orderBy("em", "desc").limit(limite).get();
  // a recarga guarda só a cobrança: o pacote (valor e bônus) vem dela
  const cobrancas = await Promise.all(
    snap.docs.map((d) => {
      const id = (d.get("ref") as { cobrancaId?: unknown } | undefined)?.cobrancaId;
      return d.get("tipo") === "recarga" && typeof id === "string" ? adminDb.doc(`cobrancas/${id}`).get() : null;
    }),
  );
  return snap.docs.map((d, i) => {
    const c = cobrancas[i];
    return {
      id: d.id,
      tipo: String(d.get("tipo") ?? ""),
      valorCents: Number(d.get("valorCents") ?? 0),
      saldoAposCents: Number(d.get("saldoAposCents") ?? 0),
      em: ms(d.get("em")) ?? 0,
      motivo: typeof d.get("motivo") === "string" ? (d.get("motivo") as string) : null,
      pacote: c?.exists ? { valorCents: Number(c.get("valorCents") ?? 0), bonusCents: Number(c.get("bonusCents") ?? 0) } : null,
    };
  });
}

export type PainelConsumo = {
  mes: string;
  hoje: string;
  conta: Conta;
  pacotes: Pacote[];
  envios: EnvioTela[];
  truncado: boolean;
  anterior: { mes: string; total: number; custoCents: number };
  /** o agregado do mês (consumo/{mes}): vale mesmo quando a lista de envios foi cortada ou não foi lida */
  doMes: { total: number; custoCents: number };
  creditos: CreditoTela[];
  recargasAbertas: RecargaAberta[];
};

/** Início do mês em Brasília (UTC−3, sem horário de verão desde 2019). */
const inicioDoMes = (mes: string) => new Date(`${mes}-01T03:00:00Z`);
const mesSeguinte = (mes: string) => {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

/** opcoes.envios = false: sem a lista do mês (tela de recarga), só saldo, extrato e agregados. */
export async function painelDeConsumo(slug: string, mes: string, opcoes: { envios?: boolean } = {}): Promise<PainelConsumo> {
  const ant = mesAnterior(mes);
  const comEnvios = opcoes.envios !== false;
  const [conta, geral, snap, docAnt, docMes, creditos, cobrancas] = await Promise.all([
    contaDoNegocio(slug),
    lerConfigMensagens(),
    // por data (o mesmo campo no filtro e na ordem: sem índice composto), os mais recentes primeiro
    comEnvios
      ? adminDb.collection(`tenants/${slug}/envios`).where("em", ">=", inicioDoMes(mes)).where("em", "<", inicioDoMes(mesSeguinte(mes))).orderBy("em", "desc").limit(TETO_ENVIOS).get()
      : null,
    adminDb.doc(`tenants/${slug}/consumo/${ant}`).get(),
    adminDb.doc(`tenants/${slug}/consumo/${mes}`).get(),
    extratoDoNegocio(slug),
    listarCobrancas(adminDb, slug),
  ]);
  const docs = snap?.docs ?? [];

  // o nome do cliente e o serviço vêm do agendamento (o envio não guarda nome nem telefone)
  const ids = [...new Set(docs.map((d) => d.get("agendamentoId")).filter((x): x is string => typeof x === "string" && /^[A-Za-z0-9]{1,40}$/.test(x)))].slice(0, TETO_AGENDAMENTOS);
  const ags = ids.length ? await adminDb.getAll(...ids.map((id) => adminDb.doc(`tenants/${slug}/appointments/${id}`)), { fieldMask: ["customerName", "serviceName", "start"] }) : [];
  const agenda = new Map(
    ags.filter((a) => a.exists).map((a) => [a.id, { cliente: nomeCurto(String(a.get("customerName") ?? "")), servico: String(a.get("serviceName") ?? ""), inicio: ms(a.get("start")) ?? 0 }]),
  );

  const envios: EnvioTela[] = docs.map((d) => ({
    id: d.id,
    em: ms(d.get("em")) ?? 0,
    canal: d.get("canal") === "sms" ? "sms" : "whatsapp",
    via: d.get("via") === "salao" ? "salao" : "oficial",
    tipo: (d.get("tipo") as TipoEnvio) ?? "outro",
    destino: String(d.get("destino") ?? ""),
    destinatario: d.get("destinatario") === "dono" ? "dono" : "cliente",
    status: (d.get("status") as StatusEnvio) ?? "aceito",
    erro: typeof d.get("erro") === "string" ? (d.get("erro") as string) : null,
    custoCents: Number(d.get("custoCents") ?? 0),
    statusEm: ms(d.get("statusEm")),
    agendamento: agenda.get(String(d.get("agendamentoId") ?? "")) ?? null,
  }));

  const ultima = creditos.find((c) => c.tipo === "recarga" || c.tipo === "boas-vindas");
  return {
    mes,
    hoje: dateIn(new Date()),
    conta: { ...conta, ultimaRecarga: ultima ? { valorCents: ultima.valorCents, em: ultima.em, saldoAposCents: ultima.saldoAposCents } : null },
    pacotes: geral.pacotes.filter((p) => p.ativo).sort((a, b) => a.valorCents - b.valorCents),
    envios,
    truncado: (snap?.size ?? 0) >= TETO_ENVIOS,
    doMes: { total: Number(docMes.get("total") ?? 0), custoCents: Number(docMes.get("custoCents") ?? 0) },
    anterior: { mes: ant, total: Number(docAnt.get("total") ?? 0), custoCents: Number(docAnt.get("custoCents") ?? 0) },
    creditos,
    recargasAbertas: cobrancas
      .filter((c) => c.tipo === "recarga" && c.status === "aberta" && c.vencimento >= dateIn(new Date()))
      .map((c) => ({ id: c.id, valorCents: c.valorCents, vencimento: c.vencimento })),
  };
}

/** Faixa do painel: só o que precisa para avisar saldo baixo (uma leitura). */
export async function resumoDoSaldo(slug: string) {
  const c = await contaDoNegocio(slug);
  if (!c.aberta || !c.cobrar || c.modelo !== "prepago") return null;
  return { saldoCents: c.saldoCents!, nivel: c.previsao?.nivel ?? (c.saldoCents! <= 0 ? "critico" : "ok"), dias: c.previsao?.diasRestantesEstimados ?? null, semSaldo: c.semSaldo };
}

/** Saldo de cada negócio com conta aberta, para o Ajustes do /admin (sob demanda: lê um doc por negócio). */
export async function saldosDosNegocios() {
  const tenants = await adminDb.collection("tenants").select("name").get();
  const contas = tenants.size ? await adminDb.getAll(...tenants.docs.map((t) => adminDb.doc(`tenants/${t.id}/privado/mensagens`))) : [];
  const mes = dateIn(new Date()).slice(0, 7);
  const abertas = tenants.docs.map((t, i) => ({ t, c: contas[i] })).filter(({ c }) => c.exists && (typeof c.get("saldoCents") === "number" || c.get("cobrar") === false));
  const consumos = abertas.length ? await adminDb.getAll(...abertas.map(({ t }) => adminDb.doc(`tenants/${t.id}/consumo/${mes}`)), { fieldMask: ["custoCents", "total"] }) : [];
  return abertas
    .map(({ t, c }, i) => ({
      slug: t.id,
      nome: String(t.get("name") ?? t.id),
      saldoCents: typeof c.get("saldoCents") === "number" ? (c.get("saldoCents") as number) : null,
      cobrar: typeof c.get("cobrar") === "boolean" ? (c.get("cobrar") as boolean) : null,
      nivel: ((c.get("previsao") as Previsao | undefined)?.nivel ?? "ok") as Previsao["nivel"],
      avisadoEm: ms(c.get("avisadoSaldoBaixoEm")),
      mesCents: Number(consumos[i]?.get("custoCents") ?? 0),
      mesTotal: Number(consumos[i]?.get("total") ?? 0),
    }))
    .sort((a, b) => (a.saldoCents ?? Infinity) - (b.saldoCents ?? Infinity));
}

