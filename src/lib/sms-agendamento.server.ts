import "server-only";
import { emParalelo } from "@/lib/paralelo";
import { FieldValue, type DocumentReference, type Firestore, type Timestamp } from "firebase-admin/firestore";
import { alertarAdmin } from "@/lib/alerta-admin.server";
import { quando } from "@/lib/avisos.server";
import { numeroSms } from "@/lib/comtele";
import { enviarSms, smsDisponivel } from "@/lib/comtele.server";
import { registrarEnvio, verificarEnvio } from "@/lib/consumo.server";
import { optInDoDoc } from "@/lib/consentimento-whatsapp";
import { agoraNaParede, dateIn, formatPhone, formatTime, fusoDe, todayIn } from "@/lib/datetime";

// SMS para o cliente final, pela conta da Ruphus na Comtele: quando a casa confirma o horário e X h
// antes dele. Só nos negócios com `sms.ligado` (a chave fica na gaveta do /admin): cada SMS gasta
// crédito da Ruphus. Cada agendamento é reservado numa transação antes do envio (smsConfirmacaoEm,
// smsLembreteEm), para duas execuções não mandarem o mesmo SMS; envio que falha devolve a reserva.
// Falha nunca chega ao cliente nem a quem confirmou: vira e-mail para o admin (alertarAdmin).

/** O que o /admin escolheu para o negócio (tenants/{slug}.sms). Sem escolha: confirmação e lembrete
 *  ligados, lembrete 2 h antes, SMS sempre.
 *  modo "reserva": o SMS só sai quando o WhatsApp oficial não vai avisar (negócio fora do canal, cliente
 *  sem aceite) ou quando o aviso pelo WhatsApp falhou de vez — aí sai na hora da falha. */
export const HORAS_LEMBRETE = [1, 2, 3, 4, 6, 8, 12, 24] as const;
export const MODOS_SMS = ["sempre", "reserva"] as const;
export type ModoSms = (typeof MODOS_SMS)[number];
export function configSms(sms: unknown) {
  const s = (sms ?? {}) as { ligado?: unknown; confirmacao?: unknown; lembrete?: unknown; horasAntes?: unknown; modo?: unknown };
  const horas = Number(s.horasAntes);
  return {
    ligado: s.ligado === true,
    confirmacao: s.confirmacao !== false,
    lembrete: s.lembrete !== false,
    horasAntes: (HORAS_LEMBRETE as readonly number[]).includes(horas) ? horas : 2,
    modo: (s.modo === "reserva" ? "reserva" : "sempre") as ModoSms,
  };
}

/** No modo reserva: o WhatsApp oficial vai cuidar deste aviso? (canal ligado e não pausado, cliente
 *  com aceite, lembretes do WhatsApp ligados para o lembrete, e nenhuma falha já marcada deste tipo) */
export function whatsappCobre(t: { get(c: string): unknown }, a: { id: string; get(c: string): unknown }, slug: string, tipo: "confirmado" | "lembrete") {
  if (t.get("whatsapp.canalOficial") !== true || t.get("whatsapp.desligadoPelaRuphus") === true) return false;
  if (!optInDoDoc(slug, a)) return false;
  if (tipo === "lembrete" && t.get("whatsapp.remindersEnabled") !== true) return false;
  return (a.get("avisoFalhou") as { tipo?: string } | undefined)?.tipo !== tipo;
}
const SILENCIO = { inicioMin: 22 * 60, fimMin: 7 * 60 + 30 }; // 22:00 → 07:30, como o lembrete do WhatsApp

type Enviar = (numero: string, texto: string) => Promise<string | null>;
type Alertar = (assunto: string, texto: string) => Promise<unknown>;
const alertaPadrao = (db: Firestore): Alertar => (assunto, texto) => alertarAdmin(db, "sms", assunto, texto);
const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

const inicioDe = (v: unknown): Date => (v instanceof Date ? v : (v as Timestamp).toDate());
const telefoneDoNegocio = (t: FirebaseFirestore.DocumentSnapshot) => {
  const f = String(t.get("site.phone") ?? "").replace(/\D/g, "");
  return f ? formatPhone(f) : "";
};
const contato = (tel: string) => (tel ? ` Imprevisto? Ligue ${tel}.` : "");

export const textoConfirmacao = (d: { negocio: string; quando: string; servico: string; telefone: string }) =>
  `${d.negocio}: seu horario ${d.quando} (${d.servico}) esta confirmado.${contato(d.telefone)}`;
export const textoLembrete = (d: { nome: string; negocio: string; quando: string; servico: string; telefone: string }) =>
  `Lembrete${d.nome ? `, ${d.nome}` : ""}: seu horario ${d.quando} - ${d.servico} no ${d.negocio}.${contato(d.telefone)}`;

/** Reserva o envio no agendamento; false se outra execução já reservou (ou o campo já existe). */
async function reservar(db: Firestore, ref: DocumentReference, campo: "smsConfirmacaoEm" | "smsLembreteEm") {
  return db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).get(campo)) return false;
    tx.update(ref, { [campo]: Date.now() });
    return true;
  });
}

async function enviarReservado(ref: DocumentReference, campo: "smsConfirmacaoEm" | "smsLembreteEm", numero: string, texto: string, enviar: Enviar, alertar: Alertar) {
  const consumo = { canal: "sms" as const, via: "oficial" as const, tipo: campo === "smsConfirmacaoEm" ? "confirmado" as const : "lembrete" as const, fone: numero, destinatario: "cliente" as const, agendamentoId: ref.id };
  const slug = ref.parent.parent!.id;
  // pré-pago sem saldo: não sai e a reserva fica (sem nova tentativa a cada ciclo); o painel mostra "sem-saldo"
  const v = await verificarEnvio(slug, consumo);
  if (!v.envia) {
    await registrarEnvio(slug, { ...consumo, id: `sem-saldo-sms-${ref.id}-${campo}`, status: "sem-saldo", erro: v.motivo });
    return false;
  }
  try {
    const id = await enviar(numero, texto);
    if (id) await ref.update({ [`${campo.replace("Em", "Id")}`]: id }).catch(() => {});
    // consumo do negócio: SMS cobra no aceite da Comtele (sem retorno de entrega, fica "enviado").
    // O id da Comtele quando vem (só letras, números e hífen viram id de documento); senão, um gerado
    const docId = id && /^[A-Za-z0-9_-]{1,100}$/.test(id) ? `sms-${id}` : ref.firestore.collection("_").doc().id;
    await registrarEnvio(slug, { ...consumo, id: docId, status: "enviado" });
    return true;
  } catch (e) {
    // devolve a reserva: a confirmação não tenta de novo sozinha, o lembrete tenta no próximo ciclo
    await ref.update({ [campo]: FieldValue.delete() }).catch(() => {});
    console.error(`[sms] ${ref.path} ${campo}`, mensagem(e));
    const tipo = campo === "smsConfirmacaoEm" ? "confirmação" : "lembrete";
    await alertar(
      "SMS não foi enviado",
      `O SMS de ${tipo} não saiu.\n\nAgendamento: ${ref.path}\nErro: ${mensagem(e)}\n\n` +
        `Sem crédito ou chave recusada: confira em /admin → Ajustes → SMS (Testar envio) e o saldo na Comtele. ` +
        (tipo === "lembrete" ? "O lembrete tenta de novo no próximo ciclo do cron." : "A confirmação não é reenviada sozinha."),
    );
    return false;
  }
}

/** Depois que a casa confirma (painel ou CONFIRMADO no WhatsApp): o cliente recebe o SMS de confirmação.
 *  Devolve o que aconteceu, para log e teste. */
export async function avisarConfirmacaoPorSms(db: Firestore, slug: string, appointmentId: string, opcoes: { enviar?: Enviar; agora?: Date; alertar?: Alertar } = {}) {
  const alertar = opcoes.alertar ?? alertaPadrao(db);
  try {
    return await confirmacao(db, slug, appointmentId, { enviar: opcoes.enviar ?? (enviarSms as Enviar), agora: opcoes.agora ?? new Date(), alertar });
  } catch (e) {
    console.error(`[sms] confirmação ${slug}/${appointmentId}`, mensagem(e));
    await alertar("Falha no SMS de confirmação", `Erro antes do envio, em tenants/${slug}/appointments/${appointmentId}.\n\nErro: ${mensagem(e)}`);
    return "falhou";
  }
}

async function confirmacao(db: Firestore, slug: string, appointmentId: string, { enviar, agora, alertar }: { enviar: Enviar; agora: Date; alertar: Alertar }) {
  if (enviar === enviarSms && !(await smsDisponivel())) return "sem chave";
  const t = await db.doc(`tenants/${slug}`).get();
  const cfg = configSms(t.get("sms"));
  if (!cfg.ligado || !cfg.confirmacao) return "desligado";
  const ref = db.doc(`tenants/${slug}/appointments/${appointmentId}`);
  const a = await ref.get();
  if (!a.exists || a.get("status") !== "confirmed" || a.get("smsConfirmacaoEm")) return "nada a avisar";
  if (cfg.modo === "reserva" && whatsappCobre(t, a, slug, "confirmado")) return "pelo WhatsApp";
  const start = inicioDe(a.get("start"));
  const tz = fusoDe(t.get("site"));
  if (agoraNaParede(tz, agora) >= start) return "horário passou";
  const numero = numeroSms(String(a.get("customerPhone") ?? ""));
  if (!numero) return "sem celular";
  if (!(await reservar(db, ref, "smsConfirmacaoEm"))) return "já avisado";
  const texto = textoConfirmacao({
    negocio: String(t.get("name") ?? ""),
    quando: quando(dateIn(start), formatTime(start), todayIn(tz)),
    servico: String(a.get("serviceName") ?? ""),
    telefone: telefoneDoNegocio(t),
  });
  return (await enviarReservado(ref, "smsConfirmacaoEm", numero, texto, enviar, alertar)) ? "enviado" : "falhou";
}

async function lembreteDeUm(db: Firestore, t: FirebaseFirestore.DocumentSnapshot, a: FirebaseFirestore.DocumentSnapshot, hoje: string, enviar: Enviar, alertar: Alertar) {
  const numero = numeroSms(String(a.get("customerPhone") ?? ""));
  if (!numero) return "sem celular";
  if (!(await reservar(db, a.ref, "smsLembreteEm"))) return "já avisado";
  const start = inicioDe(a.get("start"));
  const texto = textoLembrete({
    nome: String(a.get("customerName") ?? "").trim().split(/\s+/)[0] ?? "",
    negocio: String(t.get("name") ?? ""),
    quando: quando(dateIn(start), formatTime(start), hoje),
    servico: String(a.get("serviceName") ?? ""),
    telefone: telefoneDoNegocio(t),
  });
  return (await enviarReservado(a.ref, "smsLembreteEm", numero, texto, enviar, alertar)) ? "enviado" : "falhou";
}

/** Modo reserva: o aviso pelo WhatsApp (confirmação ou lembrete) falhou de vez — o SMS sai agora.
 *  Fora do modo reserva o SMS já seguiu o caminho dele. Nunca lança. */
export async function smsDeReserva(db: Firestore, slug: string, appointmentId: string, tipo: "confirmado" | "lembrete", opcoes: { enviar?: Enviar; agora?: Date; alertar?: Alertar } = {}) {
  const alertar = opcoes.alertar ?? alertaPadrao(db);
  const enviar = opcoes.enviar ?? (enviarSms as Enviar);
  const agora = opcoes.agora ?? new Date();
  try {
    if (enviar === enviarSms && !(await smsDisponivel())) return "sem chave";
    const t = await db.doc(`tenants/${slug}`).get();
    const cfg = configSms(t.get("sms"));
    if (!cfg.ligado || cfg.modo !== "reserva") return "desligado";
    if (tipo === "confirmado") return cfg.confirmacao ? await confirmacao(db, slug, appointmentId, { enviar, agora, alertar }) : "desligado";
    if (!cfg.lembrete) return "desligado";
    const a = await db.doc(`tenants/${slug}/appointments/${appointmentId}`).get();
    if (!a.exists || a.get("status") !== "confirmed" || a.get("smsLembreteEm")) return "nada a avisar";
    const tz = fusoDe(t.get("site"));
    if (agoraNaParede(tz, agora) >= inicioDe(a.get("start"))) return "horário passou";
    return await lembreteDeUm(db, t, a, todayIn(tz), enviar, alertar);
  } catch (e) {
    console.error(`[sms] reserva de ${tipo} ${slug}/${appointmentId}`, mensagem(e));
    return "falhou";
  }
}

/** Lembrete por SMS X h antes (o que o negócio escolheu), para os horários confirmados. Roda no cron
 *  dos lembretes (a cada 10 min). Devolve quantos saíram. */
export async function enviarLembretesPorSms(db: Firestore, opcoes: { enviar?: Enviar; agora?: Date; alertar?: Alertar } = {}) {
  const alertar = opcoes.alertar ?? alertaPadrao(db);
  try {
    return await lembretes(db, { enviar: opcoes.enviar ?? (enviarSms as Enviar), agora: opcoes.agora ?? new Date(), alertar });
  } catch (e) {
    console.error("[sms] lembretes", mensagem(e));
    await alertar("Falha nos lembretes por SMS", `O ciclo de lembretes por SMS parou no meio.\n\nErro: ${mensagem(e)}`);
    return 0;
  }
}

async function lembretes(db: Firestore, { enviar, agora, alertar }: { enviar: Enviar; agora: Date; alertar: Alertar }) {
  if (enviar === enviarSms && !(await smsDisponivel())) return 0;
  const tenants = await db.collection("tenants").where("sms.ligado", "==", true).get();
  let enviados = 0;
  // 5 negócios de cada vez: em fila, ~100 negócios estouravam os 120 s do curl do cron
  await emParalelo(tenants.docs, 5, async (t) => {
    const cfg = configSms(t.get("sms"));
    if (!cfg.lembrete) return;
    const tz = fusoDe(t.get("site"));
    const [h, m] = formatTime(agora, tz).split(":").map(Number);
    if (h * 60 + m >= SILENCIO.inicioMin || h * 60 + m < SILENCIO.fimMin) return;
    const hoje = todayIn(tz);
    const parede = agoraNaParede(tz, agora);
    // horários que começam nas próximas X h (na hora de parede do negócio, como "start" é gravado)
    const proximos = await t.ref
      .collection("appointments")
      .where("start", ">", parede)
      .where("start", "<=", new Date(parede.getTime() + cfg.horasAntes * 3_600_000))
      .get();
    for (const a of proximos.docs) {
      if (a.get("status") !== "confirmed" || a.get("smsLembreteEm")) continue;
      // modo reserva: o lembrete do WhatsApp cobre; se ele falhar, o SMS sai pela falha (smsDeReserva)
      if (cfg.modo === "reserva" && whatsappCobre(t, a, t.id, "lembrete")) continue;
      if ((await lembreteDeUm(db, t, a, hoje, enviar, alertar)) === "enviado") enviados++;
    }
  });
  return enviados;
}

