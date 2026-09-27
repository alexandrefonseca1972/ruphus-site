"use client";

import { useEffect, useRef, useState } from "react";
import { LINKS_DEMO } from "@/lib/demo";
import { acessoDaDemo, restaurarADemo } from "./actions";

type Acesso = { email: string; senha: string; restauradoEm: string | null };

/** "Demonstração" no menu do admin: os links da conta de exemplo, o acesso de dono que o
 *  vendedor passa ao cliente e o botão que devolve tudo ao padrão depois do teste. */
export function DemoMenu({ token }: { token: () => Promise<string> }) {
  const [aberto, setAberto] = useState(false);
  const [acesso, setAcesso] = useState<Acesso | null | undefined>(undefined);
  const [confirmando, setConfirmando] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [copiado, setCopiado] = useState("");
  const caixa = useRef<HTMLDivElement>(null);

  // o acesso só é pedido quando o menu abre; fora dele ou com Esc, fecha
  useEffect(() => {
    if (!aberto) return;
    if (acesso === undefined) void token().then(acessoDaDemo).then((r) => setAcesso(r.ok ? r.dados : null));
    const fora = (e: MouseEvent) => !caixa.current?.contains(e.target as Node) && setAberto(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setAberto(false);
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fora);
      document.removeEventListener("keydown", esc);
    };
  }, [aberto, acesso, token]);

  async function copiar(rotulo: string, texto: string) {
    const ok = await navigator.clipboard.writeText(texto).then(() => true, () => false);
    setCopiado(ok ? rotulo : "");
  }

  async function restaurar() {
    setBusy(true);
    setAviso(null);
    const r = await restaurarADemo(await token()).catch(() => null);
    setBusy(false);
    setConfirmando(false);
    if (!r?.ok) return setAviso({ ok: false, texto: r?.error ?? "Não foi possível restaurar. Verifique a conexão." });
    setAcesso({ email: r.dados.email, senha: r.dados.senha, restauradoEm: new Date().toISOString() });
    setCopiado("");
    setAviso({ ok: true, texto: `Restaurada: ${r.dados.agendamentos} agendamentos de exemplo e senha nova.` });
  }

  const quando = acesso?.restauradoEm && new Date(acesso.restauradoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const COPIAR = "shrink-0 rounded-md border border-[#D8D2C6] px-2 py-1 text-[11px] hover:border-[#17150F]";
  return (
    <div ref={caixa} className="relative">
      <button
        type="button"
        aria-expanded={aberto}
        aria-controls="demo-menu"
        onClick={() => setAberto((a) => !a)}
        className={`flex h-8 items-center gap-1 rounded-lg px-3 text-[12px] ${aberto ? "bg-white font-semibold shadow-[0_1px_2px_rgba(23,21,15,.12)]" : "text-[#6F6A5E] hover:text-[#17150F]"}`}
      >
        Demonstração <span aria-hidden="true" className="text-[10px]">▾</span>
      </button>
      {aberto && (
        <div id="demo-menu" className="absolute top-10 left-0 z-30 grid w-[300px] max-w-[calc(100vw-2rem)] gap-3 rounded-xl border border-[#E2DDD3] bg-white p-3 text-[13px] shadow-[0_12px_32px_-12px_rgba(23,21,15,.35)]">
          <ul className="grid gap-0.5">
            {LINKS_DEMO.map((l) => (
              <li key={l.rotulo}>
                <a href={l.href} target="_blank" rel="noreferrer" className="flex h-9 items-center justify-between rounded-lg px-2 hover:bg-[#F6F3EC]">
                  {l.rotulo} <span aria-hidden="true" className="text-[#8B8578]">↗</span>
                </a>
              </li>
            ))}
          </ul>

          <section aria-labelledby="demo-acesso" className="grid gap-1.5 border-t border-[#EDE9E1] pt-3">
            <h3 id="demo-acesso" className="text-[11px] font-semibold tracking-[0.07em] text-[#6F6A5E] uppercase">Acesso de dono para o cliente</h3>
            {acesso === undefined ? (
              <p className="text-[#6F6A5E]">Carregando…</p>
            ) : acesso === null ? (
              <p className="text-[#6F6A5E]">Ainda não criado: restaure a demonstração uma vez.</p>
            ) : (
              <>
                {[["E-mail", acesso.email], ["Senha", acesso.senha]].map(([rotulo, valor]) => (
                  <div key={rotulo} className="flex items-center gap-2">
                    <span className="w-12 shrink-0 text-[#6F6A5E]">{rotulo}</span>
                    <code className="min-w-0 grow truncate">{valor}</code>
                    <button type="button" onClick={() => copiar(rotulo, valor)} className={COPIAR}>
                      {copiado === rotulo ? "Copiado ✓" : "Copiar"}
                    </button>
                  </div>
                ))}
                <p className="text-[11px] text-[#6F6A5E]">Entra em ruphus.site/login.{quando ? ` Senha de ${quando}.` : ""} Volta ao padrão sozinha toda madrugada, às 3h, com senha nova.</p>
              </>
            )}
          </section>

          <section className="grid gap-2 border-t border-[#EDE9E1] pt-3">
            {!confirmando ? (
              <button type="button" onClick={() => setConfirmando(true)} className="h-9 rounded-lg border border-[#D8D2C6] font-medium hover:border-[#17150F]">
                Restaurar padrão
              </button>
            ) : (
              <div role="alertdialog" aria-labelledby="demo-confirma" className="grid gap-2 rounded-lg bg-[#FBF3DC] p-2.5">
                <p id="demo-confirma" className="text-[12px] text-[#4A4639]">
                  Apaga o que foi feito no teste (agendamentos, clientes, serviços, equipe e convidados), volta aos dados de exemplo e troca a senha: quem testou deixa de entrar.
                </p>
                <div className="flex justify-end gap-2">
                  <button type="button" onClick={() => setConfirmando(false)} disabled={busy} className="h-8 rounded-md px-3 text-[12px]">Cancelar</button>
                  <button type="button" onClick={restaurar} disabled={busy} className="h-8 rounded-md bg-[#17150F] px-3 text-[12px] font-medium text-white disabled:opacity-60">
                    {busy ? "Restaurando…" : "Restaurar"}
                  </button>
                </div>
              </div>
            )}
            {aviso && (
              <p role={aviso.ok ? "status" : "alert"} className={`text-[12px] ${aviso.ok ? "text-[#2C6A53]" : "text-[#8A2F2F]"}`}>
                {aviso.texto}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
