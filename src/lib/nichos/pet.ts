// Conteúdo do modelo claro para pet shop e veterinária: o mesmo dos 241 sites de
// pet da fábrica. Fotos em public/s/assets/pet (alt tirado do creditos.json).
import type { Conteudo } from "@/lib/site-claro";

const PATA = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 13.2c2.5 0 4.5 1.8 4.5 3.6 0 1.6-1.4 2.4-3 2.4h-3c-1.6 0-3-.8-3-2.4 0-1.8 2-3.6 4.5-3.6z"/><ellipse cx="6.6" cy="11" rx="1.8" ry="2.2"/><ellipse cx="17.4" cy="11" rx="1.8" ry="2.2"/><ellipse cx="9.6" cy="7" rx="1.7" ry="2.3"/><ellipse cx="14.4" cy="7" rx="1.7" ry="2.3"/></svg>';

// paletas reais dos sites de pet, das mais usadas: [claro, escuro]
export const PALETAS_PET: [string, string][] = [
  ["--accent:#1B6B4F;--gold:#F0B429;--bg:#F1F6F4;--surface:#FFFFFF;--text:#082018;--muted:#587C6F;--border:#DBE7E3;--accent-ink:#FFFFFF;--gold-ink:#1B1208;", "--accent:#5B9480;--gold:#F3C458;--bg:#051510;--surface:#082018;--text:#EFF5F3;--muted:#A8C7BC;--border:#0D3326;"],
  ["--accent:#7A4A22;--gold:#7FB069;--bg:#F7F4F2;--surface:#FFFFFF;--text:#25160A;--muted:#836D5B;--border:#EAE2DC;--accent-ink:#FFFFFF;--gold-ink:#1B1208;", "--accent:#9F7D60;--gold:#9BC18A;--bg:#180F07;--surface:#25160A;--text:#F6F2F0;--muted:#CCBAAB;--border:#3B2410;"],
  ["--accent:#10706E;--gold:#F6A623;--bg:#F1F6F6;--surface:#FFFFFF;--text:#052221;--muted:#537E7D;--border:#D9E8E8;--accent-ink:#FFFFFF;--gold-ink:#1B1208;", "--accent:#539897;--gold:#F8BA53;--bg:#031616;--surface:#052221;--text:#EEF5F5;--muted:#A4C9C8;--border:#083635;"],
  ["--accent:#5B3A8C;--gold:#F3A712;--bg:#F5F3F8;--surface:#FFFFFF;--text:#1B112A;--muted:#75668B;--border:#E5DFED;--accent-ink:#FFFFFF;--gold-ink:#1B1208;", "--accent:#8971AC;--gold:#F6BA46;--bg:#120C1C;--surface:#1B112A;--text:#F4F1F7;--muted:#C1B4D3;--border:#2C1C43;"],
  ["--accent:#14557A;--gold:#F2A93B;--bg:#F1F5F7;--surface:#FFFFFF;--text:#061A25;--muted:#557283;--border:#D9E4EA;--accent-ink:#FFFFFF;--gold-ink:#1B1208;", "--accent:#56859F;--gold:#F5BC66;--bg:#041118;--surface:#061A25;--text:#EFF3F6;--muted:#A6BECC;--border:#0A293B;"],
  ["--accent:#33417A;--gold:#F7B32B;--bg:#F3F4F7;--surface:#FFFFFF;--text:#0F1425;--muted:#636983;--border:#DEE1EA;--accent-ink:#FFFFFF;--gold-ink:#1B1208;", "--accent:#6C769F;--gold:#F9C45A;--bg:#0A0D18;--surface:#0F1425;--text:#F1F2F6;--muted:#B1B7CC;--border:#181F3B;"],
  ["--accent:#C2551F;--gold:#2C9C8F;--bg:#FBF5F2;--surface:#FFFFFF;--text:#3A1A09;--muted:#A3725A;--border:#F5E4DB;--accent-ink:#FFFFFF;--gold-ink:#1B1208;", "--accent:#D3855E;--gold:#5AB2A8;--bg:#271106;--surface:#3A1A09;--text:#FBF3EF;--muted:#E8BEAA;--border:#5D290F;"],
];

// todas 1400×933 com versão -800
const FOTOS: Record<string, string> = {
  "loja-balcao": "Atendimento no balcão de um pet shop",
  "loja-coleiras": "Coleiras e acessórios expostos no pet shop",
  "banho-banheira": "Cão tomando banho na banheira do pet shop",
  "tosa-mesa": "Profissional tosando um cão na mesa de banho e tosa",
  "tosa-pente": "Pente passando no pelo de um cão durante a tosa",
  "tosa-salao": "Cão esperando o banho no salão de banho e tosa",
  "feliz-colo": "Cão no colo do tutor recebendo carinho",
  "feliz-lambida": "Cão lambendo o rosto da tutora",
  "hotel-corrida": "Dois cães correndo soltos no gramado",
  "vet-dupla": "Dois veterinários examinando um cão na clínica",
  "vet-consulta": "Veterinário segurando um cão durante a consulta",
  "vet-mesa": "Veterinário examinando um cão sobre a mesa clínica",
  "vet-cao-calmo": "Veterinário acalmando um cão antes do exame",
  "gato-exame": "Veterinária examinando um gato branco na clínica",
  "gato-filhote": "Filhote de gato sendo atendido na mesa da clínica",
  "gato-vacina": "Aplicação de vacina em um gato na clínica",
  "proc-ultrassom": "Veterinária fazendo ultrassom em um cão",
  "proc-curativo": "Curativo sendo feito na pata de um gato",
};

const DESCRICOES: [RegExp, string][] = [
  [/banho\s*(e|\+)\s*tosa/i, "Banho completo com tosa no padrão que você escolher."],
  [/tosa/i, "Higiênica, na máquina ou na tesoura, conforme a raça e o seu gosto."],
  [/banho/i, "Shampoo certo para o pelo, secagem cuidadosa e perfume suave."],
  [/consulta|clínic|clinic|avalia/i, "Exame clínico completo e orientação clara sobre o que fazer."],
  [/vacina/i, "Protocolo de vacinas para cães e gatos, com carteira em dia."],
  [/exame|ultrassom|raio|laborat/i, "Exames para diagnóstico, com acompanhamento do resultado."],
  [/castra|cirurg/i, "Procedimento com avaliação prévia e orientação para o pós-operatório."],
  [/hotel|creche|hospeda/i, "Espaço seguro para o seu pet passar o dia ou a noite."],
  [/raç|racao|aliment/i, "Rações secas e úmidas por porte, idade e restrição alimentar."],
  [/acess|brinqu|colei/i, "Coleiras, camas, brinquedos e o que mais o seu pet precisar."],
];

const BASE = {
  pasta: "pet",
  fotos: FOTOS,
  paletas: PALETAS_PET,
  descricoes: DESCRICOES,
  icone: PATA,
  textos: {
    oi: "quero falar sobre um atendimento para o meu pet.",
    servicos: (nome: string) => `O que a ${nome} faz pelo seu pet`,
    passos: "O que acontece do agendamento à saída do seu pet — sem surpresa e sem letra miúda.",
    galeria: ["O dia a dia", "Cuidado que se vê"] as [string, string],
    valores: "O preço varia com o porte, a pelagem e o que o seu pet precisa. Toque em “pedir valor” e receba o orçamento do serviço já no WhatsApp.",
    agendar: "Marque o horário do seu pet",
    obs: ["Nome, porte e raça do pet (opcional)", "Ex.: Nina, shih-tzu pequena, um pouco assustada com secador"] as [string, string],
  },
};

export const PET: Record<"petshop" | "vet", Conteudo> = {
  petshop: {
    ...BASE,
    rotulo: "Pet shop",
    padrao: ["Banho", "Tosa"],
    topo: ["loja-balcao", "banho-banheira", "tosa-mesa", "tosa-salao"],
    galeria: ["feliz-colo", "tosa-pente", "feliz-lambida", "hotel-corrida", "loja-coleiras", "banho-banheira"],
    passos: [
    ["banho-banheira", "Banho com produto certo", "Shampoo e condicionador escolhidos pelo tipo de pelo e pela pele do seu pet, com secagem sem pressa."],
    ["tosa-mesa", "Tosa do jeito combinado", "Higiênica, na máquina ou na tesoura: você diz como quer e a equipe confirma antes de começar."],
    ["feliz-colo", "Entrega com carinho", "Seu pet volta cheiroso e tranquilo — e você recebe o aviso pelo WhatsApp quando estiver pronto."],
  ],
    titulos: [
    ["Tudo para o seu pet,", "pertinho de você", "Banho, tosa, ração e acessórios com atendimento de quem conhece o bairro. Chame no WhatsApp e agende."],
    ["Seu pet limpo, cheiroso", "e bem cuidado", "Banho e tosa com carinho, produtos certos e hora marcada. Fale pelo WhatsApp e reserve o horário."],
    ["Cuidado de verdade", "para quem é da família", "Atendimento próximo, sem pressa e com a atenção que o seu pet merece. Agende pelo WhatsApp."],
  ],
    faq: [
    ["Como agendo o banho e tosa?", "Pelo WhatsApp ou pelo botão “Agendar online”: escolha o serviço e o horário, e a equipe confirma."],
    ["Precisa levar alguma coisa?", "Só o seu pet. Se ele tiver alguma alergia ou sensibilidade, avise na hora de agendar."],
    ["Quanto custa?", "O valor depende do porte e da pelagem. Toque em “Pedir valor” na tabela e receba o orçamento no WhatsApp."],
    ["Vocês vendem ração e acessórios?", "Pergunte pelo WhatsApp pelo item que você precisa — a loja confirma disponibilidade e preço."],
  ],
  },
  vet: {
    ...BASE,
    rotulo: "Clínica veterinária",
    padrao: ["Consulta veterinária", "Vacinação"],
    topo: ["vet-dupla", "vet-consulta", "vet-mesa", "gato-exame"],
    galeria: ["vet-cao-calmo", "gato-filhote", "feliz-colo", "proc-curativo", "vet-consulta", "gato-vacina"],
    passos: [
    ["vet-consulta", "Consulta sem pressa", "Histórico, exame físico e explicação clara do que foi visto — com espaço para todas as suas dúvidas."],
    ["gato-vacina", "Vacinas em dia", "Carteira de vacinação organizada, com lembrete das próximas doses para cães e gatos."],
    ["proc-ultrassom", "Exames quando precisa", "Quando o caso pede, a equipe orienta sobre exames e acompanha o resultado com você."],
  ],
    titulos: [
    ["Saúde do seu pet", "em boas mãos", "Consultas, vacinas e acompanhamento com atendimento próximo. Chame no WhatsApp e marque o horário."],
    ["Veterinário perto de você,", "quando você precisa", "Consulta, vacinação e orientação clara para cães e gatos. Agende pelo WhatsApp."],
    ["Cuidado clínico", "com carinho de verdade", "Atendimento atento para o seu pet em todas as fases da vida. Fale com a equipe pelo WhatsApp."],
  ],
    faq: [
    ["Como marco uma consulta?", "Pelo WhatsApp ou pelo botão “Agendar online”. Conte o que o seu pet está sentindo para a equipe se preparar."],
    ["Atendem cães e gatos?", "Sim. Se o seu pet for de outra espécie, pergunte pelo WhatsApp antes de vir."],
    ["Quanto custa a consulta?", "Toque em “Pedir valor” na tabela e receba o valor atualizado pelo WhatsApp."],
    ["E em caso de urgência?", "Chame no WhatsApp antes de sair de casa: a equipe orienta e confirma se pode receber o seu pet na hora."],
  ],
  },
};
