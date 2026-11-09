import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { enviarInterativo, enviarTemplateSemOperador, enviarTexto, OPTIN_DONO } from "@/lib/atendys";
import { avisar, quando } from "@/lib/avisos.server";
import { reschedule, rescheduleSlots } from "@/lib/booking.server";
import { conexaoOficial, idBotao, templateNovoDono, type lerBotao } from "@/lib/canal-oficial.server";
import { comAvisoSair, optInDoDoc } from "@/lib/consentimento-whatsapp";
import { addDays, dateIn, formatTime, todayIn, WEEKDAYS, zonedTime } from "@/lib/datetime";
import { soDigitosComDDI } from "@/lib/telefone";
import { codigoDoAgendamento, lerConfigWhatsApp } from "@/lib/whatsapp.server";

// Botões do lembrete no canal oficial: o cliente toca em Confirmar presença, Remarcar ou Cancelar
// e a escolha chega estruturada (reply.id = rph:<ação>:<negócio>:<agendamento>), sem interpretar
// texto. Remarcar devolve uma lista com os próximos horários livres; tocar num deles remarca.
// O dono confirma/recusa pelos botões do pedido, que viram o comando CONFIRMADO/RECUSAR no webhook.

type Botao = NonNullable<ReturnType<typeof lerBotao>>;
const ATIVOS = ["booked", "confirmed"];
const DIAS_PARA_REMARCAR = 7;
const MAX_HORARIOS = 10; // limite da lista do WhatsApp
const ATOR = { uid: "whatsapp-cliente", email: "Cliente pelo WhatsApp" };

const paraData = (v: unknown) => (v instanceof Date ? v : (v as { toDate?: () => Date } | undefined)?.toDate?.() ?? null);
const linkDoNegocio = (slug: string) => `${(process.env.PUBLIC_SITE_URL ?? `https://${slug}.ruphus.site`).replace(/\/+$/, "")}/agendar/${slug}`;
const rotulo = (date: string, hora: string) => {
  const [, m, d] = date.split("-");
  return `${WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()].slice(0, 3).toLowerCase()} ${d}/${m} ${hora}`;
};

/** Próximos horários livres para o mesmo serviço e profissional (até 10, nos próximos 7 dias). */
export async function proximosHorarios(db: Firestore, slug: string, agendamento: string, agora = new Date()) {
  const hoje = todayIn();
  const folga = agora.getTime() + 60 * 60_000; // só horário com 1 h de folga
  const achados: { date: string; time: string }[] = [];
  for (let i = 0; i < DIAS_PARA_REMARCAR && achados.length < MAX_HORARIOS; i++) {
    const date = addDays(hoje, i);
    const livres = await rescheduleSlots(db, { tenantId: slug, appointmentId: agendamento, date });
    for (const time of livres) {
      if (zonedTime(date, time).getTime() <= folga) continue;
      achados.push({ date, time });
      if (achados.length >= MAX_HORARIOS) break;
    }
  }
  return achados;
}

/** Ação do cliente por botão. Confere que o agendamento é deste telefone, que ainda vale e que
 *  o negócio está no canal oficial; responde pelo número da plataforma (janela aberta: ele acabou
 *  de tocar) e avisa quem gere. Devolve o que aconteceu (para o log). */
export async function acaoDoCliente(db: Firestore, b: Botao, telefone: string): Promise<string> {
  if (!["cp", "cr", "cx", "ch"].includes(b.acao)) return "não é do cliente";
  const oficial = await conexaoOficial(db, b.slug);
  if (!oficial) return "fora do canal oficial";
  const ref = db.doc(`tenants/${b.slug}/appointments/${b.agendamento}`);
  const a = await ref.get();
  const numero = soDigitosComDDI(telefone);
  if (!a.exists || !numero || soDigitosComDDI(String(a.get("customerPhone") ?? "")) !== numero) return "agendamento de outro telefone";
  const optIn = optInDoDoc(b.slug, a);
  if (!optIn) return "sem aceite";
  const responder = (texto: string) => enviarTexto(oficial, numero, texto, optIn);
  const nome = String(a.get("customerName") ?? "").trim().split(/\s+/)[0] || "cliente";
  const servico = String(a.get("serviceName") ?? "");
  const start = paraData(a.get("start"));
  const quandoVai = start ? quando(dateIn(start), formatTime(start)) : "";
  const link = linkDoNegocio(b.slug);
  const gestores = (title: string, body: string) =>
    avisar(db, b.slug, { title, body, url: `/${b.slug}`, tag: `whatsapp-${b.agendamento}` }).catch((e) => console.error("[botões] aviso ao negócio", e));

  if (!ATIVOS.includes(String(a.get("status"))) || !start || start <= new Date()) {
    await responder(`Esse horário já não está ativo. Para agendar de novo: ${link}`);
    return "inativo";
  }
  // sinal pago ou atendimento já recebido: mexer envolve devolução; quem decide é o negócio
  const sinal = String(a.get("sinal.status") ?? "");
  const recebido = (await db.doc(`tenants/${b.slug}/lancamentos/ag-${b.agendamento}`).get()).exists;
  if ((b.acao === "cx" || b.acao === "cr" || b.acao === "ch") && (sinal === "pago" || sinal === "pendente" || recebido)) {
    await responder(`Para ${b.acao === "cx" ? "cancelar" : "remarcar"} este horário, fale direto com o estabelecimento (há sinal ou pagamento envolvido).`);
    await gestores("Cliente quer mexer no horário", `${nome} pediu para ${b.acao === "cx" ? "cancelar" : "remarcar"} ${servico}, ${quandoVai}. Há sinal ou pagamento: fale com o cliente.`);
    return "precisa do negócio";
  }

  if (b.acao === "cp") {
    await ref.update({ presencaConfirmadaEm: FieldValue.serverTimestamp() });
    await responder(`Obrigado, ${nome}! Presença confirmada: ${servico}, ${quandoVai}.`);
    await gestores("Presença confirmada", `${nome} confirmou presença: ${servico}, ${quandoVai}.`);
    return "presença confirmada";
  }

  if (b.acao === "cx") {
    const ok = await db.runTransaction(async (tx) => {
      const atual = await tx.get(ref);
      if (!ATIVOS.includes(String(atual.get("status")))) return false;
      const history = db.collection(`tenants/${b.slug}/history`).doc();
      tx.create(history, { appointmentId: ref.id, type: "cancelled", reason: "whatsapp_customer", at: FieldValue.serverTimestamp(), by: ATOR.uid, byName: ATOR.email });
      tx.update(ref, { status: "cancelled", lastHistoryId: history.id });
      return true;
    });
    if (!ok) return "inativo";
    await responder(comAvisoSair(`Pronto, ${nome}: seu horário (${servico}, ${quandoVai}) foi cancelado. Para agendar outro: ${link}`));
    await gestores("Cliente cancelou", `${nome} cancelou pelo WhatsApp: ${servico}, ${quandoVai}. O horário foi liberado.`);
    return "cancelado";
  }

  if (b.acao === "cr") {
    const horarios = await proximosHorarios(db, b.slug, b.agendamento);
    if (!horarios.length) {
      await responder(`Não há horário livre nos próximos ${DIAS_PARA_REMARCAR} dias para ${servico}. Veja outras datas em ${link} ou fale com o estabelecimento.`);
      return "sem horário";
    }
    await enviarInterativo(oficial, numero, {
      texto: `Escolha o novo horário para ${servico} (hoje: ${quandoVai}). O estabelecimento confirma em seguida.`,
      lista: { botao: "Ver horários", itens: horarios.map((h) => ({ id: idBotao("ch", b.slug, b.agendamento, `${h.date}T${h.time}`), title: rotulo(h.date, h.time) })) },
    }, optIn);
    return "horários enviados";
  }

  // ch: horário escolhido na lista
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(b.extra ?? "");
  if (!m) return "horário inválido";
  const r = await reschedule(db, { tenantId: b.slug, appointmentId: b.agendamento, date: m[1], time: m[2] }, ATOR);
  if (!r.ok) {
    await responder(`Não deu para remarcar: ${r.error} Toque em Remarcar de novo para ver os horários atualizados.`);
    return "horário ocupado";
  }
  const novo = quando(m[1], m[2]);
  await responder(`Remarcado, ${nome}: ${servico}, ${novo}. O estabelecimento vai confirmar e avisamos por aqui.`);
  await gestores("Cliente remarcou", `${nome} remarcou pelo WhatsApp: ${servico}, de ${quandoVai} para ${novo}. Aguarda sua confirmação.`);
  // remarcado volta a "booked": o dono confirma pelo mesmo pedido (com botões)
  const dono = (await lerConfigWhatsApp(db, b.slug))?.ownerPhone;
  const donoNumero = dono ? soDigitosComDDI(dono) : null;
  if (donoNumero) {
    const negocio = String((await db.doc(`tenants/${b.slug}`).get()).get("name") ?? "").trim() || b.slug;
    await enviarTemplateSemOperador(oficial, donoNumero, templateNovoDono(
      { negocio, cliente: String(a.get("customerName") ?? nome), telefone: String(a.get("customerPhone") ?? ""), servico, quando: `${novo} (remarcado)`, codigo: codigoDoAgendamento(b.agendamento, 12) },
      { slug: b.slug, agendamento: b.agendamento },
    ), OPTIN_DONO, zonedTime(m[1], m[2])).catch((e) => console.error("[botões] aviso de remarcação ao dono", e));
  }
  return "remarcado";
}
