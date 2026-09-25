// Fitness no modelo editorial: academia, pilates, lutas e dança. Fotos do banco
// Pexels em public/s/assets/fitness/{sub}-{1,2} (créditos no creditos.json).
import type { Estilo } from "@/lib/site-editorial";

// escuro com um destaque vivo: laranja, vermelho, verde-limão, ciano e amarelo
const ENERGIA: Estilo["paletas"] = [
  ["#101112", "#FF5A1F", "#C8410F", "#fff0e9"],
  ["#121012", "#E0312B", "#A8221D", "#fce9e8"],
  ["#0F1210", "#8BC34A", "#5E8F2A", "#f0f7e8"],
  ["#0E1214", "#19B3C9", "#11808F", "#e6f7f9"],
  ["#131210", "#F5B400", "#B38400", "#fdf6e0"],
];
// pilates e dança pedem um tom mais leve que o de academia e luta
const LEVE: Estilo["paletas"] = [
  ["#141214", "#D9788C", "#B0566A", "#fbeff2"],
  ["#111314", "#5FA8A0", "#3F7F78", "#ecf6f5"],
  ["#131212", "#C9A24A", "#9E7C33", "#f8f3e9"],
  ["#121016", "#8E7CC3", "#6A5A9C", "#f1eff7"],
];

const kits = (sub: string) => [1, 2].map((n) => `/assets/fitness/${sub}-${n}`);

// avaliação e aula experimental são a porta de entrada: o selo diz isso
const DESCRICOES: [RegExp, string, string][] = [
  [/avalia[çc][ãa]o f[íi]sica|avalia[çc][ãa]o/i, "Medidas, objetivos e histórico para montar um treino que faça sentido para você.", "Primeiro passo"],
  [/experimental/i, "Conheça o espaço, a turma e o professor antes de decidir.", "Sem compromisso"],
  [/muscula/i, "Treino orientado, do básico ao avançado, com acompanhamento na sala.", "Todos os níveis"],
  [/funcional|cross/i, "Força, fôlego e mobilidade em aulas dinâmicas e em grupo.", "Intenso"],
  [/personal/i, "Treino individual, montado e acompanhado de perto pelo profissional.", "Individual"],
  [/pilates/i, "Fortalecimento, postura e flexibilidade com aparelhos e acompanhamento próximo.", "Postura"],
  [/yoga|alongamento/i, "Respiração, equilíbrio e flexibilidade para o corpo e a cabeça.", "Equilíbrio"],
  [/jiu|judô|judo/i, "Técnica, disciplina e condicionamento, da faixa branca às graduações.", "Técnica"],
  [/muay|boxe|kick|luta/i, "Golpes, condicionamento e defesa pessoal em aulas para todos os níveis.", "Condicionamento"],
  [/dan[çc]a|ritmo|zumba|forr|samba|ballet|bal[ée]/i, "Aulas animadas para aprender, suar e se divertir em grupo.", "Em turma"],
];

export const FITNESS: Record<"academia" | "pilates" | "lutas" | "danca", Estilo> = {
  academia: {
    rotulo: "Academia",
    textos: [
      "Treino orientado, equipamentos em dia e gente que te ajuda a chegar lá.",
      "Força, fôlego e resultado, com acompanhamento do primeiro dia em diante.",
      "O treino certo para o seu objetivo, com horário que cabe na sua rotina.",
    ],
    padrao: ["Avaliação física", "Musculação", "Treino funcional", "Personal trainer"],
    paletas: ENERGIA,
    kits: kits("academia"),
    descricoes: DESCRICOES,
    obs: "Ex.: objetivo, experiência com treino, alguma lesão…",
  },
  pilates: {
    rotulo: "Studio de pilates",
    textos: [
      "Postura, força e flexibilidade, com aulas em turmas pequenas.",
      "Pilates com acompanhamento próximo, no ritmo do seu corpo.",
      "Movimento consciente para se sentir bem no dia a dia.",
    ],
    padrao: ["Aula experimental", "Pilates em aparelhos", "Pilates solo", "Yoga"],
    paletas: LEVE,
    kits: kits("pilates"),
    descricoes: DESCRICOES,
    obs: "Ex.: objetivo, dor ou lesão, se já praticou…",
  },
  lutas: {
    rotulo: "Academia de lutas",
    textos: [
      "Técnica, disciplina e condicionamento, com professor que acompanha a sua evolução.",
      "Do primeiro treino às graduações, em um tatame que recebe bem quem está começando.",
      "Defesa pessoal, preparo físico e cabeça no lugar, em aulas para todos os níveis.",
    ],
    padrao: ["Aula experimental", "Jiu-jitsu", "Muay thai", "Boxe"],
    paletas: ENERGIA,
    kits: kits("lutas"),
    descricoes: DESCRICOES,
    obs: "Ex.: modalidade de interesse, experiência, idade…",
  },
  danca: {
    rotulo: "Escola de dança",
    textos: [
      "Aulas animadas para quem quer aprender, suar e se divertir.",
      "Do primeiro passo à coreografia, com turmas para todos os níveis.",
      "Ritmo, alegria e boa companhia, com horário que cabe na sua semana.",
    ],
    padrao: ["Aula experimental", "Dança de salão", "Ritmos", "Ballet adulto"],
    paletas: LEVE,
    kits: kits("danca"),
    descricoes: DESCRICOES,
    obs: "Ex.: estilo que quer aprender, se já dançou…",
  },
};
