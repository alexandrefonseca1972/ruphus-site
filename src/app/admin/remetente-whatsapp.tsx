"use client";

import { useEffect, useState } from "react";
import { formatPhone } from "@/lib/datetime";
import { idToken as tokenAtual } from "@/lib/firebase";
import { definirRemetenteAction, remetenteAtual } from "./actions";

const BOTAO = "inline-flex h-11 items-center justify-center rounded-[10px] bg-[#17150F] px-4 text-sm font-semibold text-white hover:bg-[#2C2920] disabled:opacity-50";
type Dados = { atual: string; opcoes: { instanceId: string; phone: string; status: string }[] };

/** Escolhe o número oficial dos próximos envios, sem trocar o histórico nem exigir deploy. */
export function RemetenteWhatsApp() {
  const [dados, setDados] = useState<Dados | null>(null);
  const [selecionado, setSelecionado] = useState("");
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let atual = true;
    tokenAtual().then((tk) => remetenteAtual(tk)).then((r) => {
      if (!atual) return;
      if (!r.ok) return setErro(r.error);
      setDados(r.dados);
      setSelecionado(r.dados.atual);
    }, () => atual && setErro("Não foi possível carregar o remetente."));
    return () => {
      atual = false;
    };
  }, []);

  return (
    <section aria-label="Remetente da plataforma WhatsApp" className="flex flex-col gap-3 rounded-2xl border border-[#E2DDD3] bg-white p-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">Remetente da plataforma (WhatsApp)</h3>
        <p className="text-xs leading-relaxed text-[#6F6A5E]">
          Número oficial usado nos próximos avisos. Só aparecem instâncias conectadas e reservadas para a Ruphus. A troca não altera o histórico.
        </p>
      </div>
      {erro && <p role="alert" className="text-sm text-[#8A2F2F]">{erro}</p>}
      {!dados && !erro && <p className="text-sm text-[#6F6A5E]">Carregando…</p>}
      {dados && (
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setAviso(null);
            const r = await definirRemetenteAction(await tokenAtual(), selecionado).catch(() => null);
            setBusy(false);
            if (!r?.ok) return setAviso({ ok: false, texto: r?.error ?? "Não foi possível trocar agora." });
            setDados({ ...dados, atual: r.dados.instanceId });
            setAviso({ ok: true, texto: `Remetente alterado para ${formatPhone(r.dados.phone)}.` });
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="remetente-oficial" className="text-xs font-medium text-[#17150F]">Número para os próximos envios</label>
            <select id="remetente-oficial" value={selecionado} onChange={(e) => setSelecionado(e.target.value)} disabled={busy || !dados.opcoes.length} className="h-11 rounded-[10px] border border-[#D8D2C6] bg-white px-3 text-sm disabled:opacity-50">
              {dados.opcoes.map((i) => <option key={i.instanceId} value={i.instanceId}>{formatPhone(i.phone)} · {i.instanceId}</option>)}
            </select>
          </div>
          {!dados.opcoes.length && <p className="text-xs text-[#8A2F2F]">Nenhuma instância conectada e reservada está disponível.</p>}
          <button type="submit" disabled={busy || !selecionado || !dados.opcoes.length} className={`${BOTAO} self-start`}>
            {busy ? "Salvando…" : "Usar este número"}
          </button>
        </form>
      )}
      {aviso && <p role="status" className={`text-xs ${aviso.ok ? "text-[#2C6A53]" : "text-[#8A2F2F]"}`}>{aviso.texto}</p>}
    </section>
  );
}
