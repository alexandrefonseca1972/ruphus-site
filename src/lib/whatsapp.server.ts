import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { alertarAdmin } from "@/lib/alerta-admin.server";
import { avisar, quando } from "@/lib/avisos.server";
import { avisarConfirmacaoPorSms } from "@/lib/sms-agendamento.server";
import { dateIn, formatTime } from "@/lib/datetime";
import { DEMO } from "@/lib/demo";
import { ErroPrevisto } from "@/lib/erro-previsto";
import { soDigitosComDDI } from "@/lib/telefone";
import { emParalelo } from "@/lib/paralelo";
import { comAvisoSair, optInDoDoc } from "@/lib/consentimento-whatsapp";
import { criarInstancia, enviarSemOperador, enviarTemplateSemOperador, garantirTenant, OPTIN_DONO, revogarChavesAntigas, saiuDepoisDoAceite, statusDaConexao, type ConexaoAtendys, type OptIn } from "@/lib/atendys";
import { conexaoOficial, templateCliente } from "@/lib/canal-oficial.server";

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
  /** já esteve conectada (a faixa "Seu WhatsApp desconectou" só aparece depois disso) */
  conectadoEm?: number;
};

export { soDigitosComDDI };

// As credenciais do gateway (apikey, segredo dos webhooks, id do tenant atendys) moram fora do
// documento do negócio: as regras deixam qualquer membro (até a equipe) ler tenants/{slug}, e o
// painel baixa esse documento inteiro no navegador. Em tenants/{slug}/privado/whatsapp nenhuma regra
// abre a leitura: só o servidor (Admin SDK) lê. Para a tela, `paraTela` tira as três.
const SEGREDOS = ["atendysApiKey", "atendysWebhookSecret", "atendysTenantId", "atendysKeyId"] as const;
// Fora do documento do negócio, mas mostrado a quem gere (pelas ações do servidor, que checam o papel):
// o WhatsApp PESSOAL do dono — a equipe lê tenants/{slug} inteiro pelo navegador e não deve vê-lo.
const SO_SERVIDOR = [...SEGREDOS, "ownerPhone"] as const;
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
  return w?.instanceId && w?.atendysApiKey ? { ...w, slug } : null;
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
        // conexão nova começa sem histórico: QR que expira sem ler não é "desconectou"
        conectadoEm: FieldValue.delete(),
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
  const segredos = Object.fromEntries(SO_SERVIDOR.filter((k) => conexao[k] !== undefined).map((k) => [k, conexao[k]]));
  const { ownerPhone: _pessoal, ...publico } = paraTela(conexao);
  void _pessoal;
  const lote = db.batch();
  lote.set(
    db.doc(`tenants/${slug}`),
    { whatsapp: { ...publico, ...Object.fromEntries(SO_SERVIDOR.map((k) => [k, FieldValue.delete()])) } },
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
    keyId: atual?.atendysKeyId,
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
  // ...atual trazia o conectadoEm da conexão anterior: esta ainda não conectou (nem no banco,
  // nem no que volta para a tela)
  await db.doc(`tenants/${slug}`).update({ "whatsapp.conectadoEm": FieldValue.delete() });
  delete conexao.conectadoEm;
  // chave nova gravada: as antigas da Ruphus saem. Relê a gravada — outra conexão ao mesmo
  // tempo pode ter gravado a dela depois, e essa não pode ser revogada. Falha aqui não
  // desfaz a conexão (sobra só uma chave a mais, como antes)
  if (credenciais.keyId) {
    // só quem ainda é a chave gravada revoga; a cada DELETE confere de novo (outra conexão ao
    // mesmo tempo pode gravar a dela no meio — e essa não pode cair)
    const gravada = async () => (await lerConfigWhatsApp(db, slug))?.atendysKeyId;
    await revogarChavesAntigas(credenciais.tenantId, credenciais.keyId, gravada).catch((e) => console.error(`[atendys] revogar chaves de ${slug}`, e));
  }
  return conexao;
}

/** O número pessoal do dono: recebe os avisos e confirma respondendo. Vazio desliga. */
export async function gravarOwnerPhone(db: Firestore, slug: string, ownerPhone: string | null) {
  // no privado (a equipe lê o documento do negócio); o antigo, se houver, sai do documento
  const lote = db.batch();
  lote.set(privado(db, slug), { ownerPhone }, { merge: true });
  lote.set(db.doc(`tenants/${slug}`), { whatsapp: { ownerPhone: FieldValue.delete() } }, { merge: true });
  await lote.commit();
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
  /** Texto que pode ser comando (CONFIRMADO/RECUSAR): grava junto o pendente, que só sai depois
   *  de processado. A caixa de entrada é o dedupe das reentregas: sem o pendente, uma queda no
   *  meio do processamento deixava o agendamento "booked" para sempre. */
  comando?: "salao" | "plataforma",
): Promise<boolean> {
  // id vindo de fora vira caminho de documento: só letras, números, "_" e "-"
  const ref = msg.messageId
    ? db.collection(`tenants/${slug}/whatsappInbox`).doc(msg.messageId.replace(/[^A-Za-z0-9_-]/g, "_"))
    : db.collection(`tenants/${slug}/whatsappInbox`).doc();
  try {
    const b = db.batch();
    b.create(ref, {
      phone: msg.phone ?? null,
      messageId: msg.messageId ?? null,
      data: msg.data ?? null,
      timestamp: msg.timestamp ?? null,
      receivedAt: Date.now(),
    });
    const texto = (msg.data as { text?: unknown } | null)?.text;
    if (comando && typeof texto === "string") {
      // pegoEm = agora: quem recebeu processa já (after); o cron só pega o que ficou 5 min parado
      b.set(db.doc(`${PENDENTES}/${idDoComando(slug, ref.id)}`), { slug, phone: msg.phone ?? null, text: texto, via: comando, pegoEm: Date.now(), tentativas: 1 });
    }
    await b.commit();
    return true;
  } catch (e) {
    // 6 = ALREADY_EXISTS do Admin SDK (gRPC): a entrega repetida do mesmo messageId
    if ((e as { code?: number }).code === 6) return false;
    throw e;
  }
}

const PENDENTES = "comandosPendentes";
const AVISO_PARADO = "O aviso ao cliente parou na cota diária do WhatsApp: decida em Mensagens no painel.";
const AVISO_NAO_SAI = "O aviso ao cliente não sai antes do horário do agendamento (fora do horário de envio do WhatsApp): avise o cliente por outro meio.";
/** Id do pendente do comando recebido (a mensagem da caixa de entrada do negócio). */
export const idDoComando = (slug: string, inboxId: string) => `${slug}__${inboxId}`;
const PARADO_MS = 5 * 60_000;
const MAX_TENTATIVAS = 3;

/** Processa o comando pendente e o apaga. Falha: fica para o cron tentar de novo. */
export async function executarComandoPendente(db: Firestore, id: string) {
  const ref = db.doc(`${PENDENTES}/${id}`);
  const p = (await ref.get()).data();
  if (!p) return null;
  const r = await processarComandoAgendamento(db, String(p.slug), { phone: p.phone ?? undefined, data: { text: String(p.text ?? "") } }, p.via === "plataforma" ? "plataforma" : "salao", id);
  await ref.delete();
  return r;
}

/** Cron: comando que ficou parado (processo caiu, Firestore falhou no meio) roda de novo. Pega
 *  numa transação (duas execuções não processam o mesmo); depois de 3 tentativas desiste e avisa.
 *  ponytail: até 20 por ciclo, sem paginação; basta enquanto comando parado for exceção. */
export async function reprocessarComandos(db: Firestore): Promise<number> {
  const agora = Date.now();
  const q = await db.collection(PENDENTES).where("pegoEm", "<", agora - PARADO_MS).limit(20).get();
  let feitos = 0;
  for (const d of q.docs) {
    const tentativa = await db.runTransaction(async (tx) => {
      const atual = await tx.get(d.ref);
      if (!atual.exists || Number(atual.get("pegoEm")) >= agora - PARADO_MS) return 0;
      const n = Number(atual.get("tentativas") ?? 0) + 1;
      if (n > MAX_TENTATIVAS) tx.delete(d.ref);
      else tx.update(d.ref, { pegoEm: agora, tentativas: n });
      return n;
    });
    if (!tentativa) continue;
    const slug = String(d.get("slug"));
    if (tentativa > MAX_TENTATIVAS) {
      const msg = `Um comando do dono pelo WhatsApp (${String(d.get("text") ?? "").slice(0, 60)}) falhou ${MAX_TENTATIVAS} vezes e foi descartado. Confira o agendamento no painel.`;
      await registrarErroNotificacao(db, slug, { message: msg, at: agora }).catch(() => {});
      await alertarAdmin(db, `whatsapp-comando-${slug}`, `Comando do WhatsApp descartado em ${slug}`, `${msg}\n\nNegócio: ${slug}`);
      continue;
    }
    const r = await executarComandoPendente(db, d.id).catch((e) => (console.error(`[whatsapp] comando pendente ${d.id}`, e), null));
    if (r) {
      feitos += 1;
      console.log(`[whatsapp] comando pendente em ${slug} reprocessado: ${r}`);
    }
  }
  return feitos;
}

/** O gateway avisou que a conexão mudou de estado: espelha no negócio.
 *  O atendys manda pending_qr/connected/disconnected; o painel fala qr em vez
 *  de pending_qr. `reason` (versão antiga) não existe mais no contrato. */
export async function espelharStatusDaInstancia(
  db: Firestore,
  slug: string,
  dados: { status?: unknown; phone?: unknown; reason?: unknown; at?: unknown },
): Promise<{ caiu: boolean }> {
  const bruto = String(dados.status ?? "");
  // só os três do contrato: um valor novo (connecting, reconnecting…) não pode virar
  // "desconectado" e disparar faixa e aviso falsos
  if (!["pending_qr", "connected", "disconnected"].includes(bruto)) {
    if (bruto) console.warn(`[whatsapp] status desconhecido do atendys para ${slug}: ${bruto}`);
    return { caiu: false };
  }
  // "at" (ISO, dentro do corpo assinado) é a hora do evento no atendys: reentrega antiga ou
  // fora de ordem não desfaz um status mais novo (o "disconnected" de ontem reenviado hoje)
  const em = typeof dados.at === "string" ? Date.parse(dados.at) : NaN;
  const status = bruto === "pending_qr" ? "qr" : bruto === "connected" ? "connected" : "disconnected";
  const reason = typeof dados.reason === "string" && dados.reason ? dados.reason : null;
  const ref = db.doc(`tenants/${slug}`);
  // em transação: duas entregas ao mesmo tempo passavam ambas pela checagem e a mais velha
  // podia gravar por último. Devolve o status de antes (null = evento descartado)
  const antes = await db.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (Number.isFinite(em)) {
      const atual = doc.get("whatsapp.statusAt");
      if (typeof atual === "number" && em <= atual) return null;
    }
    tx.set(
      ref,
      {
        whatsapp: {
          status,
          ...(reason ? { statusReason: reason } : {}),
          ...(typeof dados.phone === "string" && dados.phone ? { phone: dados.phone } : {}),
          ...(Number.isFinite(em) ? { statusAt: em } : {}),
          // reconectou: a falha antiga ("desconectado, nenhum lembrete sai") não vale mais;
          // conectadoEm diz que já houve conexão (a faixa de "desconectou" só faz sentido aí)
          ...(status === "connected" ? { lastNotifyError: FieldValue.delete(), conectadoEm: Date.now() } : {}),
          // conexão feita antes do marcador existir: estava conectada, então já houve conexão
          ...(status !== "connected" && doc.get("whatsapp.status") === "connected" && !doc.get("whatsapp.conectadoEm") ? { conectadoEm: Date.now() } : {}),
          updatedAt: Date.now(),
        },
      },
      { merge: true },
    );
    return String(doc.get("whatsapp.status") ?? "");
  });
  // caiu = estava conectado e agora não: quem chama avisa (avisarQueda), fora da resposta
  return { caiu: antes === "connected" && status === "disconnected" };
}

/** A conexão caiu: quem gere fica sabendo na hora, no celular, em vez de descobrir dias depois
 *  que nenhum lembrete saiu. Gerenciado pela plataforma: o texto não manda reconectar.
 *  Falha no push só vai para o log. */
export async function avisarQueda(db: Firestore, slug: string) {
  const plataforma = (await db.doc(`tenants/${slug}`).get()).get("whatsapp.ownerManaged") === false;
  await avisar(
    db,
    slug,
    {
      title: "Seu WhatsApp desconectou",
      body: plataforma
        ? "Lembretes e avisos de agendamento pararam. A Ruphus já foi avisada e vai reconectar."
        : "Lembretes e avisos de agendamento pararam. Toque para reconectar.",
      url: `/${slug}/negocio#whatsapp`,
      tag: "whatsapp-desconectado",
    },
    { soGestores: true },
  ).catch((e) => console.error(`[whatsapp] aviso de queda de ${slug}`, e));
}

/** Estado lido ao vivo do atendys (polling, lembretes, agendamento) passa pelo mesmo espelho do
 *  webhook: com o webhook perdido, a queda também vira status, faixa e aviso — e nunca grava a
 *  conexão inteira de volta (isso ressuscitava a falha já limpa e voltava o statusAt). */
export async function espelharStatusVivo(db: Firestore, slug: string, vivo: { status: string; phone: string | null }, lidoEm: number) {
  // lidoEm = antes de perguntar ao atendys: uma leitura que começou antes de um webhook mais novo
  // ("connected" ao reconectar) é descartada pelo statusAt, em vez de desfazê-lo e avisar queda.
  // 5 s de folga: o "at" do webhook vem do relógio do atendys, e um pouco atrasado não pode
  // ter a queda verdadeira descartada por uma leitura nossa de instantes antes
  const { caiu } = await espelharStatusDaInstancia(db, slug, { status: vivo.status === "qr" ? "pending_qr" : vivo.status, phone: vivo.phone, at: new Date(lidoEm - 5000).toISOString() });
  if (caiu) await avisarQueda(db, slug);
  return caiu;
}

/** Webhook de queda perdido num negócio sem lembretes nem agendamento novo: ninguém lia o
 *  status ao vivo, e a faixa e o aviso só vinham quando o dono abrisse o painel. O cron
 *  pergunta ao atendys, de hora em hora, por toda conexão que consta como conectada.
 *  Devolve quantas caíram. */
export async function vigiarConexoes(db: Firestore): Promise<number> {
  const conectados = await db.collection("tenants").where("whatsapp.status", "==", "connected").get();
  let caidas = 0;
  await emParalelo(conectados.docs, 5, async (t) => {
    try {
      const conexao = await lerConexao(db, t.id);
      if (!conexao?.instanceId) return;
      const lidoEm = Date.now();
      const vivo = await statusDaConexao(conexao).catch(() => null);
      // atendys fora do ar não é queda do negócio, e "qr" pode ser uma reconexão de passagem
      // (connecting): só a desconexão vira status. O resto fica para a próxima rodada
      if (vivo?.status !== "disconnected") return;
      if (await espelharStatusVivo(db, t.id, vivo, lidoEm)) caidas++;
    } catch (e) {
      console.error(`[whatsapp] vigia ${t.id}`, e);
    }
  });
  return caidas;
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

const VERBOS = ["CONFIRMADO", "RECUSAR", "RECUSO", "RECUSADO"];

function distancia(a: string, b: string) {
  let ant = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(ant[j] + 1, cur[j - 1] + 1, ant[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    ant = cur;
  }
  return ant[b.length];
}

/** "CONCFIRMADO EOLQ", "confimado": a primeira palavra (sem acento, maiúscula) está a até 2
 *  letras de um verbo do comando. Não é comando (lerComando já falhou), mas o dono quis dar um. */
export function pareceComando(texto: string): boolean {
  const palavra = texto.trim().split(/\s+/)[0].normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/gi, "").toUpperCase();
  return palavra.length >= 4 && VERBOS.some((v) => distancia(palavra, v) <= 2);
}

const AJUDA_COMANDO = "Não entendi. Para confirmar, responda CONFIRMADO <código>; para recusar, RECUSAR <código>.";

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
  /** Por onde chegou: o número do próprio salão ou o da plataforma (canal oficial). Negócio do
   *  canal oficial que ainda tem número próprio segue o fluxo do salão quando o comando chega por ele. */
  via: "salao" | "plataforma" = "salao",
  /** Id em comandosPendentes: sai na MESMA transação da mudança do agendamento. Depois dela o
   *  comando não roda de novo (repetir diria ao dono "não encontrei" logo após "confirmado"). */
  pendente?: string,
): Promise<"ignorado" | "nao entendido" | "sem pendente" | "confirmado" | "recusado"> {
  // canal oficial: comando chega ao número da plataforma, só do WhatsApp pessoal do dono, e as
  // respostas saem por ele (o dono acabou de escrever: janela de 24 h aberta, texto livre vale)
  const oficial = via === "plataforma" ? await conexaoOficial(db, slug) : null;
  if (via === "plataforma" && !oficial) return "ignorado";
  const conexao = oficial ? await lerConfigWhatsApp(db, slug) : await lerConexao(db, slug);
  const canal: ConexaoAtendys | null = oficial ?? conexao;
  const dono = conexao?.ownerPhone ? soDigitosComDDI(conexao.ownerPhone) : null;
  const numeroSalao = !oficial && conexao?.phone ? soDigitosComDDI(conexao.phone) : null;
  const remetente = msg.phone ? soDigitosComDDI(msg.phone) : null;
  if (!conexao || !canal || remetente == null) return "ignorado";
  // quem manda no fluxo é o número do salão (self-chat do dono) ou, em
  // fallback, o WhatsApp pessoal cadastrado na gaveta
  if (remetente !== numeroSalao && remetente !== dono) return "ignorado";
  const respostaPara = numeroSalao ?? dono;
  if (!respostaPara) return "ignorado"; // inalcançável (remetente bateu com um dos dois), satisfeito só o TS
  // estado de verdade vem do gateway ao vivo — o status cacheado no documento
  // do tenant pode estar desatualizado se um webhook de reconexão se perder
  if (!oficial) {
    const vivo = await statusDaConexao(conexao).catch(() => null);
    if (!vivo || vivo.status !== "connected") return "ignorado";
  }
  const texto = String((msg.data as { text?: unknown } | undefined)?.text ?? "");
  const comando = lerComando(texto);

  // só os que ainda vão acontecer; com código, o do aviso respondido. Sem código vale
  // só quando há um pendente: com mais de um, adivinhar confirmaria o cliente errado
  const agora = Date.now();
  const startDe = (d: FirebaseFirestore.DocumentSnapshot): Date =>
    d.get("start") instanceof Date ? d.get("start") : (d.get("start") as FirebaseFirestore.Timestamp).toDate();
  // todos os recentes, em qualquer status: o código de um já confirmado ou cancelado continua
  // sendo código (reenviar "CONFIRMADO ABCDE" não pode cair no único pendente que sobrou)
  // inclui os últimos 7 dias: "CONFIRMADO ABCDE" reenviado depois do horário passar também
  // segue código. Pendente, só o que ainda vai acontecer
  const recentes = (await db.collection(`tenants/${slug}/appointments`).where("start", ">", new Date(agora - 7 * 86_400_000)).get()).docs;
  const futuros = recentes.filter((d) => startDe(d).getTime() > agora);

  if (!comando) {
    // erro de digitação ("CONCFIRMADO EOLQ") ou só o código de um pendente: o dono quis dar um
    // comando e, sem resposta, achava que tinha confirmado. Conversa comum segue sem resposta
    const tokens = new Set(texto.toUpperCase().match(/\b[A-Z0-9]{4}\b/g) ?? []);
    const temCodigo = futuros.some((d) => d.get("status") === "booked" && tokens.has(codigoDoAgendamento(d.id)));
    if (!pareceComando(texto) && !temCodigo) return "ignorado";
    await enviarSemOperador(canal, respostaPara, AJUDA_COMANDO, OPTIN_DONO);
    return "nao entendido";
  }
  const { recusar } = comando;
  let { codigo } = comando;
  // "confirmado obrigado": palavra longa que não começa o id de nenhum agendamento futuro é
  // conversa, não código (os códigos longos só existem para desempatar ids que começam igual)
  if (codigo && codigo.length > 4 && !recentes.some((d) => d.id.toUpperCase().startsWith(codigo!))) codigo = undefined;
  const pendentes = futuros.filter((d) => d.get("status") === "booked" && (!codigo || d.id.toUpperCase().startsWith(codigo)));
  if (pendentes.length === 0) {
    await enviarSemOperador(canal, respostaPara, codigo ? `Não encontrei agendamento aguardando confirmação com o código ${codigo}.` : "Não encontrei agendamento aguardando confirmação.", OPTIN_DONO);
    return "sem pendente";
  }
  if (pendentes.length > 1) {
    const codigos = codigosUnicos(pendentes.map((d) => d.id));
    const lista = pendentes
      .sort((x, y) => startDe(x).getTime() - startDe(y).getTime())
      .map((d) => `${codigos.get(d.id)}: ${String(d.get("customerName") ?? "").trim()} · ${d.get("serviceName")} · ${quando(dateIn(startDe(d)), formatTime(startDe(d)))}`)
      .join("\n");
    await enviarSemOperador(canal, respostaPara, `Há mais de um agendamento aguardando. Responda com o código, por exemplo ${comando.verbo} ${codigos.get(pendentes[0].id)}:\n${lista}`, OPTIN_DONO);
    return "sem pendente";
  }
  const a = pendentes[0];
  const start = startDe(a);
  const nome = String(a.get("customerName") ?? "").trim().split(/\s+/)[0] ?? "";
  // start é gravado no fuso de referência (como em reservaDe), então formata sem fuso local
  const quandoVai = quando(dateIn(start), formatTime(start));
  const servico = `${a.get("serviceName")} · ${quandoVai}`;
  // só fala com o cliente quem aceitou o WhatsApp no agendamento; os antigos (sem o campo) não
  const optIn = optInDoDoc(slug, a);
  // cliente: texto livre pelo número do salão ou template pelo canal oficial (fora da janela de 24 h)
  const negocio = oficial ? String((await db.doc(`tenants/${slug}`).get()).get("name") ?? "").trim() || slug : "";
  const avisarCliente = (tipo: "confirmado" | "cancelado", cliente: string, texto: string, aceite: OptIn) =>
    oficial
      ? enviarTemplateSemOperador(oficial, cliente, templateCliente(tipo, { nome, negocio, servico: String(a.get("serviceName") ?? ""), quando: quandoVai }), aceite, start)
      : enviarSemOperador(canal, cliente, comAvisoSair(texto), aceite, start);
  const semAceite = (o: string) =>
    `Agendamento de ${nome} ${o}, mas o cliente não autorizou receber mensagens pelo WhatsApp e não foi avisado. Fale com ele por outro meio (tel ${a.get("customerPhone")}).`;

  // relê dentro da transação: o cliente ou o painel podem ter mudado o status entre a consulta e aqui
  const aplicar = async (status: "confirmed" | "cancelled", extra: Record<string, unknown>) => {
    const history = db.collection(`tenants/${slug}/history`).doc();
    return db.runTransaction(async (tx) => {
      const atual = await tx.get(a.ref);
      if (pendente) tx.delete(db.doc(`${PENDENTES}/${pendente}`));
      if (atual.get("status") !== "booked") return false;
      tx.create(history, { appointmentId: a.id, type: status, ...extra, at: FieldValue.serverTimestamp(), by: "whatsapp", byName: "WhatsApp do salão" });
      tx.update(a.ref, { status, lastHistoryId: history.id });
      return true;
    });
  };
  const mudou = async (ok: boolean) => {
    if (!ok) await enviarSemOperador(canal, respostaPara, `O agendamento de ${nome} (${servico}) já não estava aguardando confirmação. Nada foi alterado.`, OPTIN_DONO).catch(() => {});
    return ok;
  };

  if (recusar) {
    if (!(await mudou(await aplicar("cancelled", { reason: "whatsapp_rejected" })))) return "sem pendente";
    const cliente = soDigitosComDDI(String(a.get("customerPhone") ?? ""));
    if (cliente && !optIn) {
      await enviarSemOperador(canal, respostaPara, semAceite("recusado"), OPTIN_DONO).catch(() => {});
      return "recusado";
    }
    if (cliente && optIn) {
      try {
        const base = (process.env.PUBLIC_SITE_URL ?? `https://${slug}.ruphus.site`).replace(/\/+$/, "");
        const link = `${base}/agendar/${slug}`;
        const e = await avisarCliente("cancelado", cliente, `Olá, ${nome}. Esse horário não está disponível: ${servico}. Faça um novo agendamento pelo link: ${link}`, optIn);
        if (e.destino === "parada" || e.destino === "nao_sai") {
          await enviarSemOperador(canal, respostaPara, `Agendamento de ${nome} recusado. ${e.destino === "parada" ? AVISO_PARADO : AVISO_NAO_SAI}`, OPTIN_DONO).catch(() => {});
          return "recusado";
        }
      } catch (e) {
        const motivo = e instanceof Error ? e.message : String(e);
        await enviarSemOperador(canal, respostaPara, `Agendamento de ${nome} recusado, mas o aviso ao cliente falhou: ${motivo}`, OPTIN_DONO).catch(() => {});
        if (saiuDepoisDoAceite(e)) return "recusado"; // o dono já sabe; não é erro
        throw e;
      }
    }
    await enviarSemOperador(canal, respostaPara, `Agendamento de ${nome} (${servico}) recusado. O cliente foi avisado.`, OPTIN_DONO).catch(() => {});
    return "recusado";
  }

  if (!(await mudou(await aplicar("confirmed", {})))) return "sem pendente";
  // o SMS de confirmação, para o negócio que o tem ligado; falha não muda a confirmação
  await avisarConfirmacaoPorSms(db, slug, a.id).catch((e) => console.error("[sms] confirmação pelo WhatsApp", e));

  const cliente = soDigitosComDDI(String(a.get("customerPhone") ?? ""));
  if (cliente && !optIn) {
    await enviarSemOperador(canal, respostaPara, semAceite("confirmado"), OPTIN_DONO).catch(() => {});
  } else if (cliente) {
    try {
      const e = await avisarCliente("confirmado", cliente, `Olá, ${nome}! Seu agendamento está confirmado: ${servico}. Te esperamos!`, optIn);
      // parada na cota: quem opera o salão precisa saber que o cliente ainda não foi avisado
      if (e.destino === "parada" || e.destino === "nao_sai") await enviarSemOperador(canal, respostaPara, `Agendamento de ${nome} confirmado. ${e.destino === "parada" ? AVISO_PARADO : AVISO_NAO_SAI}`, OPTIN_DONO).catch(() => {});
    } catch (e) {
      // o agendamento já está confirmado; quem precisa saber que o cliente não
      // foi avisado é quem opera o salão (self-chat), que está esperando o eco
      const motivo = e instanceof Error ? e.message : String(e);
      await enviarSemOperador(canal, respostaPara, `Agendamento de ${nome} confirmado, mas o aviso ao cliente falhou: ${motivo}`, OPTIN_DONO).catch(() => {});
      if (saiuDepoisDoAceite(e)) return "confirmado"; // o dono já sabe; não é erro
      throw e;
    }
  }
  return "confirmado";
}
