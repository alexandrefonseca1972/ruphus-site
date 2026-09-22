"use client";

import { useEffect, useState } from "react";
import { diaCurto, hojeISO } from "@/lib/crm-tipos";
import { formatBRL } from "@/lib/datetime";
import {
  cancelarCobranca,
  cobrar,
  cobrarMes,
  registrarEnvio,
  lerPixConfig,
  listarAtrasadas,
  listarCobrancasDo,
  marcarPaga,
  salvarPixConfig,
  type CobrancaEnviavel,
} from "./actions";

// Cobrança fica fora de page.tsx, que já passa de mil linhas. Duas telas: o
// histórico de um negócio na gaveta e o painel de atrasados no topo.

// Religado: agora o lote volta com a lista para enviar, uma a uma, pelo WhatsApp
const COBRAR_MES_LIGADO = true;

const BOTAO = "inline-flex h-11 items-center justify-center rounded-[10px] px-4 text-sm font-semibold transition-colors";
const ESCURO = `${BOTAO} bg-[#17150F] text-white hover:bg-[#2C2920]`;
const CLARO = `${BOTAO} border border-[#D8D2C6] bg-white text-[#17150F] hover:border-[#17150F]`;
const MENOR = "inline-flex h-9 items-center rounded-[8px] border border-[#D8D2C6] bg-white px-2.5 text-xs text-[#17150F] hover:border-[#17150F]";
const CAMPO = "h-11 rounded-[10px] border border-[#D8D2C6] bg-white px-3 text-sm text-[#17150F] outline-none focus:border-[#17150F]";

const SITUACAO: Record<CobrancaEnviavel["status"], { rotulo: string; cor: string }> = {
  aberta: { rotulo: "aberta", cor: "bg-[#F3EFE7] text-[#4A4639]" },
  paga: { rotulo: "paga", cor: "bg-[#EEF2F0] text-[#2C6A53]" },
  cancelada: { rotulo: "cancelada", cor: "bg-[#F1EFE4] text-[#8B8578]" },
};

const oque = (c: CobrancaEnviavel) => (c.tipo === "entrada" ? "Entrada" : (c.competencia ?? ""));

async function copiar(texto: string) {
  try {
    await navigator.clipboard.writeText(texto);
    return "Link copiado.";
  } catch {
    return "Não foi possível copiar o link aqui.";
  }
}

/** Histórico e geração de cobranças de um negócio, na gaveta. */
export function Cobrancas({ slug, idToken, aviso }: { slug: string; idToken: string; aviso: (m: string) => void }) {
  // Guardado com o slug de quem pediu: trocar de negócio na gaveta mostra
  // "carregando" em vez da lista do anterior, sem setState dentro do efeito.
  const [buscado, setBuscado] = useState<{ para: string; lista: CobrancaEnviavel[] } | null>(null);
  const lista = buscado?.para === slug ? buscado.lista : null;
  const setLista = (l: CobrancaEnviavel[]) => setBuscado({ para: slug, lista: l });
  const [ocupado, setOcupado] = useState("");
  const [baixando, setBaixando] = useState<{ id: string; valor: string; data: string } | null>(null);

  useEffect(() => {
    let vivo = true;
    listarCobrancasDo(idToken, slug).then((r) => vivo && setBuscado({ para: slug, lista: r.ok ? r.dados : [] }), () => {});
    return () => {
      vivo = false;
    };
  }, [idToken, slug]);

  async function gerar(tipo: "entrada" | "mensal") {
    setOcupado(tipo);
    const r = await cobrar(idToken, slug, tipo, null).finally(() => setOcupado(""));
    if (!r.ok) return aviso(r.error);
    setLista(r.dados);
    aviso(tipo === "entrada" ? "Cobrança da entrada pronta." : "Cobrança do mês pronta.");
  }

  async function darBaixa() {
    if (!baixando) return;
    const cents = Math.round(Number(baixando.valor) * 100);
    if (!cents || !baixando.data) return aviso("Informe o valor recebido e a data.");
    setOcupado(baixando.id);
    const r = await marcarPaga(idToken, baixando.id, cents, baixando.data).finally(() => setOcupado(""));
    if (!r.ok) return aviso(r.error);
    setBaixando(null);
    const nova = await listarCobrancasDo(idToken, slug);
    if (nova.ok) setLista(nova.dados);
    aviso("Baixa registrada.");
  }

  return (
    <section aria-label="Cobrança" className="flex flex-col gap-3 rounded-2xl border border-[#E2DDD3] p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-[15px] font-semibold">Cobrança</h3>
        <span className="font-[family-name:var(--font-geist-mono)] text-[10px] tracking-[0.1em] text-[#6F6A5E] uppercase">pix</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className={CLARO} disabled={!!ocupado} onClick={() => gerar("entrada")}>
          {ocupado === "entrada" ? "Gerando…" : "Cobrar entrada"}
        </button>
        <button type="button" className={ESCURO} disabled={!!ocupado} onClick={() => gerar("mensal")}>
          {ocupado === "mensal" ? "Gerando…" : "Cobrar mês atual"}
        </button>
      </div>

      {lista === null ? (
        <p className="text-sm text-[#6F6A5E]">Carregando…</p>
      ) : !lista.length ? (
        <p className="text-sm text-[#6F6A5E]">Nenhuma cobrança ainda. O valor vem do bloco Negócio.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[#EDEAE0]">
          {lista.map((c) => (
            <li key={c.id} className="flex flex-col gap-2 py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
                <span className="font-[family-name:var(--font-geist-mono)] text-[13px]">{oque(c)}</span>
                <span className="font-[family-name:var(--font-geist-mono)] text-[13px] font-medium">{formatBRL(c.valorCents)}</span>
                <span className="text-xs text-[#6F6A5E]">vence {diaCurto(c.vencimento)}</span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${SITUACAO[c.status].cor}`}>{SITUACAO[c.status].rotulo}</span>
                {c.pagoEm && <span className="text-xs text-[#2C6A53]">recebido {diaCurto(c.pagoEm)}</span>}
              </div>
              {c.status === "aberta" && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={MENOR} onClick={async () => aviso(await copiar(c.url))}>
                    Copiar link
                  </button>
                  {c.whatsapp && (
                    <a className={MENOR} href={c.whatsapp} target="_blank" rel="noreferrer">
                      WhatsApp
                    </a>
                  )}
                  <button
                    type="button"
                    className={MENOR}
                    onClick={() => setBaixando({ id: c.id, valor: (c.valorCents / 100).toString(), data: hojeISO() })}
                  >
                    Marcar paga
                  </button>
                  <button
                    type="button"
                    className={MENOR}
                    disabled={ocupado === c.id}
                    onClick={async () => {
                      setOcupado(c.id);
                      const r = await cancelarCobranca(idToken, c.id).finally(() => setOcupado(""));
                      if (!r.ok) return aviso(r.error);
                      const nova = await listarCobrancasDo(idToken, slug);
                      if (nova.ok) setLista(nova.dados);
                      aviso("Cobrança cancelada.");
                    }}
                  >
                    Cancelar
                  </button>
                </div>
              )}
              {baixando?.id === c.id && (
                <div className="flex flex-wrap items-end gap-2 rounded-[10px] bg-[#F7F5EF] p-2.5">
                  <label className="flex flex-col gap-1 text-xs text-[#6F6A5E]">
                    Recebido
                    <input
                      type="number"
                      step="0.01"
                      min={0}
                      className={`${CAMPO} w-28`}
                      value={baixando.valor}
                      onChange={(e) => setBaixando({ ...baixando, valor: e.target.value })}
                    />
                  </label>
                  <label className="flex flex-col gap-1 text-xs text-[#6F6A5E]">
                    Quando caiu
                    <input
                      type="date"
                      className={`${CAMPO} w-40`}
                      value={baixando.data}
                      max={hojeISO()}
                      onChange={(e) => setBaixando({ ...baixando, data: e.target.value })}
                    />
                  </label>
                  <button type="button" className={ESCURO} disabled={ocupado === c.id} onClick={darBaixa}>
                    {ocupado === c.id ? "Salvando…" : "Confirmar baixa"}
                  </button>
                  <button type="button" className={CLARO} onClick={() => setBaixando(null)}>
                    Deixar para depois
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Cobranças vencidas e ainda abertas. Tirar do ar continua sendo clique humano. */
export function Atrasadas({
  idToken,
  aviso,
  cortar,
}: {
  idToken: string;
  aviso: (m: string) => void;
  cortar: (slug: string) => void;
}) {
  const [lista, setLista] = useState<CobrancaEnviavel[]>([]);
  const [pix, setPix] = useState<{ chave: string; nome: string; cidade: string; whatsapp: string } | null>(null);
  const [semPix, setSemPix] = useState(false);
  const [rascunho, setRascunho] = useState({ chave: "", nome: "", cidade: "", whatsapp: "" });
  const [ocupado, setOcupado] = useState("");
  const [lote, setLote] = useState<{ mes: string; lista: CobrancaEnviavel[] } | null>(null);
  const [enviadas, setEnviadas] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!idToken) return;
    listarAtrasadas(idToken).then((r) => r.ok && setLista(r.dados), () => {});
    lerPixConfig(idToken).then((r) => {
      if (!r.ok) return;
      setSemPix(!r.dados);
      if (r.dados) {
        setPix(r.dados);
        setRascunho(r.dados);
      }
    }, () => {});
  }, [idToken]);

  const total = lista.reduce((s, c) => s + c.valorCents, 0);

  return (
    <section aria-label="Cobranças em atraso" className="flex flex-col gap-3 rounded-2xl border border-[#E2DDD3] bg-white p-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-semibold">Cobranças em atraso</h2>
        {!!lista.length && (
          <span className="font-[family-name:var(--font-geist-mono)] text-[13px] text-[#B4472F]">
            {lista.length} · {formatBRL(total)}
          </span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          className={`${CLARO} disabled:cursor-not-allowed disabled:opacity-50`}
          // Desligado por enquanto: gera as cobranças de todos sem uma lista para enviar
          // em seguida. Religar quando essa lista existir (COBRAR_MES_LIGADO = true).
          disabled={!COBRAR_MES_LIGADO || ocupado === "mes" || semPix}
          title={COBRAR_MES_LIGADO ? undefined : "Desativado por enquanto"}
          onClick={async () => {
            setOcupado("mes");
            const r = await cobrarMes(idToken).finally(() => setOcupado(""));
            if (!r.ok) return aviso(r.error);
            setEnviadas(new Set());
            setLote({ mes: r.dados.mes, lista: r.dados.lista });
            aviso(r.dados.geradas ? "" : "Nenhum negócio fechado com mensalidade cadastrada.");
          }}
        >
          {ocupado === "mes" ? "Gerando…" : "Cobrar o mês de todos"}
        </button>
      </div>

      {lote && lote.lista.length > 0 && (
        <LoteDoMes
          lote={lote}
          enviadas={enviadas}
          enviou={(c) => {
            setEnviadas((e) => new Set(e).add(c.id));
            registrarEnvio(idToken, c.slug, `Cobrança de ${lote.mes}`, c.nome).catch(() => {});
          }}
          fechar={() => setLote(null)}
        />
      )}

      {semPix && (
        <p role="alert" className="rounded-[10px] border border-[#E7C9BF] bg-[#FBF1EE] p-2.5 text-sm text-[#B4472F]">
          Cadastre a chave Pix da Ruphus antes de cobrar.
        </p>
      )}

      {!lista.length ? (
        <p className="text-sm text-[#6F6A5E]">Nada em atraso.</p>
      ) : (
        <ul className="flex flex-col divide-y divide-[#EDEAE0]">
          {lista.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
              <span className="text-sm font-medium">{c.nome}</span>
              <span className="font-[family-name:var(--font-geist-mono)] text-[13px]">{formatBRL(c.valorCents)}</span>
              <span className="text-xs text-[#B4472F]">atrasada desde {diaCurto(c.vencimento)}</span>
              <span className="flex-1" />
              {c.whatsapp && (
                <a className={MENOR} href={c.whatsapp} target="_blank" rel="noreferrer">
                  Cobrar no WhatsApp
                </a>
              )}
              <button type="button" className={MENOR} onClick={async () => aviso(await copiar(c.url))}>
                Copiar link
              </button>
              <button type="button" className={MENOR} onClick={() => cortar(c.slug)}>
                Tirar o site do ar
              </button>
            </li>
          ))}
        </ul>
      )}

      <details className="border-t border-[#EDEAE0] pt-3">
        <summary className="cursor-pointer text-sm text-[#6F6A5E]">
          Chave Pix da Ruphus{pix ? ` · ${pix.chave}` : ""}
        </summary>
        <div className="mt-3 flex flex-wrap items-end gap-2">
          {(
            [
              { campo: "chave", rotulo: "Chave Pix", largura: "w-56" },
              { campo: "nome", rotulo: "Recebedor", largura: "w-48" },
              { campo: "cidade", rotulo: "Cidade", largura: "w-36" },
              { campo: "whatsapp", rotulo: "WhatsApp da Ruphus", largura: "w-40" },
            ] as const
          ).map((c) => (
            <label key={c.campo} className="flex flex-col gap-1 text-xs text-[#6F6A5E]">
              {c.rotulo}
              <input
                className={`${CAMPO} ${c.largura}`}
                value={rascunho[c.campo]}
                onChange={(e) => setRascunho({ ...rascunho, [c.campo]: e.target.value })}
              />
            </label>
          ))}
          <button
            type="button"
            className={ESCURO}
            disabled={ocupado === "pix"}
            onClick={async () => {
              setOcupado("pix");
              const r = await salvarPixConfig(idToken, rascunho).finally(() => setOcupado(""));
              if (!r.ok) return aviso(r.error);
              setPix(rascunho);
              setSemPix(false);
              aviso("Chave Pix salva.");
            }}
          >
            {ocupado === "pix" ? "Salvando…" : "Salvar"}
          </button>
        </div>
        <p className="mt-2 text-xs text-[#6F6A5E]">
          É a chave que aparece no QR de todas as cobranças abertas. Nome e cidade vão no código sem acento e em maiúsculas.
        </p>
      </details>
    </section>
  );
}

/** O lote do mês: cada cobrança com o seu WhatsApp, e "enviar a próxima" para passar a lista em sequência. */
function LoteDoMes({
  lote,
  enviadas,
  enviou,
  fechar,
}: {
  lote: { mes: string; lista: CobrancaEnviavel[] };
  enviadas: Set<string>;
  enviou: (c: CobrancaEnviavel) => void;
  fechar: () => void;
}) {
  const total = lote.lista.reduce((s, c) => s + c.valorCents, 0);
  const proxima = lote.lista.find((c) => c.whatsapp && !enviadas.has(c.id));
  return (
    <section aria-labelledby="lote-t" className="overflow-hidden rounded-xl border border-[#E2DDD3]">
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#FBFAF8] p-3.5">
        <div>
          <h3 id="lote-t" className="font-[family-name:var(--fonte-serifa)] text-[22px] leading-none first-letter:uppercase">Mensalidade de {lote.mes}</h3>
          <p className="mt-1 text-xs text-[#6F6A5E]">
            {lote.lista.length} cobrança(s) · {enviadas.size} enviada(s) · {formatBRL(total)}
          </p>
        </div>
        <div className="flex gap-2">
          {proxima && (
            <a href={proxima.whatsapp!} target="_blank" rel="noreferrer" onClick={() => enviou(proxima)} className={`${BOTAO} bg-[#17150F] text-white hover:bg-[#2C2920]`}>
              Enviar a próxima
            </a>
          )}
          <button type="button" onClick={fechar} className={CLARO}>
            Fechar
          </button>
        </div>
      </div>
      <ol className="divide-y divide-[#EDEAE0]">
        {lote.lista.map((c) => (
          <li key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 px-3.5 py-2.5">
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{c.nome}</span>
              <span className="block truncate text-[11px] text-[#6F6A5E]">{c.telefone ? c.telefone : "sem telefone: copie o link"}</span>
            </span>
            <span className="font-[family-name:var(--font-geist-mono)] text-[13px] font-medium">{formatBRL(c.valorCents)}</span>
            {enviadas.has(c.id) ? (
              <span className="rounded-full bg-[#E7EEE9] px-2.5 py-1 text-[11px] font-semibold text-[#2C6A53]">Enviada</span>
            ) : c.whatsapp ? (
              <a href={c.whatsapp} target="_blank" rel="noreferrer" onClick={() => enviou(c)} className={`${BOTAO} h-9 bg-[#2C6A53] px-3 text-xs text-white hover:bg-[#245743]`}>
                Enviar
              </a>
            ) : (
              <button type="button" onClick={() => navigator.clipboard.writeText(c.url).then(() => enviou(c), () => {})} className={`${CLARO} h-9 px-3 text-xs`}>
                Copiar link
              </button>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
