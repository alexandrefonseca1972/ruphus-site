// Tempo da coleta na tela: cronômetro, ritmo medido e quanto falta. Código puro: a tela usa,
// os testes também. O ritmo vem do que o worker já fez (amostras a cada atualização), não de
// um palpite fixo: o Maps fica mais lento ou mais rápido conforme a cidade e a hora.
import type { Progresso } from "@/lib/coleta";

/** 754_000 → "12 min 34 s"; 3_905_000 → "1 h 05 min"; abaixo de 1 min, só os segundos. */
export function duracao(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const seg = s % 60;
  if (h) return `${h} h ${String(m).padStart(2, "0")} min`;
  if (m) return `${m} min ${String(seg).padStart(2, "0")} s`;
  return `${seg} s`;
}

export type Amostra = { t: number; etapa: string; feitas: number };

// janela do ritmo: o que aconteceu nos últimos minutos pesa mais que o começo da etapa
const JANELA_MS = 5 * 60_000;

/** Itens por segundo na etapa atual, das amostras dos últimos minutos; null sem base (menos
 *  de 20 s medidos, etapa recém-começada ou nada andou). */
export function ritmo(amostras: Amostra[], agora: number) {
  const ultima = amostras.at(-1);
  if (!ultima) return null;
  const daEtapa = amostras.filter((a) => a.etapa === ultima.etapa);
  // a mais antiga dentro da janela; se a etapa andou devagar (nada nos últimos minutos), a anterior
  const primeira = daEtapa.find((a) => a !== ultima && agora - a.t <= JANELA_MS) ?? daEtapa.at(-2);
  if (!primeira || ultima.t - primeira.t < 20_000 || ultima.feitas <= primeira.feitas) return null;
  return (ultima.feitas - primeira.feitas) / ((ultima.t - primeira.t) / 1000);
}

/** Guarda a amostra nova (sem repetir a mesma leitura) e esquece as antigas. */
export function anotar(amostras: Amostra[], p: Pick<Progresso, "etapa" | "feitas">, t: number) {
  const ultima = amostras.at(-1);
  if (ultima && ultima.etapa === p.etapa && ultima.feitas === p.feitas) return amostras;
  const recentes = amostras.filter((a) => t - a.t <= JANELA_MS);
  // sempre fica ao menos a anterior: uma etapa lenta (mais de 5 min por item) ainda tem ritmo
  const base = recentes.length ? recentes : ultima ? [ultima] : [];
  return [...base, { t, etapa: p.etapa, feitas: p.feitas }];
}

/** Segundos que faltam na etapa: pelo ritmo medido; sem ele, pelo palpite por item (ou null). */
export function faltam(p: Pick<Progresso, "feitas" | "total">, porSegundo: number | null, segPorItem?: number) {
  const resto = Math.max(0, p.total - p.feitas);
  if (!resto) return 0;
  if (porSegundo && porSegundo > 0) return Math.ceil(resto / porSegundo);
  return segPorItem ? resto * segPorItem : null;
}

/** 0–100, inteiro, sem passar de 100 nem dividir por zero. */
export const porcentagem = (p: Pick<Progresso, "feitas" | "total">) =>
  p.total > 0 ? Math.min(100, Math.max(0, Math.floor((p.feitas / p.total) * 100))) : 0;
