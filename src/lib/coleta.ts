// Coleta de leads no Google Maps: o que não depende do navegador. A ficha lida na
// página vira linha da planilha do gerador, separada em novo, conferir e fora
// conforme o que já está no sistema. O navegador fica em scripts/coleta-motor.mts;
// a fila (pedido no /admin, worker que coleta) em scripts/coletar.mts e admin/coleta.tsx.
import { norm } from "@/lib/dblocal";
import { lerPlanilha, type Lead as LeadGerador } from "@/lib/gerador";

export const UFS = {
  AC: "Acre", AL: "Alagoas", AP: "Amapá", AM: "Amazonas", BA: "Bahia", CE: "Ceará", DF: "Distrito Federal", ES: "Espírito Santo",
  GO: "Goiás", MA: "Maranhão", MT: "Mato Grosso", MS: "Mato Grosso do Sul", MG: "Minas Gerais", PA: "Pará", PB: "Paraíba",
  PR: "Paraná", PE: "Pernambuco", PI: "Piauí", RJ: "Rio de Janeiro", RN: "Rio Grande do Norte", RS: "Rio Grande do Sul",
  RO: "Rondônia", RR: "Roraima", SC: "Santa Catarina", SP: "São Paulo", SE: "Sergipe", TO: "Tocantins",
} as const;
export type Uf = keyof typeof UFS;

/** Capital de cada estado, com a grafia do IBGE: aparece primeiro e destacada na escolha de cidades. */
export const CAPITAIS: Record<Uf, string> = {
  AC: "Rio Branco", AL: "Maceió", AP: "Macapá", AM: "Manaus", BA: "Salvador", CE: "Fortaleza", DF: "Brasília", ES: "Vitória",
  GO: "Goiânia", MA: "São Luís", MT: "Cuiabá", MS: "Campo Grande", MG: "Belo Horizonte", PA: "Belém", PB: "João Pessoa",
  PR: "Curitiba", PE: "Recife", PI: "Teresina", RJ: "Rio de Janeiro", RN: "Natal", RS: "Porto Alegre", RO: "Porto Velho",
  RR: "Boa Vista", SC: "Florianópolis", SP: "São Paulo", SE: "Aracaju", TO: "Palmas",
};

export const TERMOS_PADRAO = ["salão de beleza", "barbearia", "manicure", "estética", "sobrancelha"];
/** Limites do pedido, conferidos na tela e no servidor. Cada termo é uma busca por bairro:
 *  20 termos × 40 bairros já são 800 buscas (~3 h). */
export const LIMITES = { cidades: 50, bairros: 80, termos: 20 };

/** O que impede o pedido de entrar na fila, ou "" se está tudo certo. */
export function problemaNoPedido(p: { cidades: string[]; bairros: string[]; termos: string[] }) {
  if (!p.cidades.length) return "Escolha pelo menos uma cidade.";
  if (p.cidades.length > LIMITES.cidades) return `Escolha no máximo ${LIMITES.cidades} cidades por vez (são ${p.cidades.length}).`;
  if (p.cidades.length > 1 && p.bairros.length) return "Bairros valem para uma cidade só. Com várias, deixe em branco.";
  if (p.bairros.length > LIMITES.bairros) return `No máximo ${LIMITES.bairros} bairros (são ${p.bairros.length}).`;
  if (p.termos.length > LIMITES.termos) return `No máximo ${LIMITES.termos} termos (são ${p.termos.length}). Tire alguns para a coleta não levar o dia todo.`;
  const curto = [...p.bairros, ...p.termos].find((x) => x.length < 2);
  if (curto !== undefined) return `"${curto}" é curto demais: use pelo menos 2 letras.`;
  const longo = p.termos.find((t) => t.length > 40) ?? p.bairros.find((b) => b.length > 60);
  if (longo) return `"${longo.slice(0, 30)}…" é longo demais. Separe os termos por vírgula ou um por linha.`;
  return "";
}

/** Pedido de coleta na fila (coleção coletas). O worker muda o estado; o admin cria, cancela e gera. */
export type EstadoColeta = "fila" | "coletando" | "pronta" | "gerando" | "concluida" | "erro" | "cancelada";
export type Progresso = { etapa: string; feitas: number; total: number; lugares: number; fichas: number; falhas: number };
export type Resumo = { novos: number; conferir: number; fora: number; motivos: Record<string, number> };

/** O que o script da página devolve de cada ficha do Maps (FICHA_JS). */
export type Ficha = {
  nome: string; categoria: string; telefone: string; endereco: string; site: string;
  nota: string; avaliacoes: string; fechado: boolean; link_maps: string;
};

export type Lead = {
  nome: string; telefone: string; categoria: string; endereco: string; bairro: string; cidade: string; uf: string;
  nota: string; avaliacoes: string; instagram: string; horario: string; link_maps: string;
};

/** Colunas na ordem que o gerador lê (src/lib/gerador.ts, COLUNAS). */
export const COLUNAS: (keyof Lead)[] = ["nome", "telefone", "categoria", "endereco", "bairro", "cidade", "uf", "nota", "avaliacoes", "instagram", "horario", "link_maps"];

/** Lido dentro da página da ficha; devolve JSON (o eval do agent-browser serializa string). */
export const FICHA_JS = `JSON.stringify((() => {
  const t = (s) => document.querySelector(s)?.innerText?.trim() ?? "";
  const a = (s, at) => document.querySelector(s)?.getAttribute(at) ?? "";
  const nota = document.querySelector('div.F7nice span[aria-hidden="true"]')?.innerText ?? "";
  const aval = ([...document.querySelectorAll("[aria-label]")].map(e => e.getAttribute("aria-label")).find(l => /^[\\d.]+ avalia/.test(l)) ?? "").replace(/\\D/g, "");
  return {
    nome: t("h1"),
    categoria: t('button[jsaction*="category"]'),
    telefone: (a('button[data-item-id^="phone:tel:"]', "data-item-id") || "").replace("phone:tel:", ""),
    endereco: (a('button[data-item-id="address"]', "aria-label") || "").replace(/^Endereço:\\s*/, ""),
    site: a('a[data-item-id="authority"]', "href"),
    nota, avaliacoes: aval,
    fechado: /fechado permanentemente|fechado temporariamente/i.test(document.body.innerText.slice(0, 3000)),
  };
})())`;

/** Links das fichas na lista de resultados da busca. */
export const LINKS_JS = `JSON.stringify([...new Set([...document.querySelectorAll('div[role=feed] a[href*="/maps/place/"]')].map(a => a.href))])`;
export const ROLAR_JS = `{ const f = document.querySelector("div[role=feed]"); if (f) f.scrollBy(0, 5000); true }`;

/** Identificador estável do lugar no link do Maps ("1s0x…:0x…"); o resto do link muda a cada busca. */
export const placeId = (link: string) => /1s(0x[0-9a-f]+:0x[0-9a-f]+)/.exec(link)?.[1] ?? null;

/** O mesmo celular aparece com e sem o 9 e com e sem 55/DDD: os 8 últimos dígitos identificam. */
export const fim8 = (t: unknown) => String(t ?? "").replace(/\D/g, "").slice(-8);

export function fichaParaLead(f: Ficha, padrao: { cidade: string; uf: string }): Lead {
  // "0XX…" de operadora, "+55…": fica DDD + número
  const d = f.telefone.replace(/\D/g, "").replace(/^0+/, "").replace(/^55(?=\d{10,11}$)/, "");
  // "Rua X, 10 - Bairro, Cidade - UF, 00000-000"; sem "- Bairro" ("Rua Y, São Cristóvão - SE, …")
  // ainda dá para tirar cidade e UF do fim, senão viraria a cidade da coleta
  const m = /-\s*([^,-]+),\s*([^,]+?)\s*-\s*([A-Z]{2})\b/.exec(f.endereco);
  const fim = m ? null : /,\s*([^,]+?)\s*-\s*([A-Z]{2}),?\s*[\d-]*\s*$/.exec(f.endereco);
  return {
    nome: f.nome.trim(),
    telefone: d.length === 10 || d.length === 11 ? `55${d}` : "",
    categoria: f.categoria,
    endereco: f.endereco.trim(),
    bairro: m ? m[1].trim() : "",
    cidade: m ? m[2].trim() : fim ? fim[1].trim() : padrao.cidade,
    uf: m ? m[3] : fim ? fim[2] : padrao.uf,
    nota: f.nota.replace(",", "."),
    avaliacoes: f.avaliacoes,
    instagram: /instagram\.com\/([A-Za-z0-9._]{1,30})/.exec(f.site)?.[1] ?? "",
    horario: "",
    link_maps: f.link_maps.split("?")[0],
  };
}

/** Telefones (8 últimos dígitos) e nome+cidade de tudo que já está no sistema. */
export type Base = { tel: Map<string, string>; nomeCidade: Map<string, string> };

export function montarBase(linhas: { nome: unknown; telefone: unknown; cidade: unknown; origem: string }[]): Base {
  const base: Base = { tel: new Map(), nomeCidade: new Map() };
  for (const l of linhas) {
    const quem = `${l.nome} (${l.origem})`;
    if (fim8(l.telefone)) base.tel.set(fim8(l.telefone), base.tel.get(fim8(l.telefone)) ?? quem);
    const chave = `${norm(l.nome)}|${norm(l.cidade)}`;
    base.nomeCidade.set(chave, base.nomeCidade.get(chave) ?? quem);
  }
  return base;
}

export type Separacao = { novos: Lead[]; conferir: (Lead & { motivo: string })[]; fora: (Lead & { motivo: string })[] };

/** O mesmo lugar aparece em várias buscas: fica a primeira ficha de cada telefone (ou nome, sem telefone). */
export function separar(fichas: Ficha[], base: Base, padrao: { cidade: string; uf: string }): Separacao {
  const s: Separacao = { novos: [], conferir: [], fora: [] };
  const vistos = new Set<string>();
  for (const f of fichas) {
    if (!f.nome?.trim()) continue;
    const l = fichaParaLead(f, padrao);
    const chave = fim8(l.telefone) || norm(l.nome);
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    const mesmoNome = base.nomeCidade.get(`${norm(l.nome)}|${norm(l.cidade)}`);
    if (f.fechado) s.fora.push({ ...l, motivo: "fechado no Maps" });
    else if (!l.telefone) s.fora.push({ ...l, motivo: "sem telefone no Maps" });
    // "***" e afins: nome sem letra nem número não vira endereço de site
    else if (!/[\p{L}\d]/u.test(l.nome)) s.fora.push({ ...l, motivo: "nome sem letras no Maps" });
    else if (base.tel.has(fim8(l.telefone))) s.fora.push({ ...l, motivo: `já temos: ${base.tel.get(fim8(l.telefone))}` });
    else if (mesmoNome) s.conferir.push({ ...l, motivo: `mesmo nome e cidade: ${mesmoNome}` });
    else s.novos.push(l);
  }
  return s;
}

/** Bairros da cidade nas fichas já lidas, do mais citado ao menos: sem lista de bairros, a
 *  busca na cidade toda mostra onde há comércio de beleza, e a segunda volta busca bairro a
 *  bairro. Bairro citado uma vez só costuma ser erro de cadastro ou nome de condomínio. */
export function bairrosDe(fichas: Ficha[], padrao: { cidade: string; uf: string }, max = 40) {
  const n = new Map<string, { nome: string; vezes: number }>();
  for (const f of fichas) {
    if (!f.nome?.trim()) continue;
    const { bairro, cidade } = fichaParaLead(f, padrao);
    if (!bairro || norm(cidade) !== norm(padrao.cidade)) continue;
    const b = n.get(norm(bairro)) ?? { nome: bairro, vezes: 0 };
    b.vezes++;
    n.set(norm(bairro), b);
  }
  return [...n.values()].filter((b) => b.vezes >= 2).sort((a, b) => b.vezes - a.vezes).slice(0, max).map((b) => b.nome);
}

/** O gerador aceita no máximo 300 linhas por planilha. */
export const lotes = <T>(xs: T[], n = 300) => Array.from({ length: Math.max(1, Math.ceil(xs.length / n)) }, (_, i) => xs.slice(i * n, i * n + n));

/** Abas de uma planilha: Leads com cabeçalho "nome" (o gerador lê); conferir e fora com
 *  "Lead" no lugar, porque o gerador lê toda aba que tem coluna "nome". */
export function abas(novos: Lead[], conferir?: Separacao["conferir"], fora?: Separacao["fora"]) {
  const tabela = (linhas: Partial<Record<string, string>>[], extra: string[], titulo: string) =>
    [[titulo, ...COLUNAS.slice(1), ...extra], ...linhas.map((l) => [...COLUNAS, ...extra].map((c) => l[c] || null))];
  return [
    { sheet: "Leads", data: tabela(novos, [], "nome") },
    ...(conferir ? [{ sheet: "conferir", data: tabela(conferir, ["motivo"], "Lead") }] : []),
    ...(fora ? [{ sheet: "fora", data: tabela(fora, ["motivo"], "Lead") }] : []),
  ];
}

/** Os novos passam pela mesma leitura de uma planilha enviada ao Gerador (nicho, nome longo,
 *  telefone com cara de inventado…): o que ela recusa vai para fora, com o motivo dela. */
export function paraGerador(sep: Separacao) {
  const [aba] = abas(sep.novos);
  const { leads, erros } = lerPlanilha([{ aba: aba.sheet, linhas: aba.data }]);
  const recusa = new Map(erros.map((e) => [e.linha - 2, e.motivo])); // linha 2 do Excel é o 1º lead
  return {
    novos: leads.map(({ linha, lead }) => ({ lead, link_maps: sep.novos[linha - 2].link_maps })) as { lead: LeadGerador; link_maps: string }[],
    conferir: sep.conferir,
    fora: [...sep.fora, ...sep.novos.flatMap((l, i) => (recusa.has(i) ? [{ ...l, motivo: `gerador: ${recusa.get(i)}` }] : []))],
  };
}

/** "já temos: Fulano (site x)" e "gerador: Não reconheci o nicho (…)" contam juntos no resumo. */
export const motivoCurto = (m: string) => m.replace(/^gerador: /, "").replace(/[:(“].*/, "").replace(/ em\s*$/, "").trim();
