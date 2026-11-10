import "server-only";
import { resolve4 } from "node:dns/promises";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { ErroPrevisto } from "@/lib/erro-previsto";
import { type Dominio, type MapaDominios, normalizarHost, raizDe } from "@/lib/dominio";

// O cliente aponta o DNS do domínio direto para o IP da VPS (DOMINIO_IP), e o Caddy emite o
// certificado na primeira visita (on-demand TLS, que pergunta a /api/dominios/tls se o domínio
// é de algum site). Não há cadastro em serviço de fora: conectar só grava no tenant.
function ipDaVps() {
  const ip = process.env.DOMINIO_IP;
  if (!ip) throw new ErroPrevisto("Domínio próprio não configurado: defina DOMINIO_IP (o IP da VPS) no ambiente.");
  return ip;
}

/** O registro DNS que o cliente cria no registro.br (ou onde o domínio estiver). */
export type RegistroDns = { tipo: "CNAME" | "A" | "TXT"; nome: string; valor: string };
export type SituacaoDominio = { dominio: Dominio; pronto: boolean; registros: RegistroDns[] };

/** O DNS aponta só para a VPS? Se não, o registro A que falta criar. */
async function conferir(nome: string, ehRaiz = false): Promise<{ pronto: boolean; registros: RegistroDns[] }> {
  const ip = ipDaVps();
  // todos os A no IP da VPS: um A antigo esquecido mandaria parte das visitas para outro lugar
  const ips = await resolve4(nome).catch(() => [] as string[]);
  const pronto = ips.length > 0 && ips.every((i) => i === ip);
  const rotulo = ehRaiz ? "@" : nome.startsWith("www.") ? "www" : nome;
  return { pronto, registros: pronto ? [] : [{ tipo: "A", nome: rotulo, valor: ip }] };
}

/** Liga o domínio ao site: grava pendente (a raiz redireciona ao www). */
export async function conectarDominio(db: Firestore, slug: string, entrada: string): Promise<Dominio> {
  const host = normalizarHost(entrada);
  if (!host) throw new ErroPrevisto("Endereço inválido. Use algo como www.salaodaana.com.br.");
  const raiz = raizDe(host);
  const t = db.doc(`tenants/${slug}`);
  // o host e a raiz não podem ser nem o host nem a raiz de outro negócio: o mapa do proxy junta
  // os dois em hosts{}, e um sobrescreveria o outro. limit(2): o próprio negócio pode aparecer
  const tenants = db.collection("tenants");
  const com = (campo: string, valor: string) => tenants.where(campo, "==", valor).limit(2).get();
  const [tenant, ...achados] = await Promise.all([
    t.get(),
    com("dominio.host", host),
    com("dominio.raiz", host),
    ...(raiz ? [com("dominio.host", raiz), com("dominio.raiz", raiz)] : []),
  ]);
  if (!tenant.exists) throw new ErroPrevisto("Negócio não encontrado.");
  if (!tenant.get("gerado.publicadoEm")) throw new ErroPrevisto("O domínio próprio é do site publicado: dê baixa na entrada antes.");
  const outro = achados.flatMap((q) => q.docs).find((d) => d.id !== slug);
  if (outro) throw new ErroPrevisto(`${host} já está ligado a outro negócio (${outro.id}).`);
  ipDaVps();
  const dominio: Dominio = { host, raiz, status: "pendente", desde: Date.now() };
  await t.update({ dominio });
  return dominio;
}

/** Confere o DNS; tudo certo, o domínio vira ativo (e o proxy passa a usá-lo em até 1 min). */
export async function verificarDominio(db: Firestore, slug: string): Promise<SituacaoDominio> {
  const t = db.doc(`tenants/${slug}`);
  const dominio = (await t.get()).get("dominio") as Dominio | undefined;
  if (!dominio) throw new ErroPrevisto("Nenhum domínio ligado a este site.");
  const [principal, daRaiz] = await Promise.all([
    conferir(dominio.host),
    dominio.raiz ? conferir(dominio.raiz, true) : Promise.resolve({ pronto: true, registros: [] as RegistroDns[] }),
  ]);
  // o www basta para ativar: a raiz é conveniência, e o site já abre pelo endereço que se divulga
  const status = principal.pronto ? "ativo" : "pendente";
  const atual = { ...dominio, status } satisfies Dominio;
  if (status !== dominio.status) await t.update({ "dominio.status": status });
  return { dominio: atual, pronto: principal.pronto && daRaiz.pronto, registros: [...principal.registros, ...daRaiz.registros] };
}

/** Solta o domínio: sai do tenant (o Caddy para de emitir certificado); o site volta a {slug}.ruphus.site. */
export async function desconectarDominio(db: Firestore, slug: string) {
  const t = db.doc(`tenants/${slug}`);
  const dominio = (await t.get()).get("dominio") as Dominio | undefined;
  if (!dominio) return;
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

/** Uma vez por dia (cron de lembretes, 4h): domínio ativo cujo DNS saiu da VPS volta a pendente,
 *  e o proxy para de mandar o subdomínio para ele. Só decide com resposta do DNS (ou "não existe",
 *  domínio expirado): timeout e SERVFAIL ficam para o dia seguinte, sem rebaixar.
 *  Devolve quantos voltaram a pendente. */
export async function reverificarDominios(db: Firestore) {
  const snap = await db.collection("tenants").where("dominio.status", "==", "ativo").select("dominio").get();
  let rebaixados = 0;
  for (const d of snap.docs) {
    const host = (d.get("dominio") as Dominio).host;
    const decidivel = await resolve4(host).then(() => true, (e: { code?: string }) => e?.code === "ENOTFOUND" || e?.code === "ENODATA");
    if (!decidivel) continue;
    const r = await verificarDominio(db, d.id).catch((e) => (console.error(`[dominio] reverificar ${d.id}`, e), null));
    if (r?.dominio.status === "pendente") {
      rebaixados++;
      console.warn(`[dominio] ${host} (${d.id}) não aponta mais para a VPS: voltou a pendente`);
    }
  }
  return rebaixados;
}
