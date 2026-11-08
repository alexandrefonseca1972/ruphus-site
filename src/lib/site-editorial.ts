// Modelo editorial do gerador: a página dos sites de barbearia, salão e tatuagem da
// fábrica (hero com fx.js, marquee, serviços numerados, reputação). O CSS é
// public/s/assets/gerado/beleza.css; cada nicho traz o seu Estilo (os de beleza
// estão aqui, os demais em src/lib/nichos) e os seus kits de fotos.
import {
  AVISO, cabecaComum, type Capa, type DadosSite, type Escolha, esc, faixaProposta, foneBR, jsonLdNegocio, lugar, mapa, notaBR, type Sub, variante, zap,
  fixo,
  paraTelefone,
} from "@/lib/gerador";
import { BOTAO_AGENDAR, BOTAO_TOPO, ESTILO_AGENDAR, itemMenu } from "@/lib/botao-agendar";
import { destaqueNoTopo } from "@/lib/contraste";
import { AUTOMOTIVO } from "@/lib/nichos/automotivo";
import { FITNESS } from "@/lib/nichos/fitness";
import { z } from "zod";

/** O que muda de um nicho para outro no modelo editorial. */
export type Estilo = {
  rotulo: string;
  /** a frase do topo e do "Sobre"; uma por site, pela variante */
  textos: string[];
  /** serviços quando a agenda não tem nenhum */
  padrao: string[];
  /** [--ink, --acc, --deep, --tint] */
  paletas: [string, string, string, string][];
  /** pastas com hero.jpg e ga1..3.jpg, a partir de /assets */
  kits: string[];
  /** kits que só entram por escolha gravada (índice depois dos `kits`), fora do sorteio */
  extras?: string[];
  /** paletas que só entram por modelo (índice depois das `paletas`), fora do sorteio: somar às
   *  `paletas` mudaria a cor dos sites que sorteiam pelo slug */
  paletasExtras?: [string, string, string, string][];
  /** descrição e selo por serviço, conferidos antes das regras comuns */
  descricoes?: [RegExp, string | string[], string][];
  /** exemplo do campo de observações do formulário */
  obs?: string;
};

// paletas reais da família editorial: [--ink, --acc, --deep, --tint]
const QUENTES: [string, string, string, string][] = [
  ["#131110", "#B5732F", "#8F5624", "#f6eee6"],
  ["#14110E", "#A86E3C", "#83542A", "#f4ede7"],
  ["#12100F", "#B33A2B", "#8E2B20", "#f5e7e5"],
  ["#12100E", "#8C5E3C", "#6E4A2F", "#f1ebe7"],
  ["#151312", "#C9A24A", "#9E7C33", "#f8f3e9"],
];
// salão infantil: cores alegres sobre fundo escuro (coral, turquesa e amarelo-sol), só pelo modelo
const INFANTIS: [string, string, string, string][] = [
  ["#1B1430", "#FF7A59", "#E2573A", "#fff1ec"],
  ["#10232A", "#2EC4B6", "#1E9E92", "#e8f9f7"],
  ["#1E1631", "#FFB627", "#D18F0C", "#fff6e0"],
];
const DELICADAS: [string, string, string, string][] = [
  ["#161114", "#E58F9C", "#C06A7C", "#fbf1f3"],
  ["#131011", "#F2707F", "#C44E5F", "#fdedef"],
  ["#100F12", "#8E7CC3", "#6A5A9C", "#f1eff7"],
  ["#141118", "#9E86C8", "#7B62A3", "#f3f0f8"],
  ["#171210", "#F0704A", "#C04F2F", "#fdede9"],
  ["#151312", "#C9A24A", "#9E7C33", "#f8f3e9"],
];
// as paletas dos estúdios de tatuagem da fábrica: lilás, vermelho, cobre e petróleo
const TINTAS: [string, string, string, string][] = [
  ["#100F12", "#8E7CC3", "#6A5A9C", "#f1eff7"],
  ["#121010", "#C04545", "#933030", "#f7e8e8"],
  ["#131110", "#B5732F", "#8F5624", "#f6eee6"],
  ["#101210", "#5F9EA0", "#447A7C", "#ebf3f3"],
];
// podologia é cuidado com saúde: azul clínico, verde-água, petróleo e verde-folha
const CLINICAS: [string, string, string, string][] = [
  ["#101417", "#2E7D9A", "#235F75", "#e9f1f5"],
  ["#0F1413", "#2F8F80", "#236C61", "#e8f3f0"],
  ["#101314", "#3C7A8C", "#2B5A68", "#eaf1f4"],
  ["#111413", "#4C8C5A", "#386845", "#ecf3ed"],
];

// os quatro pares de fonte que a família usa, todos com Archivo no texto
export const FONTES: [string, string][] = [
  ["Fraunces", "Fraunces:opsz,wght@9..144,400;9..144,600"],
  ["Marcellus", "Marcellus"],
  ["Italiana", "Italiana"],
  ["Cormorant Garamond", "Cormorant+Garamond:ital,wght@0,400;0,600;1,400"],
];
export const NOMES_FONTE = FONTES.map(([n]) => n) as [string, ...string[]];

// ─── Personalização pelo /admin (gerado.personal) ────────────────────────────
// O que o admin muda num site além do modelo: fotos próprias por posição (gravadas em
// sites/{slug}/fotos/, só o nome fixo da posição), cores, fonte e textos. Tudo opcional:
// chave ausente = o que o modelo, a escolha ou o sorteio do slug dariam.
const HEX = z.string().regex(/^#[0-9a-f]{6}$/i, "cor em hex de 6 dígitos").transform((h) => h.toLowerCase());
const FOTO = z.string().regex(/^fotos\/(hero|ga1|ga2|ga3|bio)\.jpg$/);
export const Personal = z.object({
  fotos: z.object({ hero: FOTO, ga1: FOTO, ga2: FOTO, ga3: FOTO, bio: FOTO }).partial(),
  cores: z.object({ ink: HEX, acc: HEX, deep: HEX, tint: HEX }).partial(),
  fonte: z.enum(NOMES_FONTE),
  textos: z.object({ frase: z.string().trim().max(160), sobre: z.string().trim().max(600), galeria: z.string().trim().max(60) }).partial(),
  /** carimbo da última publicação com foto própria: vai na URL (?v=) para o navegador e a CDN
   *  não mostrarem a foto antiga, já que o nome do arquivo é fixo */
  versao: z.number().int().positive(),
}).partial().strict();
export type Personal = z.infer<typeof Personal>;

const mistura = (hex: string, alvo: number, peso: number) =>
  "#" + [1, 3, 5].map((i) => Math.round(parseInt(hex.slice(i, i + 2), 16) * (1 - peso) + alvo * peso).toString(16).padStart(2, "0")).join("");
/** --deep e --tint a partir da cor de destaque: 25% para o preto e 88% para o branco. */
export const paletaDe = (acc: string) => ({ deep: mistura(acc, 0, 0.25), tint: mistura(acc, 255, 0.88) });

/** Uma referência de foto como o HTML a pede: a do banco é relativa ao site (../assets/…, como
 *  sempre foi) e a própria é relativa à raiz do site (fotos/hero.jpg), que o proxy leva a
 *  /s/{slug}/fotos/… no subdomínio, no www e no domínio próprio. */
const noHtml = (ref: string) => (ref.startsWith("/assets/") ? `..${ref}` : ref);
/** A mesma referência a partir da raiz do site (JSON-LD, bio e og.jpg prefixam o que falta). */
const naRaiz = (ref: string) => (ref.startsWith("/assets/") ? ref : `/${ref}`);

const TEXTOS = {
  barbearia: [
    "Cortes alinhados, barba no detalhe e aquele atendimento que faz você voltar.",
    "Do clássico ao degradê, com navalha, toalha quente e hora marcada.",
    "Cadeira confortável, conversa boa e o corte do jeito que você pediu.",
  ],
  salao: [
    "Corte, cor e tratamento com quem entende do seu cabelo.",
    "Cabelo bem cuidado, do corte à finalização, com atendimento sem pressa.",
    "Técnica, produto certo e escuta: o cabelo que você quer, do jeito que combina com você.",
  ],
  estetica: [
    "Cuidado com a pele e o olhar, com técnica e atenção a cada detalhe.",
    "Procedimentos estéticos com avaliação, conforto e resultado natural.",
    "Um tempo só seu, com protocolos pensados para você.",
  ],
  unhas: [
    "Unhas impecáveis, esmaltação caprichada e alongamento que dura.",
    "Manicure, pedicure e nail art com capricho e biossegurança.",
    "Suas unhas do jeito que você imaginou, com hora marcada.",
  ],
  podologia: [
    "Cuidado com a saúde dos seus pés, com técnica, higiene e hora marcada.",
    "Unha encravada, calosidade e micose tratadas com instrumental esterilizado.",
    "Pés tratados com atenção: avaliação, procedimento e orientação para o dia a dia.",
  ],
  tatuagem: [
    "Arte na pele com traço autoral, biossegurança e atendimento próximo.",
    "Da ideia ao desenho final, um projeto feito com você e para você.",
    "Fine line, blackwork e projetos autorais, com material descartável e hora marcada.",
  ],
};

const PADRAO = {
  barbearia: ["Corte", "Barba", "Corte + barba", "Sobrancelha"],
  salao: ["Corte", "Escova", "Coloração", "Hidratação"],
  estetica: ["Limpeza de pele", "Design de sobrancelha", "Extensão de cílios"],
  unhas: ["Manicure", "Pedicure", "Alongamento em gel"],
  podologia: ["Avaliação podológica", "Podologia completa", "Unha encravada", "Calosidade"],
  tatuagem: ["Tatuagem autoral", "Fine line", "Blackwork", "Cobertura e reforma", "Orçamento"],
};

// serviços de podologia: conferidos antes das regras comuns, que mandariam
// "pedicure" e "unha" para o texto de manicure
const PODOLOGIA: [RegExp, string | string[], string][] = [
  [/encravad|onicocript/i, ["Correção da unha que machuca, com alívio já no atendimento."], "Alívio"],
  [/calo|calosidade|rachadura|fissura|ressecad/i, ["Remoção de calos e cuidado das rachaduras, com orientação para não voltarem."], "Pé liso"],
  [/micose|fungo|onicomicos/i, ["Avaliação da unha com fungo e tratamento acompanhado até o fim."], "Tratamento"],
  [/diabet/i, ["Atendimento com cuidado redobrado para o pé diabético, sem cortes de risco."], "Pé diabético"],
  [/verruga|olho de peixe/i, ["Tratamento da verruga plantar com acompanhamento."], "Plantar"],
  [/esporao|fascit|dor/i, ["Avaliação da dor ao pisar e encaminhamento quando for preciso."], "Avaliação"],
  [/reflexolog|massagem|relaxa|spa/i, ["Pés relaxados com massagem ao fim do atendimento."], "Bem-estar"],
  [/avalia|primeira/i, ["Conversa e exame dos pés para definir o tratamento."], "Primeira visita"],
  [/podolog|pedicure|completa|p[eé]s/i, ["Limpeza, corte, lixamento e hidratação com instrumental esterilizado."], "Esterilizado"],
];

// descrição e selo por serviço; a primeira regra que casar vence
const DESCRICOES: [RegExp, string | string[], string][] = [
  // tatuagem primeiro: "Cobertura" e "Sessão" não podem cair nas regras de salão
  [/fine ?line/i, ["Traços finos e delicados, perfeitos para desenhos minimalistas."], "Delicado"],
  [/blackwork|pontilh|realism/i, ["Preenchimentos sólidos e contrastes fortes em preto."], "Impacto"],
  [/cobertura|reforma|cover/i, ["Transforme ou renove tatuagens antigas com um novo projeto."], "Renovação"],
  [/or[çc]amento/i, ["Converse com o artista, ajuste a ideia e receba o orçamento sem compromisso."], "Sem compromisso"],
  [/piercing/i, ["Perfuração com material esterilizado e joia escolhida com você."], "Biossegurança"],
  [/tatua|tattoo|autoral/i, ["Projetos exclusivos criados com você, do rascunho à pele."], "Exclusivo"],
  [/corte\s*(e|\+)\s*barba|combo/i, ["O pacote completo para sair pronto da cadeira em uma única visita.", "Corte e barba feitos na mesma visita, com o alinhamento que combina com o seu rosto.", "Cabelo e barba no mesmo ritmo: sai da cadeira com o visual fechado de ponta a ponta."], "Mais pedido"],
  [/barba/i, ["Desenho, alinhamento e toalha quente para um acabamento limpo e confortável.", "Barba desenhada com navalha e finalizada com óleo, do contorno ao pescoço.", "Da máquina à navalha: o desenho da barba certo para o seu formato de rosto."], "Toalha quente"],
  [/pigment/i, ["Cobertura de falhas com aspecto natural."], "Acabamento"],
  [/sobrancel/i, ["Desenho que valoriza o olhar, sem exageros.", "Sobrancelha alinhada com pinça e navalha, respeitando o formato do seu rosto."], "Detalhe"],
  [/corte/i, ["Do clássico ao moderno, com acabamento caprichado e finalização profissional.", "Tesoura e máquina na medida certa, com a degradê que você pedir.", "Corte pensado para o seu tipo de cabelo e para o dia a dia, com finalização rápida."], "Clássico & moderno"],
  [/escova|finaliz/i, ["Brilho, movimento e fios alinhados para o dia a dia ou para a ocasião."], "Finalização"],
  [/colora|mecha|luzes|loiro/i, ["Cor pensada para o seu tom de pele, com cuidado para a saúde do fio."], "Cor"],
  [/hidrat|tratamento|cronograma|reconstr/i, ["Tratamento para devolver força, maciez e brilho aos fios."], "Tratamento"],
  [/progressiva|alisa|selagem|botox/i, ["Redução de volume e frizz com produtos de qualidade."], "Liso"],
  [/manicure/i, ["Cutilagem cuidadosa e esmaltação caprichada."], "Clássico"],
  [/pedicure/i, ["Pés bem cuidados, com conforto e acabamento impecável."], "Cuidado"],
  [/alongamento|gel|fibra/i, ["Unhas mais longas e resistentes, com formato do seu jeito."], "Durável"],
  [/cíli|cili|lash/i, ["Fios aplicados um a um para um olhar marcante e natural."], "Olhar"],
  [/limpeza de pele|facial|peeling/i, ["Pele limpa, renovada e preparada para os próximos cuidados."], "Pele"],
  [/bronze/i, ["Bronzeado uniforme e natural, com cuidado para a sua pele."], "Bronze"],
  [/massag|drenag/i, ["Relaxamento e bem-estar em um momento só seu."], "Bem-estar"],
  [/cera|roll-?on|faixa/i, ["Cera aplicada e retirada com técnica, para a pele lisa e com conforto."], "Cera"],
  [/depila/i, ["Depilação com técnica e conforto."], "Conforto"],
];
const detalhe = (e: Estilo, slug: string, s: string, i: number, variantes: boolean): [string, string] => {
  const achado = [...(e.descricoes ?? []), ...DESCRICOES].find(([re]) => re.test(s));
  return achado ? [Array.isArray(achado[1]) ? achado[1][variantes ? variante(slug + s, achado[1].length, "desc") : 0] : achado[1], achado[2]] : ["Atendimento com hora marcada — confirme os detalhes pelo WhatsApp.", ["Especial", "Detalhe", "Cuidado"][i % 3]];
};

const WA = '<svg viewBox="0 0 448 512" aria-hidden="true"><path fill="currentColor" d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z"/></svg>';
const PINO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7zm0 9.5c-1.4 0-2.5-1.1-2.5-2.5S10.6 6.5 12 6.5s2.5 1.1 2.5 2.5-1.1 2.5-2.5 2.5z"/></svg>';
const GOOGLE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.16 3.57-8.81z"/><path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.92l-3.87-3c-1.07.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.27 14.27A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.56.38-2.27v-3.1H1.29a12 12 0 0 0 0 10.74l3.98-3.1z"/><path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.58 1.8l3.44-3.44A11.98 11.98 0 0 0 12 0 12 12 0 0 0 1.29 6.63l3.98 3.1C6.22 6.88 8.87 4.77 12 4.77z"/></svg>';
const INSTA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1.1" fill="currentColor" stroke="none"/></svg>';

const beleza = (tipo: keyof typeof TEXTOS, rotulo: string, paletas: Estilo["paletas"]): Estilo => ({
  rotulo, textos: TEXTOS[tipo], padrao: PADRAO[tipo], paletas, kits: [1, 2, 3, 4].map((n) => `/assets/beleza/${tipo}-${n}`),
});
const ESTILOS: Partial<Record<Sub, Estilo>> = {
  barbearia: beleza("barbearia", "Barbearia", QUENTES),
  // infantil-1 e infantil-2: fotos de criança no salão (Pexels), escolha.kit = 4 e 5; INFANTIS = cor 6 a 8
  salao: { ...beleza("salao", "Salão de beleza", DELICADAS), extras: ["/assets/beleza/infantil-1", "/assets/beleza/infantil-2"], paletasExtras: INFANTIS },
  // depilacao-1: fotos de depilação (Pexels) para quem só faz isso; escolha.kit = 4
  // bronze-1: bronzeamento em cabine e natural (Pexels); escolha.kit = 5
  // cilios-1: extensão de cílios (Pexels); escolha.kit = 6
  // cilios-2 e cilios-3: mais extensão de cílios (Pexels); escolha.kit = 7 e 8
  // bronze-2: cabine/solário; bronze-3: bronzeamento natural na praia (Pexels); escolha.kit = 9 e 10
  // depilacao-2: cera em faixa; depilacao-3: depilação a laser (Pexels); escolha.kit = 11 e 12
  estetica: { ...beleza("estetica", "Estética", DELICADAS), extras: ["/assets/beleza/depilacao-1", "/assets/beleza/bronze-1", "/assets/beleza/cilios-1", "/assets/beleza/cilios-2", "/assets/beleza/cilios-3", "/assets/beleza/bronze-2", "/assets/beleza/bronze-3", "/assets/beleza/depilacao-2", "/assets/beleza/depilacao-3"] },
  unhas: beleza("unhas", "Nail designer", DELICADAS),
  tatuagem: beleza("tatuagem", "Estúdio de tatuagem", TINTAS),
  podologia: { ...beleza("podologia", "Podologia", CLINICAS), descricoes: PODOLOGIA },
  ...FITNESS,
  ...AUTOMOTIVO,
};
const estiloDe = (sub: Sub) => ESTILOS[sub] ?? ESTILOS.salao!;

/** Quantos kits e paletas o estilo tem, e o que o slug sorteia quando o site não tem escolha. */
export const combinacoesEditorial = (sub: Sub) => ({ kits: estiloDe(sub).kits.length, cores: estiloDe(sub).paletas.length });
export const escolhaEditorial = (sub: Sub, slug: string): Required<Escolha> => ({
  kit: variante(slug, estiloDe(sub).kits.length, "kit"),
  cor: variante(slug, estiloDe(sub).paletas.length, "cor"),
});

// Três templates por nicho, cada um um par [kit, cor] do estilo do sub. Esmalteria é o
// sub "unhas"; cílios, bronzeamento, depilação, esteticista e maquiagem dividem "estetica"
// (kit 6 é cílios-1, kit 5 é bronze-1, kit 4 é depilação-1). Escolha gravada (gerado.escolha) continua valendo; isto só
// cataloga as opções. Fitness e automotivo: um template por sub, um kit em cada modelo.
export const TEMPLATES = {
  barbearia: { sub: "barbearia", escolhas: [{ kit: 0, cor: 0 }, { kit: 1, cor: 2 }, { kit: 2, cor: 4 }] },
  podologia: { sub: "podologia", escolhas: [{ kit: 0, cor: 0 }, { kit: 1, cor: 2 }, { kit: 2, cor: 1 }] },
  esmalteria: { sub: "unhas", escolhas: [{ kit: 0, cor: 0 }, { kit: 1, cor: 2 }, { kit: 2, cor: 4 }] },
  cilios: { sub: "estetica", escolhas: [{ kit: 6, cor: 0 }, { kit: 7, cor: 2 }, { kit: 8, cor: 4 }] },
  // paletas quentes do DELICADAS: dourado, terracota, coral
  bronzeamento: { sub: "estetica", escolhas: [{ kit: 5, cor: 5 }, { kit: 9, cor: 4 }, { kit: 10, cor: 1 }] },
  depilacao: { sub: "estetica", escolhas: [{ kit: 4, cor: 1 }, { kit: 11, cor: 3 }, { kit: 12, cor: 5 }] },
  cabeleireira: { sub: "salao", escolhas: [{ kit: 0, cor: 0 }, { kit: 1, cor: 2 }, { kit: 2, cor: 4 }] },
  // o modelo traz o próprio rótulo, as frases e os serviços padrão: um salão infantil não fala
  // de "corte, cor e tratamento" para adulto
  infantil: {
    sub: "salao",
    escolhas: [{ kit: 4, cor: 6 }, { kit: 5, cor: 7 }, { kit: 4, cor: 8 }],
    rotulo: "Salão infantil",
    textos: [
      "Corte infantil com paciência, brincadeira e muito carinho.",
      "O primeiro corte, a trança da festa e o penteado da escola, num espaço feito para criança.",
      "Criança feliz na cadeira e cabelo bem cuidado, com hora marcada.",
    ],
    padrao: ["Corte infantil", "Primeiro corte", "Tranças", "Penteado infantil", "Hidratação kids"],
  },
  esteticista: { sub: "estetica", escolhas: [{ kit: 0, cor: 1 }, { kit: 1, cor: 3 }, { kit: 3, cor: 5 }] },
  maquiagem: { sub: "estetica", escolhas: [{ kit: 2, cor: 0 }, { kit: 0, cor: 2 }, { kit: 1, cor: 4 }] },
  tatuador: { sub: "tatuagem", escolhas: [{ kit: 0, cor: 0 }, { kit: 1, cor: 1 }, { kit: 2, cor: 2 }] },
  // ENERGIA tem 5 cores; LEVE e GRAFITE, 4
  academia: { sub: "academia", escolhas: [{ kit: 0, cor: 0 }, { kit: 1, cor: 2 }, { kit: 2, cor: 4 }] },
  pilates: { sub: "pilates", escolhas: [{ kit: 0, cor: 1 }, { kit: 1, cor: 3 }, { kit: 2, cor: 0 }] },
  lutas: { sub: "lutas", escolhas: [{ kit: 0, cor: 1 }, { kit: 1, cor: 3 }, { kit: 2, cor: 0 }] },
  danca: { sub: "danca", escolhas: [{ kit: 0, cor: 3 }, { kit: 1, cor: 2 }, { kit: 2, cor: 0 }] },
  oficina: { sub: "oficina", escolhas: [{ kit: 0, cor: 0 }, { kit: 1, cor: 3 }, { kit: 2, cor: 1 }] },
  lavagem: { sub: "lavagem", escolhas: [{ kit: 0, cor: 3 }, { kit: 1, cor: 1 }, { kit: 2, cor: 0 }] },
  pneus: { sub: "pneus", escolhas: [{ kit: 0, cor: 2 }, { kit: 1, cor: 3 }, { kit: 2, cor: 0 }] },
} satisfies Record<string, { sub: Sub; escolhas: Required<Escolha>[]; rotulo?: string; textos?: string[]; padrao?: string[] }>;
const ROTULO_MODELO: Record<keyof typeof TEMPLATES, string> = {
  barbearia: "Barbearia", podologia: "Podologia", esmalteria: "Esmalteria", cilios: "Cílios", bronzeamento: "Bronzeamento", depilacao: "Depilação", cabeleireira: "Cabeleireira",
  esteticista: "Esteticista", maquiagem: "Maquiagem", tatuador: "Tatuador", infantil: "Salão infantil",
  academia: "Academia", pilates: "Pilates", lutas: "Lutas", danca: "Dança", oficina: "Oficina", lavagem: "Estética automotiva", pneus: "Pneus",
};

/** Todos os modelos, para qualquer ramo editorial: id estável (nicho-n), a escolha que ele
 *  grava e a foto e a paleta do próprio ramo de origem, que vão junto com ele. */
export const MODELOS = (Object.keys(TEMPLATES) as (keyof typeof TEMPLATES)[]).flatMap((nicho) => {
  const t: { sub: Sub; escolhas: Required<Escolha>[]; rotulo?: string; textos?: string[]; padrao?: string[] } = TEMPLATES[nicho];
  const { sub, escolhas } = t;
  const e = estiloDe(sub);
  return escolhas.map((escolha, i) => {
    const id = `${nicho}-${i + 1}`;
    return {
      id,
      sub,
      rotulo: `${ROTULO_MODELO[nicho]} ${i + 1}`,
      escolha: { ...escolha, modelo: id },
      pasta: [...e.kits, ...(e.extras ?? [])][escolha.kit] ?? e.kits[0],
      paleta: [...e.paletas, ...(e.paletasExtras ?? [])][escolha.cor],
      // rótulo, frases e serviços do próprio modelo (salão infantil); sem eles, os do ramo
      estilo: t.textos ? { rotulo: t.rotulo, textos: t.textos, padrao: t.padrao } : undefined,
    };
  });
});
export const modeloDoId = (id: string) => MODELOS.find((m) => m.id === id);

// Textos fixos do modelo, em variantes: cada site sorteia uma por bloco (pelo slug), para
// que dois sites do mesmo nicho não tenham as mesmas frases de ponta a ponta.
const VARIANTES = {
  galeria: ["O espaço e o trabalho", "Por dentro e no trabalho", "Ambiente e resultados"],
  servicos: ["O que você encontra", "Tudo o que você pode marcar", "Como funciona cada serviço"],
  agendamento: ["Marque seu horário", "Agende em poucos passos", "Escolha o seu horário"],
  // [título, texto] — o texto leva {nome} onde entra o nome do negócio
  precos: [
    ["Valores sob consulta.", "O estabelecimento não publica a tabela de preços online — chame no WhatsApp e receba os valores atualizados na hora."],
    ["Preço sob consulta.", "Não publicamos a tabela online: mande uma mensagem no WhatsApp e receba os valores do dia."],
    ["Valores na conversa.", "Os valores mudam com o serviço e a duração: pergunte no WhatsApp e receba o orçamento na hora."],
  ],
  intro: [
    "Preencha ao lado e envie direto no WhatsApp de {nome}. Sem cadastro, sem aplicativo — a resposta vem na conversa.",
    "Monte sua mensagem ao lado e envie no WhatsApp de {nome}. Nada de cadastro: a resposta vem na conversa.",
    "Diga o serviço e o melhor dia. A mensagem segue para o WhatsApp de {nome} e a equipe confirma.",
  ],
  // três passos; cada conjunto inteiro é sorteado junto
  passos: [
    ["Escolha o serviço e o melhor dia para você.", "Envie — a mensagem já chega pronta no WhatsApp.", "Receba a confirmação do horário pela equipe."],
    ["Diga qual serviço você quer.", "Mande a mensagem pronta pelo WhatsApp.", "A equipe confirma o horário com você."],
    ["Conte o que você precisa e quando.", "Confira a mensagem e envie.", "Aguarde a confirmação na conversa."],
  ],
};
const sorteio = <T,>(lista: T[], slug: string, sal: string): T => lista[variante(slug, lista.length, sal)];

/** Cor e foto principal: o que o tenant guarda para o /admin e a /bio. */
export function visualEditorial(slug: string, sub: Sub, escolha?: Escolha & { modelo?: string }, personal?: Personal | null) {
  const ramo = estiloDe(sub);
  const padrao = escolhaEditorial(sub, slug);
  // modelo gravado: foto e paleta vêm dele, mesmo que o ramo do negócio seja outro
  const doModelo = escolha?.modelo ? modeloDoId(escolha.modelo) : undefined;
  // e o rótulo, as frases e os serviços padrão, quando o modelo tem os seus (salão infantil)
  const m = doModelo?.estilo;
  const e: Estilo = m ? { ...ramo, rotulo: m.rotulo ?? ramo.rotulo, textos: m.textos, padrao: m.padrao ?? ramo.padrao } : ramo;
  const paleta = doModelo?.paleta ?? e.paletas[escolha?.cor ?? padrao.cor];
  const kit = doModelo?.pasta ?? [...e.kits, ...(e.extras ?? [])][escolha?.kit ?? padrao.kit] ?? e.kits[padrao.kit];
  // personalização por cima de tudo: cor de destaque própria arrasta deep e tint, salvo se vieram também
  const c = personal?.cores ?? {};
  const derivada = c.acc ? paletaDe(c.acc) : null;
  const ink = c.ink ?? paleta[0];
  const acc = c.acc ?? paleta[1];
  const deep = c.deep ?? derivada?.deep ?? paleta[2];
  const tint = c.tint ?? derivada?.tint ?? paleta[3];
  const fonte = FONTES.find(([n]) => n === personal?.fonte) ?? FONTES[variante(slug, FONTES.length, "fonte")];
  const p = personal?.fotos ?? {};
  // foto própria leva o carimbo da publicação: "fotos/hero.jpg?v=1730000000000"
  const propria = (ref: string | undefined) => (ref && personal?.versao ? `${ref}?v=${personal.versao}` : ref);
  const fotos = { hero: propria(p.hero) ?? `${kit}/hero.jpg`, ga1: propria(p.ga1) ?? `${kit}/ga1.jpg`, ga2: propria(p.ga2) ?? `${kit}/ga2.jpg`, ga3: propria(p.ga3) ?? `${kit}/ga3.jpg` };
  // a foto da bio: a própria da bio, senão a do topo (própria ou do kit)
  const foto = naRaiz(propria(p.bio) ?? fotos.hero);
  return { e, ink, acc, deep, tint, kit, cor: acc, foto, fonte, fotos };
}

/** A imagem de compartilhamento: a foto do topo do kit e a fonte de título do próprio site. */
export function capaEditorial(d: DadosSite): Capa {
  const { e, cor, fonte, fotos } = visualEditorial(d.slug, d.sub, d.escolha, d.personal);
  // a rota do og.jpg pede `/s${foto}`: a do banco é /assets/…, a própria é /{slug}/fotos/hero.jpg
  const foto = fotos.hero.startsWith("/assets/") ? fotos.hero : `/${d.slug}/${fotos.hero}`;
  return { foto, cor, fonte: fonte[0], linha: [e.rotulo, d.cidade].filter(Boolean).join(" em ") };
}

export function renderEditorial(d: DadosSite): string {
  const { e, ink, acc, deep, tint, fonte, fotos } = visualEditorial(d.slug, d.sub, d.escolha, d.personal);
  const onde = lugar(d);
  const rotulo = e.rotulo;
  const tag = [rotulo, [d.cidade, d.uf].filter(Boolean).join("/")].filter(Boolean).join(" · ");
  const t = d.personal?.textos ?? {};
  const texto = t.frase || e.textos[variante(d.slug, e.textos.length, "texto")] + (onde ? ` Em ${onde}.` : "");
  const sobre = t.sobre || texto;
  // "ilustrativa" só vale para foto do banco: a própria é do estabelecimento
  const doBanco = (ref: string) => ref.startsWith("/assets/");
  const temNota = d.nota != null && !!d.avaliacoes;
  const nota = temNota ? notaBR(d.nota!) : "";
  const descr = `${d.nome} — ${rotulo}${d.cidade ? ` em ${d.cidade}` : ""}${temNota ? ` com nota ${nota} e ${d.avaliacoes} avaliações no Google` : ""}. Agende pelo WhatsApp.`;
  const tituloPag = `${d.nome} — ${rotulo}${d.cidade ? ` em ${d.cidade}` : ""}`;
  const oi = zap(d.telefone, `Olá! Vim pelo site da ${d.nome} e quero agendar um horário.`);
  const busca = mapa(d);
  const google = esc(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(busca)}`);
  const servicos = d.servicos.length ? d.servicos : e.padrao;
  const endereco = d.endereco || [onde, d.uf].filter(Boolean).join(" - ");
  // o nome em duas linhas, a segunda em itálico na cor de destaque, como na família
  const palavras = d.nome.split(/\s+/);
  const corte = palavras.length > 1 ? Math.ceil(palavras.length / 2) : 1;
  const [linha1, linha2] = [palavras.slice(0, corte).join(" "), palavras.slice(corte).join(" ")];
  const fatos = [
    temNota && [`★ ${nota}`, "Nota no Google"],
    temNota && [String(d.avaliacoes), "Avaliações reais"],
    d.bairro && [d.bairro, "Bairro"],
    d.cidade && [d.cidade, "Cidade"],
  ].filter((f): f is [string, string] => !!f);
  const marquee = [...servicos, ...servicos].map((s) => `<span>${esc(s)} ✦</span>`).join("");
  const alt = esc(`${d.nome} — ${rotulo}`);
  const escolhido = <T,>(lista: T[], sal: string): T => (d.variantes ? sorteio(lista, d.slug, sal) : lista[0]);
  // número fixo: o WhatsApp não atende — ligação no lugar, sem o formulário que monta a mensagem
  const porTelefone = fixo(d.telefone);
  const passos = porTelefone
    ? ["Escolha o serviço e o melhor dia para você.", "Ligue para a equipe.", "Combine o horário na própria ligação."]
    : escolhido(VARIANTES.passos, "passos");
  const [precoTitulo, precoTexto] = escolhido(VARIANTES.precos, "precos");
  const intro = porTelefone
    ? `Ligue para ${esc(d.nome)} e marque na hora, sem cadastro e sem aplicativo.`
    : escolhido(VARIANTES.intro, "intro").replace("{nome}", esc(d.nome));

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<script>document.documentElement.classList.add("js");</script>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(tituloPag)}</title>
<meta name="theme-color" content="${ink}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=${fonte[1]}&family=Archivo:ital,wght@0,400;0,500;0,700;0,800;1,400&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../assets/gerado/beleza.css">
<style>:root{--ink:${ink};--paper:#ffffff;--acc:${acc};--deep:${deep};--tint:${tint};--grey:#8b8587;--serif:'${fonte[0]}',serif}${destaqueNoTopo(acc) === acc.toUpperCase() ? "" : `.hero h1 .row2{color:${destaqueNoTopo(acc)}}`}</style>
${cabecaComum(d, tituloPag, descr, d.publicado)}
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${ink}"/><text x="32" y="45" font-family="Arial Narrow,Arial,sans-serif" font-size="36" font-weight="700" fill="${acc}" text-anchor="middle">${esc(d.nome[0].toUpperCase())}</text></svg>`)}">
${jsonLdNegocio(d, descr, naRaiz(fotos.hero))}
${ESTILO_AGENDAR}
</head>
<body id="top">
${d.publicado ? "" : faixaProposta(d)}

<header id="hd">
  <a class="logo" href="#top">${esc(d.nome)}</a>
  <nav>
    <a href="#sobre">${itemMenu("sobre", "Sobre")}</a><a href="#trabalhos">${itemMenu("trabalhos", "Galeria")}</a><a href="#servicos">${itemMenu("servicos", "Serviços")}</a>${temNota ? `<a href="#depoimentos">${itemMenu("depoimentos", "Reputação")}</a>` : ""}<a href="#como-chegar">${itemMenu("como-chegar", "Como chegar")}</a>
  </nav>
</header>

<section class="hero">
  <div class="bgimg"><img src="${noHtml(fotos.hero)}" alt="${alt}"></div>
  <canvas id="fx3d"></canvas>
  <div class="hero-inner">
    <span class="tag">${esc(tag)}</span>
    <h1 class="rv${d.nome.length > 40 ? " nml" : d.nome.length > 24 ? " nl" : ""}">${esc(linha1)}${linha2 ? `<span class="row2">${esc(linha2)}</span>` : ""}</h1>
${BOTAO_AGENDAR}
    <p class="sub rv">${esc(texto)}</p>
    ${temNota ? `<a class="badge-google rv" href="${google}" target="_blank" rel="noopener">${GOOGLE}<span class="st">★★★★★</span> ${nota} · ${d.avaliacoes} avaliações</a>` : ""}
    <div class="hero-ctas rv">
      <a class="btn-wpp" style="border-color:rgba(255,255,255,.6);color:#fff" href="#servicos">Ver serviços</a>
    </div>
  </div>
</section>

<div class="marquee"><div class="marquee-track">${marquee}</div></div>

<section id="sobre">
  <div class="sec-head rv"><span class="label">A Casa</span><h2>Sobre</h2></div>
  <div class="sobre-grid">
    <div class="rv"><p class="sobre-big">${esc(sobre)}</p></div>
    ${fatos.length ? `<div class="facts rv">${fatos.map(([b, s]) => `<div class="fact"><b>${esc(b)}</b><span>${s}</span></div>`).join("")}</div>` : ""}
  </div>
</section>

<section class="galeria" id="trabalhos">
  <div class="sec-head rv"><span class="label">Galeria</span><h2>${esc(t.galeria || escolhido(VARIANTES.galeria, "galeria"))}</h2></div>
  <div class="gal-grid">${[fotos.ga1, fotos.ga2, fotos.ga3].map((ref) => `<div class="tilt rv fit-cover"><img src="${noHtml(ref)}" alt="${alt}" loading="lazy">${doBanco(ref) ? '<span class="cap">Imagem ilustrativa</span>' : ""}</div>`).join("")}</div>
</section>

<section class="servicos" id="servicos">
  <div class="sec-head rv"><span class="label">Serviços</span><h2>${escolhido(VARIANTES.servicos, "servicos")}</h2></div>
  ${servicos.map((s, i) => {
    const [p, selo] = detalhe(e, d.slug, s, i, d.variantes === true);
    return `<div class="svc-row rv"><span class="num">${String(i + 1).padStart(2, "0")}</span><div><h3>${esc(s)}</h3><p>${esc(p)}</p></div><span class="tag-pill">${esc(selo)}</span></div>`;
  }).join("")}
  <div class="precos rv"><h3>Tabela de preços</h3>
      <div class="price-placeholder"><b>${precoTitulo}</b> ${precoTexto}</div></div>
</section>

<section class="agendar" id="agendar">
  <div class="sec-head rv"><span class="label">Agendamento</span><h2>${escolhido(VARIANTES.agendamento, "agendamento")}</h2></div>
  <div class="ag-grid">
    <div class="ag-info rv">
      <p>${intro}</p>
      <div class="steps">
        <div class="step"><b>1</b><span>${passos[0]}</span></div>
        <div class="step"><b>2</b><span>${passos[1]}</span></div>
        <div class="step"><b>3</b><span>${passos[2]}</span></div>
      </div>
    </div>
    ${porTelefone ? `<div class="waform rv"><p>Ligue para ${esc(d.nome)} e combine o serviço e o melhor horário.</p><a class="btn-solid" href="tel:+${d.telefone}">${WA} Ligar ${foneBR(d.telefone)}</a></div>` : `<form class="waform rv" id="waform" data-wa="${d.telefone}">
      <label for="wf-nome">Seu nome</label>
      <input id="wf-nome" name="nome" type="text" placeholder="Como podemos te chamar?" autocomplete="name" required>
      <label for="wf-svc">Serviço</label>
      <select id="wf-svc" name="servico"><option value="">Escolha um serviço</option>${servicos.map((s) => `<option>${esc(s)}</option>`).join("")}<option>Outro / quero tirar uma dúvida</option></select>
      <label for="wf-dia">Dia de preferência</label>
      <input id="wf-dia" name="dia" type="date">
      <label for="wf-per">Período</label>
      <select id="wf-per" name="periodo"><option value="">Tanto faz</option><option>Manhã</option><option>Tarde</option><option>Noite</option></select>
      <label for="wf-msg">Observações (opcional)</label>
      <textarea id="wf-msg" name="msg" placeholder="${e.obs ?? "Ex.: primeira visita, referência, alergia a produto…"}"></textarea>
      <button type="submit">${WA} Enviar pelo WhatsApp</button>
    ${AVISO}
</form>`}
  </div>
</section>
${temNota ? `
<section id="depoimentos">
  <div class="sec-head rv"><span class="label">Reputação</span><h2>${nota} no Google</h2></div>
  <div class="rep rv"><div class="rep-nota"><span class="big-star">★</span><b>${nota}</b><small>${d.avaliacoes} avaliações no Google</small></div>
      <div><p class="rep-txt">Com <b>${d.avaliacoes} avaliações</b> e média <b>${nota}</b> no Google, ${esc(d.nome)} está entre os endereços mais bem avaliados${d.bairro ? ` de ${esc(d.bairro)}` : ""} e região.</p><div class="rep-chips">${servicos.slice(0, 4).map((s) => `<span class="chip">${esc(s)}</span>`).join("")}</div></div></div>
  ${d.instagram ? `<div class="igcard rv"><span class="ig-av"><span>${esc(d.nome[0].toUpperCase())}</span></span><span class="ig-info"><b>@${esc(d.instagram)}</b><small>Trabalhos recentes no Instagram</small></span><a class="btn-ig" href="https://www.instagram.com/${esc(d.instagram)}/" target="_blank" rel="noopener">${INSTA} Ver perfil</a></div>` : ""}
</section>
` : ""}
<section id="como-chegar">
  <div class="sec-head rv"><span class="label">Localização</span><h2>Como chegar</h2></div>
  <div class="mapa-grid">
    <div class="mapa-frame rv"><iframe title="Mapa — ${esc(d.nome)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="${esc(`https://maps.google.com/maps?q=${encodeURIComponent(busca)}&z=17&output=embed`)}"></iframe></div>
    <div class="mapa-info rv">
      ${endereco ? `<div class="mi">${PINO}<span>${esc(endereco)}</span></div>` : ""}
      <div class="mi">${WA}<span>Dúvidas de acesso? Chame no WhatsApp: <a data-ysis="tel" href="tel:+${d.telefone}" style="color:inherit;text-decoration:none">${foneBR(d.telefone)}</a></span></div>
      <a class="btn-route" href="${google}" target="_blank" rel="noopener">${PINO} Traçar rota no Google Maps</a>
    </div>
  </div>
</section>

<section class="contato" id="contato">
  <div class="sec-head rv"><span class="label">Contato</span><h2>Fale com a gente</h2></div>
  <h2 class="cta-h2 rv">Seu próximo horário está a <em>${porTelefone ? "uma ligação" : "uma mensagem"}</em> de distância</h2>
  <div class="cta-row rv">
    <a class="btn-solid" href="${oi}" target="_blank" rel="noopener">${WA} Chamar no WhatsApp</a>
    <a class="btn-ghost" href="${google}" target="_blank" rel="noopener">${PINO} Ver no mapa</a>
  </div>
  <ul class="info-list rv">${endereco ? `<li><b>Endereço</b><span>${esc(endereco)}</span></li>` : ""}<li><b>WhatsApp</b><span><a href="${oi}" target="_blank" rel="noopener">${foneBR(d.telefone)}</a></span></li><li><b>Horário de atendimento</b><span>${esc(d.horario || "Não informado publicamente — confirme pelo WhatsApp")}</span></li></ul>
</section>

<footer>
  <span>${esc(`${d.nome} — ${tag}`)}<br><small>${d.origem === "cadastro" || d.publicado ? "Site criado com Ruphus" : "Site-modelo de demonstração criado pela Ruphus"}</small></span>
  <span class="social">
    <a href="${oi}" target="_blank" rel="noopener" aria-label="WhatsApp de ${esc(d.nome)}">${WA}</a>
    ${d.instagram ? `<a href="https://www.instagram.com/${esc(d.instagram)}/" target="_blank" rel="noopener" aria-label="Instagram de ${esc(d.nome)}">${INSTA}</a>` : ""}
    <a href="${google}" target="_blank" rel="noopener" aria-label="${esc(d.nome)} no Google Maps">${PINO}</a>
  </span>
<p data-ysis="fonte" style="margin:14px 0 0;font-size:.76rem;line-height:1.5;opacity:.6">${Object.values(fotos).some(doBanco) ? "Imagens ilustrativas, não são fotos do estabelecimento." : ""}${d.origem === "cadastro" ? "" : ` ${temNota ? "Nota e número de avaliações do Google" : "Endereço e contato do perfil público do Google"}, consultados em ${esc(d.consultado)}. Valores públicos, sujeitos a mudança.`}</p>
</footer>

${BOTAO_TOPO}
<a class="wpp-float" href="${oi}" target="_blank" rel="noopener" aria-label="Agendar pelo WhatsApp de ${esc(d.nome)}">${WA}</a>

<script>
var hd=document.getElementById('hd');
addEventListener('scroll',function(){hd.classList.toggle('scrolled',scrollY>40);},{passive:true});
var io=new IntersectionObserver(function(es){es.forEach(function(x){if(x.isIntersecting){x.target.classList.add('in');io.unobserve(x.target);}});},{threshold:.12});
document.querySelectorAll('.rv').forEach(function(el){io.observe(el);});
${porTelefone ? "" : `// dia de preferência a partir de hoje (no fuso de quem abre): o navegador recusa data passada
document.getElementById('wf-dia').min=new Date(Date.now()-new Date().getTimezoneOffset()*6e4).toISOString().slice(0,10);
document.getElementById('waform').addEventListener('submit',function(ev){
  ev.preventDefault();
  var f=ev.target, linhas=['Olá! Quero agendar um horário.','Nome: '+f.nome.value];
  if(f.servico.value)linhas.push('Serviço: '+f.servico.value);
  if(f.dia.value){var d=f.dia.value.split('-');linhas.push('Dia de preferência: '+d[2]+'/'+d[1]+'/'+d[0]);}
  if(f.periodo.value)linhas.push('Período: '+f.periodo.value);
  if(f.msg.value)linhas.push('Obs.: '+f.msg.value);
  window.open('https://wa.me/'+f.getAttribute('data-wa')+'?text='+encodeURIComponent(linhas.join('\\n')),'_blank');
});`}
</script>
<script src="../assets/fx.js" defer></script>
<script>window.addEventListener('load',function(){if(window.init3D)init3D('fx3d','${acc}',{shapes:12,opacity:.45});});</script>
</body>
</html>
`;
  return porTelefone ? paraTelefone(html, d.telefone, WA) : html;
}
