// "Agendar online" com a marca Ruphus, igual em todos os sites (editorial e claro): o R do
// ícone (public/marca/icone.svg) num botão branco e o ponto amarelo #fff100 no canto, como no
// logo. O estilo vai junto no HTML porque o CSS dos sites fica um dia em cache.

const R =
  '<svg class="rag-r" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="#000"/><rect x="16" y="14" width="29" height="20" rx="10" fill="#fff"/><rect x="26" y="21" width="10" height="6" rx="3" fill="#000"/><rect x="16" y="14" width="10" height="36" fill="#fff"/><path d="M29 33h9l10 17h-9.5z" fill="#fff"/></svg>';

export const ESTILO_AGENDAR = `<style>
.rag{position:relative;display:inline-flex;align-items:center;gap:12px;margin:22px 0 8px;padding:8px 24px 8px 8px;border-radius:16px;background:#fff;color:#000;text-decoration:none;box-shadow:0 16px 34px -14px rgba(0,0,0,.75);transition:transform .2s;-webkit-tap-highlight-color:transparent}
.rag:hover{transform:translateY(-2px)}
.rag .rag-r{width:40px;height:40px;flex:none;display:block}
.rag .rag-tx{display:flex;flex-direction:column;gap:5px;line-height:1;text-align:left}
.rag b{font:800 .8rem/1 system-ui,-apple-system,"Segoe UI",sans-serif;text-transform:uppercase;letter-spacing:.12em}
.rag small{font:600 .7rem/1 system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:.03em;color:#555}
.rag .rag-pt{position:absolute;top:-5px;right:-5px;width:16px;height:16px;border-radius:50%;background:#fff100;border:3px solid #000;animation:ragHalo 1.8s infinite}
@keyframes ragHalo{0%{box-shadow:0 0 0 0 rgba(255,241,0,.75)}75%{box-shadow:0 0 0 10px rgba(255,241,0,0)}100%{box-shadow:0 0 0 0 rgba(255,241,0,0)}}
@media (prefers-reduced-motion:reduce){.rag .rag-pt{animation:none}}
.rtopo{position:fixed;left:18px;bottom:18px;z-index:55;width:50px;height:50px;border-radius:50%;background:#000;color:#fff;display:grid;place-items:center;box-shadow:0 10px 28px rgba(0,0,0,.35),inset 0 0 0 1px rgba(255,255,255,.18);opacity:0;transform:translateY(12px);pointer-events:none;transition:opacity .25s,transform .25s}
.rtopo.on{opacity:1;transform:none;pointer-events:auto}
.rtopo svg{width:22px;height:22px}
.rtopo::after{content:"";position:absolute;top:2px;right:2px;width:10px;height:10px;border-radius:50%;background:#fff100;border:2px solid #000}
@media (prefers-reduced-motion:reduce){.rtopo{transition:none}}
.price-placeholder a{color:var(--acc);font-weight:700;text-decoration:underline;text-underline-offset:3px;white-space:nowrap}
.rnav{display:inline-flex;align-items:center;gap:7px}
.rnav svg{width:15px;height:15px;flex:none;opacity:.8}
/* celular: o mapa (editorial) não alarga a página em tela de 320px, e a tabela de valores (claro) vira cartões em vez de rolar de lado */
.mapa-grid>*{min-width:0}
.mapa-info .mi span{overflow-wrap:anywhere}
.btn-route{max-width:100%;flex-wrap:wrap;text-align:center;justify-content:center}
.hero-ctas .btn-wpp{flex:0 0 auto}
/* nome comprido (o do Google às vezes vem com cidade e marcas): título menor, logo cortado com "…" no computador e o selo do topo fora do cabeçalho */
.hero h1.nl{font-size:clamp(2.4rem,6.4vw,5rem)}
.hero h1.nml{font-size:clamp(2rem,4.8vw,3.8rem);line-height:1.04}
.hero{padding-top:calc(var(--dnh,36px) + 96px)}
@media (min-width:981px){header .logo{max-width:30vw;overflow:hidden;text-overflow:ellipsis}}
@media (max-width:980px){header .logo{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:0}}
@media (max-width:600px){
table.precos{min-width:0}
table.precos thead{display:none}
table.precos tr{display:block;padding:12px 0;border-bottom:1px solid var(--border)}
table.precos tr:last-child{border-bottom:0}
table.precos td{display:block;padding:3px 18px;border:0}
}
</style>`;

// volta ao topo: canto esquerdo (o WhatsApp flutuante fica no direito); aparece depois de rolar
export const BOTAO_TOPO = `<a class="rtopo" href="#" aria-label="Voltar ao topo"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5M5 12l7-7 7 7"/></svg></a><script>(function(){var b=document.querySelector(".rtopo");if(!b)return;function v(){b.classList.toggle("on",scrollY>500)}addEventListener("scroll",v,{passive:true});v();b.addEventListener("click",function(e){e.preventDefault();scrollTo({top:0,behavior:matchMedia("(prefers-reduced-motion:reduce)").matches?"auto":"smooth"})})})()</script>`;

export const BOTAO_AGENDAR = `<a class="rag" data-agendar="1" href="/agendar">${R}<span class="rag-tx"><b>Agendar online</b><small>Escolha em até 30 segundos</small></span><span class="rag-pt"></span></a>`;

// ícone de cada item do menu, pela âncora da seção (editorial e claro)
const ICONES_MENU: Record<string, string> = {
  servicos: '<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  procedimentos: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4M12 8h.01"/>',
  valores: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
  avaliacoes: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z"/>',
  local: '<path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/>',
  agendar: '<path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12Z"/>',
  sobre: '<path d="M3 9.5 4.5 4h15L21 9.5M4.5 9.5V20h15V9.5M3 9.5h18M9.5 20v-5.5h5V20"/>',
  trabalhos: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5L5 20"/>',
};
ICONES_MENU.depoimentos = ICONES_MENU.avaliacoes;
ICONES_MENU["como-chegar"] = ICONES_MENU.local;

/** O texto do item do menu com o ícone da seção ao lado. */
export const itemMenu = (ancora: string, texto: string) =>
  ICONES_MENU[ancora]
    ? `<span class="rnav"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONES_MENU[ancora]}</svg>${texto}</span>`
    : texto;
