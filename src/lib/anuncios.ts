import type { Utm } from "@/lib/crm-tipos";

// Medição dos anúncios, no navegador. A landing (HTML estático em public/sobre) faz o
// mesmo em JS puro: guarda os utm_* de quem chega e carrega o Pixel. Aqui é o lado do
// app, para o anúncio que aponta direto para o cadastro e para a conversão final.

const CHAVE = "ruphus:utm";
// um anúncio visto há mais de um mês não é mais o que trouxe a pessoa
const VALIDADE = 30 * 86_400_000;
const CAMPOS = ["source", "medium", "campaign", "content", "term"] as const;

/** Guarda os utm_* do endereço atual, se houver. O último anúncio vale. */
export function guardarUtm(busca: string) {
  const p = new URLSearchParams(busca);
  const utm: Utm = {};
  for (const c of CAMPOS) {
    const v = p.get(`utm_${c}`)?.trim();
    if (v) utm[c] = v.slice(0, 100);
  }
  if (!Object.keys(utm).length) return;
  try {
    localStorage.setItem(CHAVE, JSON.stringify({ ...utm, em: Date.now() }));
  } catch {
    // navegação privada sem armazenamento: o cadastro segue sem a origem
  }
}

/** O anúncio que trouxe a pessoa, se ainda vale. */
export function lerUtm(): Utm | null {
  try {
    const { em, ...utm } = JSON.parse(localStorage.getItem(CHAVE) ?? "null") ?? {};
    return typeof em === "number" && Date.now() - em < VALIDADE ? (utm as Utm) : null;
  } catch {
    return null;
  }
}

type Fbq = ((...args: unknown[]) => void) & { callMethod?: (...a: unknown[]) => void; queue: unknown[]; loaded: boolean; version: string; push: unknown };

/** Registra um evento no Pixel da Meta, se houver um cadastrado nos Ajustes do /admin.
 *  Sem Pixel, ou com bloqueador de anúncios, não faz nada. */
export async function pixel(evento: string) {
  const w = window as unknown as { fbq?: Fbq; _fbq?: Fbq };
  if (!w.fbq) {
    const { metaPixel } = (await fetch("/api/marketing").then((r) => (r.ok ? r.json() : {})).catch(() => ({}))) as { metaPixel?: string };
    if (!/^\d{10,20}$/.test(metaPixel ?? "")) return;
    // o carregador oficial da Meta, reescrito: fila os eventos até o script chegar
    const f = ((...args: unknown[]) => (f.callMethod ? f.callMethod(...args) : f.queue.push(args))) as Fbq;
    Object.assign(f, { queue: [], loaded: true, version: "2.0", push: f });
    w.fbq = w._fbq = f;
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://connect.facebook.net/en_US/fbevents.js";
    document.head.appendChild(s);
    f("init", metaPixel);
  }
  w.fbq!("track", evento);
}
