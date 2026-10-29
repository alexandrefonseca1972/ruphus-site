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
  nome: ["nome", "nomedaempresa", "nomedonegocio", "empresa", "negocio", "estabelecimento", "razaosocial", "nomefantasia", "name", "title"],
  telefone: ["telefone", "whatsapp", "whats", "celular", "fone", "contato", "phone", "telefonewhatsapp"],
  categoria: ["categoria", "categorias", "nicho", "nichocategoria", "nichosegmento", "ramo", "segmento", "tipo", "category", "atividade"],
  endereco: ["endereco", "logradouro", "enderecocompleto", "address", "fulladdress", "rua"],
  bairro: ["bairro", "neighborhood"],
  // "Cidade/UF" vem como "Belém/PA (Icoaraci)": lerPlanilha separa cidade, UF e distrito
  cidade: ["cidade", "cidadeuf", "municipio", "city"],
  uf: ["uf", "estado", "state"],
  nota: ["nota", "notagoogle", "notagoogleestrelas", "notageral", "avaliacao", "avaliacaogoogle", "rating", "estrelas"],
  // "Nº de avaliações" normaliza para "ndeavaliacoes": o º não é letra
  avaliacoes: ["avaliacoes", "navaliacoes", "ndeavaliacoes", "numeroavaliacoes", "numerodeavaliacoes", "totalavaliacoes", "totaldeavaliacoes", "qtdavaliacoes", "reviews"],
  instagram: ["instagram", "insta", "ig", "redesocial", "redesocialprincipal", "redesocialprincipalfrequencia", "instagramredessociais"],
  horario: ["horario", "horarios", "funcionamento", "horariodefuncionamento", "workinghours"],
  servicos: ["servicos", "services"],
  email: ["email", "emaildodono", "emaildono"],
  slug: ["slug", "subdominio", "endereco do site"],
  // do levantamento do lead: vão para o funil, não para o site
  score: ["score", "scoredeoportunidade", "pontuacao", "prioridade"],
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

/** utm_* do anúncio, como o navegador guardou: texto curto, e nada além destas chaves. */
const campoUtm = z.string().trim().max(100).optional();
export const UtmInput = z.object({ source: campoUtm, medium: campoUtm, campaign: campoUtm, content: campoUtm, term: campoUtm });

export type Leitura = {
  leads: { aba: string; linha: number; lead: Lead }[];
  erros: { aba: string; linha: number; motivo: string }[];
  /** sem WhatsApp, mas com rede social: não vira site (o site precisa de WhatsApp), fica para contato pela rede */
  semTelefone: { aba: string; linha: number; nome: string; cidade: string; redeSocial: string }[];
  /** colunas da planilha que o gerador não usa: o admin vê e corrige o nome, se era para usar */
  ignoradas: string[];
};

// O levantamento marca o que não achou em vez de deixar a célula vazia. Isso não pode
// virar bairro, horário ou endereço no site: vale como vazio.
const SEM_DADO = /^(n[aã]o\s+(verificad[oa]s?|vis[ií]vel|informad[oa]|encontrad[oa]|dispon[ií]vel|identificad[oa]s?)(\s*\(.*\))?|sem\s+(dados?|informa[cç][aã]o)|(a\s+)?verificar\b.*|n\/?[ad]|-+|—|\?+|null|undefined)$/i;
const texto = (v: unknown) => {
  const t = v == null ? "" : String(v).replace(/\s+/g, " ").trim();
  return SEM_DADO.test(t) ? "" : t;
};

/** Telefone que o levantamento inventou: o número todo com um dígito só (99999-9999),
 *  quatro pares (98811-2233, o padrão da planilha falsa da Paraíba) ou uma escada
 *  (91234-5678). Site com ele mandaria o WhatsApp do "negócio" para um estranho. */
export const telefoneFalso = (telefone: string) => {
  const n = telefone.slice(-8);
  return /^(\d)\1{7}$/.test(n) || /^(\d)\1(\d)\2(\d)\3(\d)\4$/.test(n) || "0123456789".includes(n) || "9876543210".includes(n);
};

/** UF pelo DDD do telefone: o levantamento nem sempre traz a coluna, e sem ela o site
 *  sai "Picos" em vez de "Picos/PI" e o Google fica sem o estado. */
const UF_DO_DDD: Record<string, string> = Object.fromEntries(
  Object.entries({
    SP: "11 12 13 14 15 16 17 18 19", RJ: "21 22 24", ES: "27 28", MG: "31 32 33 34 35 37 38",
    PR: "41 42 43 44 45 46", SC: "47 48 49", RS: "51 53 54 55", DF: "61", GO: "62 64", TO: "63",
    MT: "65 66", MS: "67", AC: "68", RO: "69", BA: "71 73 74 75 77", SE: "79", PE: "81 87", AL: "82",
    PB: "83", RN: "84", CE: "85 88", PI: "86 89", PA: "91 93 94", AM: "92 97", RR: "95", AP: "96", MA: "98 99",
  }).flatMap(([uf, ddds]) => ddds.split(" ").map((d) => [d, uf])),
);
/** "5586999990000" → "PI"; sem DDD conhecido, "". */
/** As 27 UFs, na ordem em que o seletor mostra. */
const NOMES_UF: Record<string, (typeof UFS)[number]> = {
  ACRE: "AC", ALAGOAS: "AL", AMAPA: "AP", AMAZONAS: "AM", BAHIA: "BA", CEARA: "CE", "DISTRITO FEDERAL": "DF", "ESPIRITO SANTO": "ES",
  GOIAS: "GO", MARANHAO: "MA", "MATO GROSSO": "MT", "MATO GROSSO DO SUL": "MS", "MINAS GERAIS": "MG", PARA: "PA", PARAIBA: "PB",
  PARANA: "PR", PERNAMBUCO: "PE", PIAUI: "PI", "RIO DE JANEIRO": "RJ", "RIO GRANDE DO NORTE": "RN", "RIO GRANDE DO SUL": "RS",
  RONDONIA: "RO", RORAIMA: "RR", "SANTA CATARINA": "SC", "SAO PAULO": "SP", SERGIPE: "SE", TOCANTINS: "TO",
};
/** "PB", "pb" ou "Paraíba" viram "PB". As duas primeiras letras de "Paraíba" davam PA e as
 *  de "Minas Gerais" davam MI; o que não for UF fica vazio, e a do DDD entra no lugar. */
export function ufDe(t: string) {
  const u = t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim();
  if ((UFS as readonly string[]).includes(u)) return u;
  return NOMES_UF[u] ?? "";
}

export const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"] as const;
export const ufDoTelefone = (telefone: string) => UF_DO_DDD[telefone.replace(/^55/, "").slice(0, 2)] ?? "";
// O levantamento marca estimativa com "~4.4" ou "aprox. 120": vale o número (decisão de
// produto: nota aproximada no site é melhor que nenhuma).
const numero = (v: unknown) => {
  const t = texto(v).replace(/^(~|≈|±|aprox\.?|cerca de)\s*/i, "");
  const n = typeof v === "number" ? v : Number(t.replace(",", "."));
  return t && Number.isFinite(n) ? n : null;
};
/** Nota que o Excel leu como data: "4.9" vira 4 de setembro (dia 4, mês 9). Nota vai de
 *  1,0 a 4,9 nesse formato ("5.0" não vira data), então dia 1–4 e mês 1–9 voltam a ser a nota. */
const notaDe = (v: unknown) => {
  if (!(v instanceof Date)) return numero(v);
  const [dia, mes] = [v.getUTCDate(), v.getUTCMonth() + 1];
  return dia <= 4 && mes <= 9 ? dia + mes / 10 : null;
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
  const semTelefone: Leitura["semTelefone"] = [];
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
      // "(91) 3241-8660 / (91) 98615-6886": vale o primeiro celular, senão o primeiro número
      const fones = texto(v("telefone")).split(/\s*[\/;]\s*/).map(normalizar).filter(Boolean);
      const telefone = fones.find((f) => f.length === 13) ?? fones[0] ?? "";
      // "Belém/PA (Icoaraci)": cidade antes da barra, UF depois, distrito entre parênteses
      const cidadeUf = texto(v("cidade"));
      const [cidadeSemUf = "", ufDaCidade = ""] = cidadeUf.replace(/\s*\(.*?\)/g, "").split("/").map((s) => s.trim());
      const distrito = /\((.*?)\)/.exec(cidadeUf)?.[1] ?? "";
      const bruto = {
        nome: texto(v("nome")),
        telefone,
        categoria: texto(v("categoria")),
        endereco: texto(v("endereco")),
        bairro: texto(v("bairro")) || distrito,
        cidade: cidadeSemUf,
        uf: ufDe(texto(v("uf")) || ufDaCidade),
        nota: notaDe(v("nota")),
        avaliacoes: numero(v("avaliacoes")),
        instagram: perfil(v("instagram")),
        // coluna "Horário" respondida com sim/não diz se o perfil tem horário, não qual é
        horario: texto(v("horario")).replace(/^(sim|n[aã]o)$/i, ""),
        servicos: [...new Set(texto(v("servicos")).split(/[,;|\n]/).map((s) => s.trim()).filter((s) => s.length >= 2))].slice(0, 8),
        email: texto(v("email")).toLowerCase(),
        slug: texto(v("slug")),
        score: texto(v("score")).slice(0, 40),
        abordagem: texto(v("abordagem")).slice(0, 500),
      };
      const erro = (motivo: string) => void erros.push({ aba, linha, motivo });
      if (!bruto.nome) return erro("Sem nome.");
      if (!telefone || telefone === RUPHUS) {
        // sem WhatsApp, mas com perfil: o negócio existe e dá para procurar pela rede social
        const redeSocial = texto(v("instagram"));
        if (redeSocial) semTelefone.push({ aba, linha, nome: bruto.nome, cidade: bruto.cidade, redeSocial });
        else erro("Telefone ausente ou inválido.");
        return;
      }
      if (telefoneFalso(telefone)) return erro("Telefone com cara de inventado: confira no Google antes de gerar.");
      if (!nichoDe(bruto)) return erro(`Não reconheci o nicho (“${bruto.categoria || bruto.nome}”): o gerador faz pet e beleza.`);
      if (vistos.has(telefone)) return erro(`Mesmo telefone da ${vistos.get(telefone)}.`);
      const lido = Lead.safeParse(bruto);
      if (!lido.success) return erro(`Valor inválido em “${String(lido.error.issues[0].path[0] ?? "")}”.`);
      vistos.set(telefone, abas.length > 1 ? `linha ${linha} (${aba})` : `linha ${linha}`);
      leads.push({ aba, linha, lead: lido.data });
    });
  }
  if (!comCabecalho) erros.push({ aba: abas[0]?.aba ?? "", linha: 1, motivo: "Não achei o cabeçalho: a planilha precisa de uma coluna “nome”." });
  // Sem coluna UF, vale a do DDD mais comum da planilha: um levantamento é de uma região,
  // e o dono com número de outro estado (5 em 106 no do Piauí) não muda onde o negócio fica.
  const ddds = leads.map(({ lead }) => ufDoTelefone(lead.telefone)).filter(Boolean);
  const daPlanilha = [...new Set(ddds)].sort((a, b) => ddds.filter((u) => u === b).length - ddds.filter((u) => u === a).length)[0] ?? "";
  for (const { lead } of leads) if (!lead.uf) lead.uf = daPlanilha;
  return { leads, erros, semTelefone, ignoradas: [...ignoradas] };
}

/** O mesmo celular na outra forma: com o 9 na frente, sem ele, e vice-versa
 *  ("5591993721156" ⇄ "559193721156"). Fixo (começa com 2 a 5) não tem outra forma. */
export function outraForma(telefone: string) {
  const [ddi, ddd, resto] = [telefone.slice(0, 2), telefone.slice(2, 4), telefone.slice(4)];
  if (ddi !== "55") return null;
  if (resto.length === 9 && resto[0] === "9") return ddi + ddd + resto.slice(1);
  if (resto.length === 8 && /^[6-9]/.test(resto)) return `${ddi}${ddd}9${resto}`;
  return null;
}

/** Telefone fixo (8 dígitos depois do DDD): o site sai, mas o WhatsApp não atende. */
export const fixo = (telefone: string) => telefone.length === 12;

// ─── Nicho ───────────────────────────────────────────────────────────────────

export type Sub =
  | "petshop" | "vet"
  | "barbearia" | "salao" | "estetica" | "unhas" | "tatuagem" | "podologia"
  | "odonto" | "fisio" | "psico" | "nutri" | "clinica"
  | "idiomas" | "reforco" | "musica" | "autoescola"
  | "academia" | "pilates" | "lutas" | "danca"
  | "oficina" | "lavagem" | "pneus";
export type Nicho = { nicho: "pet" | "beleza" | "saude" | "aulas" | "fitness" | "automotivo"; sub: Sub; tipo: string };

/** A ficha de cada nicho: família, tipo schema.org e o nome que a pessoa reconhece.
 *  Um lugar só para o gerador (que lê a categoria da planilha) e o cadastro (que
 *  mostra a lista para o dono escolher). */
export const SUBS: Record<Sub, { nicho: Nicho["nicho"]; tipo: string; rotulo: string }> = {
  petshop: { nicho: "pet", tipo: "PetStore", rotulo: "Pet shop" },
  vet: { nicho: "pet", tipo: "VeterinaryCare", rotulo: "Clínica veterinária" },
  barbearia: { nicho: "beleza", tipo: "BarberShop", rotulo: "Barbearia" },
  salao: { nicho: "beleza", tipo: "HairSalon", rotulo: "Salão de beleza" },
  estetica: { nicho: "beleza", tipo: "BeautySalon", rotulo: "Estética" },
  unhas: { nicho: "beleza", tipo: "NailSalon", rotulo: "Manicure e unhas" },
  tatuagem: { nicho: "beleza", tipo: "TattooParlor", rotulo: "Estúdio de tatuagem" },
  podologia: { nicho: "beleza", tipo: "HealthAndBeautyBusiness", rotulo: "Podologia" },
  odonto: { nicho: "saude", tipo: "Dentist", rotulo: "Odontologia" },
  fisio: { nicho: "saude", tipo: "Physiotherapy", rotulo: "Fisioterapia" },
  psico: { nicho: "saude", tipo: "MedicalBusiness", rotulo: "Psicologia" },
  nutri: { nicho: "saude", tipo: "MedicalBusiness", rotulo: "Nutrição" },
  clinica: { nicho: "saude", tipo: "MedicalClinic", rotulo: "Clínica médica" },
  idiomas: { nicho: "aulas", tipo: "EducationalOrganization", rotulo: "Escola de idiomas" },
  reforco: { nicho: "aulas", tipo: "EducationalOrganization", rotulo: "Reforço escolar" },
  musica: { nicho: "aulas", tipo: "EducationalOrganization", rotulo: "Escola de música" },
  autoescola: { nicho: "aulas", tipo: "DrivingSchool", rotulo: "Autoescola" },
  academia: { nicho: "fitness", tipo: "ExerciseGym", rotulo: "Academia" },
  pilates: { nicho: "fitness", tipo: "SportsActivityLocation", rotulo: "Pilates e yoga" },
  lutas: { nicho: "fitness", tipo: "SportsActivityLocation", rotulo: "Artes marciais e lutas" },
  danca: { nicho: "fitness", tipo: "SportsActivityLocation", rotulo: "Dança" },
  oficina: { nicho: "automotivo", tipo: "AutoRepair", rotulo: "Oficina mecânica" },
  lavagem: { nicho: "automotivo", tipo: "AutoWash", rotulo: "Estética automotiva e lava-jato" },
  pneus: { nicho: "automotivo", tipo: "TireShop", rotulo: "Pneus e alinhamento" },
};

/** Os nichos em grupos, na ordem em que o dono os procura na lista. */
export const GRUPOS: [string, Sub[]][] = [
  ["Beleza", ["barbearia", "salao", "estetica", "unhas", "podologia", "tatuagem"]],
  ["Saúde", ["odonto", "fisio", "psico", "nutri", "clinica"]],
  ["Pet", ["petshop", "vet"]],
  ["Fitness", ["academia", "pilates", "lutas", "danca"]],
  ["Aulas e cursos", ["idiomas", "reforco", "musica", "autoescola"]],
  ["Automotivo", ["oficina", "lavagem", "pneus"]],
];

// A primeira regra que casar vence, então a ordem é a regra de negócio:
// - automotivo antes de estética ("estética automotiva") e antes de música ("baterias automotivas");
// - veterinária antes de pet shop; unha antes de salão;
// - saúde específica (odonto, fisio, psico, nutri) antes de estética, e clínica médica por
//   último, para "clínica de estética" e "clínica veterinária" ficarem onde estão;
// - luta e dança antes de academia ("academia de lutas"); pilates e academia antes de salão,
//   que pega "studio"; idiomas e música antes de reforço ("escola de …").
const RAMOS: [RegExp, Sub][] = [
  [/tatu|tattoo|piercing/, "tatuagem"],
  [/auto ?escola|\bcfc\b|formacao de condutores|habilitacao/, "autoescola"],
  [/estetica automotiva|lava[ -]?jato|lava[ -]?rapido|lavagem (automotiva|de (carro|veiculo))|polimento|detailing|higienizacao automotiva|martelinho/, "lavagem"],
  [/pneu|borracharia|alinhamento|balanceamento/, "pneus"],
  [/oficina|mecanic|auto ?center|centro automotivo|funilaria|injecao eletronica|automotiv|retifica/, "oficina"],
  [/veterin|clinica animal|hospital animal|\bvet\b/, "vet"],
  [/\bpet|agropet|banho e tosa|\btosa|\bracao|aquario/, "petshop"],
  // podologia antes de unhas e de estética: "podologia e manicure" e "spa dos pés" são do podólogo
  [/podolog|podiatr|quiropod|onicomicos|unha encravada|spa dos pes|(tratamento|saude|cuidado)s? dos pes/, "podologia"],
  [/barb/, "barbearia"],
  [/unha|nail|manicure|esmalteria/, "unhas"],
  [/odonto|dentist|dental|ortodont/, "odonto"],
  [/fisioterap|\brpg\b|quiropraxi|osteopat/, "fisio"],
  [/psicolog|psicoterap|psicanal/, "psico"],
  [/nutri/, "nutri"],
  [/jiu|muay|boxe|kickbox|karate|judo|taekwon|\bmma\b|capoeira|luta|artes marciais/, "lutas"],
  [/danca|ballet|\bbale|zumba|forro|dance/, "danca"],
  [/pilates|yoga|ioga/, "pilates"],
  [/academia|crossfit|cross ?training|musculacao|treino funcional|personal|fitness|\bgym\b/, "academia"],
  [/estetic|sobrancel|cilio|lash|micropigment|depila|\bspa|pele|massag|massoterap|bronze|dermat|biomedic|maquiag|make/, "estetica"],
  [/idioma|ingles|espanhol|frances|english|language/, "idiomas"],
  [/musica|violao|piano|canto|guitarra|bateria|teclado/, "musica"],
  [/reforco|aulas? particular|explicador|pre-?vestibular|preparatorio|cursinho|apoio escolar/, "reforco"],
  [/salao|cabel|hair|beleza|beauty|cachos|escova|tranca|penteado|studio/, "salao"],
  [/clinica|consultorio|medic|pediatr|cardiolog|ginecolog|posto de saude|check-?up/, "clinica"],
];

/** O nicho, lido da categoria — e só do nome quando não há categoria: "Petisco
 *  Bar" com categoria "Restaurante" não é pet shop. null = fora do que o gerador faz. */
export function nichoDe(l: { categoria: string; nome: string }): Nicho | null {
  const fonte = (l.categoria || l.nome).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const sub = RAMOS.find(([re]) => re.test(fonte))?.[1];
  return sub ? { nicho: SUBS[sub].nicho, sub, tipo: SUBS[sub].tipo } : null;
}

// ─── Cadastro pelo dono ──────────────────────────────────────────────────────

const SUB_IDS = Object.keys(SUBS) as [Sub, ...Sub[]];

/** O que o dono informa do próprio negócio: no cadastro e na aba "Meu negócio".
 *  Compartilhado com a tela, que avisa antes; o servidor confere de novo. */
export const DadosNegocio = z.object({
  name: z.string().trim().min(2, "Informe o nome do negócio").max(80, "Use no máximo 80 caracteres"),
  sub: z.enum(SUB_IDS, "Escolha o ramo do negócio"),
  telefone: z.string().transform((t) => normalizar(t)).refine((t) => !!t && t !== RUPHUS, "Informe o WhatsApp com DDD"),
  cidade: z.string().trim().min(2, "Informe a cidade").max(60),
  uf: z.string().trim().toUpperCase().pipe(z.enum(UFS, "Escolha a UF")),
  bairro: z.string().trim().max(60).default(""),
  endereco: z.string().trim().max(160).default(""),
  instagram: z.string().transform((v) => perfil(v)).default(""),
  horario: z.string().trim().max(120).default(""),
});
export type DadosNegocio = z.infer<typeof DadosNegocio>;
export const NegocioInput = DadosNegocio.extend({ slug: TenantInput.shape.slug });

/** Os dados do dono no formato que o gerador grava (o mesmo de uma linha da planilha). */
export const leadDoDono = (d: DadosNegocio, email = ""): Lead => ({
  nome: d.name, telefone: d.telefone, categoria: "", endereco: d.endereco, bairro: d.bairro, cidade: d.cidade, uf: d.uf,
  nota: null, avaliacoes: null, instagram: d.instagram, horario: d.horario, servicos: [], email, slug: "", score: "", abordagem: "",
});

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

/** Kit de fotos e paleta que o site usa, pelo índice. Sem escolha gravada (sites antigos),
 *  vale o que o slug sorteia, como sempre foi. */
export type Escolha = { kit?: number; cor?: number };

/** Escolhe kit e paleta de um site novo olhando os já existentes na mesma cidade: o kit
 *  menos usado ali, e dentro dele a paleta menos usada. Empate: o slug decide. */
export function sortearVisual(slug: string, usos: Required<Escolha>[], dim: { kits: number; cores: number }): Required<Escolha> {
  const porKit = Array.from({ length: dim.kits }, () => 0);
  const porPar = new Map<string, number>();
  for (const { kit, cor } of usos) {
    // kit extra (escolhido à mão, fora do sorteio) não conta nem pode ser sorteado
    if (kit >= dim.kits) continue;
    porKit[kit] = (porKit[kit] ?? 0) + 1;
    porPar.set(`${kit}:${cor}`, (porPar.get(`${kit}:${cor}`) ?? 0) + 1);
  }
  const menorKit = Math.min(...porKit);
  const kits = porKit.flatMap((n, k) => (n === menorKit ? [k] : []));
  const kit = kits[variante(slug, kits.length, "kit-livre")];
  const porCor = Array.from({ length: dim.cores }, (_, c) => porPar.get(`${kit}:${c}`) ?? 0);
  const menorCor = Math.min(...porCor);
  const cores = porCor.flatMap((n, c) => (n === menorCor ? [c] : []));
  return { kit, cor: cores[variante(slug, cores.length, "cor-livre")] };
}

/** O que o site precisa saber do negócio: o tenant gravado pelo gerador, mais os serviços. */
export type DadosSite = {
  slug: string;
  nome: string;
  telefone: string;
  sub: Sub;
  tipo: string;
  /** kit e paleta escolhidos para a região; ausente = o do slug (sites antigos) */
  escolha?: Escolha;
  /** textos sorteados entre variantes; ausente = o texto original (sites antigos) */
  variantes?: boolean;
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
  /** prospecção: a Ruphus fez sem o dono pedir, e o site traz a faixa de proposta;
   *  cadastro: o próprio dono criou, e o site é dele. Ausente = prospecção. */
  origem?: "prospeccao" | "cadastro";
  /** a entrada foi paga: o site é oficial — sem faixa de proposta e aberto ao Google.
   *  Até lá, de prospecção ou de cadastro, ele é proposta. */
  publicado?: boolean;
};

export const lugar = (d: Pick<DadosSite, "bairro" | "cidade">) => [d.bairro, d.cidade].filter(Boolean).join(", ");
export const mapa = (d: Pick<DadosSite, "nome" | "endereco" | "cidade" | "uf">) =>
  [d.nome, d.endereco || [d.cidade, d.uf].filter(Boolean).join(" - ")].filter(Boolean).join(", ");

/** A camada da Ruphus que todo site-proposta carrega, igual à dos sites que já estão no ar.
 *  O do cadastro não oferece "Pedir remoção": foi o próprio dono que criou. */
export const faixaProposta = (d: Pick<DadosSite, "slug" | "origem">) =>
  `<aside data-ysis="proposta" role="note" style="position:sticky;top:0;z-index:99999;background:#171013;color:#f0e7e2;font:600 13px/1.45 system-ui,sans-serif;padding:8px 16px;text-align:center">${
    d.origem === "cadastro"
      ? `Esta página é uma prévia feita com a <a href="https://www.ruphus.site/" style="color:#f2b56b">Ruphus</a>, ainda não publicada. <a href="https://www.ruphus.site/privacidade" style="color:#a2918d">Privacidade</a>`
      : `Esta página é uma proposta da <a href="https://www.ruphus.site/" style="color:#f2b56b">Ruphus</a>, não o site oficial. <a href="https://wa.me/${RUPHUS}?text=${encodeURIComponent(`Quero remover a página de proposta ${d.slug}`)}" style="color:#f2b56b">Pedir remoção</a> · <a href="https://www.ruphus.site/privacidade" style="color:#a2918d">Privacidade</a>`
  }</aside><script data-ysis="proposta">document.addEventListener("DOMContentLoaded",function(){var b=document.querySelector("aside[data-ysis=proposta]");if(!b)return;var h=b.getBoundingClientRect().height;document.querySelectorAll("header,nav,.site-header,.nav,.topo").forEach(function(el){var s=getComputedStyle(el);if(s.position==="fixed"||s.position==="sticky")el.style.top=h+"px"});});</script>`;

export const AVISO =
  '<p data-ysis="aviso" style="margin-top:14px;font-size:.8rem;line-height:1.5;opacity:.72">Seus dados não ficam neste site: o formulário monta a mensagem e abre o WhatsApp para você enviar. Nada é gravado aqui, e o retorno vem pelo mesmo canal.</p>';

/** O que a imagem de compartilhamento (og.jpg) mostra: cada modelo diz a sua. */
export type Capa = { foto: string; cor: string; fonte: string; linha: string };

export const cabecaComum = (slug: string, titulo: string, descricao: string, publicado = false) => {
  const url = `https://${slug}.ruphus.site/`;
  // proposta não entra no Google: só o site pago, que é o oficial
  return `<link rel="canonical" href="${url}">
<meta name="robots" content="${publicado ? "index, follow" : "noindex, nofollow"}">
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
