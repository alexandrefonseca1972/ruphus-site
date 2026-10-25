"use client";

import { useEffect, useState } from "react";
import { TERMO_WHATSAPP } from "@/lib/whatsapp-termo";
import { mascaraTelefoneBR, telefoneBrValido } from "@/lib/telefone";
import { conectarWhatsApp, definirGestaoDonoWhatsApp, definirOwnerPhoneWhatsApp, desconectarWhatsApp, qrWhatsApp, refreshWhatsAppStatus, whatsappDoNegocio, type ConexaoWhatsapp } from "./actions";

// Aba "WhatsApp" da gaveta: o número que o dono do negócio conecta para responder
// os clientes pela plataforma, via gateway próprio (wtsfy). Conectar cria a
// instância e mostra o QR; enquanto não conecta, o status é perguntado ao gateway
// a cada 4s (e o QR troca junto, porque expira).

const BOTAO = "inline-flex h-11 items-center justify-center rounded-[10px] px-4 text-[13px] font-semibold transition-colors disabled:opacity-60";
const BOTAO_CLARO = `${BOTAO} border border-[#D8D2C6] bg-white text-[#17150F] hover:border-[#17150F]`;
const BOTAO_ESCURO = `${BOTAO} bg-[#17150F] text-white hover:bg-[#2E2B22]`;

const ROTULO_STATUS: Record<string, { texto: string; cor: string }> = {
  connected: { texto: "conectado", cor: "bg-[#E7EEE9] text-[#2C6A53]" },
  disconnected: { texto: "desconectado", cor: "bg-[#F1E7E7] text-[#8A2F2F]" },
  qr: { texto: "aguardando o QR", cor: "bg-[#FBF3DC] text-[#7A5A2E]" },
  created: { texto: "preparando…", cor: "bg-[#F3EFE7] text-[#4A4639]" },
  paused: { texto: "pausado", cor: "bg-[#FBF3DC] text-[#7A5A2E]" },
  banned: { texto: "banido pelo WhatsApp", cor: "bg-[#F1E7E7] text-[#8A2F2F]" },
};
const statusDe = (s: string) => ROTULO_STATUS[s] ?? { texto: s, cor: "bg-[#F3EFE7] text-[#4A4639]" };

const MOTIVO_STATUS: Record<string, string> = {
  consecutive_failed_acks: "envios falhando repetidamente — o número pode estar temporariamente limitado",
  session_revoked_repeated: "sessão desvinculada várias vezes seguidas — sinal de risco na conta",
  watchdog_no_socket: "conexão caiu e não reestabeleceu sozinha",
  logged_out: "sessão desvinculada no aparelho",
  banned: "bloqueado pelo WhatsApp",
};
const motivoDe = (r?: string | null) => (r ? (MOTIVO_STATUS[r] ?? r) : null);

export function WhatsAppDoNegocio({ slug, token }: { slug: string; token: () => Promise<string> }) {
  // undefined = ainda carregando; null = nunca conectou
  const [conexao, setConexao] = useState<ConexaoWhatsapp | null | undefined>(undefined);
  const [qr, setQr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState("");
  // o número pessoal do dono: avisos chegam nele, e ele confirma respondendo
  const [foneDono, setFoneDono] = useState("");
  const [salvoDono, setSalvoDono] = useState("");

  useEffect(() => {
    let atual = true;
    (async () => {
      const r = await whatsappDoNegocio(await token(), slug).catch(() => null);
      if (!atual) return;
      if (!r?.ok) return setConexao(null);
      setConexao(r.dados);
      setFoneDono(r.dados?.ownerPhone ?? "");
    })();
    return () => {
      atual = false;
    };
    // um negócio por montagem: a gaveta remonta com key={slug}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  const conectado = conexao?.status === "connected";
  // vazio é válido (desliga os avisos); preenchido tem de ser um telefone BR inteiro
  const donoInvalido = foneDono !== "" && !telefoneBrValido(foneDono);

  // Enquanto não conecta, pergunta ao gateway de 4 em 4s e renova o QR (ele expira)
  useEffect(() => {
    if (!conexao || conectado) return;
    const id = setInterval(async () => {
      const t = await token();
      const r = await refreshWhatsAppStatus(t, slug).catch(() => null);
      if (!r?.ok) return;
      setConexao(r.dados);
      const q = await qrWhatsApp(t, slug).catch(() => null);
      setQr(q?.ok && q.dados.status === "qr" ? q.dados.base64 : null);
    }, 4000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, conexao?.instanceId, conectado]);

  async function conectar() {
    setBusy(true);
    setAviso("");
    const t = await token();
    const r = await conectarWhatsApp(t, slug).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setAviso(r ? r.error : "Sem conexão. Tente de novo.");
    setConexao(r.dados);
    const q = await qrWhatsApp(t, slug).catch(() => null);
    setQr(q?.ok && q.dados.status === "qr" ? q.dados.base64 : null);
  }

  async function desconectar() {
    if (!window.confirm("Desconectar o WhatsApp deste negócio? O número sai do gateway e para de responder pela plataforma.")) return;
    setBusy(true);
    setAviso("");
    const r = await desconectarWhatsApp(await token(), slug).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setAviso(r ? r.error : "Sem conexão. Tente de novo.");
    setConexao(null);
    setQr(null);
  }

  async function salvarDono() {
    setBusy(true);
    setAviso("");
    setSalvoDono("");
    const r = await definirOwnerPhoneWhatsApp(await token(), slug, foneDono).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setAviso(r ? r.error : "Sem conexão. Tente de novo.");
    setFoneDono(r.dados ?? "");
    setConexao((c) => (c ? { ...c, ownerPhone: r.dados ?? null } : c));
    setSalvoDono(r.dados ? `Número do dono salvo (${mascaraTelefoneBR(r.dados)}): os avisos de agendamento chegam nele.` : "Número do dono removido: os avisos de agendamento ficaram desligados.");
  }

  if (conexao === undefined) return <p className="text-sm text-[#6F6A5E]">Carregando…</p>;

  return (
    <section aria-label="WhatsApp do negócio" className="flex flex-col gap-3 rounded-2xl border border-[#E2DDD3] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[15px] font-semibold">WhatsApp do negócio</h3>
        <div className="grow" />
        {conexao && (
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusDe(conexao.status).cor}`}>
            {statusDe(conexao.status).texto}
          </span>
        )}
      </div>

      {!conexao ? (
        <>
          <p className="text-[13px] leading-relaxed text-[#4A4639]">
            Conecte o número do negócio para responder os clientes pela plataforma, sem sair do WhatsApp de ninguém.
          </p>
          <div>
            <button type="button" className={BOTAO_ESCURO} disabled={busy} onClick={conectar}>
              {busy ? "Conectando…" : "Conectar"}
            </button>
          </div>
        </>
      ) : (
        <>
          {conexao.status === "banned" && (
            // o WhatsApp bloqueou o número: nada de auto-retry no gateway — só orientar
            <p role="alert" className="rounded-[10px] bg-[#F1E7E7] px-3 py-2 text-[12px] leading-relaxed text-[#8A2F2F]">
              <strong>O WhatsApp bloqueou este número.</strong> A agenda e o site continuam funcionando; os avisos
              automáticos ficam desligados. Se o bloqueio for temporário, desconecte e conecte de novo daqui a
              algumas horas; se for definitivo, conecte outro número abaixo.
            </p>
          )}
          {conexao.status === "paused" && (
            <p role="alert" className="rounded-[10px] bg-[#FBF3DC] px-3 py-2 text-[12px] leading-relaxed text-[#7A5A2E]">
              <strong>Conexão pausada pela proteção automática.</strong>{" "}
              {motivoDe(conexao.statusReason) ? `Motivo: ${motivoDe(conexao.statusReason)}. ` : ""}
              O envio fica suspenso para proteger o número — confira a conexão e conecte de novo; se voltar a
              acontecer com frequência, pare de enviar por algumas horas.
            </p>
          )}
          <p className="text-[13px] leading-relaxed text-[#4A4639]">
            {conectado
              ? `Número ${conexao.phone ?? ""} conectado. As mensagens que os clientes mandam chegam à caixa de entrada do negócio.`
              : "Abra o WhatsApp do número, toque em Aparelhos conectados e leia o QR:"}
          </p>
          {qr && !conectado && (
            // o gateway entrega o QR pronto, em PNG: é só mostrar
            // eslint-disable-next-line @next/next/no-img-element -- PNG em base64 vindo do gateway
            <img
              src={`data:image/png;base64,${qr}`}
              alt="QR para conectar o WhatsApp do negócio"
              className="self-start rounded-xl border border-[#E2DDD3] bg-white p-2"
            />
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" className={BOTAO_CLARO} disabled={busy} onClick={desconectar}>
              Desconectar
            </button>
          </div>
          <label className="flex items-start gap-2 text-[12px] leading-relaxed text-[#4A4639]">
            <input
              type="checkbox"
              className="mt-0.5 accent-[#17150F]"
              checked={conexao.ownerManaged === true}
              disabled={busy}
              onChange={async (e) => {
                const r = await definirGestaoDonoWhatsApp(await token(), slug, e.target.checked).catch(() => null);
                if (!r?.ok) return setAviso(r ? r.error : "Sem conexão. Tente de novo.");
                setConexao((c) => (c ? { ...c, ownerManaged: r.dados } : c));
              }}
            />
            <span>
              <strong>Permitir que o dono gerencie</strong> o WhatsApp no painel dele. Desmarcado, a gestão é só da
              plataforma e o painel do dono vira leitura — esta gaveta aqui sempre pode alterar (a plataforma tem prioridade).
            </span>
          </label>
          {conectado && (
            // sem este número não há quem confirme: o aviso de novo agendamento não sai
            <form
              className="flex flex-col gap-1.5"
              onSubmit={(ev) => {
                ev.preventDefault();
                if (!donoInvalido) salvarDono();
              }}
            >
              <label htmlFor="zap-dono" className="text-xs font-semibold text-[#4A4639]">
                WhatsApp do dono (opcional — fallback pra confirmar pelo número pessoal)
              </label>
              <div className="flex gap-2">
                <input
                  id="zap-dono"
                  inputMode="numeric"
                  autoComplete="tel"
                  value={mascaraTelefoneBR(foneDono)}
                  maxLength={19}
                  onChange={(e) => setFoneDono(e.target.value.replace(/\D/g, ""))}
                  placeholder="(11) 98877-7777"
                  aria-invalid={donoInvalido}
                  className={`h-11 min-w-0 grow rounded-[10px] border bg-white px-3 text-sm tabular-nums text-[#17150F] outline-none focus:border-[#17150F] ${donoInvalido ? "border-[#B3261E]" : "border-[#D8D2C6]"}`}
                />
                <button type="submit" className={BOTAO_ESCURO} disabled={busy || donoInvalido}>Salvar</button>
              </div>
              <span className="text-[11.5px] leading-relaxed text-[#6F6A5E]">
                O fluxo inteiro rola pelo próprio número do salão: os avisos chegam em &quot;Mensagens para você&quot; dele e o dono
                responde lá — CONFIRMADO pra confirmar, RECUSAR pra recusar. Este campo só vale como alternativa, pra
                confirmar pelo aparelho pessoal.
              </span>
              {donoInvalido && (
                <p role="alert" className="text-[11.5px] text-[#B3261E]">
                  Número incompleto: use DDD + número (ex.: (11) 98877-7777) ou com DDI (+55 11 98877-7777).
                </p>
              )}
              {salvoDono && <p role="status" className="text-[12px] text-[#2C6A53]">{salvoDono}</p>}
            </form>
          )}
          {conexao?.lastNotifyError?.message && (
            // o aviso de agendamento não chegou ao dono — antes sumia no log
            <p role="alert" className="rounded-[10px] bg-[#F1E7E7] px-3 py-2 text-[12px] leading-relaxed text-[#8A2F2F]">
              {conexao.lastNotifyError.at
                ? `${new Date(conexao.lastNotifyError.at).toLocaleString("pt-BR")}: `
                : ""}
              {conexao.lastNotifyError.message}
            </p>
          )}
        </>
      )}

      {aviso && <p role="alert" className="text-sm text-[#8A2F2F]">{aviso}</p>}

      <div className="rounded-[10px] border border-[#E2DDD3] bg-[#FAF8F4] px-3 py-2.5 text-[11.5px] leading-relaxed text-[#6F6A5E]">
        <p className="mb-1 font-semibold text-[#4A4639]">{TERMO_WHATSAPP.titulo}</p>
        {TERMO_WHATSAPP.paragrafos.map((p) => (
          <p key={p.slice(0, 24)} className="mb-1.5">{p}</p>
        ))}
        <ul className="list-disc pl-4">
          {TERMO_WHATSAPP.itens.map((i) => (
            <li key={i.slice(0, 24)}>{i}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
