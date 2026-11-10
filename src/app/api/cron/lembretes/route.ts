import { FieldValue } from "firebase-admin/firestore";
import type { NextRequest } from "next/server";
import { adminDb } from "@/lib/admin";
import { reverificarDominios } from "@/lib/dominio.server";
import { enviarLembretesDoDia } from "@/lib/lembretes-whatsapp.server";
import { segredoIgual } from "@/lib/segredo.server";
import { expirarSinais } from "@/lib/sinal.server";
import { enviarLembretesPorSms } from "@/lib/sms-agendamento.server";
import { reprocessarComandos, vigiarConexoes } from "@/lib/whatsapp.server";

// Lembretes de horário pelo WhatsApp do salão (deploy/crontab.txt: a cada 10 min). O cron
// da VPS chama com "Authorization: Bearer $CRON_SECRET"; sem o segredo, ninguém dispara.
export async function GET(request: NextRequest) {
  const segredo = process.env.CRON_SECRET;
  if (!segredo || !segredoIgual(request.headers.get("authorization"), `Bearer ${segredo}`)) {
    return new Response("Unauthorized", { status: 401 });
  }
  // sinal vencido primeiro: o horário liberado já não recebe lembrete
  const sinaisVencidos = await expirarSinais(adminDb).catch((e) => (console.error("[cron] expirar sinais", e), 0));
  const enviados = await enviarLembretesDoDia().catch((e) => (console.error("[cron] lembretes do WhatsApp", e), 0));
  // comando do dono (CONFIRMADO/RECUSAR) que ficou sem processar: depois dos lembretes (cada um
  // pode esperar o atendys; antes, um comando lento atrasava o ciclo dos lembretes)
  const comandos = await reprocessarComandos(adminDb).catch((e) => (console.error("[cron] comandos pendentes", e), 0));
  // SMS depois do WhatsApp: um falhar não impede o outro
  const sms = await enviarLembretesPorSms(adminDb).catch((e) => (console.error("[cron] lembretes por SMS", e), 0));
  // uma vez por hora (o cron roda a cada 10 min): conexão que caiu sem o webhook chegar
  const agora = new Date(); // TZ=America/Sao_Paulo no ruphus-site.service
  // uma vez por hora (o cron roda a cada 10 min): conexão que caiu sem o webhook chegar
  const conexoesCaidas = agora.getMinutes() < 10 ? await vigiarConexoes(adminDb).catch((e) => (console.error("[cron] vigiar conexões", e), 0)) : null;
  // uma vez por dia, de madrugada: domínio próprio cujo DNS saiu da VPS volta a pendente
  const dominiosRebaixados = agora.getHours() === 4 && agora.getMinutes() < 10 ? await reverificarDominios(adminDb).catch((e) => (console.error("[cron] reverificar domínios", e), 0)) : null;
  // o instrumentation confere esta marca a cada 10 min e avisa o admin se passar de 30 min
  await adminDb.doc("config/cron").set({ ultimaExecucao: FieldValue.serverTimestamp() }, { merge: true });
  return Response.json({ ok: true, sinaisVencidos, comandos, enviados, sms, conexoesCaidas, dominiosRebaixados });
}
