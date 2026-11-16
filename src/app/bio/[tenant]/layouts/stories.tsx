// Bio "Stories": abre como um story do Instagram. As três fotos do site passam sozinhas (4 s cada,
// só CSS) com as barrinhas de progresso no topo, avatar com anel na cor do negócio e dois adesivos
// (nota e próximo horário com Agendar). Atalhos como os destaques do perfil. Plus Jakarta Sans.
// Precisa de 3 fotos: com menos, o seletor (layouts/index.tsx) usa a Clara. Sem animação (quem
// desativou), fica a primeira foto parada.
import type { CSSProperties, ReactNode } from "react";
import { Plus_Jakarta_Sans } from "next/font/google";
import { formatBRL } from "@/lib/datetime";
import { claro, duracao, hhmm, Horarios, IconeZap, ListaServicos, abasCss, montar, precoServico, resumoSemana, type PropsBio } from "../partes";

const sans = Plus_Jakarta_Sans({ subsets: ["latin"], preload: false, weight: ["400", "500", "600", "700", "800"], variable: "--bio-stories-sans" });

const CSS = `.bs{background:#fff;color:#141316;font:15px/1.5 var(--bio-stories-sans),sans-serif;min-height:100dvh;padding-bottom:104px;-webkit-font-smoothing:antialiased;--anel:conic-gradient(from 200deg,var(--c),color-mix(in srgb,var(--c) 35%,#FFD27A),var(--c))}
.bs .col{max-width:520px;margin:0 auto}
.bs .st{position:relative;height:480px;overflow:hidden;background:#111;border-radius:0 0 26px 26px}
.bs .fr{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;object-position:50% 25%;opacity:0;animation:bs-sw 12s infinite}
.bs .fr:nth-of-type(1){opacity:1}.bs .fr:nth-of-type(2){animation-delay:4s}.bs .fr:nth-of-type(3){animation-delay:8s}
@keyframes bs-sw{0%,30%{opacity:1}33.4%,100%{opacity:0}}
.bs .sh{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(0,0,0,.45),transparent 22%,transparent 55%,rgba(0,0,0,.55))}
.bs .pb{position:absolute;top:10px;left:10px;right:10px;display:flex;gap:4px}.bs .pb span{flex:1;height:3px;border-radius:2px;background:rgba(255,255,255,.35);overflow:hidden}
.bs .pb i{display:block;height:100%;width:0;background:#fff}
.bs .pb span:nth-child(1) i{animation:bs-p0 12s linear infinite}.bs .pb span:nth-child(2) i{animation:bs-p1 12s linear infinite}.bs .pb span:nth-child(3) i{animation:bs-p2 12s linear infinite}
@keyframes bs-p0{0%{width:0}33.3%,100%{width:100%}}@keyframes bs-p1{0%,33.3%{width:0}66.6%,100%{width:100%}}@keyframes bs-p2{0%,66.6%{width:0}100%{width:100%}}
@media (prefers-reduced-motion:reduce){.bs .fr,.bs .pb i{animation:none}.bs .pb span:first-child i{width:100%}}
.bs .who{position:absolute;top:24px;left:12px;right:12px;display:flex;gap:10px;align-items:center;color:#fff}
.bs .av{width:42px;height:42px;border-radius:50%;padding:2.5px;background:var(--anel);flex:none}.bs .av img{display:block;width:100%;height:100%;border-radius:50%;border:2px solid #111;object-fit:cover;object-position:50% 25%}
.bs .who b{font-weight:700;font-size:14px;display:block;line-height:1.2}.bs .who small{font-size:12px;opacity:.85}
.bs .stk{position:absolute;left:14px;right:14px;bottom:16px;display:grid;gap:8px;justify-items:start}
.bs .s1{background:#fff;color:#141316;border-radius:16px;padding:10px 12px;transform:rotate(-2deg);box-shadow:0 8px 24px rgba(0,0,0,.25);display:flex;gap:12px;align-items:center}
.bs .s1 small{display:block;font-size:11px;font-weight:600;color:#6d6870;text-transform:uppercase;letter-spacing:.06em}.bs .s1 b{font-size:18px}
.bs .s1 .ag{display:inline-flex;align-items:center;min-height:40px;background:var(--c);color:var(--on);border-radius:999px;padding:0 14px;font-weight:700;font-size:13px}
.bs .s2{background:rgba(255,255,255,.92);color:#141316;border-radius:999px;padding:6px 12px;font-size:13px;font-weight:700;transform:rotate(1.5deg);margin:0}
.bs h1{font-weight:800;font-size:26px;letter-spacing:-.03em;line-height:1.1;margin:16px 16px 2px;text-wrap:balance}.bs .meta{margin:0 16px;color:#6d6870;font-size:13px}
.bs .hl{display:flex;gap:14px;overflow-x:auto;padding:16px;scrollbar-width:none}.bs .hl::-webkit-scrollbar{display:none}
.bs .hl a{flex:none;display:grid;justify-items:center;gap:6px;font-size:11.5px;font-weight:600;width:64px;text-align:center}
.bs .hl i{width:62px;height:62px;border-radius:50%;padding:2.5px;background:var(--anel);font-style:normal}.bs .hl i span{width:100%;height:100%;border-radius:50%;border:3px solid #fff;background:color-mix(in srgb,var(--c) 10%,#fff);display:grid;place-items:center;color:var(--a)}
.bs h2{font-weight:800;font-size:17px;margin:22px 16px 6px}
.bs-d{display:flex;flex-wrap:wrap;gap:6px;margin:0 16px}
.bs-d-dia{display:inline-flex;align-items:center;min-height:36px;padding:0 13px;border-radius:999px;font-size:13px;font-weight:700;background:#F2F0F3;cursor:pointer}
.bs-d-hs{display:none;width:100%;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:4px}
.bs-d-h{display:flex;align-items:center;justify-content:center;min-height:44px;border-radius:14px;font-weight:700;font-size:14px;background:#F2F0F3;font-variant-numeric:tabular-nums}
.bs-d-h1{background:var(--c);color:var(--on)}
${abasCss(".bs-d", "background:#141316;color:#fff", "#141316")}
.bs .sv{margin:0 16px}.bs .row{display:flex;justify-content:space-between;align-items:center;gap:10px;min-height:52px;padding:10px 0;border-bottom:1px solid #EEECEF;font-size:14px}
.bs .row small{display:block;color:#6d6870;font-size:12px}.bs .row b{white-space:nowrap}.bs .row b.s{font-weight:500;color:#6d6870;font-size:12px}
.bs .mais{display:flex;align-items:center;justify-content:center;min-height:44px;border-bottom:1px solid #EEECEF;font-size:13px;font-weight:700;color:#6d6870;cursor:pointer;list-style:none}
.bs .mais::-webkit-details-marker{display:none}.bs details[open]>.mais{display:none}
.bs .loc{margin:0 16px;color:#46424a;font-size:14px;display:grid;gap:2px}.bs .loc a{text-decoration:underline;text-underline-offset:2px}
.bs .site{display:flex;justify-content:center;align-items:center;min-height:44px;margin-top:14px;font-weight:700;color:var(--a)}
.bs .feito{text-align:center;font-size:12px;color:#6d6870;margin:0}.bs .feito a{display:inline-flex;min-height:44px;align-items:center;padding:0 4px;text-decoration:underline}
.bs .bar{position:fixed;left:0;right:0;bottom:0;max-width:520px;margin:0 auto;padding:12px 14px max(14px,env(safe-area-inset-bottom));display:flex;gap:8px;z-index:9}
.bs .bar .ag{flex:1;display:flex;justify-content:space-between;align-items:center;gap:8px;padding:0 20px;height:52px;font-weight:700;background:#141316;color:#fff;border-radius:999px;box-shadow:0 8px 24px rgba(0,0,0,.16)}
.bs .bar .ag small{font-weight:500;opacity:.85;font-size:12px}
.bs .bar .wa{width:52px;height:52px;background:#1F9D55;color:#fff;display:grid;place-items:center;flex:none;border-radius:50%;box-shadow:0 8px 24px rgba(0,0,0,.16)}`;

const IconeRelogio = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);
const IconeLista = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M4 6h16M4 12h16M4 18h10" />
  </svg>
);
const IconeFoto = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="3" y="5" width="18" height="14" rx="3" />
    <circle cx="9" cy="11" r="2" />
    <path d="m21 17-5-5-8 7" />
  </svg>
);

export default function Stories(props: PropsBio) {
  const { bio, livres } = props;
  const { local, agendar, agenda, mapa, zap, aberto, ate, fotoSrc, acento, precos, atalhos, linkServico, primeiro, barra } = montar(props);
  const estilo = { "--a": acento, "--c": bio.cor, "--on": claro(bio.cor) ? "#141316" : "#fff" } as CSSProperties;
  const fotos = bio.fotos.slice(0, 3);
  const situacao = bio.expediente.length > 0 ? (aberto && ate ? `Aberto até ${hhmm(ate)}` : "Fechado agora") : null;
  const meta = [bio.categoria, local, precos.length > 0 && `a partir de ${formatBRL(Math.min(...precos))}`].filter(Boolean).join(" · ");
  // os destaques do perfil: âncoras da própria bio, as fotos no site e os atalhos de contato
  const destaques: { href: string; rotulo: string; icone: ReactNode; externo?: boolean }[] = [
    ...(livres ? [{ href: "#bs-horarios", rotulo: "Horários", icone: <IconeRelogio />, externo: false }] : []),
    ...(bio.servicos.length > 0 ? [{ href: "#bs-servicos", rotulo: "Serviços", icone: <IconeLista />, externo: false }] : []),
    { href: bio.site, rotulo: "Fotos", icone: <IconeFoto />, externo: false },
    ...atalhos.map((a) => (a.href === mapa ? { ...a, rotulo: "Endereço" } : a)),
  ];
  return (
    <div className={`${sans.variable} bs`} style={estilo}>
      <style>{CSS}</style>
      <main className="col">
        <div className="st">
          {fotos.map((f, i) => (
            // eslint-disable-next-line @next/next/no-img-element -- fotos do site do cliente, fora do otimizador
            <img key={f} className="fr" src={f} alt="" width={520} height={480} {...(i === 0 ? { fetchPriority: "high" as const } : {})} decoding="async" />
          ))}
          <div className="sh" />
          <div className="pb" aria-hidden="true">
            {fotos.map((f) => (
              <span key={f}>
                <i />
              </span>
            ))}
          </div>
          <div className="who">
            <span className="av">
              {/* eslint-disable-next-line @next/next/no-img-element -- foto do site do cliente */}
              <img src={fotoSrc || fotos[0]} alt="" width={37} height={37} decoding="async" />
            </span>
            <span>
              <b>{bio.nome}</b>
              {(situacao || local) && <small>{[situacao, local].filter(Boolean).join(" · ")}</small>}
            </span>
          </div>
          {(bio.nota || (agenda && primeiro)) && (
            <div className="stk">
              {bio.nota && (
                <p className="s2">
                  ★ {bio.nota.toFixed(1).replace(".", ",")}
                  {bio.avaliacoes ? ` · ${bio.avaliacoes.toLocaleString("pt-BR")} avaliações no Google` : " no Google"}
                </p>
              )}
              {agenda && primeiro && livres && (
                <div className="s1">
                  <span>
                    <small>Próximo horário</small>
                    <b>
                      {primeiro.rotulo} {hhmm(primeiro.horarios[0])}
                    </b>
                  </span>
                  <a className="ag" href={`${agendar}?servico=${encodeURIComponent(livres.servico.id)}&data=${primeiro.date}&hora=${primeiro.horarios[0]}`}>
                    Agendar
                  </a>
                </div>
              )}
            </div>
          )}
        </div>

        <h1>{bio.nome}</h1>
        {meta && <p className="meta">{meta}</p>}

        <nav aria-label="Destaques" className="hl">
          {destaques.map((d) => (
            <a key={d.rotulo} href={d.href} {...(d.externo !== false && { target: "_blank", rel: "noreferrer" })}>
              <i>
                <span>{d.icone}</span>
              </i>
              {d.rotulo}
            </a>
          ))}
        </nav>

        {livres && (
          <section aria-labelledby="bs-horarios">
            <h2 id="bs-horarios">Próximos horários</h2>
            <Horarios livres={livres} agendar={agendar} escopo="bs-d" />
          </section>
        )}

        {bio.servicos.length > 0 && (
          <section aria-labelledby="bs-servicos">
            <h2 id="bs-servicos">Serviços</h2>
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
          <section aria-labelledby="bs-onde">
            <h2 id="bs-onde">Onde e quando</h2>
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
