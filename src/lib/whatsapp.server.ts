import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { quando } from "@/lib/avisos.server";
import { avisarConfirmacaoPorSms } from "@/lib/sms-agendamento.server";
import { dateIn, formatTime } from "@/lib/datetime";
import { DEMO } from "@/lib/demo";
import { ErroPrevisto } from "@/lib/erro-previsto";
import { soDigitosComDDI } from "@/lib/telefone";
import { criarInstancia, enviarTexto, garantirTenant, OPTIN_DONO, revogarChavesAntigas, statusDaConexao, type ConexaoAtendys } from "@/lib/atendys";

// O WhatsApp que o dono conectou ao próprio negócio: qual instância da
// plataforma (atendys), o número pareado e o estado da conexão. Campo
// `whatsapp` do documento tenants/{slug} — o mesmo lugar de site, agenda e
// limiteStaff.
//
// ownerPhone é o número PESSOAL do dono: quem recebe os avisos de novo
// agendamento e confirma respondendo CONFIRMADO. Tem de ser um aparelho
// separado do número conectado: o que o dono manda do próprio número (self-chat)
// chega ao gateway de forma instável.

export type ConexaoWhatsapp = ConexaoAtendys & {
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
  /** Provisionamento atendys: id do tenant + segredo de assinatura dos webhooks
   *  (x-atendys-signature). Gravados ao conectar; a apikey vem de
   *  ConexaoAtendys. O segredo só rotaciona quando não há um gravado. */
  atendysTenantId?: string;
  atendysWebhookSecret?: string;
  /** id da apikey em uso no atendys: as recuperações seguintes não revogam esta */
  atendysKeyId?: string;
};

export { soDigitosComDDI };

// As credenciais do gateway (apikey, segredo dos webhooks, id do tenant atendys) moram fora do
// documento do negócio: as regras deixam qualquer membro (até a equipe) ler tenants/{slug}, e o
// painel baixa esse documento inteiro no navegador. Em tenants/{slug}/privado/whatsapp nenhuma regra
// abre a leitura: só o servidor (Admin SDK) lê. Para a tela, `paraTela` tira as três.
const SEGREDOS = ["atendysApiKey", "atendysWebhookSecret", "atendysTenantId", "atendysKeyId"] as const;
type Segredo = (typeof SEGREDOS)[number];
export type ConexaoNaTela = Omit<ConexaoWhatsapp, Segredo>;
const privado = (db: Firestore, slug: string) => db.doc(`tenants/${slug}/privado/whatsapp`);

/** A conexão sem as credenciais: o que pode ir para o navegador (painel do dono ou /admin). */
export function paraTela<T extends Partial<ConexaoWhatsapp>>(c: T): Omit<T, Segredo>;
export function paraTela(c: null): null;
export function paraTela<T extends Partial<ConexaoWhatsapp>>(c: T | null): Omit<T, Segredo> | null;
export function paraTela<T extends Partial<ConexaoWhatsapp>>(c: T | null) {
  if (!c) return null;
  const copia: Partial<ConexaoWhatsapp> = { ...c };
  for (const k of SEGREDOS) delete copia[k];
  return copia as Omit<T, Segredo>;
}

/** O mapa whatsapp com as credenciais do doc privado (as antigas, ainda no doc do negócio antes da
 *  migração, valem enquanto o privado não tem as dele). */
async function lerInteira(db: Firestore, slug: string): Promise<ConexaoWhatsapp | null> {
  const [t, p] = await Promise.all([db.doc(`tenants/${slug}`).get(), privado(db, slug).get()]);
  const w = t.get("whatsapp") as ConexaoWhatsapp | undefined;
  if (!w) return null;
  const segredos = p.data() as Partial<Pick<ConexaoWhatsapp, Segredo>> | undefined;
  return { ...w, ...segredos };
}

export async function lerConexao(db: Firestore, slug: string): Promise<ConexaoWhatsapp | null> {
  // a demonstração é compartilhada e os clientes dela têm números de verdade: nada sai dela
  // (recibo, lembrete, confirmação, teste), mesmo que uma conexão tenha ficado no documento
  if (slug === DEMO) return null;
  const w = await lerInteira(db, slug);
  // sem atendysApiKey é resto do protólogo antigo (wtsfy): para o app é como se
  // não houvesse conexão — o dono reconecta e o provisionamento atendys roda do zero.
  return w?.instanceId && w?.atendysApiKey ? w : null;
}

/** O mapa whatsapp inteiro, com ou sem conexão — o termo pode estar aceito sem
 *  instância, e o painel do dono precisa enxergar isso. Com credenciais: só para o servidor. */
export async function lerConfigWhatsApp(db: Firestore, slug: string): Promise<ConexaoWhatsapp | null> {
  return lerInteira(db, slug);
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

/** Grava a conexão: as credenciais no doc privado, o resto no negócio (e as antigas saem dele). */
export async function gravarConexao(db: Firestore, slug: string, conexao: ConexaoWhatsapp) {
  const segredos = Object.fromEntries(SEGREDOS.filter((k) => conexao[k] !== undefined).map((k) => [k, conexao[k]]));
  const lote = db.batch();
  lote.set(
    db.doc(`tenants/${slug}`),
    { whatsapp: { ...paraTela(conexao), ...Object.fromEntries(SEGREDOS.map((k) => [k, FieldValue.delete()])) } },
    { merge: true },
  );
  if (Object.keys(segredos).length) lote.set(privado(db, slug), segredos, { merge: true });
  await lote.commit();
}

export async function apagarConexao(db: Firestore, slug: string) {
  const lote = db.batch();
  lote.update(db.doc(`tenants/${slug}`), { whatsapp: FieldValue.delete() });
  lote.delete(privado(db, slug));
  await lote.commit();
}

/** Provisionamento automático: garante o tenant e a instância no atendys e
 *  prende o vínculo no negócio. Idempotente — se já houver conexão, o caller
 *  decide (as actions checam antes). Quando o doc já tem tenant/apikey do
 *  atendys (reconexão após desligamento), reutiliza; senão emite nova chave.
 *  O segredo dos webhooks também é reaproveitado: só rotaciona sem um gravado. */
export async function conectarNegocio(
  db: Firestore,
  slug: string,
  nomeNegocio: string,
  ownerManaged: boolean,
): Promise<ConexaoWhatsapp> {
  if (slug === DEMO) {
    throw new ErroPrevisto("A demonstração não conecta WhatsApp: ela é aberta a qualquer pessoa e mandaria mensagens para os números de exemplo. Teste num negócio de verdade.");
  }
  const atual = await lerConfigWhatsApp(db, slug);
  const credenciais = await garantirTenant(slug, nomeNegocio || slug, {
    reatribuirChave: !(atual?.atendysTenantId && atual.atendysApiKey),
    rotacionarSegredo: !atual?.atendysWebhookSecret,
    tenantId: atual?.atendysTenantId,
  });
  const { name } = await criarInstancia(credenciais.tenantId, slug);
  const conexao: ConexaoWhatsapp = {
    ...(atual ?? {}),
    atendysTenantId: credenciais.tenantId,
    atendysApiKey: credenciais.apikey || atual?.atendysApiKey || "",
    ...(credenciais.keyId ? { atendysKeyId: credenciais.keyId } : {}),
    atendysWebhookSecret: credenciais.webhookSecret || atual?.atendysWebhookSecret || "",
    instanceId: name,
    phone: null,
    status: "qr",
    updatedAt: Date.now(),
    ownerManaged,
  };
  await gravarConexao(db, slug, conexao);
  // chave nova gravada: as antigas da Ruphus saem. Relê a gravada — outra conexão ao mesmo
  // tempo pode ter gravado a dela depois, e essa não pode ser revogada. Falha aqui não
  // desfaz a conexão (sobra só uma chave a mais, como antes)
  if (credenciais.keyId) {
    const gravada = (await lerConfigWhatsApp(db, slug))?.atendysKeyId;
    await revogarChavesAntigas(credenciais.tenantId, credenciais.keyId, gravada).catch((e) => console.error(`[atendys] revogar chaves de ${slug}`, e));
  }
  return conexao;
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
    // 6 = ALREADY_EXISTS do Admin SDK (gRPC): a entrega repetida do mesmo messageId
    if ((e as { code?: number }).code === 6) return false;
    throw e;
  }
}

/** O gateway avisou que a conexão mudou de estado: espelha no negócio.
 *  O atendys manda pending_qr/connected/disconnected; o painel fala qr em vez
 *  de pending_qr. `reason` (versão antiga) não existe mais no contrato. */
export async function espelharStatusDaInstancia(
  db: Firestore,
  slug: string,
  dados: { status?: unknown; phone?: unknown; reason?: unknown; at?: unknown },
) {
  const bruto = String(dados.status ?? "");
  if (!bruto) return;
  // "at" (ISO, dentro do corpo assinado) é a hora do evento no atendys: reentrega antiga ou
  // fora de ordem não desfaz um status mais novo (o "disconnected" de ontem reenviado hoje)
  const em = typeof dados.at === "string" ? Date.parse(dados.at) : NaN;
  const status = bruto === "pending_qr" ? "qr" : bruto === "connected" ? "connected" : "disconnected";
  const reason = typeof dados.reason === "string" && dados.reason ? dados.reason : null;
  const ref = db.doc(`tenants/${slug}`);
  // em transação: duas entregas ao mesmo tempo passavam ambas pela checagem e a mais velha
  // podia gravar por último
  await db.runTransaction(async (tx) => {
    if (Number.isFinite(em)) {
      const atual = (await tx.get(ref)).get("whatsapp.statusAt");
      if (typeof atual === "number" && em <= atual) return;
    }
    tx.set(
      ref,
      {
        whatsapp: {
          status,
          ...(reason ? { statusReason: reason } : {}),
          ...(typeof dados.phone === "string" && dados.phone ? { phone: dados.phone } : {}),
          ...(Number.isFinite(em) ? { statusAt: em } : {}),
          updatedAt: Date.now(),
        },
      },
      { merge: true },
    );
  });
}

/** Código curto do agendamento no aviso ao salão ("CONFIRMADO AB12"): é ele que diz a
 *  qual aviso o dono respondeu quando há mais de um pendente. */
export const codigoDoAgendamento = (id: string, tamanho = 4) => id.slice(0, tamanho).toUpperCase();

/** Códigos para uma lista de pendentes: 4 letras, mais quando dois ids começam igual (ids do
 *  Firestore diferem em maiúscula/minúscula, e "Ab12…" e "aB12…" davam o mesmo AB12). */
export function codigosUnicos(ids: string[]): Map<string, string> {
  let tamanho = 4;
  while (tamanho < 20 && new Set(ids.map((id) => codigoDoAgendamento(id, tamanho))).size < ids.length) tamanho++;
  return new Map(ids.map((id) => [id, codigoDoAgendamento(id, tamanho)]));
}

/** "CONFIRMADO", "recusar ab12"… → o comando; qualquer outra mensagem → null.
 *  "recusar" é o verbo de recusa: "cancelar" fica de fora de propósito — é stop
 *  word do gateway (opt-out de cliente) e colidiria com o comando. */
export function lerComando(texto: string): { verbo: string; recusar: boolean; codigo?: string } | null {
  const m = /^(confirmado|recusar|recuso|recusado)\b(?:\s+([a-z0-9]{4,12})\b)?/i.exec(texto.trim());
  if (!m) return null;
  return { verbo: m[1].toUpperCase(), recusar: m[1].toLowerCase() !== "confirmado", codigo: m[2]?.toUpperCase() };
}

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
  const vivo = await statusDaConexao(conexao).catch(() => null);
  if (!vivo || vivo.status !== "connected") return "ignorado";
  const comando = lerComando(String((msg.data as { text?: unknown } | undefined)?.text ?? ""));
  if (!comando) return "ignorado";
  const { recusar } = comando;
  let { codigo } = comando;

  // só os que ainda vão acontecer; com código, o do aviso respondido. Sem código vale
  // só quando há um pendente: com mais de um, adivinhar confirmaria o cliente errado
  const agora = Date.now();
  const startDe = (d: FirebaseFirestore.DocumentSnapshot): Date =>
    d.get("start") instanceof Date ? d.get("start") : (d.get("start") as FirebaseFirestore.Timestamp).toDate();
  const futuros = (await db.collection(`tenants/${slug}/appointments`).where("status", "==", "booked").get()).docs
    .filter((d) => startDe(d).getTime() > agora);
  // "confirmado obrigado": mais de 4 letras que não começam nenhum pendente é conversa, não
  // código (os códigos longos só existem para desempatar ids que começam igual)
  if (codigo && codigo.length > 4 && !futuros.some((d) => d.id.toUpperCase().startsWith(codigo!))) codigo = undefined;
  const pendentes = futuros.filter((d) => !codigo || d.id.toUpperCase().startsWith(codigo));
  if (pendentes.length === 0) {
    await enviarTexto(conexao, respostaPara, codigo ? `Não encontrei agendamento aguardando confirmação com o código ${codigo}.` : "Não encontrei agendamento aguardando confirmação.", OPTIN_DONO);
    return "sem pendente";
  }
  if (pendentes.length > 1) {
    const codigos = codigosUnicos(pendentes.map((d) => d.id));
    const lista = pendentes
      .sort((x, y) => startDe(x).getTime() - startDe(y).getTime())
      .map((d) => `${codigos.get(d.id)}: ${String(d.get("customerName") ?? "").trim()} · ${d.get("serviceName")} · ${quando(dateIn(startDe(d)), formatTime(startDe(d)))}`)
      .join("\n");
    await enviarTexto(conexao, respostaPara, `Há mais de um agendamento aguardando. Responda com o código, por exemplo ${comando.verbo} ${codigos.get(pendentes[0].id)}:\n${lista}`, OPTIN_DONO);
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
    if (!ok) await enviarTexto(conexao, respostaPara, `O agendamento de ${nome} (${servico}) já não estava aguardando confirmação. Nada foi alterado.`, OPTIN_DONO).catch(() => {});
    return ok;
  };

  if (recusar) {
    if (!(await mudou(await aplicar("cancelled", { reason: "whatsapp_rejected" })))) return "sem pendente";
    const cliente = soDigitosComDDI(String(a.get("customerPhone") ?? ""));
    if (cliente) {
      try {
        const base = (process.env.PUBLIC_SITE_URL ?? `https://${slug}.ruphus.site`).replace(/\/+$/, "");
        const link = `${base}/agendar/${slug}`;
        await enviarTexto(conexao, cliente, `Olá, ${nome}. O salão não conseguiu confirmar seu horário de ${servico}. Chame aqui pelo WhatsApp para remarcar ou agende outro horário pelo link: ${link}`);
      } catch (e) {
        const motivo = e instanceof Error ? e.message : String(e);
        await enviarTexto(conexao, respostaPara, `Agendamento de ${nome} recusado, mas o aviso ao cliente falhou: ${motivo}`, OPTIN_DONO).catch(() => {});
        throw e;
      }
    }
    await enviarTexto(conexao, respostaPara, `Agendamento de ${nome} (${servico}) recusado. O cliente foi avisado.`, OPTIN_DONO).catch(() => {});
    return "recusado";
  }

  if (!(await mudou(await aplicar("confirmed", {})))) return "sem pendente";
  // o SMS de confirmação, para o negócio que o tem ligado; falha não muda a confirmação
  await avisarConfirmacaoPorSms(db, slug, a.id).catch((e) => console.error("[sms] confirmação pelo WhatsApp", e));

  const cliente = soDigitosComDDI(String(a.get("customerPhone") ?? ""));
  if (cliente) {
    try {
      await enviarTexto(conexao, cliente, `Olá, ${nome}! Seu agendamento está confirmado: ${servico}. Te esperamos!`);
    } catch (e) {
      // o agendamento já está confirmado; quem precisa saber que o cliente não
      // foi avisado é quem opera o salão (self-chat), que está esperando o eco
      const motivo = e instanceof Error ? e.message : String(e);
      await enviarTexto(conexao, respostaPara, `Agendamento de ${nome} confirmado, mas o aviso ao cliente falhou: ${motivo}`, OPTIN_DONO).catch(() => {});
      throw e;
    }
  }
  return "confirmado";
}
