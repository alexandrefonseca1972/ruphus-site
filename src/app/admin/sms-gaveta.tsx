"use client";

import { useEffect, useState } from "react";
import { definirSms, smsDoNegocio } from "./actions";

/** SMS de confirmação e lembrete (2 h antes) para os clientes do negócio, pela conta da Ruphus na
 *  Comtele. Desligado por padrão: cada SMS gasta crédito. */
export function SmsDoNegocio({ slug, token }: { slug: string; token: () => Promise<string> }) {
  const [estado, setEstado] = useState<{ ligado: boolean; disponivel: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let atual = true;
    token()
      .then((t) => smsDoNegocio(t, slug))
      .then((r) => atual && (r.ok ? setEstado(r.dados) : setErro(r.error)))
      .catch(() => atual && setErro("Não foi possível ler o SMS deste negócio."));
    return () => {
      atual = false;
    };
  }, [slug, token]);

  async function mudar(ligado: boolean) {
    setBusy(true);
    setErro("");
    const r = await definirSms(await token(), slug, ligado).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setErro(r?.error ?? "Não foi possível salvar agora.");
    setEstado((e) => (e ? { ...e, ligado: r.dados } : e));
  }

  return (
    <section aria-label="SMS para os clientes" className="flex flex-col gap-2 rounded-2xl border border-[#E2DDD3] bg-white p-4">
      <h3 className="text-sm font-semibold">SMS para os clientes</h3>
      <p className="text-xs text-[#6F6A5E]">
        Confirmação quando a casa confirma o horário, e lembrete 2 h antes. Vai para o celular do cliente pela conta da Ruphus na Comtele: cada SMS gasta crédito.
      </p>
      {estado && !estado.disponivel && <p className="text-xs text-[#8A2F2F]">A chave da Comtele (COMTELE_API_KEY) não está configurada no servidor: nada é enviado.</p>}
      <label className="flex min-h-11 items-center gap-2.5 text-sm">
        <input type="checkbox" className="size-4 accent-[#17150F]" disabled={!estado || busy} checked={estado?.ligado ?? false} onChange={(e) => mudar(e.target.checked)} />
        {busy ? "Salvando…" : "Enviar SMS de confirmação e lembrete"}
      </label>
      {erro && <p className="text-xs text-[#8A2F2F]">{erro}</p>}
    </section>
  );
}
