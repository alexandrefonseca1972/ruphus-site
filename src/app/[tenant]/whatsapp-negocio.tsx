"use client";

import { confirmar } from "@/components/confirmar";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { idToken } from "@/lib/firebase";
import { TERMO_WHATSAPP } from "@/lib/whatsapp-termo";
import { useTenantSeHouver } from "./painel-layout";
import {
  aceitarTermoWhatsAppAction,
  configurarLembretesWhatsAppAction,
  conectarWhatsAppDonoAction,
  desconectarWhatsAppDonoAction,
  lerWhatsAppDoNegocioAction,
  qrWhatsAppDonoAction,
  refreshWhatsAppStatusDonoAction,
} from "./actions";

// Configuração do WhatsApp do negócio no painel do dono. Espelha a gaveta do
// /admin, com a plataforma sempre acima: quando ela assume (ownerManaged false),
// aqui vira só leitura. Antes de habilitar, o dono aceita o termo de risco —
// é o registro de que ele foi avisado de que o canal pode ser bloqueado.

type Config = {
  instanceId?: string;
  phone?: string | null;
  status?: string;
  ownerManaged?: boolean;
  termsAcceptedAt?: number | null;
  remindersEnabled?: boolean;
  remindersBeforeHours?: number | null;
  conectadoEm?: number;
  // último aviso que não saiu (gateway fora, desconectado…); some quando um aviso sai
  lastNotifyError?: { message: string; at: number } | null;
};

// memberAction devolve o payload direto no sucesso e { ok: false, error } na falha
type Falha = { ok: false; error: string };
const falhou = (r: unknown): r is Falha =>
  typeof r === "object" && r !== null && (r as { ok?: unknown }).ok === false;

const ROTULO: Record<string, string> = {
  connected: "conectado",
  disconnected: "desconectado",
  qr: "aguardando o QR",
  created: "preparando…",
  paused: "pausado",
  banned: "banido pelo WhatsApp",
};
const rotulo = (s?: string) => (s ? (ROTULO[s] ?? s) : "não conectado");
// token que não vem (sessão caiu, sem rede) é falha como outra qualquer: o botão não pode ficar preso
const token = () => idToken().catch(() => null);
const POLL_MS = 4000;
const POLL_MAX_MS = 10 * 60_000; // o QR fica na tela por até 10 min; depois, o dono reabre

export function WhatsAppNegocio({ slug }: { slug: string }) {
  // undefined = carregando; null = a leitura falhou (não é "sem termo aceito")
  const [cfg, setCfg] = useState<Config | null | undefined>(undefined);
  const [tentativa, setTentativa] = useState(0);
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [li, setLi] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  // rascunho local dos lembretes, preso à conexão: quando a conexão muda (ou o
  // primeiro carregamento chega), o rascunho re-sincroniza no render — efeito
  // não serve aqui (brigaria com o que o dono está escolhendo no meio do poll)
  const [rascunhoLembretes, setRascunhoLembretes] = useState<{ id?: string; on: boolean; hours: number } | null>(null);
  if (cfg && rascunhoLembretes?.id !== cfg.instanceId) {
    setRascunhoLembretes({ id: cfg.instanceId, on: cfg.remindersEnabled === true, hours: cfg.remindersBeforeHours ?? 2 });
  }
  const lembretes = rascunhoLembretes?.on ?? false;
  const horasLembretes = rascunhoLembretes?.hours ?? 2;
  const setLembretes = (on: boolean) => setRascunhoLembretes((r) => ({ id: cfg?.instanceId, ...(r ?? { hours: 2 }), on }));
  const setHorasLembretes = (hours: number) => setRascunhoLembretes((r) => ({ id: cfg?.instanceId, on: r?.on ?? false, hours }));

  const conectado = cfg?.status === "connected";
  // a plataforma assumiu a gestão: painel do dono é só leitura
  const adminGerencia = cfg?.ownerManaged === false;

  // o painel guarda o negócio lido uma vez: o que esta tela descobre (reconectou, caiu) vale
  // na faixa "Seu WhatsApp desconectou" das outras páginas sem recarregar
  const tenant = useTenantSeHouver();
  useEffect(() => {
    // undefined = carregando; null = a leitura falhou (não é "sem WhatsApp"): não mexe na faixa
    if (!tenant?.atualizar || !cfg) return;
    const novo = { status: cfg?.status, instanceId: cfg?.instanceId, ownerManaged: cfg?.ownerManaged, conectadoEm: cfg?.conectadoEm };
    const atual = tenant.whatsapp ?? {};
    if ((Object.keys(novo) as (keyof typeof novo)[]).every((k) => novo[k] === atual[k])) return;
    // mantém o resto (canalOficial): o que esta tela não lê não pode sumir das outras
    tenant.atualizar({ whatsapp: { ...atual, ...novo } });
  }, [cfg, tenant]);

  useEffect(() => {
    let atual = true;
    (async () => {
      const t = await token();
      const r = t ? await lerWhatsAppDoNegocioAction(t, { tenantId: slug }).catch(() => null) : null;
      if (!atual) return;
      if (r && !falhou(r)) confirmado.current = { on: r.remindersEnabled === true, hours: r.remindersBeforeHours ?? 2 };
      setCfg(r && !falhou(r) ? r : null);
    })();
    return () => {
      atual = false;
    };
  }, [slug, tentativa]);

  // enquanto não conecta, pergunta ao gateway e renova o QR (ele expira): uma chamada por vez,
  // só com a aba visível, e por no máximo POLL_MAX_MS
  useEffect(() => {
    if (!cfg?.instanceId || conectado || adminGerencia) return;
    let vivo = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const inicio = Date.now();
    let emVoo = false;
    const tique = async () => {
      // voltar à aba no meio de um tique não abre uma segunda cadeia de polling
      if (!vivo || emVoo || Date.now() - inicio > POLL_MAX_MS) return;
      emVoo = true;
      if (!document.hidden) {
        const t = await token();
        const r = t ? await refreshWhatsAppStatusDonoAction(t, { tenantId: slug }).catch(() => null) : null;
        if (r && !falhou(r) && vivo) {
          setCfg(r);
          const q = await qrWhatsAppDonoAction(t!, { tenantId: slug }).catch(() => null);
          if (vivo) setQr(q && !falhou(q) && q.status === "qr" ? q.imagem : null);
        }
      }
      emVoo = false;
      if (vivo) timer = setTimeout(tique, POLL_MS);
    };
    timer = setTimeout(tique, POLL_MS);
    const aoVoltar = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void tique();
      }
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      vivo = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [slug, cfg?.instanceId, conectado, adminGerencia]);

  async function aceitarTermo() {
    setBusy(true);
    setAviso(null);
    const t = await token();
    const r = t ? await aceitarTermoWhatsAppAction(t, { tenantId: slug }).catch(() => null) : null;
    setBusy(false);
    if (!r || falhou(r)) return setAviso({ ok: false, texto: r ? r.error : "Sem conexão. Tente de novo." });
    // sem status: o selo diz "não conectado", não "desconectado" (nunca houve conexão)
    setCfg((c) => ({ phone: null, ...(c ?? {}), termsAcceptedAt: Date.now() }));
  }

  async function conectar() {
    setBusy(true);
    setAviso(null);
    const t = await token();
    const r = t ? await conectarWhatsAppDonoAction(t, { tenantId: slug }).catch(() => null) : null;
    setBusy(false);
    if (!r || falhou(r)) return setAviso({ ok: false, texto: r ? r.error : "Sem conexão. Tente de novo." });
    setCfg({ ...r });
    const q = await qrWhatsAppDonoAction(t!, { tenantId: slug }).catch(() => null);
    setQr(q && !falhou(q) && q.status === "qr" ? q.imagem : null);
  }

  async function desconectar() {
    if (!(await confirmar({ titulo: "Desconectar o WhatsApp do negócio?", texto: "O número sai do gateway e para de responder pela plataforma.", acao: "Desconectar" }))) return;
    setBusy(true);
    setAviso(null);
    const t = await token();
    const r = t ? await desconectarWhatsAppDonoAction(t, { tenantId: slug }).catch(() => null) : null;
    setBusy(false);
    if (falhou(r)) return setAviso({ ok: false, texto: r.error });
    if (!r) return setAviso({ ok: false, texto: "Sem conexão. Tente de novo." });
    setCfg((c) => (c ? { ...c, instanceId: undefined, phone: null, status: "disconnected" } : c));
    setQr(null);
    // o vínculo foi solto, mas o gateway não confirmou: o número pode seguir logado lá
    if (r === "desconectado-sem-confirmacao") {
      setAviso({ ok: false, texto: "Desconectado aqui, mas o gateway não confirmou a saída do número. Antes de conectar de novo, abra o WhatsApp, Aparelhos conectados, e saia da sessão da plataforma." });
    }
  }

  // uma gravação de cada vez: cliques rápidos em checkbox e hora não disputam, a última fica.
  // O último valor confirmado fica num ref: o `cfg` do clique é velho quando a fila anda
  const filaLembretes = useRef<Promise<void>>(Promise.resolve());
  const confirmado = useRef<{ on: boolean; hours: number } | null>(null);
  function salvarLembretes(enabled: boolean, hours: number) {
    setAviso(null);
    filaLembretes.current = filaLembretes.current.then(async () => {
      const t = await token();
      const r = t ? await configurarLembretesWhatsAppAction(t, { tenantId: slug, enabled, hours }).catch(() => null) : null;
      if (!r || falhou(r)) {
        // nada foi gravado: a tela volta ao último valor que o servidor confirmou
        setAviso({ ok: false, texto: r ? r.error : "Sem conexão. Tente de novo." });
        setLembretes(confirmado.current?.on ?? false);
        setHorasLembretes(confirmado.current?.hours ?? 2);
        return;
      }
      confirmado.current = { on: enabled, hours };
      setCfg((c) => (c ? { ...c, remindersEnabled: enabled, remindersBeforeHours: hours } : c));
    });
  }

  // antes só o /admin via: o dono não sabia que um aviso ou lembrete tinha falhado. Também antes do
  // termo: no canal oficial os avisos saem pela plataforma sem o dono ter aceitado o termo do número próprio
  const ultimoErro = cfg?.lastNotifyError?.message && (
    <p role="status" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm [overflow-wrap:anywhere] text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
      <span className="font-semibold">Último aviso que não saiu</span>
      {cfg.lastNotifyError.at ? ` (${new Date(cfg.lastNotifyError.at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })})` : ""}: {cfg.lastNotifyError.message}
    </p>
  );

  if (cfg === undefined) return <p id="whatsapp" className="text-sm text-muted-foreground lg:col-start-1">Carregando…</p>;

  // a leitura falhou: não é "sem termo aceito". Mostrar o termo aqui gravaria um aceite novo por
  // uma queda de rede
  if (cfg === null) {
    return (
      <section id="whatsapp" role="alert" className="grid scroll-mt-20 gap-3 rounded-2xl border bg-card p-5 sm:p-7 lg:col-start-1" aria-label="WhatsApp do negócio">
        <h2 className="text-[15px] font-semibold">WhatsApp do negócio</h2>
        <p className="text-sm text-muted-foreground">Não foi possível carregar a configuração do WhatsApp. Confira a internet e tente de novo.</p>
        <div>
          <Button type="button" variant="outline" onClick={() => (setCfg(undefined), setTentativa((n) => n + 1))} className="h-12 px-5 text-[15px] sm:h-11 sm:text-sm">Tentar de novo</Button>
        </div>
      </section>
    );
  }

  // 1) termo de risco antes de qualquer uso — é o que isenta a plataforma
  if (!cfg.termsAcceptedAt) {
    return (
      <section id="whatsapp" className="grid scroll-mt-20 gap-3 rounded-2xl border bg-card p-5 sm:p-7 lg:col-start-1" aria-label="WhatsApp do negócio">
        <h2 className="text-[15px] font-semibold">WhatsApp do negócio</h2>
        {ultimoErro}
        <div className="rounded-lg border bg-muted/40 px-3 py-2.5 text-[12.5px] leading-relaxed text-muted-foreground">
          <p className="mb-1.5 font-semibold text-foreground">{TERMO_WHATSAPP.titulo}</p>
          {TERMO_WHATSAPP.paragrafos.map((p) => (
            <p key={p.slice(0, 24)} className="mb-1.5">{p}</p>
          ))}
          <ul className="list-disc pl-4">
            {TERMO_WHATSAPP.itens.map((i) => (
              <li key={i.slice(0, 24)}>{i}</li>
            ))}
          </ul>
        </div>
        <label className="flex items-start gap-2.5 py-1 text-sm">
          <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-primary" checked={li} onChange={(e) => setLi(e.target.checked)} />
          Li e entendo que o WhatsApp pode bloquear o número a qualquer momento e que a plataforma não garante
          o funcionamento contínuo deste canal.
        </label>
        <div>
          <Button type="button" disabled={busy || !li} onClick={aceitarTermo} className="h-12 px-5 text-[15px] sm:h-11 sm:text-sm">
            {busy ? "Aceitando…" : "Aceitar e continuar"}
          </Button>
        </div>
        {aviso && (
          <p role="alert" className="text-sm text-destructive">{aviso.texto}</p>
        )}
      </section>
    );
  }

  return (
    <section id="whatsapp" className="grid scroll-mt-20 gap-3 rounded-2xl border bg-card p-5 sm:p-7 lg:col-start-1" aria-label="WhatsApp do negócio">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold">WhatsApp do negócio</h2>
        <span className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">{rotulo(cfg?.status)}</span>
      </div>

      {ultimoErro}

      {adminGerencia ? (
        <>
          <p className="text-sm text-muted-foreground">
            O WhatsApp do seu negócio é <strong>gerenciado pela plataforma</strong>. O número
            {cfg?.phone ? ` ${cfg.phone}` : ""} responde pelos clientes normalmente; para conectar, trocar ou
            desconectar, fale com o suporte.
          </p>
        </>
      ) : cfg?.instanceId ? (
        <>
          <p className="text-sm text-muted-foreground">
            {conectado
              ? `Número ${cfg.phone ?? ""} conectado. As mensagens dos clientes chegam pela plataforma e os avisos de
                 agendamento chegam em "Mensagens para você" deste número — responda CONFIRMADO ou RECUSAR lá.`
              : cfg.status === "disconnected"
                ? "A conexão caiu: lembretes e avisos de agendamento estão parados. Abra o WhatsApp do número, toque em Aparelhos conectados e leia o QR de novo:"
                : "Abra o WhatsApp do número, toque em Aparelhos conectados e leia o QR:"}
          </p>
          {qr && !conectado && (
            // eslint-disable-next-line @next/next/no-img-element -- QR em data URL vindo do gateway
            <img src={qr} alt="QR para conectar o WhatsApp do negócio" className="justify-self-start rounded-lg border bg-white p-2" />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={desconectar} className="h-12 px-5 text-[15px] sm:h-11 sm:text-sm">
              Desconectar
            </Button>
          </div>
          {conectado && (
            // lembretes automáticos: o dono escolhe quantas horas antes; o job manda uma vez por agendamento
            <div className="grid gap-2 rounded-lg border p-3">
              <label className="flex min-h-11 items-center gap-2.5 text-sm font-medium">
                <input
                  type="checkbox"
                  className="size-5 accent-primary"
                  checked={lembretes}
                  onChange={(e) => {
                    const v = e.target.checked;
                    setLembretes(v);
                    void salvarLembretes(v, horasLembretes);
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
                      void salvarLembretes(lembretes, h);
                    }}
                    className="h-11 rounded-lg border border-input bg-card px-2 tabular-nums sm:h-9"
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
                Cada cliente com horário <strong>confirmado</strong> recebe um lembrete pelo seu WhatsApp uma vez, na
                hora marcada aqui em cima. Não envia entre 22h e 7h30 — quem vencer nesse intervalo recebe às 7h30.
                Cliente que ainda não foi confirmado não recebe.
              </p>
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            Conecte o número do negócio para confirmar agendamentos e responder clientes pela plataforma, sem sair
            do WhatsApp de ninguém.
          </p>
          <div>
            <Button type="button" disabled={busy} onClick={conectar} className="h-12 px-5 text-[15px] sm:h-11 sm:text-sm">
              {busy ? "Conectando…" : "Conectar"}
            </Button>
          </div>
        </>
      )}

      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        Conexão como aparelho conectado, fora da API oficial: o WhatsApp pode limitar ou bloquear o número, e a
        Ruphus não garante o canal sempre disponível. Termo aceito
        {cfg?.termsAcceptedAt ? ` em ${new Date(cfg.termsAcceptedAt).toLocaleString("pt-BR")}.` : "."}
      </p>
      {aviso && (
        <p role={aviso.ok ? "status" : "alert"} className={aviso.ok ? "text-sm text-emerald-700 dark:text-emerald-300" : "text-sm text-destructive"}>
          {aviso.texto}
        </p>
      )}
    </section>
  );
}
