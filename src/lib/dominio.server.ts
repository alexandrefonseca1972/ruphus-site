import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { ErroPrevisto } from "@/lib/erro-previsto";
import { type Dominio, type MapaDominios, normalizarHost, raizDe } from "@/lib/dominio";

// O domínio do cliente entra no projeto da Vercel pela API REST: é lá que ele vira
// endereço do app e ganha certificado. VERCEL_TOKEN (token da conta, escopo do time)
// e VERCEL_PROJECT_ID ficam só no servidor; VERCEL_TEAM_ID quando o projeto é de time.
const API = "https://api.vercel.com";

function credenciais() {
  const token = process.env.VERCEL_TOKEN;
  const projeto = process.env.VERCEL_PROJECT_ID;
  if (!token || !projeto) throw new ErroPrevisto("Domínio próprio não configurado: faltam VERCEL_TOKEN e VERCEL_PROJECT_ID no ambiente.");
  return { token, projeto: encodeURIComponent(projeto) };
}

async function vercel<T>(metodo: string, caminho: string, corpo?: unknown): Promise<{ status: number; dados: T }> {
  const { token } = credenciais();
  const url = new URL(caminho, API);
  if (process.env.VERCEL_TEAM_ID) url.searchParams.set("teamId", process.env.VERCEL_TEAM_ID);
  const r = await fetch(url, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, ...(corpo !== undefined && { "Content-Type": "application/json" }) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const dados = (await r.json().catch(() => ({}))) as T;
  return { status: r.status, dados };
}

type DominioVercel = { name: string; apexName?: string; verified: boolean; verification?: { type: string; domain: string; value: string }[]; error?: { code: string; message: string } };
type ConfigVercel = { misconfigured: boolean; recommendedCNAME?: { rank: number; value: string }[]; recommendedIPv4?: { rank: number; value: string[] }[] };

/** O registro DNS que o cliente cria no registro.br (ou onde o domínio estiver). */
export type RegistroDns = { tipo: "CNAME" | "A" | "TXT"; nome: string; valor: string };
export type SituacaoDominio = { dominio: Dominio; pronto: boolean; registros: RegistroDns[] };

async function adicionar(nome: string, redirecionar?: string) {
  const { projeto } = credenciais();
  const r = await vercel<DominioVercel>("POST", `/v10/projects/${projeto}/domains`, { name: nome, ...(redirecionar && { redirect: redirecionar, redirectStatusCode: 308 }) });
  // já estar no projeto não é erro: conectar de novo só confere
  if (r.status >= 400 && r.dados.error?.code !== "domain_already_in_use_by_project" && r.status !== 409) {
    throw new ErroPrevisto(`A Vercel recusou ${nome}: ${r.dados.error?.message ?? r.status}`);
  }
}

async function remover(nome: string) {
  const { projeto } = credenciais();
  const r = await vercel<DominioVercel>("DELETE", `/v9/projects/${projeto}/domains/${encodeURIComponent(nome)}`);
  if (r.status >= 400 && r.status !== 404) throw new ErroPrevisto(`A Vercel não removeu ${nome}: ${r.dados.error?.message ?? r.status}`);
}

/** Verificado no projeto e com o DNS apontando certo; e, se não, o que criar no DNS. */
async function conferir(nome: string): Promise<{ pronto: boolean; registros: RegistroDns[] }> {
  const { projeto } = credenciais();
  const [d, c] = await Promise.all([
    vercel<DominioVercel>("GET", `/v9/projects/${projeto}/domains/${encodeURIComponent(nome)}`),
    vercel<ConfigVercel>("GET", `/v6/domains/${encodeURIComponent(nome)}/config?projectIdOrName=${projeto}`),
  ]);
  const registros: RegistroDns[] = [];
  // domínio já usado em outra conta da Vercel: prova de posse por TXT
  for (const v of d.dados.verification ?? []) registros.push({ tipo: v.type === "TXT" ? "TXT" : "CNAME", nome: v.domain, valor: v.value });
  if (c.dados.misconfigured) {
    const melhor = <T,>(l?: { rank: number; value: T }[]) => l?.slice().sort((a, b) => a.rank - b.rank)[0]?.value;
    // a raiz do domínio (apex) não aceita CNAME: vai registro A
    const raiz = (d.dados.apexName ?? "") === nome;
    if (raiz) registros.push(...(melhor(c.dados.recommendedIPv4) ?? ["76.76.21.21"]).map((ip) => ({ tipo: "A" as const, nome: "@", valor: ip })));
    else registros.push({ tipo: "CNAME", nome: d.dados.apexName ? nome.slice(0, -(d.dados.apexName.length + 1)) : nome, valor: (melhor(c.dados.recommendedCNAME) ?? "cname.vercel-dns.com.").replace(/\.$/, "") });
  }
  return { pronto: d.status === 200 && d.dados.verified && !c.dados.misconfigured, registros };
}

/** Liga o domínio ao site: grava pendente, cadastra na Vercel (a raiz redireciona ao www). */
export async function conectarDominio(db: Firestore, slug: string, entrada: string): Promise<Dominio> {
  const host = normalizarHost(entrada);
  if (!host) throw new ErroPrevisto("Endereço inválido. Use algo como www.salaodaana.com.br.");
  const t = db.doc(`tenants/${slug}`);
  const [tenant, outro] = await Promise.all([
    t.get(),
    db.collection("tenants").where("dominio.host", "==", host).limit(1).get(),
  ]);
  if (!tenant.exists) throw new ErroPrevisto("Negócio não encontrado.");
  if (!tenant.get("gerado.publicadoEm")) throw new ErroPrevisto("O domínio próprio é do site publicado: dê baixa na entrada antes.");
  if (!outro.empty && outro.docs[0].id !== slug) throw new ErroPrevisto(`${host} já está ligado a outro negócio (${outro.docs[0].id}).`);
  const raiz = raizDe(host);
  await adicionar(host);
  if (raiz) await adicionar(raiz, host);
  const dominio: Dominio = { host, raiz, status: "pendente", desde: Date.now() };
  await t.update({ dominio });
  return dominio;
}

/** Confere na Vercel; tudo certo, o domínio vira ativo (e o proxy passa a usá-lo em até 1 min). */
export async function verificarDominio(db: Firestore, slug: string): Promise<SituacaoDominio> {
  const t = db.doc(`tenants/${slug}`);
  const dominio = (await t.get()).get("dominio") as Dominio | undefined;
  if (!dominio) throw new ErroPrevisto("Nenhum domínio ligado a este site.");
  const [principal, daRaiz] = await Promise.all([
    conferir(dominio.host),
    dominio.raiz ? conferir(dominio.raiz) : Promise.resolve({ pronto: true, registros: [] as RegistroDns[] }),
  ]);
  // o www basta para ativar: a raiz é conveniência, e o site já abre pelo endereço que se divulga
  const status = principal.pronto ? "ativo" : "pendente";
  const atual = { ...dominio, status } satisfies Dominio;
  if (status !== dominio.status) await t.update({ "dominio.status": status });
  return { dominio: atual, pronto: principal.pronto && daRaiz.pronto, registros: [...principal.registros, ...daRaiz.registros] };
}

/** Solta o domínio: sai da Vercel e do tenant; o site volta a {slug}.ruphus.site. */
export async function desconectarDominio(db: Firestore, slug: string) {
  const t = db.doc(`tenants/${slug}`);
  const dominio = (await t.get()).get("dominio") as Dominio | undefined;
  if (!dominio) return;
  if (dominio.raiz) await remover(dominio.raiz);
  await remover(dominio.host);
  await t.update({ dominio: FieldValue.delete() });
}

/** O mapa que o proxy consulta: só domínios ativos, de sites que não estão fora do ar. */
export async function mapaDominios(db: Firestore): Promise<MapaDominios> {
  const snap = await db.collection("tenants").where("dominio.status", "==", "ativo").select("dominio").get();
  const mapa: MapaDominios = { hosts: {}, porSlug: {} };
  for (const d of snap.docs) {
    const dom = d.get("dominio") as Dominio;
    mapa.porSlug[d.id] = dom.host;
    mapa.hosts[dom.host] = d.id;
    if (dom.raiz) mapa.hosts[dom.raiz] = d.id;
  }
  return mapa;
}
