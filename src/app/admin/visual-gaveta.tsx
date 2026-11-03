"use client";

import { confirmar } from "@/components/confirmar";
import { Label } from "@/components/ui/label";
import type { Personal } from "@/lib/site-editorial";
import { useEffect, useRef, useState } from "react";
import { conversarVisual, definirVisual, previewVisual } from "./actions";
import { BOTAO_CLARO, BOTAO_ESCURO, PreviaModelo, type Tela } from "./site-gaveta";

// Seção "Visual" da aba Site: fotos próprias por posição, cores, fonte e textos do site
// editorial, com a IA como caminho principal. Tudo fica num rascunho até "Publicar visual";
// a prévia mostra o rascunho com os dados reais. A foto sobe na hora para o Storage (é só um
// arquivo) e só entra no site ao publicar — salvo se aquela posição já era própria, aí troca
// ao vivo, porque o nome do arquivo é fixo. Tirar uma foto do rascunho não apaga o arquivo:
// ele some ao publicar, quando o site deixa de apontar para ele.

type Slot = "hero" | "ga1" | "ga2" | "ga3" | "bio";
// a miniatura tem a proporção do corte real de cada posição; a da bio ocupa a linha inteira
const SLOTS: { slot: Slot; rotulo: string; dica: string; classe: string }[] = [
  { slot: "hero", rotulo: "Topo", dica: "A grande, atrás do nome. Horizontal fica melhor.", classe: "aspect-video" },
  { slot: "ga1", rotulo: "Galeria 1", dica: "O espaço ou um trabalho.", classe: "aspect-[4/3]" },
  { slot: "ga2", rotulo: "Galeria 2", dica: "", classe: "aspect-[4/3]" },
  { slot: "ga3", rotulo: "Galeria 3", dica: "", classe: "aspect-[4/3]" },
  { slot: "bio", rotulo: "Bio", dica: "A faixa do topo da /bio. Sem ela, vai a do topo do site.", classe: "aspect-[1040/448] col-span-2" },
];
const TEXTOS: { campo: "frase" | "sobre" | "galeria"; rotulo: string; max: number; dica: string; linhas: number }[] = [
  { campo: "frase", rotulo: "Frase do topo", max: 160, dica: "Uma linha, abaixo do nome. Vazio: a frase do modelo.", linhas: 2 },
  { campo: "sobre", rotulo: "Sobre", max: 600, dica: "O texto da seção Sobre. Vazio: repete a frase do topo.", linhas: 4 },
  { campo: "galeria", rotulo: "Título da galeria", max: 60, dica: "Vazio: o título do modelo.", linhas: 1 },
];
const EXEMPLOS = ["Sugira uma paleta a partir das fotos", "Reescreva o Sobre mais caloroso", "Deixe mais elegante"];

type Props = {
  slug: string;
  token: () => Promise<string>;
  personal: Personal | null;
  /** o que o modelo em uso dá sem personalização: miniaturas e valores iniciais dos seletores */
  doModelo: { fotos: Record<string, string>; ink: string; acc: string; fonte: string };
  fontes: readonly string[];
  /** há chave da Anthropic em Ajustes: o chat aparece */
  temIA: boolean;
  onPublicado: () => void;
};

type Mensagem = { papel: "user" | "assistant"; texto: string };
/** uma mudança proposta pela IA, por chave folha ("cores.acc"), com o rótulo que a lista mostra */
type Proposta = { chave: string; rotulo: string; valor: string; marcada: boolean };
const ROTULO: Record<string, string> = { "cores.ink": "Tinta", "cores.acc": "Destaque", fonte: "Fonte", "textos.frase": "Frase do topo", "textos.sobre": "Sobre", "textos.galeria": "Título da galeria" };
const propostasDe = (m: Personal): Proposta[] =>
  Object.entries(ROTULO).flatMap(([chave, rotulo]) => {
    const [a, b] = chave.split(".");
    const v = b ? (m as Record<string, Record<string, string> | undefined>)[a]?.[b] : (m as Record<string, string | undefined>)[a];
    return v ? [{ chave, rotulo, valor: v, marcada: true }] : [];
  });
const DICA = "text-xs leading-snug text-[#4A4639]";
const canonico = (v: unknown): string =>
  v && typeof v === "object" && !Array.isArray(v)
    ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonico((v as Record<string, unknown>)[k])}`).join(",")}}`
    : JSON.stringify(v);
/** Resposta da rota de upload; um proxy na frente pode responder 413/502 em HTML, e aí o status é o aviso. */
const lerJson = (x: Response) => x.json().catch(() => ({ ok: false as const, error: `Falha no envio (${x.status}).` })) as Promise<{ ok: true } | { ok: false; error: string }>;

export function VisualDoSite({ slug, token, personal, doModelo, fontes, temIA, onPublicado }: Props) {
  const [rascunho, setRascunho] = useState<Personal>(personal ?? {});
  const [publicado, setPublicado] = useState<Personal>(personal ?? {});
  const [historico, setHistorico] = useState<Mensagem[]>([]);
  const [pedido, setPedido] = useState("");
  const [pensando, setPensando] = useState(false);
  const [propostas, setPropostas] = useState<Proposta[]>([]);
  const [enviando, setEnviando] = useState<Slot | null>(null);
  const [erroFoto, setErroFoto] = useState<{ slot: Slot; texto: string } | null>(null);
  const [versao, setVersao] = useState(0);
  // posições cujo arquivo foi trocado depois da última publicação: a referência não muda
  // ("fotos/hero.jpg"), mas o site só passa a pedir a foto nova ao publicar (carimbo ?v=)
  const [reenviadas, setReenviadas] = useState<Set<Slot>>(() => new Set());
  const [acao, setAcao] = useState<"previa" | "publicar" | null>(null);
  const busy = acao !== null;
  const [previa, setPrevia] = useState<string | null>(null);
  // no celular a prévia nasce em modo celular: é o que o dono do negócio vai ver (a seção só
  // monta no navegador, depois de carregar o site, então window existe)
  const [tela, setTela] = useState<Tela>(() => (typeof window !== "undefined" && window.matchMedia("(max-width: 640px)").matches ? "celular" : "computador"));
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const arquivos = useRef<Partial<Record<Slot, HTMLInputElement | null>>>({});
  const caixaPrevia = useRef<HTMLDivElement>(null);
  const caixaAviso = useRef<HTMLParagraphElement>(null);

  // a prévia e o aviso abrem fora da dobra: rola até eles
  useEffect(() => {
    if (previa !== null) caixaPrevia.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [previa]);
  useEffect(() => {
    if (aviso) caixaAviso.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [aviso]);

  // comparação por valor, com as chaves em ordem: apagar e redigitar o mesmo texto não "muda"
  const semVersao = ({ versao: _v, ...resto }: Personal) => resto;
  const mudou = canonico(semVersao(rascunho)) !== canonico(semVersao(publicado)) || [...reenviadas].some((s) => rascunho.fotos?.[s]);
  const fotoDe = (slot: Slot) => (rascunho.fotos?.[slot] ? `/s/${slug}/fotos/${slot}.jpg?v=${versao}` : doModelo.fotos[slot]);
  const falha = (r: { ok: false; error: string } | null) => setAviso({ ok: false, texto: r ? r.error : "Sem conexão. Tente de novo." });
  // sessão caída ou sem rede: o token falha antes da chamada, e a tela não pode ficar presa em "Enviando…"
  const tokenOuNull = () => token().catch(() => null);

  async function subir(slot: Slot, arquivo: File) {
    setErroFoto(null);
    setEnviando(slot);
    const corpo = new FormData();
    corpo.set("slug", slug);
    corpo.set("slot", slot);
    corpo.set("arquivo", arquivo);
    const t = await tokenOuNull();
    const r = t
      ? await fetch("/api/admin/foto", { method: "POST", headers: { authorization: `Bearer ${t}` }, body: corpo }).then(lerJson).catch(() => null)
      : null;
    setEnviando(null);
    if (!r?.ok) return setErroFoto({ slot, texto: r ? r.error : "Sem conexão. Tente de novo." });
    setVersao((v) => v + 1);
    setReenviadas((r) => new Set(r).add(slot));
    setRascunho((p) => ({ ...p, fotos: { ...p.fotos, [slot]: `fotos/${slot}.jpg` } }));
    setAviso({ ok: true, texto: `${SLOTS.find((s) => s.slot === slot)?.rotulo}: foto enviada. Entra no site ao publicar.` });
  }

  // só tira do rascunho: o arquivo some do Storage ao publicar
  function usarDoModelo(slot: Slot) {
    setErroFoto(null);
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

  async function perguntar(textoPedido = pedido) {
    const t = textoPedido.trim();
    if (!t || pensando) return;
    setAviso(null);
    setPropostas([]);
    setPedido("");
    // o balão do pedido entra na hora; o da resposta, quando chegar
    setHistorico((h) => [...h, { papel: "user", texto: t }]);
    setPensando(true);
    // só os últimos turnos vão: o contexto do negócio e do visual é remontado a cada pedido
    const tk = await tokenOuNull();
    const r = tk ? await conversarVisual(tk, slug, rascunho, { pedido: t, historico: historico.slice(-9) }).catch(() => null) : null;
    setPensando(false);
    if (!r?.ok) {
      setPedido(t);
      return falha(r);
    }
    setHistorico((h) => [...h, { papel: "assistant", texto: r.dados.resposta }]);
    setPropostas(propostasDe(r.dados.mudancas));
  }

  function aplicarPropostas() {
    // monta o rascunho novo fora do setState: a prévia abre com ele, não com o anterior
    const n: Personal = { ...rascunho, cores: { ...rascunho.cores }, textos: { ...rascunho.textos } };
    for (const { chave, valor, marcada } of propostas) {
      if (!marcada) continue;
      if (chave === "fonte") n.fonte = valor;
      else if (chave.startsWith("cores.")) n.cores![chave.slice(6) as "ink" | "acc"] = valor;
      else n.textos![chave.slice(7) as "frase" | "sobre" | "galeria"] = valor;
    }
    setRascunho(n);
    setPropostas([]);
    visualizar(n);
  }

  async function visualizar(r0: Personal = rascunho) {
    setAcao("previa");
    setAviso(null);
    const tk = await tokenOuNull();
    const r = tk ? await previewVisual(tk, slug, r0).catch(() => null) : null;
    setAcao(null);
    if (!r?.ok) return falha(r);
    setPrevia(r.dados);
  }

  async function publicar() {
    if (!(await confirmar({ titulo: "Publicar o visual?", texto: "O site, a bio e a imagem do WhatsApp mudam na hora. Dá para trocar de novo a qualquer momento.", acao: "Publicar visual", tom: "normal" }))) return;
    setAcao("publicar");
    setAviso(null);
    const tk = await tokenOuNull();
    const r = tk ? await definirVisual(tk, slug, rascunho).catch(() => null) : null;
    setAcao(null);
    if (!r?.ok) return falha(r);
    const gravado = r.dados ?? {};
    setPublicado(gravado);
    setRascunho(gravado);
    setReenviadas(new Set());
    setPrevia(null);
    setAviso({ ok: true, texto: "Visual publicado. O site, a bio e a imagem do WhatsApp já mostram." });
    onPublicado();
  }

  const corAtual = { ink: rascunho.cores?.ink ?? doModelo.ink, acc: rascunho.cores?.acc ?? doModelo.acc };
  const ocupado = busy || enviando !== null;

  return (
    <section aria-labelledby="visual-t" className="flex flex-col gap-4 rounded-2xl border border-[#E2DDD3] p-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h3 id="visual-t" className="text-[11px] font-semibold tracking-[0.07em] text-[#6F6A5E] uppercase">Visual</h3>
          <span className={`rounded-full px-2 py-0.5 text-xs ${mudou ? "bg-[#FBEFD5] text-[#7A5A2E]" : "bg-[#F3EFE7] text-[#6F6A5E]"}`} aria-live="polite">{mudou ? "Rascunho não publicado" : "Nada a publicar"}</span>
        </div>
        <p className="mt-1 text-[13px] leading-relaxed text-[#4A4639]">Fotos, cores, fonte e textos por cima do modelo. Nada muda no site até publicar.</p>
      </div>

      {/* a IA é o caminho principal: vem primeiro */}
      <div className="grid gap-2 rounded-xl bg-[#FBFAF8] p-3.5">
        <Label htmlFor="visual-ia">Pedir à IA</Label>
        {temIA ? (
          <>
            {historico.length === 0 && !pensando && (
              <div className="flex flex-wrap gap-2">
                {EXEMPLOS.map((e) => (
                  <button key={e} type="button" className="h-9 rounded-full border border-[#D8D2C6] bg-white px-3 text-xs text-[#17150F] hover:border-[#17150F]" onClick={() => perguntar(e)}>{e}</button>
                ))}
              </div>
            )}
            {(historico.length > 0 || pensando) && (
              <ul className="flex max-h-64 flex-col gap-2 overflow-y-auto text-[13px]" aria-live="polite">
                {historico.map((m, i) => (
                  <li key={i} className={`max-w-[92%] rounded-[12px] px-3 py-2 ${m.papel === "user" ? "self-end bg-[#17150F] text-white" : "self-start border border-[#E2DDD3] bg-white text-[#17150F]"}`}>{m.texto}</li>
                ))}
                {pensando && <li role="status" className="max-w-[92%] animate-pulse self-start rounded-[12px] border border-[#E2DDD3] bg-white px-3 py-2 text-[#6F6A5E]">A IA está montando a sugestão… (até 20 s)</li>}
              </ul>
            )}
            {propostas.length > 0 && (
              <div className="grid gap-2 rounded-[10px] border border-[#17150F] bg-white p-3" aria-live="polite">
                <p className="text-xs font-semibold">Mudanças propostas</p>
                <ul className="grid gap-1.5 text-[13px]">
                  {propostas.map((pr) => (
                    <li key={pr.chave}>
                      <label className="flex items-start gap-2">
                        <input type="checkbox" className="mt-1 size-4" checked={pr.marcada} onChange={(e) => setPropostas((ps) => ps.map((x) => (x.chave === pr.chave ? { ...x, marcada: e.target.checked } : x)))} />
                        <span className="min-w-0">
                          <b className="font-semibold">{pr.rotulo}:</b>{" "}
                          {pr.chave.startsWith("cores.") ? (
                            <span className="inline-flex items-center gap-1.5 align-middle">
                              <i aria-label="cor atual" className="inline-block size-5 rounded-full border border-[#D8D2C6]" style={{ background: corAtual[pr.chave.slice(6) as "ink" | "acc"] }} />
                              <span aria-hidden>→</span>
                              <i aria-label="cor proposta" className="inline-block size-5 rounded-full border border-[#D8D2C6]" style={{ background: pr.valor }} />
                              <span className="font-mono text-xs">{pr.valor}</span>
                            </span>
                          ) : (
                            <span className="line-clamp-3 break-words">{pr.valor}</span>
                          )}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
                  <button type="button" className="text-xs text-[#4A4639] underline sm:mr-auto" onClick={() => setPropostas([])}>Descartar sugestão</button>
                  {!propostas.some((x) => x.marcada) && <span className="text-xs text-[#6F6A5E]">Marque ao menos uma mudança</span>}
                  <button type="button" className={BOTAO_ESCURO} disabled={busy || !propostas.some((x) => x.marcada)} onClick={aplicarPropostas}>Aplicar na prévia</button>
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <textarea
                id="visual-ia"
                value={pedido}
                rows={2}
                maxLength={600}
                placeholder="O que mudar? Ex.: deixe o destaque mais escuro"
                onChange={(e) => setPedido(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !pensando) {
                    e.preventDefault();
                    perguntar();
                  }
                }}
                className="grow rounded-[10px] border border-[#D8D2C6] bg-white px-3.5 py-2.5 text-base sm:text-[15px]"
              />
              <button type="button" className={BOTAO_ESCURO} disabled={pensando || busy || !pedido.trim()} onClick={() => perguntar()}>{pensando ? "Pensando…" : "Enviar"}</button>
            </div>
            <p className={DICA}>A IA propõe cores, fonte e textos; você marca o que entra. Fotos só pelos botões abaixo.</p>
          </>
        ) : (
          <p className={DICA}>Cadastre a chave da Anthropic em Ajustes (engrenagem) para pedir sugestões de cores, fonte e textos.</p>
        )}
      </div>

      <div className="grid gap-3">
        <h4 className="text-sm font-medium">Fotos</h4>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {SLOTS.map(({ slot, rotulo, dica, classe }) => {
            const propria = !!rascunho.fotos?.[slot];
            const erro = erroFoto?.slot === slot ? erroFoto.texto : "";
            return (
              <li key={slot} className={`flex flex-col gap-1.5 ${classe.includes("col-span-2") ? "col-span-2 sm:col-span-3" : ""}`}>
                <div className="relative">
                  {/* eslint-disable-next-line @next/next/no-img-element -- foto do site, fora do otimizador */}
                  <img src={fotoDe(slot)} alt={`${rotulo}: ${propria ? "foto própria" : "foto do modelo"}`} className={`${classe.replace("col-span-2", "")} w-full rounded-[10px] border object-cover ${propria ? "border-[#17150F]" : "border-[#E2DDD3]"}`} />
                  {enviando === slot && <div role="status" className="absolute inset-0 grid place-items-center rounded-[10px] bg-white/75 text-xs font-semibold">Enviando…</div>}
                </div>
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
                  tabIndex={-1}
                  aria-hidden
                  aria-label={`Enviar foto: ${rotulo}`}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) subir(slot, f);
                  }}
                />
                <div className="flex gap-1.5">
                  <button type="button" className={`${BOTAO_CLARO} grow px-2`} aria-disabled={ocupado} aria-busy={enviando === slot} onClick={() => !ocupado && arquivos.current[slot]?.click()}>
                    {propria ? "Trocar" : "Enviar"}
                  </button>
                  {propria && (
                    <button type="button" className={`${BOTAO_CLARO} px-2`} aria-disabled={ocupado} onClick={() => !ocupado && usarDoModelo(slot)}>
                      Do modelo
                    </button>
                  )}
                </div>
                {erro && <p role="alert" className="text-xs text-[#8A2F2F]">{erro}</p>}
                {dica && <p className={DICA}>{dica}</p>}
              </li>
            );
          })}
        </ul>
        <p className={DICA}>JPG, PNG ou WebP até 12 MB; o servidor redimensiona. Do celular, abre a galeria ou a câmera.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="grid gap-1.5">
          <Label htmlFor="visual-ink">Tinta</Label>
          <input id="visual-ink" type="color" value={corAtual.ink} onChange={(e) => cor("ink", e.target.value)} className="h-11 w-full cursor-pointer rounded-[10px] border border-[#D8D2C6] bg-white p-1" />
          <p className={DICA}>Fundo do topo e dos botões.</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="visual-acc">Destaque</Label>
          <input id="visual-acc" type="color" value={corAtual.acc} onChange={(e) => cor("acc", e.target.value)} className="h-11 w-full cursor-pointer rounded-[10px] border border-[#D8D2C6] bg-white p-1" />
          <p className={DICA}>Detalhes, itálico e a cor da bio.</p>
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
            Usar as cores do modelo
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
                <span className="text-xs text-[#6F6A5E]">{v.length}/{max}</span>
              </div>
              {dica && <p className={DICA}>{dica}</p>}
              <textarea
                id={`visual-${campo}`}
                value={v}
                maxLength={max}
                rows={linhas}
                onChange={(e) => texto(campo, e.target.value)}
                className="rounded-[10px] border border-[#D8D2C6] bg-white px-3.5 py-2.5 text-base sm:text-[15px]"
              />
            </div>
          );
        })}
      </div>

      {previa !== null && (
        <div ref={caixaPrevia} className="flex scroll-mt-16 flex-col gap-2">
          <div className="sticky top-0 z-10 flex items-center gap-2 bg-white/90 py-2 backdrop-blur">
            <div role="group" aria-label="Tela da prévia" className="flex rounded-[10px] border border-[#D8D2C6] p-0.5">
              {(["celular", "computador"] as const).map((t) => (
                <button key={t} type="button" aria-pressed={tela === t} className={`h-9 rounded-[8px] px-3 text-xs font-semibold ${tela === t ? "bg-[#17150F] text-white" : "text-[#4A4639]"}`} onClick={() => setTela(t)}>
                  {t === "celular" ? "Celular" : "Computador"}
                </button>
              ))}
            </div>
            <div className="grow" />
            <button type="button" className={BOTAO_CLARO} onClick={() => setPrevia(null)}>Fechar prévia do visual</button>
          </div>
          <PreviaModelo html={previa} tela={tela} titulo="Pré-visualização do visual" />
        </div>
      )}
      {aviso && (
        <p ref={caixaAviso} role={aviso.ok ? "status" : "alert"} className={`text-sm ${aviso.ok ? "text-[#2C6A53]" : "text-[#8A2F2F]"}`}>{aviso.texto}</p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={BOTAO_CLARO} disabled={ocupado} onClick={() => visualizar()}>{acao === "previa" ? "Abrindo…" : "Prévia do visual"}</button>
        <button type="button" className={BOTAO_ESCURO} disabled={ocupado || !mudou} onClick={publicar}>{acao === "publicar" ? "Publicando…" : "Publicar visual"}</button>
      </div>
    </section>
  );
}
