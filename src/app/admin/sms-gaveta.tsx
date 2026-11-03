"use client";

import { useEffect, useState } from "react";
import { definirSms, smsDoNegocio } from "./actions";

type Config = { ligado: boolean; confirmacao: boolean; lembrete: boolean; horasAntes: number };

/** SMS de confirmação e lembrete para os clientes do negócio, pela conta da Ruphus na Comtele.
 *  Desligado por padrão: cada SMS gasta crédito. */
export function SmsDoNegocio({ slug, token }: { slug: string; token: () => Promise<string> }) {
  const [estado, setEstado] = useState<(Config & { disponivel: boolean }) | null>(null);
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

  async function mudar(parte: Partial<Config>) {
    if (!estado) return;
    const { disponivel: _, ...atual } = estado;
    setBusy(true);
    setErro("");
    const r = await definirSms(await token(), slug, { ...atual, ...parte }).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setErro(r?.error ?? "Não foi possível salvar agora.");
    setEstado((e) => (e ? { ...e, ...r.dados } : e));
  }

  const opcao = "flex min-h-11 items-center gap-2.5 text-sm";
  const caixa = "size-4 accent-[#17150F]";
  return (
    <section aria-label="SMS para os clientes" className="flex flex-col gap-2 rounded-2xl border border-[#E2DDD3] bg-white p-4">
      <h3 className="text-sm font-semibold">SMS para os clientes</h3>
      <p className="text-xs text-[#6F6A5E]">Vai para o celular do cliente pela conta da Ruphus na Comtele: cada SMS gasta crédito. Nada sai entre 22h e 7h30.</p>
      {estado && !estado.disponivel && <p className="text-xs text-[#8A2F2F]">A chave da Comtele não está cadastrada (Ajustes, no topo do admin): nada é enviado.</p>}
      <label className={opcao}>
        <input type="checkbox" className={caixa} disabled={!estado || busy} checked={estado?.ligado ?? false} onChange={(e) => mudar({ ligado: e.target.checked })} />
        {busy ? "Salvando…" : "Enviar SMS para os clientes deste negócio"}
      </label>
      {estado?.ligado && (
        <div className="flex flex-col gap-1 border-l-2 border-[#EDE9E1] pl-3">
          <label className={opcao}>
            <input type="checkbox" className={caixa} disabled={busy} checked={estado.confirmacao} onChange={(e) => mudar({ confirmacao: e.target.checked })} />
            Confirmação, quando a casa confirma o horário
          </label>
          <label className={opcao}>
            <input type="checkbox" className={caixa} disabled={busy} checked={estado.lembrete} onChange={(e) => mudar({ lembrete: e.target.checked })} />
            Lembrete antes do horário
          </label>
          {estado.lembrete && (
            <label className="flex flex-wrap items-center gap-2 pl-6.5 text-sm text-[#6F6A5E]">
              Enviar
              <select
                value={estado.horasAntes}
                disabled={busy}
                onChange={(e) => mudar({ horasAntes: Number(e.target.value) })}
                className="h-9 rounded-lg border border-[#D8D2C6] bg-white px-2 text-[#17150F] tabular-nums"
              >
                {[1, 2, 3, 4, 6, 8, 12, 24].map((h) => (
                  <option key={h} value={h}>
                    {h} {h === 1 ? "hora" : "horas"}
                  </option>
                ))}
              </select>
              antes do horário
            </label>
          )}
          {!estado.confirmacao && !estado.lembrete && <p className="text-xs text-[#8A2F2F]">Com as duas desmarcadas, nenhum SMS sai.</p>}
        </div>
      )}
      {erro && <p className="text-xs text-[#8A2F2F]">{erro}</p>}
    </section>
  );
}
