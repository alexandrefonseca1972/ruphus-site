import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/admin";

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
export async function registrarParada(slug: string, m: { messageId: string; retryAt?: string | null; errorCode?: string; para: string; texto: string }, tentativa = 1): Promise<void> {
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
    b.set(indice(m.messageId), { tenantId: slug, criadaEm: FieldValue.serverTimestamp() });
    await b.commit();
  } catch (e) {
    if (tentativa < 2) return registrarParada(slug, m, tentativa + 1);
    console.error(`[mensagens] não registrou a parada ${m.messageId}`, e);
  }
}

export async function negocioDaMensagem(id: string): Promise<string | null> {
  const d = await indice(id).get();
  const t = d.get("tenantId");
  return typeof t === "string" && t ? t : null;
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
