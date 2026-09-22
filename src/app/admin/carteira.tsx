"use client";

import { useEffect, useState } from "react";
import type { ClienteSaude } from "@/lib/saude.server";
import { carteira } from "./actions";
import type { Espaco } from "./actions";
import { SeloSaude } from "./crm-gaveta";

// A carteira: os negócios fechados, do mais em risco ao mais saudável. É a
// lista de quem ligar depois da venda, antes que o cliente pare de usar.

const COBRANCA = {
  sem: { rotulo: "sem cobrança aberta", cor: "bg-[#F3EFE7] text-[#4A4639]" },
  em_dia: { rotulo: "em dia", cor: "bg-[#F3EFE7] text-[#4A4639]" },
  vence: { rotulo: "vence logo", cor: "bg-[#FBF3DC] text-[#7A5A2E]" },
  atrasada: { rotulo: "atrasada", cor: "bg-[#F1E7E7] text-[#8A2F2F]" },
} as const;

const haQuanto = (iso: string | null) => {
  if (!iso) return "nunca";
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return d <= 0 ? "hoje" : d === 1 ? "ontem" : `há ${d} dias`;
};

export function Carteira({ idToken, hoje, espacos, abrir }: { idToken: string; hoje: string; espacos: Espaco[]; abrir: (e: Espaco) => void }) {
  const [lista, setLista] = useState<ClienteSaude[] | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!idToken) return;
    let atual = true;
    carteira(idToken, hoje).then(
      (r) => atual && (r.ok ? setLista(r.dados) : setErro(r.error)),
      () => atual && setErro("Não foi possível carregar a carteira."),
    );
    return () => {
      atual = false;
    };
  }, [idToken, hoje]);

  const porSlug = new Map(espacos.map((e) => [e.slug, e]));
  const implantados = lista?.filter((c) => Object.values(c.passos).every(Boolean)).length ?? 0;
  const numeros = [
    ["Clientes ativos", lista ? String(lista.length) : "…", ""],
    ["Implantados", lista ? `${implantados} de ${lista.length}` : "…", "todos os 4 passos"],
    ["Agendamentos 30 dias", lista ? String(lista.reduce((s, c) => s + c.agendamentos30, 0)) : "…", "pelos sites dos clientes"],
    ["Em risco", lista ? String(lista.filter((c) => c.saude === "risco").length) : "…", "sem agendar há 3+ semanas ou cobrança atrasada"],
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-[family-name:var(--fonte-serifa)] text-[26px] leading-none">Clientes</h2>
      <dl className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {numeros.map(([a, b, c]) => (
          <div key={a} className="flex flex-col gap-1.5 rounded-2xl border border-[#E2DDD3] bg-white px-4 py-3.5">
            <dt className="text-[11px] tracking-[0.06em] text-[#6F6A5E] uppercase">{a}</dt>
            <dd className={`font-[family-name:var(--fonte-serifa)] text-[30px] leading-none tabular-nums ${a === "Em risco" && b !== "0" && b !== "…" ? "text-[#8A2F2F]" : ""}`}>{b}</dd>
            {c && <dd className="text-[11px] text-[#6F6A5E]">{c}</dd>}
          </div>
        ))}
      </dl>

      {erro && <p role="alert" className="text-sm text-[#8A2F2F]">{erro}</p>}
      {lista && lista.length === 0 && (
        <p className="rounded-2xl border border-dashed border-[#D8D2C6] p-8 text-center text-sm text-[#6F6A5E]">Nenhum negócio fechado ainda. Quando fechar a primeira venda, o cliente aparece aqui.</p>
      )}
      {!lista && !erro && <p className="text-sm text-[#6F6A5E]">Carregando a carteira…</p>}

      {/* No celular a tabela de 860px vira cartão: ler a carteira não pode pedir
          rolagem lateral. Da largura de laptop para cima, a tabela volta. */}
      {lista && lista.length > 0 && (
        <ul className="flex flex-col gap-2.5 lg:hidden">
          {lista.map((c) => {
            const e = porSlug.get(c.slug);
            const feitos = Object.values(c.passos).filter(Boolean).length;
            return (
              <li key={c.slug} className="flex flex-col gap-2.5 rounded-2xl border border-[#E2DDD3] bg-white p-3.5">
                <div className="flex items-start gap-2.5">
                  <span className="min-w-0 grow text-[15px] font-semibold break-words">{e?.nome ?? c.slug}</span>
                  <SeloSaude saude={c.saude} />
                </div>
                <p className="text-[12.5px] text-[#6F6A5E]">{c.motivo}</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11.5px] text-[#6F6A5E]">
                  <span className="flex items-center gap-1.5" aria-label={`Implantação ${feitos} de 4 passos`}>
                    <span className="flex gap-[3px]" aria-hidden="true">
                      {[0, 1, 2, 3].map((i) => (
                        <span key={i} className={`h-1.5 w-[16px] rounded-full ${i < feitos ? "bg-[#2C6A53]" : "bg-[#E2DDD3]"}`} />
                      ))}
                    </span>
                    {feitos}/4
                  </span>
                  <span>{c.agendamentos30} agend. em 30 dias</span>
                  <span>último {haQuanto(c.ultimoAgendamento)}</span>
                  <span className={`rounded-full px-2 py-0.5 font-semibold ${COBRANCA[c.cobranca].cor}`}>
                    {c.cobranca === "vence" ? `vence em ${c.diasParaVencer} dia(s)` : c.cobranca === "atrasada" ? `atrasada ${Math.abs(c.diasParaVencer ?? 0)} dia(s)` : COBRANCA[c.cobranca].rotulo}
                  </span>
                </div>
                {e && (
                  <button type="button" onClick={() => abrir(e)} className="h-11 rounded-[10px] border border-[#D8D2C6] bg-white text-sm font-semibold hover:border-[#17150F]">
                    Abrir
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {lista && lista.length > 0 && (
        <section aria-label="Carteira" className="hidden overflow-x-auto rounded-2xl border border-[#E2DDD3] bg-white lg:block">
          <table className="w-full min-w-[860px] border-collapse text-[12.5px]">
            <thead>
              <tr className="bg-[#FBFAF8] text-[11px] tracking-[0.06em] text-[#6F6A5E] uppercase">
                <th scope="col" className="px-4 py-2.5 text-left font-medium">Cliente</th>
                <th scope="col" className="px-4 py-2.5 text-left font-medium">Implantação</th>
                <th scope="col" className="px-4 py-2.5 text-right font-medium">Agend. 30d</th>
                <th scope="col" className="px-4 py-2.5 text-left font-medium">Último</th>
                <th scope="col" className="px-4 py-2.5 text-left font-medium">Cobrança</th>
                <th scope="col" className="px-4 py-2.5 text-left font-medium">Saúde</th>
                <th scope="col" className="px-4 py-2.5"><span className="sr-only">Abrir</span></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((c) => {
                const e = porSlug.get(c.slug);
                const feitos = Object.values(c.passos).filter(Boolean).length;
                return (
                  <tr key={c.slug} className="border-t border-[#E2DDD3] align-middle">
                    <td className="px-4 py-3">
                      <span className="block font-semibold">{e?.nome ?? c.slug}</span>
                      <span className="block max-w-[260px] truncate text-[11px] text-[#6F6A5E]" title={c.motivo}>{c.motivo}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex items-center gap-2" aria-label={`${feitos} de 4 passos`}>
                        <span className="flex gap-[3px]" aria-hidden="true">
                          {[0, 1, 2, 3].map((i) => (
                            <span key={i} className={`h-1.5 w-[18px] rounded-full ${i < feitos ? "bg-[#2C6A53]" : "bg-[#E2DDD3]"}`} />
                          ))}
                        </span>
                        <span className="text-[11px] text-[#6F6A5E]">{feitos}/4</span>
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{c.agendamentos30}</td>
                    <td className="px-4 py-3 text-[#6F6A5E]">{haQuanto(c.ultimoAgendamento)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap ${COBRANCA[c.cobranca].cor}`}>
                        {c.cobranca === "vence" ? `vence em ${c.diasParaVencer} dia(s)` : c.cobranca === "atrasada" ? `atrasada ${Math.abs(c.diasParaVencer ?? 0)} dia(s)` : COBRANCA[c.cobranca].rotulo}
                      </span>
                    </td>
                    <td className="px-4 py-3"><SeloSaude saude={c.saude} /></td>
                    <td className="px-4 py-2 text-right">
                      {e && (
                        <button type="button" onClick={() => abrir(e)} className="h-10 rounded-[10px] border border-[#D8D2C6] bg-white px-3.5 text-xs font-semibold hover:border-[#17150F]">
                          Abrir
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
