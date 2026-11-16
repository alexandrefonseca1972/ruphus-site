// A bio de sempre (antes de haver layouts): capa com a foto, atalhos, horários, serviços e onde
// e quando. A marcação tem de sair idêntica à de antes da divisão (bio.test.mts compara).
import { formatBRL, WEEKDAYS } from "@/lib/datetime";
import type { Servico } from "../carregar";
import { abasCss, claro, duracao, hhmm, montar, precoServico, Seta, type PropsBio } from "../partes";

const ROTULO = "text-xs font-semibold uppercase tracking-[0.1em] text-[#6F6A5E]";
const CARTAO = "rounded-[18px] border border-[#E2DDD3] bg-white";
const ABAS = abasCss(".dias", "background:#17150F;color:#fff", "#17150F");

export default function Atual(props: PropsBio) {
  const { bio, livres } = props;
  const { local, agendar, agenda, mapa, zap, aberto, ate, dias, fotoSrc, acento, hoje, precos, jornadaHoje, contato, atalhos, linkServico, primeiro } = montar(props);
  const linhaServico = (sv: Servico, i: number) => (
    <li key={sv.id}>
      <a href={linkServico(sv)} className={`flex min-h-15 items-center gap-3 px-4 py-2.5 hover:bg-[#FAF8F4] ${i ? "border-t border-[#EFEBE3]" : ""}`}>
        <span className="min-w-0 grow">
          <span className="block text-[15px] font-semibold leading-tight">{sv.nome}</span>
          <span className="block text-[13px] leading-snug text-[#6F6A5E]">{duracao(sv.duracao)}</span>
        </span>
        {precoServico(sv) ? <span className="shrink-0 text-right text-sm font-semibold tabular-nums">{precoServico(sv)}</span> : null}
        <Seta className="shrink-0 text-[#A9A396]" />
      </a>
    </li>
  );
  const VISIVEIS = 4;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col pb-32">
      {/* Capa: a foto é a vitrine, com o nome por cima. Sem foto, a cor do negócio e a inicial. */}
      <header className="relative aspect-[4/4.4] max-h-[68svh] w-full overflow-hidden" style={{ background: bio.cor }}>
        {fotoSrc ? (
          // eslint-disable-next-line @next/next/no-img-element -- foto do site do cliente, fora do otimizador
          <img src={fotoSrc} alt="" width={520} height={572} fetchPriority="high" decoding="async" className="size-full object-cover" />
        ) : (
          <span
            aria-hidden="true"
            className="flex size-full items-center justify-center pb-24 font-[family-name:var(--fonte-serifa)] text-[180px] leading-none"
            style={{ color: claro(bio.cor) ? "rgba(23,21,15,.14)" : "rgba(255,255,255,.14)" }}
          >
            {bio.nome.slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(14,13,10,.92) 4%, rgba(14,13,10,.15) 55%, rgba(14,13,10,0) 75%)" }} />
        <div className="absolute inset-x-0 bottom-0 flex flex-col items-start gap-2 px-4 pb-4 text-white">
          {bio.expediente.length > 0 && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
              style={aberto ? { background: "rgba(231,238,233,.95)", color: "#2C6A53" } : { background: "rgba(243,237,228,.95)", color: "#7A5A2E" }}
            >
              <span aria-hidden="true" className="size-1.5 rounded-full" style={{ background: aberto ? "#2C6A53" : "#B08434" }} />
              {aberto && ate ? `Aberto agora · até ${hhmm(ate)}` : "Fechado agora"}
            </span>
          )}
          <h1 className="text-balance font-[family-name:var(--fonte-serifa)] text-[44px] font-normal leading-[0.95] tracking-[-0.01em]">{bio.nome}</h1>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-white/80">
            {local && <span>{local}</span>}
            {bio.nota && (
              <>
                {local && <span aria-hidden="true">·</span>}
                <span className="inline-flex items-center gap-1">
                  <svg viewBox="0 0 24 24" width="13" height="13" fill="#E8A33D" aria-hidden="true">
                    <path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.2 6.1L12 16.9 6.5 19.7l1.2-6.1L3.2 9.4l6.1-.8z" />
                  </svg>
                  <b className="font-semibold text-white">{bio.nota.toFixed(1).replace(".", ",")}</b>
                  {bio.avaliacoes ? <span>({bio.avaliacoes.toLocaleString("pt-BR")})</span> : null}
                </span>
              </>
            )}
            {precos.length > 0 && (
              <>
                {(local || bio.nota) && <span aria-hidden="true">·</span>}
                <span>
                  a partir de <b className="font-semibold text-white">{formatBRL(Math.min(...precos))}</b>
                </span>
              </>
            )}
          </div>
        </div>
      </header>

      {atalhos.length > 0 && (
        <nav aria-label="Contato" className="flex gap-2 overflow-x-auto px-4 pt-3.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {atalhos.map((a) => (
            <a
              key={a.rotulo}
              href={a.href}
              {...(a.externo !== false && { target: "_blank", rel: "noreferrer" })}
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-[#E2DDD3] bg-white px-3.5 text-[13px] font-semibold active:scale-[0.97]"
            >
              <span style={{ color: a.tinta }}>{a.icone}</span>
              {a.rotulo}
            </a>
          ))}
        </nav>
      )}

      <div className="flex flex-col gap-6 px-4 pt-6">
        {livres && (
          <section aria-labelledby="titulo-horarios" className="flex flex-col gap-2.5">
            <style>{ABAS}</style>
            <h2 id="titulo-horarios" className={`${ROTULO} flex items-baseline justify-between`}>
              Próximos horários
              <span className="text-[13px] font-medium normal-case tracking-normal">
                {livres.servico.nome} · {duracao(livres.servico.duracao)}
              </span>
            </h2>
            <div className="dias flex flex-wrap gap-x-1.5 gap-y-2.5">
              {livres.dias.map((d, k) => (
                <input key={d.date} type="radio" name="dia" id={`dia-${k}`} defaultChecked={k === 0} className="sr-only" />
              ))}
              {livres.dias.map((d, k) => (
                <label key={d.date} htmlFor={`dia-${k}`} className="inline-flex min-h-11 cursor-pointer items-center rounded-full px-3.5 text-[13px] font-semibold text-[#6F6A5E]">
                  {d.rotulo}
                </label>
              ))}
              {livres.dias.map((d) => (
                <div key={d.date} className="hidden w-full grid-cols-4 gap-1.5">
                  {d.horarios.map((h) => (
                    <a
                      key={h}
                      href={`${agendar}?servico=${encodeURIComponent(livres.servico.id)}&data=${d.date}&hora=${h}`}
                      className={`flex min-h-11 items-center justify-center rounded-xl border px-1 py-2 text-center text-sm font-semibold tabular-nums ${d === primeiro && h === primeiro.horarios[0] ? "border-[#17150F] bg-[#17150F] text-white" : "border-[#E2DDD3] bg-white"}`}
                    >
                      {hhmm(h)}
                    </a>
                  ))}
                </div>
              ))}
            </div>
          </section>
        )}

        {bio.servicos.length > 0 && (
          <section aria-labelledby="titulo-servicos" className="flex flex-col gap-2.5">
            <h2 id="titulo-servicos" className={`${ROTULO} flex items-baseline justify-between`}>
              Serviços
              <span className="text-[13px] font-medium normal-case tracking-normal">{bio.servicos.length}</span>
            </h2>
            <div className={`${CARTAO} overflow-hidden`}>
              <ul>{bio.servicos.slice(0, VISIVEIS).map(linhaServico)}</ul>
              {bio.servicos.length > VISIVEIS && (
                // <details> nativo: o resto da lista sem JavaScript; o "ver os N" some ao abrir
                <details className="group">
                  <summary className="flex min-h-11 cursor-pointer list-none items-center justify-center border-t border-[#EFEBE3] px-3 py-2 text-center text-[13px] font-semibold text-[#6F6A5E] group-open:hidden [&::-webkit-details-marker]:hidden">
                    Ver os {bio.servicos.length} serviços
                  </summary>
                  <ul className="border-t border-[#EFEBE3]">{bio.servicos.slice(VISIVEIS).map(linhaServico)}</ul>
                </details>
              )}
            </div>
          </section>
        )}

        {(dias.length > 0 || mapa) && (
          <section aria-labelledby="titulo-onde" className="flex flex-col gap-2.5">
            <h2 id="titulo-onde" className={ROTULO}>
              Onde e quando
            </h2>
            <div className="grid grid-cols-2 gap-2">
              {dias.length > 0 && (
                <details className={`${CARTAO} group open:col-span-2 ${mapa ? "" : "col-span-2"}`}>
                  <summary className="cursor-pointer list-none px-3.5 py-3 text-[13px] text-[#6F6A5E] [&::-webkit-details-marker]:hidden">
                    <b className="block text-sm text-[#17150F]">{jornadaHoje ? `Hoje ${hhmm(jornadaHoje.inicio)}–${hhmm(jornadaHoje.fim)}` : "Hoje fechado"}</b>
                    <span className="group-open:hidden">Ver a semana</span>
                    <span className="hidden group-open:inline">Horário da semana</span>
                  </summary>
                  <div className="border-t border-[#EFEBE3] px-3.5 py-2">
                    {dias.map((d) => (
                      <div key={d.dia} className={`flex justify-between py-1.5 text-sm ${d.dia === hoje ? "font-semibold" : ""}`}>
                        <span>
                          {WEEKDAYS[d.dia]}
                          {d.dia === hoje && <span className="font-normal text-[#6F6A5E]"> · hoje</span>}
                        </span>
                        <span className="tabular-nums">
                          {hhmm(d.inicio)} — {hhmm(d.fim)}
                        </span>
                      </div>
                    ))}
                    {!bio.expediente.some((e) => e.dia === 0) && (
                      <div className="flex justify-between py-1.5 text-sm text-[#8B8578]">
                        <span>Domingo</span>
                        <span>fechado</span>
                      </div>
                    )}
                  </div>
                </details>
              )}
              {/* a cidade já está na capa: o cartão só aparece com endereço, que abre no mapa */}
              {mapa && (
                <a href={mapa} target="_blank" rel="noreferrer" className={`${CARTAO} flex min-h-11 min-w-0 flex-col justify-center self-start px-3.5 py-3 text-[13px] text-[#6F6A5E] ${dias.length ? "" : "col-span-2"}`}>
                  <b className="block break-words text-sm text-[#17150F]">{bio.endereco}</b>
                  Abrir no mapa
                </a>
              )}
            </div>
          </section>
        )}

        <footer className="flex flex-col items-center gap-2.5 pt-2 text-center text-xs text-[#8B8578]">
          <a href={bio.site} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-[#17150F]">
            Ver o site completo
            <Seta className="text-[#A9A396]" />
          </a>
          <p>
            {bio.nome} · feito com{" "}
            <a href="https://www.ruphus.site/" className="inline-flex min-h-11 items-center px-1 underline underline-offset-2">
              Ruphus
            </a>
          </p>
        </footer>
      </div>

      {/* Sem agenda, a barra usa o canal de contato disponível, inclusive ligação para número fixo. */}
      {(agenda ? agendar : contato) && (
        <div className="fixed inset-x-0 bottom-0 border-t border-[#E7E2D8] bg-[#F7F5F1]/95 backdrop-blur">
          <div className="mx-auto w-full max-w-[520px] px-4 pt-2.5 pb-[max(1rem,env(safe-area-inset-bottom))]">
            <a
              href={agenda ? agendar : contato!}
              className="flex min-h-[54px] items-center justify-between gap-3 rounded-2xl px-5 py-2.5"
              style={{ background: acento, color: "#FFFFFF" }}
            >
              <span className="text-[15px] font-bold">{agenda ? "Agendar online" : zap ? "Falar no WhatsApp" : "Ligar para o negócio"}</span>
              {agenda && primeiro && (
                <span className="text-xs opacity-85">
                  livre {primeiro.rotulo.toLowerCase()} {hhmm(primeiro.horarios[0])}
                </span>
              )}
            </a>
          </div>
        </div>
      )}
    </main>
  );
}
