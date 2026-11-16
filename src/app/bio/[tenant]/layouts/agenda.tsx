// Bio "Agenda": cara de app de horário marcado. Tira da semana com os dias livres, horários em
// mono, serviços com a duração à frente, gráfico do horário da semana e um bilhete fixo de
// "Próximo: hoje 14:30 · Agendar". IBM Plex Sans e IBM Plex Mono.
import type { CSSProperties } from "react";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { addDays, formatDuration, todayIn, weekday, WEEKDAYS } from "@/lib/datetime";
import { Horarios, ListaServicos, abasCss, hhmm, montar, precoServico, resumoSemana, type PropsBio } from "../partes";

const sans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--bio-agenda-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--bio-agenda-mono" });

const CURTO = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const INICIAL = ["D", "S", "T", "Q", "Q", "S", "S"];
const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));

const CSS = `.ba{background:#fff;color:#15181C;font:14px/1.45 var(--bio-agenda-sans),sans-serif;min-height:100dvh;padding-bottom:104px;-webkit-font-smoothing:antialiased}
.ba .col{max-width:520px;margin:0 auto}.ba .mono{font-family:var(--bio-agenda-mono),monospace}
.ba .hd{display:flex;gap:12px;align-items:center;padding:16px}
.ba .hd img,.ba .hd .ini{width:58px;height:58px;border-radius:50%;object-fit:cover;object-position:50% 25%;flex:none}
.ba .hd .ini{display:grid;place-items:center;background:var(--a);color:#fff;font-size:26px;font-weight:700}
.ba h1{font-size:19px;font-weight:700;line-height:1.15;margin:0}.ba .hd small{color:#626a73;font-size:13px;display:block;margin-top:2px}.ba .verde{color:#1E8A4C}
.ba .lk{display:flex;gap:16px;padding:0 16px;border-bottom:1px solid #E7EAEE;font-weight:600;color:var(--a);font-size:13px;overflow-x:auto;white-space:nowrap;scrollbar-width:none}
.ba .lk a{display:inline-flex;align-items:center;min-height:44px}
.ba .wk{padding:16px 16px 6px}.ba .wk .m{display:flex;justify-content:space-between;gap:8px;font-weight:600;margin-bottom:10px}.ba .wk .m span{color:#626a73;font-weight:400;text-align:right}
.ba-d{display:grid;grid-template-columns:repeat(var(--n),1fr);gap:4px}
.ba-d-dia,.ba-d .off{text-align:center;padding:8px 0;border-radius:12px;font-size:11px;color:#626a73;cursor:pointer;min-height:44px}
.ba-d-dia b,.ba-d .off b{display:block;font:600 17px var(--bio-agenda-mono),monospace;color:var(--t,#15181C);margin-top:2px}.ba-d .off{opacity:.4;cursor:default}
.ba-d-hs{display:none;grid-column:1/-1;grid-row:2;grid-template-columns:repeat(3,1fr);gap:7px;padding-top:10px}
.ba-d-h{display:flex;align-items:center;justify-content:center;min-height:44px;border:1px solid #DCE1E6;border-radius:10px;font:500 15px var(--bio-agenda-mono),monospace}
.ba-d-h1{border:2px solid var(--a);color:var(--a);font-weight:600}
${abasCss(".ba-d", "background:var(--a);color:#fff;--t:#fff", "var(--a)")}
.ba h2{font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:#626a73;margin:22px 16px 6px;font-weight:600}
.ba .row{display:grid;grid-template-columns:62px 1fr auto;gap:10px;align-items:center;min-height:48px;padding:8px 16px;border-bottom:1px solid #EEF0F3}
.ba .row .du{font:600 13px var(--bio-agenda-mono),monospace;color:var(--a)}.ba .row b{font-weight:600}.ba .row .p{font:500 14px var(--bio-agenda-mono),monospace;white-space:nowrap}.ba .row .p.s{font:400 12px var(--bio-agenda-sans),sans-serif;color:#626a73}
.ba .mais{display:flex;align-items:center;justify-content:center;min-height:44px;border-bottom:1px solid #EEF0F3;font-size:13px;font-weight:600;color:#626a73;cursor:pointer;list-style:none}
.ba .mais::-webkit-details-marker{display:none}.ba details[open]>.mais{display:none}
.ba .ch{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;align-items:end;height:90px;padding:0 16px}.ba .ch div{display:grid;gap:4px;justify-items:center;font-size:11px;color:#626a73;height:100%;align-content:end}
.ba .ch i{width:100%;border-radius:6px 6px 2px 2px;background:color-mix(in srgb,var(--a) 30%,#fff)}.ba .ch .hj i{background:var(--a)}.ba .ch .hj{color:#15181C;font-weight:600}
.ba .ad{padding:12px 16px 0;color:#3c434b}.ba .ad a{color:var(--a);font-weight:600}
.ba .site{display:flex;align-items:center;min-height:44px;padding:4px 16px;font-weight:600;color:var(--a)}
.ba .feito{padding:0 16px;font-size:12px;color:#626a73}.ba .feito a{display:inline-flex;min-height:44px;align-items:center;padding:0 4px;text-decoration:underline}
.ba .tk{position:fixed;left:12px;right:12px;bottom:max(12px,env(safe-area-inset-bottom));max-width:496px;margin:0 auto;background:#15181C;color:#fff;border-radius:14px;padding:12px 14px 12px 18px;display:flex;justify-content:space-between;align-items:center;gap:8px;font-weight:600;z-index:9;
-webkit-mask:radial-gradient(circle 9px at 0 50%,#0000 98%,#000) left/51% 100% no-repeat,radial-gradient(circle 9px at 100% 50%,#0000 98%,#000) right/51% 100% no-repeat;
mask:radial-gradient(circle 9px at 0 50%,#0000 98%,#000) left/51% 100% no-repeat,radial-gradient(circle 9px at 100% 50%,#0000 98%,#000) right/51% 100% no-repeat}
.ba .tk small{font:400 13px var(--bio-agenda-mono),monospace;opacity:.75}.ba .tk .bt{background:var(--a);padding:8px 14px;border-radius:999px;white-space:nowrap}`;

export default function Agenda(props: PropsBio) {
  const { bio, livres } = props;
  const { local, agendar, mapa, aberto, ate, fotoSrc, acento, hoje, atalhos, linkServico, primeiro, barra } = montar(props);
  const dataHoje = todayIn(bio.fuso);
  // a tira da semana a partir de hoje; os dias com horário livre viram abas, os outros ficam apagados
  const indice = (date: string) => Math.round((Date.parse(`${date}T12:00:00Z`) - Date.parse(`${dataHoje}T12:00:00Z`)) / 864e5);
  const ultimo = livres ? indice(livres.dias.at(-1)!.date) : 0;
  const tira = Array.from({ length: Math.max(7, ultimo + 1) }, (_, i) => addDays(dataHoje, i));
  const livresNa = new Set(livres?.dias.map((d) => d.date));
  const mes = new Intl.DateTimeFormat("pt-BR", { month: "long", timeZone: "UTC" }).format(new Date(`${dataHoje}T12:00:00Z`));
  const rotuloDia = (date: string, i: number) => (
    <>
      {i === 0 ? "Hoje" : CURTO[weekday(date)]}
      <b>{date.slice(8, 10)}</b>
    </>
  );
  // gráfico do horário: segunda a domingo, a barra é a quantidade de horas aberto
  const semana = [1, 2, 3, 4, 5, 6, 0].map((dia) => {
    const e = bio.expediente.find((x) => x.dia === dia);
    return { dia, horas: e ? (minutos(e.fim) - minutos(e.inicio)) / 60 : 0 };
  });
  const situacao = bio.expediente.length > 0 ? (aberto && ate ? <><b className="verde">aberto</b> até {hhmm(ate)}</> : "fechado agora") : null;
  const linha = [
    bio.nota && `★ ${bio.nota.toFixed(1).replace(".", ",")}${bio.avaliacoes ? ` (${bio.avaliacoes.toLocaleString("pt-BR")})` : ""}`,
    situacao,
    local || null,
  ].filter(Boolean);

  return (
    <div className={`${sans.variable} ${mono.variable} ba`} style={{ "--a": acento } as CSSProperties}>
      <style>{CSS}</style>
      <main className="col">
        <header className="hd">
          {fotoSrc ? (
            // eslint-disable-next-line @next/next/no-img-element -- foto do site do cliente, fora do otimizador
            <img src={fotoSrc} alt="" width={58} height={58} fetchPriority="high" decoding="async" />
          ) : (
            <span className="ini" aria-hidden="true">{bio.nome.slice(0, 1).toUpperCase()}</span>
          )}
          <div>
            <h1>{bio.nome}</h1>
            {linha.length > 0 && (
              <small>
                {linha.map((p, i) => (
                  <span key={i}>
                    {i > 0 && " · "}
                    {p}
                  </span>
                ))}
              </small>
            )}
          </div>
        </header>

        {atalhos.length > 0 && (
          <nav aria-label="Contato" className="lk">
            {atalhos.map((a) => (
              <a key={a.rotulo} href={a.href} {...(a.externo !== false && { target: "_blank", rel: "noreferrer" })}>
                {a.rotulo}
              </a>
            ))}
          </nav>
        )}

        {livres && (
          <section aria-label="Próximos horários" className="wk">
            <div className="m">
              {mes[0].toUpperCase() + mes.slice(1)}
              <span>
                {livres.servico.nome} · {formatDuration(livres.servico.duracao)}
              </span>
            </div>
            <div style={{ "--n": tira.length } as CSSProperties}>
              <Horarios
                livres={livres}
                agendar={agendar}
                escopo="ba-d"
                hora={(h) => h}
                maximo={6}
                rotulo={(d) => rotuloDia(d.date, indice(d.date))}
                coluna={(k) => indice(livres.dias[k].date) + 1}
              >
                {tira.map((date, i) =>
                  livresNa.has(date) ? null : (
                    <span key={date} className="off" style={{ gridColumn: i + 1, gridRow: 1 }} aria-hidden="true">
                      {rotuloDia(date, i)}
                    </span>
                  ),
                )}
              </Horarios>
            </div>
          </section>
        )}

        {bio.servicos.length > 0 && (
          <section aria-labelledby="ba-servicos">
            <h2 id="ba-servicos">Serviços</h2>
            <ListaServicos
              servicos={bio.servicos}
              mais="mais"
              item={(sv) => (
                <a key={sv.id} href={linkServico(sv)} className="row">
                  <span className="du">{formatDuration(sv.duracao)}</span>
                  <b>{sv.nome}</b>
                  {precoServico(sv) ? <span className="p">{precoServico(sv)}</span> : <span className="p s">na avaliação</span>}
                </a>
              )}
            />
          </section>
        )}

        {bio.expediente.length > 0 && (
          <section aria-labelledby="ba-semana">
            <h2 id="ba-semana">Horário da semana</h2>
            <div className="ch" role="img" aria-label={resumoSemana(bio.expediente)}>
              {semana.map((s) => (
                <div key={s.dia} className={s.dia === hoje ? "hj" : undefined} title={WEEKDAYS[s.dia]}>
                  <i style={{ height: Math.min(72, Math.round(s.horas * 6)) }} />
                  {INICIAL[s.dia]}
                </div>
              ))}
            </div>
          </section>
        )}

        {bio.endereco && mapa && (
          <p className="ad">
            {bio.endereco} ·{" "}
            <a href={mapa} target="_blank" rel="noreferrer">
              Como chegar
            </a>
          </p>
        )}
        <a className="site" href={bio.site}>
          Ver o site completo →
        </a>
        <p className="feito">
          {bio.nome} · feito com <a href="https://www.ruphus.site/">Ruphus</a>
        </p>
      </main>

      {barra && (
        <a className="tk" href={barra.href}>
          <span>
            {primeiro && barra.livre ? (
              <>
                Próximo: <small>{primeiro.rotulo.toLowerCase()} {primeiro.horarios[0]}</small>
              </>
            ) : (
              bio.nome
            )}
          </span>
          <span className="bt">{barra.rotulo}</span>
        </a>
      )}
    </div>
  );
}
