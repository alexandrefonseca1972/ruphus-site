import "server-only";
import { FieldValue, type DocumentReference, type DocumentSnapshot, type Firestore } from "firebase-admin/firestore";
import { enviarTexto } from "@/lib/atendys";
import { avisar, quando } from "@/lib/avisos.server";
import { book, reschedule } from "@/lib/booking.server";
import { conexaoOficial, contatoDoNegocio, destaque, type lerBotao } from "@/lib/canal-oficial.server";
import { optInDaEspera } from "@/lib/consentimento-whatsapp";
import { dateIn, formatBRL, formatTime, fusoDe } from "@/lib/datetime";
import { reofertar, type AvisoAtual, type Enviar } from "@/lib/fila-espera.server";
import { esperaLigada, type Modulos } from "@/lib/modulos";
import { brCode } from "@/lib/pix";
import { soDigitosComDDI } from "@/lib/telefone";

// Botões da oferta de vaga da fila de espera (canal oficial). O cliente toca em uma das quatro opções
// e a escolha chega como rph:<ação>:<negócio>:<espera>:<horário>. Ações: eq (quero o horário oferecido),
// es (só serve o meu preferido), en (não quero mais), et (trocar meu horário pelo oferecido), em (manter
// meu horário). O horário oferecido vem no id e é conferido com o aviso gravado na espera.

type Botao = NonNullable<ReturnType<typeof lerBotao>>;
const ATIVAS = ["aguardando", "avisada"];
const ATOR = { uid: "whatsapp-cliente", email: "Cliente pelo WhatsApp" };

const paraData = (v: unknown): Date | null => (v instanceof Date ? v : (v as { toDate?: () => Date } | undefined)?.toDate?.() ?? null);

/** O aviso valendo para este botão: a espera está avisada pelo horário que o id traz. */
const avisoDoBotao = (d: DocumentSnapshot, extra?: string): AvisoAtual | null => {
  const a = d.get("avisoAtual") as AvisoAtual | undefined;
  return d.get("status") === "avisada" && a && `${a.data}T${a.inicio}` === extra ? a : null;
};

/** A espera ainda está neste aviso (o mesmo evento)? */
const noAviso = (d: DocumentSnapshot, a: AvisoAtual) => d.get("status") === "avisada" && d.get("avisoAtual.eventoId") === a.eventoId;

/** Muda a espera só se a condição ainda vale; a leitura é da transação, antes da escrita. Devolve a espera
 *  como estava antes da mudança (null: não mudou), para quem chama saber se ela largou um aviso. */
const mudarSe = (db: Firestore, ref: DocumentReference, pode: (d: DocumentSnapshot) => boolean, mudanca: Record<string, unknown>) =>
  db.runTransaction(async (tx) => {
    const atual = await tx.get(ref);
    if (!atual.exists || !pode(atual)) return null;
    tx.update(ref, mudanca);
    return atual;
  });

/** Resposta do cliente a um botão da fila. Devolve o que aconteceu (log). responder é injetável (testes);
 *  em produção sai pelo canal oficial do negócio, como resposta (a janela já está aberta). */
export async function respostaDaEspera(
  db: Firestore,
  b: Botao,
  telefone: string,
  opts: { responder?: (texto: string) => Promise<void>; agora?: Date; enviar?: Enviar } = {},
): Promise<string> {
  if (!["eq", "es", "en", "et", "em"].includes(b.acao)) return "não é da fila";
  const agora = opts.agora ?? new Date();
  const tenant = await db.doc(`tenants/${b.slug}`).get();
  const ref = db.doc(`tenants/${b.slug}/espera/${b.agendamento}`);
  const e = await ref.get();
  const numero = soDigitosComDDI(telefone);
  // o id da espera é público: só o telefone que a fez pode responder por ela
  if (!e.exists || !numero || soDigitosComDDI(String(e.get("telefone") ?? "")) !== numero) return "outro telefone";
  const consentimento = paraData(e.get("consentimento.em"));
  if (!consentimento) return "sem aceite";

  const tz = fusoDe(tenant.get("site"));
  const hoje = dateIn(agora, tz);
  const negocio = destaque(String(tenant.get("name") ?? "").trim() || b.slug);
  const contato = contatoDoNegocio(tenant);
  const nome = String(e.get("nome") ?? "").trim().split(/\s+/)[0] || "cliente";
  const optIn = optInDaEspera({ tenantId: b.slug, esperaId: b.agendamento, em: consentimento, tipo: String(e.get("tipo")) });
  const responder =
    opts.responder ??
    (async (texto: string) => {
      const oficial = await conexaoOficial(db, b.slug);
      if (oficial) await enviarTexto(oficial, numero, texto, optIn, undefined, { resposta: true });
    });
  const dizer = (texto: string) => responder(texto).catch((erro) => console.error(`[fila] resposta ao cliente em ${b.slug}`, erro));
  // módulo desligado depois do aviso: quem tocou é o dono da espera (conferido acima) e fica sabendo
  if (!esperaLigada(tenant.get("modulos") as Modulos)) {
    await dizer(`A fila de espera de ${negocio} foi encerrada.`);
    return "desligado";
  }
  const status = String(e.get("status"));
  const ativa = ATIVAS.includes(status);
  const venceu = () => (ativa ? "Esse aviso já venceu. Você continua na fila e avisamos se vagar outro horário." : "Essa espera já terminou.");
  // a espera largou o aviso antes do prazo: a vaga vai já à próxima espera (o motor do cron faria no prazo)
  const liberar = (aviso: AvisoAtual) =>
    reofertar(db, b.slug, aviso, { agora, enviar: opts.enviar })
      .then((r) => console.log(`[fila] vaga ${aviso.eventoId} de ${b.slug} reofertada: ${r}`))
      .catch((erro) => console.error(`[fila] reoferta da vaga ${aviso.eventoId} em ${b.slug}`, erro));
  const largou = async (antes: DocumentSnapshot | null) => {
    if (antes?.get("status") === "avisada") await liberar(antes.get("avisoAtual") as AvisoAtual);
  };

  if (b.acao === "eq") {
    if (e.get("tipo") === "troca") {
      await dizer("Use o botão Trocar de horário.");
      return "troca";
    }
    const guardado = e.get("avisoAtual") as AvisoAtual | undefined;
    // toque repetido numa espera já agendada (o mesmo botão): o pedido devolve a mesma reserva, sem prazo,
    // se ela ainda vale; cancelada, a espera acabou e não vira reserva nova
    const repetido = status === "agendada" && !!guardado && `${guardado.data}T${guardado.inicio}` === b.extra;
    if (repetido) {
      const ja = await db.doc(`tenants/${b.slug}/appointments/${String(e.get("agendamentoId") ?? "") || "sem-agendamento"}`).get();
      if (!["booked", "confirmed"].includes(String(ja.get("status")))) {
        await dizer("Essa espera já terminou.");
        return "terminou";
      }
    }
    const a = repetido ? guardado : avisoDoBotao(e, b.extra);
    if (!a || (!repetido && agora.getTime() > a.prazo)) {
      await dizer(venceu());
      return ativa ? "aviso vencido" : "terminou";
    }
    // o pedido (espera + evento) faz a repetição achar a mesma reserva, não outra
    const r = await book(db, {
      tenantId: b.slug,
      serviceIds: e.get("serviceIds") as string[],
      staffId: a.staffId,
      date: a.data,
      time: a.inicio,
      customerName: String(e.get("nome") ?? "").trim(),
      // a chave com o 55 (13 dígitos): phoneError aceita, e nada é cortado
      customerPhone: numero,
      pedido: `espera-${b.agendamento}-${a.eventoId}`,
      aceiteWhatsapp: false,
    });
    if (!r.ok) {
      if (r.error.startsWith("Esse horário acabou de ser ocupado")) {
        await mudarSe(db, ref, (d) => noAviso(d, a), { status: "aguardando", avisoAtual: FieldValue.delete() });
        await dizer("Poxa, esse horário acabou de ser marcado. Você continua na fila.");
        return "ocupado";
      }
      console.error(`[fila] reserva pela espera ${b.agendamento} em ${b.slug}: ${r.error}`);
      await dizer(`Não consegui reservar agora. Fale com ${negocio}: ${contato}.`);
      return "falhou";
    }
    // a reserva vale mesmo que o prazo tenha passado no meio tempo (expirarAvisos a pôs em aguardando);
    // agendada por outra reserva, saiu ou expirou: não sobrescreve, só registra
    const fim = await db.runTransaction(async (tx) => {
      const atual = await tx.get(ref);
      const st = String(atual.get("status"));
      if (st === "agendada" && atual.get("agendamentoId") === r.id) return "repetido" as const;
      if (!ATIVAS.includes(st)) return "mudou" as const;
      tx.update(ref, { status: "agendada", agendamentoId: r.id, agendadaEm: agora.getTime(), avisoAtual: a });
      // avisada de outra vaga no meio tempo: essa outra vaga fica para a próxima espera
      return st === "avisada" && atual.get("avisoAtual.eventoId") !== a.eventoId ? (atual.get("avisoAtual") as AvisoAtual) : ("agendada" as const);
    });
    if (fim === "mudou") console.error(`[fila] reserva ${r.id} feita, mas a espera ${b.agendamento} já tinha terminado`);
    const quandoTxt = quando(r.date, r.time, hoje);
    if (fim !== "repetido") {
      avisar(db, b.slug, { title: "Novo agendamento pela fila de espera", body: `${nome} · ${r.serviceName} · ${quandoTxt}`, url: `/${b.slug}`, tag: `espera-${b.agendamento}` }, { soGestores: true })
        .catch((erro) => console.error(`[fila] aviso ao negócio ${b.slug}`, erro));
    }
    let texto = `Pronto, ${nome}! Reservamos ${r.serviceName}, ${quandoTxt}. ${negocio} confirma o horário com você. Lembretes deste horário não chegam por aqui.`;
    if (r.sinal) {
      const ate = new Date(r.sinal.ate);
      texto += ` Para garantir, pague o sinal de ${formatBRL(r.sinal.cents)} até ${quando(dateIn(ate, tz), formatTime(ate, tz), hoje)} com o Pix copia e cola abaixo.`;
    }
    await dizer(texto);
    if (r.sinal) {
      try {
        await dizer(brCode({ ...r.sinal.pix, valorCents: r.sinal.cents, txid: r.sinal.txid }));
      } catch (erro) {
        console.error(`[fila] Pix do sinal em ${b.slug}`, erro);
      }
    }
    if (typeof fim === "object") await liberar(fim);
    return "agendada";
  }

  if (b.acao === "es") {
    // só o preferido: vale para as próximas vagas; se este aviso era de outro horário, ele volta à fila
    const volta = await db.runTransaction(async (tx) => {
      const atual = await tx.get(ref);
      if (!ATIVAS.includes(atual.get("status"))) return "terminou";
      const aviso = avisoDoBotao(atual, b.extra);
      tx.update(ref, aviso ? { exato: true, status: "aguardando", avisoAtual: FieldValue.delete() } : { exato: true });
      return aviso ?? "exato";
    });
    if (volta === "terminou") {
      await dizer("Essa espera já terminou.");
      return "terminou";
    }
    await dizer(`Certo: só avisamos se vagar ${String(e.get("preferido") ?? "")}.`);
    if (volta === "exato") return "exato";
    await liberar(volta);
    return "volta";
  }

  if (b.acao === "en") {
    const saiu = await mudarSe(db, ref, (d) => ATIVAS.includes(d.get("status")), { status: "saiu", saiuEm: agora.getTime(), motivo: "whatsapp", avisoAtual: FieldValue.delete() });
    await dizer(saiu ? `Pronto, você saiu da fila de ${negocio}.` : "Essa espera já terminou.");
    await largou(saiu);
    return saiu ? "saiu" : "terminou";
  }

  // et e em: o horário atual do cliente (o da troca)
  const idAg = String(e.get("agendamentoId") ?? "");
  const ag = await db.doc(`tenants/${b.slug}/appointments/${idAg || "sem-agendamento"}`).get();
  const inicioAntigo = paraData(ag.get("start"));
  const antigo = inicioAntigo ? quando(dateIn(inicioAntigo), formatTime(inicioAntigo), hoje) : "";

  if (b.acao === "em") {
    const saiu = await mudarSe(db, ref, (d) => ATIVAS.includes(d.get("status")), { status: "saiu", saiuEm: agora.getTime(), motivo: "manteve", avisoAtual: FieldValue.delete() });
    await dizer(saiu ? `Certo, mantivemos ${antigo || "seu horário"}.` : "Essa espera já terminou.");
    await largou(saiu);
    return saiu ? "mantido" : "terminou";
  }

  // et: troca pelo horário oferecido (só na espera de troca, com o aviso valendo)
  const a = e.get("tipo") === "troca" ? avisoDoBotao(e, b.extra) : null;
  if (!a || agora.getTime() > a.prazo) {
    await dizer(venceu());
    return ativa ? "aviso vencido" : "terminou";
  }
  const novo = quando(a.data, a.inicio, hoje);
  /** A troca não acontece por aqui: a espera deixa o aviso e a vaga vai já à próxima espera. */
  const deixar = async (mudanca: Record<string, unknown>) => {
    if (await mudarSe(db, ref, (d) => noAviso(d, a), { ...mudanca, avisoAtual: FieldValue.delete() })) await liberar(a);
  };
  if (!ag.exists || !inicioAntigo || !["booked", "confirmed"].includes(String(ag.get("status"))) || soDigitosComDDI(String(ag.get("customerPhone") ?? "")) !== numero) {
    await dizer("Esse agendamento já não está ativo.");
    await deixar({ status: "saiu", saiuEm: agora.getTime(), motivo: "agendamento-inativo" });
    return "agendamento inativo";
  }
  // a remarcação mantém o profissional do agendamento: outro profissional não é troca (o motor já não oferece)
  if (ag.get("staffId") !== a.staffId) {
    await dizer(`Esse horário é com outro profissional. Fale com ${negocio}.`);
    await deixar({ status: "aguardando" });
    return "outro profissional";
  }
  // sinal pago ou pendente, ou atendimento já recebido: mexer envolve dinheiro; quem decide é o negócio
  // (a mesma regra dos botões do lembrete)
  const sinal = String(ag.get("sinal.status") ?? "");
  if (sinal === "pago" || sinal === "pendente" || (await db.doc(`tenants/${b.slug}/lancamentos/ag-${ag.id}`).get()).exists) {
    avisar(db, b.slug, { title: "Cliente quer trocar pela fila de espera", body: `${nome} quer trocar ${antigo} por ${novo}. Há sinal ou pagamento: fale com o cliente.`, url: `/${b.slug}`, tag: `espera-${b.agendamento}` }, { soGestores: true })
      .catch((erro) => console.error(`[fila] aviso da troca com sinal em ${b.slug}`, erro));
    await dizer(`Para trocar este horário, fale com ${negocio}: ${contato} (há sinal ou pagamento envolvido).`);
    await deixar({ status: "saiu", saiuEm: agora.getTime(), motivo: "precisa-do-negocio" });
    return "precisa do negócio";
  }
  // o horário que o cliente viu: se o salão mexeu nele até aqui, a troca não acontece
  const r = await reschedule(db, { tenantId: b.slug, appointmentId: ag.id, date: a.data, time: a.inicio }, ATOR, { manterStatus: true, esperado: inicioAntigo });
  if (!r.ok) {
    await mudarSe(db, ref, (d) => noAviso(d, a), { status: "aguardando", avisoAtual: FieldValue.delete() });
    await dizer(
      r.error.includes("não está livre")
        ? `Esse horário acabou de ser marcado. Seu horário de ${antigo} continua.`
        : `Não consegui trocar agora. Seu horário de ${antigo} continua. Fale com ${negocio}: ${contato}.`,
    );
    return "ocupado";
  }
  // a troca vale mesmo que o prazo tenha passado no meio tempo (expirarAvisos a pôs em aguardando)
  const antes = await mudarSe(db, ref, (d) => ATIVAS.includes(d.get("status")), { status: "trocada", trocadaEm: agora.getTime(), avisoAtual: FieldValue.delete() });
  if (!antes) console.error(`[fila] troca ${ag.id} feita, mas a espera ${b.agendamento} já tinha terminado`);
  avisar(db, b.slug, { title: "Cliente trocou de horário pela fila de espera", body: `${nome} · ${String(ag.get("serviceName") ?? "")} · de ${antigo} para ${novo}`, url: `/${b.slug}`, tag: `espera-${b.agendamento}` }, { soGestores: true })
    .catch((erro) => console.error(`[fila] aviso da troca em ${b.slug}`, erro));
  await dizer(`Pronto! Seu horário agora é ${novo}. O horário de ${antigo} foi liberado.`);
  // avisada de outra vaga no meio tempo: essa outra vaga fica para a próxima espera
  if (antes?.get("status") === "avisada" && antes.get("avisoAtual.eventoId") !== a.eventoId) await liberar(antes.get("avisoAtual") as AvisoAtual);
  return "trocada";
}
