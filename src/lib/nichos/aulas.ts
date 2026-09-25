// Aulas e cursos no modelo claro: idiomas, reforço escolar, música e autoescola.
// Fotos do banco Pexels em public/s/assets/aulas (créditos no creditos.json).
// Autoescola só com alunos adultos: habilitação é a partir dos 18.
import type { Conteudo } from "@/lib/site-claro";

const LIVRO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/><path d="M8 7h8M8 10.5h6"/></svg>';

// acolhedoras: azul-marinho, terracota, verde, ameixa e mostarda
const PALETAS: [string, string][] = [
  ["--accent:#1F3A68;--gold:#F2B33D;--bg:#F4F6FA;--surface:#FFFFFF;--text:#0D1A2E;--muted:#5D6B82;--border:#DEE3EC;--accent-ink:#FFFFFF;--gold-ink:#1B1208;", "--accent:#5A77A8;--gold:#F5C466;--bg:#070E19;--surface:#0D1A2E;--text:#EFF2F7;--muted:#AAB7CB;--border:#1A2D4D;"],
  ["--accent:#B4532A;--gold:#2E8B84;--bg:#FBF5F1;--surface:#FFFFFF;--text:#2E160B;--muted:#8F6A57;--border:#F1E2D8;--accent-ink:#FFFFFF;--gold-ink:#FFFFFF;", "--accent:#D5845F;--gold:#5BB0A9;--bg:#1C0D06;--surface:#2E160B;--text:#FBF3EE;--muted:#E1BEAB;--border:#4D2614;"],
  ["--accent:#2E6B4F;--gold:#F0B429;--bg:#F2F7F4;--surface:#FFFFFF;--text:#0B2016;--muted:#587C6B;--border:#DBE8E1;--accent-ink:#FFFFFF;--gold-ink:#1B1208;", "--accent:#62A083;--gold:#F3C458;--bg:#06140D;--surface:#0B2016;--text:#EFF6F2;--muted:#A8C8B8;--border:#123626;"],
  ["--accent:#6B2E5F;--gold:#F29E4C;--bg:#F8F3F7;--surface:#FFFFFF;--text:#26101F;--muted:#86667D;--border:#EDE0EA;--accent-ink:#FFFFFF;--gold-ink:#1B1208;", "--accent:#A0659A;--gold:#F5B576;--bg:#170A13;--surface:#26101F;--text:#F8F1F6;--muted:#D2B6CB;--border:#3F1B34;"],
  ["--accent:#8A6A12;--gold:#2F5D8A;--bg:#FAF7EE;--surface:#FFFFFF;--text:#231B05;--muted:#7D7055;--border:#EEE7D3;--accent-ink:#FFFFFF;--gold-ink:#FFFFFF;", "--accent:#C3A24B;--gold:#6D95BE;--bg:#151003;--surface:#231B05;--text:#F9F6EC;--muted:#D4C7A3;--border:#3D300B;"],
];

// alt do creditos.json; todas 1400×933 com versão -800
const FOTOS: Record<string, string> = {
  "idiomas-turma": "Turma de adultos em aula de idiomas com professor",
  "idiomas-sala": "Aluna levanta a mão em aula de idiomas para adultos",
  "idiomas-participacao": "Aluna participa da aula enquanto o professor explica",
  "idiomas-conversacao": "Duas alunas praticam conversação",
  "idiomas-aula-online": "Professor dá aula de idiomas online por videochamada",
  "idiomas-conversa-cafe": "Aluna e professor conversam em aula ao ar livre",
  "reforco-biblioteca": "Jovens estudam juntos na biblioteca",
  "reforco-tutora": "Professora acompanha aluna em aula de reforço",
  "reforco-explicacao": "Professora ajuda adolescente com a lição",
  "reforco-dupla": "Dois estudantes revisam matéria com livro e notebook",
  "reforco-grupo": "Professor orienta grupo de estudantes na biblioteca",
  "musica-violao-aula": "Professor e aluno tocam violão e guitarra na sala de aula",
  "musica-piano": "Aluna estuda piano com partitura",
  "musica-violao": "Professor ensina acorde de violão ao aluno",
  "musica-piano-aula": "Professor acompanha adolescente no piano",
  "musica-canto": "Aluna sorri durante aula de canto no estúdio",
  "musica-teclado": "Adolescente toca teclado com a professora ao lado",
  "autoescola-rodovia": "Estrada vista pelo para-brisa em aula de direção",
  "autoescola-estrada": "Vista da estrada pelo para-brisa do carro",
  "autoescola-aluna": "Aluna sorridente segura o volante",
  "autoescola-retrovisor": "Aluna ajustando o retrovisor antes de sair com o carro",
  "autoescola-volante-aluna": "Aluna sorridente sentada ao volante",
  "autoescola-instrucao": "Instrutor explica ao aluno durante o trajeto",
  "autoescola-volante": "Mão no volante e painel do carro",
};

const DESCRICOES: [RegExp, string][] = [
  [/experimental/i, "Conheça a escola, o professor e o método antes de se matricular."],
  [/ingl[êe]s|english/i, "Do básico à fluência, com foco em conversação desde a primeira aula."],
  [/espanhol|franc[êe]s|italiano|alem[ãa]o/i, "Aulas em turmas pequenas ou individuais, no seu ritmo."],
  [/conversa[çc][ãa]o/i, "Prática de fala para ganhar confiança em situações do dia a dia."],
  [/refor[çc]o|aula particular/i, "Acompanhamento das matérias da escola, com atenção às dificuldades de cada aluno."],
  [/vestibular|enem|preparat/i, "Revisão de conteúdo e treino de provas com acompanhamento."],
  [/viol[ãa]o|guitarra/i, "Acordes, ritmo e as músicas que você gosta, do iniciante ao avançado."],
  [/piano|teclado/i, "Leitura, técnica e repertório, com aulas individuais."],
  [/canto|voz/i, "Respiração, afinação e técnica vocal para cantar com segurança."],
  [/bateria|percuss/i, "Coordenação e ritmo, com aulas práticas desde o começo."],
  [/pr[áa]tica|dire[çc][ãa]o/i, "Aulas no carro com instrutor credenciado, no trânsito real da cidade."],
  [/legisla[çc][ãa]o|te[óo]rica/i, "Conteúdo da prova teórica explicado de forma clara."],
  [/habilitad/i, "Para quem já tem CNH e quer voltar a dirigir com segurança."],
];

export const AULAS: Record<"idiomas" | "reforco" | "musica" | "autoescola", Conteudo> = {
  idiomas: {
    pasta: "aulas", fotos: FOTOS, paletas: PALETAS, descricoes: DESCRICOES, icone: LIVRO,
    rotulo: "Escola de idiomas",
    padrao: ["Aula experimental", "Inglês", "Espanhol", "Conversação"],
    topo: ["idiomas-turma", "idiomas-sala"],
    galeria: ["idiomas-conversacao", "idiomas-participacao", "idiomas-aula-online", "idiomas-conversa-cafe", "idiomas-turma", "idiomas-sala"],
    passos: [
      ["idiomas-conversa-cafe", "Conversa de nivelamento", "Um bate-papo rápido para entender o seu nível e o seu objetivo."],
      ["idiomas-turma", "Turma do seu nível", "Aulas em grupo pequeno ou individuais, presenciais ou online."],
      ["idiomas-conversacao", "Prática desde o começo", "Conversação em todas as aulas, para falar com confiança."],
    ],
    titulos: [
      ["Fale outro idioma", "com confiança", "Aulas para adultos, em turma ou individuais, presenciais ou online. Agende uma aula experimental."],
      ["Inglês e espanhol", "no seu ritmo", "Do básico à conversação, com professor que acompanha a sua evolução. Fale pelo WhatsApp."],
      ["Aprender um idioma", "cabe na sua rotina", "Horários flexíveis e foco em conversação. Agende a sua aula experimental."],
    ],
    faq: [
      ["Tem aula experimental?", "Sim. Agende pelo WhatsApp ou pelo botão “Agendar online” e conheça a escola."],
      ["Como sei o meu nível?", "Numa conversa de nivelamento antes de começar, sem prova escrita."],
      ["Tem aula online?", "Pergunte pelo WhatsApp os horários de aulas por vídeo."],
      ["Quanto custa?", "Depende do curso e da frequência. Peça os valores pelo WhatsApp."],
    ],
    textos: {
      oi: "quero saber sobre as aulas.",
      servicos: (nome) => `O que a ${nome} ensina`,
      passos: "Da aula experimental à fluência — com acompanhamento em cada etapa.",
      galeria: ["Em aula", "Aprender conversando"],
      valores: "O valor depende do curso, da turma e da frequência. Toque em “pedir valor” e receba as opções pelo WhatsApp.",
      agendar: "Agende a sua aula experimental",
      obs: ["Idioma e nível (opcional)", "Ex.: inglês, nunca estudei, prefiro à noite…"],
    },
  },
  reforco: {
    pasta: "aulas", fotos: FOTOS, paletas: PALETAS, descricoes: DESCRICOES, icone: LIVRO,
    rotulo: "Reforço escolar",
    padrao: ["Aula experimental", "Reforço escolar", "Aula particular"],
    topo: ["reforco-biblioteca", "reforco-tutora"],
    galeria: ["reforco-explicacao", "reforco-dupla", "reforco-grupo", "reforco-tutora", "reforco-biblioteca"],
    passos: [
      ["reforco-tutora", "Conversa inicial", "Entendemos as matérias, as notas e as maiores dificuldades do aluno."],
      ["reforco-explicacao", "Aulas no ritmo do aluno", "Explicação com calma, exercícios e revisão antes das provas."],
      ["reforco-dupla", "Acompanhamento com a família", "Retorno regular sobre a evolução e o que precisa de mais atenção."],
    ],
    titulos: [
      ["Mais segurança", "nas matérias da escola", "Reforço escolar com atenção individual e revisão antes das provas. Fale pelo WhatsApp."],
      ["Aprender com calma", "e com acompanhamento", "Aulas particulares ou em grupo pequeno, no ritmo do aluno. Agende uma aula experimental."],
      ["Reforço escolar", "perto de você", "Acompanhamento das matérias e preparação para provas. Agende pelo WhatsApp."],
    ],
    faq: [
      ["Atendem quais séries?", "Pergunte pelo WhatsApp: a equipe informa as séries e matérias atendidas."],
      ["As aulas são individuais?", "Há aulas individuais e em grupos pequenos. Combine a melhor opção pelo WhatsApp."],
      ["Ajudam na preparação para provas?", "Sim. As aulas incluem revisão e exercícios antes das avaliações."],
      ["Quanto custa?", "Depende da frequência e do formato. Peça os valores pelo WhatsApp."],
    ],
    textos: {
      oi: "quero saber sobre o reforço escolar.",
      servicos: (nome) => `O que a ${nome} oferece`,
      passos: "Como funciona o acompanhamento, da primeira conversa à revisão para as provas.",
      galeria: ["Em aula", "Estudo com acompanhamento"],
      valores: "O valor depende da frequência e do formato das aulas. Toque em “pedir valor” e receba as opções pelo WhatsApp.",
      agendar: "Agende uma aula experimental",
      obs: ["Série e matérias (opcional)", "Ex.: 8º ano, matemática e português…"],
    },
  },
  musica: {
    pasta: "aulas", fotos: FOTOS, paletas: PALETAS, descricoes: DESCRICOES, icone: LIVRO,
    rotulo: "Escola de música",
    padrao: ["Aula experimental", "Violão", "Piano", "Canto"],
    topo: ["musica-violao-aula", "musica-piano"],
    galeria: ["musica-violao", "musica-canto", "musica-teclado", "musica-piano-aula", "musica-piano", "musica-violao-aula"],
    passos: [
      ["musica-violao", "Aula experimental", "Conheça o professor, o instrumento e o método antes de começar."],
      ["musica-piano", "Aulas no seu ritmo", "Técnica e repertório com as músicas que você gosta de ouvir."],
      ["musica-canto", "Evolução de verdade", "Metas por etapa, para você tocar ou cantar com segurança."],
    ],
    titulos: [
      ["Aprenda a tocar", "o que você gosta", "Violão, piano e canto para todas as idades, com aula experimental. Fale pelo WhatsApp."],
      ["Música para quem", "está começando ou voltando", "Aulas individuais com repertório escolhido por você. Agende pelo WhatsApp."],
      ["Aulas de música", "perto de você", "Técnica, teoria e prática no seu ritmo. Agende a sua aula experimental."],
    ],
    faq: [
      ["Preciso ter instrumento?", "Para começar, não. Pergunte pelo WhatsApp como funcionam as primeiras aulas."],
      ["Tem aula para adultos?", "Sim. Nunca é tarde para aprender um instrumento."],
      ["Quanto tempo dura a aula?", "Em geral 1 hora por semana, individual."],
      ["Quanto custa?", "Depende do instrumento e da frequência. Peça os valores pelo WhatsApp."],
    ],
    textos: {
      oi: "quero saber sobre as aulas de música.",
      servicos: (nome) => `O que a ${nome} ensina`,
      passos: "Da primeira aula à primeira música completa — com metas claras.",
      galeria: ["Em aula", "Música de perto"],
      valores: "O valor depende do instrumento e da frequência. Toque em “pedir valor” e receba as opções pelo WhatsApp.",
      agendar: "Agende a sua aula experimental",
      obs: ["Instrumento e experiência (opcional)", "Ex.: violão, nunca toquei, prefiro sábado…"],
    },
  },
  autoescola: {
    pasta: "aulas", fotos: FOTOS, paletas: PALETAS, descricoes: DESCRICOES, icone: LIVRO,
    rotulo: "Autoescola",
    padrao: ["Aula prática de direção", "Aula de legislação", "Aula para habilitados"],
    topo: ["autoescola-rodovia", "autoescola-estrada"],
    galeria: ["autoescola-retrovisor", "autoescola-instrucao", "autoescola-volante", "autoescola-aluna", "autoescola-volante-aluna"],
    passos: [
      ["autoescola-retrovisor", "Primeiros passos no carro", "Ajuste de banco e espelhos, comandos do carro e saída com calma."],
      ["autoescola-instrucao", "Instrutor ao seu lado", "Aulas práticas no trânsito real, com orientação o tempo todo."],
      ["autoescola-rodovia", "Pronto para o exame", "Revisão dos percursos e das manobras antes do dia da prova."],
    ],
    titulos: [
      ["Sua habilitação", "com segurança", "Aulas práticas e teóricas com instrutor credenciado. Fale pelo WhatsApp e agende."],
      ["Dirigir com confiança", "começa aqui", "Da primeira aula ao exame, com acompanhamento de perto. Agende pelo WhatsApp."],
      ["Autoescola", "perto de você", "Aulas no seu horário, para tirar a CNH ou voltar a dirigir. Agende a sua aula."],
    ],
    faq: [
      ["Quais categorias vocês atendem?", "Pergunte pelo WhatsApp as categorias e os pacotes disponíveis."],
      ["Tem aula para quem já é habilitado?", "Sim, para quem quer perder o medo e voltar a dirigir."],
      ["Como agendo as aulas práticas?", "Pelo WhatsApp ou pelo botão “Agendar online”, no horário que você preferir."],
      ["Quanto custa?", "Depende da categoria e do número de aulas. Peça os valores pelo WhatsApp."],
    ],
    textos: {
      oi: "quero saber sobre as aulas.",
      servicos: (nome) => `O que a ${nome} oferece`,
      passos: "Da primeira aula ao exame — com instrutor ao seu lado em cada etapa.",
      galeria: ["No volante", "Aprender a dirigir com calma"],
      valores: "O valor depende da categoria e do número de aulas. Toque em “pedir valor” e receba as opções pelo WhatsApp.",
      agendar: "Agende a sua aula",
      obs: ["Categoria e experiência (opcional)", "Ex.: categoria B, primeira habilitação…"],
    },
  },
};
