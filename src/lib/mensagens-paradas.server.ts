import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/admin";
import { avisar } from "@/lib/avisos.server";

// Mensagens que o atendys parou na cota do dia (awaiting_manual). Ficam em
// tenants/{slug}/mensagens/{id} para o dono decidir pelo painel, e o índice
// mensagensWhatsapp/{id} → slug deixa o webhook de status (que não traz a instância)
// achar o negócio e o segredo para validar a assinatura. Só o servidor lê e grava.

// O atendys segura a mensagem por 24 horas a partir da criação quando quem envia não manda
// expiresAt (resolveExpiresAt, no wtsfy). Depois disso "Enviar agora" e "Manter agendada" são
// recusados (409): a mensagem vencida não pode aparecer no painel com os botões.
export const VALIDADE_PARADA_MS = 24 * 60 * 60 * 1000;

const doNegocio = (slug: string, id: string) => adminDb.doc(`tenants/${slug}/mensagens/${id}`);
const indice = (id: string) => adminDb.doc(`mensagensWhatsapp/${id}`);

// o painel mostra para quem foi sem expor o número inteiro
const mascarar = (fone: string) => {
  const d = fone.replace(/\D/g, "");
  return d.length > 4 ? `••••${d.slice(-4)}` : "••••";
};

/** Nunca lança: registrar é para o painel; o envio já foi decidido pelo atendys. Tenta duas vezes
 *  (sem o registro, o painel não mostra a mensagem que o atendys segura). */
export async function registrarParada(slug: string, m: { messageId: string; retryAt?: string | null; errorCode?: string; para: string; texto: string; prazo?: Date }, tentativa = 1): Promise<void> {
  try {
    const b = adminDb.batch();
    b.set(doNegocio(slug, m.messageId), {
      status: "awaiting_manual",
      retryAt: m.retryAt ?? null,
      // por que parou (cota, WhatsApp sem conexão, fora do horário): o painel explica o motivo certo
      errorCode: m.errorCode ?? null,
      para: mascarar(m.para),
      // o começo do texto, para o dono reconhecer a mensagem (não o número nem o wa.me)
      resumo: m.texto.replace(/\s+/g, " ").slice(0, 140),
      criadaEm: FieldValue.serverTimestamp(),
      at: Date.now(),
      expira: Date.now() + VALIDADE_PARADA_MS,
    });
    // também vigiada: retomada (Manter agendada, volta à fila) e falha depois, o aviso chega ao negócio
    b.set(indice(m.messageId), { ...dadosVigiada(slug, m.texto, m.prazo), parada: true });
    await b.commit();
  } catch (e) {
    if (tentativa < 2) return registrarParada(slug, m, tentativa + 1);
    console.error(`[mensagens] não registrou a parada ${m.messageId}`, e);
  }
}

// prazo: até quando a mensagem serve; um message.status queued com retryAt depois dele já é falha
// expiraEm: para a política de TTL do Firestore (o atendys segura a mensagem por no máximo 24 h)
const dadosVigiada = (slug: string, texto: string, prazo?: Date) => ({
  tenantId: slug, vigiada: true, resumo: texto.replace(/\s+/g, " ").slice(0, 140), ...(prazo && { prazo: prazo.getTime() }),
  criadaEm: FieldValue.serverTimestamp(), expiraEm: new Date(Date.now() + 7 * 86_400_000),
});

/** Envio aceito pelo atendys cuja falha posterior precisa chegar ao negócio: todo envio do canal
 *  oficial (a Meta recusa depois do aceite) e o adiado para depois do prazo (vence no atendys).
 *  O message.status failed acha o negócio por este índice. Nunca lança. */
export async function vigiarEnvio(slug: string, id: string, texto: string, prazo?: Date): Promise<void> {
  await indice(id).set(dadosVigiada(slug, texto, prazo)).catch((e) => console.error(`[mensagens] índice do envio ${id}`, e));
}

/** Código nosso (não vem do atendys): na fila para depois do prazo, a mensagem já não serve. */
export const NAO_SAI_A_TEMPO = "NAO_SAI_A_TEMPO";

// por que um aviso aceito não chegou: frase para quem gere, nunca o texto técnico da Meta
function motivoDaFalha(codigo?: string | null) {
  if (codigo === NAO_SAI_A_TEMPO) return "não sai antes do horário (fora do horário de envio ou limite do dia)";
  if (codigo === "MESSAGE_EXPIRED") return "não saiu até o horário (fora do horário de envio ou limite do dia)";
  if (codigo === "META_131026") return "o número do cliente não recebe mensagens no WhatsApp";
  if (codigo === "TEMPLATE_REQUIRED" || codigo === "META_131047") return "fora da janela de 24 horas do WhatsApp";
  return "o WhatsApp recusou a entrega";
}

/** Um push de falha por negócio a cada 10 min: uma tempestade de falhas vira um aviso só. */
const JANELA_PUSH_MS = 10 * 60_000;

/** Aviso aceito pelo atendys que falhou depois (a Meta recusou, venceu o prazo, não sai a tempo): o
 *  dono já ouviu "cliente avisado", então vai para a gaveta e para o celular de quem gere. Uma vez
 *  por mensagem: a marca e o erro visível na mesma transação (um sem o outro perdia o aviso para
 *  sempre). O push fica fora dela, agrupado por negócio. Nunca lança. Devolve o que fez (log/teste). */
export async function avisarFalhaDeEnvio(slug: string, id: string, codigo?: string | null): Promise<"push" | "agrupada" | null> {
  try {
    const tenant = adminDb.doc(`tenants/${slug}`);
    const r = await adminDb.runTransaction(async (tx) => {
      const [d, t] = await Promise.all([tx.get(indice(id)), tx.get(tenant)]);
      if (!d.exists || d.get("vigiada") !== true || d.get("falhou") || d.get("tenantId") !== slug) return null;
      const resumo = String(d.get("resumo") ?? "");
      const texto = `Um aviso pelo WhatsApp não foi entregue: ${motivoDaFalha(codigo)}.${resumo ? ` Mensagem: ${resumo}` : ""}`;
      const agora = Date.now();
      const push = !(agora - Number(t.get("whatsapp.falhaAvisadaEm") ?? 0) < JANELA_PUSH_MS);
      tx.update(indice(id), { falhou: true });
      tx.set(tenant, { whatsapp: { lastNotifyError: { message: texto, at: agora }, ...(push && { falhaAvisadaEm: agora }) } }, { merge: true });
      return { texto, push };
    });
    if (!r) return null;
    console.warn(`[mensagens] envio ${id} de ${slug} falhou (${codigo ?? "sem código"})${r.push ? "" : ": push agrupado"}`);
    if (r.push) {
      // tag fixa por negócio: o aviso novo substitui o anterior no celular em vez de empilhar
      await avisar(adminDb, slug, { title: "Aviso do WhatsApp não entregue", body: r.texto.slice(0, 180), url: `/${slug}`, tag: `falha-whatsapp-${slug}` }, { soGestores: true })
        .catch((e) => console.error(`[mensagens] push da falha de ${id}`, e));
    }
    return r.push ? "push" : "agrupada";
  } catch (e) {
    console.error(`[mensagens] aviso da falha de ${id}`, e);
    return null;
  }
}

/** O índice da mensagem: de qual negócio é, se é vigiada (e até quando serve), se parou na cota. */
export async function lerIndice(id: string): Promise<{ slug: string; vigiada: boolean; parada: boolean; prazo: number | null } | null> {
  const d = await indice(id).get();
  const t = d.get("tenantId");
  if (typeof t !== "string" || !t) return null;
  return { slug: t, vigiada: d.get("vigiada") === true, parada: d.get("parada") === true, prazo: typeof d.get("prazo") === "number" ? d.get("prazo") : null };
}

export async function negocioDaMensagem(id: string): Promise<string | null> {
  return (await lerIndice(id))?.slug ?? null;
}

const SAIU = new Set(["sent", "delivered", "read"]);

/** Novo status (webhook, decisão no painel, volta à fila). Só mexe em mensagem registrada, e só
 *  se o fato é mais novo que o gravado: um webhook atrasado não traz de volta uma já decidida. */
export async function atualizarParada(slug: string, id: string, status: string, retryAt?: string | null, at = Date.now(), errorCode?: string | null) {
  const ref = doNegocio(slug, id);
  await adminDb.runTransaction(async (tx) => {
    const d = await tx.get(ref);
    if (!d.exists || Number(d.get("at") ?? 0) > at) return;
    // saiu de fato (failed → sent na reconciliação do atendys): o erro antigo não vale mais
    const erro = SAIU.has(status) ? { errorCode: FieldValue.delete() } : errorCode ? { errorCode } : {};
    tx.update(ref, { status, at, ...(retryAt !== undefined && { retryAt }), ...erro, atualizadaEm: FieldValue.serverTimestamp() });
  });
}

/** Até quando a mensagem serve (o horário do lembrete/aviso): vencida, sai da lista. */
export async function prazoDaParada(slug: string, id: string, prazo: Date) {
  await doNegocio(slug, id).set({ prazo: prazo.getTime() }, { merge: true }).catch((e) => console.error(`[mensagens] prazo de ${id}`, e));
}

/** As que ainda esperam decisão e ainda servem, mais antigas primeiro. Sem limite: são poucas
 *  (a cota é exceção) e as vencidas saem pelo prazo. */
export async function paradasDoNegocio(slug: string) {
  const q = await adminDb.collection(`tenants/${slug}/mensagens`).where("status", "==", "awaiting_manual").get();
  const agora = Date.now();
  return q.docs
    // vencida pelo prazo (o horário do lembrete) ou pela validade do atendys; as registradas antes
    // do campo expira usam a criação + 24 h
    .filter((d) => !(Number(d.get("prazo")) < agora))
    .filter((d) => (Number(d.get("expira")) || (d.get("criadaEm")?.toMillis?.() ?? agora) + VALIDADE_PARADA_MS) > agora)
    .map((d) => ({ messageId: d.id, para: String(d.get("para") ?? ""), resumo: String(d.get("resumo") ?? ""), retryAt: (d.get("retryAt") as string | null) ?? null, errorCode: (d.get("errorCode") as string | null) ?? null, criadaEm: d.get("criadaEm")?.toMillis?.() ?? 0 }))
    .sort((a, b) => a.criadaEm - b.criadaEm);
}
