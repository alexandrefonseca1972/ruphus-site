import "server-only";
import type { Firestore, Timestamp } from "firebase-admin/firestore";
import { classificar, DIAS_PARA_VENCER, type Passos, type Saude, type SituacaoCobranca } from "@/lib/saude";

const DIA = 86_400_000;

export type ClienteSaude = {
  slug: string;
  passos: Passos;
  detalhes: { convite: string | null; servicos: number; profissionais: number; primeiro: string | null };
  agendamentos30: number;
  /** Agendamentos de cada uma das últimas 4 semanas, da mais antiga à atual */
  semanas: number[];
  ultimoAgendamento: string | null;
  clienteDesde: string | null;
  cobranca: SituacaoCobranca;
  diasParaVencer: number | null;
  saude: Saude;
  motivo: string;
};

const ms = (v: unknown) => (v as Timestamp | undefined)?.toMillis?.() ?? null;

/** Implantação, uso e cobrança de um cliente, lidos de onde já moram. */
export async function saudeDe(db: Firestore, slug: string, hoje: string, agora = Date.now()): Promise<ClienteSaude> {
  const t = db.collection("tenants").doc(slug);
  const desde30 = new Date(agora - 30 * DIA);
  const [membros, admins, servicos, staff, primeiro, recentes, ultimos, cobrancas, crm] = await Promise.all([
    t.collection("members").where("role", "in", ["admin", "owner"]).get(),
    db.doc("config/admin").get(),
    t.collection("services").where("active", "==", true).count().get(),
    t.collection("staff").where("active", "==", true).count().get(),
    t.collection("appointments").orderBy("createdAt").limit(1).get(),
    t.collection("appointments").where("start", ">=", desde30).get(),
    t.collection("appointments").where("start", "<=", new Date(agora)).orderBy("start", "desc").limit(10).get(),
    db.collection("cobrancas").where("slug", "==", slug).where("status", "==", "aberta").get(),
    db.collection("crm").doc(slug).get(),
  ]);

  // O dono é quem entrou pelo convite (sites importados) ou quem criou o próprio negócio;
  // o admin da plataforma, dono dos importados, não conta
  const daPlataforma = new Set((admins.get("uids") as string[] | undefined) ?? []);
  const donos = membros.docs.filter((d) => !daPlataforma.has(d.id));
  const dono = donos.find((d) => d.get("role") === "admin") ?? donos[0];
  const validos = recentes.docs.filter((d) => d.get("status") !== "cancelled");
  const semanas = [0, 0, 0, 0];
  for (const d of validos) {
    const quando = ms(d.get("start"));
    if (quando === null || quando > agora) continue;
    const semana = 3 - Math.floor((agora - quando) / (7 * DIA));
    if (semana >= 0) semanas[semana]++;
  }
  // cancelado não é uso: o último que conta é o último que não foi cancelado
  const ultimoMs = ms(ultimos.docs.find((d) => d.get("status") !== "cancelled")?.get("start"));
  const vencimentos = cobrancas.docs.map((d) => String(d.get("vencimento"))).sort();
  const proxima = vencimentos[0] ?? null;
  const dias = proxima ? Math.round((Date.parse(`${proxima}T12:00:00Z`) - Date.parse(`${hoje}T12:00:00Z`)) / DIA) : null;
  const cobranca: SituacaoCobranca = dias === null ? "sem" : dias < 0 ? "atrasada" : dias <= DIAS_PARA_VENCER ? "vence" : "em_dia";

  const nServicos = servicos.data().count;
  const nStaff = staff.data().count;
  const primeiroMs = ms(primeiro.docs[0]?.get("createdAt"));
  const passos: Passos = { convite: !!dono, servicos: nServicos > 0, profissionais: nStaff > 0, agendamento: primeiroMs !== null };
  const clienteDesdeMs = ms(crm.get("fechadoEm"));
  const { saude, motivo } = classificar({ passos, ultimoAgendamentoMs: ultimoMs, clienteDesdeMs, cobranca, diasParaVencer: dias, agora });
  const iso = (x: number | null) => (x === null ? null : new Date(x).toISOString());

  return {
    slug,
    passos,
    detalhes: {
      convite: (dono?.get("nome") as string | undefined) ?? (dono?.get("email") as string | undefined) ?? null,
      servicos: nServicos,
      profissionais: nStaff,
      primeiro: iso(primeiroMs),
    },
    agendamentos30: validos.filter((d) => (ms(d.get("start")) ?? Infinity) <= agora).length,
    semanas,
    ultimoAgendamento: iso(ultimoMs),
    clienteDesde: iso(clienteDesdeMs),
    cobranca,
    diasParaVencer: dias,
    saude,
    motivo,
  };
}
