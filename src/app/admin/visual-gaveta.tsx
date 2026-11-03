"use client";

import { confirmar } from "@/components/confirmar";
import { Label } from "@/components/ui/label";
import type { Personal } from "@/lib/site-editorial";
import { useRef, useState } from "react";
import { definirVisual, previewVisual } from "./actions";
import { BOTAO_CLARO, BOTAO_ESCURO, PreviaModelo } from "./site-gaveta";

// Seção "Visual" da aba Site: fotos próprias por posição, cores, fonte e textos do site
// editorial. Tudo fica num rascunho até "Publicar visual"; a prévia mostra o rascunho com
// os dados reais. A foto sobe na hora para o Storage (é só um arquivo), mas só entra no
// site quando o rascunho é publicado — salvo se aquela posição já era própria, aí troca
// ao vivo, porque o nome do arquivo é fixo.

type Slot = "hero" | "ga1" | "ga2" | "ga3" | "bio";
const SLOTS: { slot: Slot; rotulo: string; dica: string }[] = [
  { slot: "hero", rotulo: "Topo", dica: "A grande, atrás do nome. Horizontal fica melhor." },
  { slot: "ga1", rotulo: "Galeria 1", dica: "O espaço ou um trabalho." },
  { slot: "ga2", rotulo: "Galeria 2", dica: "" },
  { slot: "ga3", rotulo: "Galeria 3", dica: "" },
  { slot: "bio", rotulo: "Bio", dica: "A faixa do topo da /bio. Sem ela, vai a do topo do site." },
];
const TEXTOS: { campo: "frase" | "sobre" | "galeria"; rotulo: string; max: number; dica: string; linhas: number }[] = [
  { campo: "frase", rotulo: "Frase do topo", max: 160, dica: "Uma linha, abaixo do nome. Vazio: a frase do modelo.", linhas: 2 },
  { campo: "sobre", rotulo: "Sobre", max: 600, dica: "O texto da seção Sobre. Vazio: repete a frase do topo.", linhas: 4 },
  { campo: "galeria", rotulo: "Título da galeria", max: 60, dica: "", linhas: 1 },
];

type Props = {
  slug: string;
  token: () => Promise<string>;
  personal: Personal | null;
  /** o que o modelo em uso dá sem personalização: miniaturas e valores iniciais dos seletores */
  doModelo: { fotos: Record<string, string>; ink: string; acc: string; fonte: string };
  fontes: readonly string[];
  onPublicado: () => void;
};

export function VisualDoSite({ slug, token, personal, doModelo, fontes, onPublicado }: Props) {
  const [rascunho, setRascunho] = useState<Personal>(personal ?? {});
  const [publicado, setPublicado] = useState<Personal>(personal ?? {});
  const [enviando, setEnviando] = useState<Slot | null>(null);
  const [versao, setVersao] = useState(0);
  const [busy, setBusy] = useState(false);
  const [previa, setPrevia] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const arquivos = useRef<Partial<Record<Slot, HTMLInputElement | null>>>({});

  const mudou = JSON.stringify(rascunho) !== JSON.stringify(publicado);
  const fotoDe = (slot: Slot) => (rascunho.fotos?.[slot] ? `/s/${slug}/fotos/${slot}.jpg?v=${versao}` : doModelo.fotos[slot]);
  const falha = (r: { ok: false; error: string } | null) => setAviso({ ok: false, texto: r ? r.error : "Sem conexão. Tente de novo." });

  async function subir(slot: Slot, arquivo: File) {
    setAviso(null);
    setEnviando(slot);
    const corpo = new FormData();
    corpo.set("slug", slug);
    corpo.set("slot", slot);
    corpo.set("arquivo", arquivo);
    const r = await fetch("/api/admin/foto", { method: "POST", headers: { authorization: `Bearer ${await token()}` }, body: corpo })
      .then((x) => x.json() as Promise<{ ok: true } | { ok: false; error: string }>)
      .catch(() => null);
    setEnviando(null);
    if (!r?.ok) return falha(r);
    setVersao((v) => v + 1);
    setRascunho((p) => ({ ...p, fotos: { ...p.fotos, [slot]: `fotos/${slot}.jpg` } }));
  }

  async function usarDoModelo(slot: Slot) {
    setAviso(null);
    setEnviando(slot);
    const r = await fetch("/api/admin/foto", { method: "DELETE", headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json" }, body: JSON.stringify({ slug, slot }) })
      .then((x) => x.json() as Promise<{ ok: true } | { ok: false; error: string }>)
      .catch(() => null);
    setEnviando(null);
    if (!r?.ok) return falha(r);
    setRascunho((p) => {
      const fotos = { ...p.fotos };
      delete fotos[slot];
      return { ...p, fotos };
    });
  }

  const cor = (c: "ink" | "acc", v: string) => setRascunho((p) => ({ ...p, cores: { ...p.cores, [c]: v } }));
  const texto = (campo: "frase" | "sobre" | "galeria", v: string) =>
    setRascunho((p) => {
      const textos = { ...p.textos, [campo]: v };
      if (!v) delete textos[campo];
      return { ...p, textos };
    });

  async function visualizar() {
    setBusy(true);
    setAviso(null);
    const r = await previewVisual(await token(), slug, rascunho).catch(() => null);
    setBusy(false);
    if (!r?.ok) return falha(r);
    setPrevia(r.dados);
  }

  async function publicar() {
    if (!(await confirmar({ titulo: "Publicar o visual?", texto: "O site, a bio e a imagem do WhatsApp mudam na hora.", acao: "Publicar visual", tom: "normal" }))) return;
    setBusy(true);
    setAviso(null);
    const r = await definirVisual(await token(), slug, rascunho).catch(() => null);
    setBusy(false);
    if (!r?.ok) return falha(r);
    const gravado = r.dados ?? {};
    setPublicado(gravado);
    setRascunho(gravado);
    setPrevia(null);
    setAviso({ ok: true, texto: "Visual publicado. O site, a bio e a imagem do WhatsApp já mostram." });
    onPublicado();
  }

  return (
    <section aria-labelledby="visual-t" className="flex flex-col gap-4 rounded-2xl border border-[#E2DDD3] p-4">
      <div>
        <h3 id="visual-t" className="text-[11px] font-semibold tracking-[0.07em] text-[#6F6A5E] uppercase">Visual</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-[#4A4639]">Fotos, cores, fonte e textos por cima do modelo. Nada muda no site até publicar.</p>
      </div>

      <div className="grid gap-3">
        <Label>Fotos</Label>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {SLOTS.map(({ slot, rotulo, dica }) => {
            const propria = !!rascunho.fotos?.[slot];
            return (
              <li key={slot} className="flex flex-col gap-1.5">
                {/* eslint-disable-next-line @next/next/no-img-element -- foto do site, fora do otimizador */}
                <img src={fotoDe(slot)} alt={`${rotulo}: ${propria ? "foto própria" : "foto do modelo"}`} className={`aspect-[4/3] w-full rounded-[10px] border object-cover ${propria ? "border-[#17150F]" : "border-[#E2DDD3]"}`} />
                <div className="flex items-center gap-1 text-xs">
                  <b className="font-semibold">{rotulo}</b>
                  <span className="text-[#6F6A5E]">{propria ? "própria" : "do modelo"}</span>
                </div>
                <input
                  ref={(el) => {
                    arquivos.current[slot] = el;
                  }}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  aria-label={`Enviar foto: ${rotulo}`}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) subir(slot, f);
                  }}
                />
                <div className="flex gap-1">
                  <button type="button" className={`${BOTAO_CLARO} h-9 grow px-2 text-xs`} disabled={enviando !== null || busy} onClick={() => arquivos.current[slot]?.click()}>
                    {enviando === slot ? "Enviando…" : propria ? "Trocar" : "Enviar"}
                  </button>
                  {propria && (
                    <button type="button" className={`${BOTAO_CLARO} h-9 px-2 text-xs`} disabled={enviando !== null || busy} onClick={() => usarDoModelo(slot)} aria-label={`${rotulo}: voltar à foto do modelo`}>
                      ✕
                    </button>
                  )}
                </div>
                {dica && <p className="text-[11px] leading-snug text-[#6F6A5E]">{dica}</p>}
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-[#6F6A5E]">JPG, PNG ou WebP até 12 MB; o servidor redimensiona. Do celular, abre a galeria ou a câmera.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="visual-ink">Tinta</Label>
          <input id="visual-ink" type="color" value={rascunho.cores?.ink ?? doModelo.ink} onChange={(e) => cor("ink", e.target.value)} className="h-11 w-full cursor-pointer rounded-[10px] border border-[#D8D2C6] bg-white p-1" />
          <p className="text-[11px] text-[#6F6A5E]">Fundo do topo e dos botões.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="visual-acc">Destaque</Label>
          <input id="visual-acc" type="color" value={rascunho.cores?.acc ?? doModelo.acc} onChange={(e) => cor("acc", e.target.value)} className="h-11 w-full cursor-pointer rounded-[10px] border border-[#D8D2C6] bg-white p-1" />
          <p className="text-[11px] text-[#6F6A5E]">Detalhes, itálico e a cor da bio.</p>
        </div>
        <div className="col-span-2 grid gap-1.5 sm:col-span-1">
          <Label htmlFor="visual-fonte">Fonte dos títulos</Label>
          <select
            id="visual-fonte"
            value={rascunho.fonte ?? ""}
            onChange={(e) => setRascunho((p) => (e.target.value ? { ...p, fonte: e.target.value } : (({ fonte: _f, ...resto }) => resto)(p)))}
            className="h-11 rounded-[10px] border border-[#D8D2C6] bg-white px-3 text-[15px]"
          >
            <option value="">Do modelo ({doModelo.fonte})</option>
            {fontes.map((f) => (
              <option key={f} value={f}>{f}</option>
            ))}
          </select>
        </div>
        {rascunho.cores && Object.keys(rascunho.cores).length > 0 && (
          <button type="button" className="col-span-2 justify-self-start text-xs text-[#4A4639] underline sm:col-span-3" onClick={() => setRascunho((p) => (({ cores: _c, ...resto }) => resto)(p))}>
            Voltar às cores do modelo
          </button>
        )}
      </div>

      <div className="grid gap-3">
        {TEXTOS.map(({ campo, rotulo, max, dica, linhas }) => {
          const v = rascunho.textos?.[campo] ?? "";
          return (
            <div key={campo} className="grid gap-1.5">
              <div className="flex items-baseline justify-between">
                <Label htmlFor={`visual-${campo}`}>{rotulo}</Label>
                <span className="text-[11px] text-[#6F6A5E]">{v.length}/{max}</span>
              </div>
              <textarea
                id={`visual-${campo}`}
                value={v}
                maxLength={max}
                rows={linhas}
                onChange={(e) => texto(campo, e.target.value)}
                className="rounded-[10px] border border-[#D8D2C6] bg-white px-3.5 py-2.5 text-base sm:text-[15px]"
              />
              {dica && <p className="text-[11px] text-[#6F6A5E]">{dica}</p>}
            </div>
          );
        })}
      </div>

      {previa !== null && (
        <div className="flex flex-col gap-2">
          <PreviaModelo html={previa} />
          <div className="flex justify-end">
            <button type="button" className={BOTAO_CLARO} onClick={() => setPrevia(null)}>Fechar prévia</button>
          </div>
        </div>
      )}
      {aviso && (
        <p role={aviso.ok ? "status" : "alert"} className={`text-sm ${aviso.ok ? "text-[#2C6A53]" : "text-[#8A2F2F]"}`}>{aviso.texto}</p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={BOTAO_CLARO} disabled={busy || enviando !== null} onClick={visualizar}>{busy ? "Abrindo…" : "Pré-visualizar"}</button>
        <button type="button" className={BOTAO_ESCURO} disabled={busy || enviando !== null || !mudou} onClick={publicar}>{busy ? "Publicando…" : "Publicar visual"}</button>
      </div>
    </section>
  );
}
