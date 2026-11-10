"use client";

import { useEffect, useState } from "react";
import type { Conta, CreditoTela, saldosDosNegocios } from "@/lib/consumo-painel.server";
import { confirmar } from "@/components/confirmar";
import { centavos } from "@/lib/consumo-tela";
import { formatBRL } from "@/lib/datetime";
import { idToken as tokenAtual } from "@/lib/firebase";
import { ajustarSaldoAction, definirMensagensDoNegocioAction, mensagensDoNegocioAction, saldosDosNegociosAction } from "./actions";

const CAMPO = "h-11 rounded-[10px] border border-[#D8D2C6] bg-white px-3 text-base tabular-nums";
const BOTAO = "inline-flex h-11 items-center justify-center rounded-[10px] px-4 text-sm font-medium";
const BOTAO_ESCURO = `${BOTAO} bg-[#17150F] text-white hover:bg-[#2C2920] disabled:opacity-50`;
const BOTAO_LINHA = `${BOTAO} border border-[#D8D2C6] bg-white hover:bg-[#F6F3EC] disabled:opacity-50`;

const reais = (c: number | undefined) => (c === undefined ? "" : (c / 100).toFixed(2).replace(".", ","));
const dia = (ms: number) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" }).format(new Date(ms));

const ROTULO: Record<string, string> = { recarga: "Recarga", "boas-vindas": "Boas-vindas", ajuste: "Ajuste", consumo: "Consumo", estorno: "Devolução", aviso: "Aviso de saldo" };

/** Gaveta do negócio (aba Cobrança): saldo, cobrança e preço próprios, crédito manual e extrato. */
export function MensagensDoNegocio({ slug, token }: { slug: string; token: () => Promise<string> }) {
  const [dados, setDados] = useState<{ conta: Conta; extrato: CreditoTela[] } | null>(null);
  const [erro, setErro] = useState("");
  const [aviso, setAviso] = useState("");
  const [busy, setBusy] = useState(false);
  const [vez, setVez] = useState(0);
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [precos, setPrecos] = useState<{ whatsappUtilityCents: string; whatsappServiceCents: string; smsCents: string } | null>(null);

  useEffect(() => {
    let atual = true;
    token()
      .then((t) => mensagensDoNegocioAction(t, slug))
      .then(
        (r) => {
          if (!atual) return;
          if (!r.ok) return setErro(r.error);
          setDados(r.dados);
          const p = r.dados.conta.proprio.precos;
          setPrecos({ whatsappUtilityCents: reais(p?.whatsappUtilityCents), whatsappServiceCents: reais(p?.whatsappServiceCents), smsCents: reais(p?.smsCents) });
        },
        () => atual && setErro("Não foi possível ler as mensagens deste negócio."),
      );
    return () => {
      atual = false;
    };
  }, [slug, token, vez]);

  // baixa de recarga no bloco de cobranças acima: relê o saldo
  useEffect(() => {
    const reler = () => setVez((x) => x + 1);
    window.addEventListener("ruphus:cobranca-baixada", reler);
    return () => window.removeEventListener("ruphus:cobranca-baixada", reler);
  }, []);

  async function ajustar() {
    const v = centavos(valor);
    if (v === null || v === 0) return setAviso("Informe um valor diferente de zero, como 10,00 ou -5,00.");
    if (motivo.trim().length < 3) return setAviso("Informe o motivo do ajuste.");
    // o valor como foi entendido, antes de mexer no saldo de alguém
    if (!(await confirmar({ titulo: `${v > 0 ? "Creditar" : "Debitar"} ${formatBRL(Math.abs(v))}?`, texto: `No saldo de mensagens deste negócio, com o motivo "${motivo.trim()}". Aparece no extrato do dono.`, acao: v > 0 ? "Creditar" : "Debitar" }))) return;
    setBusy(true);
    setAviso("");
    const r = await ajustarSaldoAction(await token(), slug, v, motivo).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setAviso(r?.error ?? "Não foi possível ajustar agora.");
    setValor("");
    setMotivo("");
    setAviso(r.dados.saldoCents === null ? "Esse ajuste já tinha sido lançado." : `Lançado. Saldo agora: ${formatBRL(r.dados.saldoCents)}.`);
    setVez((x) => x + 1);
  }

  async function definir(o: { cobrar: boolean | null; precos: Record<string, number> | null }) {
    setBusy(true);
    setAviso("");
    const r = await definirMensagensDoNegocioAction(await token(), slug, o).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setAviso(r?.error ?? "Não foi possível salvar agora.");
    setAviso("Salvo.");
    setVez((x) => x + 1);
  }

  function salvarPrecos() {
    if (!precos) return;
    const p: Record<string, number> = {};
    for (const [k, t] of Object.entries(precos)) {
      if (!t.trim()) continue;
      const c = centavos(t);
      if (c === null || c < 0) return setAviso("Preço inválido: use reais com vírgula, como 0,05.");
      p[k] = c;
    }
    definir({ cobrar: dados?.conta.proprio.cobrar ?? null, precos: Object.keys(p).length ? p : null });
  }

  if (erro) return <p role="alert" className="text-sm text-[#8A2F2F]">{erro}</p>;
  if (!dados || !precos) return <p className="text-sm text-[#6F6A5E]">Carregando as mensagens…</p>;
  const { conta, extrato } = dados;
  const prev = conta.previsao;
  return (
    <section aria-label="Mensagens do negócio" className="flex flex-col gap-4 rounded-2xl border border-[#E2DDD3] bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-0.5">
          <h3 className="text-sm font-semibold">Mensagens pré-pagas</h3>
          <p className="text-xs text-[#6F6A5E]">
            {!conta.cobrar ? "Cobrança desligada para este negócio." : conta.modelo === "pospago" ? "Pós-pago: só registra o consumo." : conta.aberta ? "Conta aberta: o saldo desconta e bloqueia." : "Conta não aberta: só registra o consumo até um crédito abrir a conta."}
          </p>
        </div>
        <div className="grid justify-items-end">
          <span className={`text-2xl font-bold tabular-nums ${(conta.saldoCents ?? 0) <= 0 && conta.aberta ? "text-[#8A2F2F]" : ""}`}>{conta.saldoCents === null ? "—" : formatBRL(conta.saldoCents)}</span>
          {prev && conta.aberta && (
            <span className="text-xs text-[#6F6A5E]">
              {prev.nivel === "ok" ? "em dia" : prev.nivel === "atencao" ? "baixo" : "crítico"}
              {prev.diasRestantesEstimados !== null && ` · ${prev.diasRestantesEstimados > 90 ? "> 90 dias" : `~${prev.diasRestantesEstimados} dias`}`}
              {prev.mediaDiariaCents !== null && ` · ${formatBRL(prev.mediaDiariaCents)}/dia`}
            </span>
          )}
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium text-[#17150F]">Cobrar as mensagens deste negócio</legend>
        <div className="flex flex-wrap gap-2">
          {(
            [
              [null, "Segue o geral"],
              [true, "Cobrar"],
              [false, "Não cobrar (piloto, parceiro)"],
            ] as const
          ).map(([v, rotulo]) => (
            <button
              key={String(v)}
              type="button"
              disabled={busy}
              aria-pressed={conta.proprio.cobrar === v}
              onClick={() => definir({ cobrar: v, precos: conta.proprio.precos as Record<string, number> | null })}
              className={`${BOTAO} border ${conta.proprio.cobrar === v ? "border-[#17150F] bg-[#17150F] text-white" : "border-[#D8D2C6] bg-white hover:bg-[#F6F3EC]"} disabled:opacity-50`}
            >
              {rotulo}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium text-[#17150F]">Preço próprio (vazio: o geral, hoje {formatBRL(conta.precos.whatsappUtilityCents)} / {formatBRL(conta.precos.whatsappServiceCents)} / {formatBRL(conta.precos.smsCents)})</legend>
        <div className="flex flex-wrap items-end gap-2">
          {(
            [
              ["whatsappUtilityCents", "WhatsApp aviso"],
              ["whatsappServiceCents", "WhatsApp resposta"],
              ["smsCents", "SMS"],
            ] as const
          ).map(([k, rotulo]) => (
            <label key={k} className="grid gap-1 text-xs text-[#6F6A5E]">
              {rotulo}
              <input inputMode="decimal" placeholder="geral" value={precos[k]} onChange={(e) => setPrecos({ ...precos, [k]: e.target.value })} className={`${CAMPO} w-28`} />
            </label>
          ))}
          <button type="button" disabled={busy} onClick={salvarPrecos} className={BOTAO_LINHA}>
            Salvar preço
          </button>
        </div>
      </fieldset>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-xs font-medium text-[#17150F]">Crédito ou débito manual (cortesia, estorno, acordo, recarga paga sem crédito)</legend>
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-xs text-[#6F6A5E]">
            Valor (R$, negativo debita)
            <input inputMode="decimal" placeholder="10,00" value={valor} onChange={(e) => setValor(e.target.value)} className={`${CAMPO} w-32`} />
          </label>
          <label className="grid min-w-48 grow gap-1 text-xs text-[#6F6A5E]">
            Motivo (vai para o extrato do negócio)
            <input value={motivo} maxLength={200} onChange={(e) => setMotivo(e.target.value)} placeholder="Cortesia do piloto" className={`${CAMPO} w-full`} />
          </label>
          <button type="button" disabled={busy} onClick={ajustar} className={BOTAO_ESCURO}>
            {busy ? "Lançando…" : "Lançar"}
          </button>
        </div>
      </fieldset>
      {aviso && <p role="status" className="text-xs text-[#4A4639]">{aviso}</p>}

      <div className="grid gap-1">
        <h4 className="text-xs font-medium text-[#17150F]">Extrato</h4>
        {extrato.length === 0 ? (
          <p className="text-xs text-[#6F6A5E]">Nada lançado ainda.</p>
        ) : (
          <ul className="divide-y divide-[#EDE9E1] text-sm">
            {extrato.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 truncate">
                  {dia(c.em)} · {ROTULO[c.tipo] ?? c.tipo}
                  {c.motivo && c.tipo !== "aviso" && <span className="text-[#6F6A5E]"> · {c.motivo}</span>}
                </span>
                <span className="shrink-0 tabular-nums">
                  <span className={c.valorCents > 0 ? "text-[#2C6A53]" : ""}>{c.valorCents > 0 ? "+" : ""}{formatBRL(c.valorCents)}</span>
                  <span className="ml-2 text-xs text-[#8B8578]">{formatBRL(c.saldoAposCents)}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

type Saldo = Awaited<ReturnType<typeof saldosDosNegocios>>;

/** Ajustes › Mensagens: o saldo de cada negócio com conta aberta, os de saldo mais baixo primeiro. */
export function SaldosDosNegocios() {
  const [lista, setLista] = useState<Saldo | null>(null);
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);
  async function carregar() {
    setBusy(true);
    setErro("");
    const r = await tokenAtual().then((t) => saldosDosNegociosAction(t)).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setErro(r?.error ?? "Não foi possível ler os saldos.");
    setLista(r.dados);
  }
  const abertos = lista?.filter((n) => n.saldoCents !== null) ?? [];
  const total = abertos.reduce((t, n) => t + Math.max(0, n.saldoCents ?? 0), 0);
  const mes = lista?.reduce((t, n) => t + n.mesCents, 0) ?? 0;
  const msgs = lista?.reduce((t, n) => t + n.mesTotal, 0) ?? 0;
  return (
    <section aria-label="Saldo por negócio" className="flex flex-col gap-3 rounded-2xl border border-[#E2DDD3] bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid gap-0.5">
          <h3 className="text-sm font-semibold">Saldo por negócio</h3>
          <p className="text-xs text-[#6F6A5E]">Negócios com conta de mensagens aberta ou cobrança desligada. Lê um documento por negócio: só quando você pedir.</p>
        </div>
        <button type="button" disabled={busy} onClick={carregar} className={BOTAO_LINHA}>
          {busy ? "Lendo…" : lista ? "Atualizar" : "Ver saldos"}
        </button>
      </div>
      {erro && <p role="alert" className="text-xs text-[#8A2F2F]">{erro}</p>}
      {lista && (
        <>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div className="grid">
              <dt className="text-xs text-[#6F6A5E]">Mensagens no mês</dt>
              <dd className="font-semibold tabular-nums">{msgs.toLocaleString("pt-BR")}</dd>
            </div>
            <div className="grid">
              <dt className="text-xs text-[#6F6A5E]">Consumo no mês</dt>
              <dd className="font-semibold tabular-nums">{formatBRL(mes)}</dd>
            </div>
            <div className="grid">
              <dt className="text-xs text-[#6F6A5E]">Saldo em aberto (crédito não consumido)</dt>
              <dd className="font-semibold tabular-nums">{formatBRL(total)}</dd>
            </div>
          </dl>
          {lista.length === 0 ? (
            <p className="text-xs text-[#6F6A5E]">Nenhum negócio com conta aberta ainda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="border-b border-[#EDE9E1] text-left text-xs text-[#6F6A5E]">
                    <th className="py-2 pr-3 font-medium">Negócio</th>
                    <th className="py-2 pr-3 text-right font-medium">Saldo</th>
                    <th className="py-2 pr-3 font-medium">Situação</th>
                    <th className="py-2 text-right font-medium">Mês</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EDE9E1]">
                  {lista.map((n) => (
                    <tr key={n.slug}>
                      <td className="py-2 pr-3">{n.nome}</td>
                      <td className={`py-2 pr-3 text-right tabular-nums ${n.saldoCents !== null && n.saldoCents <= 0 ? "text-[#8A2F2F]" : ""}`}>{n.saldoCents === null ? "—" : formatBRL(n.saldoCents)}</td>
                      <td className="py-2 pr-3 text-xs">
                        {n.cobrar === false
                          ? "Cobrança desligada"
                          : n.saldoCents !== null && n.saldoCents <= 0
                            ? "Sem saldo"
                            : n.nivel === "ok"
                              ? "Em dia"
                              : `Baixo${n.avisadoEm ? ` · avisado ${dia(n.avisadoEm)}` : ""}`}
                      </td>
                      <td className="py-2 text-right tabular-nums">{formatBRL(n.mesCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
