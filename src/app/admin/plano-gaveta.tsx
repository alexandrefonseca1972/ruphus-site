"use client";

import { useEffect, useState } from "react";
import { confirmar } from "@/components/confirmar";
import { definirModulosAction, modulosDoNegocioAction } from "./actions";

type Modulos = { caixa: boolean; agendamento: boolean };

/** O que o plano do negócio inclui. Tudo vem ligado; o suporte desliga o Caixa ou o agendamento
 *  (cliente que quer só o site). Os dados ficam guardados e voltam ao religar. */
export function PlanoDoNegocio({ slug, token }: { slug: string; token: () => Promise<string> }) {
  const [m, setM] = useState<Modulos | null>(null);
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let atual = true;
    token()
      .then((t) => modulosDoNegocioAction(t, slug))
      .then((r) => atual && (r.ok ? setM(r.dados) : setErro(r.error)), () => atual && setErro("Não foi possível ler o plano deste negócio."));
    return () => {
      atual = false;
    };
  }, [slug, token]);

  async function mudar(parte: Partial<Modulos>) {
    if (parte.agendamento === false) {
      const ok = await confirmar({
        titulo: "Deixar este negócio só com o site?",
        texto: "O agendamento online fecha (o site e a bio levam ao WhatsApp e à lista de preços) e o painel do dono fica só com Serviços e Meu negócio. Agenda, equipe, clientes, Caixa e lembretes saem de cena; nada é apagado e volta ao religar.",
        acao: "Desligar o agendamento",
      });
      if (!ok) return;
    }
    setBusy(true);
    setErro("");
    const r = await definirModulosAction(await token(), slug, parte).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setErro(r?.error ?? "Não foi possível salvar agora.");
    setM(r.dados);
  }

  const opcao = "flex min-h-11 items-center gap-2.5 text-sm";
  const caixa = "size-4 accent-[#17150F]";
  return (
    <section aria-label="Plano do negócio" className="flex flex-col gap-2 rounded-2xl border border-[#E2DDD3] bg-white p-4">
      <h3 className="text-sm font-semibold">O que o plano inclui</h3>
      <p className="text-xs text-[#6F6A5E]">Tudo vem ligado. Desligue o que este cliente não vai usar: os dados ficam guardados e voltam ao religar.</p>
      {erro && <p role="alert" className="text-xs text-[#8A2F2F]">{erro}</p>}
      {!m && !erro && <p className="text-xs text-[#6F6A5E]">Carregando…</p>}
      {m && (
        <>
          <label className={opcao}>
            <input type="checkbox" className={caixa} disabled={busy} checked={m.agendamento} onChange={(e) => mudar({ agendamento: e.target.checked })} />
            Agendamento (agenda, agendamento online, equipe, clientes e lembretes)
          </label>
          {!m.agendamento && <p className="pl-6.5 text-xs text-[#6F6A5E]">Só site: o painel do dono fica com Serviços e Meu negócio.</p>}
          <label className={opcao}>
            <input type="checkbox" className={caixa} disabled={busy || !m.agendamento} checked={m.caixa && m.agendamento} onChange={(e) => mudar({ caixa: e.target.checked })} />
            Caixa (entradas, contas, comissões e recibos)
          </label>
          {!m.agendamento && <p className="pl-6.5 text-xs text-[#6F6A5E]">Sem agendamento não há Caixa: ele vive dos atendimentos.</p>}
        </>
      )}
    </section>
  );
}
