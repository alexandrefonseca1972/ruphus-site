"use client";

import { useState } from "react";
import { type Leitura, lerPlanilha } from "@/lib/gerador";
import type { LinhaGerada } from "@/lib/gerador.server";
import { gerarSites } from "./actions";

// O gerador: planilha de leads → sites no ar em {slug}.ruphus.site, no mesmo
// padrão dos que vieram da fábrica. A planilha é lida aqui no navegador; o
// servidor confere tudo de novo, escolhe os endereços e só grava na confirmação.

const BOTAO = "h-10 rounded-[10px] px-4 text-[13px] font-semibold";

export function Gerador({ idToken, aoGerar }: { idToken: string; aoGerar: () => void }) {
  const [arquivo, setArquivo] = useState("");
  const [leitura, setLeitura] = useState<Leitura | null>(null);
  const [previa, setPrevia] = useState<LinhaGerada[] | null>(null);
  const [feito, setFeito] = useState<LinhaGerada[] | null>(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function abrir(f: File) {
    setArquivo(f.name);
    setLeitura(null);
    setPrevia(null);
    setFeito(null);
    setErro("");
    setOcupado(true);
    try {
      // só quem abre uma planilha baixa o leitor de .xlsx
      const { default: lerAbas } = await import("read-excel-file/browser");
      const lida = lerPlanilha((await lerAbas(f)).map(({ sheet, data }) => ({ aba: sheet, linhas: data as unknown[][] })));
      setLeitura(lida);
      if (!lida.leads.length) return;
      const r = await gerarSites(idToken, lida.leads, false);
      if (r.ok) setPrevia(r.dados);
      else setErro(r.error);
    } catch {
      setErro("Não consegui ler o arquivo. Ele precisa ser uma planilha .xlsx.");
    } finally {
      setOcupado(false);
    }
  }

  async function gerar() {
    if (!leitura) return;
    setOcupado(true);
    setErro("");
    const r = await gerarSites(idToken, leitura.leads, true).catch(() => null);
    setOcupado(false);
    if (!r) return setErro("Não foi possível gerar agora. Tente de novo.");
    if (!r.ok) return setErro(r.error);
    setFeito(r.dados);
    setPrevia(null);
    aoGerar();
  }

  const chave = (l: { aba: string; linha: number }) => `${l.aba}#${l.linha}`;
  const nomes = new Map(leitura?.leads.map((l) => [chave(l), l.lead]) ?? []);
  const conta = (a: LinhaGerada["acao"]) => previa?.filter((l) => l.acao === a).length ?? 0;
  const gerados = previa ? previa.length - conta("pular") : 0;
  // com uma aba só, a coluna "aba" é ruído
  const variasAbas = new Set([...(leitura?.leads ?? []), ...(leitura?.erros ?? [])].map((l) => l.aba)).size > 1;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1.5">
          <h2 className="font-[family-name:var(--fonte-serifa)] text-[26px] leading-none">Gerar sites</h2>
          <p className="max-w-[62ch] text-[13px] text-[#6F6A5E]">
            Envie a planilha de leads (.xlsx) e cada linha vira um site-proposta no mesmo padrão dos que já estão no ar, com agenda e ficha no funil.
            Por enquanto: pet shop, veterinária, barbearia, salão, estética, unhas e tatuagem.
          </p>
        </div>
        <a href="/modelo-leads.xlsx" download className={`${BOTAO} flex items-center border border-[#D8D2C6] bg-white hover:border-[#17150F]`}>
          Baixar planilha modelo
        </a>
      </div>

      <label className="flex cursor-pointer flex-col items-center gap-1.5 rounded-2xl border border-dashed border-[#D8D2C6] bg-white p-7 text-center hover:border-[#17150F]">
        <span className="text-[14px] font-semibold">{ocupado ? "Lendo…" : arquivo || "Escolher planilha"}</span>
        <span className="text-[12px] text-[#6F6A5E]">Colunas: nome, telefone, categoria, endereço, bairro, cidade, UF, nota, avaliações, Instagram, horário, serviços, e-mail</span>
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          disabled={ocupado}
          onChange={(e) => {
            const f = e.currentTarget.files?.[0];
            e.currentTarget.value = ""; // a mesma planilha, corrigida, pode ser escolhida de novo
            if (f) abrir(f);
          }}
        />
      </label>

      {erro && <p role="alert" className="rounded-xl border border-[#E3C6BD] bg-[#FBEFEB] p-3 text-[13px] text-[#8A3A22]">{erro}</p>}

      {leitura && (leitura.erros.length > 0 || leitura.ignoradas.length > 0) && (
        <section aria-label="Linhas com problema" className="flex flex-col gap-2 rounded-2xl border border-[#E2DDD3] bg-white p-4 text-[12.5px]">
          {leitura.erros.length > 0 && (
            <>
              <h3 className="text-[13px] font-semibold">{leitura.erros.length} linha(s) ficam de fora</h3>
              <ul className="flex flex-col gap-1 text-[#6F6A5E]">
                {leitura.erros.map((e) => (
                  <li key={chave(e)}><span className="font-semibold text-[#17150F]">{variasAbas ? `${e.aba}, linha ${e.linha}` : `Linha ${e.linha}`}:</span> {e.motivo}</li>
                ))}
              </ul>
            </>
          )}
          {leitura.ignoradas.length > 0 && (
            <p className="text-[#6F6A5E]">Colunas que o gerador não usa: {leitura.ignoradas.join(", ")}.</p>
          )}
        </section>
      )}

      {previa && previa.length > 0 && (
        <section aria-label="Prévia" className="flex flex-col gap-3">
          <div className="overflow-x-auto rounded-2xl border border-[#E2DDD3] bg-white">
            <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
              <thead>
                <tr className="bg-[#FBFAF8] text-[11px] tracking-[0.06em] text-[#6F6A5E] uppercase">
                  <th scope="col" className="px-4 py-2.5 text-left font-medium">{variasAbas ? "Aba · linha" : "Linha"}</th>
                  <th scope="col" className="px-4 py-2.5 text-left font-medium">Negócio</th>
                  <th scope="col" className="px-4 py-2.5 text-left font-medium">Endereço</th>
                  <th scope="col" className="px-4 py-2.5 text-left font-medium">O que acontece</th>
                </tr>
              </thead>
              <tbody>
                {previa.map((l) => (
                  <tr key={chave(l)} className={`border-t border-[#E2DDD3] ${l.acao === "pular" ? "text-[#8B8578]" : ""}`}>
                    <td className="px-4 py-2.5 text-[#6F6A5E] tabular-nums">{variasAbas ? `${l.aba} · ${l.linha}` : l.linha}</td>
                    <td className="px-4 py-2.5">
                      <span className="block font-semibold">{l.nome}</span>
                      <span className="block text-[11px] text-[#6F6A5E]">{[nomes.get(chave(l))?.categoria, nomes.get(chave(l))?.cidade].filter(Boolean).join(" · ")}</span>
                    </td>
                    <td className="px-4 py-2.5">
                      {l.acao === "pular" ? (
                        <a href={`https://${l.slug}.ruphus.site/`} target="_blank" rel="noreferrer" className="block font-mono text-[12px] underline underline-offset-2">{l.slug}.ruphus.site</a>
                      ) : (
                        <span className="block font-mono text-[12px]">{l.slug}.ruphus.site</span>
                      )}
                      {l.conflito && <span className="block text-[11px] text-[#7A5A2E]">“{l.conflito}” já é de outro negócio</span>}
                      {l.aviso && <span className="block text-[11px] text-[#7A5A2E]">{l.aviso}</span>}
                    </td>
                    <td className="px-4 py-2.5">{l.acao === "criar" ? "Site novo" : l.acao === "atualizar" ? "Atualiza o site gerado antes" : "Já tem site — fica de fora"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {gerados > 0 && (
              <button type="button" disabled={ocupado} onClick={gerar} className={`${BOTAO} bg-[#17150F] text-white disabled:opacity-60`}>
                {ocupado ? "Gerando…" : `Gerar ${gerados} site(s)`}
              </button>
            )}
            <span className="text-[12px] text-[#6F6A5E]">
              {conta("criar")} novo(s), {conta("atualizar")} atualização(ões), {conta("pular")} pulada(s) por já ter site. Atualizar não mexe na agenda nem no funil do negócio.
            </span>
          </div>
        </section>
      )}

      {feito && (
        <section aria-label="Sites gerados" className="flex flex-col gap-2 rounded-2xl border border-[#CADCD1] bg-[#EFF5F1] p-4">
          <h3 className="text-[14px] font-semibold text-[#235B45]">{feito.filter((l) => l.acao !== "pular").length} site(s) no ar</h3>
          <ul className="flex flex-col gap-1 text-[13px]">
            {feito.filter((l) => l.acao !== "pular").map((l) => (
              <li key={l.slug}>
                <a href={`https://${l.slug}.ruphus.site/`} target="_blank" rel="noreferrer" className="font-semibold underline underline-offset-2">{l.nome}</a>
                <span className="text-[#6F6A5E]"> · {l.slug}.ruphus.site · </span>
                {/* no próprio servidor: serve para conferir no dev, antes do subdomínio existir */}
                <a href={`/s/${l.slug}/index.html`} target="_blank" rel="noreferrer" className="text-[#6F6A5E] underline underline-offset-2">prévia</a>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
