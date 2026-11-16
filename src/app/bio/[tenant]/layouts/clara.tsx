// Bio "Clara": foto pequena ao lado do nome, selos (nota, aberto, preço), atalhos em ícones,
// cartão de horários e serviços em lista. Fraunces nos títulos, Figtree no texto.
import type { CSSProperties } from "react";
import { Figtree, Fraunces } from "next/font/google";
import { formatBRL } from "@/lib/datetime";
import { duracao, hhmm, Horarios, IconeZap, ListaServicos, abasCss, montar, precoServico, resumoSemana, type PropsBio } from "../partes";

const serifa = Fraunces({ subsets: ["latin"], weight: "600", variable: "--bio-clara-serifa" });
const sans = Figtree({ subsets: ["latin"], variable: "--bio-clara-sans" });

const CSS = `.bc{background:#FAF7F2;color:#1F1B18;font:15px/1.5 var(--bio-clara-sans),sans-serif;min-height:100dvh;padding-bottom:104px;-webkit-font-smoothing:antialiased}
.bc .col{max-width:520px;margin:0 auto}
.bc .cap{display:flex;gap:14px;align-items:center;padding:18px 16px 4px}
.bc .cap img,.bc .cap .ini{width:96px;height:96px;border-radius:24px;object-fit:cover;object-position:50% 25%;flex:none}
.bc .cap .ini{display:grid;place-items:center;background:var(--a);color:#fff;font:600 44px var(--bio-clara-serifa),serif}
.bc h1{font:600 26px/1.08 var(--bio-clara-serifa),serif;letter-spacing:-.02em;margin:0;text-wrap:balance}
.bc .meta{color:#6b625c;font-size:13px;margin-top:4px}
.bc .chips{display:flex;gap:6px;flex-wrap:wrap;padding:12px 16px 0}.bc .chips span{background:#fff;border:1px solid #ece4dc;border-radius:999px;padding:5px 11px;font-size:13px;font-weight:600}
.bc .chips .ok{background:var(--a2);border-color:transparent;color:var(--a)}.bc .star{color:#E8A33D}
.bc .at{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:16px}
.bc .at a{display:grid;justify-items:center;gap:6px;font-size:12px;font-weight:600;color:#4d4540;text-align:center}
.bc .at i{width:48px;height:48px;border-radius:16px;background:#fff;border:1px solid #ece4dc;display:grid;place-items:center;font-style:normal}
.bc .card{margin:0 16px;background:#fff;border:1px solid #ece4dc;border-radius:22px;padding:16px;display:grid;gap:12px}
.bc .hd{display:flex;justify-content:space-between;align-items:baseline;gap:8px}.bc .hd b{font:600 18px var(--bio-clara-serifa),serif}.bc .hd span{font-size:12px;color:#857b74;text-align:right}
.bc-d{display:flex;flex-wrap:wrap;gap:6px}
.bc-d-dia{display:inline-flex;align-items:center;min-height:36px;padding:0 13px;border-radius:999px;font-size:13px;font-weight:600;color:#6b625c;cursor:pointer}
.bc-d-hs{display:none;width:100%;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:6px}
.bc-d-h{display:flex;align-items:center;justify-content:center;min-height:44px;border:1px solid #e4dbd2;border-radius:12px;font-weight:700;font-size:14px;font-variant-numeric:tabular-nums}
.bc-d-h1{background:var(--a);border-color:var(--a);color:#fff}
${abasCss(".bc-d", "background:#1F1B18;color:#fff", "#1F1B18")}
.bc h2{font:600 18px var(--bio-clara-serifa),serif;margin:24px 16px 6px}
.bc .sv{margin:0 16px;background:#fff;border:1px solid #ece4dc;border-radius:22px;padding:0 16px}
.bc .row{display:flex;justify-content:space-between;align-items:center;gap:12px;min-height:56px;padding:11px 0;border-top:1px solid #f0e9e2}.bc .sv>.row:first-child{border-top:0}
.bc .row small{display:block;color:#857b74;font-size:12px}.bc .row .p{font-weight:700;white-space:nowrap;font-size:14px}.bc .row .p.s{font-weight:500;color:#857b74;font-size:12px}
.bc .mais{display:flex;align-items:center;justify-content:center;min-height:44px;border-top:1px solid #f0e9e2;font-size:13px;font-weight:600;color:#6b625c;cursor:pointer;list-style:none}
.bc .mais::-webkit-details-marker{display:none}.bc details[open]>.mais{display:none}
.bc .loc{margin:0 16px;color:#4d4540;font-size:14px;display:grid;gap:4px}.bc .loc a{text-decoration:underline;text-underline-offset:2px}
.bc .site{display:flex;justify-content:center;align-items:center;min-height:44px;margin:18px 16px 0;font-weight:600;color:var(--a)}
.bc .feito{text-align:center;font-size:12px;color:#857b74}.bc .feito a{display:inline-flex;min-height:44px;align-items:center;padding:0 4px;text-decoration:underline}
.bc .bar{position:fixed;left:0;right:0;bottom:0;max-width:520px;margin:0 auto;padding:12px 14px max(14px,env(safe-area-inset-bottom));display:flex;gap:8px;z-index:9}
.bc .bar .ag{flex:1;display:flex;justify-content:space-between;align-items:center;gap:8px;padding:0 20px;height:52px;font-weight:700;background:var(--a);color:#fff;border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.14)}
.bc .bar .ag small{font-weight:500;opacity:.85;font-size:12px}
.bc .bar .wa{width:52px;height:52px;background:#1F9D55;color:#fff;display:grid;place-items:center;flex:none;border-radius:50%;box-shadow:0 8px 24px rgba(0,0,0,.14)}`;

export default function Clara(props: PropsBio) {
  const { bio, livres } = props;
  const { local, agendar, agenda, mapa, zap, aberto, ate, fotoSrc, acento, precos, atalhos, linkServico, barra } = montar(props);
  const meta = [bio.categoria, local].filter(Boolean).join(" · ");
  const estilo = { "--a": acento, "--a2": `color-mix(in srgb, ${acento} 12%, #fff)` } as CSSProperties;
  return (
    <div className={`${serifa.variable} ${sans.variable} bc`} style={estilo}>
      <style>{CSS}</style>
      <main className="col">
        <header className="cap">
          {fotoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element -- foto do site do cliente, fora do otimizador
            <img src={fotoSrc} alt="" width={96} height={96} fetchPriority="high" decoding="async" />
          ) : (
            <span className="ini" aria-hidden="true">{bio.nome.slice(0, 1).toUpperCase()}</span>
          )}
          <div>
            <h1>{bio.nome}</h1>
            {meta && <p className="meta">{meta}</p>}
          </div>
        </header>

        <div className="chips">
          {bio.nota && (
            <span>
              <b className="star" aria-hidden="true">★</b> {bio.nota.toFixed(1).replace(".", ",")}
              {bio.avaliacoes ? ` · ${bio.avaliacoes.toLocaleString("pt-BR")} no Google` : " no Google"}
            </span>
          )}
          {bio.expediente.length > 0 && <span className={aberto ? "ok" : undefined}>{aberto && ate ? `Aberto até ${hhmm(ate)}` : "Fechado agora"}</span>}
          {precos.length > 0 && <span>a partir de {formatBRL(Math.min(...precos))}</span>}
        </div>

        {atalhos.length > 0 && (
          <nav aria-label="Contato" className="at">
            {atalhos.map((a) => (
              <a key={a.rotulo} href={a.href} {...(a.externo !== false && { target: "_blank", rel: "noreferrer" })}>
                <i style={{ color: a.tinta }}>{a.icone}</i>
                {a.rotulo}
              </a>
            ))}
          </nav>
        )}

        {livres && (
          <section aria-label="Próximos horários" className="card">
            <div className="hd">
              <b>Próximos horários</b>
              <span>
                {livres.servico.nome} · {duracao(livres.servico.duracao)}
              </span>
            </div>
            <Horarios livres={livres} agendar={agendar} escopo="bc-d" />
          </section>
        )}

        {bio.servicos.length > 0 && (
          <section aria-labelledby="bc-servicos">
            <h2 id="bc-servicos">Serviços</h2>
            <div className="sv">
              <ListaServicos
                servicos={bio.servicos}
                mais="mais"
                item={(sv) => (
                  <a key={sv.id} href={linkServico(sv)} className="row">
                    <span>
                      {sv.nome}
                      <small>{duracao(sv.duracao)}</small>
                    </span>
                    {precoServico(sv) ? <span className="p">{precoServico(sv)}</span> : <span className="p s">na avaliação</span>}
                  </a>
                )}
              />
            </div>
          </section>
        )}

        {(bio.endereco || bio.expediente.length > 0) && (
          <section aria-labelledby="bc-onde">
            <h2 id="bc-onde">Onde e quando</h2>
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
