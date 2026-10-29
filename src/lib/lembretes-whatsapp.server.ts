import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/admin";
import { agoraNaParede, dateIn, formatTime, fusoDaUF, todayIn, zonedTime } from "@/lib/datetime";
import { getStatus, sendText } from "@/lib/wtsfy";
import { soDigitosComDDI } from "@/lib/whatsapp.server";

// Lembretes automáticos de horário: X horas antes de cada agendamento confirmado,
// o cliente recebe um lembrete pelo WhatsApp do salão. O dono liga/desliga e
// escolhe quantas horas antes (config em tenants/{slug}/whatsapp.remindersEnabled
// /.remindersBeforeHours). Envio transacional; o sucesso marca o agendamento
// (whatsappReminderSentAt) para nunca repetir. Nada de mensagem entre 22h e 7h30
// (fuso do negócio): o que vencer na janela de silêncio espera as 7h30.
//
// Roda pela Vercel Cron (/api/cron/lembretes, a cada 10 min). Cada agendamento é
// reservado numa transação antes do envio: duas execuções simultâneas não mandam
// o mesmo lembrete duas vezes.
//
// Fuso: "start" é gravado no fuso de referência com a hora de parede do negócio
// (como em reservaDe). Por isso "agora" e o dia entram na mesma representação, pela
// hora de parede do fuso do endereço (agoraNaParede), e não pelo instante real.

const SILENCIO = { inicioMin: 22 * 60, fimMin: 7 * 60 + 30 }; // 22:00 → 07:30

/** Envia os lembretes devidos agora. Devolve quantos foram enviados. */
export async function enviarLembretesDoDia(): Promise<number> {
  // varredura simples de tenants: vale para dezenas; com centenas, virar consulta
  // agendada por tenant ou collection group com índice
  const tenants = await adminDb.collection("tenants").get();
  const agora = new Date();
  let enviados = 0;
  for (const t of tenants.docs) {
    // tudo no fuso do endereço do negócio — salão em Manaus não segue horário de SP
    const tz = fusoDaUF(t.get("site.uf") as string | undefined);
    const hoje = todayIn(tz);
    const inicioDoDia = zonedTime(hoje, "00:00");
    const fimDoDia = zonedTime(hoje, "23:59");
    const parede = agoraNaParede(tz, agora);
    // janela de silêncio: quem vence entre 22h e 7h30 (no fuso dele) espera as 7h30
    const [h, m] = formatTime(agora, tz).split(":").map(Number);
    const minutosDoDia = h * 60 + m;
    if (minutosDoDia >= SILENCIO.inicioMin || minutosDoDia < SILENCIO.fimMin) continue;
    const w = t.data().whatsapp as
      | { instanceId?: string; remindersEnabled?: boolean; remindersBeforeHours?: number }
      | undefined;
    if (!w?.instanceId || w.remindersEnabled !== true) continue;
    const antesMs = Math.min(24, Math.max(1, Number(w.remindersBeforeHours) || 2)) * 60 * 60_000;
    const vivo = await getStatus(w.instanceId).catch(() => null);
    if (!vivo || vivo.status !== "connected") continue;
    const nomeNegocio = String(t.get("name") ?? "seu salão");
    // janela: o dia do horário, com folga para lembretes cuja hora de envio cai
    // no dia anterior (ex.: horário 00:30 com 2h antes → 22:30 de ontem). "start"
    // sozinho, sem índice composto; o resto filtra aqui
    const doDia = await t.ref
      .collection("appointments")
      .where("start", ">=", new Date(inicioDoDia.getTime() - antesMs))
      .where("start", "<=", fimDoDia)
      .get();
    for (const a of doDia.docs) {
      if (a.get("status") !== "confirmed") continue; // sem confirmação, não lembra
      if (a.get("whatsappReminderSentAt")) continue; // já avisado este agendamento
      const start: Date = a.get("start") instanceof Date ? a.get("start") : (a.get("start") as FirebaseFirestore.Timestamp).toDate();
      // devido: chegou a hora (início - Xh) e o horário ainda não começou
      if (parede < new Date(start.getTime() - antesMs) || parede >= start) continue;
      const cliente = soDigitosComDDI(String(a.get("customerPhone") ?? ""));
      if (!cliente) continue;
      const nome = String(a.get("customerName") ?? "").trim().split(/\s+/)[0] ?? "";
      // "hoje" ou "amanhã" conforme o dia do horário no fuso do negócio — lembrete
      // de horário madrugador pode sair na noite anterior
      const dia = dateIn(start) === hoje ? "hoje" : "amanhã";
      // reserva antes de enviar: outra execução que leu o mesmo agendamento desiste aqui
      const reservado = await adminDb.runTransaction(async (tx) => {
        if ((await tx.get(a.ref)).get("whatsappReminderSentAt")) return false;
        tx.update(a.ref, { whatsappReminderSentAt: Date.now() });
        return true;
      });
      if (!reservado) continue;
      try {
        await sendText(
          w.instanceId,
          cliente,
          `Olá, ${nome}! Lembrete do seu horário ${dia} às ${formatTime(start)}: ${a.get("serviceName")} no ${nomeNegocio}. Qualquer imprevisto, responda aqui pelo WhatsApp.`,
        );
        enviados += 1;
      } catch (e) {
        // devolve a reserva: o próximo ciclo tenta de novo; o erro fica no log do servidor
        await a.ref.update({ whatsappReminderSentAt: FieldValue.delete() }).catch(() => {});
        console.error(`[wtsfy] lembrete ${t.id}/${a.id}`, e);
      }
    }
  }
  return enviados;
}
