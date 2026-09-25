// Modelo beleza do gerador: a página editorial dos sites de barbearia e salão que
// já estão no ar (hero com fx.js, marquee, serviços numerados, reputação), com o
// CSS em public/s/assets/gerado/beleza.css e as fotos do banco public/s/assets/beleza.
import {
  AVISO, cabecaComum, type DadosSite, esc, faixaProposta, foneBR, jsonLdNegocio, lugar, mapa, notaBR, variante, zap,
} from "@/lib/gerador";

type Tipo = "barbearia" | "salao" | "estetica" | "unhas";

// paletas reais da família editorial: [--ink, --acc, --deep, --tint]
const QUENTES: [string, string, string, string][] = [
  ["#131110", "#B5732F", "#8F5624", "#f6eee6"],
  ["#14110E", "#A86E3C", "#83542A", "#f4ede7"],
  ["#12100F", "#B33A2B", "#8E2B20", "#f5e7e5"],
  ["#12100E", "#8C5E3C", "#6E4A2F", "#f1ebe7"],
  ["#151312", "#C9A24A", "#9E7C33", "#f8f3e9"],
];
const DELICADAS: [string, string, string, string][] = [
  ["#161114", "#E58F9C", "#C06A7C", "#fbf1f3"],
  ["#131011", "#F2707F", "#C44E5F", "#fdedef"],
  ["#100F12", "#8E7CC3", "#6A5A9C", "#f1eff7"],
  ["#141118", "#9E86C8", "#7B62A3", "#f3f0f8"],
  ["#171210", "#F0704A", "#C04F2F", "#fdede9"],
  ["#151312", "#C9A24A", "#9E7C33", "#f8f3e9"],
];
// os quatro pares de fonte que a família usa, todos com Archivo no texto
const FONTES: [string, string][] = [
  ["Fraunces", "Fraunces:opsz,wght@9..144,400;9..144,600"],
  ["Marcellus", "Marcellus"],
  ["Italiana", "Italiana"],
  ["Cormorant Garamond", "Cormorant+Garamond:ital,wght@0,400;0,600;1,400"],
];

const ROTULO: Record<Tipo, string> = { barbearia: "Barbearia", salao: "Salão de beleza", estetica: "Estética", unhas: "Nail designer" };

const TEXTOS: Record<Tipo, string[]> = {
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
};

const PADRAO: Record<Tipo, string[]> = {
  barbearia: ["Corte", "Barba", "Corte + barba", "Sobrancelha"],
  salao: ["Corte", "Escova", "Coloração", "Hidratação"],
  estetica: ["Limpeza de pele", "Design de sobrancelha", "Extensão de cílios"],
  unhas: ["Manicure", "Pedicure", "Alongamento em gel"],
};

// descrição e selo por serviço; a primeira regra que casar vence
const DESCRICOES: [RegExp, string, string][] = [
  [/corte\s*(e|\+)\s*barba|combo/i, "O pacote completo para sair pronto da cadeira em uma única visita.", "Mais pedido"],
  [/barba/i, "Desenho, alinhamento e toalha quente para um acabamento limpo e confortável.", "Toalha quente"],
  [/pigment/i, "Cobertura de falhas com aspecto natural.", "Acabamento"],
  [/sobrancel/i, "Desenho que valoriza o olhar, sem exageros.", "Detalhe"],
  [/corte/i, "Do clássico ao moderno, com acabamento caprichado e finalização profissional.", "Clássico & moderno"],
  [/escova|finaliz/i, "Brilho, movimento e fios alinhados para o dia a dia ou para a ocasião.", "Finalização"],
  [/colora|mecha|luzes|loiro/i, "Cor pensada para o seu tom de pele, com cuidado para a saúde do fio.", "Cor"],
  [/hidrat|tratamento|cronograma|reconstr/i, "Tratamento para devolver força, maciez e brilho aos fios.", "Tratamento"],
  [/progressiva|alisa|selagem|botox/i, "Redução de volume e frizz com produtos de qualidade.", "Liso"],
  [/manicure/i, "Cutilagem cuidadosa e esmaltação caprichada.", "Clássico"],
  [/pedicure/i, "Pés bem cuidados, com conforto e acabamento impecável.", "Cuidado"],
  [/alongamento|gel|fibra/i, "Unhas mais longas e resistentes, com formato do seu jeito.", "Durável"],
  [/cíli|cili|lash/i, "Fios aplicados um a um para um olhar marcante e natural.", "Olhar"],
  [/limpeza de pele|facial|peeling/i, "Pele limpa, renovada e preparada para os próximos cuidados.", "Pele"],
  [/massag|drenag/i, "Relaxamento e bem-estar em um momento só seu.", "Bem-estar"],
  [/depila/i, "Depilação com técnica e conforto.", "Conforto"],
];
const detalhe = (s: string, i: number): [string, string] => {
  const achado = DESCRICOES.find(([re]) => re.test(s));
  return achado ? [achado[1], achado[2]] : ["Atendimento com hora marcada — confirme os detalhes pelo WhatsApp.", ["Especial", "Detalhe", "Cuidado"][i % 3]];
};

const WA = '<svg viewBox="0 0 448 512" aria-hidden="true"><path fill="currentColor" d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L0 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z"/></svg>';
const PINO = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 2C8.1 2 5 5.1 5 9c0 5.2 7 13 7 13s7-7.8 7-13c0-3.9-3.1-7-7-7zm0 9.5c-1.4 0-2.5-1.1-2.5-2.5S10.6 6.5 12 6.5s2.5 1.1 2.5 2.5-1.1 2.5-2.5 2.5z"/></svg>';
const GOOGLE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285F4" d="M23.5 12.27c0-.85-.08-1.66-.22-2.45H12v4.64h6.45a5.52 5.52 0 0 1-2.39 3.62v3h3.87c2.26-2.09 3.57-5.16 3.57-8.81z"/><path fill="#34A853" d="M12 24c3.24 0 5.96-1.07 7.94-2.92l-3.87-3c-1.07.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.29v3.1A12 12 0 0 0 12 24z"/><path fill="#FBBC05" d="M5.27 14.27A7.2 7.2 0 0 1 4.89 12c0-.79.14-1.56.38-2.27v-3.1H1.29a12 12 0 0 0 0 10.74l3.98-3.1z"/><path fill="#EA4335" d="M12 4.77c1.76 0 3.34.61 4.58 1.8l3.44-3.44A11.98 11.98 0 0 0 12 0 12 12 0 0 0 1.29 6.63l3.98 3.1C6.22 6.88 8.87 4.77 12 4.77z"/></svg>';
const INSTA = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r="1.1" fill="currentColor" stroke="none"/></svg>';

const tipoDe = (sub: DadosSite["sub"]): Tipo => (sub === "barbearia" || sub === "estetica" || sub === "unhas" ? sub : "salao");

/** Cor e foto principal: o que o tenant guarda para o /admin e a /bio. */
export function visualBeleza(slug: string, sub: DadosSite["sub"]) {
  const tipo = tipoDe(sub);
  const paletas = tipo === "barbearia" ? QUENTES : DELICADAS;
  const [ink, acc, deep, tint] = paletas[variante(slug, paletas.length, "cor")];
  const kit = `/assets/beleza/${tipo}-${variante(slug, 4, "kit") + 1}`;
  return { tipo, ink, acc, deep, tint, kit, cor: acc, foto: `${kit}/hero.jpg`, fonte: FONTES[variante(slug, FONTES.length, "fonte")] };
}

export function renderBeleza(d: DadosSite): string {
  const { tipo, ink, acc, deep, tint, kit, fonte } = visualBeleza(d.slug, d.sub);
  const onde = lugar(d);
  const rotulo = ROTULO[tipo];
  const tag = [rotulo, [d.cidade, d.uf].filter(Boolean).join("/")].filter(Boolean).join(" · ");
  const texto = TEXTOS[tipo][variante(d.slug, TEXTOS[tipo].length, "texto")] + (onde ? ` Em ${onde}.` : "");
  const temNota = d.nota != null && !!d.avaliacoes;
  const nota = temNota ? notaBR(d.nota!) : "";
  const descr = `${d.nome} — ${rotulo}${d.cidade ? ` em ${d.cidade}` : ""}${temNota ? ` com nota ${nota} e ${d.avaliacoes} avaliações no Google` : ""}. Agende pelo WhatsApp.`;
  const tituloPag = `${d.nome} — ${rotulo}${d.cidade ? ` em ${d.cidade}` : ""}`;
  const oi = zap(d.telefone, `Olá! Vim pelo site da ${d.nome} e quero agendar um horário.`);
  const busca = mapa(d);
  const google = esc(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(busca)}`);
  const servicos = d.servicos.length ? d.servicos : PADRAO[tipo];
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

  return `<!DOCTYPE html>
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
<style>:root{--ink:${ink};--paper:#ffffff;--acc:${acc};--deep:${deep};--tint:${tint};--grey:#8b8587;--serif:'${fonte[0]}',serif}</style>
${cabecaComum(d.slug, tituloPag, descr, `${kit}/hero.jpg`)}
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${ink}"/><text x="32" y="45" font-family="Arial Narrow,Arial,sans-serif" font-size="36" font-weight="700" fill="${acc}" text-anchor="middle">${esc(d.nome[0].toUpperCase())}</text></svg>`)}">
${jsonLdNegocio(d, descr, `${kit}/hero.jpg`)}
</head>
<body id="top">
${faixaProposta(d.slug)}

<header id="hd">
  <a class="logo" href="#top">${esc(d.nome)}</a>
  <nav>
    <a href="#sobre">Sobre</a><a href="#trabalhos">Galeria</a><a href="#servicos">Serviços</a>${temNota ? '<a href="#depoimentos">Reputação</a>' : ""}<a href="#como-chegar">Como chegar</a>
  </nav>
  <a class="btn-wpp" href="${oi}" target="_blank" rel="noopener">${WA} Contato</a>
</header>

<section class="hero">
  <div class="bgimg"><img src="..${kit}/hero.jpg" alt="${alt}"></div>
  <canvas id="fx3d"></canvas>
  <div class="hero-inner">
    <span class="tag">${esc(tag)}</span>
    <h1 class="rv">${esc(linha1)}${linha2 ? `<span class="row2">${esc(linha2)}</span>` : ""}</h1>
<a data-agendar="1" href="/agendar" style="display:inline-block;margin:18px 0;padding:13px 22px;border-radius:999px;background:${ink};color:#fff;font:600 15px/1 system-ui,-apple-system,sans-serif;text-decoration:none">Agendar online</a>
    <p class="sub rv">${esc(texto)}</p>
    ${temNota ? `<a class="badge-google rv" href="${google}" target="_blank" rel="noopener">${GOOGLE}<span class="st">★★★★★</span> ${nota} · ${d.avaliacoes} avaliações</a>` : ""}
    <div class="hero-ctas rv">
      <a class="btn-wpp" style="background:#25D366;border-color:#25D366;color:#fff" href="#agendar">${WA} Falar no WhatsApp</a>
      <a class="btn-wpp" style="border-color:rgba(255,255,255,.6);color:#fff" href="#servicos">Ver serviços</a>
    </div>
  </div>
</section>

<div class="marquee"><div class="marquee-track">${marquee}</div></div>

<section id="sobre">
  <div class="sec-head rv"><span class="label">A Casa</span><h2>Sobre</h2></div>
  <div class="sobre-grid">
    <div class="rv"><p class="sobre-big">${esc(texto)}</p></div>
    ${fatos.length ? `<div class="facts rv">${fatos.map(([b, s]) => `<div class="fact"><b>${esc(b)}</b><span>${s}</span></div>`).join("")}</div>` : ""}
  </div>
</section>

<section class="galeria" id="trabalhos">
  <div class="sec-head rv"><span class="label">Galeria</span><h2>O espaço e o trabalho</h2></div>
  <div class="gal-grid">${[1, 2, 3].map((n) => `<div class="tilt rv fit-cover"><img src="..${kit}/ga${n}.jpg" alt="${alt}" loading="lazy"><span class="cap">Imagem ilustrativa</span></div>`).join("")}</div>
</section>

<section class="servicos" id="servicos">
  <div class="sec-head rv"><span class="label">Serviços</span><h2>O que você encontra</h2></div>
  ${servicos.map((s, i) => {
    const [p, selo] = detalhe(s, i);
    return `<div class="svc-row rv"><span class="num">${String(i + 1).padStart(2, "0")}</span><div><h3>${esc(s)}</h3><p>${esc(p)}</p></div><span class="tag-pill">${esc(selo)}</span></div>`;
  }).join("")}
  <div class="precos rv"><h3>Tabela de preços</h3>
      <div class="price-placeholder"><b>Valores sob consulta.</b> O estabelecimento não publica a tabela de preços online — chame no WhatsApp e receba os valores atualizados na hora.</div></div>
</section>

<section class="agendar" id="agendar">
  <div class="sec-head rv"><span class="label">Agendamento</span><h2>Marque seu horário</h2></div>
  <div class="ag-grid">
    <div class="ag-info rv">
      <p>Preencha ao lado e envie direto no WhatsApp de ${esc(d.nome)}. Sem cadastro, sem aplicativo — a resposta vem na conversa.</p>
      <div class="steps">
        <div class="step"><b>1</b><span>Escolha o serviço e o melhor dia para você.</span></div>
        <div class="step"><b>2</b><span>Envie — a mensagem já chega pronta no WhatsApp.</span></div>
        <div class="step"><b>3</b><span>Receba a confirmação do horário pela equipe.</span></div>
      </div>
    </div>
    <form class="waform rv" id="waform" data-wa="${d.telefone}">
      <label for="wf-nome">Seu nome</label>
      <input id="wf-nome" name="nome" type="text" placeholder="Como podemos te chamar?" autocomplete="name" required>
      <label for="wf-svc">Serviço</label>
      <select id="wf-svc" name="servico"><option value="">Escolha um serviço</option>${servicos.map((s) => `<option>${esc(s)}</option>`).join("")}<option>Outro / quero tirar uma dúvida</option></select>
      <label for="wf-dia">Dia de preferência</label>
      <input id="wf-dia" name="dia" type="date">
      <label for="wf-per">Período</label>
      <select id="wf-per" name="periodo"><option value="">Tanto faz</option><option>Manhã</option><option>Tarde</option><option>Noite</option></select>
      <label for="wf-msg">Observações (opcional)</label>
      <textarea id="wf-msg" name="msg" placeholder="Ex.: primeira visita, referência, alergia a produto…"></textarea>
      <button type="submit">${WA} Enviar pelo WhatsApp</button>
    ${AVISO}
</form>
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
  <h2 class="cta-h2 rv">Seu próximo horário está a <em>uma mensagem</em> de distância</h2>
  <div class="cta-row rv">
    <a class="btn-solid" href="${oi}" target="_blank" rel="noopener">${WA} Chamar no WhatsApp</a>
    <a class="btn-ghost" href="${google}" target="_blank" rel="noopener">${PINO} Ver no mapa</a>
  </div>
  <ul class="info-list rv">${endereco ? `<li><b>Endereço</b><span>${esc(endereco)}</span></li>` : ""}<li><b>WhatsApp</b><span><a href="${oi}" target="_blank" rel="noopener">${foneBR(d.telefone)}</a></span></li><li><b>Horário de atendimento</b><span>${esc(d.horario || "Não informado publicamente — confirme pelo WhatsApp")}</span></li></ul>
</section>

<footer>
  <span>${esc(`${d.nome} — ${tag}`)}<br><small>Site-modelo de demonstração criado pela Ruphus</small></span>
  <span class="social">
    <a href="${oi}" target="_blank" rel="noopener" aria-label="WhatsApp de ${esc(d.nome)}">${WA}</a>
    ${d.instagram ? `<a href="https://www.instagram.com/${esc(d.instagram)}/" target="_blank" rel="noopener" aria-label="Instagram de ${esc(d.nome)}">${INSTA}</a>` : ""}
    <a href="${google}" target="_blank" rel="noopener" aria-label="${esc(d.nome)} no Google Maps">${PINO}</a>
  </span>
<p data-ysis="fonte" style="margin:14px 0 0;font-size:.76rem;line-height:1.5;opacity:.6">Imagens ilustrativas, não são fotos do estabelecimento. ${temNota ? "Nota e número de avaliações do Google" : "Endereço e contato do perfil público do Google"}, consultados em ${esc(d.consultado)}. Valores públicos, sujeitos a mudança.</p>
</footer>

<a class="wpp-float" href="${oi}" target="_blank" rel="noopener" aria-label="Agendar pelo WhatsApp de ${esc(d.nome)}">${WA}</a>

<script>
var hd=document.getElementById('hd');
addEventListener('scroll',function(){hd.classList.toggle('scrolled',scrollY>40);},{passive:true});
var io=new IntersectionObserver(function(es){es.forEach(function(x){if(x.isIntersecting){x.target.classList.add('in');io.unobserve(x.target);}});},{threshold:.12});
document.querySelectorAll('.rv').forEach(function(el){io.observe(el);});
document.getElementById('waform').addEventListener('submit',function(ev){
  ev.preventDefault();
  var f=ev.target, linhas=['Olá! Quero agendar um horário.','Nome: '+f.nome.value];
  if(f.servico.value)linhas.push('Serviço: '+f.servico.value);
  if(f.dia.value){var d=f.dia.value.split('-');linhas.push('Dia de preferência: '+d[2]+'/'+d[1]+'/'+d[0]);}
  if(f.periodo.value)linhas.push('Período: '+f.periodo.value);
  if(f.msg.value)linhas.push('Obs.: '+f.msg.value);
  window.open('https://wa.me/'+f.getAttribute('data-wa')+'?text='+encodeURIComponent(linhas.join('\\n')),'_blank');
});
</script>
<script src="../assets/fx.js" defer></script>
<script>window.addEventListener('load',function(){if(window.init3D)init3D('fx3d','${acc}',{shapes:12,opacity:.45});});</script>
</body>
</html>
`;
}
