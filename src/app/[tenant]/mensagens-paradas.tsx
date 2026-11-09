"use client";

import { useEffect, useState } from "react";
import { CotaWhatsapp } from "@/components/cota-whatsapp";
import { idToken } from "@/lib/firebase";
import { mensagensParadasAction } from "./actions";

type Parada = { messageId: string; para: string; resumo: string; retryAt: string | null; errorCode?: string | null };

/** Mensagens que o WhatsApp do negócio parou (cota do dia, sem conexão, fora do horário) sem ninguém olhando (lembrete,
 *  aviso de agendamento, robô): ficam aqui até o dono escolher enviar à mão ou manter agendada.
 *  Não é "falhou" nem "enviada": é decisão pendente. */
export function MensagensParadas({ tenantId, fuso }: { tenantId: string; fuso: string }) {
  const [lista, setLista] = useState<Parada[]>([]);
  // decididas somem da lista na hora; o resultado da última fica embaixo
  const [feitas, setFeitas] = useState<ReadonlySet<string>>(new Set());
  const [ultimo, setUltimo] = useState("");

  useEffect(() => {
    let vivo = true;
    const ler = () =>
      idToken()
        .then((t) => mensagensParadasAction(t, { tenantId }))
        .then((r) => vivo && r.ok && setLista(r.mensagens))
        .catch(() => {});
    ler();
    // ponytail: consulta a cada 2 min com a agenda aberta; tempo real (listener) se as paradas ficarem comuns
    const t = setInterval(ler, 120_000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [tenantId]);

  const pendentes = lista.filter((m) => !feitas.has(m.messageId));
  if (!pendentes.length && !ultimo) return null;
  return (
    <section aria-labelledby="mensagens-paradas" className="grid gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950">
      <h2 id="mensagens-paradas" className="font-semibold">
        {pendentes.length === 0 ? "Mensagens do WhatsApp decididas" : pendentes.length === 1 ? "1 mensagem do WhatsApp aguardando decisão" : `${pendentes.length} mensagens do WhatsApp aguardando decisão`}
      </h2>
      <ul className="grid gap-3">
        {pendentes.map((m) => (
          <li key={m.messageId} className="grid gap-1.5 border-t border-amber-200 pt-3 first:border-t-0 first:pt-0 dark:border-amber-900">
            <p className="text-xs text-muted-foreground">Para {m.para}: “{m.resumo}”</p>
            <CotaWhatsapp tenantId={tenantId} messageId={m.messageId} retryAt={m.retryAt} errorCode={m.errorCode} fuso={fuso} onFim={(aviso) => (setFeitas((f) => new Set(f).add(m.messageId)), setUltimo(aviso))} />
          </li>
        ))}
      </ul>
      {ultimo && <p role="status" className="text-xs">{ultimo}</p>}
    </section>
  );
}
