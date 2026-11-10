import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { alertarAdmin } from "@/lib/alerta-admin.server";
import { quando } from "@/lib/avisos.server";
import { avisarConfirmacaoPorSms } from "@/lib/sms-agendamento.server";
import { chaveDoHorario, dateIn, formatTime, instanteReal } from "@/lib/datetime";
import { soDigitosComDDI } from "@/lib/telefone";
import { optInDoDoc } from "@/lib/consentimento-whatsapp";
import { enviarSemOperador, enviarTemplateSemOperador, OPTIN_DONO, saiuDepoisDoAceite, type OptIn } from "@/lib/atendys";
import { conexaoOficial, contatoDoNegocio, templateCliente } from "@/lib/canal-oficial.server";

// Configuração do WhatsApp do negócio. Os avisos saem só pelo canal oficial (número da plataforma
// Ruphus, canal-oficial.server); aqui fica o que é do negócio: o WhatsApp pessoal do dono, os
// lembretes e a última falha de aviso. Campo `whatsapp` do documento tenants/{slug} — o mesmo
// lugar de site, agenda e limiteStaff.
//
// ownerPhone é o número PESSOAL do dono: quem recebe os avisos de novo agendamento e confirma
// respondendo CONFIRMADO (ou tocando no botão) ao número da plataforma.

export type ConexaoWhatsapp = {
  /** o negócio usa o canal oficial (cadastrarDonoOficial liga) */
  canalOficial?: boolean;
  ownerPhone?: string | null;
  /** o dono tocou "Sou eu" na confirmação do canal oficial, deste ownerPhone (canal-oficial.server) */
  ownerPhoneVerifiedAt?: number | null;
  /** último envio da confirmação: o reenvio espera 10 min */
  confirmacaoEnviadaEm?: number | null;
  /** confirmações mandadas no dia (teto de 5 por negócio) */
  confirmacoesHoje?: { dia: string; n: number } | null;
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

// O WhatsApp pessoal do dono mora em tenants/{slug}/privado/whatsapp: a equipe lê o documento do
// negócio inteiro pelo navegador e não deve vê-lo. Nenhuma regra abre o privado; só o servidor lê.
const DO_NEGOCIO = ["canalOficial", "remindersEnabled", "remindersBeforeHours", "lastNotifyError"] as const;
const DO_PRIVADO = ["ownerPhone", "ownerPhoneVerifiedAt", "confirmacaoEnviadaEm", "confirmacoesHoje"] as const;
const privado = (db: Firestore, slug: string) => db.doc(`tenants/${slug}/privado/whatsapp`);

const so = (fonte: Record<string, unknown> | undefined, campos: readonly string[]) =>
  Object.fromEntries(campos.filter((k) => fonte?.[k] !== undefined).map((k) => [k, fonte![k]]));

/** A configuração do WhatsApp do negócio, com o WhatsApp pessoal do dono. Só os campos conhecidos:
 *  restos do número próprio por QR (instância, credenciais antigas) ficam de fora. null: o negócio
 *  nunca configurou nada. Com o ownerPhone: só para o servidor ou para quem gere. */
export async function lerConfigWhatsApp(db: Firestore, slug: string): Promise<ConexaoWhatsapp | null> {
  const [t, p] = await Promise.all([db.doc(`tenants/${slug}`).get(), privado(db, slug).get()]);
  const w = t.get("whatsapp") as Record<string, unknown> | undefined;
  const pv = p.data();
  if (!w && !pv) return null;
  // ownerPhone antigo ainda no documento do negócio vale enquanto o privado não tem o dele
  return { ...so(w, [...DO_NEGOCIO, ...DO_PRIVADO]), ...so(pv, DO_PRIVADO) } as ConexaoWhatsapp;
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

/** Aviso de agendamento que saiu: limpa a falha só se ela também era de aviso de agendamento
 *  ("Agendamento de …"). A de lembrete, de comando descartado ou de envio recusado fica na gaveta
 *  até a reconexão: um aviso bom não prova que aquela foi resolvida. */
export async function limparErroDeAgendamento(db: Firestore, slug: string) {
  const ref = db.doc(`tenants/${slug}`);
  await db.runTransaction(async (tx) => {
    const atual = (await tx.get(ref)).get("whatsapp.lastNotifyError.message");
    if (typeof atual === "string" && atual.startsWith("Agendamento de ")) tx.update(ref, { "whatsapp.lastNotifyError": FieldValue.delete() });
  });
}

/** Mensagem que chegou ao número da plataforma para o negócio: vai para a caixa de entrada dele.
 *  Devolve true quando a mensagem é NOVA. O gateway entrega at-least-once: o
 *  mesmo messageId pode chegar de novo, e quem decide se há efeito é quem chama. */
export async function registrarMensagemRecebida(
  db: Firestore,
  slug: string,
  msg: { phone?: string; messageId?: string; data: unknown; timestamp?: string | number },
  /** Texto que pode ser comando (CONFIRMADO/RECUSAR): grava junto o pendente, que só sai depois
   *  de processado. A caixa de entrada é o dedupe das reentregas: sem o pendente, uma queda no
   *  meio do processamento deixava o agendamento "booked" para sempre. */
  comando?: "plataforma",
  /** Botão do pedido ao dono: o agendamento e o horário do pedido. A transação que muda o status
   *  confere de novo (o cliente pode remarcar antes de o cron reprocessar o pendente). */
  esperado?: { agendamento: string; horario?: string },
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
    // sem messageId (o contrato sempre manda; é defesa) não há dedupe das reentregas nem quem processe
    // na hora (o webhook dispara pelo messageId): a mensagem fica só na caixa de entrada
    if (comando && msg.messageId && typeof texto === "string") {
      // pegoEm = agora: quem recebeu processa já (after); o cron só pega o que ficou 5 min parado
      b.set(db.doc(`${PENDENTES}/${idDoComando(slug, ref.id)}`), { slug, phone: msg.phone ?? null, text: texto, via: comando, pegoEm: Date.now(), tentativas: 1, ...(esperado && { esperado }) });
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
const AVISO_FALHOU = "O aviso ao cliente não foi entregue (o WhatsApp recusou): avise o cliente por outro meio.";
/** Aceito, mas o cliente não vai receber: o que dizer ao dono. null = enviado ou agendado a tempo. */
const avisoNaoEntregue = (destino: string) => (destino === "parada" ? AVISO_PARADO : destino === "nao_sai" ? AVISO_NAO_SAI : destino === "falhou" ? AVISO_FALHOU : null);
/** Id do pendente do comando recebido (a mensagem da caixa de entrada do negócio). */
export const idDoComando = (slug: string, inboxId: string) => `${slug}__${inboxId}`;
const PARADO_MS = 5 * 60_000;
const MAX_TENTATIVAS = 3;

/** Processa o comando pendente e o apaga. Falha: fica para o cron tentar de novo. */
export async function executarComandoPendente(db: Firestore, id: string) {
  const ref = db.doc(`${PENDENTES}/${id}`);
  const p = (await ref.get()).data();
  if (!p) return null;
  // pendente antigo do número próprio do salão (via "salao"): esse canal não existe mais
  if (p.via !== "plataforma") {
    await ref.delete();
    return "ignorado" as const;
  }
  const r = await processarComandoAgendamento(db, String(p.slug), { phone: p.phone ?? undefined, data: { text: String(p.text ?? "") } }, id, p.esperado);
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

/** O dono respondeu ao aviso de agendamento: CONFIRMADO confirma o agendamento
 *  pendente; RECUSAR cancela. Em ambos os casos o cliente é avisado por template pelo canal
 *  oficial. O comando chega ao número da plataforma e só vale do WhatsApp pessoal do dono; a
 *  resposta volta a ele. Não é comando: "ignorado" (a mensagem já ficou na caixa de entrada,
 *  como qualquer outra). */
export async function processarComandoAgendamento(
  db: Firestore,
  slug: string,
  msg: { phone?: string; data: unknown },
  /** Id em comandosPendentes: sai na MESMA transação da mudança do agendamento. Depois dela o
   *  comando não roda de novo (repetir diria ao dono "não encontrei" logo após "confirmado"). */
  pendente?: string,
  /** Veio de botão do pedido: o horário do pedido tem de bater com o atual, senão nada muda. */
  esperado?: { agendamento: string; horario?: string },
): Promise<"ignorado" | "nao entendido" | "sem pendente" | "confirmado" | "recusado"> {
  // as respostas saem pelo número da plataforma (o dono acabou de escrever: janela de 24 h
  // aberta, texto livre vale)
  const oficial = await conexaoOficial(db, slug);
  if (!oficial) return "ignorado";
  const conexao = await lerConfigWhatsApp(db, slug);
  const dono = conexao?.ownerPhone ? soDigitosComDDI(conexao.ownerPhone) : null;
  const remetente = msg.phone ? soDigitosComDDI(msg.phone) : null;
  if (!dono || remetente !== dono) return "ignorado";
  // replyToInbound: não conta na cota por destinatário, não cai no dedupe de 10 min nem espera o
  // horário silencioso
  const responderDono = (texto: string) => enviarSemOperador(oficial, dono, texto, OPTIN_DONO, undefined, { resposta: true });
  // nos ramos que não mudam nada, o pendente sai antes da resposta: uma resposta que falha não o
  // prende (o cron repetiria e acabaria num falso "comando descartado")
  const soltarPendente = async () => {
    if (pendente) await db.doc(`${PENDENTES}/${pendente}`).delete();
  };
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
    await soltarPendente();
    await responderDono(AJUDA_COMANDO);
    return "nao entendido";
  }
  const { recusar } = comando;
  let { codigo } = comando;
  // "confirmado obrigado": palavra longa que não começa o id de nenhum agendamento futuro é
  // conversa, não código (os códigos longos só existem para desempatar ids que começam igual)
  if (codigo && codigo.length > 4 && !recentes.some((d) => d.id.toUpperCase().startsWith(codigo!))) codigo = undefined;
  // botão do pedido: só o agendamento daquele pedido. Sem isso, com ele apagado ou antigo, o código
  // longo virava "conversa" e o único pendente que sobrou (de outro cliente) era confirmado no lugar
  const pendentes = futuros.filter((d) => d.get("status") === "booked" && (!codigo || d.id.toUpperCase().startsWith(codigo)) && (!esperado || d.id === esperado.agendamento));
  if (pendentes.length === 0) {
    await soltarPendente();
    await responderDono(codigo ? `Não encontrei agendamento aguardando confirmação com o código ${codigo}.` : "Não encontrei agendamento aguardando confirmação.");
    return "sem pendente";
  }
  if (pendentes.length > 1) {
    const codigos = codigosUnicos(pendentes.map((d) => d.id));
    const lista = pendentes
      .sort((x, y) => startDe(x).getTime() - startDe(y).getTime())
      .map((d) => `${codigos.get(d.id)}: ${String(d.get("customerName") ?? "").trim()} · ${d.get("serviceName")} · ${quando(dateIn(startDe(d)), formatTime(startDe(d)))}`)
      .join("\n");
    await soltarPendente();
    await responderDono(`Há mais de um agendamento aguardando. Responda com o código, por exemplo ${comando.verbo} ${codigos.get(pendentes[0].id)}:\n${lista}`);
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
  // cliente: template (fora da janela de 24 h só template sai)
  const tenant = await db.doc(`tenants/${slug}`).get();
  const negocio = String(tenant.get("name") ?? "").trim() || slug;
  // prazo: o horário no fuso do negócio (start é hora de parede)
  const prazo = instanteReal(start, tenant.get("site"));
  const avisarCliente = (tipo: "confirmado" | "cancelado", cliente: string, aceite: OptIn) =>
    enviarTemplateSemOperador(oficial, cliente, templateCliente(tipo, { nome, negocio, servico: String(a.get("serviceName") ?? ""), quando: quandoVai, contato: contatoDoNegocio(tenant) }), aceite, prazo);
  const semAceite = (o: string) =>
    `Agendamento de ${nome} ${o}, mas o cliente não autorizou receber mensagens pelo WhatsApp e não foi avisado. Fale com ele por outro meio (tel ${a.get("customerPhone")}).`;

  // relê dentro da transação: o cliente ou o painel podem ter mudado o status (ou, no botão do
  // pedido, o horário) entre a consulta e aqui
  const aplicar = async (status: "confirmed" | "cancelled", extra: Record<string, unknown>) => {
    const history = db.collection(`tenants/${slug}/history`).doc();
    return db.runTransaction(async (tx): Promise<"ok" | "status" | "horario"> => {
      const atual = await tx.get(a.ref);
      if (pendente) tx.delete(db.doc(`${PENDENTES}/${pendente}`));
      if (atual.get("status") !== "booked") return "status";
      if (esperado?.horario && esperado.agendamento === a.id && chaveDoHorario(startDe(atual)) !== esperado.horario) return "horario";
      tx.create(history, { appointmentId: a.id, type: status, ...extra, at: FieldValue.serverTimestamp(), by: "whatsapp", byName: "WhatsApp do salão" });
      tx.update(a.ref, { status, lastHistoryId: history.id });
      return "ok";
    });
  };
  const mudou = async (r: "ok" | "status" | "horario") => {
    if (r === "status") await responderDono(`O agendamento de ${nome} (${servico}) já não estava aguardando confirmação. Nada foi alterado.`).catch(() => {});
    if (r === "horario") await responderDono(`O pedido de ${nome} mudou de horário (o cliente remarcou). Nada foi alterado: use o pedido mais recente ou o painel.`).catch(() => {});
    return r === "ok";
  };

  if (recusar) {
    if (!(await mudou(await aplicar("cancelled", { reason: "whatsapp_rejected" })))) return "sem pendente";
    const cliente = soDigitosComDDI(String(a.get("customerPhone") ?? ""));
    if (cliente && !optIn) {
      await responderDono(semAceite("recusado")).catch(() => {});
      return "recusado";
    }
    if (cliente && optIn) {
      try {
        const e = await avisarCliente("cancelado", cliente, optIn);
        const ruim = avisoNaoEntregue(e.destino);
        if (ruim) {
          await responderDono(`Agendamento de ${nome} recusado. ${ruim}`).catch(() => {});
          return "recusado";
        }
      } catch (e) {
        const motivo = e instanceof Error ? e.message : String(e);
        await responderDono(`Agendamento de ${nome} recusado, mas o aviso ao cliente falhou: ${motivo}`).catch(() => {});
        if (saiuDepoisDoAceite(e)) return "recusado"; // o dono já sabe; não é erro
        throw e;
      }
    }
    await responderDono(`Agendamento de ${nome} (${servico}) recusado. O cliente foi avisado.`).catch(() => {});
    return "recusado";
  }

  if (!(await mudou(await aplicar("confirmed", {})))) return "sem pendente";
  // o SMS de confirmação, para o negócio que o tem ligado; falha não muda a confirmação
  await avisarConfirmacaoPorSms(db, slug, a.id).catch((e) => console.error("[sms] confirmação pelo WhatsApp", e));

  const cliente = soDigitosComDDI(String(a.get("customerPhone") ?? ""));
  if (cliente && !optIn) {
    await responderDono(semAceite("confirmado")).catch(() => {});
  } else if (cliente) {
    try {
      const e = await avisarCliente("confirmado", cliente, optIn);
      // parada na cota: quem opera o salão precisa saber que o cliente ainda não foi avisado
      const ruim = avisoNaoEntregue(e.destino);
      if (ruim) await responderDono(`Agendamento de ${nome} confirmado. ${ruim}`).catch(() => {});
    } catch (e) {
      // o agendamento já está confirmado; quem precisa saber que o cliente não
      // foi avisado é o dono, que está esperando a resposta
      const motivo = e instanceof Error ? e.message : String(e);
      await responderDono(`Agendamento de ${nome} confirmado, mas o aviso ao cliente falhou: ${motivo}`).catch(() => {});
      if (saiuDepoisDoAceite(e)) return "confirmado"; // o dono já sabe; não é erro
      throw e;
    }
  }
  return "confirmado";
}
