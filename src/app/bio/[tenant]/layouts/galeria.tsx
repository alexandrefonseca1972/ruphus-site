// Bio "Galeria": mosaico com três fotos do site no topo, cartão com o nome por cima, horários
// em faixa rolável e serviços com miniatura. Instrument Sans, com Instrument Serif itálico de
// destaque. Precisa de 3 fotos: com menos, o seletor (layouts/index.tsx) usa a Clara.
import type { CSSProperties } from "react";
import { Instrument_Sans, Instrument_Serif } from "next/font/google";
import { duracao, hhmm, Horarios, IconeZap, ListaServicos, abasCss, montar, precoServico, resumoSemana, type PropsBio } from "../partes";

const sans = Instrument_Sans({ subsets: ["latin"], variable: "--bio-galeria-sans" });
const serifa = Instrument_Serif({ subsets: ["latin"], weight: "400", style: "italic", variable: "--bio-galeria-serifa" });

const CSS = `.bg{background:#fff;color:#111;font:15px/1.5 var(--bio-galeria-sans),sans-serif;min-height:100dvh;padding-bottom:104px;-webkit-font-smoothing:antialiased}
.bg .col{max-width:520px;margin:0 auto}
.bg .mos{display:grid;grid-template-columns:2fr 1fr;grid-template-rows:repeat(2,minmax(0,1fr));gap:3px;height:300px;overflow:hidden}.bg .mos img{width:100%;height:100%;min-height:0;object-fit:cover}.bg .mos img:first-child{grid-row:span 2}
.bg .card{position:relative;margin:-44px 12px 0;background:#fff;border-radius:18px;padding:16px;box-shadow:0 12px 30px rgba(0,0,0,.12)}
.bg h1{font-weight:600;font-size:28px;line-height:1.05;letter-spacing:-.03em;margin:0;text-wrap:balance}
.bg h1 em,.bg h2 em{font-family:var(--bio-galeria-serifa),serif;font-weight:400;font-style:italic;color:var(--a)}
.bg .meta{color:#666;font-size:13px;margin-top:4px}
.bg .rt{display:flex;gap:6px;align-items:center;margin-top:10px;font-size:13px;font-weight:600;flex-wrap:wrap}.bg .star{color:#E8A33D;letter-spacing:1px}
.bg .at{display:flex;gap:8px;padding:14px 12px 0}.bg .at a{flex:1;display:grid;justify-items:center;gap:4px;font-size:11px;font-weight:600;color:#444;padding:9px 0;border:1px solid #eee;border-radius:12px;text-align:center}
.bg h2{font-weight:600;font-size:22px;letter-spacing:-.02em;margin:24px 14px 10px}
.bg-d{display:flex;flex-wrap:wrap;gap:6px;margin:0 14px}
.bg-d-dia{display:inline-flex;align-items:center;min-height:36px;padding:0 12px;border-radius:999px;font-size:13px;font-weight:600;border:1px solid #eee;cursor:pointer}
.bg-d-hs{display:none;width:100%;gap:6px;overflow-x:auto;margin-top:4px;scrollbar-width:none}.bg-d-hs::-webkit-scrollbar{display:none}
.bg-d-h{flex:none;display:flex;align-items:center;min-height:44px;border:1px solid #e4e4e4;border-radius:12px;padding:0 14px;font-weight:600;font-size:14px;font-variant-numeric:tabular-nums}
.bg-d-h1{border-color:var(--a);color:var(--a);box-shadow:inset 0 0 0 1px var(--a)}
${abasCss(".bg-d", "background:#111;color:#fff;border-color:#111", "#111", "flex")}
.bg .sv{display:grid;gap:8px;margin:0 14px}.bg .sv details{display:grid;gap:8px}
.bg .s{display:flex;gap:12px;align-items:center;border:1px solid #eee;border-radius:14px;padding:7px}
.bg .s img{width:58px;height:58px;border-radius:10px;object-fit:cover;flex:none}.bg .s span{flex:1;font-size:14px}.bg .s small{color:#777;display:block;font-size:12px}
.bg .s b{white-space:nowrap;font-size:14px;padding-right:6px}.bg .s b.x{font-weight:500;color:#777;font-size:12px}
.bg .mais{display:flex;align-items:center;justify-content:center;min-height:44px;border:1px solid #eee;border-radius:14px;font-size:13px;font-weight:600;color:#444;cursor:pointer;list-style:none}
.bg .mais::-webkit-details-marker{display:none}.bg details[open]>.mais{display:none}
.bg .loc{margin:0 14px;color:#444;font-size:14px;display:grid;gap:2px}.bg .loc a{text-decoration:underline;text-underline-offset:2px}
.bg .site{display:flex;justify-content:center;align-items:center;min-height:44px;margin:16px 14px 0;font-weight:600}
.bg .feito{text-align:center;font-size:12px;color:#888}.bg .feito a{display:inline-flex;min-height:44px;align-items:center;padding:0 4px;text-decoration:underline}
.bg .bar{position:fixed;left:0;right:0;bottom:0;max-width:520px;margin:0 auto;padding:12px 14px max(14px,env(safe-area-inset-bottom));display:flex;gap:8px;z-index:9}
.bg .bar .ag{flex:1;display:flex;justify-content:space-between;align-items:center;gap:8px;padding:0 18px;height:52px;font-weight:700;background:#111;color:#fff;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.16)}
.bg .bar .ag small{font-weight:500;opacity:.85;font-size:12px}
.bg .bar .wa{width:52px;height:52px;background:#1F9D55;color:#fff;display:grid;place-items:center;flex:none;border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.16)}`;

export default function Galeria(props: PropsBio) {
  const { bio, livres } = props;
  const { local, agendar, agenda, mapa, zap, aberto, ate, acento, atalhos, linkServico, barra } = montar(props);
  const meta = [bio.categoria, local].filter(Boolean).join(" · ");
  // a última palavra do nome em itálico, como no mockup
  const [, inicio, ultima] = /^(.*?)(\S+)$/.exec(bio.nome.trim()) ?? [, "", bio.nome];
  const nota = [
    bio.nota && `${bio.nota.toFixed(1).replace(".", ",")}${bio.avaliacoes ? ` · ${bio.avaliacoes.toLocaleString("pt-BR")} no Google` : " no Google"}`,
    bio.expediente.length > 0 && (aberto && ate ? `aberto até ${hhmm(ate)}` : "fechado agora"),
  ].filter(Boolean);
  const fotos = bio.fotos.slice(0, 3);
  return (
    <div className={`${sans.variable} ${serifa.variable} bg`} style={{ "--a": acento } as CSSProperties}>
      <style>{CSS}</style>
      <main className="col">
        <div className="mos">
          {fotos.map((f, i) => (
            // eslint-disable-next-line @next/next/no-img-element -- fotos do site do cliente, fora do otimizador
            <img key={f} src={f} alt="" width={i ? 173 : 347} height={i ? 148 : 300} {...(i === 0 ? { fetchPriority: "high" as const } : {})} decoding="async" />
          ))}
        </div>
        <header className="card">
          <h1>
            {inicio}
            <em>{ultima}</em>
          </h1>
          {meta && <p className="meta">{meta}</p>}
          {nota.length > 0 && (
            <p className="rt">
              {bio.nota && <span className="star" aria-hidden="true">★★★★★</span>}
              {nota.join(" · ")}
            </p>
          )}
        </header>

        {atalhos.length > 0 && (
          <nav aria-label="Contato" className="at">
            {atalhos.map((a) => (
              <a key={a.rotulo} href={a.href} {...(a.externo !== false && { target: "_blank", rel: "noreferrer" })}>
                <span style={{ color: a.tinta }}>{a.icone}</span>
                {a.rotulo}
              </a>
            ))}
          </nav>
        )}

        {livres && (
          <section aria-label="Horários livres">
            <h2>
              Horários <em>livres</em>
            </h2>
            <Horarios livres={livres} agendar={agendar} escopo="bg-d" />
          </section>
        )}

        {bio.servicos.length > 0 && (
          <section aria-labelledby="bg-servicos">
            <h2 id="bg-servicos">Serviços</h2>
            <div className="sv">
              <ListaServicos
                servicos={bio.servicos}
                mais="mais"
                item={(sv, i) => (
                  <a key={sv.id} href={linkServico(sv)} className="s">
                    {/* eslint-disable-next-line @next/next/no-img-element -- miniatura das fotos do site */}
                    <img src={fotos[i % fotos.length]} alt="" width={58} height={58} loading="lazy" decoding="async" />
                    <span>
                      {sv.nome}
                      <small>{duracao(sv.duracao)}</small>
                    </span>
                    {precoServico(sv) ? <b>{precoServico(sv)}</b> : <b className="x">na avaliação</b>}
                  </a>
                )}
              />
            </div>
          </section>
        )}

        {(bio.endereco || bio.expediente.length > 0) && (
          <section aria-labelledby="bg-onde">
            <h2 id="bg-onde">Onde fica</h2>
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
        <div className="bar">
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
