// Gerador de sites: da planilha de leads ao HTML no padrão dos sites que já estão
// no ar. Código puro — roda no navegador (prévia da planilha) e no servidor (gravar
// e renderizar), sem banco nem "server-only".
import { z } from "zod";
import { normalizar, RUPHUS } from "@/lib/catalogo";
import { slugify, TenantInput } from "@/lib/tenant-input";

// ─── Planilha ────────────────────────────────────────────────────────────────

/** Nomes de coluna aceitos, já normalizados (sem acento, minúsculo, só letra e número).
 *  A planilha de cada um tem cabeçalho diferente; a gente se adapta a ela. */
const COLUNAS = {
  nome: ["nome", "empresa", "negocio", "estabelecimento", "razaosocial", "nomefantasia", "name", "title"],
  telefone: ["telefone", "whatsapp", "whats", "celular", "fone", "contato", "phone", "telefonewhatsapp"],
  categoria: ["categoria", "categorias", "nicho", "ramo", "segmento", "tipo", "category", "atividade"],
  endereco: ["endereco", "logradouro", "enderecocompleto", "address", "fulladdress", "rua"],
  bairro: ["bairro", "neighborhood"],
  cidade: ["cidade", "municipio", "city"],
  uf: ["uf", "estado", "state"],
  nota: ["nota", "notagoogle", "avaliacao", "rating", "estrelas"],
  avaliacoes: ["avaliacoes", "navaliacoes", "numeroavaliacoes", "numerodeavaliacoes", "totalavaliacoes", "qtdavaliacoes", "reviews"],
  instagram: ["instagram", "insta", "ig", "redesocial", "redesocialprincipal", "redesocialprincipalfrequencia"],
  horario: ["horario", "horarios", "funcionamento", "horariodefuncionamento", "workinghours"],
  servicos: ["servicos", "services"],
  email: ["email", "emaildodono", "emaildono"],
  slug: ["slug", "subdominio", "endereco do site"],
  // do levantamento do lead: vão para o funil, não para o site
  score: ["score", "pontuacao", "prioridade"],
  abordagem: ["ganchodeabordagemsugerido", "gancho", "abordagem", "observacao", "observacoes"],
} as const;
type Campo = keyof typeof COLUNAS;

const norm = (s: unknown) =>
  String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

const campoDe = (cabecalho: unknown): Campo | null => {
  const n = norm(cabecalho);
  return n ? ((Object.keys(COLUNAS) as Campo[]).find((c) => (COLUNAS[c] as readonly string[]).some((a) => norm(a) === n)) ?? null) : null;
};

export const Lead = z.object({
  nome: z.string().trim().min(2).max(80),
  telefone: z.string().regex(/^55\d{10,11}$/),
  categoria: z.string().max(80),
  endereco: z.string().max(160),
  bairro: z.string().max(60),
  cidade: z.string().max(60),
  uf: z.string().regex(/^([A-Z]{2})?$/),
  nota: z.number().min(0).max(5).nullable(),
  avaliacoes: z.number().int().min(0).nullable(),
  instagram: z.string().regex(/^([A-Za-z0-9._]{1,30})?$/),
  horario: z.string().max(120),
  servicos: z.array(z.string().trim().min(2).max(60)).max(8),
  email: z.union([z.email(), z.literal("")]),
  slug: z.string().max(63),
  score: z.string().max(40),
  abordagem: z.string().max(500),
});
export type Lead = z.infer<typeof Lead>;

export type Leitura = {
  leads: { aba: string; linha: number; lead: Lead }[];
  erros: { aba: string; linha: number; motivo: string }[];
  /** colunas da planilha que o gerador não usa: o admin vê e corrige o nome, se era para usar */
  ignoradas: string[];
};

const texto = (v: unknown) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
const numero = (v: unknown) => {
  const n = typeof v === "number" ? v : Number(texto(v).replace(",", "."));
  return texto(v) && Number.isFinite(n) ? n : null;
};
/** "@loja", "instagram.com/loja/", "loja" ou "Instagram @loja (10k) — ativa" viram "loja";
 *  texto sem perfil ("Facebook provável") vira vazio, não um Instagram inventado */
const perfil = (v: unknown) => {
  const s = texto(v);
  const achado = /instagram\.com\/([A-Za-z0-9._]{1,30})/i.exec(s) ?? /@([A-Za-z0-9._]{1,30})/.exec(s) ?? /^([A-Za-z0-9._]{1,30})$/.exec(s);
  return achado?.[1] ?? "";
};

/** As abas da planilha (como o read-excel-file entrega) viram leads. Aba sem
 *  cabeçalho (notas, metodologia) é pulada; o cabeçalho pode ter título em cima. */
export function lerPlanilha(abas: { aba: string; linhas: unknown[][] }[]): Leitura {
  const leads: Leitura["leads"] = [];
  const erros: Leitura["erros"] = [];
  const ignoradas = new Set<string>();
  // o mesmo negócio em duas abas (ou duas levas) é uma linha só
  const vistos = new Map<string, string>();
  let comCabecalho = 0;

  for (const { aba, linhas } of abas) {
    const topo = linhas.slice(0, 5).findIndex((l) => l.some((c) => campoDe(c) === "nome"));
    if (topo === -1) continue;
    comCabecalho++;
    const colunas = linhas[topo].map(campoDe);
    linhas[topo].forEach((c, i) => texto(c) && !colunas[i] && ignoradas.add(texto(c)));

    linhas.slice(topo + 1).forEach((l, i) => {
      const linha = topo + i + 2; // como o Excel numera
      if (!l.some((c) => texto(c))) return; // linha em branco não é erro
      const v = (c: Campo) => l[colunas.indexOf(c)];
      const telefone = normalizar(texto(v("telefone")));
      const bruto = {
        nome: texto(v("nome")),
        telefone,
        categoria: texto(v("categoria")),
        endereco: texto(v("endereco")),
        bairro: texto(v("bairro")),
        cidade: texto(v("cidade")),
        uf: texto(v("uf")).toUpperCase().slice(0, 2),
        nota: numero(v("nota")),
        avaliacoes: numero(v("avaliacoes")),
        instagram: perfil(v("instagram")),
        horario: texto(v("horario")),
        servicos: [...new Set(texto(v("servicos")).split(/[,;|\n]/).map((s) => s.trim()).filter((s) => s.length >= 2))].slice(0, 8),
        email: texto(v("email")).toLowerCase(),
        slug: texto(v("slug")),
        score: texto(v("score")).slice(0, 40),
        abordagem: texto(v("abordagem")).slice(0, 500),
      };
      const erro = (motivo: string) => void erros.push({ aba, linha, motivo });
      if (!bruto.nome) return erro("Sem nome.");
      if (!telefone || telefone === RUPHUS) return erro("Telefone ausente ou inválido.");
      if (!nichoDe(bruto)) return erro(`Não reconheci o nicho (“${bruto.categoria || bruto.nome}”): o gerador faz pet e beleza.`);
      if (vistos.has(telefone)) return erro(`Mesmo telefone da ${vistos.get(telefone)}.`);
      const lido = Lead.safeParse(bruto);
      if (!lido.success) return erro(`Valor inválido em “${String(lido.error.issues[0].path[0] ?? "")}”.`);
      vistos.set(telefone, abas.length > 1 ? `linha ${linha} (${aba})` : `linha ${linha}`);
      leads.push({ aba, linha, lead: lido.data });
    });
  }
  if (!comCabecalho) erros.push({ aba: abas[0]?.aba ?? "", linha: 1, motivo: "Não achei o cabeçalho: a planilha precisa de uma coluna “nome”." });
  return { leads, erros, ignoradas: [...ignoradas] };
}

/** Telefone fixo (8 dígitos depois do DDD): o site sai, mas o WhatsApp não atende. */
export const fixo = (telefone: string) => telefone.length === 12;

// ─── Nicho ───────────────────────────────────────────────────────────────────

export type Sub =
  | "petshop" | "vet"
  | "barbearia" | "salao" | "estetica" | "unhas" | "tatuagem"
  | "odonto" | "fisio" | "psico" | "nutri" | "clinica"
  | "idiomas" | "reforco" | "musica" | "autoescola"
  | "academia" | "pilates" | "lutas" | "danca"
  | "oficina" | "lavagem" | "pneus";
export type Nicho = { nicho: "pet" | "beleza" | "saude" | "aulas" | "fitness" | "automotivo"; sub: Sub; tipo: string };

// A primeira regra que casar vence, então a ordem é a regra de negócio:
// - automotivo antes de estética ("estética automotiva") e antes de música ("baterias automotivas");
// - veterinária antes de pet shop; unha antes de salão;
// - saúde específica (odonto, fisio, psico, nutri) antes de estética, e clínica médica por
//   último, para "clínica de estética" e "clínica veterinária" ficarem onde estão;
// - luta e dança antes de academia ("academia de lutas"); pilates e academia antes de salão,
//   que pega "studio"; idiomas e música antes de reforço ("escola de …").
const RAMOS: [RegExp, Nicho | null][] = [
  [/tatu|tattoo|piercing/, { nicho: "beleza", sub: "tatuagem", tipo: "TattooParlor" }],
  [/auto ?escola|\bcfc\b|formacao de condutores|habilitacao/, { nicho: "aulas", sub: "autoescola", tipo: "DrivingSchool" }],
  [/estetica automotiva|lava[ -]?jato|lava[ -]?rapido|lavagem (automotiva|de (carro|veiculo))|polimento|detailing|higienizacao automotiva|martelinho/, { nicho: "automotivo", sub: "lavagem", tipo: "AutoWash" }],
  [/pneu|borracharia|alinhamento|balanceamento/, { nicho: "automotivo", sub: "pneus", tipo: "TireShop" }],
  [/oficina|mecanic|auto ?center|centro automotivo|funilaria|injecao eletronica|automotiv|retifica/, { nicho: "automotivo", sub: "oficina", tipo: "AutoRepair" }],
  [/veterin|clinica animal|hospital animal|\bvet\b/, { nicho: "pet", sub: "vet", tipo: "VeterinaryCare" }],
  [/\bpet|agropet|banho e tosa|tosa|racao|aquario/, { nicho: "pet", sub: "petshop", tipo: "PetStore" }],
  [/barb/, { nicho: "beleza", sub: "barbearia", tipo: "BarberShop" }],
  [/unha|nail|manicure|esmalteria/, { nicho: "beleza", sub: "unhas", tipo: "NailSalon" }],
  [/odonto|dentist|dental|ortodont/, { nicho: "saude", sub: "odonto", tipo: "Dentist" }],
  [/fisioterap|\brpg\b|quiropraxi|osteopat/, { nicho: "saude", sub: "fisio", tipo: "Physiotherapy" }],
  [/psicolog|psicoterap|psicanal/, { nicho: "saude", sub: "psico", tipo: "MedicalBusiness" }],
  [/nutri/, { nicho: "saude", sub: "nutri", tipo: "MedicalBusiness" }],
  [/jiu|muay|boxe|kickbox|karate|judo|taekwon|\bmma\b|capoeira|luta|artes marciais/, { nicho: "fitness", sub: "lutas", tipo: "SportsActivityLocation" }],
  [/danca|ballet|\bbale|zumba|forro|dance/, { nicho: "fitness", sub: "danca", tipo: "SportsActivityLocation" }],
  [/pilates|yoga|ioga/, { nicho: "fitness", sub: "pilates", tipo: "SportsActivityLocation" }],
  [/academia|crossfit|cross ?training|musculacao|treino funcional|personal|fitness|\bgym\b/, { nicho: "fitness", sub: "academia", tipo: "ExerciseGym" }],
  [/estetic|sobrancel|cilio|lash|micropigment|depila|spa|pele|massag|massoterap|podolog|bronze|dermat|biomedic|maquiag|make/, { nicho: "beleza", sub: "estetica", tipo: "BeautySalon" }],
  [/idioma|ingles|espanhol|frances|english|language/, { nicho: "aulas", sub: "idiomas", tipo: "EducationalOrganization" }],
  [/musica|violao|piano|canto|guitarra|bateria|teclado/, { nicho: "aulas", sub: "musica", tipo: "EducationalOrganization" }],
  [/reforco|aulas? particular|explicador|pre-?vestibular|preparatorio|cursinho|apoio escolar/, { nicho: "aulas", sub: "reforco", tipo: "EducationalOrganization" }],
  [/salao|cabel|hair|beleza|beauty|cachos|escova|tranca|penteado|studio/, { nicho: "beleza", sub: "salao", tipo: "HairSalon" }],
  [/clinica|consultorio|medic|pediatr|cardiolog|ginecolog|posto de saude|check-?up/, { nicho: "saude", sub: "clinica", tipo: "MedicalClinic" }],
];

/** O nicho, lido da categoria — e só do nome quando não há categoria: "Petisco
 *  Bar" com categoria "Restaurante" não é pet shop. null = fora do que o gerador faz. */
export function nichoDe(l: { categoria: string; nome: string }): Nicho | null {
  const fonte = (l.categoria || l.nome).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return RAMOS.find(([re]) => re.test(fonte))?.[1] ?? null;
}

// ─── Endereço do site ────────────────────────────────────────────────────────

/** Endereços a tentar, em ordem. Quem decide qual está livre é o servidor, que vê o banco. */
export function candidatos(l: Pick<Lead, "nome" | "cidade" | "slug">) {
  const base = slugify(l.slug || l.nome).slice(0, 48).replace(/-$/, "");
  const cidade = slugify(l.cidade).slice(0, 12).replace(/-$/, "");
  const lista = [base, cidade && `${base}-${cidade}`, ...[2, 3, 4, 5].map((n) => `${base}-${cidade || "site"}-${n}`)];
  return [...new Set(lista)].filter((s) => s && TenantInput.shape.slug.safeParse(s).success);
}

/** Escolha estável a partir do slug (FNV-1a): o mesmo site sai sempre igual, e
 *  vizinhos da mesma planilha não saem todos com a mesma cor e a mesma foto. */
export function variante(slug: string, n: number, sal = "") {
  let h = 0x811c9dc5;
  for (const c of sal + slug) h = Math.imul(h ^ c.charCodeAt(0), 0x01000193);
  return (h >>> 0) % n;
}

// ─── Peças comuns dos modelos ────────────────────────────────────────────────

/** Tudo que vem da planilha passa por aqui antes de entrar no HTML. */
export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** JSON-LD dentro de <script>: "</script>" num nome fecharia a tag. */
export const jsonLd = (dados: unknown) =>
  `<script type="application/ld+json">${JSON.stringify(dados).replace(/</g, "\\u003c")}</script>`;

export const zap = (telefone: string, msg: string) => esc(`https://wa.me/${telefone}?text=${encodeURIComponent(msg)}`);

/** 5591993721156 → (91) 99372-1156 */
export const foneBR = (t: string) => {
  const d = t.slice(2);
  return `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}`;
};

export const notaBR = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** O que o site precisa saber do negócio: o tenant gravado pelo gerador, mais os serviços. */
export type DadosSite = {
  slug: string;
  nome: string;
  telefone: string;
  sub: Sub;
  tipo: string;
  endereco: string;
  bairro: string;
  cidade: string;
  uf: string;
  nota: number | null;
  avaliacoes: number | null;
  instagram: string;
  horario: string;
  servicos: string[];
  /** "setembro de 2026": quando os dados do Google foram lidos */
  consultado: string;
};

export const lugar = (d: Pick<DadosSite, "bairro" | "cidade">) => [d.bairro, d.cidade].filter(Boolean).join(", ");
export const mapa = (d: Pick<DadosSite, "nome" | "endereco" | "cidade" | "uf">) =>
  [d.nome, d.endereco || [d.cidade, d.uf].filter(Boolean).join(" - ")].filter(Boolean).join(", ");

/** A camada da Ruphus que todo site-proposta carrega, igual à dos sites que já estão no ar. */
export const faixaProposta = (slug: string) =>
  `<aside data-ysis="proposta" role="note" style="position:sticky;top:0;z-index:99999;background:#171013;color:#f0e7e2;font:600 13px/1.45 system-ui,sans-serif;padding:8px 16px;text-align:center">Esta página é uma proposta da <a href="https://www.ruphus.site/sobre" style="color:#f2b56b">Ruphus</a>, não o site oficial. <a href="https://wa.me/${RUPHUS}?text=${encodeURIComponent(`Quero remover a página de proposta ${slug}`)}" style="color:#f2b56b">Pedir remoção</a> · <a href="https://www.ruphus.site/privacidade" style="color:#a2918d">Privacidade</a></aside><script data-ysis="proposta">document.addEventListener("DOMContentLoaded",function(){var b=document.querySelector("aside[data-ysis=proposta]");if(!b)return;var h=b.getBoundingClientRect().height;document.querySelectorAll("header,nav,.site-header,.nav,.topo").forEach(function(el){var s=getComputedStyle(el);if(s.position==="fixed"||s.position==="sticky")el.style.top=h+"px"});});</script>`;

export const AVISO =
  '<p data-ysis="aviso" style="margin-top:14px;font-size:.8rem;line-height:1.5;opacity:.72">Seus dados não ficam neste site: o formulário monta a mensagem e abre o WhatsApp para você enviar. Nada é gravado aqui, e o retorno vem pelo mesmo canal.</p>';

/** O que a imagem de compartilhamento (og.jpg) mostra: cada modelo diz a sua. */
export type Capa = { foto: string; cor: string; fonte: string; linha: string };

export const cabecaComum = (slug: string, titulo: string, descricao: string) => {
  const url = `https://${slug}.ruphus.site/`;
  return `<link rel="canonical" href="${url}">
<meta name="robots" content="noindex, nofollow">
<meta name="description" content="${esc(descricao)}">
<meta property="og:type" content="website">
<meta property="og:locale" content="pt_BR">
<meta property="og:title" content="${esc(titulo)}">
<meta property="og:description" content="${esc(descricao)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${url}og.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(titulo)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="${url}og.jpg">`;
};

/** O JSON-LD do negócio: telefone do lead (nunca o nosso) e imagem com caminho absoluto. */
export const jsonLdNegocio = (d: DadosSite, descricao: string, imagem: string) =>
  jsonLd({
    "@context": "https://schema.org",
    "@type": d.tipo,
    name: d.nome,
    url: `https://${d.slug}.ruphus.site/`,
    image: `https://${d.slug}.ruphus.site${imagem}`,
    description: descricao,
    telephone: `+${d.telefone}`,
    ...((d.endereco || d.cidade) && {
      address: {
        "@type": "PostalAddress",
        ...(d.endereco && { streetAddress: d.endereco }),
        ...(d.cidade && { addressLocality: d.cidade }),
        ...(d.uf && { addressRegion: d.uf }),
        addressCountry: "BR",
      },
    }),
    ...(d.nota != null && d.avaliacoes && {
      aggregateRating: { "@type": "AggregateRating", ratingValue: String(d.nota), reviewCount: String(d.avaliacoes), bestRating: "5" },
    }),
  });
