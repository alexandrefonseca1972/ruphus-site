// Bio "Vidro": a foto do negócio é o fundo da página inteira, desfocada, e o conteúdo fica em
// painéis de vidro fosco tingidos com a cor do negócio; barra de agendar em vidro, flutuando.
// Geist e Geist Mono. Sem backdrop-filter (Android simples) ou com transparência reduzida, os
// painéis viram sólidos.
import type { CSSProperties } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { claro, duracao, hhmm, Horarios, IconeZap, ListaServicos, abasCss, montar, precoServico, resumoSemana, type PropsBio } from "../partes";

const sans = Geist({ subsets: ["latin"], preload: false, variable: "--bio-vidro-sans" });
const mono = Geist_Mono({ subsets: ["latin"], preload: false, variable: "--bio-vidro-mono" });

const CSS = `.bv{position:relative;isolation:isolate;background:#121014;color:#fff;font:15px/1.5 var(--bio-vidro-sans),sans-serif;min-height:100dvh;padding-bottom:110px;-webkit-font-smoothing:antialiased}
.bv .col{max-width:520px;margin:0 auto}.bv .mono{font-family:var(--bio-vidro-mono),monospace}
.bv .fundo{position:fixed;inset:-40px;width:calc(100% + 80px);height:calc(100% + 80px);object-fit:cover;filter:blur(30px) saturate(1.4) brightness(.7);z-index:-1}
.bv .hero{position:relative;isolation:isolate;min-height:360px;display:flex;flex-direction:column;justify-content:flex-end;padding:16px;gap:8px;background:linear-gradient(160deg,color-mix(in srgb,var(--c) 70%,#121014),#121014)}
.bv .hero img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 25%;z-index:-1}
.bv .hero::after{content:"";position:absolute;inset:0;background:linear-gradient(to top,rgba(18,16,20,.78),rgba(18,16,20,0) 55%);z-index:-1}
.bv h1{font-weight:600;font-size:32px;line-height:1.05;letter-spacing:-.03em;margin:0;text-wrap:balance}
.bv .meta{font-size:13px;opacity:.8;margin:0}
.bv .pills{display:flex;gap:6px;flex-wrap:wrap;font-size:12px;font-weight:500;margin:0}.bv .pills span{border-radius:999px;padding:5px 10px}
.bv .dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#5BE08F;margin-right:6px}
.bv .g{background:#2a2630;background:color-mix(in srgb,var(--c) 14%,rgba(255,255,255,.12));-webkit-backdrop-filter:blur(18px) saturate(1.5);backdrop-filter:blur(18px) saturate(1.5);border:1px solid rgba(255,255,255,.22)}
.bv .at{display:flex;justify-content:space-around;padding:16px 10px 6px}
.bv .at a{display:grid;justify-items:center;gap:6px;font-size:11px;font-weight:500;opacity:.92;min-width:64px}.bv .at i{width:54px;height:54px;border-radius:50%;display:grid;place-items:center;font-style:normal}
.bv .p{margin:12px 12px 0;border-radius:24px;padding:16px}
.bv .p h2{margin:0 0 10px;font-size:13px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;opacity:.75}
.bv-d{display:flex;flex-wrap:wrap;gap:6px}
.bv-d-dia{display:inline-flex;align-items:center;min-height:36px;padding:0 12px;border-radius:999px;font-size:13px;opacity:.75;cursor:pointer}
.bv-d-hs{display:none;width:100%;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:4px}
.bv-d-h{display:flex;align-items:center;justify-content:center;min-height:44px;border-radius:12px;font:500 14px var(--bio-vidro-mono),monospace;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.16)}
.bv-d-h1{background:var(--c);border-color:var(--c);color:var(--on)}
${abasCss(".bv-d", "background:#fff;color:#121014;opacity:1;font-weight:600", "#fff")}
.bv .row{display:flex;justify-content:space-between;align-items:center;gap:10px;min-height:52px;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.14);font-size:14px}
.bv .row small{display:block;opacity:.65;font-size:12px}.bv .row b{font:500 14px var(--bio-vidro-mono),monospace;white-space:nowrap}.bv .row b.s{font:400 12px var(--bio-vidro-sans),sans-serif;opacity:.7}
.bv .mais{display:flex;align-items:center;justify-content:center;min-height:44px;font-size:13px;font-weight:600;opacity:.85;cursor:pointer;list-style:none}
.bv .mais::-webkit-details-marker{display:none}.bv details[open]>.mais{display:none}
.bv .loc{font-size:14px;display:grid;gap:3px;opacity:.9}.bv .loc a{text-decoration:underline;text-underline-offset:2px}
.bv .site{display:flex;justify-content:center;align-items:center;min-height:44px;margin-top:14px;font-size:14px;opacity:.85}
.bv .feito{text-align:center;font-size:12px;opacity:.7;margin:0}.bv .feito a{display:inline-flex;min-height:44px;align-items:center;padding:0 4px;text-decoration:underline}
.bv .bar{position:fixed;left:12px;right:12px;bottom:max(12px,env(safe-area-inset-bottom));max-width:496px;margin:0 auto;padding:6px;border-radius:999px;display:flex;gap:6px;z-index:9;box-shadow:0 10px 30px rgba(0,0,0,.3)}
.bv .bar .ag{flex:1;display:flex;justify-content:space-between;align-items:center;gap:8px;padding:0 18px;height:48px;font-weight:700;background:var(--c);color:var(--on);border-radius:999px}
.bv .bar .ag small{font-weight:500;opacity:.85;font-size:12px}
.bv .bar .wa{width:48px;height:48px;background:#1F9D55;color:#fff;display:grid;place-items:center;flex:none;border-radius:50%}
@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))){.bv .g{background:#2a2630;background:color-mix(in srgb,var(--c) 18%,#221f25)}}
@media (prefers-reduced-transparency:reduce){.bv .g{background:#2a2630;background:color-mix(in srgb,var(--c) 18%,#221f25);-webkit-backdrop-filter:none;backdrop-filter:none}}`;

export default function Vidro(props: PropsBio) {
  const { bio, livres } = props;
  const { local, agendar, agenda, mapa, zap, aberto, ate, fotoSrc, acento, atalhos, linkServico, barra } = montar(props);
  const estilo = { "--a": acento, "--c": bio.cor, "--on": claro(bio.cor) ? "#121014" : "#fff" } as CSSProperties;
  const meta = [bio.categoria, local].filter(Boolean).join(" · ");
  const foto = bio.fotos[0] ?? fotoSrc;
  return (
    <div className={`${sans.variable} ${mono.variable} bv`} style={estilo}>
      <style>{CSS}</style>
      {foto && (
        // eslint-disable-next-line @next/next/no-img-element -- fundo desfocado com a foto do site
        <img className="fundo" src={foto} alt="" width={600} height={900} decoding="async" />
      )}
      <main className="col">
        <header className="hero">
          {foto && (
            // eslint-disable-next-line @next/next/no-img-element -- foto do site do cliente, fora do otimizador
            <img src={foto} alt="" width={520} height={360} fetchPriority="high" decoding="async" />
          )}
          {(bio.nota || bio.expediente.length > 0) && (
            <p className="pills">
              {bio.expediente.length > 0 && (
                <span className="g">
                  {aberto && <span className="dot" aria-hidden="true" />}
                  {aberto && ate ? `Aberto até ${hhmm(ate)}` : "Fechado agora"}
                </span>
              )}
              {bio.nota && (
                <span className="g">
                  ★ {bio.nota.toFixed(1).replace(".", ",")}
                  {bio.avaliacoes ? ` · ${bio.avaliacoes.toLocaleString("pt-BR")} no Google` : " no Google"}
                </span>
              )}
            </p>
          )}
          <h1>{bio.nome}</h1>
          {meta && <p className="meta">{meta}</p>}
        </header>

        {atalhos.length > 0 && (
          <nav aria-label="Contato" className="at">
            {atalhos.map((a) => (
              <a key={a.rotulo} href={a.href} {...(a.externo !== false && { target: "_blank", rel: "noreferrer" })}>
                <i className="g">{a.icone}</i>
                {a.rotulo}
              </a>
            ))}
          </nav>
        )}

        {livres && (
          <section aria-labelledby="bv-horarios" className="p g">
            <h2 id="bv-horarios">Próximos horários · {livres.servico.nome}</h2>
            <Horarios livres={livres} agendar={agendar} escopo="bv-d" />
          </section>
        )}

        {bio.servicos.length > 0 && (
          <section aria-labelledby="bv-servicos" className="p g">
            <h2 id="bv-servicos">Serviços</h2>
            <ListaServicos
              servicos={bio.servicos}
              mais="mais"
              item={(sv) => (
                <a key={sv.id} href={linkServico(sv)} className="row">
                  <span>
                    {sv.nome}
                    <small>{duracao(sv.duracao)}</small>
                  </span>
                  {precoServico(sv) ? <b>{precoServico(sv)}</b> : <b className="s">na avaliação</b>}
                </a>
              )}
            />
          </section>
        )}

        {(bio.endereco || bio.expediente.length > 0) && (
          <section aria-labelledby="bv-onde" className="p g">
            <h2 id="bv-onde">Onde e quando</h2>
            <div className="loc">
              {bio.endereco && mapa && (
                <a href={mapa} target="_blank" rel="noreferrer">
                  {bio.endereco}
                </a>
              )}
              {bio.expediente.length > 0 && <span>{resumoSemana(bio.expediente)}</span>}
            </div>
          </section>
        )}

        <a className="site" href={bio.site}>
          Ver o site completo →
        </a>
        <p className="feito">
          {bio.nome} · feito com <a href="https://www.ruphus.site/">Ruphus</a>
        </p>
      </main>

      {barra && (
        <div className="bar g">
          <a className="ag" href={barra.href}>
            {barra.rotulo}
            {barra.livre && <small>{barra.livre}</small>}
          </a>
          {agenda && zap && (
            <a className="wa" href={zap} target="_blank" rel="noreferrer" aria-label="Falar no WhatsApp">
              <IconeZap />
            </a>
          )}
        </div>
      )}
    </div>
  );
}
