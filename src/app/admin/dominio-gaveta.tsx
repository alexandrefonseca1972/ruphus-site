"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import type { Dominio } from "@/lib/dominio";
import type { RegistroDns } from "@/lib/dominio.server";
import { conferirDominio, dominioDoSite, ligarDominio, soltarDominio } from "./actions";

/** Domínio próprio do cliente (www.salaodaana.com.br). Só para site publicado: a Ruphus
 *  liga aqui, o cliente cria no DNS os registros que aparecem, e "Verificar" ativa. */
export function DominioDoSite({ slug, publicado, token }: { slug: string; publicado: boolean; token: () => Promise<string> }) {
  const [dominio, setDominio] = useState<Dominio | null | undefined>(undefined);
  const [registros, setRegistros] = useState<RegistroDns[]>([]);
  const [host, setHost] = useState("");
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    let atual = true;
    (async () => {
      const r = await dominioDoSite(await token(), slug).catch(() => null);
      if (atual) setDominio(r?.ok ? r.dados : null);
    })();
    return () => {
      atual = false;
    };
    // um negócio por montagem: a gaveta remonta com key={slug}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function rodar(f: () => Promise<{ ok: true; dados: { dominio: Dominio; pronto: boolean; registros: RegistroDns[] } } | { ok: false; error: string } | null>) {
    setBusy(true);
    setAviso(null);
    const r = await f().catch(() => null);
    setBusy(false);
    if (!r?.ok) return setAviso({ ok: false, texto: r ? r.error : "Sem conexão." });
    setDominio(r.dados.dominio);
    setRegistros(r.dados.registros);
    setAviso(
      r.dados.dominio.status === "ativo"
        ? { ok: true, texto: `Ativo: o site abre em ${r.dados.dominio.host}${r.dados.pronto ? "" : " (a raiz sem www ainda não aponta)"}.` }
        : { ok: false, texto: "Ainda não aponta para a Ruphus. Crie os registros abaixo no DNS do domínio e verifique de novo — pode levar algumas horas." },
    );
  }

  async function soltar() {
    if (!dominio || !confirm(`Desligar ${dominio.host}? O site volta para ${slug}.ruphus.site.`)) return;
    setBusy(true);
    const r = await soltarDominio(await token(), slug).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setAviso({ ok: false, texto: r ? r.error : "Sem conexão." });
    setDominio(null);
    setRegistros([]);
    setAviso({ ok: true, texto: `Domínio desligado: o site voltou para ${slug}.ruphus.site.` });
  }

  if (dominio === undefined) return null;
  return (
    <section aria-labelledby="dominio-t" className="flex flex-col gap-3 rounded-2xl border border-[#E2DDD3] p-4">
      <h3 id="dominio-t" className="text-[11px] font-semibold tracking-[0.07em] text-[#6F6A5E] uppercase">Domínio próprio</h3>

      {!dominio ? (
        publicado ? (
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              void rodar(async () => ligarDominio(await token(), slug, host));
            }}
          >
            <Input value={host} onChange={(e) => setHost(e.target.value)} placeholder="www.salaodocliente.com.br" aria-label="Domínio do cliente" className="h-11 bg-white" />
            <button type="submit" disabled={busy || !host.trim()} className="h-11 shrink-0 rounded-[10px] bg-[#17150F] px-4 text-[13px] font-semibold text-white disabled:opacity-40">
              {busy ? "Ligando…" : "Ligar domínio"}
            </button>
          </form>
        ) : (
          <p className="text-[13px] text-[#6F6A5E]">Disponível depois que o site for publicado (entrada paga).</p>
        )
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <a href={`https://${dominio.host}`} target="_blank" rel="noopener" className="font-semibold underline underline-offset-4">{dominio.host}</a>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${dominio.status === "ativo" ? "bg-[#E7EEE9] text-[#2C6A53]" : "bg-[#FBEDE6] text-[#A8502B]"}`}>
              {dominio.status === "ativo" ? "ativo" : "aguardando DNS"}
            </span>
          </div>
          {registros.length > 0 && (
            <div className="grid gap-1.5">
              <p className="text-[13px] text-[#6F6A5E]">O cliente cria no DNS do domínio (registro.br ou onde estiver):</p>
              <table className="w-full text-left font-mono text-[12px]">
                <thead className="text-[#6F6A5E]"><tr><th className="py-1 pr-3 font-normal">Tipo</th><th className="py-1 pr-3 font-normal">Nome</th><th className="py-1 font-normal">Valor</th></tr></thead>
                <tbody>
                  {registros.map((r) => (
                    <tr key={`${r.tipo}${r.nome}${r.valor}`} className="border-t border-[#EFEBE3]">
                      <td className="py-1.5 pr-3">{r.tipo}</td>
                      <td className="py-1.5 pr-3">{r.nome}</td>
                      <td className="py-1.5 break-all">{r.valor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" disabled={busy} onClick={() => void rodar(async () => conferirDominio(await token(), slug))} className="h-11 rounded-[10px] border border-[#D8D2C6] px-3.5 text-[13px] font-semibold hover:border-[#17150F] disabled:opacity-40">
              {busy ? "Verificando…" : "Verificar"}
            </button>
            <button type="button" disabled={busy} onClick={() => void soltar()} className="h-11 rounded-[10px] border border-[#D8D2C6] px-3.5 text-[13px] text-[#8A2F2F] hover:border-[#8A2F2F] disabled:opacity-40">
              Desligar
            </button>
          </div>
        </>
      )}
      {aviso && <p role={aviso.ok ? "status" : "alert"} className={`text-[13px] ${aviso.ok ? "text-[#2C6A53]" : "text-[#8A2F2F]"}`}>{aviso.texto}</p>}
    </section>
  );
}
