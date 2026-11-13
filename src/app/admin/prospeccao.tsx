"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { CHAVES_TEXTO, MARCADORES_TEXTO, preencherTexto, problemasDoTexto, ROTULO_TEXTO, semSaida, TEXTO_MAX, TEXTOS_PADRAO, type ChaveTexto, type TextosCrm } from "@/lib/crm-textos";
import { idToken as tokenAtual } from "@/lib/firebase";
import { problemasDaVariante, semMudanca, travada, type VarianteDoc } from "@/lib/prospeccao-biblioteca";
import { ANGULOS, NICHOS, preencher, type Angulo } from "@/lib/prospeccao-variantes";
import type { Escalado } from "@/lib/prospeccao-escalada.server";
import type { VarianteId } from "@/lib/tipos-marca";
import {
  aprovarRascunhoAction,
  duplicarVarianteAction,
  editarVarianteAction,
  gerarVariacoesAction,
  leadDaPreviaAction,
  limparEscaladaAction,
  listarEscaladosAction,
  lerVariantesAction,
  salvarTextosCrmAction,
  semearVariantesAction,
  statusVarianteAction,
} from "./prospeccao-actions";

const BOTAO = "inline-flex h-9 items-center justify-center rounded-[10px] px-3 text-xs font-semibold transition-colors";
const BOTAO_ESCURO = `${BOTAO} bg-[#17150F] text-white hover:bg-[#2C2920] disabled:opacity-50`;
const BOTAO_CLARO = `${BOTAO} border border-[#D8D2C6] bg-white text-[#17150F] hover:border-[#17150F] disabled:opacity-50`;
const MARCADORES = ["{oi}", "{prova}", "{nome}", "{site}"];
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");

type Resultado<T> = { ok: true; dados: T } | { ok: false; error: string };
type Marcadores = { oi: string; prova: string; nome: string; site: string };
const buscar = () => tokenAtual().then((tk) => lerVariantesAction(tk)).catch(() => null);

/** Aba Prospecção (F4): a biblioteca de variantes em prospeccaoVariantes, editada sem deploy. A regra
 *  (PARE, sem preço, sem link no primeiro contato, marcadores válidos, 320 caracteres, e a do produtor:
 *  sem grátis, @ ou link fora da lista) é a mesma do servidor (problemasDaVariante), a cada digitação. */
export function Prospeccao({ idToken, assinatura, textos, onTextos }: { idToken: string; assinatura: string; textos: TextosCrm; onTextos: (t: TextosCrm) => void }) {
  const [docs, setDocs] = useState<VarianteDoc[] | null>(null);
  const [fonte, setFonte] = useState<"firestore" | "codigo">("codigo");
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);

  const aplicar = useCallback((r: Awaited<ReturnType<typeof buscar>>) => {
    if (!r?.ok) return setAviso({ ok: false, texto: r?.error ?? "Não foi possível carregar as variantes." });
    setDocs(r.dados.docs);
    setFonte(r.dados.fonte);
  }, []);
  const carregar = async () => aplicar(await buscar());
  // a carga inicial falhou: "Tentar de novo" sem recarregar a página
  const [tentando, setTentando] = useState(false);
  async function tentarDeNovo() {
    setTentando(true);
    setAviso(null);
    await carregar();
    setTentando(false);
  }

  useEffect(() => {
    if (!idToken) return;
    let atual = true;
    buscar().then((r) => atual && aplicar(r));
    return () => {
      atual = false;
    };
  }, [idToken, aplicar]);

  /** Roda uma ação e recarrega a tabela; o erro do servidor aparece como está. */
  async function agir<T>(acao: (tk: string) => Promise<Resultado<T>>, ok: string) {
    setBusy(true);
    setAviso(null);
    const r = await tokenAtual().then(acao).catch(() => null);
    setBusy(false);
    if (!r?.ok) {
      setAviso({ ok: false, texto: r?.error ?? "Não foi possível concluir agora." });
      return null;
    }
    setAviso({ ok: true, texto: ok });
    await carregar();
    return r.dados;
  }

  const doc = docs?.find((d) => d.id === editando) ?? null;
  const noCodigo = fonte === "codigo";

  return (
    <section aria-label="Prospecção" className="flex flex-col gap-4 p-4 sm:p-5">
      <TextosDaGaveta assinatura={assinatura} textos={textos} onTextos={onTextos} />
      {/* o agente e a fila de envio estão desligados: nada daqui chega ao lead. Recolhido para o
          vendedor não editar o que não vale (o que ele envia são os textos acima) */}
      <details className="rounded-2xl border border-[#E2DDD3] px-4 py-3">
        <summary className="cursor-pointer text-[13px] font-semibold">
          Envio automático · desligado
          <span className="ml-2 font-normal text-[#6F6A5E]">variantes da fila e conversas do agente; não mudam o que o vendedor envia</span>
        </summary>
        <div className="mt-4 flex flex-col gap-4">
      <Escaladas idToken={idToken} />
      <div className="flex flex-col gap-1">
        <h2 className="font-[family-name:var(--fonte-serifa)] text-[22px] leading-none">Variantes da prospecção</h2>
        <p className="text-xs text-[#6F6A5E]">
          Editar uma variante que já tem envios cria outra versão e pausa a anterior: os números de cada texto ficam separados. As 2 do A/B da F1 (salão) não mudam aqui; duplique para testar outra.
        </p>
      </div>
      {noCodigo && docs && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#E7D6B4] bg-[#FBF3DC] px-3.5 py-2.5">
          <span className="text-[13px] text-[#7A5A2E]">A biblioteca ainda vem do código. Para editar, copie-a para o Firestore (não sobrescreve nada).</span>
          <button type="button" disabled={busy} className={BOTAO_ESCURO} onClick={() => agir((tk) => semearVariantesAction(tk), "Biblioteca copiada para o Firestore.")}>
            Copiar para o Firestore
          </button>
        </div>
      )}
      {!docs && !aviso && <p className="text-sm text-[#6F6A5E]">Carregando…</p>}
      {aviso && (
        <p role={aviso.ok ? "status" : "alert"} className={`flex flex-wrap items-center gap-2 text-xs ${aviso.ok ? "text-[#2C6A53]" : "text-[#8A2F2F]"}`}>
          {aviso.texto}
          {!docs && !aviso.ok && (
            <button type="button" disabled={tentando} className={BOTAO_CLARO} onClick={tentarDeNovo}>
              {tentando ? "Carregando…" : "Tentar de novo"}
            </button>
          )}
        </p>
      )}
      {docs && (
        <div className="overflow-x-auto rounded-2xl border border-[#E2DDD3] bg-white">
          <table className="w-full text-left text-xs tabular-nums">
            <thead className="text-[#6F6A5E]">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Variante</th>
                <th scope="col" className="px-3 py-2 font-medium">Ângulo</th>
                <th scope="col" className="px-3 py-2 font-medium">Status</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Envios</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Resposta</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Opt-out</th>
                <th scope="col" className="px-3 py-2 font-medium" title="Envio manual pelo wa.me e fila sem template aprovado: não há estado de template na Meta para mostrar">Meta</th>
                <th scope="col" className="px-3 py-2 font-medium"><span className="sr-only">Ações</span></th>
              </tr>
            </thead>
            <tbody>
              {NICHOS.map((nicho) => {
                const doNicho = docs.filter((d) => d.nicho === nicho);
                if (!doNicho.length) return null;
                return (
                  <Fragment key={nicho}>
                    <tr className="bg-[#F7F5F1]">
                      <th scope="rowgroup" colSpan={8} className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6F6A5E]">{nicho}</th>
                    </tr>
                    {doNicho
                      .sort((a, b) => a.etapa.localeCompare(b.etapa) || a.id.localeCompare(b.id))
                      .map((d) => {
                        // a mesma regra do servidor: fora dela, a linha avisa (o produtor não sorteia e ativar recusa)
                        const fora = problemasDaVariante(d);
                        return (
                        <tr key={d.id} className={`border-t border-[#EDEAE0] ${editando === d.id ? "bg-[#FBFAF8]" : ""}`}>
                          <td className="px-3 py-1.5">
                            <span className="font-medium">{d.etapa}</span> · {d.id}
                            {d.versao > 1 && <span className="text-[#6F6A5E]"> (v{d.versao}{d.versaoDe ? `, de ${d.versaoDe}` : ""})</span>}
                            {travada(d.id) && <span className="ml-1 rounded bg-[#EFEBE2] px-1 text-[10px]">A/B F1</span>}
                            {fora.length > 0 && (
                              <span title={fora.join("; ")} className="ml-1 rounded bg-[#F7EFEF] px-1 text-[10px] text-[#8A2F2F]">
                                fora da regra: {fora.join("; ")}
                              </span>
                            )}
                          </td>
                          <td className="px-3 py-1.5">{d.angulo}</td>
                          <td className={`px-3 py-1.5 ${d.status === "ativa" ? "text-[#1F5A3A]" : "text-[#8A2F2F]"}`}>{d.status}</td>
                          <td className="px-3 py-1.5 text-right">{d.enviados}</td>
                          <td className="px-3 py-1.5 text-right">{pct(d.respostas, d.enviados)}</td>
                          <td className="px-3 py-1.5 text-right">{pct(d.optouts, d.enviados)}</td>
                          <td className="px-3 py-1.5 text-[#6F6A5E]">não se aplica</td>
                          <td className="flex flex-wrap justify-end gap-1 px-3 py-1.5">
                            <button type="button" aria-label={`Editar ${d.id}`} disabled={busy || noCodigo || travada(d.id)} className={BOTAO_CLARO} onClick={() => setEditando(d.id)}>
                              Editar
                            </button>
                            <button
                              type="button"
                              aria-label={`${d.status === "ativa" ? "Pausar" : "Ativar"} ${d.id}`}
                              disabled={busy || noCodigo || travada(d.id)}
                              className={BOTAO_CLARO}
                              onClick={() => agir((tk) => statusVarianteAction(tk, d.id, d.status === "ativa" ? "pausada" : "ativa"), d.status === "ativa" ? "Variante pausada." : "Variante ativada.")}
                            >
                              {d.status === "ativa" ? "Pausar" : "Ativar"}
                            </button>
                            <button type="button" aria-label={`Duplicar ${d.id}`} disabled={busy || noCodigo} className={BOTAO_CLARO} onClick={() => agir((tk) => duplicarVarianteAction(tk, d.id), "Cópia criada, pausada.")}>
                              Duplicar
                            </button>
                          </td>
                        </tr>
                        );
                      })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {doc && <Editor key={doc.id} doc={doc} busy={busy} agir={agir} fechar={() => setEditando(null)} />}
        </div>
      </details>
    </section>
  );
}

const buscarEscalados = () => tokenAtual().then((tk) => listarEscaladosAction(tk)).catch(() => null);
const dataHora = (ms: number) => new Date(ms).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

/** Conversas que o agente escalou (M-4): ele fica calado nelas até alguém marcar como tratada. */
function Escaladas({ idToken }: { idToken: string }) {
  const [lista, setLista] = useState<Escalado[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tratando, setTratando] = useState<string | null>(null);

  const aplicar = useCallback((r: Awaited<ReturnType<typeof buscarEscalados>>) => {
    if (!r?.ok) return setErro(r?.error ?? "Não foi possível carregar as escaladas.");
    setErro(null);
    setLista(r.dados);
  }, []);

  useEffect(() => {
    if (!idToken) return;
    let atual = true;
    buscarEscalados().then((r) => atual && aplicar(r));
    return () => {
      atual = false;
    };
  }, [idToken, aplicar]);

  async function tratar(telefone: string) {
    setTratando(telefone);
    const r = await tokenAtual().then((tk) => limparEscaladaAction(tk, telefone)).catch(() => null);
    setTratando(null);
    if (!r?.ok) return setErro(r?.error ?? "Não foi possível marcar como tratada.");
    aplicar(await buscarEscalados());
  }

  return (
    <section aria-label="Conversas escaladas" className="flex flex-col gap-2">
      <h2 className="font-[family-name:var(--fonte-serifa)] text-[22px] leading-none">Conversas escaladas</h2>
      <p className="text-xs text-[#6F6A5E]">O agente fica calado nestas conversas. Marcar como tratada volta a deixá-lo responder.</p>
      {erro && (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-xs text-[#8A2F2F]">
          {erro}
          <button type="button" className={BOTAO_CLARO} onClick={async () => aplicar(await buscarEscalados())}>
            Tentar de novo
          </button>
        </p>
      )}
      {!lista && !erro && <p className="text-sm text-[#6F6A5E]">Carregando…</p>}
      {lista?.length === 0 && <p className="text-sm text-[#6F6A5E]">Nenhuma conversa escalada.</p>}
      {lista && lista.length > 0 && (
        <div role="alert" className="flex flex-col gap-2">
          <p className="text-[13px] font-medium text-[#8A2F2F]">
            {lista.length === 1 ? "1 conversa escalada espera atendimento." : `${lista.length} conversas escaladas esperam atendimento.`}
          </p>
          <ul className="flex flex-col gap-2">
            {lista.map((e) => (
              <li key={e.telefone} className="flex flex-col gap-1.5 rounded-xl border border-[#E7D6B4] bg-[#FBF3DC] px-3.5 py-2.5 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold tabular-nums">{e.telefoneMascarado}</span>
                  <span className="text-[#6F6A5E]">{e.slug ?? "slug não confirmado"}</span>
                  <span className="text-[#6F6A5E]">{dataHora(e.em)}</span>
                  <div className="grow" />
                  <button type="button" disabled={tratando !== null} aria-label={`Marcar ${e.telefoneMascarado} como tratada`} className={BOTAO_CLARO} onClick={() => tratar(e.telefone)}>
                    {tratando === e.telefone ? "Marcando…" : "Marcar como tratada"}
                  </button>
                </div>
                <p className="text-[#7A5A2E]">Motivo: {e.motivo}</p>
                {e.falas.length > 0 && (
                  <ul className="flex flex-col gap-0.5">
                    {e.falas.map((f, i) => (
                      <li key={i} className="whitespace-pre-wrap">
                        <span className="font-medium">{f.de === "lead" ? "Lead" : "Ruphus"}:</span> {f.texto}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Editor({
  doc,
  busy,
  agir,
  fechar,
}: {
  doc: VarianteDoc;
  busy: boolean;
  agir: <T>(acao: (tk: string) => Promise<Resultado<T>>, ok: string) => Promise<T | null>;
  fechar: () => void;
}) {
  // o que o admin ABRIU, congelado: a tabela recarrega por baixo (outra ação), e o servidor tem de
  // comparar com isto (VarianteMudou), não com o doc de agora
  const [base] = useState(() => ({ editadaEm: doc.editadaEm, texto: doc.texto, angulo: doc.angulo }));
  const [texto, setTexto] = useState(doc.texto);
  const [angulo, setAngulo] = useState<Angulo>(doc.angulo);
  const [buscandoLead, setBuscandoLead] = useState(false);
  const [slug, setSlug] = useState("");
  const [lead, setLead] = useState<{ slug: string; marcadores: Marcadores } | null>(null);
  const [erroLead, setErroLead] = useState<string | null>(null);
  // cada rascunho guarda o ângulo com que foi gerado: aprovar grava esse, não o do select de agora
  const [rascunhos, setRascunhos] = useState<{ texto: string; problemas: string[]; angulo: Angulo }[] | null>(null);

  // a mesma regra do servidor, a cada digitação (regex num texto curto: sem debounce)
  const problemas = problemasDaVariante({ ...doc, angulo, texto: texto.trim() });
  const desconhecidos = [...new Set(texto.match(/\{[^}]*\}?/g) ?? [])].filter((m) => !MARCADORES.includes(m));
  const previa = lead ? preencher({ ...doc, id: doc.id as VarianteId, angulo, texto }, lead.marcadores) : null;

  async function carregarLead() {
    setErroLead(null);
    setBuscandoLead(true);
    const r = await tokenAtual().then((tk) => leadDaPreviaAction(tk, doc.nicho, slug.trim())).catch(() => null);
    setBuscandoLead(false);
    if (!r?.ok) return setErroLead(r?.error ?? "Não foi possível carregar o lead.");
    if (!r.dados) return setErroLead(slug.trim() ? "Esse slug não existe, é inválido ou não tem nota no Google." : "Nenhum lead com nota no Google para a prévia.");
    setLead(r.dados);
  }

  return (
    <section aria-label={`Editar ${doc.id}`} className="flex flex-col gap-3 rounded-2xl border border-[#E2DDD3] bg-white p-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">
          {doc.nicho} · {doc.etapa} · {doc.id}
        </h3>
        <div className="grow" />
        <button type="button" className={BOTAO_CLARO} onClick={fechar}>
          Fechar
        </button>
      </div>
      {doc.enviados > 0 && <p className="text-xs text-[#7A5A2E]">Esta variante tem {doc.enviados} envios: salvar cria uma versão nova e pausa esta.</p>}
      <label className="flex flex-col gap-1 text-xs font-medium">
        Ângulo
        <select value={angulo} onChange={(e) => (setAngulo(e.target.value as Angulo), setRascunhos(null))} className="h-9 rounded-lg border border-[#D8D2C6] bg-white px-2 text-xs">
          {ANGULOS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor="variante-texto" className="text-xs font-medium">
        Texto <span className={`font-normal tabular-nums ${texto.trim().length > 320 ? "text-[#8A2F2F]" : "text-[#6F6A5E]"}`}>{texto.trim().length}/320</span>
      </label>
      <textarea
        id="variante-texto"
        value={texto}
        onChange={(e) => (setTexto(e.target.value), setRascunhos(null))}
        rows={5}
        aria-invalid={problemas.length > 0}
        aria-describedby="variante-problemas"
        className="w-full resize-y rounded-xl border border-[#D8D2C6] bg-[#FBFAF8] p-3 text-sm leading-relaxed outline-none focus:border-[#17150F] aria-[invalid=true]:border-[#8A2F2F]"
      />
      <p className="text-[11px] text-[#6F6A5E]">Marcadores: {MARCADORES.join(" ")} ({"{site}"} só depois do primeiro contato).</p>
      <ul id="variante-problemas" aria-live="polite" className="flex flex-col gap-0.5 text-xs text-[#8A2F2F]">
        {problemas.map((p) => (
          <li key={p}>{p}</li>
        ))}
        {desconhecidos.length > 0 && <li>Marcador inválido: {desconhecidos.join(", ")}</li>}
      </ul>
      <div className="flex flex-col gap-2 rounded-xl bg-[#F7F5F1] p-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-xs font-medium">
            Prévia com o lead (slug; vazio = o primeiro do nicho com nota)
            <input value={slug} onChange={(e) => setSlug(e.target.value)} className="h-9 rounded-lg border border-[#D8D2C6] bg-white px-2 text-xs" />
          </label>
          <button type="button" disabled={buscandoLead} className={BOTAO_CLARO} onClick={carregarLead}>
            {buscandoLead ? "Carregando…" : "Carregar lead"}
          </button>
        </div>
        {erroLead && <p role="alert" className="text-xs text-[#8A2F2F]">{erroLead}</p>}
        {previa && (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">
            <span className="block text-[11px] text-[#6F6A5E]">{lead?.slug}</span>
            {previa}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || problemas.length > 0 || semMudanca(base, { texto, angulo })}
          className={BOTAO_ESCURO}
          onClick={async () => {
            const r = await agir(
              (tk) => editarVarianteAction(tk, doc.id, { texto, angulo }, { editadaEm: base.editadaEm, texto: base.texto }),
              "Variante salva (com envios ou item na fila: versão nova, e a anterior pausada).",
            );
            if (r) fechar();
          }}
        >
          Salvar
        </button>
        <button
          type="button"
          disabled={busy}
          className={BOTAO_CLARO}
          onClick={async () => {
            setRascunhos(null);
            const usado = angulo;
            const r = await agir((tk) => gerarVariacoesAction(tk, { nicho: doc.nicho, etapa: doc.etapa, angulo: usado, texto }), "Rascunhos gerados: revise antes de aprovar.");
            if (r) setRascunhos(r.map((x) => ({ ...x, angulo: usado })));
          }}
        >
          Gerar variações com IA
        </button>
      </div>
      {rascunhos && (
        <div className="flex flex-col gap-2">
          <h4 className="text-xs font-medium">Rascunhos da IA (nada foi salvo)</h4>
          {rascunhos.map((r, i) => (
            <div key={i} className="flex flex-col gap-1 rounded-xl border border-[#E2DDD3] p-3">
              <p className="whitespace-pre-wrap text-sm">{r.texto}</p>
              {r.problemas.length > 0 && <p className="text-xs text-[#8A2F2F]">{r.problemas.join("; ")}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={busy || r.problemas.length > 0}
                  className={BOTAO_ESCURO}
                  onClick={async () => {
                    const ok = await agir((tk) => aprovarRascunhoAction(tk, { nicho: doc.nicho, etapa: doc.etapa, angulo: r.angulo, texto: r.texto }), "Rascunho aprovado: variante nova, pausada.");
                    if (ok) setRascunhos((x) => x?.filter((_, j) => j !== i) ?? null);
                  }}
                >
                  Aprovar e salvar (pausada)
                </button>
                <button type="button" className={BOTAO_CLARO} onClick={() => setRascunhos((x) => x?.filter((_, j) => j !== i) ?? null)}>
                  Descartar
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

const comPadrao = (t: TextosCrm): Record<ChaveTexto, string> => ({ ...TEXTOS_PADRAO, ...t });

/** As mensagens prontas da gaveta: o vendedor escreve do jeito dele e salva. O que ficar igual ao padrão
 *  não é gravado. A prévia usa um lead de exemplo; na gaveta, cada marcador leva o dado do lead aberto. */
function TextosDaGaveta({ assinatura, textos, onTextos }: { assinatura: string; textos: TextosCrm; onTextos: (t: TextosCrm) => void }) {
  const [rascunho, setRascunho] = useState(() => comPadrao(textos));
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const salvo = comPadrao(textos);
  const mudou = CHAVES_TEXTO.some((c) => rascunho[c].trim() !== salvo[c]);
  const invalido = CHAVES_TEXTO.some((c) => problemasDoTexto(rascunho[c]).length > 0);
  const quem = assinatura || "Seu nome";
  const exemplo = (c: ChaveTexto) =>
    preencherTexto(rascunho[c], {
      oi: `Oi, Ana! Aqui é ${quem}, da Ruphus.`,
      vendedor: quem,
      nome: "Studio Exemplo",
      prova: "Vi o Studio Exemplo no Google, com 4,8 ★ e 120 avaliações.",
      site: "studio-exemplo.ruphus.site",
      entrada: "R$ 0,00",
      mensal: "R$ 0,00",
      proposta: c === "proposta" ? "Proposta completa: (link da proposta)" : "",
    });

  async function salvar() {
    setBusy(true);
    setAviso(null);
    const r = await tokenAtual().then((tk) => salvarTextosCrmAction(tk, rascunho)).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setAviso({ ok: false, texto: r?.error ?? "Não foi possível salvar agora." });
    onTextos(r.dados);
    setRascunho(comPadrao(r.dados));
    setAviso({ ok: true, texto: "Textos salvos: já valem na gaveta." });
  }

  return (
    <section aria-label="Textos das mensagens" className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h2 className="font-[family-name:var(--fonte-serifa)] text-[22px] leading-none">Textos das mensagens</h2>
        <p className="text-xs text-[#6F6A5E]">
          É o texto que a gaveta deixa pronto para abrir no WhatsApp. O que estiver entre chaves vira o dado do lead:{" "}
          {Object.entries(MARCADORES_TEXTO).map(([m, oque]) => `{${m}} ${oque}`).join("; ")}.
        </p>
      </div>
      {CHAVES_TEXTO.map((c) => {
        const problemas = problemasDoTexto(rascunho[c]);
        const tamanho = rascunho[c].trim().length;
        return (
          <div key={c} className="flex flex-col gap-1.5 rounded-2xl border border-[#E2DDD3] bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor={`texto-${c}`} className="text-sm font-semibold">{ROTULO_TEXTO[c]}</label>
              {rascunho[c].trim() !== TEXTOS_PADRAO[c] && <span className="rounded bg-[#EFEBE2] px-1.5 py-0.5 text-[10px] font-semibold">personalizado</span>}
              <span className={`text-[11px] tabular-nums ${tamanho > TEXTO_MAX ? "text-[#8A2F2F]" : "text-[#6F6A5E]"}`}>{tamanho}/{TEXTO_MAX}</span>
              <div className="grow" />
              <button type="button" disabled={busy || rascunho[c] === TEXTOS_PADRAO[c]} className={BOTAO_CLARO} onClick={() => setRascunho((r) => ({ ...r, [c]: TEXTOS_PADRAO[c] }))}>
                Voltar ao padrão
              </button>
            </div>
            <textarea
              id={`texto-${c}`}
              value={rascunho[c]}
              onChange={(e) => (setRascunho((r) => ({ ...r, [c]: e.target.value })), setAviso(null))}
              rows={c === "proposta" || c === "boasVindas" ? 8 : 4}
              aria-invalid={problemas.length > 0}
              aria-describedby={`texto-${c}-avisos`}
              className="w-full resize-y rounded-xl border border-[#D8D2C6] bg-[#FBFAF8] p-3 text-sm leading-relaxed outline-none focus:border-[#17150F] aria-[invalid=true]:border-[#8A2F2F]"
            />
            <ul id={`texto-${c}-avisos`} aria-live="polite" className="flex flex-col gap-0.5 text-xs">
              {problemas.map((p) => (
                <li key={p} className="text-[#8A2F2F]">{p}</li>
              ))}
              {semSaida(c, rascunho[c]) && <li className="text-[#7A5A2E]">Aviso: sem uma saída fácil (ex.: &quot;se não fizer sentido, é só me avisar&quot;), quem não quer a mensagem tende a bloquear o número.</li>}
            </ul>
            <details className="text-xs">
              <summary className="w-fit cursor-pointer text-[#6F6A5E] underline underline-offset-2 hover:text-[#17150F]">Ver como fica</summary>
              <p className="mt-2 whitespace-pre-wrap rounded-xl bg-[#F7F5F1] p-3 text-sm leading-relaxed">{exemplo(c)}</p>
            </details>
          </div>
        );
      })}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy || !mudou || invalido} className={BOTAO_ESCURO} onClick={salvar}>
          {busy ? "Salvando…" : "Salvar textos"}
        </button>
        {aviso && <p role={aviso.ok ? "status" : "alert"} className={`text-xs ${aviso.ok ? "text-[#2C6A53]" : "text-[#8A2F2F]"}`}>{aviso.texto}</p>}
      </div>
    </section>
  );
}
