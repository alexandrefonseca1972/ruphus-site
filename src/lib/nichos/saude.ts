// Saúde no modelo claro: odontologia, fisioterapia, psicologia, nutrição e clínica.
// Fotos do banco Pexels em public/s/assets/saude (créditos no creditos.json).
//
// Publicidade em saúde tem regra de conselho (CFM, CRO, CFP, CRN, COFFITO): nada de
// "antes e depois", promessa de resultado, superlativo ("o melhor") nem preço
// anunciado. Os textos aqui são sóbrios de propósito, a tabela só pede valor pelo
// WhatsApp e a agenda nasce sem preço (src/lib/catalogo.ts).
import type { Conteudo } from "@/lib/site-claro";

const CRUZ = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20.5s-7.5-4.4-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.8-7.5 10.2-7.5 10.2z"/><path d="M9 12.5h1.8l1-2 1.6 4 1-2H16"/></svg>';

// claras e calmas: azul clínico, verde-água, lavanda, verde-folha e petróleo
const PALETAS: [string, string][] = [
  ["--accent:#1E5A8A;--gold:#3BB3A6;--bg:#F3F7FA;--surface:#FFFFFF;--text:#0B1E2D;--muted:#5A7285;--border:#DCE6EE;--accent-ink:#FFFFFF;--gold-ink:#062521;", "--accent:#5B8FBA;--gold:#5CC7BB;--bg:#07121B;--surface:#0B1E2D;--text:#EEF3F7;--muted:#A7BCCB;--border:#16324A;"],
  ["--accent:#0F766E;--gold:#F2A93B;--bg:#F1F7F6;--surface:#FFFFFF;--text:#062421;--muted:#557A75;--border:#D8E8E5;--accent-ink:#FFFFFF;--gold-ink:#1B1208;", "--accent:#4FA39A;--gold:#F5BC66;--bg:#041614;--surface:#062421;--text:#EEF6F5;--muted:#A3C7C2;--border:#0B3A35;"],
  ["--accent:#5B4B8A;--gold:#E0A458;--bg:#F6F4F9;--surface:#FFFFFF;--text:#1C1530;--muted:#6F6688;--border:#E6E1EF;--accent-ink:#FFFFFF;--gold-ink:#1B1208;", "--accent:#8C7DBE;--gold:#EBB877;--bg:#110D1D;--surface:#1C1530;--text:#F4F2F8;--muted:#C0B7D6;--border:#2D2447;"],
  ["--accent:#2F6B3A;--gold:#E8A33D;--bg:#F4F7F1;--surface:#FFFFFF;--text:#10200F;--muted:#5E7658;--border:#DFE8DA;--accent-ink:#FFFFFF;--gold-ink:#1B1208;", "--accent:#6A9C72;--gold:#F0B85E;--bg:#0A1509;--surface:#10200F;--text:#F1F5EF;--muted:#B1C6AC;--border:#1E3A1C;"],
  ["--accent:#135B6E;--gold:#E9896B;--bg:#F2F6F7;--surface:#FFFFFF;--text:#07212A;--muted:#557580;--border:#D9E5E8;--accent-ink:#FFFFFF;--gold-ink:#2A0F06;", "--accent:#4F93A6;--gold:#EFA58C;--bg:#04141A;--surface:#07212A;--text:#EEF4F6;--muted:#A5C1C9;--border:#0E3643;"],
];

// alt do creditos.json; todas 1400×933 com versão -800
const FOTOS: Record<string, string> = {
  "odonto-consulta": "Dentista atendendo paciente na cadeira em consultório claro",
  "odonto-consultorio": "Consultório odontológico moderno com cadeira e equipamentos",
  "odonto-cadeira": "Cadeira odontológica em sala limpa e iluminada",
  "odonto-conversa": "Dentista conversando com paciente antes do procedimento",
  "odonto-instrumentos": "Detalhe das peças de mão do equipo odontológico",
  "fisio-sessao": "Fisioterapeuta alongando a perna de paciente em sala ampla e clara",
  "fisio-pilates": "Exercício no aparelho de pilates com acompanhamento da fisioterapeuta",
  "fisio-alongamento": "Fisioterapeuta orientando alongamento lateral do paciente",
  "fisio-reabilitacao": "Paciente deitado na maca fazendo exercício de reabilitação",
  "fisio-elastico": "Paciente fazendo exercício com faixa elástica guiado pelo fisioterapeuta",
  "fisio-avaliacao": "Fisioterapeuta avaliando pescoço e ombro da paciente",
  "psico-sessao": "Sessão de terapia em sala aconchegante com sofá e plantas",
  "psico-diva": "Paciente deitada no divã conversando com a psicóloga",
  "psico-sala": "Paciente falando no sofá enquanto a terapeuta faz anotações",
  "psico-escuta": "Psicóloga ouvindo a paciente com atenção",
  "psico-conversa": "Terapeuta e paciente conversando em consultório tranquilo",
  "psico-anotacoes": "Terapeuta com prancheta em sala clara com janela",
  "nutri-consultorio": "Nutricionista escrevendo à mesa do consultório com frutas",
  "nutri-consulta": "Nutricionista atendendo paciente na mesa do consultório",
  "nutri-nutricionista": "Nutricionista segurando brócolis com fita métrica no pescoço",
  "nutri-medidas": "Nutricionista medindo a cintura do paciente com fita métrica",
  "nutri-frutas": "Fruteira e prancheta de plano alimentar sobre a mesa",
  "clinica-recepcao": "Recepção e sala de espera de clínica clara e organizada",
  "clinica-consultorio": "Médico atendendo paciente em consultório amplo",
  "clinica-consulta": "Médica sorridente conversando com paciente à mesa",
  "clinica-atendimento": "Médica conversando com gestante no consultório",
  "clinica-medica": "Médica com estetoscópio preenchendo prontuário à mesa",
  "clinica-prontuario": "Médico segurando prancheta com ficha do paciente",
};

const DESCRICOES: [RegExp, string][] = [
  [/avalia|primeira consulta|triagem/i, "Conversa inicial para entender o seu caso e explicar os próximos passos."],
  [/retorno|acompanhamento/i, "Consulta de acompanhamento para ver a evolução e ajustar o que for preciso."],
  [/limpeza|profilax/i, "Remoção de placa e tártaro, com orientação de higiene em casa."],
  [/clareamento/i, "Procedimento indicado após avaliação, com acompanhamento do dentista."],
  [/restaura|obtura/i, "Tratamento de cáries e reparo de dentes, com material adequado a cada caso."],
  [/canal|endodont/i, "Tratamento da polpa do dente, feito com anestesia e em etapas."],
  [/ortodont|aparelho|alinhador/i, "Avaliação e acompanhamento do alinhamento dos dentes."],
  [/implante|pr[óo]tese/i, "Reabilitação indicada após avaliação clínica e exames."],
  [/fisioterapia|sess[ãa]o de fisio|reabilita/i, "Exercícios e técnicas para recuperar movimento, força e reduzir a dor."],
  [/rpg|postura|pilates/i, "Trabalho de postura e fortalecimento, com acompanhamento próximo."],
  [/terapia|psicoterapia|sess[ãa]o/i, "Espaço de escuta e acolhimento, com sigilo profissional."],
  [/casal|fam[íi]lia/i, "Atendimento conjunto para conversar sobre a relação com mediação profissional."],
  [/online/i, "Atendimento por vídeo, com a mesma privacidade do consultório."],
  [/plano alimentar|dieta|reeduca/i, "Plano alimentar individual, pensado para a sua rotina e o seu objetivo."],
  [/bioimped|composi[çc][ãa]o/i, "Medida de composição corporal para acompanhar a evolução."],
  [/consulta/i, "Atendimento com tempo para ouvir, examinar e explicar o que foi visto."],
  [/exame|check-?up/i, "Pedido e avaliação de exames, com retorno para conversar sobre o resultado."],
];

const TEXTOS: Conteudo["textos"] = {
  oi: "quero agendar uma consulta.",
  servicos: (nome) => `O que a ${nome} oferece`,
  passos: "Como é o atendimento, do primeiro contato ao retorno — com tempo e explicação clara.",
  galeria: ["O espaço", "Um lugar pensado para você"],
  valores: "Cada caso é avaliado na consulta. Toque em “pedir valor” e receba as informações pelo WhatsApp.",
  agendar: "Agende sua consulta",
  obs: ["O que você quer tratar (opcional)", "Ex.: primeira consulta, retorno, melhor período do dia…"],
};

const BASE = { pasta: "saude", fotos: FOTOS, paletas: PALETAS, descricoes: DESCRICOES, icone: CRUZ, textos: TEXTOS };

export const SAUDE: Record<"odonto" | "fisio" | "psico" | "nutri" | "clinica", Conteudo> = {
  odonto: {
    ...BASE,
    rotulo: "Consultório odontológico",
    padrao: ["Avaliação odontológica", "Limpeza", "Restauração", "Clareamento"],
    topo: ["odonto-consulta", "odonto-consultorio", "odonto-cadeira"],
    galeria: ["odonto-consultorio", "odonto-conversa", "odonto-instrumentos", "odonto-cadeira", "odonto-consulta"],
    passos: [
      ["odonto-conversa", "Avaliação sem pressa", "O dentista ouve o que você sente, examina e explica as opções antes de qualquer procedimento."],
      ["odonto-consulta", "Tratamento em etapas", "Cada etapa é combinada com você, com anestesia quando precisa e conforto na cadeira."],
      ["odonto-instrumentos", "Material esterilizado", "Instrumentais esterilizados e descartáveis, seguindo as normas de biossegurança."],
    ],
    titulos: [
      ["Cuidado com o seu sorriso,", "com calma e atenção", "Avaliação, limpeza e tratamentos explicados passo a passo. Agende pelo WhatsApp."],
      ["Dentista perto de você,", "no horário que você precisa", "Atendimento com hora marcada e explicação clara de cada etapa. Fale pelo WhatsApp."],
      ["Consultório odontológico", "com atendimento próximo", "Da avaliação ao retorno, você sabe o que vai ser feito. Agende a sua consulta."],
    ],
    faq: [
      ["Como marco a primeira consulta?", "Pelo WhatsApp ou pelo botão “Agendar online”. Na avaliação, o dentista examina e explica as opções."],
      ["Atendem urgência?", "Chame no WhatsApp: a equipe verifica a agenda do dia e orienta o que fazer até o atendimento."],
      ["Quanto custa?", "O valor depende do que for indicado na avaliação. Peça as informações pelo WhatsApp."],
      ["Aceitam convênio?", "Pergunte pelo WhatsApp quais planos são atendidos."],
    ],
  },
  fisio: {
    ...BASE,
    rotulo: "Fisioterapia",
    padrao: ["Avaliação fisioterapêutica", "Sessão de fisioterapia", "RPG", "Pilates clínico"],
    topo: ["fisio-sessao", "fisio-pilates", "fisio-alongamento"],
    galeria: ["fisio-elastico", "fisio-reabilitacao", "fisio-pilates", "fisio-avaliacao", "fisio-sessao", "fisio-alongamento"],
    passos: [
      ["fisio-avaliacao", "Avaliação completa", "Histórico, testes de movimento e objetivos: o ponto de partida do seu tratamento."],
      ["fisio-sessao", "Sessões acompanhadas", "Exercícios e técnicas feitos com o fisioterapeuta ao lado, no seu ritmo."],
      ["fisio-elastico", "Exercícios para casa", "Orientações simples para continuar a recuperação entre uma sessão e outra."],
    ],
    titulos: [
      ["Movimento de volta,", "no seu ritmo", "Avaliação e sessões acompanhadas de perto para recuperar força e mobilidade. Agende pelo WhatsApp."],
      ["Fisioterapia com", "acompanhamento próximo", "Tratamento pensado para o seu caso, com exercícios explicados. Fale pelo WhatsApp."],
      ["Menos dor,", "mais disposição no dia a dia", "Reabilitação, postura e fortalecimento com hora marcada. Agende a sua avaliação."],
    ],
    faq: [
      ["Preciso de pedido médico?", "Não é obrigatório para a avaliação. Se tiver exames ou pedido, leve na primeira sessão."],
      ["Quanto tempo dura a sessão?", "Em geral de 40 minutos a 1 hora, conforme o tratamento indicado."],
      ["Que roupa devo usar?", "Roupa confortável, que permita movimentar bem braços e pernas."],
      ["Atendem convênio?", "Pergunte pelo WhatsApp quais planos são atendidos."],
    ],
  },
  psico: {
    ...BASE,
    rotulo: "Psicologia",
    padrao: ["Primeira consulta", "Psicoterapia individual", "Terapia de casal", "Atendimento online"],
    topo: ["psico-sessao", "psico-diva"],
    galeria: ["psico-sala", "psico-escuta", "psico-conversa", "psico-anotacoes", "psico-sessao", "psico-diva"],
    passos: [
      ["psico-conversa", "Primeiro encontro", "Uma conversa para entender o que te trouxe até aqui e combinar como serão as sessões."],
      ["psico-escuta", "Escuta e sigilo", "Um espaço seguro para falar, com sigilo profissional garantido pelo código de ética."],
      ["psico-sessao", "Acompanhamento regular", "Sessões na frequência combinada, presenciais ou online."],
    ],
    titulos: [
      ["Um espaço para você", "ser ouvido", "Psicoterapia com acolhimento, escuta e sigilo. Agende a primeira conversa pelo WhatsApp."],
      ["Cuidar da mente", "também é saúde", "Atendimento presencial e online, no horário que cabe na sua rotina. Fale pelo WhatsApp."],
      ["Terapia com", "acolhimento e respeito", "Sessões individuais, de casal ou online. Agende o seu horário."],
    ],
    faq: [
      ["Como funciona a primeira sessão?", "É uma conversa para entender o que você busca e combinar como será o acompanhamento."],
      ["O que eu falo fica em sigilo?", "Sim. O sigilo é um dever profissional do psicólogo."],
      ["Tem atendimento online?", "Pergunte pelo WhatsApp: a equipe informa os horários disponíveis por vídeo."],
      ["Quanto tempo dura cada sessão?", "Em geral cerca de 50 minutos, uma vez por semana ou conforme combinado."],
    ],
  },
  nutri: {
    ...BASE,
    rotulo: "Nutrição",
    padrao: ["Consulta nutricional", "Retorno", "Bioimpedância", "Plano alimentar"],
    topo: ["nutri-consultorio", "nutri-consulta"],
    galeria: ["nutri-frutas", "nutri-medidas", "nutri-nutricionista", "nutri-consulta", "nutri-consultorio"],
    passos: [
      ["nutri-consulta", "Consulta e objetivos", "Rotina, hábitos, preferências e exames para entender o que faz sentido para você."],
      ["nutri-medidas", "Medidas e acompanhamento", "Avaliação corporal para acompanhar a evolução a cada retorno."],
      ["nutri-frutas", "Plano alimentar individual", "Um plano que cabe na sua rotina e no seu gosto, ajustado nos retornos."],
    ],
    titulos: [
      ["Comer bem,", "do seu jeito", "Plano alimentar individual e acompanhamento de perto. Agende a consulta pelo WhatsApp."],
      ["Nutrição que cabe", "na sua rotina", "Consulta, avaliação corporal e retornos para ajustar o plano. Fale pelo WhatsApp."],
      ["Alimentação com", "orientação profissional", "Atendimento individual, sem receita pronta. Agende o seu horário."],
    ],
    faq: [
      ["Preciso levar exames?", "Se tiver exames recentes, leve na consulta. Se não tiver, a nutricionista orienta."],
      ["Quanto tempo dura a consulta?", "A primeira costuma levar cerca de 1 hora; os retornos são mais curtos."],
      ["De quanto em quanto tempo é o retorno?", "Em geral a cada 30 a 45 dias, conforme o seu objetivo."],
      ["Atende online?", "Pergunte pelo WhatsApp sobre consultas por vídeo."],
    ],
  },
  clinica: {
    ...BASE,
    rotulo: "Clínica médica",
    padrao: ["Consulta", "Retorno", "Check-up"],
    topo: ["clinica-recepcao", "clinica-consultorio", "clinica-consulta"],
    galeria: ["clinica-medica", "clinica-atendimento", "clinica-prontuario", "clinica-recepcao", "clinica-consultorio", "clinica-consulta"],
    passos: [
      ["clinica-recepcao", "Recepção e cadastro", "Você chega, é recebido e já sabe quanto tempo vai esperar."],
      ["clinica-consulta", "Consulta com tempo", "O médico ouve, examina e explica o que foi visto e os próximos passos."],
      ["clinica-prontuario", "Retorno e exames", "Pedido de exames quando necessário e retorno para conversar sobre os resultados."],
    ],
    titulos: [
      ["Atendimento médico", "perto de você", "Consultas com hora marcada e explicação clara. Agende pelo WhatsApp."],
      ["Consulta com tempo", "para ouvir e explicar", "Atendimento atento, do primeiro contato ao retorno. Fale pelo WhatsApp."],
      ["Saúde com", "atendimento próximo", "Clínica com agenda organizada e equipe acolhedora. Agende a sua consulta."],
    ],
    faq: [
      ["Como agendo uma consulta?", "Pelo WhatsApp ou pelo botão “Agendar online”: escolha o horário e a equipe confirma."],
      ["Aceitam convênio?", "Pergunte pelo WhatsApp quais planos são atendidos."],
      ["Preciso levar alguma coisa?", "Documento com foto e, se tiver, exames e receitas recentes."],
      ["E se eu precisar remarcar?", "Avise pelo WhatsApp com antecedência para liberar o horário."],
    ],
  },
};
