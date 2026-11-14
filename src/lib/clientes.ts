import { canonicalBrMobile } from "@/lib/telefone";

/** Faixas de "sem vir há" oferecidas na lista de clientes. A maior manda na
 *  consulta: o Firestore devolve essa janela uma vez, e trocar de faixa é só
 *  recortar o que já está na memória. */
export const JANELAS = [
  { dias: 30, rotulo: "30 dias" },
  { dias: 60, rotulo: "60 dias" },
  { dias: 90, rotulo: "90 dias" },
  { dias: 180, rotulo: "6 meses" },
  { dias: 365, rotulo: "1 ano" },
] as const;

export const MAIOR_JANELA = Math.max(...JANELAS.map((j) => j.dias));
export const DIA_EM_MS = 86_400_000;

export type Visita = { customerKey: string; status: string; startMs: number };

/** Quem esteve no negócio de `desdeMs` para cá.
 *
 * Três decisões moram aqui, e nenhuma é óbvia:
 *
 * - conta o `start` do agendamento, não o `updatedAt` do cliente: este último é
 *   a data em que a pessoa *marcou*, e quem marcou há 70 dias para ontem esteve
 *   aqui ontem;
 * - cancelado e falta não são visita;
 * - horário futuro conta como ativo, porque essa pessoa está voltando e não
 *   deve entrar numa campanha de "sumidos".
 */
export function ativosDesde(visitas: readonly Visita[], desdeMs: number) {
  return new Set(
    visitas
      .filter((v) => v.startMs >= desdeMs && (v.status === "booked" || v.status === "confirmed"))
      .map((v) => v.customerKey),
  );
}

export type Resumo = { ultimaMs: number | null; visitas: number; gastoCents: number };

/** Por cliente: a última vez que esteve aqui, quantas vezes veio e quanto gastou.
 * Só o que já aconteceu e não foi cancelado nem falta — um horário futuro é
 * promessa, não visita (em `ativosDesde` ele conta por outro motivo). */
export function resumoPorCliente(visitas: readonly (Visita & { priceCents?: number })[], agoraMs: number) {
  const m = new Map<string, Resumo>();
  for (const v of visitas) {
    if (v.startMs > agoraMs || (v.status !== "booked" && v.status !== "confirmed")) continue;
    const r = m.get(v.customerKey) ?? { ultimaMs: null, visitas: 0, gastoCents: 0 };
    r.visitas++;
    r.gastoCents += v.priceCents ?? 0;
    r.ultimaMs = Math.max(r.ultimaMs ?? 0, v.startMs);
    m.set(v.customerKey, r);
  }
  return m;
}

const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Dígitos da busca prontos para comparar com telefone gravado (55 + DDD + 9 + número):
 *  com DDD e sem o 9, ganha o 9, como o cadastro grava. Pedaço de número fica como veio. */
function digitosDaBusca(d: string) {
  if (d.length === 10) return canonicalBrMobile(`55${d}`).slice(2);
  if (d.length === 12 && d.startsWith("55")) return canonicalBrMobile(d);
  return d;
}

export type ClienteBuscavel = { id: string; name: string; email?: string; cpf?: string; telefoneContato?: string; etiquetas?: string[] };

/** A busca da lista de clientes: nome, e-mail e etiqueta por texto (sem acento nem maiúscula);
 *  celular, outro telefone e CPF por dígitos (com ou sem máscara, com ou sem o 9). */
export function casaBusca(c: ClienteBuscavel, busca: string) {
  const termo = semAcento(busca.trim());
  if (!termo) return true;
  if ([c.name, c.email ?? "", ...(c.etiquetas ?? [])].some((t) => semAcento(t).includes(termo))) return true;
  const d = busca.replace(/\D/g, "");
  // dígitos de verdade: "2" num nome com número não vira busca por telefone
  if (d.length < 3 || d.length < busca.replace(/[\s().+\-/]/g, "").length) return false;
  const alvo = digitosDaBusca(d);
  return [c.id, c.telefoneContato ?? ""].some((t) => t.includes(alvo) || t.includes(d)) || (!!c.cpf && c.cpf.includes(d));
}
