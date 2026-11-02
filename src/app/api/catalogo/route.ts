import { NextResponse } from "next/server";
import { adminDb } from "@/lib/admin";
import { desativados } from "@/lib/crm";
import { SUBS, type Sub } from "@/lib/gerador";

// O catálogo da landing (/sobre): os sites do gerador, no formato ({s, n, d, t, c}) da lista dela.
// São ~15 mil: a landing não baixa mais a lista inteira (eram 2,4 MB a cada visita). Sem `q`, vai
// o resumo — totais, cidades, a amostra da esteira e quem saiu do ar —; com `q`, só a página da
// busca. A lista mora na memória do processo e é relida a cada 6 h: cada releitura custa uma
// leitura por site.

type Item = { s: string; n: string; d: string; t: string; c: string };
type Catalogo = { em: number; lista: Item[]; chaves: string[]; fora: string[] };

const VALIDADE_MS = 6 * 3_600_000;
const LIMITE = 24;
const AMOSTRA = 40;

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

let atual: Catalogo | null = null;
let lendo: Promise<Catalogo> | null = null;

async function ler(): Promise<Catalogo> {
  const [snap, fora] = await Promise.all([
    adminDb.collection("tenants").where("gerado.sub", "!=", null).select("name", "site.city", "gerado.sub", "gerado.bairro").get(),
    desativados(adminDb).catch(() => [] as string[]),
  ]);
  const tirar = new Set(fora);
  const lista = snap.docs
    .filter((d) => !tirar.has(d.id))
    .map((d): Item => {
      const rotulo = SUBS[d.get("gerado.sub") as Sub]?.rotulo ?? "";
      const bairro = String(d.get("gerado.bairro") ?? "");
      return { s: d.id, n: String(d.get("name") ?? d.id), d: [rotulo, bairro].filter(Boolean).join(" · "), t: `/s/${d.id}/og.jpg`, c: String(d.get("site.city") ?? "") };
    });
  return { em: Date.now(), lista, chaves: lista.map((o) => norm(`${o.n} ${o.d} ${o.s} ${o.c}`)), fora };
}

/** A lista em memória; vencida, quem chega primeiro relê e os outros esperam a mesma leitura.
 *  Falhou a releitura: segue a anterior, se houver. */
async function catalogo() {
  if (atual && Date.now() - atual.em < VALIDADE_MS) return atual;
  lendo ??= ler()
    .then((c) => (atual = c))
    .finally(() => (lendo = null));
  return atual ? lendo.catch(() => atual!) : lendo;
}

function resumo(c: Catalogo) {
  const nichos = new Set<string>();
  const bairros = new Set<string>();
  const cidades = new Set<string>();
  for (const o of c.lista) {
    const [nicho, bairro] = o.d.split("·").map((x) => x.trim());
    if (nicho) nichos.add(nicho.toLowerCase());
    if (bairro) bairros.add(bairro.toLowerCase());
    if (o.c) cidades.add(o.c);
  }
  const passo = Math.max(1, Math.floor(c.lista.length / AMOSTRA));
  return {
    total: c.lista.length,
    cidades: [...cidades],
    nichos: nichos.size,
    bairros: bairros.size,
    // os nomes da esteira, espalhados pela lista para as cidades se misturarem
    amostra: c.lista.filter((_, i) => i % passo === 0).slice(0, AMOSTRA).map(({ n, d }) => ({ n, d })),
    // quem saiu do ar ou pediu remoção: a landing tira da vitrine que vem no HTML
    fora: c.fora,
  };
}

export async function GET(req: Request) {
  const c = await catalogo().catch(() => null);
  if (!c) return NextResponse.json({ erro: "indisponível" }, { status: 503, headers: { "cache-control": "no-store" } });
  const busca = new URL(req.url).searchParams.get("q")?.slice(0, 80) ?? "";
  const termos = norm(busca.trim()).split(/\s+/).filter(Boolean);
  if (!termos.length) return NextResponse.json(resumo(c), { headers: { "cache-control": "public, max-age=300, stale-while-revalidate=3600" } });
  const achados: (Item & { i: number })[] = [];
  let total = 0;
  c.chaves.forEach((k, i) => {
    if (!termos.every((t) => k.includes(t))) return;
    total++;
    if (achados.length < LIMITE) achados.push({ ...c.lista[i], i });
  });
  return NextResponse.json({ total, itens: achados }, { headers: { "cache-control": "public, max-age=60" } });
}
