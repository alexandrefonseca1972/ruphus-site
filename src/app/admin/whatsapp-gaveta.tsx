"use client";

import { confirmar } from "@/components/confirmar";
import { useEffect, useState } from "react";
import { celularDoDono, mascaraTelefoneBR } from "@/lib/telefone";
import { definirCanalOficial, definirWhatsAppDonoOficial, reenviarConfirmacaoDonoOficial, whatsappDoNegocio, type WhatsAppNaGaveta } from "./actions";

// Aba "WhatsApp" da gaveta: o canal oficial do negócio (avisos pelo número da plataforma Ruphus).
// O suporte vê o WhatsApp pessoal do dono, se ele já tocou "Sou eu", liga ou desliga o canal e
// troca o número do dono quando ele pede (o mesmo cadastro do painel, que reenvia o "Sou eu").

const BOTAO = "inline-flex h-11 items-center justify-center rounded-[10px] px-4 text-[13px] font-semibold transition-colors disabled:opacity-60";
const BOTAO_CLARO = `${BOTAO} border border-[#D8D2C6] bg-white text-[#17150F] hover:border-[#17150F]`;
const BOTAO_ESCURO = `${BOTAO} bg-[#17150F] text-white hover:bg-[#2E2B22]`;

type Envio = "enviado" | "confirmado" | "aguarde" | "limite" | "falhou";
const AVISO_ENVIO: Record<Envio, { ok: boolean; texto: string }> = {
  enviado: { ok: true, texto: "Salvo. O \"Sou eu\" foi mandado ao número do dono." },
  confirmado: { ok: true, texto: "Salvo. Esse número já está confirmado." },
  aguarde: { ok: true, texto: "O \"Sou eu\" foi mandado há menos de 10 minutos: espere para reenviar." },
  limite: { ok: false, texto: "Já foram mandadas 5 confirmações hoje para este negócio. Tente amanhã." },
  falhou: { ok: false, texto: "A mensagem de confirmação não saiu agora. Tente reenviar daqui a pouco." },
};

const SEM_REDE = "Sem conexão. Tente de novo.";
// no horário de Brasília, como o resto do admin: o navegador de quem atende pode estar em outro fuso
const data = (ms: number) => new Date(ms).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

export function WhatsAppDoNegocio({ slug, token }: { slug: string; token: () => Promise<string> }) {
  // undefined = carregando; null = a leitura falhou
  const [cfg, setCfg] = useState<WhatsAppNaGaveta | null | undefined>(undefined);
  const [fone, setFone] = useState("");
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);

  useEffect(() => {
    let atual = true;
    (async () => {
      const r = await whatsappDoNegocio(await token(), slug).catch(() => null);
      if (!atual) return;
      if (!r?.ok) return setCfg(null);
      setCfg(r.dados);
      setFone((r.dados.ownerPhone ?? "").replace(/^55(?=\d{11}$)/, ""));
    })();
    return () => {
      atual = false;
    };
    // um negócio por montagem: a gaveta remonta com key={slug}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  async function canal(ligado: boolean) {
    if (!ligado && !(await confirmar({ titulo: "Desligar o canal oficial deste negócio?", texto: "Nenhum WhatsApp sai dele (aviso de agendamento, recibo, lembrete) até ligar de novo.", acao: "Desligar" }))) return;
    setBusy(true);
    setAviso(null);
    const r = await definirCanalOficial(await token(), slug, ligado).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setAviso({ ok: false, texto: r ? r.error : SEM_REDE });
    setCfg(r.dados);
  }

  async function confirmacao(chamar: (t: string) => ReturnType<typeof reenviarConfirmacaoDonoOficial>) {
    setBusy(true);
    setAviso(null);
    const r = await token().then(chamar).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setAviso({ ok: false, texto: r ? r.error : SEM_REDE });
    setCfg(r.dados.cfg);
    setFone((r.dados.cfg.ownerPhone ?? "").replace(/^55(?=\d{11}$)/, ""));
    setAviso(AVISO_ENVIO[r.dados.envio]);
  }

  function salvarDono() {
    const v = celularDoDono(fone);
    if ("erro" in v) return setAviso({ ok: false, texto: v.erro });
    void confirmacao((t) => definirWhatsAppDonoOficial(t, slug, fone));
  }

  if (cfg === undefined) return <p className="text-sm text-[#6F6A5E]">Carregando…</p>;
  if (cfg === null) return <p role="alert" className="text-sm text-[#8A2F2F]">Não foi possível ler o WhatsApp deste negócio.</p>;

  return (
    <section aria-label="WhatsApp do negócio" className="flex flex-col gap-3 rounded-2xl border border-[#E2DDD3] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-semibold">WhatsApp (canal oficial)</h3>
        <div className="grow" />
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${cfg.erroContato ? "bg-[#F1E7E7] text-[#8A2F2F]" : cfg.canalOficial ? "bg-[#E7EEE9] text-[#2C6A53]" : "bg-[#F3EFE7] text-[#4A4639]"}`}>
          {cfg.erroContato ? "mensagens bloqueadas" : cfg.canalOficial ? "ligado" : "desligado"}
        </span>
      </div>
      {cfg.erroContato && (
        <p role="alert" className="rounded-[10px] bg-[#F1E7E7] px-3 py-2 text-[12px] leading-relaxed text-[#8A2F2F]">
          {cfg.erroContato} O contato público precisa ser válido para enviar e receber mensagens.
        </p>
      )}
      <p className="text-[13px] leading-relaxed text-[#4A4639]">
        Os avisos saem pelo número da Ruphus: o dono recebe os pedidos no WhatsApp pessoal e confirma pelos botões; o
        cliente recebe recibo, confirmação e lembrete.
      </p>

      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[13px]">
        <dt className="text-[#6F6A5E]">WhatsApp do dono</dt>
        <dd className="tabular-nums">{cfg.ownerPhone ? mascaraTelefoneBR(cfg.ownerPhone.replace(/^55(?=\d{11}$)/, "")) : "não cadastrado"}</dd>
        <dt className="text-[#6F6A5E]">Confirmado (Sou eu)</dt>
        <dd>
          {cfg.ownerPhoneVerifiedAt
            ? `sim, em ${data(cfg.ownerPhoneVerifiedAt)}`
            : cfg.ownerPhone
              ? `não${cfg.confirmacaoEnviadaEm ? ` · último envio em ${data(cfg.confirmacaoEnviadaEm)}` : ""}`
              : "—"}
        </dd>
        <dt className="text-[#6F6A5E]">Lembretes</dt>
        <dd>{cfg.remindersEnabled ? `ligados · ${cfg.remindersBeforeHours ?? 2} h antes` : "desligados"}</dd>
      </dl>

      <div className="flex flex-wrap gap-2">
        {cfg.canalOficial ? (
          <button type="button" className={BOTAO_CLARO} disabled={busy} onClick={() => canal(false)}>Desligar canal oficial</button>
        ) : (
          <button type="button" className={BOTAO_ESCURO} disabled={busy} onClick={() => canal(true)}>Ligar canal oficial</button>
        )}
        {cfg.canalOficial && cfg.ownerPhone && !cfg.ownerPhoneVerifiedAt && (
          <button type="button" className={BOTAO_CLARO} disabled={busy} onClick={() => void confirmacao((t) => reenviarConfirmacaoDonoOficial(t, slug))}>Reenviar &quot;Sou eu&quot;</button>
        )}
      </div>

      <form
        className="flex flex-col gap-1.5"
        onSubmit={(ev) => {
          ev.preventDefault();
          salvarDono();
        }}
      >
        <label htmlFor="zap-dono-admin" className="text-xs font-semibold text-[#4A4639]">Trocar o WhatsApp do dono</label>
        <div className="flex gap-2">
          <input
            id="zap-dono-admin"
            inputMode="numeric"
            autoComplete="off"
            value={mascaraTelefoneBR(fone)}
            maxLength={19}
            onChange={(e) => setFone(e.target.value.replace(/\D/g, ""))}
            placeholder="(11) 98877-7777"
            className="h-11 min-w-0 grow rounded-[10px] border border-[#D8D2C6] bg-white px-3 text-sm tabular-nums text-[#17150F] outline-none focus:border-[#17150F]"
          />
          <button type="submit" className={BOTAO_ESCURO} disabled={busy}>{busy ? "Salvando…" : "Salvar"}</button>
        </div>
        <span className="text-[11.5px] leading-relaxed text-[#6F6A5E]">
          Salvar liga o canal oficial e manda o &quot;Sou eu&quot; ao número (o mesmo número já confirmado fica como está).
        </span>
      </form>

      {cfg.lastNotifyError?.message && (
        // o aviso que não saiu (agendamento, lembrete, comando) — some quando um aviso de agendamento sai
        <p role="alert" className="rounded-[10px] bg-[#F1E7E7] px-3 py-2 text-[12px] leading-relaxed [overflow-wrap:anywhere] text-[#8A2F2F]">
          {cfg.lastNotifyError.at ? `${data(cfg.lastNotifyError.at)}: ` : ""}
          {cfg.lastNotifyError.message}
        </p>
      )}

      {aviso && <p role={aviso.ok ? "status" : "alert"} className={`text-sm ${aviso.ok ? "text-[#2C6A53]" : "text-[#8A2F2F]"}`}>{aviso.texto}</p>}
    </section>
  );
}
