// Bio "Noturno": fundo escuro com uma aurora na cor do negócio (e em dois tons vizinhos) atrás da
// foto recortada em retrato com brilho, textura de grão e endereço e horário recolhidos num
// <details>. Sora nos títulos, Inter no texto. Em saúde vira a versão clara "amanhecer". A aurora
// para para quem desativou animação.
import type { CSSProperties } from "react";
import { Inter, Sora } from "next/font/google";
import { claro, duracao, hhmm, Horarios, IconeZap, ListaServicos, abasCss, montar, precoServico, resumoSemana, type PropsBio } from "../partes";

const titulo = Sora({ subsets: ["latin"], weight: ["500", "600"], variable: "--bio-noturno-titulo" });
const sans = Inter({ subsets: ["latin"], variable: "--bio-noturno-sans" });

const GRAO = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='.5'/%3E%3C/svg%3E")`;

// --fundo, --tinta, --mudo, --linha e os tons da aurora mudam na variante clara (.am); o resto é igual.
// Os tons vizinhos da aurora saem da cor do negócio (cor relativa, dentro de @supports: com var()
// a declaração não cai sozinha); navegador sem isso fica com os tons fixos do mockup (roxo e magenta à noite, azul e verde-água no amanhecer).
const CSS = `.bn{--fundo:#0C0B0E;--tinta:#F4F1F4;--mudo:#A39DA6;--linha:#2A262D;--forca:67%;--grao:.12;--t2:#6B47D6aa;--t3:#C2417A88}
.bn.am{--fundo:#F3F5F9;--tinta:#14171C;--mudo:#5E6672;--linha:#DDE2EA;--forca:33%;--grao:.05;--t2:#7FB8FF55;--t3:#9BE3D455}
.bn{background:var(--fundo);color:var(--tinta);font:15px/1.5 var(--bio-noturno-sans),sans-serif;min-height:100dvh;padding-bottom:104px;-webkit-font-smoothing:antialiased}
.bn .col{max-width:520px;margin:0 auto}
.bn .top{position:relative;isolation:isolate;padding:34px 16px 6px;text-align:center;overflow:hidden}
.bn .aur{position:absolute;inset:-30% -30% 10%;z-index:-1;filter:blur(10px);background-size:140% 140%;animation:bn-aur 14s ease-in-out infinite alternate;
background-image:radial-gradient(40% 35% at 30% 30%,color-mix(in srgb,var(--c) var(--forca),transparent),transparent 70%),radial-gradient(35% 30% at 72% 40%,var(--t2),transparent 70%),radial-gradient(30% 30% at 50% 70%,var(--t3),transparent 70%)}
@supports (color:oklch(from red l c h)){.bn.bn{--t2:oklch(from var(--c) l c calc(h + 70) / var(--forca));--t3:oklch(from var(--c) l c calc(h - 50) / var(--forca))}}
.bn .gr{position:absolute;inset:0;z-index:-1;background:${GRAO};opacity:var(--grao);mix-blend-mode:overlay}
@keyframes bn-aur{to{background-position:100% 60%}}
@media (prefers-reduced-motion:reduce){.bn .aur{animation:none}}
.bn .ph{display:block;width:62%;aspect-ratio:3/4;height:auto;margin:0 auto;border-radius:30px;object-fit:cover;object-position:50% 25%;box-shadow:0 20px 60px color-mix(in srgb,var(--c) 40%,transparent)}
.bn .ini{display:grid;place-items:center;width:120px;height:120px;margin:0 auto;border-radius:50%;background:var(--c);color:var(--on);font:600 52px var(--bio-noturno-titulo),sans-serif;box-shadow:0 20px 60px color-mix(in srgb,var(--c) 50%,transparent)}
.bn h1{font:600 30px/1.05 var(--bio-noturno-titulo),sans-serif;letter-spacing:-.03em;margin:18px 0 6px;text-wrap:balance}
.bn .meta{color:var(--mudo);font-size:13px;margin:0}
.bn .st{display:inline-flex;flex-wrap:wrap;justify-content:center;gap:8px;margin:10px 0 0;font-size:13px;font-weight:600}.bn .st span{border:1px solid var(--linha);border-radius:999px;padding:4px 11px}
.bn .at{display:flex;justify-content:center;gap:12px;padding:18px 0 4px}.bn .at a{width:50px;height:50px;border-radius:50%;border:1px solid var(--linha);display:grid;place-items:center;color:var(--tinta)}
.bn .at svg{width:20px;height:20px}
.bn h2{font:600 15px var(--bio-noturno-titulo),sans-serif;margin:22px 16px 6px}
.bn-d{display:flex;flex-wrap:wrap;column-gap:14px;margin:0 16px}
.bn-d-dia{display:inline-flex;align-items:center;min-height:40px;font-size:13px;color:var(--mudo);border-bottom:2px solid transparent;cursor:pointer}
.bn-d-hs{display:none;width:100%;grid-template-columns:repeat(4,1fr);gap:7px;margin-top:8px}
.bn-d-h{display:flex;align-items:center;justify-content:center;min-height:44px;border:1px solid var(--linha);border-radius:14px;font-weight:600;font-size:14px;font-variant-numeric:tabular-nums}
.bn-d-h1{background:var(--c);border-color:var(--c);color:var(--on);box-shadow:0 0 24px color-mix(in srgb,var(--c) 60%,transparent)}
${abasCss(".bn-d", "color:var(--tinta);font-weight:600;border-bottom-color:var(--c)", "var(--tinta)")}
.bn .sv{margin:0 16px}.bn .row{display:flex;justify-content:space-between;align-items:center;gap:10px;min-height:52px;padding:10px 0;border-bottom:1px solid var(--linha);font-size:14px}
.bn .row small{display:block;color:var(--mudo);font-size:12px}.bn .row b{white-space:nowrap}.bn .row b.s{font-weight:400;color:var(--mudo);font-size:12px}
.bn .mais{display:flex;align-items:center;justify-content:center;min-height:44px;border-bottom:1px solid var(--linha);font-size:13px;font-weight:600;color:var(--mudo);cursor:pointer;list-style:none}
.bn .mais::-webkit-details-marker{display:none}.bn .sv details[open]>.mais{display:none}
.bn .onde{margin:16px;border:1px solid var(--linha);border-radius:16px;padding:0 14px;font-size:14px}.bn .onde summary{display:flex;align-items:center;min-height:48px;font-weight:600;cursor:pointer}
.bn .onde div{display:grid;gap:2px;padding-bottom:12px;color:var(--mudo)}.bn .onde a{text-decoration:underline;text-underline-offset:2px}
.bn .site{display:flex;justify-content:center;align-items:center;min-height:44px;color:var(--mudo);font-size:14px}
.bn .feito{text-align:center;font-size:12px;color:var(--mudo);margin:0}.bn .feito a{display:inline-flex;min-height:44px;align-items:center;padding:0 4px;text-decoration:underline}
.bn .bar{position:fixed;left:0;right:0;bottom:0;max-width:520px;margin:0 auto;padding:12px 14px max(14px,env(safe-area-inset-bottom));display:flex;gap:8px;z-index:9}
.bn .bar .ag{flex:1;display:flex;justify-content:space-between;align-items:center;gap:8px;padding:0 20px;height:52px;font-weight:700;background:var(--c);color:var(--on);border-radius:999px;box-shadow:0 8px 30px color-mix(in srgb,var(--c) 45%,transparent)}
.bn .bar .ag small{font-weight:500;opacity:.85;font-size:12px}
.bn .bar .wa{width:52px;height:52px;background:#1F9D55;color:#fff;display:grid;place-items:center;flex:none;border-radius:50%;box-shadow:0 8px 24px rgba(0,0,0,.2)}`;

export default function Noturno(props: PropsBio) {
  const { bio, livres } = props;
  const { local, agendar, agenda, mapa, zap, aberto, ate, fotoSrc, acento, atalhos, linkServico, barra } = montar(props);
  const estilo = { "--a": acento, "--c": bio.cor, "--on": claro(bio.cor) ? "#14171C" : "#fff" } as CSSProperties;
  const meta = [bio.categoria, local].filter(Boolean).join(" · ");
  const foto = bio.fotos[0] ?? fotoSrc;
  return (
    <div className={`${titulo.variable} ${sans.variable} bn${bio.saude ? " am" : ""}`} style={estilo}>
      <style>{CSS}</style>
      <main className="col">
        <header className="top">
          <div className="aur" aria-hidden="true" />
          <div className="gr" aria-hidden="true" />
          {foto ? (
            // eslint-disable-next-line @next/next/no-img-element -- foto do site do cliente, fora do otimizador
            <img className="ph" src={foto} alt="" width={300} height={400} fetchPriority="high" decoding="async" />
          ) : (
            <span className="ini" aria-hidden="true">{bio.nome.slice(0, 1).toUpperCase()}</span>
          )}
          <h1>{bio.nome}</h1>
          {meta && <p className="meta">{meta}</p>}
          {(bio.nota || bio.expediente.length > 0) && (
            <p className="st">
              {bio.nota && (
                <span>
                  ★ {bio.nota.toFixed(1).replace(".", ",")}
                  {bio.avaliacoes ? ` · ${bio.avaliacoes.toLocaleString("pt-BR")} no Google` : " no Google"}
                </span>
              )}
              {bio.expediente.length > 0 && <span>{aberto && ate ? `Aberto até ${hhmm(ate)}` : "Fechado agora"}</span>}
            </p>
          )}
        </header>

        {atalhos.length > 0 && (
          <nav aria-label="Contato" className="at">
            {atalhos.map((a) => (
              <a key={a.rotulo} href={a.href} aria-label={a.rotulo} {...(a.externo !== false && { target: "_blank", rel: "noreferrer" })}>
                {a.icone}
              </a>
            ))}
          </nav>
        )}

        {livres && (
          <section aria-labelledby="bn-horarios">
            <h2 id="bn-horarios">Próximos horários</h2>
            <Horarios livres={livres} agendar={agendar} escopo="bn-d" />
          </section>
        )}

        {bio.servicos.length > 0 && (
          <section aria-labelledby="bn-servicos">
            <h2 id="bn-servicos">Serviços</h2>
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
                    {precoServico(sv) ? <b>{precoServico(sv)}</b> : <b className="s">na avaliação</b>}
                  </a>
                )}
              />
            </div>
          </section>
        )}

        {(bio.endereco || bio.expediente.length > 0) && (
          <details className="onde">
            <summary>{bio.endereco && bio.expediente.length > 0 ? "Endereço e horário" : bio.endereco ? "Endereço" : "Horário"}</summary>
            <div>
              {bio.endereco && mapa && (
                <a href={mapa} target="_blank" rel="noreferrer">
                  {bio.endereco}
                </a>
              )}
              {bio.expediente.length > 0 && <span>{resumoSemana(bio.expediente)}</span>}
            </div>
          </details>
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
