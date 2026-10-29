import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { quando } from "@/lib/avisos.server";
import { dateIn, formatTime } from "@/lib/datetime";
import { soDigitosComDDI } from "@/lib/telefone";
import { getStatus, sendText } from "@/lib/wtsfy";

// O WhatsApp que o dono conectou ao próprio negócio: qual instância do gateway
// wtsfy, o número pareado e o estado da conexão. Campo `whatsapp` do documento
// tenants/{slug} — o mesmo lugar de site, agenda e limiteStaff.
//
// ownerPhone é o número PESSOAL do dono: quem recebe os avisos de novo
// agendamento e confirma respondendo CONFIRMADO. Tem de ser um aparelho
// separado do número conectado: o que o dono manda do próprio número (self-chat)
// chega ao gateway de forma instável.

export type ConexaoWhatsapp = {
  instanceId: string;
  phone: string | null;
  status: string;
  statusReason?: string | null;
  updatedAt: number;
  ownerPhone?: string | null;
  /** Quem pode gerenciar a conexão no painel do dono. false = só a plataforma
   *  (/admin tem prioridade); true = o dono pode conectar/alterar; ausente =
   *  ninguém configurou ainda — dono pode conectar, e a plataforma continua
   *  podendo assumir a qualquer momento (e aí volta a false). */
  ownerManaged?: boolean;
  /** Aceite do termo de risco pelo dono (painel dele). Só o dono aceita;
   *  preservado ao desconectar — só sai se a plataforma resetar a seção. */
  termsAcceptedAt?: number | null;
  termsVersion?: number | null;
  /** Lembretes automáticos no dia do horário: o dono escolhe quantas horas antes
   *  de cada agendamento confirmado o cliente recebe o lembrete; o job
   *  (lembretes-whatsapp.server) varre os agendamentos e avisa cada cliente uma
   *  vez, dentro da janela [início - horas, início). */
  remindersEnabled?: boolean;
  remindersBeforeHours?: number | null;
  /** Última falha ao avisar o dono de um agendamento (gateway fora, envio
   *  rejeitado…). Visível na gaveta; sumir quando um aviso sai com sucesso. */
  lastNotifyError?: { message: string; at: number } | null;
};

export { soDigitosComDDI };

export async function lerConexao(db: Firestore, slug: string): Promise<ConexaoWhatsapp | null> {
  const t = await db.doc(`tenants/${slug}`).get();
  const w = t.get("whatsapp") as ConexaoWhatsapp | undefined;
  return w?.instanceId ? w : null;
}

/** O mapa whatsapp inteiro, com ou sem conexão — o termo pode estar aceito sem
 *  instância, e o painel do dono precisa enxergar isso. */
export async function lerConfigWhatsApp(db: Firestore, slug: string): Promise<ConexaoWhatsapp | null> {
  const t = await db.doc(`tenants/${slug}`).get();
  return (t.get("whatsapp") as ConexaoWhatsapp | undefined) ?? null;
}

/** Aceite do termo de risco pelo dono. Idempotente: guarda só o primeiro. */
export async function aceitarTermoWhatsApp(db: Firestore, slug: string): Promise<void> {
  const ref = db.doc(`tenants/${slug}`);
  await db.runTransaction(async (tx) => {
    const w = (await tx.get(ref)).get("whatsapp") as ConexaoWhatsapp | undefined;
    if (w?.termsAcceptedAt) return;
    tx.set(ref, { whatsapp: { termsAcceptedAt: Date.now(), termsVersion: 1 } }, { merge: true });
  });
}

/** Soltar a conexão sem apagar a seção: preserva o aceite do termo e a marca
 *  de quem gerencia (o dono desconectando não zera o histórico de aceite). */
export async function desligarConexao(db: Firestore, slug: string): Promise<void> {
  await db.doc(`tenants/${slug}`).set(
    {
      whatsapp: {
        instanceId: FieldValue.delete(),
        phone: FieldValue.delete(),
        status: "disconnected",
        statusReason: FieldValue.delete(),
        updatedAt: Date.now(),
      },
    },
    { merge: true },
  );
}

/** Delegar (ou retomar) a gestão da conexão ao painel do dono. /admin decide. */
export async function gravarGestaoDono(db: Firestore, slug: string, permitir: boolean): Promise<void> {
  await db.doc(`tenants/${slug}`).set({ whatsapp: { ownerManaged: permitir } }, { merge: true });
}

export async function gravarConexao(db: Firestore, slug: string, conexao: ConexaoWhatsapp) {
  await db.doc(`tenants/${slug}`).set({ whatsapp: conexao }, { merge: true });
}

export async function apagarConexao(db: Firestore, slug: string) {
  await db.doc(`tenants/${slug}`).update({ whatsapp: FieldValue.delete() });
}

/** O número pessoal do dono: recebe os avisos e confirma respondendo. Vazio desliga. */
export async function gravarOwnerPhone(db: Firestore, slug: string, ownerPhone: string | null) {
  await db.doc(`tenants/${slug}`).set({ whatsapp: { ownerPhone } }, { merge: true });
}

/** Aviso de novo agendamento não chegou ao dono: grava para a gaveta mostrar
 *  (em vez de sumir no log). null limpa o registro — um aviso bem-sucedido
 *  prova que a esteira voltou a funcionar. */
export async function registrarErroNotificacao(db: Firestore, slug: string, erro: { message: string; at: number } | null) {
  await db.doc(`tenants/${slug}`).set(
    { whatsapp: { lastNotifyError: erro ?? FieldValue.delete() } },
    { merge: true },
  );
}

/** De qual negócio é esta instância do gateway: o webhook só traz o instanceId. */
export async function tenantDaInstancia(db: Firestore, instanceId: string): Promise<string | null> {
  const snap = await db.collection("tenants").where("whatsapp.instanceId", "==", instanceId).limit(1).get();
  return snap.empty ? null : snap.docs[0]!.id;
}

/** Mensagem que chegou no WhatsApp do negócio: vai para a caixa de entrada dele.
 *  Devolve true quando a mensagem é NOVA. O gateway entrega at-least-once: o
 *  mesmo messageId pode chegar de novo, e quem decide se há efeito é quem chama. */
export async function registrarMensagemRecebida(
  db: Firestore,
  slug: string,
  msg: { phone?: string; messageId?: string; data: unknown; timestamp?: string | number },
): Promise<boolean> {
  // id vindo de fora vira caminho de documento: só letras, números, "_" e "-"
  const ref = msg.messageId
    ? db.collection(`tenants/${slug}/whatsappInbox`).doc(msg.messageId.replace(/[^A-Za-z0-9_-]/g, "_"))
    : db.collection(`tenants/${slug}/whatsappInbox`).doc();
  try {
    await ref.create({
      phone: msg.phone ?? null,
      messageId: msg.messageId ?? null,
      data: msg.data ?? null,
      timestamp: msg.timestamp ?? null,
      receivedAt: Date.now(),
    });
    return true;
  } catch (e) {
    if ((e as { code?: string }).code === "already-exists") return false;
    throw e;
  }
}

/** O gateway avisou que a conexão mudou de estado: espelha no negócio.
 *  `reason` vem junto (banned, session_revoked_repeated, watchdog…) pra a
 *  gaveta explicar o que aconteceu, não só o estado. */
export async function espelharStatusDaInstancia(
  db: Firestore,
  slug: string,
  dados: { status?: unknown; phone?: unknown; reason?: unknown },
) {
  const status = String(dados.status ?? "");
  if (!status) return;
  const reason = typeof dados.reason === "string" && dados.reason ? dados.reason : null;
  await db.doc(`tenants/${slug}`).set(
    {
      whatsapp: {
        status,
        ...(reason ? { statusReason: reason } : {}),
        ...(typeof dados.phone === "string" && dados.phone ? { phone: dados.phone } : {}),
        updatedAt: Date.now(),
      },
    },
    { merge: true },
  );
}

/** Código curto do agendamento no aviso ao salão ("CONFIRMADO AB12"): é ele que diz a
 *  qual aviso o dono respondeu quando há mais de um pendente. */
export const codigoDoAgendamento = (id: string) => id.slice(0, 4).toUpperCase();

/** O salão respondeu ao aviso de agendamento no próprio WhatsApp: CONFIRMADO
 *  confirma o agendamento pendente mais recente; RECUSAR cancela. Em ambos os
 *  casos o cliente é avisado pelo número do salão. O comando pode vir do
 *  self-chat do salão (dono operando o próprio número — comunicação toda pelo
 *  número do negócio) ou do WhatsApp pessoal dele, quando cadastrado como
 *  fallback. Não é comando: "ignorado" (a mensagem já ficou na caixa de
 *  entrada, como qualquer outra). */
export async function processarComandoAgendamento(
  db: Firestore,
  slug: string,
  msg: { phone?: string; data: unknown },
): Promise<"ignorado" | "sem pendente" | "confirmado" | "recusado"> {
  const conexao = await lerConexao(db, slug);
  const dono = conexao?.ownerPhone ? soDigitosComDDI(conexao.ownerPhone) : null;
  const numeroSalao = conexao?.phone ? soDigitosComDDI(conexao.phone) : null;
  const remetente = msg.phone ? soDigitosComDDI(msg.phone) : null;
  if (!conexao || remetente == null) return "ignorado";
  // quem manda no fluxo é o número do salão (self-chat do dono) ou, em
  // fallback, o WhatsApp pessoal cadastrado na gaveta
  if (remetente !== numeroSalao && remetente !== dono) return "ignorado";
  const respostaPara = numeroSalao ?? dono;
  if (!respostaPara) return "ignorado"; // inalcançável (remetente bateu com um dos dois), satisfeito só o TS
  // estado de verdade vem do gateway ao vivo — o status cacheado no documento
  // do tenant pode estar desatualizado se um webhook de reconexão se perder
  const vivo = await getStatus(conexao.instanceId).catch(() => null);
  if (!vivo || vivo.status !== "connected") return "ignorado";
  const texto = String((msg.data as { text?: unknown } | undefined)?.text ?? "").trim();
  // "recusar" é o verbo de recusa: "cancelar" fica de fora de propósito — é
  // stop word do gateway (opt-out de cliente) e colidiria com o comando
  const comando = /^(confirmado|recusar|recuso|recusado)\b(?:\s+([a-z0-9]{4})\b)?/i.exec(texto);
  if (!comando) return "ignorado";
  const recusar = comando[1].toLowerCase() !== "confirmado";
  const codigo = comando[2]?.toUpperCase();

  // só os que ainda vão acontecer; com código, o do aviso respondido. Sem código vale
  // só quando há um pendente: com mais de um, adivinhar confirmaria o cliente errado
  const agora = Date.now();
  const startDe = (d: FirebaseFirestore.DocumentSnapshot): Date =>
    d.get("start") instanceof Date ? d.get("start") : (d.get("start") as FirebaseFirestore.Timestamp).toDate();
  const pendentes = (await db.collection(`tenants/${slug}/appointments`).where("status", "==", "booked").get()).docs
    .filter((d) => startDe(d).getTime() > agora)
    .filter((d) => !codigo || codigoDoAgendamento(d.id) === codigo);
  if (pendentes.length === 0) {
    await sendText(conexao.instanceId, respostaPara, codigo ? `Não encontrei agendamento aguardando confirmação com o código ${codigo}.` : "Não encontrei agendamento aguardando confirmação.");
    return "sem pendente";
  }
  if (pendentes.length > 1) {
    const lista = pendentes
      .sort((x, y) => startDe(x).getTime() - startDe(y).getTime())
      .map((d) => `${codigoDoAgendamento(d.id)}: ${String(d.get("customerName") ?? "").trim()} · ${d.get("serviceName")} · ${quando(dateIn(startDe(d)), formatTime(startDe(d)))}`)
      .join("\n");
    await sendText(conexao.instanceId, respostaPara, `Há mais de um agendamento aguardando. Responda com o código, por exemplo ${comando[1].toUpperCase()} ${codigoDoAgendamento(pendentes[0].id)}:\n${lista}`);
    return "sem pendente";
  }
  const a = pendentes[0];
  const start = startDe(a);
  const nome = String(a.get("customerName") ?? "").trim().split(/\s+/)[0] ?? "";
  // start é gravado no fuso de referência (como em reservaDe), então formata sem fuso local
  const quandoVai = quando(dateIn(start), formatTime(start));
  const servico = `${a.get("serviceName")} · ${quandoVai}`;

  // relê dentro da transação: o cliente ou o painel podem ter mudado o status entre a consulta e aqui
  const aplicar = async (status: "confirmed" | "cancelled", extra: Record<string, unknown>) => {
    const history = db.collection(`tenants/${slug}/history`).doc();
    return db.runTransaction(async (tx) => {
      if ((await tx.get(a.ref)).get("status") !== "booked") return false;
      tx.create(history, { appointmentId: a.id, type: status, ...extra, at: FieldValue.serverTimestamp(), by: "whatsapp", byName: "WhatsApp do salão" });
      tx.update(a.ref, { status, lastHistoryId: history.id });
      return true;
    });
  };
  const mudou = async (ok: boolean) => {
    if (!ok) await sendText(conexao.instanceId, respostaPara, `O agendamento de ${nome} (${servico}) já não estava aguardando confirmação. Nada foi alterado.`).catch(() => {});
    return ok;
  };

  if (recusar) {
    if (!(await mudou(await aplicar("cancelled", { reason: "whatsapp_rejected" })))) return "sem pendente";
    const cliente = soDigitosComDDI(String(a.get("customerPhone") ?? ""));
    if (cliente) {
      try {
        const base = (process.env.PUBLIC_SITE_URL ?? `https://${slug}.ruphus.site`).replace(/\/+$/, "");
        const link = `${base}/agendar/${slug}`;
        await sendText(conexao.instanceId, cliente, `Olá, ${nome}. O salão não conseguiu confirmar seu horário de ${servico}. Chame aqui pelo WhatsApp para remarcar ou agende outro horário pelo link: ${link}`);
      } catch (e) {
        const motivo = e instanceof Error ? e.message : String(e);
        await sendText(conexao.instanceId, respostaPara, `Agendamento de ${nome} recusado, mas o aviso ao cliente falhou: ${motivo}`).catch(() => {});
        throw e;
      }
    }
    await sendText(conexao.instanceId, respostaPara, `Agendamento de ${nome} (${servico}) recusado. O cliente foi avisado.`).catch(() => {});
    return "recusado";
  }

  if (!(await mudou(await aplicar("confirmed", {})))) return "sem pendente";

  const cliente = soDigitosComDDI(String(a.get("customerPhone") ?? ""));
  if (cliente) {
    try {
      await sendText(conexao.instanceId, cliente, `Olá, ${nome}! Seu agendamento está confirmado: ${servico}. Te esperamos!`);
    } catch (e) {
      // o agendamento já está confirmado; quem precisa saber que o cliente não
      // foi avisado é quem opera o salão (self-chat), que está esperando o eco
      const motivo = e instanceof Error ? e.message : String(e);
      await sendText(conexao.instanceId, respostaPara, `Agendamento de ${nome} confirmado, mas o aviso ao cliente falhou: ${motivo}`).catch(() => {});
      throw e;
    }
  }
  return "confirmado";
}
