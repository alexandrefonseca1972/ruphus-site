// Modelo pet do gerador: a mesma página dos 241 sites de pet shop e veterinária
// que já estão no ar (seções, textos e camada Ruphus), com o CSS em
// public/s/assets/gerado/pet.css e as fotos do banco public/s/assets/pet.
import {
  AVISO, cabecaComum, type Capa, type DadosSite, esc, faixaProposta, foneBR, jsonLd, jsonLdNegocio, lugar, mapa, notaBR, variante, zap,
} from "@/lib/gerador";

// paletas reais dos sites de pet, das mais usadas: [claro, escuro]
const PALETAS: [string, string][] = [
  ["--accent:#1B6B4F;--gold:#F0B429;--bg:#F1F6F4;--surface:#FFFFFF;--text:#082018;--muted:#587C6F;--border:#DBE7E3;--accent-ink:#FFFFFF;--gold-ink:#1B1208;", "--accent:#5B9480;--gold:#F3C458;--bg:#051510;--surface:#082018;--text:#EFF5F3;--muted:#A8C7BC;--border:#0D3326;"],
  ["--accent:#7A4A22;--gold:#7FB069;--bg:#F7F4F2;--surface:#FFFFFF;--text:#25160A;--muted:#836D5B;--border:#EAE2DC;--accent-ink:#FFFFFF;--gold-ink:#1B1208;", "--accent:#9F7D60;--gold:#9BC18A;--bg:#180F07;--surface:#25160A;--text:#F6F2F0;--muted:#CCBAAB;--border:#3B2410;"],
  ["--accent:#10706E;--gold:#F6A623;--bg:#F1F6F6;--surface:#FFFFFF;--text:#052221;--muted:#537E7D;--border:#D9E8E8;--accent-ink:#FFFFFF;--gold-ink:#1B1208;", "--accent:#539897;--gold:#F8BA53;--bg:#031616;--surface:#052221;--text:#EEF5F5;--muted:#A4C9C8;--border:#083635;"],
  ["--accent:#5B3A8C;--gold:#F3A712;--bg:#F5F3F8;--surface:#FFFFFF;--text:#1B112A;--muted:#75668B;--border:#E5DFED;--accent-ink:#FFFFFF;--gold-ink:#1B1208;", "--accent:#8971AC;--gold:#F6BA46;--bg:#120C1C;--surface:#1B112A;--text:#F4F1F7;--muted:#C1B4D3;--border:#2C1C43;"],
  ["--accent:#14557A;--gold:#F2A93B;--bg:#F1F5F7;--surface:#FFFFFF;--text:#061A25;--muted:#557283;--border:#D9E4EA;--accent-ink:#FFFFFF;--gold-ink:#1B1208;", "--accent:#56859F;--gold:#F5BC66;--bg:#041118;--surface:#061A25;--text:#EFF3F6;--muted:#A6BECC;--border:#0A293B;"],
  ["--accent:#33417A;--gold:#F7B32B;--bg:#F3F4F7;--surface:#FFFFFF;--text:#0F1425;--muted:#636983;--border:#DEE1EA;--accent-ink:#FFFFFF;--gold-ink:#1B1208;", "--accent:#6C769F;--gold:#F9C45A;--bg:#0A0D18;--surface:#0F1425;--text:#F1F2F6;--muted:#B1B7CC;--border:#181F3B;"],
  ["--accent:#C2551F;--gold:#2C9C8F;--bg:#FBF5F2;--surface:#FFFFFF;--text:#3A1A09;--muted:#A3725A;--border:#F5E4DB;--accent-ink:#FFFFFF;--gold-ink:#1B1208;", "--accent:#D3855E;--gold:#5AB2A8;--bg:#271106;--surface:#3A1A09;--text:#FBF3EF;--muted:#E8BEAA;--border:#5D290F;"],
];

// fotos do banco (public/s/assets/pet), todas 1400×933 com versão -800; o texto é o alt do creditos.json
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

type Tipo = "petshop" | "vet";
const TOPO: Record<Tipo, string[]> = {
  petshop: ["loja-balcao", "banho-banheira", "tosa-mesa", "tosa-salao"],
  vet: ["vet-dupla", "vet-consulta", "vet-mesa", "gato-exame"],
};
const GALERIA: Record<Tipo, string[]> = {
  petshop: ["feliz-colo", "tosa-pente", "feliz-lambida", "hotel-corrida", "loja-coleiras", "banho-banheira"],
  vet: ["vet-cao-calmo", "gato-filhote", "feliz-colo", "proc-curativo", "vet-consulta", "gato-vacina"],
};
const PASSOS: Record<Tipo, [string, string, string][]> = {
  petshop: [
    ["banho-banheira", "Banho com produto certo", "Shampoo e condicionador escolhidos pelo tipo de pelo e pela pele do seu pet, com secagem sem pressa."],
    ["tosa-mesa", "Tosa do jeito combinado", "Higiênica, na máquina ou na tesoura: você diz como quer e a equipe confirma antes de começar."],
    ["feliz-colo", "Entrega com carinho", "Seu pet volta cheiroso e tranquilo — e você recebe o aviso pelo WhatsApp quando estiver pronto."],
  ],
  vet: [
    ["vet-consulta", "Consulta sem pressa", "Histórico, exame físico e explicação clara do que foi visto — com espaço para todas as suas dúvidas."],
    ["gato-vacina", "Vacinas em dia", "Carteira de vacinação organizada, com lembrete das próximas doses para cães e gatos."],
    ["proc-ultrassom", "Exames quando precisa", "Quando o caso pede, a equipe orienta sobre exames e acompanha o resultado com você."],
  ],
};

const TITULOS: Record<Tipo, [string, string, string][]> = {
  // [título, destaque, chamada]
  petshop: [
    ["Tudo para o seu pet,", "pertinho de você", "Banho, tosa, ração e acessórios com atendimento de quem conhece o bairro. Chame no WhatsApp e agende."],
    ["Seu pet limpo, cheiroso", "e bem cuidado", "Banho e tosa com carinho, produtos certos e hora marcada. Fale pelo WhatsApp e reserve o horário."],
    ["Cuidado de verdade", "para quem é da família", "Atendimento próximo, sem pressa e com a atenção que o seu pet merece. Agende pelo WhatsApp."],
  ],
  vet: [
    ["Saúde do seu pet", "em boas mãos", "Consultas, vacinas e acompanhamento com atendimento próximo. Chame no WhatsApp e marque o horário."],
    ["Veterinário perto de você,", "quando você precisa", "Consulta, vacinação e orientação clara para cães e gatos. Agende pelo WhatsApp."],
    ["Cuidado clínico", "com carinho de verdade", "Atendimento atento para o seu pet em todas as fases da vida. Fale com a equipe pelo WhatsApp."],
  ],
};

const FAQ: Record<Tipo, [string, string][]> = {
  petshop: [
    ["Como agendo o banho e tosa?", "Pelo WhatsApp ou pelo botão “Agendar online”: escolha o serviço e o horário, e a equipe confirma."],
    ["Precisa levar alguma coisa?", "Só o seu pet. Se ele tiver alguma alergia ou sensibilidade, avise na hora de agendar."],
    ["Quanto custa?", "O valor depende do porte e da pelagem. Toque em “Pedir valor” na tabela e receba o orçamento no WhatsApp."],
    ["Vocês vendem ração e acessórios?", "Pergunte pelo WhatsApp pelo item que você precisa — a loja confirma disponibilidade e preço."],
  ],
  vet: [
    ["Como marco uma consulta?", "Pelo WhatsApp ou pelo botão “Agendar online”. Conte o que o seu pet está sentindo para a equipe se preparar."],
    ["Atendem cães e gatos?", "Sim. Se o seu pet for de outra espécie, pergunte pelo WhatsApp antes de vir."],
    ["Quanto custa a consulta?", "Toque em “Pedir valor” na tabela e receba o valor atualizado pelo WhatsApp."],
    ["E em caso de urgência?", "Chame no WhatsApp antes de sair de casa: a equipe orienta e confirma se pode receber o seu pet na hora."],
  ],
};

// descrição curta por serviço; a primeira que casar vence
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
const descricao = (servico: string) =>
  DESCRICOES.find(([re]) => re.test(servico))?.[1] ?? "Serviço oferecido pela casa — confirme detalhes pelo WhatsApp.";

const WA = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.7-.8-1.9-.9-.3-.1-.4-.1-.6.1s-.7.9-.9 1-.3.2-.6.1a7.6 7.6 0 0 1-2.2-1.4 8.4 8.4 0 0 1-1.6-2c-.2-.3 0-.5.1-.6l.4-.5c.1-.1.2-.3.2-.4a.6.6 0 0 0 0-.5c-.1-.1-.6-1.5-.8-2s-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-1 2.2c0 1.3.9 2.6 1.1 2.8.1.1 2 3.1 4.8 4.3.7.3 1.2.5 1.6.6a3.8 3.8 0 0 0 1.8.1c.5-.1 1.7-.7 2-1.4s.3-1.3.2-1.4-.2-.2-.5-.3z"/><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2z"/></svg>';
const ESTRELA = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.7-4.9 4.5 1.3 6.5L12 17l-5.9 3.2 1.3-6.5L2.5 9.2l6.6-.7L12 2.5z"/></svg>';
const PATA = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 13.2c2.5 0 4.5 1.8 4.5 3.6 0 1.6-1.4 2.4-3 2.4h-3c-1.6 0-3-.8-3-2.4 0-1.8 2-3.6 4.5-3.6z"/><ellipse cx="6.6" cy="11" rx="1.8" ry="2.2"/><ellipse cx="17.4" cy="11" rx="1.8" ry="2.2"/><ellipse cx="9.6" cy="7" rx="1.7" ry="2.3"/><ellipse cx="14.4" cy="7" rx="1.7" ry="2.3"/></svg>';
const PINO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s7-7.4 7-12.6A7 7 0 0 0 5 9.4C5 14.6 12 22 12 22z"/><circle cx="12" cy="9.4" r="2.4"/></svg>';
const RELOGIO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
const FONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M7 3.5h2.2l1.3 4-2 1.4a12 12 0 0 0 5.6 5.6l1.4-2 4 1.3V16c0 1.7-1.5 3-3.2 2.7A15.6 15.6 0 0 1 4.3 6.7C4 5 5.3 3.5 7 3.5z"/></svg>';
const MAPA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg>';
const INSTA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1.1" fill="currentColor" stroke="none"/></svg>';

const tipoDe = (d: Pick<DadosSite, "sub">): Tipo => (d.sub === "vet" ? "vet" : "petshop");

/** Cor e foto principal: o que o tenant guarda para o /admin e a /bio. */
export function visualPet(slug: string, sub: DadosSite["sub"]) {
  const paleta = PALETAS[variante(slug, PALETAS.length, "cor")];
  const topo = TOPO[tipoDe({ sub })][variante(slug, 4, "topo")];
  return { cor: /--accent:(#[0-9A-F]{6})/.exec(paleta[0])![1], foto: `/assets/pet/${topo}-800.jpg`, paleta, topo };
}

const rotuloDe = (d: Pick<DadosSite, "sub">) => (tipoDe(d) === "vet" ? "Clínica veterinária" : "Pet shop");

/** A imagem de compartilhamento: a foto do topo, na versão grande, e a mesma fonte de título. */
export function capaPet(d: DadosSite): Capa {
  const { topo, cor } = visualPet(d.slug, d.sub);
  return { foto: `/assets/pet/${topo}.jpg`, cor, fonte: "Fraunces", linha: [rotuloDe(d), lugar(d)].filter(Boolean).join(" em ") };
}

const img = (nome: string, extra = "") =>
  `<img src="../assets/pet/${nome}-800.jpg" srcset="../assets/pet/${nome}-800.jpg 800w, ../assets/pet/${nome}.jpg 1400w" sizes="(max-width:700px) 100vw, 360px" width="1400" height="933" alt="${esc(FOTOS[nome])}" loading="lazy" decoding="async"${extra}>`;

/** Selo com as iniciais, como o dos sites de pet. */
function selo(nome: string, cor: string, ouro: string) {
  const iniciais = nome.split(/\s+/).filter((p) => /^[\p{L}\d]/u.test(p) && p.length > 2).slice(0, 2).map((p) => p[0].toUpperCase()).join("") || nome[0].toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="31" fill="${cor}"/><circle cx="32" cy="32" r="27" fill="none" stroke="${ouro}" stroke-width="1.5"/><text x="32" y="38" font-family="Georgia,serif" font-size="20" font-weight="700" text-anchor="middle" fill="${ouro}">${esc(iniciais)}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

export function renderPet(d: DadosSite): string {
  const tipo = tipoDe(d);
  const { paleta, topo } = visualPet(d.slug, d.sub);
  const cor = /--accent:(#[0-9A-F]{6})/.exec(paleta[0])![1];
  const ouro = /--gold:(#[0-9A-F]{6})/.exec(paleta[0])![1];
  const [titulo, destaque, chamada] = TITULOS[tipo][variante(d.slug, TITULOS[tipo].length, "titulo")];
  const galeria = GALERIA[tipo];
  const g0 = variante(d.slug, galeria.length, "galeria");
  const fotos = [0, 1, 2].map((i) => galeria[(g0 + i * 2) % galeria.length]);
  const rotulo = rotuloDe(d);
  const onde = lugar(d);
  const sub = [rotulo, onde].filter(Boolean).join(" em ");
  const descr = `${sub}: horário, serviços, como chegar e agendamento pelo WhatsApp.`;
  const tituloPag = `${d.nome} | ${sub}`;
  const oi = zap(d.telefone, `Olá! Vim pelo site da ${d.nome} e quero falar sobre um atendimento para o meu pet.`);
  const busca = mapa(d);
  const google = esc(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(busca)}`);
  const temNota = d.nota != null && !!d.avaliacoes;
  const estrelas = ESTRELA.repeat(5);
  const nota = temNota ? notaBR(d.nota!) : "";
  const servicos = d.servicos.length ? d.servicos : tipo === "vet" ? ["Consulta veterinária", "Vacinação"] : ["Banho", "Tosa"];
  const seloSrc = selo(d.nome, cor, ouro);
  const nav = [["servicos", "Serviços"], ["procedimentos", "Como funciona"], ["valores", "Valores"], ...(temNota ? [["avaliacoes", "Avaliações"]] : []), ["local", "Como chegar"], ["agendar", "Contato"]];
  const endereco = d.endereco || [onde, d.uf].filter(Boolean).join(" - ");
  const horario = d.horario || "Confirme o horário pelo WhatsApp";
  const botaoWa = (classe: string) => `<a class="${classe}" href="${oi}" target="_blank" rel="noopener">${WA}<span>Falar no WhatsApp</span></a>`;
  const faq = FAQ[tipo];

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(tituloPag)}</title>
<link rel="icon" type="image/svg+xml" href="${seloSrc}">
<link rel="preload" as="image" href="../assets/pet/${topo}-800.jpg" fetchpriority="high" media="(max-width:759px)">
<link rel="preload" as="image" href="../assets/pet/${topo}.jpg" fetchpriority="high" media="(min-width:760px)">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,700&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../assets/gerado/pet.css">
<style>:root{${paleta[0]}}@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${paleta[1]}}}:root[data-theme="dark"]{${paleta[1]}}.hero{background:linear-gradient(180deg,rgba(0,0,0,.18) 0%,rgba(0,0,0,.48) 52%,rgba(0,0,0,.88) 100%),url("../assets/pet/${topo}-800.jpg") center 38%/cover no-repeat;}@media (min-width:760px){.hero{background-image:linear-gradient(180deg,rgba(0,0,0,.18) 0%,rgba(0,0,0,.48) 52%,rgba(0,0,0,.88) 100%),url("../assets/pet/${topo}.jpg");}}</style>
${cabecaComum(d.slug, tituloPag, descr)}
<meta name="theme-color" content="${cor}">
${d.uf ? `<meta name="geo.region" content="BR-${esc(d.uf)}">` : ""}
${jsonLdNegocio(d, descr, `/assets/pet/${topo}.jpg`)}${jsonLd({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) })}
</head>
<body>
${faixaProposta(d.slug)}

<header class="site-header" id="siteHeader">
  <div class="header-inner">
    <a href="#top" class="brand">
      <img class="seal" src="${seloSrc}" alt="Selo ${esc(d.nome)}" width="44" height="44">
      <span class="brand-text">
        <span class="brand-name">${esc(d.nome)}</span>
        <span class="brand-sub">${esc([rotulo, onde].filter(Boolean).join(" · "))}</span>
      </span>
    </a>
    <nav class="main-nav">${nav.map(([id, t]) => `<a href="#${id}">${t}</a>`).join("")}</nav>
    <div class="header-actions">
      ${botaoWa("btn btn-primary header-cta")}
      <button class="hamburger" id="hamburgerBtn" aria-label="Abrir menu"><span></span></button>
    </div>
  </div>
</header>

<div class="drawer-backdrop" id="drawerBackdrop"></div>
<aside class="drawer" id="drawer" aria-hidden="true">
  <div class="drawer-head">
    <a href="#top" class="brand">
      <img class="seal" src="${seloSrc}" alt="Selo ${esc(d.nome)}" width="40" height="40">
      <span class="brand-text"><span class="brand-name" style="max-width:none;">${esc(d.nome)}</span></span>
    </a>
    <button class="drawer-close" id="drawerCloseBtn" aria-label="Fechar menu">&times;</button>
  </div>
  <nav>${nav.map(([id, t]) => `<a href="#${id}" class="drawer-link">${t}</a>`).join("")}</nav>
  ${botaoWa("btn btn-primary btn-block")}
</aside>

<div id="top"></div>
<section class="hero">
  <div class="wrap">
    <div class="hero-content">
      ${temNota ? `<div class="hero-rating"><span class="stars">${estrelas}</span><span>${nota} &middot; ${d.avaliacoes} avaliações no Google</span></div>` : ""}
      <span class="eyebrow">${esc(sub)}</span>
      <h1>${esc(titulo)} <em>${esc(destaque)}</em></h1>
      <p class="lead">${esc(chamada)}</p>
      <div class="hero-ctas">
        ${botaoWa("btn btn-gold")}
<a data-agendar="1" class="btn btn-gold" href="/agendar">${RELOGIO}<span>Agendar online</span></a>
        <a href="#servicos" class="btn btn-outline" style="border-color:rgba(255,255,255,.5);color:#fff;">Ver serviços</a>
      </div>
    </div>
  </div>
</section>

<div class="destaques">${[
    temNota ? `${nota} no Google com ${d.avaliacoes} avaliações` : `Atendimento com hora marcada`,
    onde ? `Atendimento em ${onde} e região` : "Atendimento perto de você",
    "Agendamento direto pelo WhatsApp",
  ].map((t) => `<span>${PATA}<span>${esc(t)}</span></span>`).join("")}</div>

<section id="servicos">
  <div class="wrap">
    <span class="eyebrow">Serviços</span>
    <h2 class="section-title">O que a ${esc(d.nome)} faz pelo seu pet</h2>
    <p class="lead">Precisa de algo que não está aqui? Pergunte pelo WhatsApp — a equipe responde no mesmo dia.</p>
    <div class="svc-grid">${servicos.map((s) => `<article class="svc-card"><span class="svc-icon">${PATA}</span><h3>${esc(s)}</h3><p>${esc(descricao(s))}</p></article>`).join("")}</div>
  </div>
</section>

<section id="procedimentos" class="section-alt">
  <div class="wrap">
    <span class="eyebrow">Como funciona</span>
    <h2 class="section-title">Procedimentos, passo a passo</h2>
    <p class="lead">O que acontece do agendamento à saída do seu pet — sem surpresa e sem letra miúda.</p>
    <div class="proc-grid">${PASSOS[tipo].map(([f, h, p]) => `<article class="proc-card">${img(f)}<div class="txt"><h3>${h}</h3><p>${p}</p></div></article>`).join("")}</div>
  </div>
</section>

<section id="galeria">
  <div class="wrap">
    <span class="eyebrow">O dia a dia</span>
    <h2 class="section-title">Cuidado que se vê</h2>
    <p class="lead">Imagens ilustrativas do tipo de atendimento oferecido na ${esc(d.nome)}.</p>
    <div class="galeria">${fotos.map((f) => img(f)).join("")}</div>
  </div>
</section>

<section id="valores" class="section-alt">
  <div class="wrap">
    <span class="eyebrow">Valores</span>
    <h2 class="section-title">Tabela de serviços</h2>
    <p class="lead">O preço varia com o porte, a pelagem e o que o seu pet precisa. Toque em “pedir valor” e receba o orçamento do serviço já no WhatsApp.</p>
    <div class="tabela-wrap">
      <table class="precos">
        <thead><tr><th>Serviço</th><th>O que inclui</th><th>Valor</th></tr></thead>
        <tbody>${servicos.map((s) => `<tr><td><strong>${esc(s)}</strong></td><td>${esc(descricao(s))}</td><td><a href="${zap(d.telefone, `Olá! Vim pelo site da ${d.nome}. Qual o valor de ${s}?`)}" target="_blank" rel="noopener">Pedir valor</a></td></tr>`).join("")}</tbody>
      </table>
    </div>
    <p class="form-note">Nenhum preço é publicado sem a confirmação da casa — por isso o orçamento sai pelo WhatsApp, na hora.</p>
  </div>
</section>
${temNota ? `
<section id="avaliacoes">
  <div class="wrap">
    <span class="eyebrow">Prova social</span>
    <h2 class="section-title">O que dizem no Google</h2>
    <div class="rating-banner"><span class="big">${nota}</span><span class="stars">${estrelas}</span><span class="txt">${d.avaliacoes} avaliações no Google &middot; nota real, não estimada</span></div>
    <div class="quote-grid"><div class="g-card"><div class="g-head"><span class="gg">G</span><span>Avaliações no Google</span></div><div class="nota">${nota}</div><span class="stars">${estrelas}</span><p>${d.avaliacoes} avaliações de clientes reais${onde ? ` em ${esc(onde)}` : ""}.</p><a class="btn btn-outline" href="${google}" target="_blank" rel="noopener">Ler as avaliações</a></div><div class="g-card"><div class="g-head">${PATA}<span>${rotulo}</span></div><p>${esc([onde, rotulo].filter(Boolean).join(" · "))}</p><p style="color:var(--text);font-weight:600;">${esc(servicos.slice(0, 3).join(", "))}</p></div></div>
    <div class="redes"><a href="${oi}" target="_blank" rel="noopener">${WA} WhatsApp</a><a href="${google}" target="_blank" rel="noopener">${MAPA} Perfil no Google</a>${d.instagram ? `<a href="https://www.instagram.com/${esc(d.instagram)}/" target="_blank" rel="noopener">${INSTA} Instagram</a>` : ""}</div>
  </div>
</section>
` : ""}
<section id="local" class="section-alt">
  <div class="wrap">
    <span class="eyebrow">Localização</span>
    <h2 class="section-title">Como chegar</h2>
    <div class="local-grid">
      <div class="local-info">
        <div class="info-row">
          <span class="ic">${PINO}</span>
          <div><h4>Endereço</h4><p>${esc(endereco || "Pergunte o endereço pelo WhatsApp")}</p></div>
        </div>
        <div class="info-row">
          <span class="ic">${RELOGIO}</span>
          <div><h4>Horário</h4><p>${esc(horario)}<br><span style="font-size:.88em;">Confirme o horário de hoje pelo WhatsApp antes de vir.</span></p></div>
        </div>
        <div class="info-row">
          <span class="ic">${FONE}</span>
          <div><h4>Telefone / WhatsApp</h4><p><a href="${oi}" target="_blank" rel="noopener">${foneBR(d.telefone)}</a></p></div>
        </div>
        <a href="${google}" target="_blank" rel="noopener" class="btn btn-outline" style="align-self:flex-start;">Abrir no Google Maps</a>
      </div>
      <div class="map-frame">
        <iframe src="${esc(`https://www.google.com/maps?q=${encodeURIComponent(busca)}&output=embed`)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" title="Mapa ${esc(d.nome)}"></iframe>
      </div>
    </div>
  </div>
</section>

<section id="faq" class="section-alt">
  <div class="wrap">
    <span class="eyebrow">Dúvidas</span>
    <h2 class="section-title">Perguntas frequentes</h2>
    <div class="faq">${faq.map(([q, a], i) => `<details${i ? "" : " open"}><summary>${q}</summary><p>${a}</p></details>`).join("")}</div>
  </div>
</section>

<section id="agendar">
  <div class="wrap">
    <span class="eyebrow">Agendar</span>
    <h2 class="section-title">Marque o horário do seu pet</h2>
    <p class="lead">Preencha os dados — ao enviar, a solicitação já chega pronta no WhatsApp da ${esc(d.nome)}.</p>
    <div class="agendar-box">
      <form id="agendarForm" data-brand="${esc(d.nome)}" data-wa="${d.telefone}">
        <div class="form-grid">
          <div class="full"><label for="agNome">Seu nome</label><input id="agNome" required placeholder="Seu nome completo"></div>
          <div><label for="agTelefone">Telefone / WhatsApp</label><input id="agTelefone" required placeholder="(00) 90000-0000"></div>
          <div><label for="agServico">Serviço desejado</label><select id="agServico">${[...servicos, "Outro"].map((s) => `<option>${esc(s)}</option>`).join("")}</select></div>
          <div><label for="agData">Data</label><input id="agData" type="date"></div>
          <div><label for="agHora">Horário</label><input id="agHora" type="time"></div>
          <div class="full"><label for="agObs">Nome, porte e raça do pet (opcional)</label><textarea id="agObs" placeholder="Ex.: Nina, shih-tzu pequena, um pouco assustada com secador"></textarea></div>
        </div>
        <div class="agendar-actions">
          <button type="submit" class="btn btn-primary" id="waSubmitBtn">${WA}<span>Enviar no WhatsApp</span></button>
        </div>
        <p class="form-note" id="agendarNote"></p>
        ${AVISO}
      </form>
    </div>
  </div>
</section>

<footer>
  <div class="wrap">
    <div class="footer-grid">
      <div>
        <a href="#top" class="footer-brand">
          <img class="seal" src="${seloSrc}" alt="Selo ${esc(d.nome)}" width="40" height="40">
          <span class="brand-name">${esc(d.nome)}</span>
        </a>
        <p>${esc(sub)}.</p>
      </div>
      <div>
        <h5>Contato</h5>
        <ul>
          ${endereco ? `<li>${PINO}<span>${esc(endereco)}</span></li>` : ""}
          <li>${FONE}<a href="${oi}" target="_blank" rel="noopener">${foneBR(d.telefone)}</a></li>
        </ul>
      </div>
      <div>
        <h5>Horário &amp; redes</h5>
        <ul>
          <li>${RELOGIO}<span>${esc(horario)}</span></li>
          <li>${MAPA}<a href="${google}" target="_blank" rel="noopener">Perfil no Google</a></li>
          ${d.instagram ? `<li>${INSTA}<a href="https://www.instagram.com/${esc(d.instagram)}/" target="_blank" rel="noopener">@${esc(d.instagram)}</a></li>` : ""}
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <span>&copy; <span id="yr"></span> ${esc(d.nome)}. Todos os direitos reservados.</span>
      <span>Página demonstrativa desenvolvida para apresentar o potencial de uma presença digital própria.</span>
    </div>
    <p data-ysis="fonte" style="margin:16px 0 0;text-align:center;font-size:.76rem;line-height:1.5;opacity:.6">Fotos ilustrativas (banco de imagens Pexels), não são imagens do estabelecimento. Endereço, horário, nota e número de avaliações vêm do perfil público do Google Maps, consultado em ${esc(d.consultado)}. Valores públicos, sujeitos a mudança.</p>
  </div>
</footer>

<a class="fab" href="${oi}" target="_blank" rel="noopener" aria-label="Chamar no WhatsApp">${WA}<span class="fab-label">WhatsApp</span></a>
<script>
(function(){
  var header=document.getElementById('siteHeader');
  window.addEventListener('scroll',function(){header.classList.toggle('scrolled',window.scrollY>8);},{passive:true});
  var drawer=document.getElementById('drawer');
  function openDrawer(){document.body.classList.add('drawer-open');drawer.setAttribute('aria-hidden','false');}
  function closeDrawer(){document.body.classList.remove('drawer-open');drawer.setAttribute('aria-hidden','true');}
  document.getElementById('hamburgerBtn').addEventListener('click',openDrawer);
  document.getElementById('drawerCloseBtn').addEventListener('click',closeDrawer);
  document.getElementById('drawerBackdrop').addEventListener('click',closeDrawer);
  document.querySelectorAll('.drawer-link').forEach(function(a){a.addEventListener('click',closeDrawer);});
  document.getElementById('yr').textContent=new Date().getFullYear();
  var form=document.getElementById('agendarForm');
  var v=function(id){return document.getElementById(id).value.trim();};
  form.addEventListener('submit',function(e){
    e.preventDefault();
    var nome=document.getElementById('agNome'),tel=document.getElementById('agTelefone');
    if(!nome.value.trim())return nome.reportValidity();
    if(!tel.value.trim())return tel.reportValidity();
    var msg='Olá! Vim pelo site da '+form.getAttribute('data-brand')+' e quero agendar um horário.\\n'
      +'Nome: '+v('agNome')+'\\nTelefone: '+v('agTelefone')+'\\nServiço: '+v('agServico')+'\\n';
    if(v('agData'))msg+='Data: '+v('agData')+'\\n';
    if(v('agHora'))msg+='Horário: '+v('agHora')+'\\n';
    if(v('agObs'))msg+='Observação: '+v('agObs')+'\\n';
    window.open('https://wa.me/'+form.getAttribute('data-wa')+'?text='+encodeURIComponent(msg),'_blank');
    var note=document.getElementById('agendarNote');
    note.textContent='Abrindo o WhatsApp com sua mensagem pronta...';note.classList.add('ok');
  });
})();
</script>
</body>
</html>
`;
}
