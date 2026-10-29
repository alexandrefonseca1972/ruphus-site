import { after, NextResponse } from "next/server";
import { avisar, quando } from "@/lib/avisos.server";
import { adminDb } from "@/lib/admin";
import { book } from "@/lib/booking.server";
import { MAX_DAYS_AHEAD, dentroDaJanela } from "@/lib/datetime";
import { BookingInput } from "@/lib/scheduling";
import { codigoDoAgendamento, lerConexao, registrarErroNotificacao } from "@/lib/whatsapp.server";
import { soDigitosComDDI } from "@/lib/telefone";
import { getStatus, sendText } from "@/lib/wtsfy";

// A reserva da página pública. Rota, não server action: o Next manda um server action
// por vez, e com a rede travada a nova tentativa (e a agenda) ficava na fila atrás da
// primeira. Aqui a tela aborta o pedido com 20 s e o seguinte sai na hora.
// Chamável por qualquer pessoa: toda entrada é validada aqui.

export async function POST(req: Request) {
  // só JSON: outro site não consegue postar aqui sem a checagem de CORS do navegador
  if (!req.headers.get("content-type")?.startsWith("application/json")) return new NextResponse(null, { status: 415 });
  const b = BookingInput.safeParse(await req.json().catch(() => null));
  if (!b.success) return NextResponse.json({ ok: false, error: b.error.issues[0].message, field: true });
  if (!dentroDaJanela(b.data.date)) {
    return NextResponse.json({ ok: false, error: `Agende com até ${MAX_DAYS_AHEAD} dias de antecedência.`, field: true });
  }
  // IP só para contar tentativas por dispositivo; guardado apenas como hash
  // x-real-ip vem do proxy; no x-forwarded-for o primeiro valor é escolhido por
  // quem chama, então vale o último, que foi acrescentado por quem está na frente
  const encaminhado = req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  const ip = req.headers.get("x-real-ip")?.trim() || encaminhado;
  // Aviso no celular de quem atende, depois da resposta: push lento não atrasa a reserva.
  // Só a reserva nova: a repetição (resposta perdida, segundo toque) já foi avisada.
  const r = await book(adminDb, b.data, ip, (nova) => {
    const { tenantId, customerName } = b.data;
    after(() =>
      avisar(adminDb, tenantId, {
        title: "Novo agendamento",
        body: `${customerName.trim()} · ${nova.serviceName} · ${quando(nova.date, nova.time)}${nova.staffName ? ` · com ${nova.staffName}` : ""}`,
        url: `/${tenantId}`,
        tag: `agendamento-${nova.id}`,
      }).catch((e) => console.error("aviso de agendamento", e)),
    );
    // A reserva nasce "booked" (aguardando confirmação): quem confirma é o dono,
    // respondendo CONFIRMADO no self-chat do próprio número do salão — toda a
    // comunicação rola pelo número do negócio, nada pelo WhatsApp pessoal dele.
    // O cliente recebe recibo na hora ("o salão vai confirmar") e a confirmação
    // depois, também pelo número do salão. Falha de qualquer aviso fica gravada
    // no negócio: a gaveta mostra, em vez de o dono descobrir pelo silêncio.
    after(() =>
      (async () => {
        const conn = await lerConexao(adminDb, tenantId);
        if (!conn) return;
        const marcar = (message: string) =>
          registrarErroNotificacao(adminDb, tenantId, { message, at: Date.now() }).catch(() => {});
        // pergunta ao gateway ao vivo em vez de confiar no status cacheado no
        // documento — ele pode ficar desatualizado se um webhook se perder
        let vivo;
        try {
          vivo = await getStatus(conn.instanceId);
        } catch (e) {
          const motivo = e instanceof Error ? e.message : String(e);
          await marcar(`Gateway WhatsApp sem resposta: ninguém foi avisado do agendamento de ${customerName.trim()}. Motivo: ${motivo}`);
          console.error("status do gateway para aviso de agendamento", e);
          return;
        }
        if (vivo.status !== "connected") {
          await marcar(`WhatsApp do negócio está "${vivo.status}": ninguém foi avisado do agendamento de ${customerName.trim()}. Abra o painel e reconecte.`);
          return;
        }
        const partes = [nova.serviceName, quando(nova.date, nova.time)];
        if (nova.staffName) partes.push(`com ${nova.staffName}`);
        const nomeCurto = customerName.trim().split(/\s+/)[0] ?? customerName.trim();
        // o recado do dono (agenda.recado) é a mensagem da tela de confirmação:
        // no WhatsApp vale o mesmo texto. Sem recado, um padrão adequado ao canal
        // — o da tela ("vai te chamar no WhatsApp") faria o salão anunciar o
        // WhatsApp pelo próprio WhatsApp.
        const recadoDono = await adminDb
          .doc(`tenants/${tenantId}`)
          .get()
          .then((t) => String(t.get("agenda.recado") ?? "").trim())
          .catch(() => "");
        const falhas: string[] = [];
        // aviso vai pro self-chat do salão (conn.phone): o dono opera tudo no
        // próprio número do negócio, nenhuma comunicação depende do pessoal dele
        const avisoPara = conn.phone ?? conn.ownerPhone;
        if (avisoPara) {
          try {
            await sendText(
              conn.instanceId,
              avisoPara,
              `Novo agendamento (código ${codigoDoAgendamento(nova.id)}): ${customerName.trim()} · ${partes.join(" · ")} · tel ${b.data.customerPhone}. Responda CONFIRMADO ${codigoDoAgendamento(nova.id)} para confirmar ou RECUSAR ${codigoDoAgendamento(nova.id)} para recusar.`,
            );
          } catch (e) {
            falhas.push(`aviso ao salão não chegou: ${e instanceof Error ? e.message : String(e)}`);
            console.error("aviso de agendamento via WhatsApp", e);
          }
        } else {
          console.warn(`[wtsfy] ${tenantId}: número do salão sem telefone pareado; aviso de novo agendamento não enviado`);
        }
        // recibo pro cliente: o pedido foi recebido e a confirmação vem pelo salão
        const cliente = soDigitosComDDI(b.data.customerPhone);
        if (cliente) {
          try {
            await sendText(
              conn.instanceId,
              cliente,
              recadoDono ||
                `Olá, ${nomeCurto}! Recebemos seu pedido de agendamento: ${partes.join(" · ")}. O salão vai confirmar em breve — avisamos por aqui.`,
            );
          } catch (e) {
            falhas.push(`recibo ao cliente não chegou: ${e instanceof Error ? e.message : String(e)}`);
            console.error("recibo de agendamento via WhatsApp", e);
          }
        } else {
          console.warn(`[wtsfy] ${tenantId}: telefone do cliente inválido (${b.data.customerPhone}); recibo de agendamento não enviado`);
        }
        // um aviso bem-sucedido limpa o erro anterior; falha mantém o detalhe
        await registrarErroNotificacao(
          adminDb,
          tenantId,
          falhas.length ? { message: `Agendamento de ${customerName.trim()} — ${falhas.join("; ")}.`, at: Date.now() } : null,
        ).catch(() => {});
      })(),
    );
  });
  return NextResponse.json(r);
}
