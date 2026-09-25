// Automotivo no modelo editorial: oficina, estética automotiva/lava-jato e pneus.
// Fotos do banco Pexels em public/s/assets/automotivo/{pasta}-{1,2}.
import type { Estilo } from "@/lib/site-editorial";

// grafite com destaque de oficina: âmbar, laranja, vermelho e azul-aço
const GRAFITE: Estilo["paletas"] = [
  ["#111315", "#F2A900", "#B37D00", "#fdf5e0"],
  ["#121314", "#FF6B1A", "#C24F0F", "#fff0e7"],
  ["#131212", "#D7261E", "#A11C16", "#fbe8e7"],
  ["#0F1216", "#3A7BD5", "#2A5CA3", "#e9f1fc"],
];

const kits = (pasta: string) => [1, 2].map((n) => `/assets/automotivo/${pasta}-${n}`);

// orçamento e diagnóstico antes de tudo: é o que o dono do carro quer saber
const DESCRICOES: [RegExp, string, string][] = [
  [/diagn[óo]stico|scanner|inje[çc][ãa]o/i, "Leitura eletrônica e avaliação para achar a causa, não só o sintoma.", "Diagnóstico"],
  [/revis[ãa]o/i, "Checklist completo, troca do que precisa e orçamento antes de começar.", "Preventiva"],
  [/[óo]leo|filtro/i, "Troca de óleo e filtros com o produto indicado para o seu motor.", "Rápido"],
  [/freio/i, "Pastilhas, discos e fluido conferidos, para frear com segurança.", "Segurança"],
  [/suspens|amortec/i, "Amortecedores, buchas e alinhamento de volta ao lugar.", "Conforto"],
  [/ar[ -]condicionado|climatiza/i, "Higienização, carga de gás e manutenção do ar do carro.", "Clima"],
  [/el[ée]tric|bateria/i, "Bateria, alternador e parte elétrica testados com equipamento.", "Elétrica"],
  [/lavagem|lava/i, "Lavagem cuidadosa por fora e por dentro, com produtos próprios para pintura.", "Brilho"],
  [/polimento|vitrific|cristaliz/i, "Correção de riscos leves e proteção que devolve o brilho à pintura.", "Acabamento"],
  [/higieniza|interna|estofad/i, "Bancos, carpetes e painel limpos a fundo, sem cheiro de produto forte.", "Interior"],
  [/alinhamento|balanceamento|geometria/i, "Direção no lugar e pneus gastando por igual, com máquina aferida.", "Precisão"],
  [/pneu|roda/i, "Troca, reparo e montagem de pneus, com a medida certa para o seu carro.", "Na hora"],
  [/or[çc]amento/i, "Conte o que está acontecendo e receba o orçamento pelo WhatsApp, sem compromisso.", "Sem compromisso"],
];

export const AUTOMOTIVO: Record<"oficina" | "lavagem" | "pneus", Estilo> = {
  oficina: {
    rotulo: "Oficina mecânica",
    textos: [
      "Diagnóstico honesto, orçamento antes de mexer e serviço bem feito.",
      "Mecânica de confiança, com peça certa e prazo combinado.",
      "Do óleo à suspensão, o seu carro em boas mãos e sem surpresa na conta.",
    ],
    padrao: ["Revisão", "Troca de óleo", "Freios", "Suspensão", "Diagnóstico"],
    paletas: GRAFITE,
    kits: kits("oficina"),
    descricoes: DESCRICOES,
    obs: "Ex.: modelo e ano do carro, o que está acontecendo…",
  },
  lavagem: {
    rotulo: "Estética automotiva",
    textos: [
      "Lavagem cuidadosa, polimento e interior como novo.",
      "O brilho do carro de volta, com produto certo e mão caprichosa.",
      "Do lava-jato ao polimento técnico, o seu carro tratado com cuidado.",
    ],
    padrao: ["Lavagem completa", "Higienização interna", "Polimento", "Vitrificação"],
    paletas: GRAFITE,
    kits: kits("estetica"),
    descricoes: DESCRICOES,
    obs: "Ex.: modelo do carro, cor, se tem risco ou mancha…",
  },
  pneus: {
    rotulo: "Centro de pneus",
    textos: [
      "Pneu certo, alinhamento e balanceamento para rodar com segurança.",
      "Troca, reparo e geometria com máquina aferida e atendimento rápido.",
      "Do pneu furado ao alinhamento, resolvido na hora.",
    ],
    padrao: ["Alinhamento", "Balanceamento", "Troca de pneus", "Reparo de pneu"],
    paletas: GRAFITE,
    kits: kits("pneus"),
    descricoes: DESCRICOES,
    obs: "Ex.: medida do pneu, modelo do carro…",
  },
};
