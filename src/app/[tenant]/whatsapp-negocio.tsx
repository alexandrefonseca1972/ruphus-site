"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { idToken } from "@/lib/firebase";
import { celularDoDono, mascaraTelefoneBR, soDigitosComDDI } from "@/lib/telefone";
import { TIMEZONE } from "@/lib/datetime";
import { ATRASO_AVALIACAO_PADRAO, ATRASOS_AVALIACAO } from "@/lib/avaliacoes";
import { useTenantSeHouver } from "./painel-layout";
import { configurarAvaliacoesAction, configurarLembretesWhatsAppAction, definirWhatsAppDonoAction, lerWhatsAppDoNegocioAction, reenviarConfirmacaoDonoAction } from "./actions";

// Avisos pelo WhatsApp no painel do dono. Os avisos aos clientes e os pedidos de agendamento saem
// pelo número oficial da Ruphus (canal oficial): o dono só cadastra o WhatsApp pessoal, que recebe
// os pedidos, e confirma que é dele tocando "Sou eu" na mensagem que a Ruphus manda.

type Config = {
  canalOficial?: boolean;
  // a Ruphus pausou o WhatsApp pelo /admin: salvar o número não religa
  desligadoPelaRuphus?: boolean;
  ownerPhone?: string | null;
  ownerPhoneVerifiedAt?: number | null;
  remindersEnabled?: boolean;
  remindersBeforeHours?: number | null;
  avaliacoes?: { enabled: boolean; delayMin: number };
  // último aviso que não saiu (cota, número recusado…); some quando um aviso sai
  lastNotifyError?: { message: string; at: number } | null;
};
type Envio = "enviado" | "confirmado" | "aguarde" | "limite" | "falhou";

// memberAction devolve o payload direto no sucesso e { ok: false, error } na falha
type Falha = { ok: false; error: string };
const falhou = (r: unknown): r is Falha =>
  typeof r === "object" && r !== null && (r as { ok?: unknown }).ok === false;

// token que não vem (sessão caiu, sem rede) é falha como outra qualquer: o botão não pode ficar preso
const token = () => idToken().catch(() => null);
const SEM_REDE = "Sem conexão. Tente de novo.";

const AVISO_ENVIO: Record<Envio, { ok: boolean; texto: string }> = {
  enviado: { ok: true, texto: "Salvo. Mandamos uma mensagem para esse número: toque em Sou eu para confirmar." },
  confirmado: { ok: true, texto: "Salvo. Esse número já está confirmado." },
  aguarde: { ok: true, texto: "Salvo. Já mandamos a confirmação há pouco: espere alguns minutos para reenviar." },
  limite: { ok: false, texto: "Salvo, mas já mandamos 5 confirmações hoje. Tente reenviar amanhã." },
  falhou: { ok: false, texto: "Número salvo, mas a mensagem de confirmação não saiu agora. Toque em Reenviar daqui a pouco." },
};

export function WhatsAppNegocio({ slug, telefoneNegocio }: { slug: string; telefoneNegocio: string }) {
  // undefined = carregando; null = a leitura falhou
  const [cfg, setCfg] = useState<Config | null | undefined>(undefined);
  const [tentativa, setTentativa] = useState(0);
  const [fone, setFone] = useState("");
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [lembretes, setLembretes] = useState(false);
  const [horasLembretes, setHorasLembretes] = useState(2);
  const [avaliacoes, setAvaliacoes] = useState(false);
  const [atrasoAvaliacoes, setAtrasoAvaliacoes] = useState<number>(ATRASO_AVALIACAO_PADRAO);
  const tenant = useTenantSeHouver();
  // uma gravação de lembretes de cada vez: cliques rápidos em checkbox e hora não disputam, a última
  // fica. O último valor confirmado fica num ref: o estado do clique é velho quando a fila anda
  const filaLembretes = useRef<Promise<void>>(Promise.resolve());
  const filaAvaliacoes = useRef<Promise<void>>(Promise.resolve());
  const confirmado = useRef<{ on: boolean; hours: number } | null>(null);
  const avaliacoesConfirmadas = useRef<{ on: boolean; delay: number } | null>(null);

  useEffect(() => {
    let atual = true;
    (async () => {
      const t = await token();
      const r = t ? await lerWhatsAppDoNegocioAction(t, { tenantId: slug }).catch(() => null) : null;
      if (!atual) return;
      if (!r || falhou(r)) return setCfg(null);
      setCfg(r);
      setFone((r.ownerPhone ?? "").replace(/^55(?=\d{11}$)/, ""));
      setLembretes(r.remindersEnabled === true);
      setHorasLembretes(r.remindersBeforeHours ?? 2);
      setAvaliacoes(r.avaliacoes?.enabled === true);
      setAtrasoAvaliacoes(r.avaliacoes?.delayMin ?? ATRASO_AVALIACAO_PADRAO);
      confirmado.current = { on: r.remindersEnabled === true, hours: r.remindersBeforeHours ?? 2 };
      avaliacoesConfirmadas.current = { on: r.avaliacoes?.enabled === true, delay: r.avaliacoes?.delayMin ?? ATRASO_AVALIACAO_PADRAO };
    })();
    return () => {
      atual = false;
    };
  }, [slug, tentativa]);

  // a seção só ganha altura depois da leitura: o navegador já tentou o #whatsapp (push de aviso
  // não entregue) antes disso e ficou no topo
  const carregou = cfg !== undefined;
  useEffect(() => {
    if (carregou && window.location.hash === "#whatsapp") document.getElementById("whatsapp")?.scrollIntoView();
  }, [carregou]);

  async function rodar(chamar: (t: string) => Promise<{ envio: Envio; cfg: Config } | Falha>) {
    setBusy(true);
    setAviso(null);
    const t = await token();
    const r = t ? await chamar(t).catch(() => null) : null;
    setBusy(false);
    if (!r || falhou(r)) return setAviso({ ok: false, texto: r ? r.error : SEM_REDE });
    setCfg(r.cfg);
    setAviso(AVISO_ENVIO[r.envio]);
    // a agenda mostra as mensagens paradas do canal oficial sem recarregar
    if (tenant?.atualizar && !tenant.whatsapp?.canalOficial) tenant.atualizar({ whatsapp: { ...(tenant.whatsapp ?? {}), canalOficial: true } });
  }

  function salvar() {
    const v = celularDoDono(fone);
    if ("erro" in v) return setAviso({ ok: false, texto: v.erro });
    void rodar((t) => definirWhatsAppDonoAction(t, { tenantId: slug, telefone: fone }));
  }

  function usarDoNegocio() {
    const v = celularDoDono(telefoneNegocio);
    if ("erro" in v) return setAviso({ ok: false, texto: v.erro });
    setFone(v.numero.replace(/^55(?=\d{11}$)/, ""));
    void rodar((t) => definirWhatsAppDonoAction(t, { tenantId: slug, telefone: v.numero }));
  }

  function salvarLembretes(enabled: boolean, hours: number) {
    setAviso(null);
    filaLembretes.current = filaLembretes.current.then(async () => {
      const t = await token();
      const r = t ? await configurarLembretesWhatsAppAction(t, { tenantId: slug, enabled, hours }).catch(() => null) : null;
      if (!r || falhou(r)) {
        // nada foi gravado: a tela volta ao último valor que o servidor confirmou
        setAviso({ ok: false, texto: r ? r.error : SEM_REDE });
        setLembretes(confirmado.current?.on ?? false);
        setHorasLembretes(confirmado.current?.hours ?? 2);
        return;
      }
      confirmado.current = { on: enabled, hours };
    });
  }

  function salvarAvaliacoes(enabled: boolean, delayMin: number) {
    setAviso(null);
    filaAvaliacoes.current = filaAvaliacoes.current.then(async () => {
      const t = await token();
      const r = t ? await configurarAvaliacoesAction(t, { tenantId: slug, enabled, delayMin }).catch(() => null) : null;
      if (!r || falhou(r)) {
        setAviso({ ok: false, texto: r ? r.error : SEM_REDE });
        setAvaliacoes(avaliacoesConfirmadas.current?.on ?? false);
        setAtrasoAvaliacoes(avaliacoesConfirmadas.current?.delay ?? ATRASO_AVALIACAO_PADRAO);
        return;
      }
      avaliacoesConfirmadas.current = { on: enabled, delay: delayMin };
      setAviso({ ok: true, texto: enabled ? `Pedidos de avaliação ativados: saem ${delayMin} minutos após a conclusão.` : "Pedidos de avaliação desativados." });
    });
  }

  if (cfg === undefined) return <p id="whatsapp" className="text-sm text-muted-foreground lg:col-start-1">Carregando…</p>;

  if (cfg === null) {
    return (
      <section id="whatsapp" role="alert" className="grid scroll-mt-20 gap-3 rounded-2xl border bg-card p-5 sm:p-7 lg:col-start-1" aria-label="Avisos pelo WhatsApp">
        <h2 className="text-[15px] font-semibold">Avisos pelo WhatsApp</h2>
        <p className="text-sm text-muted-foreground">Não foi possível carregar a configuração do WhatsApp. Confira a internet e tente de novo.</p>
        <div>
          <Button type="button" variant="outline" onClick={() => (setCfg(undefined), setTentativa((n) => n + 1))} className="h-12 px-5 text-[15px] sm:h-11 sm:text-sm">Tentar de novo</Button>
        </div>
      </section>
    );
  }

  const dataConfirmacao = cfg.ownerPhoneVerifiedAt ? new Date(cfg.ownerPhoneVerifiedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: TIMEZONE }) : null;
  const numeroNegocio = soDigitosComDDI(telefoneNegocio);
  const mesmoNumero = !!numeroNegocio && numeroNegocio === soDigitosComDDI(cfg.ownerPhone ?? "");

  return (
    <section id="whatsapp" className="grid scroll-mt-20 gap-3 rounded-2xl border bg-card p-5 sm:p-7 lg:col-start-1" aria-label="Avisos pelo WhatsApp">
      <h2 className="text-[15px] font-semibold">Avisos pelo WhatsApp</h2>
      <p className="text-sm text-muted-foreground">
        Os avisos aos clientes e os pedidos de agendamento saem pelo número oficial da Ruphus. Você recebe os pedidos
        no seu WhatsApp pessoal e confirma ou recusa pelos botões da mensagem.
      </p>

      {cfg.desligadoPelaRuphus && (
        <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <span className="font-semibold">WhatsApp pausado pela Ruphus.</span> Nenhum aviso sai pelo WhatsApp (pedidos, confirmações, lembretes). Fale com o suporte para voltar.
        </p>
      )}

      {cfg.lastNotifyError?.message && (
        <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm [overflow-wrap:anywhere] text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <span className="font-semibold">Último aviso que não saiu</span>
          {cfg.lastNotifyError.at ? ` (${new Date(cfg.lastNotifyError.at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: TIMEZONE })})` : ""}: {cfg.lastNotifyError.message}
        </p>
      )}

      <form
        className="grid gap-1.5"
        onSubmit={(ev) => {
          ev.preventDefault();
          salvar();
        }}
      >
        <label htmlFor="zap-dono" className="text-sm font-medium">Seu WhatsApp (para receber os pedidos)</label>
        <div className="flex gap-2">
          <input
            id="zap-dono"
            inputMode="numeric"
            autoComplete="tel"
            value={mascaraTelefoneBR(fone)}
            maxLength={19}
            onChange={(e) => setFone(e.target.value.replace(/\D/g, ""))}
            placeholder="(91) 99999-0000"
            className="h-12 min-w-0 grow rounded-lg border border-input bg-card px-3 text-[15px] tabular-nums sm:h-11 sm:text-sm"
          />
          <Button type="submit" disabled={busy || cfg.desligadoPelaRuphus} className="h-12 px-5 text-[15px] sm:h-11 sm:text-sm">
            {busy ? "Salvando…" : "Salvar"}
          </Button>
        </div>
      </form>

      {numeroNegocio && (
        <div className="grid gap-1.5 rounded-lg border border-dashed p-3">
          <Button type="button" variant="outline" disabled={busy || cfg.desligadoPelaRuphus || mesmoNumero} onClick={usarDoNegocio} className="h-11 px-4 text-sm">
            {mesmoNumero ? "O WhatsApp do negócio recebe os pedidos" : "Usar o WhatsApp do negócio para receber pedidos"}
          </Button>
          <p className="text-xs leading-relaxed text-muted-foreground">Aproveita o contato já cadastrado em Meu negócio. A confirmação “Sou eu” continua necessária.</p>
        </div>
      )}

      {!cfg.ownerPhone ? (
        <p role="status" className="text-sm text-amber-800 dark:text-amber-200">Sem número cadastrado: os pedidos não chegam a você.</p>
      ) : dataConfirmacao ? (
        <p role="status" className="text-sm text-emerald-700 dark:text-emerald-300">Confirmado em {dataConfirmacao}.</p>
      ) : cfg.desligadoPelaRuphus ? null : !cfg.canalOficial ? (
        <p role="status" className="text-sm text-amber-800 dark:text-amber-200">Salve para receber pelo número da Ruphus.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <p role="status" className="text-sm text-amber-800 dark:text-amber-200">
            Aguardando confirmação: toque em <strong>Sou eu</strong> na mensagem que mandamos. Enquanto isso, os pedidos já chegam nesse número.
          </p>
          <Button type="button" variant="outline" disabled={busy} onClick={() => void rodar((t) => reenviarConfirmacaoDonoAction(t, { tenantId: slug }))} className="h-11 px-4 text-sm sm:h-11">
            Reenviar
          </Button>
        </div>
      )}

      {aviso && (
        <p role={aviso.ok ? "status" : "alert"} className={aviso.ok ? "text-sm text-emerald-700 dark:text-emerald-300" : "text-sm text-destructive"}>
          {aviso.texto}
        </p>
      )}

      {/* lembretes automáticos: o dono escolhe quantas horas antes; o job manda uma vez por agendamento */}
      <div className="grid gap-2 rounded-lg border p-3">
        <label className="flex min-h-11 items-center gap-2.5 text-sm font-medium">
          <input
            type="checkbox"
            className="size-5 accent-primary"
            checked={lembretes}
            onChange={(e) => {
              const v = e.target.checked;
              setLembretes(v);
              salvarLembretes(v, horasLembretes);
            }}
          />
          Lembrar os clientes antes do horário
        </label>
        {lembretes && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            Enviar
            <select
              aria-label="Quantas horas antes enviar o lembrete"
              value={horasLembretes}
              onChange={(e) => {
                const h = Number(e.target.value);
                setHorasLembretes(h);
                salvarLembretes(lembretes, h);
              }}
              className="h-11 rounded-lg border border-input bg-card px-2 tabular-nums sm:h-11"
            >
              {[1, 2, 3, 4, 6, 8, 12, 24].map((h) => (
                <option key={h} value={h}>
                  {h} {h === 1 ? "hora" : "horas"}
                </option>
              ))}
            </select>
            antes do horário de cada cliente
          </div>
        )}
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          Cada cliente com horário <strong>confirmado</strong> recebe um lembrete pelo WhatsApp uma vez, na hora
          marcada aqui em cima. Não envia entre 22h e 7h30 — quem vencer nesse intervalo recebe às 7h30. Cliente que
          ainda não foi confirmado não recebe.
        </p>
      </div>

      <div className="grid gap-3 rounded-lg border p-3">
        <label className="flex min-h-11 items-center gap-2.5 text-sm font-medium">
          <input
            type="checkbox"
            className="size-5 accent-primary"
            checked={avaliacoes}
            onChange={(e) => {
              const enabled = e.target.checked;
              setAvaliacoes(enabled);
              salvarAvaliacoes(enabled, atrasoAvaliacoes);
            }}
          />
          Pedir avaliação após concluir o atendimento
        </label>
        {avaliacoes && (
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            Enviar
            <select
              aria-label="Minutos após a conclusão para pedir avaliação"
              value={atrasoAvaliacoes}
              onChange={(e) => {
                const delay = Number(e.target.value);
                setAtrasoAvaliacoes(delay);
                salvarAvaliacoes(avaliacoes, delay);
              }}
              className="h-11 rounded-lg border border-input bg-card px-2 tabular-nums"
            >
              {ATRASOS_AVALIACAO.map((minutos) => <option key={minutos} value={minutos}>{minutos} minutos</option>)}
            </select>
            depois da conclusão
          </div>
        )}
        <p className="text-[11.5px] leading-relaxed text-muted-foreground">
          Uma mensagem por atendimento concluído na agenda ou no Caixa, somente para clientes que autorizaram os avisos e o pedido de avaliação no agendamento. O envio usa o saldo e a cota de mensagens.
        </p>
      </div>
    </section>
  );
}
