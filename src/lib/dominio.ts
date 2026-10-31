// Domínio próprio do site do cliente (ex.: www.salaodaana.com.br). Código puro: roda no
// proxy, no servidor, no navegador e nos testes.
//
// O cliente mantém o domínio no nome dele e aponta o DNS para a Vercel; a Ruphus
// cadastra o endereço no /admin. Ativo (DNS conferido), o site responde nele, a raiz
// leva ao www, e {slug}.ruphus.site passa a redirecionar para lá.

/** Domínio gravado no tenant (tenants/{slug}.dominio). Só o servidor grava. */
export type Dominio = { host: string; raiz: string | null; status: "pendente" | "ativo"; desde: number };

const HOSTNAME = /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** "https://WWW.Salao.com.br/" → "www.salao.com.br"; null se não for um domínio. */
export function normalizarHost(entrada: string): string | null {
  const h = entrada.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "").replace(/\.$/, "");
  if (!HOSTNAME.test(h)) return null;
  // os endereços da própria Ruphus não viram domínio de cliente
  if (h === "ruphus.site" || h.endsWith(".ruphus.site") || h.endsWith(".vercel.app")) return null;
  return h;
}

/** A raiz que acompanha o www: "www.salao.com.br" → "salao.com.br". Sem www, não há par. */
export const raizDe = (host: string) => (host.startsWith("www.") ? host.slice(4) : null);

/** O endereço do site, com barra no fim: o domínio próprio ativo, senão o subdomínio. */
export const urlDoSite = (slug: string, dominio?: Pick<Dominio, "host" | "status"> | null) =>
  dominio?.status === "ativo" ? `https://${dominio.host}/` : `https://${slug}.ruphus.site/`;

/** Domínios ativos, como o proxy recebe de /api/dominios: host → slug, e slug → host. */
export type MapaDominios = { hosts: Record<string, string>; porSlug: Record<string, string> };

/** O que o proxy faz com um host de fora da Ruphus: servir o site do slug, mandar para
 *  o host principal (raiz → www), ou nada (não é de cliente nenhum: segue o app). */
export function resolverDominio(host: string, mapa: MapaDominios): { slug: string } | { redirecionar: string } | null {
  const h = host.split(":")[0].toLowerCase();
  const slug = mapa.hosts[h];
  if (!slug) return null;
  const principal = mapa.porSlug[slug];
  return principal && principal !== h ? { redirecionar: principal } : { slug };
}
