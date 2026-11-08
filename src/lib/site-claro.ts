// Modelo claro do gerador: a página dos 241 sites de pet da fábrica (seções, textos
// e camada Ruphus), com o conteúdo de cada nicho vindo de src/lib/nichos. O CSS é
// public/s/assets/gerado/pet.css (o nome ficou: é o arquivo que os sites já pedem).
import {
  AVISO, cabecaComum, type Capa, type DadosSite, type Escolha, esc, faixaProposta, foneBR, jsonLd, jsonLdNegocio, lugar, mapa, notaBR, type Sub, variante, zap,
  fixo,
  paraTelefone,
} from "@/lib/gerador";
import { BOTAO_AGENDAR, BOTAO_TOPO, ESTILO_AGENDAR, itemMenu } from "@/lib/botao-agendar";
import { PET } from "@/lib/nichos/pet";
import { AULAS } from "@/lib/nichos/aulas";
import { SAUDE } from "@/lib/nichos/saude";
import { FONTES, type Personal } from "@/lib/site-editorial";

/** O que muda de um nicho para outro no modelo claro. Os textos entram no HTML
 *  como estão: são nossos, não da planilha. */
export type Conteudo = {
  /** pasta do banco de fotos em public/s/assets */
  pasta: string;
  /** foto → alt; todas 1400×933, com versão -800 */
  fotos: Record<string, string>;
  paletas: [string, string][];
  rotulo: string;
  /** serviços quando a agenda não tem nenhum */
  padrao: string[];
  topo: string[];
  galeria: string[];
  /** [foto, título, texto] */
  passos: [string, string, string][];
  /** [título, destaque, chamada] */
  titulos: [string, string, string][];
  faq: [string, string][];
  /** descrição curta por serviço; a primeira regra que casar vence */
  descricoes: [RegExp, string][];
  icone: string;
  textos: {
    /** fim da mensagem pronta do WhatsApp: "Olá! Vim pelo site da X e …" */
    oi: string;
    servicos: (nome: string) => string;
    passos: string;
    galeria: [string, string];
    valores: string;
    agendar: string;
    obs: [string, string];
  };
};

const CONTEUDO: Partial<Record<Sub, Conteudo>> = { ...PET, ...SAUDE, ...AULAS };

/** Se o nicho é do modelo claro (e não do editorial). */
export const ehClaro = (sub: Sub) => sub in CONTEUDO;
const conteudoDe = (sub: Sub) => CONTEUDO[sub] ?? CONTEUDO.petshop!;

const WA = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M17.5 14.4c-.3-.1-1.7-.8-1.9-.9-.3-.1-.4-.1-.6.1s-.7.9-.9 1-.3.2-.6.1a7.6 7.6 0 0 1-2.2-1.4 8.4 8.4 0 0 1-1.6-2c-.2-.3 0-.5.1-.6l.4-.5c.1-.1.2-.3.2-.4a.6.6 0 0 0 0-.5c-.1-.1-.6-1.5-.8-2s-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-1 2.2c0 1.3.9 2.6 1.1 2.8.1.1 2 3.1 4.8 4.3.7.3 1.2.5 1.6.6a3.8 3.8 0 0 0 1.8.1c.5-.1 1.7-.7 2-1.4s.3-1.3.2-1.4-.2-.2-.5-.3z"/><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2z"/></svg>';
const ESTRELA = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.5l2.9 6 6.6.7-4.9 4.5 1.3 6.5L12 17l-5.9 3.2 1.3-6.5L2.5 9.2l6.6-.7L12 2.5z"/></svg>';
const PINO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M12 22s7-7.4 7-12.6A7 7 0 0 0 5 9.4C5 14.6 12 22 12 22z"/><circle cx="12" cy="9.4" r="2.4"/></svg>';
const RELOGIO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
const FONE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M7 3.5h2.2l1.3 4-2 1.4a12 12 0 0 0 5.6 5.6l1.4-2 4 1.3V16c0 1.7-1.5 3-3.2 2.7A15.6 15.6 0 0 1 4.3 6.7C4 5 5.3 3.5 7 3.5z"/></svg>';
const MAPA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true"><path d="M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2z"/><path d="M9 4v14M15 6v14"/></svg>';
const INSTA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1.1" fill="currentColor" stroke="none"/></svg>';

/** Quantos topos (fotos) e paletas o nicho tem, e o que o slug sorteia sem escolha gravada. */
export const combinacoesClaro = (sub: Sub) => ({ kits: conteudoDe(sub).topo.length, cores: conteudoDe(sub).paletas.length });
export const escolhaClaro = (sub: Sub, slug: string): Required<Escolha> => ({
  kit: variante(slug, conteudoDe(sub).topo.length, "topo"),
  cor: variante(slug, conteudoDe(sub).paletas.length, "cor"),
});

/** Modelos que o admin escolhe na gaveta, por ramo do claro: cada foto do topo com uma
 *  paleta, girando as paletas para os modelos não saírem iguais. O id é "{sub}-{n}". */
export const modelosClaro = (sub: Sub) => {
  const c = conteudoDe(sub);
  return c.topo.map((_, i) => {
    const id = `${sub}-${i + 1}`;
    return { id, rotulo: `${c.rotulo} ${i + 1}`, escolha: { kit: i, cor: (i * 2) % c.paletas.length, modelo: id } as Required<Escolha> & { modelo: string } };
  });
};
export const modeloClaroDoId = (sub: Sub, id: string) => modelosClaro(sub).find((m) => m.id === id);

/** As três fotos do banco que a galeria do site mostra, sorteadas pelo slug (pulando de duas em
 *  duas para não repetir): o site e as miniaturas da gaveta usam a mesma lista. */
export function galeriaClaro(slug: string, sub: Sub) {
  const { galeria } = conteudoDe(sub);
  const g0 = variante(slug, galeria.length, "galeria");
  return [0, 1, 2].map((i) => galeria[(g0 + i * 2) % galeria.length]);
}

// texto branco ou escuro por cima de uma cor: o claro escreve nos botões (--accent) e nos selos (--gold)
const luminancia = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).reduce((soma, v, k) => soma + [0.2126, 0.7152, 0.0722][k] * (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4), 0);
export const tintaSobre = (hex: string) => (luminancia(hex) > 0.4 ? "#1B1208" : "#FFFFFF");

/** Cor e foto principal: o que o tenant guarda para o /admin e a /bio. Com `personal`, as
 *  cores (tinta = --accent, destaque = --gold), a fonte dos títulos e as fotos próprias entram
 *  por cima da paleta e do topo do modelo. */
export function visualClaro(slug: string, sub: Sub, escolha?: Escolha, personal?: Personal | null) {
  const c = conteudoDe(sub);
  const padrao = escolhaClaro(sub, slug);
  // índice fora do ramo (modelo de outro sub, dado antigo) cai no que o slug sorteia
  const base = c.paletas[escolha?.cor ?? padrao.cor] ?? c.paletas[padrao.cor];
  const topo = c.topo[escolha?.kit ?? padrao.kit] ?? c.topo[padrao.kit];
  const accent = personal?.cores?.ink ?? /--accent:(#[0-9A-F]{6})/i.exec(base[0])![1];
  const gold = personal?.cores?.acc ?? /--gold:(#[0-9A-F]{6})/i.exec(base[0])![1];
  const proprias = personal?.cores?.ink || personal?.cores?.acc;
  // cor própria vale nos dois temas, com o texto por cima calculado pelo contraste
  const extra = proprias ? `--accent:${accent};--gold:${gold};--accent-ink:${tintaSobre(accent)};--gold-ink:${tintaSobre(gold)};` : "";
  const paleta: [string, string] = [base[0] + extra, base[1] + extra];
  const fonte = FONTES.find(([n]) => n === personal?.fonte) ?? null;
  const p = personal?.fotos ?? {};
  const propria = (ref: string | undefined) => (ref && personal?.versao ? `${ref}?v=${personal.versao}` : ref);
  // referências das fotos: do banco ("/assets/{pasta}/{nome}", sem extensão: o HTML põe -800/1400)
  // ou própria ("fotos/hero.jpg?v=…", relativa à raiz do site)
  const fotos = {
    hero: propria(p.hero) ?? `/assets/${c.pasta}/${topo}`,
    ga1: propria(p.ga1) ?? null,
    ga2: propria(p.ga2) ?? null,
    ga3: propria(p.ga3) ?? null,
  };
  const foto = propria(p.bio) ?? (p.hero ? propria(p.hero)! : null);
  return { cor: accent, foto: foto ? `/${foto}` : `/assets/${c.pasta}/${topo}-800.jpg`, paleta, topo, fonte, fotos, gold };
}

/** A imagem de compartilhamento: a foto do topo, na versão grande, e a fonte de título do site. */
export function capaClaro(d: DadosSite): Capa {
  const c = conteudoDe(d.sub);
  const { fotos, cor, fonte } = visualClaro(d.slug, d.sub, d.escolha, d.personal);
  // a rota do og.jpg pede `/s${foto}`: a do banco é /assets/…, a própria é /{slug}/fotos/hero.jpg
  const foto = fotos.hero.startsWith("/assets/") ? `${fotos.hero}.jpg` : `/${d.slug}/${fotos.hero}`;
  return { foto, cor, fonte: fonte?.[0] ?? "Bricolage Grotesque", linha: [c.rotulo, lugar(d)].filter(Boolean).join(" em ") };
}

const imagem = (c: Conteudo, nome: string) =>
  `<img src="../assets/${c.pasta}/${nome}-800.jpg" srcset="../assets/${c.pasta}/${nome}-800.jpg 800w, ../assets/${c.pasta}/${nome}.jpg 1400w" sizes="(max-width:700px) 100vw, 360px" width="1400" height="933" alt="${esc(c.fotos[nome])}" loading="lazy" decoding="async">`;

/** Selo com as iniciais, como o dos sites de pet. */
function selo(nome: string, cor: string, ouro: string) {
  const iniciais = nome.split(/\s+/).filter((p) => /^[\p{L}\d]/u.test(p) && p.length > 2).slice(0, 2).map((p) => p[0].toUpperCase()).join("") || nome[0].toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="31" fill="${cor}"/><circle cx="32" cy="32" r="27" fill="none" stroke="${ouro}" stroke-width="1.5"/><text x="32" y="38" font-family="Georgia,serif" font-size="20" font-weight="700" text-anchor="middle" fill="${ouro}">${esc(iniciais)}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// Textos de variante (só para sites com `variantes`): frases que são iguais em todo o nicho
const TEXTOS_PASSOS = [
  "Como é o atendimento, do primeiro contato ao retorno — com tempo e explicação clara.",
  "Do primeiro contato ao retorno, cada etapa é explicada antes de acontecer.",
  "Você sabe o que esperar em cada etapa, do primeiro contato ao acompanhamento.",
];
const TEXTOS_GALERIA = ["Um lugar pensado para você", "Por dentro e no dia a dia", "Ambiente e rotina"];
// Layout: a ordem dos cartões gira pelo slug; sem variantes, a ordem do nicho
const girar = <T,>(lista: T[], d: DadosSite, sal: string): T[] => {
  if (!d.variantes || lista.length < 2) return lista;
  const k = variante(d.slug, lista.length, sal);
  return [...lista.slice(k), ...lista.slice(0, k)];
};

export function renderClaro(d: DadosSite): string {
  const c = conteudoDe(d.sub);
  const { paleta, topo, cor, gold: ouro, fonte, fotos: proprias } = visualClaro(d.slug, d.sub, d.escolha, d.personal);
  const t = d.personal?.textos ?? {};
  const [titulo, destaque, chamadaModelo] = c.titulos[variante(d.slug, c.titulos.length, "titulo")];
  const chamada = t.frase || chamadaModelo;
  // cada posição da galeria: a foto própria, se houver, senão a do banco que o slug sorteia
  const doSlug = galeriaClaro(d.slug, d.sub);
  const fotos = [0, 1, 2].map((i) => [proprias.ga1, proprias.ga2, proprias.ga3][i] ?? doSlug[i]);
  const propriaNoTopo = !proprias.hero.startsWith("/assets/");
  // o topo é fundo CSS: a própria vai nas duas larguras; a do banco tem versão -800
  const topoUrl = (grande: boolean) => (propriaNoTopo ? proprias.hero : `../assets/${c.pasta}/${topo}${grande ? "" : "-800"}.jpg`);
  const imgPropria = (ref: string) => `<img src="${ref}" width="1400" height="933" alt="${esc(d.nome)}" loading="lazy" decoding="async">`;
  const doBanco = fotos.some((f) => !f.startsWith("fotos/")) || !propriaNoTopo;
  const rotulo = c.rotulo;
  const onde = lugar(d);
  const sub = [rotulo, onde].filter(Boolean).join(" em ");
  const descr = `${sub}: horário, serviços, como chegar e agendamento pelo WhatsApp.`;
  const tituloPag = `${d.nome} | ${sub}`;
  const oi = zap(d.telefone, `Olá! Vim pelo site da ${d.nome} e ${c.textos.oi}`);
  const busca = mapa(d);
  const google = esc(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(busca)}`);
  const temNota = d.nota != null && !!d.avaliacoes;
  const estrelas = ESTRELA.repeat(5);
  const nota = temNota ? notaBR(d.nota!) : "";
  const servicos = d.servicos.length ? d.servicos : c.padrao;
  const seloSrc = selo(d.nome, cor, ouro);
  const nav = [["servicos", "Serviços"], ["procedimentos", "Como funciona"], ["valores", "Valores"], ...(temNota ? [["avaliacoes", "Avaliações"]] : []), ["local", "Como chegar"], ["agendar", "Contato"]];
  const endereco = d.endereco || [onde, d.uf].filter(Boolean).join(" - ");
  const horario = d.horario || "Confirme o horário pelo WhatsApp";
  const botaoWa = (classe: string) => `<a class="${classe}" href="${oi}" target="_blank" rel="noopener">${WA}<span>Falar no WhatsApp</span></a>`;
  const faq = girar(c.faq, d, "faq");
  const descricao = (s: string) => c.descricoes.find(([re]) => re.test(s))?.[1] ?? "Serviço oferecido pela casa — confirme detalhes pelo WhatsApp.";
  const img = (nome: string) => imagem(c, nome);
  const ICONE = c.icone;

  // número fixo: o WhatsApp não atende — ligação no lugar, sem o formulário que monta a mensagem
  const porTelefone = fixo(d.telefone);
  const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(tituloPag)}</title>
<link rel="icon" type="image/svg+xml" href="${seloSrc}">
<link rel="preload" as="image" href="${topoUrl(false)}" fetchpriority="high" media="(max-width:759px)">
<link rel="preload" as="image" href="${topoUrl(true)}" fetchpriority="high" media="(min-width:760px)">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@600;700&family=Figtree:wght@400;600;700${fonte ? `&family=${fonte[1]}` : ""}&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../assets/gerado/pet.css">
<style>:root{${paleta[0]}${fonte ? `--font-display:'${fonte[0]}',serif;` : ""}}@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){${paleta[1]}}}:root[data-theme="dark"]{${paleta[1]}}.hero{background:linear-gradient(180deg,rgba(0,0,0,.18) 0%,rgba(0,0,0,.48) 52%,rgba(0,0,0,.88) 100%),url("${topoUrl(false)}") center 38%/cover no-repeat;}@media (min-width:760px){.hero{background-image:linear-gradient(180deg,rgba(0,0,0,.18) 0%,rgba(0,0,0,.48) 52%,rgba(0,0,0,.88) 100%),url("${topoUrl(true)}");}}</style>
${cabecaComum(d, tituloPag, descr, d.publicado)}
<meta name="theme-color" content="${cor}">
${d.uf ? `<meta name="geo.region" content="BR-${esc(d.uf)}">` : ""}
${jsonLdNegocio(d, descr, propriaNoTopo ? `/${proprias.hero}` : `/assets/${c.pasta}/${topo}.jpg`)}${jsonLd({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: faq.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) })}
${ESTILO_AGENDAR}
</head>
<body>
${d.publicado ? "" : faixaProposta(d)}

<header class="site-header" id="siteHeader">
  <div class="header-inner">
    <a href="#top" class="brand">
      <img class="seal" src="${seloSrc}" alt="Selo ${esc(d.nome)}" width="44" height="44">
      <span class="brand-text">
        <span class="brand-name">${esc(d.nome)}</span>
        <span class="brand-sub">${esc([rotulo, onde].filter(Boolean).join(" · "))}</span>
      </span>
    </a>
    <nav class="main-nav">${nav.map(([id, t]) => `<a href="#${id}">${itemMenu(id, t)}</a>`).join("")}</nav>
    <div class="header-actions">
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
  <nav>${nav.map(([id, t]) => `<a href="#${id}" class="drawer-link">${itemMenu(id, t)}</a>`).join("")}</nav>
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
${BOTAO_AGENDAR}
      <div class="hero-ctas">
        <a href="#servicos" class="btn btn-outline" style="border-color:rgba(255,255,255,.5);color:#fff;">Ver serviços</a>
      </div>
    </div>
  </div>
</section>

<div class="destaques">${[
    temNota ? `${nota} no Google com ${d.avaliacoes} avaliações` : `Atendimento com hora marcada`,
    onde ? `Atendimento em ${onde} e região` : "Atendimento perto de você",
    "Agendamento direto pelo WhatsApp",
  ].map((x) => `<span>${ICONE}<span>${esc(x)}</span></span>`).join("")}</div>
${t.sobre ? `
<section id="sobre">
  <div class="wrap">
    <span class="eyebrow">Sobre</span>
    <h2 class="section-title">${esc(d.nome)}</h2>
    <div class="sobre-box">${esc(t.sobre)}</div>
  </div>
</section>
` : ""}

<section id="servicos">
  <div class="wrap">
    <span class="eyebrow">Serviços</span>
    <h2 class="section-title">${c.textos.servicos(esc(d.nome))}</h2>
    <p class="lead">Precisa de algo que não está aqui? Pergunte pelo WhatsApp — a equipe responde no mesmo dia.</p>
    <div class="svc-grid">${servicos.map((s) => `<article class="svc-card"><span class="svc-icon">${ICONE}</span><h3>${esc(s)}</h3><p>${esc(descricao(s))}</p></article>`).join("")}</div>
  </div>
</section>

<section id="procedimentos" class="section-alt">
  <div class="wrap">
    <span class="eyebrow">Como funciona</span>
    <h2 class="section-title">Procedimentos, passo a passo</h2>
    <p class="lead">${d.variantes ? TEXTOS_PASSOS[variante(d.slug, TEXTOS_PASSOS.length, "passos")] : c.textos.passos}</p>
    <div class="proc-grid">${girar(c.passos, d, "passos").map(([f, h, p]) => `<article class="proc-card">${img(f)}<div class="txt"><h3>${h}</h3><p>${p}</p></div></article>`).join("")}</div>
  </div>
</section>

<section id="galeria">
  <div class="wrap">
    <span class="eyebrow">${c.textos.galeria[0]}</span>
    <h2 class="section-title">${esc(t.galeria || (d.variantes ? TEXTOS_GALERIA[variante(d.slug, TEXTOS_GALERIA.length, "galeria-titulo")] : c.textos.galeria[1]))}</h2>
    ${fotos.some((f) => !f.startsWith("fotos/")) ? `<p class="lead">Imagens ilustrativas do tipo de atendimento oferecido na ${esc(d.nome)}.</p>` : ""}
    <div class="galeria">${fotos.map((f) => (f.startsWith("fotos/") ? imgPropria(f) : img(f))).join("")}</div>
  </div>
</section>

<section id="valores" class="section-alt">
  <div class="wrap">
    <span class="eyebrow">Valores</span>
    <h2 class="section-title">Tabela de serviços</h2>
    <p class="lead">${c.textos.valores}</p>
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
    <div class="quote-grid"><div class="g-card"><div class="g-head"><span class="gg">G</span><span>Avaliações no Google</span></div><div class="nota">${nota}</div><span class="stars">${estrelas}</span><p>${d.avaliacoes} avaliações de clientes reais${onde ? ` em ${esc(onde)}` : ""}.</p><a class="btn btn-outline" href="${google}" target="_blank" rel="noopener">Ler as avaliações</a></div><div class="g-card"><div class="g-head">${ICONE}<span>${rotulo}</span></div><p>${esc([onde, rotulo].filter(Boolean).join(" · "))}</p><p style="color:var(--text);font-weight:600;">${esc(servicos.slice(0, 3).join(", "))}</p></div></div>
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
    <h2 class="section-title">${c.textos.agendar}</h2>
    <p class="lead">${porTelefone ? `Ligue para ${esc(d.nome)} e combine o serviço, o dia e o horário.` : `Preencha os dados — ao enviar, a solicitação já chega pronta no WhatsApp da ${esc(d.nome)}.`}</p>
    <div class="agendar-box">
      ${porTelefone ? `<div class="agendar-actions"><a class="btn btn-primary" href="tel:+${d.telefone}">${FONE}<span>Ligar ${foneBR(d.telefone)}</span></a></div>` : `<form id="agendarForm" data-brand="${esc(d.nome)}" data-wa="${d.telefone}">
        <div class="form-grid">
          <div class="full"><label for="agNome">Seu nome</label><input id="agNome" required placeholder="Seu nome completo"></div>
          <div><label for="agTelefone">Telefone / WhatsApp</label><input id="agTelefone" required placeholder="(00) 90000-0000"></div>
          <div><label for="agServico">Serviço desejado</label><select id="agServico">${[...servicos, "Outro"].map((s) => `<option>${esc(s)}</option>`).join("")}</select></div>
          <div><label for="agData">Data</label><input id="agData" type="date"></div>
          <div><label for="agHora">Horário</label><input id="agHora" type="time"></div>
          <div class="full"><label for="agObs">${c.textos.obs[0]}</label><textarea id="agObs" placeholder="${c.textos.obs[1]}"></textarea></div>
        </div>
        <div class="agendar-actions">
          <button type="submit" class="btn btn-primary" id="waSubmitBtn">${WA}<span>Enviar no WhatsApp</span></button>
        </div>
        <p class="form-note" id="agendarNote"></p>
        ${AVISO}
      </form>`}
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
      <span>${d.origem === "cadastro" || d.publicado ? "Site criado com Ruphus." : "Página demonstrativa desenvolvida para apresentar o potencial de uma presença digital própria."}</span>
    </div>
    <p data-ysis="fonte" style="margin:16px 0 0;text-align:center;font-size:.76rem;line-height:1.5;opacity:.6">${doBanco ? "Algumas fotos são ilustrativas (banco de imagens Pexels), não imagens do estabelecimento." : ""}${d.origem === "cadastro" ? "" : ` Endereço, horário, nota e número de avaliações vêm do perfil público do Google Maps, consultado em ${esc(d.consultado)}. Valores públicos, sujeitos a mudança.`}</p>
  </div>
</footer>

${BOTAO_TOPO}
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
  ${porTelefone ? "" : `// data a partir de hoje (no fuso de quem abre): o navegador recusa data passada
  document.getElementById('agData').min=new Date(Date.now()-new Date().getTimezoneOffset()*6e4).toISOString().slice(0,10);
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
  });`}
})();
</script>
</body>
</html>
`;
  return porTelefone ? paraTelefone(html, d.telefone, WA) : html;
}
