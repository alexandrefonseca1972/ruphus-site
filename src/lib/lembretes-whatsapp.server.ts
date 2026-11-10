import "server-only";
import { emParalelo } from "@/lib/paralelo";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/admin";
import { agoraNaParede, chaveDoHorario, dateIn, formatTime, fusoDe, instanteReal, todayIn, zonedTime } from "@/lib/datetime";
import { comAvisoSair, optInDoDoc } from "@/lib/consentimento-whatsapp";
import { chaveDeEnvio, enviarSemOperador, enviarTemplateSemOperador, motivoLegivel, ROTULO_STATUS, saiuDepoisDoAceite, statusDaConexao } from "@/lib/atendys";
import { conexaoOficial, contatoDoNegocio, templateCliente, usaCanalOficial } from "@/lib/canal-oficial.server";
import { alertarAdmin } from "@/lib/alerta-admin.server";
import { espelharStatusVivo, lerConexao, lerConfigWhatsApp, registrarErroNotificacao, soDigitosComDDI } from "@/lib/whatsapp.server";

// Lembretes automáticos de horário: X horas antes de cada agendamento confirmado,
// o cliente recebe um lembrete pelo WhatsApp do salão. O dono liga/desliga e
// escolhe quantas horas antes (config em tenants/{slug}/whatsapp.remindersEnabled
// /.remindersBeforeHours). Envio transacional; o sucesso marca o agendamento
// (whatsappReminderSentAt) para nunca repetir. Nada de mensagem entre 22h e 8h
// (fuso do negócio): o que vencer na janela de silêncio espera as 8h. É o mesmo horário
// silencioso do tenant da plataforma no atendys: lembrete aceito aqui não fica adiado lá.
// Falha (WhatsApp desconectado, envio recusado) aparece na gaveta do negócio
// (lastNotifyError) e vira e-mail para o admin, no máximo um por negócio a cada 6 h.
//
// Roda pelo cron da VPS (/api/cron/lembretes, a cada 10 min). Cada agendamento é
// reservado numa transação antes do envio: duas execuções simultâneas não mandam
// o mesmo lembrete duas vezes.
//
// Fuso: "start" é gravado no fuso de referência com a hora de parede do negócio
// (como em reservaDe). Por isso "agora" e o dia entram na mesma representação, pela
// hora de parede do fuso do endereço (agoraNaParede), e não pelo instante real.

const SILENCIO = { inicioMin: 22 * 60, fimMin: 8 * 60 }; // 22:00 → 08:00

/** Envia os lembretes devidos agora. Devolve quantos foram enviados. */
export async function enviarLembretesDoDia(): Promise<number> {
  // só quem ligou os lembretes: ler os ~15 mil tenants a cada 10 min eram ~2 milhões de
  // leituras por dia, para achar meia dúzia (índice de campo único, automático)
  const tenants = await adminDb.collection("tenants").where("whatsapp.remindersEnabled", "==", true).get();
  const agora = new Date();
  let enviados = 0;
  // 5 negócios de cada vez: em fila, ~100 negócios estouravam os 120 s do curl do cron
  await emParalelo(tenants.docs, 5, async (t) => {
    // tudo no fuso do endereço do negócio — salão em Manaus não segue horário de SP
    const tz = fusoDe(t.get("site"));
    const hoje = todayIn(tz);
    const inicioDoDia = zonedTime(hoje, "00:00");
    const fimDoDia = zonedTime(hoje, "23:59");
    const parede = agoraNaParede(tz, agora);
    // janela de silêncio: quem vence entre 22h e 8h (no fuso dele) espera as 8h
    const [h, m] = formatTime(agora, tz).split(":").map(Number);
    const minutosDoDia = h * 60 + m;
    if (minutosDoDia >= SILENCIO.inicioMin || minutosDoDia < SILENCIO.fimMin) return;
    // a conexão com a credencial do gateway, que mora no doc privado (lerConexao junta)
    // canal oficial: o lembrete sai pelo número da plataforma (template), sem depender do salão
    let oficial = null;
    // a marca vem do documento já lido: erro de leitura não vira "canal oficial indisponível"
    if (t.get("whatsapp.canalOficial") === true && (await usaCanalOficial(adminDb, t.id))) try {
      oficial = await conexaoOficial(adminDb, t.id);
    } catch (e) {
      // negócio do canal oficial sem a plataforma pronta: falha visível, nunca o número do salão
      await falhou(t.id, `Lembretes ligados, mas o canal oficial do WhatsApp está indisponível: ${motivoLegivel(e)}.`);
      return;
    }
    const w = oficial ? await lerConfigWhatsApp(adminDb, t.id) : await lerConexao(adminDb, t.id);
    if (!w || w.remindersEnabled !== true || (!oficial && !w.instanceId)) return;
    const antesMs = Math.min(24, Math.max(1, Number(w.remindersBeforeHours) || 2)) * 60 * 60_000;
    const lidoEm = Date.now();
    const vivo = oficial ? { status: "connected" as const, phone: null } : await statusDaConexao(w).catch(() => null);
    if (!vivo || vivo.status !== "connected") {
      // webhook perdido: o status ao vivo também vira faixa no painel e aviso ao dono
      if (vivo) await espelharStatusVivo(adminDb, t.id, vivo, lidoEm).catch((e) => console.error(`[whatsapp] espelhar status ${t.id}`, e));
      const motivo = vivo ? `o WhatsApp do negócio está ${ROTULO_STATUS[vivo.status] ?? vivo.status}` : "o serviço de WhatsApp não respondeu";
      await falhou(t.id, `Lembretes ligados, mas ${motivo}: nenhum lembrete sai até reconectar.`);
      return;
    }
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
      // sem aceite gravado no agendamento (inclui os anteriores ao campo), não há lembrete
      const optIn = optInDoDoc(t.id, a);
      if (!optIn) continue;
      const nome = String(a.get("customerName") ?? "").trim().split(/\s+/)[0] ?? "";
      // "hoje" ou "amanhã" conforme o dia do horário no fuso do negócio — lembrete
      // de horário madrugador pode sair na noite anterior
      const dia = dateIn(start) === hoje ? "hoje" : "amanhã";
      // prazo do aviso: o horário no fuso do negócio (start é hora de parede)
      const prazo = instanteReal(start, t.get("site"));
      // reserva antes de enviar: outra execução que leu o mesmo agendamento desiste aqui
      const reservado = await adminDb.runTransaction(async (tx) => {
        if ((await tx.get(a.ref)).get("whatsappReminderSentAt")) return false;
        tx.update(a.ref, { whatsappReminderSentAt: Date.now() });
        return true;
      });
      if (!reservado) continue;
      // um lembrete por agendamento e horário: a tentativa do ciclo seguinte (timeout, reserva devolvida)
      // repete a chave e o atendys devolve o já aceito em vez de mandar outro. Remarcou: outra chave
      const chave = chaveDeEnvio("lembrete", t.id, a.id, chaveDoHorario(start));
      try {
        const e = oficial
          ? await enviarTemplateSemOperador(oficial, cliente, templateCliente("lembrete", { nome, negocio: nomeNegocio, servico: String(a.get("serviceName") ?? ""), quando: `${dia} às ${formatTime(start)}`, contato: contatoDoNegocio(t) }, { slug: t.id, agendamento: a.id, horario: chaveDoHorario(start) }), optIn, prazo, { chave })
          : await enviarSemOperador(
              w,
              cliente,
              comAvisoSair(`Olá, ${nome}! Lembrete do seu horário ${dia} às ${formatTime(start)}: ${a.get("serviceName")} no ${nomeNegocio}. Qualquer imprevisto, responda aqui pelo WhatsApp.`),
              optIn,
              prazo, // lembrete que sairia depois do horário não serve: fica parado
              { chave },
            );
        // parado na cota: não é falha (aguarda decisão do dono); a reserva fica, para não reenviar a cada ciclo
        // parado (decisão do dono) ou que não sai antes do horário: não conta como enviado. Aceito e
        // adiado para depois do prazo, o message.status avisa o negócio; sem folga (menos de 60 s),
        // nem foi enviado e não há mensagem para avisar: fica só o log
        if (e.destino === "nao_sai" && !e.messageId) console.warn(`[lembretes] ${t.id}/${a.id}: horário em cima, lembrete não enviado`);
        if (e.destino === "enviada" || e.destino === "agendada") enviados += 1;
      } catch (e) {
        // o cliente saiu (SAIR) depois do aceite deste agendamento: a reserva fica (sem nova
        // tentativa a cada ciclo) e não é falha a alertar
        if (saiuDepoisDoAceite(e)) continue;
        // devolve a reserva: o próximo ciclo tenta de novo
        await a.ref.update({ whatsappReminderSentAt: FieldValue.delete() }).catch(() => {});
        console.error(`[whatsapp] lembrete ${t.id}/${a.id}`, e);
        await falhou(t.id, `O lembrete de ${nome || "um cliente"} (${a.get("serviceName")}, ${dia} às ${formatTime(start)}) não saiu: ${motivoLegivel(e)}. Tenta de novo no próximo ciclo.`);
      }
    }
  });
  return enviados;
}

/** Lembrete que não saiu: na gaveta do negócio e no e-mail do admin. Nunca lança. */
async function falhou(slug: string, mensagem: string) {
  await registrarErroNotificacao(adminDb, slug, { message: mensagem, at: Date.now() }).catch(() => {});
  await alertarAdmin(adminDb, `whatsapp-lembrete-${slug}`, `Lembrete do WhatsApp falhou em ${slug}`, `${mensagem}\n\nNegócio: ${slug}`);
}
