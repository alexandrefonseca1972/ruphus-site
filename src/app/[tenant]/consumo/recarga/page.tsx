"use client";

import Link from "next/link";
import QRCode from "qrcode";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { RECARGA_MAXIMA_CENTS, RECARGA_MINIMA_CENTS } from "@/lib/consumo";
import { centavos as lerCentavos, duracaoDoSaldo, mensagensNoSaldo } from "@/lib/consumo-tela";
import type { PainelConsumo } from "@/lib/consumo-painel.server";
import { formatBRL } from "@/lib/datetime";
import { idToken } from "@/lib/firebase";
import { useValores } from "@/lib/valores";
import { cn } from "@/lib/utils";
import { criarRecargaAction, pixDaRecargaAction } from "../../actions";
import { PageTitle } from "../../page-title";
import { useTenant } from "../../painel-layout";
import { diaCurto, Extrato, mesAtual, useConsumo } from "../extrato";

type Pix = { id: string; url: string; brCode: string | null; valorCents: number; bonusCents: number; vencimento: string; status: string };

const SEM_SALDO: Record<string, string> = {
  "pausar-clientes": "Você continua recebendo os pedidos de agendamento, e os clientes recebem o lembrete do dia. Os outros avisos aos clientes ficam pausados até a próxima recarga.",
  "pausar-tudo": "Só os pedidos de agendamento para você continuam chegando. Todos os avisos aos clientes ficam pausados até a próxima recarga.",
  negativo: "As mensagens continuam saindo por um tempo, e o saldo fica negativo até o limite combinado com a Ruphus. A próxima recarga desconta o que ficou negativo.",
};


export default function RecargaPage() {
  const tenant = useTenant();
  const { dados, erro, carregando, recarregar } = useConsumo(tenant.id, mesAtual(), true);
  if (!tenant.podeGerir) return <p className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">Só o dono ou um administrador do negócio recarrega as mensagens.</p>;
  return (
    <>
      <div className="grid gap-2">
        <Link href={`/${tenant.id}/consumo`} className="w-fit text-sm text-muted-foreground underline-offset-4 hover:underline">
          ← Consumo
        </Link>
        <PageTitle title="Saldo de mensagens" valores />
      </div>
      {erro ? (
        <div role="alert" className="grid gap-3 rounded-2xl border bg-card p-6 text-sm">
          <p>{erro}</p>
          <Button className="h-11 w-fit px-4" onClick={recarregar}>Tentar de novo</Button>
        </div>
      ) : carregando || !dados ? (
        <p role="status" className="text-sm text-muted-foreground">Carregando o saldo…</p>
      ) : (
        <Tela dados={dados} slug={tenant.id} />
      )}
    </>
  );
}

function Tela({ dados, slug }: { dados: PainelConsumo; slug: string }) {
  const { brl } = useValores();
  const { conta, pacotes } = dados;
  const preco = conta.precos.whatsappUtilityCents;
  const saldo = conta.saldoCents ?? 0;
  const prepago = conta.cobrar && conta.modelo === "prepago";
  // o indicado só vale se o pacote ainda está ativo (o admin pode ter desligado depois da previsão)
  // e só com consumo para basear a conta: sem média, "indicado para o seu mês" seria chute
  const indicado = conta.previsao?.mediaDiariaCents != null && pacotes.some((p) => p.id === conta.previsao?.pacoteIndicado?.id) ? conta.previsao?.pacoteIndicado?.id : undefined;
  const [escolha, setEscolha] = useState<string>(() => indicado ?? pacotes[1]?.id ?? pacotes[0]?.id ?? "outro");
  const [outro, setOutro] = useState("");
  const [pix, setPix] = useState<Pix | null>(null);
  // o Pix gerado aqui entra na lista de "aguardando" sem recarregar a tela
  const [abertas, setAbertas] = useState(dados.recargasAbertas);
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");
  const gastoMes = dados.doMes.custoCents;
  const dias = conta.previsao?.diasRestantesEstimados ?? null;
  const msgs = mensagensNoSaldo(saldo, preco);
  const ultima = conta.ultimaRecarga;
  const frase = [
    ...(msgs !== null ? [`Dá para cerca de ${msgs.toLocaleString("pt-BR")} mensagens de WhatsApp`] : []),
    ...(dias !== null ? [`${msgs !== null ? "ou " : "Dura "}${dias === 0 ? "menos de um dia" : dias > 90 ? "mais de 3 meses" : `uns ${duracaoDoSaldo(dias)}`} no seu ritmo`] : []),
  ];

  if (!prepago) {
    return (
      <p className="rounded-2xl border bg-card p-6 text-sm text-muted-foreground">
        {!conta.cobrar ? "As mensagens deste negócio estão incluídas no plano: não há saldo para recarregar." : "As mensagens deste negócio entram na mensalidade: não há saldo para recarregar."}
      </p>
    );
  }

  const pacote = pacotes.find((p) => p.id === escolha);
  const lido = lerCentavos(outro);
  const valorOutro = lido !== null && lido > 0 ? lido : null;
  const valor = pacote ? pacote.valorCents : valorOutro;
  const credito = pacote ? pacote.valorCents + pacote.bonusCents : (valorOutro ?? 0);
  const outroInvalido = escolha === "outro" && outro !== "" && (valorOutro === null || valorOutro < RECARGA_MINIMA_CENTS || valorOutro > RECARGA_MAXIMA_CENTS);

  async function gerar() {
    if (busy) return;
    if (!pacote && (valorOutro === null || valorOutro < RECARGA_MINIMA_CENTS)) return setErro(`A recarga mínima é de ${formatBRL(RECARGA_MINIMA_CENTS)}.`);
    if (!pacote && valorOutro! > RECARGA_MAXIMA_CENTS) return setErro(`A recarga máxima é de ${formatBRL(RECARGA_MAXIMA_CENTS)}.`);
    setBusy(true);
    setErro("");
    const r = await idToken()
      .then((t) => criarRecargaAction(t, { tenantId: slug, pedido: pacote ? { pacoteId: pacote.id } : { valorCents: valorOutro! } }))
      .catch(() => null);
    setBusy(false);
    if (!r?.ok) return setErro(r?.error ?? "Não foi possível gerar o Pix agora. Tente de novo.");
    setPix(r);
    setAbertas((l) => (l.some((x) => x.id === r.id) ? l : [{ id: r.id, valorCents: r.valorCents, vencimento: r.vencimento }, ...l]));
  }

  async function abrir(id: string) {
    setBusy(true);
    setErro("");
    const r = await idToken().then((t) => pixDaRecargaAction(t, { tenantId: slug, id })).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setErro(r?.error ?? "Não foi possível abrir este Pix.");
    setPix(r);
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1fr] lg:items-start">
      <div className="grid gap-5">
        <section aria-label="Saldo" className="flex flex-col gap-2 rounded-2xl border border-zinc-900 bg-zinc-900 p-5 text-white dark:border-zinc-700">
          <span className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">Saldo disponível</span>
          <span className={cn("text-4xl leading-none font-bold tracking-tight tabular-nums", saldo <= 0 && "text-red-300")}>{brl(saldo)}</span>
          {frase.length > 0 && <span className="text-sm text-zinc-300">{frase.join(", ")}{gastoMes > 0 ? ` (${brl(gastoMes)} este mês)` : ""}.</span>}
          {ultima && ultima.saldoAposCents > 0 && (
            <>
              <div aria-hidden="true" className="mt-1 h-2 overflow-hidden rounded-full bg-white/15">
                <i className="block h-full rounded-full bg-emerald-400" style={{ width: `${Math.max(0, Math.min(100, (saldo / ultima.saldoAposCents) * 100))}%` }} />
              </div>
              <span className="text-xs text-zinc-400">
                Resta {Math.max(0, Math.min(100, Math.round((saldo / ultima.saldoAposCents) * 100)))}% do saldo depois do último crédito ({brl(ultima.valorCents)} em {diaCurto(ultima.em)})
              </span>
            </>
          )}
        </section>

        {pix ? (
          <PixNaTela pix={pix} saldo={saldo} onVoltar={() => setPix(null)} />
        ) : (
          <section aria-labelledby="recarregar" className="flex flex-col gap-4 rounded-2xl border bg-card p-5">
            <div className="grid gap-1">
              <h2 id="recarregar" className="font-semibold">Recarregar</h2>
              <p className="text-[13px] text-muted-foreground">Pagamento por Pix. O saldo entra quando a Ruphus confirma o pagamento, e o crédito não vence.</p>
            </div>
            <fieldset className="grid gap-2.5">
              <legend className="sr-only">Valor da recarga</legend>
              {pacotes.map((p) => {
                const bonus = p.bonusCents ? Math.round((p.bonusCents / p.valorCents) * 100) : 0;
                const n = mensagensNoSaldo(p.valorCents + p.bonusCents, preco);
                return (
                  <label key={p.id} className={cn("flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3", escolha === p.id ? "border-foreground ring-1 ring-foreground" : "hover:bg-muted/50")}>
                    <input type="radio" name="pacote" value={p.id} checked={escolha === p.id} onChange={() => setEscolha(p.id)} className="size-4 accent-foreground" />
                    <span className="grid grow">
                      <span className="font-semibold tabular-nums">
                        {brl(p.valorCents)}
                        {bonus > 0 && <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">+{bonus}%</span>}
                        {indicado === p.id && <span className="ml-2 text-xs font-medium text-muted-foreground">indicado para o seu mês</span>}
                      </span>
                      <span className="text-[13px] text-muted-foreground">
                        crédito {brl(p.valorCents + p.bonusCents)}
                        {n !== null && ` · ≈ ${n.toLocaleString("pt-BR")} mensagens`}
                      </span>
                    </span>
                  </label>
                );
              })}
              <label className={cn("flex min-h-14 cursor-pointer flex-wrap items-center gap-3 rounded-xl border px-4 py-3", escolha === "outro" ? "border-foreground ring-1 ring-foreground" : "hover:bg-muted/50")}>
                <input type="radio" name="pacote" value="outro" checked={escolha === "outro"} onChange={() => setEscolha("outro")} className="size-4 accent-foreground" />
                <span className="font-semibold">Outro valor</span>
                <span className="ml-auto flex items-center gap-1.5">
                  <span className="text-sm text-muted-foreground">R$</span>
                  <input
                    inputMode="decimal"
                    aria-label="Outro valor, em reais"
                    aria-invalid={outroInvalido || undefined}
                    aria-describedby="outro-ajuda"
                    placeholder="30,00"
                    value={outro}
                    onFocus={() => setEscolha("outro")}
                    onChange={(e) => setOutro(e.target.value.replace(/[^\d,.]/g, "").slice(0, 10))}
                    className="h-11 w-28 rounded-lg border bg-background px-3 text-right text-base tabular-nums aria-invalid:border-destructive"
                  />
                </span>
                <span id="outro-ajuda" className={cn("w-full text-xs", outroInvalido ? "text-destructive" : "text-muted-foreground")}>
                  De {formatBRL(RECARGA_MINIMA_CENTS)} a {formatBRL(RECARGA_MAXIMA_CENTS)}, sem bônus.
                </span>
              </label>
            </fieldset>
            {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
            <Button className="h-12 text-base" disabled={busy || !valor || outroInvalido} onClick={gerar}>
              {busy ? "Gerando o Pix…" : valor ? `Gerar Pix de ${formatBRL(valor)}` : "Escolha um valor"}
            </Button>
            {credito > 0 && <p className="text-[13px] text-muted-foreground">O saldo sobe para {brl(saldo + credito)} depois da confirmação. Recibo por e-mail.</p>}
          </section>
        )}

        {abertas.length > 0 && !pix && (
          <section aria-label="Pix aguardando confirmação" className="grid gap-2 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
            <strong>Pix aguardando confirmação</strong>
            <p className="text-[13px]">Já pagou? O saldo entra quando a Ruphus confirmar. Se ainda não pagou, abra o Pix de novo:</p>
            <ul className="grid gap-1.5">
              {abertas.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span className="tabular-nums">
                    {formatBRL(r.valorCents)} · vence {r.vencimento.slice(8, 10)}/{r.vencimento.slice(5, 7)}
                  </span>
                  <Button variant="outline" className="h-11 bg-white px-3 dark:bg-transparent" disabled={busy} onClick={() => abrir(r.id)}>
                    Abrir o Pix
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      <div className="grid gap-5">
        <section aria-labelledby="extrato" className="flex flex-col gap-3 rounded-2xl border bg-card p-5">
          <h2 id="extrato" className="font-semibold">Extrato</h2>
          <Extrato creditos={dados.creditos} limite={12} />
        </section>
        <section aria-labelledby="se-acabar" className="grid gap-1.5 rounded-2xl border bg-card p-5 text-sm">
          <h2 id="se-acabar" className="font-semibold">Se o saldo acabar</h2>
          <p className="text-muted-foreground">
            {SEM_SALDO[conta.semSaldo]} Avisamos quando o saldo ficar abaixo de {brl(conta.avisoSaldoCents)} ou perto de acabar.
          </p>
        </section>
      </div>
    </div>
  );
}

function PixNaTela({ pix, saldo, onVoltar }: { pix: Pix; saldo: number; onVoltar: () => void }) {
  const [svg, setSvg] = useState("");
  const [copiado, setCopiado] = useState(false);
  useEffect(() => {
    if (!pix.brCode) return;
    let atual = true;
    QRCode.toString(pix.brCode, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).then((s) => atual && setSvg(s), () => {});
    return () => {
      atual = false;
    };
  }, [pix.brCode]);
  async function copiar() {
    if (!pix.brCode) return;
    try {
      await navigator.clipboard.writeText(pix.brCode);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      setCopiado(false);
    }
  }
  return (
    <section aria-labelledby="pix" className="flex flex-col items-center gap-3 rounded-2xl border bg-card p-5 text-center">
      <h2 id="pix" className="font-semibold">
        Pix de {formatBRL(pix.valorCents)}
        {pix.bonusCents > 0 && <span className="font-normal text-muted-foreground"> · + {formatBRL(pix.bonusCents)} de bônus</span>}
      </h2>
      {pix.status !== "aberta" ? (
        <p className="text-sm text-muted-foreground">{pix.status === "paga" ? "Este Pix já foi confirmado." : "Este Pix foi cancelado."}</p>
      ) : pix.brCode ? (
        <>
          {/* o SVG vem da biblioteca de QR a partir do código Pix montado no servidor */}
          <div className="size-56 rounded-xl bg-white p-2 [&>svg]:size-full" role="img" aria-label="QR code do Pix" dangerouslySetInnerHTML={{ __html: svg }} />
          <Button className="h-12 w-full max-w-xs text-base" onClick={copiar}>
            {copiado ? "Código copiado ✓" : "Copiar código Pix"}
          </Button>
          <p aria-live="polite" className="text-[13px] text-muted-foreground">
            Vence em {pix.vencimento.slice(8, 10)}/{pix.vencimento.slice(5, 7)}. Depois que a Ruphus confirmar o pagamento, o saldo sobe para{" "}
            <strong className="text-foreground">{formatBRL(saldo + pix.valorCents + pix.bonusCents)}</strong>.
          </p>
        </>
      ) : (
        <p className="text-sm">
          O código Pix não pôde ser montado aqui.{" "}
          <a href={pix.url} target="_blank" rel="noreferrer" className="underline underline-offset-4">
            Abra a página do Pix
          </a>
          .
        </p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        <a href={pix.url} target="_blank" rel="noreferrer" className="inline-flex h-11 items-center rounded-lg border px-3.5 text-sm font-medium hover:bg-muted">
          Abrir a página do Pix
        </a>
        <Button variant="ghost" className="h-11 px-3.5" onClick={onVoltar}>
          Escolher outro valor
        </Button>
      </div>
    </section>
  );
}
