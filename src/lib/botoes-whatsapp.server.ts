import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { enviarInterativo, enviarTemplateSemOperador, enviarTexto, OPTIN_DONO } from "@/lib/atendys";
import { avisar, quando } from "@/lib/avisos.server";
import { reschedule, rescheduleSlots } from "@/lib/booking.server";
import { conexaoOficial, idBotao, templateNovoDono, type lerBotao } from "@/lib/canal-oficial.server";
import { comAvisoSair, optInDoDoc } from "@/lib/consentimento-whatsapp";
import { addDays, agoraNaParede, chaveDoHorario, dateIn, dentroDaJanela, formatTime, fusoDe, WEEKDAYS, zonedTime } from "@/lib/datetime";
import { soDigitosComDDI } from "@/lib/telefone";
import { codigoDoAgendamento, lerConfigWhatsApp } from "@/lib/whatsapp.server";

// Botões do lembrete no canal oficial: o cliente toca em Confirmar presença, Remarcar ou Cancelar
// e a escolha chega estruturada (reply.id = rph:<ação>:<negócio>:<agendamento>[:<horário>]), sem
// interpretar texto. Remarcar devolve uma lista com os próximos horários livres; tocar num deles
// remarca. Cancelar pede confirmação (dois toques: cxx cancela, cm mantém). O id leva o horário
// de origem: o botão de um lembrete antigo não age sobre o horário novo depois de uma remarcação.
// O dono confirma/recusa pelos botões do pedido, que viram CONFIRMADO/RECUSAR no webhook.
//
// Horário: o start é gravado como hora de parede (zonedTime no fuso padrão), como no resto do
// sistema; "agora" é a hora de parede do fuso do negócio (agoraNaParede), não o instante real.

type Botao = NonNullable<ReturnType<typeof lerBotao>>;
const ATIVOS = ["booked", "confirmed"];
const DIAS_PARA_REMARCAR = 7;
const MAX_HORARIOS = 10; // limite da lista do WhatsApp
const FOLGA_MS = 60 * 60_000; // só horário com 1 h de folga
const ATOR = { uid: "whatsapp-cliente", email: "Cliente pelo WhatsApp" };

const paraData = (v: unknown) => (v instanceof Date ? v : (v as { toDate?: () => Date } | undefined)?.toDate?.() ?? null);
const linkDoNegocio = (slug: string) => `${(process.env.PUBLIC_SITE_URL ?? `https://${slug}.ruphus.site`).replace(/\/+$/, "")}/agendar/${slug}`;
const rotulo = (date: string, hora: string) => {
  const [, m, d] = date.split("-");
  return `${WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()].slice(0, 3).toLowerCase()} ${d}/${m} ${hora}`;
};
export { chaveDoHorario };

/** Próximos horários livres para o mesmo serviço e profissional (até 10, nos próximos 7 dias),
 *  sem o próprio horário atual (tocar nele "remarcaria" para o mesmo e desfaria a confirmação). */
export async function proximosHorarios(db: Firestore, slug: string, agendamento: string, atual: Date, agora: Date) {
  const hoje = dateIn(agora);
  const achados: { date: string; time: string }[] = [];
  for (let i = 0; i < DIAS_PARA_REMARCAR && achados.length < MAX_HORARIOS; i++) {
    const date = addDays(hoje, i);
    const livres = await rescheduleSlots(db, { tenantId: slug, appointmentId: agendamento, date });
    for (const time of livres) {
      const t = zonedTime(date, time).getTime();
      if (t <= agora.getTime() + FOLGA_MS || t === atual.getTime()) continue;
      achados.push({ date, time });
      if (achados.length >= MAX_HORARIOS) break;
    }
  }
  return achados;
}

/** Botão de um pedido ao dono que já não vale: o agendamento mudou de horário depois do pedido. */
export async function pedidoDesatualizado(db: Firestore, b: Botao): Promise<boolean> {
  if (!b.extra) return false; // pedido antigo, sem horário no id
  const start = paraData((await db.doc(`tenants/${b.slug}/appointments/${b.agendamento}`).get()).get("start"));
  return !start || chaveDoHorario(start) !== b.extra;
}

/** Ação do cliente por botão. Confere que o agendamento é deste telefone, que ainda vale e que
 *  o negócio está no canal oficial; avisa quem gere e responde ao cliente pelo número da
 *  plataforma (resposta: ele acabou de tocar, janela aberta). Devolve o que aconteceu (log). */
export async function acaoDoCliente(db: Firestore, b: Botao, telefone: string): Promise<string> {
  if (!["cp", "cr", "cx", "cxx", "cm", "ch"].includes(b.acao)) return "não é do cliente";
  const oficial = await conexaoOficial(db, b.slug);
  if (!oficial) return "fora do canal oficial";
  const ref = db.doc(`tenants/${b.slug}/appointments/${b.agendamento}`);
  const a = await ref.get();
  const numero = soDigitosComDDI(telefone);
  if (!a.exists || !numero || soDigitosComDDI(String(a.get("customerPhone") ?? "")) !== numero) return "agendamento de outro telefone";
  const optIn = optInDoDoc(b.slug, a);
  if (!optIn) return "sem aceite";
  // a resposta ao cliente nunca impede o aviso ao negócio nem desfaz o que já mudou
  const responder = (texto: string) => enviarTexto(oficial, numero, texto, optIn, undefined, { resposta: true })
    .then(() => undefined, (e) => console.error(`[botões] resposta ao cliente em ${b.slug}`, e));
  const tz = fusoDe((await db.doc(`tenants/${b.slug}`).get()).get("site"));
  const agora = agoraNaParede(tz);
  const hoje = dateIn(agora);
  const nome = String(a.get("customerName") ?? "").trim().split(/\s+/)[0] || "cliente";
  const servico = String(a.get("serviceName") ?? "");
  const start = paraData(a.get("start"));
  const quandoVai = start ? quando(dateIn(start), formatTime(start), hoje) : "";
  const link = linkDoNegocio(b.slug);
  const gestores = (title: string, body: string) =>
    avisar(db, b.slug, { title, body, url: `/${b.slug}`, tag: `whatsapp-${b.agendamento}` }, { soGestores: true }).catch((e) => console.error("[botões] aviso ao negócio", e));

  const status = String(a.get("status"));
  if (!ATIVOS.includes(status) || !start || start <= agora) {
    await responder(`Esse horário já não está ativo. Para agendar de novo: ${link}`);
    return "inativo";
  }
  // horário de origem no id (em ch, "<origem>_<destino>"; id antigo, sem ele, vale como antes):
  // o salão remarcou depois do lembrete, e o botão antigo não age sobre o horário novo
  const [origem, destino] = b.acao === "ch" ? (b.extra?.includes("_") ? b.extra.split("_") : [undefined, b.extra]) : [b.extra];
  if (origem && origem !== chaveDoHorario(start)) {
    await responder(`${b.acao === "ch" ? "Essa lista" : "Esse lembrete"} é de um horário que mudou; o atual é ${quandoVai}.`);
    return "horário mudou";
  }
  if (b.acao === "cm") {
    await responder(`Mantido, ${nome}: ${servico}, ${quandoVai}.`);
    return "mantido";
  }
  // sinal pago ou pendente, ou atendimento já recebido: mexer envolve dinheiro; quem decide é o negócio
  const sinal = String(a.get("sinal.status") ?? "");
  const recebido = (await db.doc(`tenants/${b.slug}/lancamentos/ag-${b.agendamento}`).get()).exists;
  if (b.acao !== "cp" && (sinal === "pago" || sinal === "pendente" || recebido)) {
    const quer = b.acao === "cx" || b.acao === "cxx" ? "cancelar" : "remarcar";
    await gestores("Cliente quer mexer no horário", `${nome} pediu para ${quer} ${servico}, ${quandoVai}. Há sinal ou pagamento: fale com o cliente.`);
    await responder(`Para ${quer} este horário, fale direto com o estabelecimento (há sinal ou pagamento envolvido).`);
    return "precisa do negócio";
  }

  if (b.acao === "cp") {
    // relido na transação: remarcado ou cancelado entre a leitura e aqui, a presença ficaria no horário novo
    const ok = await db.runTransaction(async (tx) => {
      const atual = await tx.get(ref);
      const inicio = paraData(atual.get("start"));
      if (!ATIVOS.includes(String(atual.get("status"))) || !inicio || inicio.getTime() !== start.getTime()) return false;
      tx.update(ref, { presencaConfirmadaEm: FieldValue.serverTimestamp() });
      return true;
    });
    if (!ok) {
      await responder(`Esse horário mudou ou não está mais ativo. ${link}`);
      return "inativo";
    }
    await gestores("Presença confirmada", `${nome} confirmou presença: ${servico}, ${quandoVai}.`);
    // ainda sem a confirmação do estabelecimento: não diz "confirmado"
    await responder(status === "confirmed"
      ? `Obrigado, ${nome}! Presença confirmada: ${servico}, ${quandoVai}.`
      : `Obrigado, ${nome}! Avisamos o estabelecimento que você vai: ${servico}, ${quandoVai}. Ele ainda vai confirmar o horário.`);
    return "presença confirmada";
  }

  // cancelar não tem volta: o primeiro toque só pergunta
  if (b.acao === "cx") {
    const chave = chaveDoHorario(start);
    await enviarInterativo(oficial, numero, {
      texto: `Cancelar ${servico}, ${quandoVai}?`,
      // título de botão: até 20 caracteres na Meta ("Confirmar cancelamento" tem 22)
      botoes: [{ id: idBotao("cxx", b.slug, b.agendamento, chave), title: "Sim, cancelar" }, { id: idBotao("cm", b.slug, b.agendamento, chave), title: "Manter horário" }],
    }, optIn, { resposta: true }).catch((e) => console.error(`[botões] confirmação do cancelamento em ${b.slug}`, e));
    return "confirmação pedida";
  }

  if (b.acao === "cxx") {
    const ok = await db.runTransaction(async (tx) => {
      const atual = await tx.get(ref);
      // relido na transação: o horário pode ter mudado entre a leitura e aqui
      const inicio = paraData(atual.get("start"));
      if (!ATIVOS.includes(String(atual.get("status"))) || !inicio || inicio.getTime() !== start.getTime()) return false;
      const history = db.collection(`tenants/${b.slug}/history`).doc();
      tx.create(history, { appointmentId: ref.id, type: "cancelled", reason: "whatsapp_customer", at: FieldValue.serverTimestamp(), by: ATOR.uid, byName: ATOR.email });
      tx.update(ref, { status: "cancelled", lastHistoryId: history.id });
      return true;
    });
    if (!ok) return "inativo";
    await gestores("Cliente cancelou", `${nome} cancelou pelo WhatsApp: ${servico}, ${quandoVai}. O horário foi liberado.`);
    await responder(comAvisoSair(`Pronto, ${nome}: seu horário (${servico}, ${quandoVai}) foi cancelado. Para agendar outro: ${link}`));
    return "cancelado";
  }

  if (b.acao === "cr") {
    const horarios = await proximosHorarios(db, b.slug, b.agendamento, start, agora);
    if (!horarios.length) {
      await responder(`Não há horário livre nos próximos ${DIAS_PARA_REMARCAR} dias para ${servico}. Veja outras datas em ${link} ou fale com o estabelecimento.`);
      return "sem horário";
    }
    await enviarInterativo(oficial, numero, {
      texto: `Escolha o novo horário para ${servico} (marcado para ${quandoVai}).`,
      lista: { botao: "Ver horários", itens: horarios.map((h) => ({ id: idBotao("ch", b.slug, b.agendamento, `${chaveDoHorario(start)}_${h.date}T${h.time}`), title: rotulo(h.date, h.time) })) },
    }, optIn, { resposta: true }).catch((e) => console.error(`[botões] lista de horários em ${b.slug}`, e));
    return "horários enviados";
  }

  // ch: horário escolhido na lista. O id é dado de fora: confere formato, janela e folga
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(destino ?? "");
  if (!m || !dentroDaJanela(m[1]) || zonedTime(m[1], m[2]).getTime() <= agora.getTime() + FOLGA_MS) {
    await responder("Esse horário já passou ou não está disponível. Toque em Remarcar de novo para ver os horários atualizados.");
    return "horário inválido";
  }
  if (destino === chaveDoHorario(start)) {
    await responder(`Seu horário continua: ${servico}, ${quandoVai}.`);
    return "mesmo horário";
  }
  // mantém o status: confirmado segue confirmado (o horário estava livre na agenda do negócio);
  // pedido ainda não confirmado segue aguardando o dono, que recebe o pedido novo
  const r = await reschedule(db, { tenantId: b.slug, appointmentId: b.agendamento, date: m[1], time: m[2] }, ATOR, { manterStatus: true, esperado: start });
  if (!r.ok) {
    await responder(`Não deu para remarcar: ${r.error} Toque em Remarcar de novo para ver os horários atualizados.`);
    return "horário ocupado";
  }
  const novo = quando(m[1], m[2], hoje);
  await gestores("Cliente remarcou", `${nome} remarcou pelo WhatsApp: ${servico}, de ${quandoVai} para ${novo}.${status === "confirmed" ? "" : " Aguarda sua confirmação."}`);
  if (status !== "confirmed") {
    const dono = (await lerConfigWhatsApp(db, b.slug))?.ownerPhone;
    const donoNumero = dono ? soDigitosComDDI(dono) : null;
    if (donoNumero) {
      const negocio = String((await db.doc(`tenants/${b.slug}`).get()).get("name") ?? "").trim() || b.slug;
      await enviarTemplateSemOperador(oficial, donoNumero, templateNovoDono(
        { negocio, cliente: String(a.get("customerName") ?? nome), telefone: String(a.get("customerPhone") ?? ""), servico, quando: `${novo} (remarcado)`, codigo: codigoDoAgendamento(b.agendamento, 12) },
        { slug: b.slug, agendamento: b.agendamento, horario: destino },
        // prazo: o horário novo no fuso do negócio (instante real)
      ), OPTIN_DONO, zonedTime(m[1], m[2], tz)).catch((e) => console.error("[botões] pedido da remarcação ao dono", e));
    }
  }
  await responder(status === "confirmed"
    ? `Remarcado, ${nome}: ${servico}, ${novo}. Até lá!`
    : `Remarcado, ${nome}: ${servico}, ${novo}. O estabelecimento vai confirmar e avisamos por aqui.`);
  return "remarcado";
}
