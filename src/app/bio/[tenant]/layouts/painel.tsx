// Bio "Painel": grade de blocos (bento). Foto com o nome, nota gigante, "aberto agora", horários
// num bloco na cor do negócio (o único colorido), atalhos quadrados, um bloco por serviço e
// endereço e horário lado a lado. Bricolage Grotesque nos números e títulos, DM Sans no texto.
import type { CSSProperties } from "react";
import { Bricolage_Grotesque, DM_Sans } from "next/font/google";
import { formatBRL } from "@/lib/datetime";
import type { Servico } from "../carregar";
import { claro, duracao, hhmm, Horarios, IconeZap, abasCss, montar, precoServico, resumoSemana, type PropsBio } from "../partes";

const titulo = Bricolage_Grotesque({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--bio-painel-titulo" });
const sans = DM_Sans({ subsets: ["latin"], variable: "--bio-painel-sans" });

const CSS = `.bp{background:color-mix(in srgb,var(--c) 6%,#F2F1EE);color:#17161A;font:14px/1.45 var(--bio-painel-sans),sans-serif;min-height:100dvh;padding-bottom:104px;-webkit-font-smoothing:antialiased}
.bp .col{max-width:520px;margin:0 auto}
.bp .grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:10px}
.bp .t{background:#fff;border-radius:22px;padding:14px;min-width:0;transition:transform .15s}.bp a.t:active{transform:scale(.97)}
.bp .w{grid-column:span 2}
.bp .foto{position:relative;isolation:isolate;padding:0;overflow:hidden;aspect-ratio:16/12;display:flex;align-items:flex-end;background:var(--c);color:var(--on)}
.bp .foto img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 25%;z-index:-1}
.bp .foto div{width:100%;padding:14px}.bp .foto.com div{background:linear-gradient(to top,rgba(0,0,0,.6),transparent);color:#fff}
.bp h1{font:700 26px/1.05 var(--bio-painel-titulo),sans-serif;letter-spacing:-.03em;margin:0;text-wrap:balance}
.bp .lb{font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#77737d}
.bp .num{font:800 46px/1 var(--bio-painel-titulo),sans-serif;letter-spacing:-.04em;margin-top:6px}
.bp .mu{color:#77737d}.bp .star{color:#E8A33D}
.bp .ok{display:flex;align-items:center;gap:6px;font:700 20px var(--bio-painel-titulo),sans-serif;margin-top:8px}.bp .ok i{width:9px;height:9px;border-radius:50%;background:#2DA463}.bp .ok i.f{background:#b3aeb8}
.bp .hor{background:var(--c);color:var(--on)}.bp .hor .lb{color:inherit;opacity:.8}
.bp-d{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
.bp-d-dia{display:inline-flex;align-items:center;min-height:36px;padding:0 12px;border-radius:999px;font-weight:600;font-size:13px;background:color-mix(in srgb,var(--on) 16%,transparent);cursor:pointer}
.bp-d-hs{display:none;width:100%;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:4px}
.bp-d-h{display:flex;align-items:center;justify-content:center;min-height:44px;border-radius:12px;font-weight:700;background:color-mix(in srgb,var(--on) 14%,transparent);font-variant-numeric:tabular-nums}
.bp-d-h1{background:var(--on);color:var(--c)}
${abasCss(".bp-d", "background:var(--on);color:var(--c)", "var(--on)")}
.bp .at{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:8px}
.bp .at a{background:#fff;border-radius:18px;aspect-ratio:1;max-height:120px;width:100%;display:grid;place-items:center;align-content:center;gap:4px;font-size:11px;font-weight:600;text-align:center}
.bp .sv{display:flex;flex-direction:column;justify-content:space-between;gap:10px}.bp .sv b{display:block;font:700 15px/1.2 var(--bio-painel-titulo),sans-serif}.bp .sv small{color:#77737d}
.bp .pr{font:800 20px var(--bio-painel-titulo),sans-serif}.bp .pr.s{font:500 12px var(--bio-painel-sans),sans-serif;color:#77737d}
.bp details{grid-column:span 2}.bp details>div{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.bp .mais{display:flex;align-items:center;justify-content:center;min-height:48px;background:#fff;border-radius:22px;font-weight:600;cursor:pointer;list-style:none}
.bp .mais::-webkit-details-marker{display:none}.bp details[open]>.mais{display:none}
.bp .ir{display:block;color:var(--a);font-weight:700;margin-top:6px}
.bp .site{display:flex;justify-content:center;align-items:center;min-height:44px;font-weight:600}
.bp .feito{text-align:center;font-size:12px;color:#77737d;margin:0}.bp .feito a{display:inline-flex;min-height:44px;align-items:center;padding:0 4px;text-decoration:underline}
.bp .bar{position:fixed;left:0;right:0;bottom:0;max-width:520px;margin:0 auto;padding:12px 14px max(14px,env(safe-area-inset-bottom));display:flex;gap:8px;z-index:9}
.bp .bar .ag{flex:1;display:flex;justify-content:space-between;align-items:center;gap:8px;padding:0 18px;height:52px;font-weight:700;background:#17161A;color:#fff;border-radius:18px;box-shadow:0 8px 24px rgba(0,0,0,.16)}
.bp .bar .ag small{font-weight:500;opacity:.85;font-size:12px}
.bp .bar .wa{width:52px;height:52px;background:#1F9D55;color:#fff;display:grid;place-items:center;flex:none;border-radius:18px;box-shadow:0 8px 24px rgba(0,0,0,.16)}`;

export default function Painel(props: PropsBio) {
  const { bio, livres } = props;
  const { local, agendar, agenda, mapa, zap, aberto, ate, fotoSrc, acento, precos, atalhos, linkServico, barra } = montar(props);
  const estilo = { "--a": acento, "--c": bio.cor, "--on": claro(bio.cor) ? "#17161A" : "#fff", "--n": atalhos.length } as CSSProperties;
  const meta = [bio.categoria, local].filter(Boolean).join(" · ");
  const foto = bio.fotos[0] ?? fotoSrc;
  const temHorario = bio.expediente.length > 0;
  const VISIVEIS = 4;
  const bloco = (sv: Servico) => (
    <a key={sv.id} href={linkServico(sv)} className="t sv">
      <span>
        <b>{sv.nome}</b>
        <small>{duracao(sv.duracao)}</small>
      </span>
      {precoServico(sv) ? <span className="pr">{precoServico(sv)}</span> : <span className="pr s">na avaliação</span>}
    </a>
  );
  const aPartir = precos.length > 0 ? `a partir de ${formatBRL(Math.min(...precos))}` : null;
  return (
    <div className={`${titulo.variable} ${sans.variable} bp`} style={estilo}>
      <style>{CSS}</style>
      <main className="col">
        <div className="grid">
          <header className={`t w foto${foto ? " com" : ""}`}>
            {foto && (
              // eslint-disable-next-line @next/next/no-img-element -- foto do site do cliente, fora do otimizador
              <img src={foto} alt="" width={500} height={375} fetchPriority="high" decoding="async" />
            )}
            <div>
              <h1>{bio.nome}</h1>
              {meta && <p style={{ fontSize: 13, opacity: 0.85, margin: 0 }}>{meta}</p>}
            </div>
          </header>

          {bio.nota && (
            <div className={temHorario ? "t" : "t w"}>
              <div className="lb">Google</div>
              <div className="num">{bio.nota.toFixed(1).replace(".", ",")}</div>
              <div className="mu">
                <span className="star" aria-hidden="true">★★★★★</span>
                {bio.avaliacoes ? ` ${bio.avaliacoes.toLocaleString("pt-BR")} avaliações` : ""}
              </div>
            </div>
          )}
          {temHorario && (
            <div className={bio.nota ? "t" : "t w"}>
              <div className="lb">Agora</div>
              <div className="ok">
                <i className={aberto ? undefined : "f"} />
                {aberto ? "Aberto" : "Fechado"}
              </div>
              <div className="mu" style={{ marginTop: 4 }}>{[aberto && ate ? `até ${hhmm(ate)} hoje` : null, aPartir].filter(Boolean).join(" · ")}</div>
            </div>
          )}

          {livres && (
            <section aria-label="Próximos horários" className="t w hor">
              <div className="lb">
                Próximos horários · {livres.servico.nome} · {duracao(livres.servico.duracao)}
              </div>
              <Horarios livres={livres} agendar={agendar} escopo="bp-d" />
            </section>
          )}

          {atalhos.length > 0 && (
            <nav aria-label="Contato" className="w at">
              {atalhos.map((a) => (
                <a key={a.rotulo} href={a.href} {...(a.externo !== false && { target: "_blank", rel: "noreferrer" })}>
                  <span style={{ color: a.tinta }}>{a.icone}</span>
                  {a.rotulo}
                </a>
              ))}
            </nav>
          )}

          {bio.servicos.slice(0, VISIVEIS).map(bloco)}
          {bio.servicos.length > VISIVEIS && (
            <details>
              <summary className="mais">Ver os {bio.servicos.length} serviços</summary>
              <div>{bio.servicos.slice(VISIVEIS).map(bloco)}</div>
            </details>
          )}

          {bio.endereco && mapa && (
            <a href={mapa} target="_blank" rel="noreferrer" className={temHorario ? "t" : "t w"}>
              <div className="lb">Endereço</div>
              <div style={{ marginTop: 6, fontWeight: 600 }}>{bio.endereco}</div>
              <span className="ir">Como chegar →</span>
            </a>
          )}
          {temHorario && (
            <div className={bio.endereco ? "t" : "t w"}>
              <div className="lb">Horário</div>
              <div style={{ marginTop: 6 }}>{resumoSemana(bio.expediente)}</div>
            </div>
          )}

          <a className="w site" href={bio.site}>
            Ver o site completo →
          </a>
          <p className="w feito">
            {bio.nome} · feito com <a href="https://www.ruphus.site/">Ruphus</a>
          </p>
        </div>
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
