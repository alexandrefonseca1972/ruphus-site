"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { idToken } from "@/lib/firebase";
import { TERMO_WHATSAPP } from "@/lib/whatsapp-termo";
import {
  aceitarTermoWhatsAppAction,
  configurarLembretesWhatsAppAction,
  conectarWhatsAppDonoAction,
  desconectarWhatsAppDonoAction,
  enviarWhatsAppAction,
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

export function WhatsAppNegocio({ slug }: { slug: string }) {
  const [cfg, setCfg] = useState<Config | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const [li, setLi] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [para, setPara] = useState("");
  const [mensagem, setMensagem] = useState("");
  const [busyEnvio, setBusyEnvio] = useState(false);
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

  useEffect(() => {
    let atual = true;
    (async () => {
      const r = await lerWhatsAppDoNegocioAction(await idToken(), { tenantId: slug }).catch(() => null);
      if (atual) setCfg(r && !falhou(r) ? r : null);
    })();
    return () => {
      atual = false;
    };
  }, [slug]);

  // enquanto não conecta, pergunta ao gateway de 4 em 4s e renova o QR (ele expira)
  useEffect(() => {
    if (!cfg?.instanceId || conectado || adminGerencia) return;
    const id = setInterval(async () => {
      const t = await idToken();
      const r = await refreshWhatsAppStatusDonoAction(t, { tenantId: slug }).catch(() => null);
      if (!r || falhou(r)) return;
      setCfg(r);
      const q = await qrWhatsAppDonoAction(t, { tenantId: slug }).catch(() => null);
      setQr(q && !falhou(q) && q.status === "qr" ? q.base64 : null);
    }, 4000);
    return () => clearInterval(id);
  }, [slug, cfg?.instanceId, conectado, adminGerencia]);

  async function aceitarTermo() {
    setBusy(true);
    setAviso(null);
    const r = await aceitarTermoWhatsAppAction(await idToken(), { tenantId: slug }).catch(() => null);
    setBusy(false);
    if (!r || falhou(r)) return setAviso({ ok: false, texto: r ? r.error : "Sem conexão. Tente de novo." });
    setCfg((c) => ({ phone: null, status: "disconnected", ...(c ?? {}), termsAcceptedAt: Date.now() }));
  }

  async function conectar() {
    setBusy(true);
    setAviso(null);
    const r = await conectarWhatsAppDonoAction(await idToken(), { tenantId: slug }).catch(() => null);
    setBusy(false);
    if (!r || falhou(r)) return setAviso({ ok: false, texto: r ? r.error : "Sem conexão. Tente de novo." });
    setCfg({ ...r });
    const q = await qrWhatsAppDonoAction(await idToken(), { tenantId: slug }).catch(() => null);
    setQr(q && !falhou(q) && q.status === "qr" ? q.base64 : null);
  }

  async function desconectar() {
    if (!window.confirm("Desconectar o WhatsApp do negócio? O número sai do gateway e para de responder pela plataforma.")) return;
    setBusy(true);
    setAviso(null);
    const r = await desconectarWhatsAppDonoAction(await idToken(), { tenantId: slug }).catch(() => null);
    setBusy(false);
    if (falhou(r)) return setAviso({ ok: false, texto: r.error });
    if (!r) return setAviso({ ok: false, texto: "Sem conexão. Tente de novo." });
    setCfg((c) => (c ? { ...c, instanceId: undefined, phone: null, status: "disconnected" } : c));
    setQr(null);
  }

  async function enviarTeste() {
    setBusyEnvio(true);
    setAviso(null);
    const r = await enviarWhatsAppAction(await idToken(), { tenantId: slug, phone: para, message: mensagem }).catch(() => null);
    setBusyEnvio(false);
    if (!r || falhou(r)) return setAviso({ ok: false, texto: r ? r.error : "Sem conexão. Tente de novo." });
    setAviso({ ok: true, texto: "Enviado pelo seu WhatsApp." });
    setMensagem("");
  }

  async function salvarLembretes(enabled: boolean, hours: number) {
    setAviso(null);
    const r = await configurarLembretesWhatsAppAction(await idToken(), { tenantId: slug, enabled, hours }).catch(() => null);
    if (falhou(r)) {
      setAviso({ ok: false, texto: r.error });
      setLembretes(cfg?.remindersEnabled === true);
      setHorasLembretes(cfg?.remindersBeforeHours ?? 2);
      return;
    }
    if (!r) setAviso({ ok: false, texto: "Sem conexão. Tente de novo." });
    setCfg((c) => (c ? { ...c, remindersEnabled: enabled, remindersBeforeHours: hours } : c));
  }

  if (cfg === undefined) return <p className="text-sm text-muted-foreground">Carregando…</p>;

  // 1) termo de risco antes de qualquer uso — é o que isenta a plataforma
  if (!cfg?.termsAcceptedAt) {
    return (
      <section className="grid gap-3 rounded-xl border bg-card p-4" aria-label="WhatsApp do negócio">
        <h2 className="text-[15px] font-semibold">WhatsApp do negócio</h2>
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
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={li} onChange={(e) => setLi(e.target.checked)} />
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
    <section className="grid gap-3 rounded-xl border bg-card p-4" aria-label="WhatsApp do negócio">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[15px] font-semibold">WhatsApp do negócio</h2>
        <span className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">{rotulo(cfg?.status)}</span>
      </div>

      {adminGerencia ? (
        <>
          <p className="text-sm text-muted-foreground">
            O WhatsApp do seu negócio é <strong>gerenciado pela plataforma</strong>. O número
            {cfg?.phone ? ` ${cfg.phone}` : ""} responde pelos clientes normalmente; para conectar, trocar ou
            desconectar, fale com o suporte.
          </p>
          {conectado && <TesteEnvio {...{ slug, para, setPara, mensagem, setMensagem, busyEnvio, enviarTeste }} />}
        </>
      ) : cfg?.instanceId ? (
        <>
          <p className="text-sm text-muted-foreground">
            {conectado
              ? `Número ${cfg.phone ?? ""} conectado. As mensagens dos clientes chegam pela plataforma e os avisos de
                 agendamento chegam em "Mensagens para você" deste número — responda CONFIRMADO ou RECUSAR lá.`
              : "Abra o WhatsApp do número, toque em Aparelhos conectados e leia o QR:"}
          </p>
          {qr && !conectado && (
            // eslint-disable-next-line @next/next/no-img-element -- PNG em base64 vindo do gateway
            <img src={`data:image/png;base64,${qr}`} alt="QR para conectar o WhatsApp do negócio" className="justify-self-start rounded-lg border bg-white p-2" />
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" disabled={busy} onClick={desconectar} className="h-12 px-5 text-[15px] sm:h-11 sm:text-sm">
              Desconectar
            </Button>
          </div>
          {conectado && (
            // lembretes automáticos: o dono escolhe quantas horas antes; o job manda uma vez por agendamento
            <div className="grid gap-2 rounded-lg border p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  className="h-4 w-4"
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
                    value={horasLembretes}
                    onChange={(e) => {
                      const h = Number(e.target.value);
                      setHorasLembretes(h);
                      void salvarLembretes(lembretes, h);
                    }}
                    className="h-9 rounded-lg border border-input bg-card px-2 tabular-nums"
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
          {conectado && <TesteEnvio {...{ slug, para, setPara, mensagem, setMensagem, busyEnvio, enviarTeste }} />}
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
        Integração por protocolo alternativo: o WhatsApp pode bloquear o número a qualquer momento e a plataforma
        não garante o funcionamento contínuo do canal. Termo aceito
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

function TesteEnvio(p: {
  slug: string;
  para: string;
  setPara: (v: string) => void;
  mensagem: string;
  setMensagem: (v: string) => void;
  busyEnvio: boolean;
  enviarTeste: () => void;
}) {
  return (
    <form
      noValidate
      className="grid gap-3 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        p.enviarTeste();
      }}
    >
      <p className="text-sm text-muted-foreground">Teste rápido: envia uma mensagem do número conectado.</p>
      <div className="grid gap-1.5">
        <Label htmlFor="zap-para">Para</Label>
        <Input
          id="zap-para"
          inputMode="numeric"
          value={p.para}
          maxLength={15}
          onChange={(e) => p.setPara(e.target.value.replace(/\D/g, ""))}
          placeholder="5511998887777"
          className="h-12 bg-card px-3.5 text-base sm:h-11 sm:text-[15px]"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="zap-msg">Mensagem</Label>
        <textarea
          id="zap-msg"
          value={p.mensagem}
          maxLength={1000}
          rows={3}
          placeholder="Escreva a mensagem…"
          onChange={(e) => p.setMensagem(e.target.value)}
          className="min-h-20 rounded-lg border border-input bg-card px-3.5 py-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:text-[15px]"
        />
      </div>
      <Button type="submit" disabled={p.busyEnvio || !p.para || !p.mensagem.trim()} className="h-12 px-5 text-[15px] sm:h-11 sm:text-sm">
        {p.busyEnvio ? "Enviando…" : "Enviar"}
      </Button>
    </form>
  );
}
