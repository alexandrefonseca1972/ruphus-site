// Bio "Cartaz": nome enorme em Archivo condensada, caixa alta, sobre um bloco na cor do negócio;
// faixa de foto logo abaixo, atalhos como etiquetas de borda grossa, horários num quadro escuro e
// preços como cardápio de parede (pontilhado até o valor). Em saúde o bloco fica escuro e sóbrio.
import type { CSSProperties } from "react";
import { Archivo, Inter } from "next/font/google";
import { claro, duracao, hhmm, Horarios, IconeZap, ListaServicos, abasCss, montar, precoServico, resumoSemana, type PropsBio } from "../partes";

const titulo = Archivo({ subsets: ["latin"], axes: ["wdth"], variable: "--bio-cartaz-titulo" });
const sans = Inter({ subsets: ["latin"], variable: "--bio-cartaz-sans" });

const CSS = `.bz{background:#F4F1EC;color:#141212;font:15px/1.5 var(--bio-cartaz-sans),sans-serif;min-height:100dvh;padding-bottom:104px;-webkit-font-smoothing:antialiased}
.bz .col{max-width:520px;margin:0 auto}
.bz .top{background:var(--c);color:var(--on);padding:20px 16px 18px}
.bz .ey{font-weight:700;font-size:11px;letter-spacing:.16em;text-transform:uppercase;opacity:.85}
.bz h1,.bz h2{font-family:var(--bio-cartaz-titulo),sans-serif;font-stretch:70%;font-weight:900;text-transform:uppercase;overflow-wrap:anywhere}
.bz h1{font-size:clamp(40px,13vw,60px);line-height:.9;margin:10px 0 14px;text-wrap:balance}
.bz .rt{display:flex;gap:10px;align-items:center;font-weight:600;font-size:13px;flex-wrap:wrap;margin:0}
.bz .rt .k{background:var(--on);color:var(--c);border-radius:3px;padding:3px 8px;font-weight:800}
.bz .foto{display:block;width:100%;height:150px;object-fit:cover;object-position:50% 30%}
.bz .at{display:flex;gap:6px;padding:14px 16px 0;overflow-x:auto;scrollbar-width:none}.bz .at::-webkit-scrollbar{display:none}
.bz .at a{flex:none;display:flex;gap:6px;align-items:center;min-height:44px;border:2px solid #141212;border-radius:3px;padding:0 11px;font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.bz .at svg{width:18px;height:18px}
.bz h2{font-size:30px;line-height:1;margin:24px 16px 10px}
.bz .quadro{margin:0 16px;background:#141212;color:#F4F1EC;border-radius:4px;padding:6px 14px 14px}
.bz-d{display:flex;flex-wrap:wrap;column-gap:14px}
.bz-d-dia{display:inline-flex;align-items:center;min-height:40px;font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#8c8680;border-bottom:3px solid transparent;cursor:pointer}
.bz-d-hs{display:none;width:100%;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:10px}
.bz-d-h{display:flex;align-items:center;justify-content:center;min-height:44px;border:1px solid #3a3533;border-radius:3px;font:800 17px var(--bio-cartaz-titulo),sans-serif;font-stretch:80%;font-variant-numeric:tabular-nums}
.bz-d-h1{background:var(--d);border-color:transparent;color:var(--don)}
${abasCss(".bz-d", "color:#fff;border-bottom-color:var(--d)", "#fff")}
.bz .menu{margin:0 16px}
.bz .it{display:flex;align-items:baseline;gap:8px;padding:10px 0;border-bottom:1px solid #ddd6cf;min-height:48px}.bz .it .d{flex:1;min-width:12px;border-bottom:2px dotted #b9b1aa;transform:translateY(-4px)}
.bz .it b{font:800 17px var(--bio-cartaz-titulo),sans-serif;font-stretch:80%;text-transform:uppercase}.bz .it small{display:block;color:#7a736d;font-size:12px}
.bz .it .v{font:800 17px var(--bio-cartaz-titulo),sans-serif;white-space:nowrap}.bz .it .v.s{font:600 12px var(--bio-cartaz-sans),sans-serif;color:#7a736d}
.bz .mais{display:flex;align-items:center;justify-content:center;min-height:44px;border-bottom:1px solid #ddd6cf;font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:.06em;cursor:pointer;list-style:none}
.bz .mais::-webkit-details-marker{display:none}.bz details[open]>.mais{display:none}
.bz .loc{margin:0 16px;font-weight:600;font-size:14px;display:grid;gap:2px}.bz .loc a{text-decoration:underline;text-underline-offset:2px}
.bz .site{display:flex;align-items:center;min-height:44px;margin:16px 16px 0;font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:.08em;text-decoration:underline}
.bz .feito{padding:0 16px;font-size:12px;color:#7a736d}.bz .feito a{display:inline-flex;min-height:44px;align-items:center;padding:0 4px;text-decoration:underline}
.bz .bar{position:fixed;left:0;right:0;bottom:0;max-width:520px;margin:0 auto;padding:12px 14px max(14px,env(safe-area-inset-bottom));display:flex;gap:8px;z-index:9}
.bz .bar .ag{flex:1;display:flex;justify-content:space-between;align-items:center;gap:8px;padding:0 18px;height:52px;font-weight:700;background:#141212;color:#fff;border-radius:4px;text-transform:uppercase;letter-spacing:.05em;font-size:14px;box-shadow:0 8px 24px rgba(0,0,0,.16)}
.bz .bar .ag small{font-weight:500;opacity:.85;font-size:12px;text-transform:none;letter-spacing:0}
.bz .bar .wa{width:52px;height:52px;background:#1F9D55;color:#fff;display:grid;place-items:center;flex:none;border-radius:4px;box-shadow:0 8px 24px rgba(0,0,0,.16)}`;

export default function Cartaz(props: PropsBio) {
  const { bio, livres } = props;
  const { local, agendar, agenda, mapa, zap, aberto, ate, fotoSrc, acento, atalhos, linkServico, barra } = montar(props);
  // saúde: bloco verde-petróleo escuro e destaque água, no lugar da cor do negócio
  const cor = bio.saude ? "#0E3B3A" : bio.cor;
  const destaque = bio.saude ? "#7FD1C7" : bio.cor;
  const estilo = { "--a": acento, "--c": cor, "--on": claro(cor) ? "#141212" : "#fff", "--d": destaque, "--don": claro(destaque) ? "#141212" : "#fff" } as CSSProperties;
  const meta = [bio.categoria, local].filter(Boolean).join(" · ");
  const foto = bio.fotos[0] ?? fotoSrc;
  return (
    <div className={`${titulo.variable} ${sans.variable} bz`} style={estilo}>
      <style>{CSS}</style>
      <main className="col">
        <header className="top">
          {meta && <p className="ey">{meta}</p>}
          <h1>{bio.nome}</h1>
          {(bio.nota || bio.expediente.length > 0) && (
            <p className="rt">
              {bio.nota && <span className="k">★ {bio.nota.toFixed(1).replace(".", ",")}</span>}
              {bio.nota && <span>{bio.avaliacoes ? `${bio.avaliacoes.toLocaleString("pt-BR")} avaliações no Google` : "no Google"}</span>}
              {bio.expediente.length > 0 && <span>{bio.nota && "· "}{aberto && ate ? `aberto até ${hhmm(ate)}` : "fechado agora"}</span>}
            </p>
          )}
        </header>
        {foto && (
          // eslint-disable-next-line @next/next/no-img-element -- foto do site do cliente, fora do otimizador
          <img className="foto" src={foto} alt="" width={520} height={150} fetchPriority="high" decoding="async" />
        )}

        {atalhos.length > 0 && (
          <nav aria-label="Contato" className="at">
            {atalhos.map((a) => (
              <a key={a.rotulo} href={a.href} {...(a.externo !== false && { target: "_blank", rel: "noreferrer" })}>
                {a.icone}
                {a.rotulo}
              </a>
            ))}
          </nav>
        )}

        {livres && (
          <section aria-labelledby="bz-horarios">
            <h2 id="bz-horarios">Horários livres</h2>
            <div className="quadro">
              <Horarios livres={livres} agendar={agendar} escopo="bz-d" />
            </div>
          </section>
        )}

        {bio.servicos.length > 0 && (
          <section aria-labelledby="bz-servicos">
            <h2 id="bz-servicos">{bio.saude ? "Atendimentos" : "Preços"}</h2>
            <div className="menu">
              <ListaServicos
                servicos={bio.servicos}
                mais="mais"
                item={(sv) => (
                  <a key={sv.id} href={linkServico(sv)} className="it">
                    <span>
                      <b>{sv.nome}</b>
                      <small>{duracao(sv.duracao)}</small>
                    </span>
                    <span className="d" aria-hidden="true" />
                    {precoServico(sv) ? <span className="v">{precoServico(sv)}</span> : <span className="v s">na avaliação</span>}
                  </a>
                )}
              />
            </div>
          </section>
        )}

        {(bio.endereco || bio.expediente.length > 0) && (
          <section aria-labelledby="bz-onde">
            <h2 id="bz-onde">Endereço</h2>
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
          Ver o site completo
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
