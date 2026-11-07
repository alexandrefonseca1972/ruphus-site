"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { formatLongDate, formatTime } from "@/lib/datetime";
import { idToken } from "@/lib/firebase";
import { decidirEnvioAction } from "@/app/[tenant]/actions";

/** Quando a mensagem sai, no fuso do negócio: "sábado, 8 de novembro às 00:00". */
export const quandoSai = (iso: string, fuso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "mais tarde" : `${formatLongDate(d, fuso)} às ${formatTime(d, fuso)}`;
};

/** Mensagem parada na cota do dia: o dono escolhe entre mandar agora pelo próprio WhatsApp e
 *  deixar agendada. "Enviar agora" só mostra o link do WhatsApp depois que o atendys confirma a
 *  ação manual (o Safari do iPhone bloqueia janela aberta depois de esperar a rede). */
export function CotaWhatsapp({ tenantId, messageId, retryAt, fuso, onFim }: { tenantId: string; messageId: string; retryAt: string | null; fuso: string; onFim?: (aviso: string) => void }) {
  const [ocupado, setOcupado] = useState<"agora" | "agendar" | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  // sem onFim (dentro de outra caixa, como o QR do Pix), o resultado fica aqui mesmo
  const [fim, setFim] = useState("");
  const terminar = (aviso: string) => (setFim(aviso), onFim?.(aviso));

  async function decidir(acao: "agora" | "agendar") {
    if (ocupado) return; // sem clique duplo
    setOcupado(acao);
    setErro("");
    const r = await idToken()
      .then((t) => decidirEnvioAction(t, { tenantId, messageId, acao }))
      .catch(() => ({ ok: false as const, error: "Sem conexão. Tente de novo." }));
    setOcupado(null);
    if (!r.ok) return setErro(r.error ?? "Não foi possível agora. Tente de novo.");
    if (acao === "agora") {
      if (r.url) return setUrl(r.url);
      return setErro("O WhatsApp do negócio não devolveu o link. Tente de novo.");
    }
    terminar(r.retryAt ? `Mensagem agendada: sai ${quandoSai(r.retryAt, fuso)}.` : "Mensagem mantida na fila do WhatsApp do negócio.");
  }

  if (fim) return <p role="status" className="text-sm">{fim}</p>;
  return (
    <div className="grid gap-2 text-sm">
      <p>
        A cota diária foi atingida. Envie agora pelo WhatsApp ou mantenha a mensagem agendada.
        {retryAt && <span className="block text-xs opacity-80">Se mantiver, ela sai {quandoSai(retryAt, fuso)}.</span>}
      </p>
      {url ? (
        <div className="flex flex-wrap items-center gap-2">
          {/* manual_started: ação iniciada, não enviada — quem confirma o envio é o dono no WhatsApp */}
          <a href={url} target="_blank" rel="noreferrer" onClick={() => setTimeout(() => terminar("Envio manual iniciado: confirme a mensagem no WhatsApp."), 400)} className="inline-flex h-10 items-center rounded-lg bg-emerald-700 px-4 font-medium text-white hover:bg-emerald-800">
            Abrir WhatsApp
          </a>
          <span className="text-xs text-muted-foreground">A mensagem já vai escrita; é só tocar em enviar.</span>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={!!ocupado} onClick={() => decidir("agora")}>{ocupado === "agora" ? "Preparando…" : "Enviar agora"}</Button>
          <Button type="button" size="sm" variant="outline" disabled={!!ocupado} onClick={() => decidir("agendar")}>{ocupado === "agendar" ? "Agendando…" : "Manter agendada"}</Button>
        </div>
      )}
      {erro && <p role="alert" className="text-destructive">{erro}</p>}
    </div>
  );
}
