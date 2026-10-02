import "server-only";
import { createHash } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import webpush from "web-push";
import { z } from "zod";
import { addDays, todayIn, WEEKDAYS, weekday } from "@/lib/datetime";

// Avisos de novo agendamento no celular de quem atende (push do painel instalado).
// Cada aparelho inscrito é um documento em tenants/{t}/avisos/{hash do endpoint}:
// só o servidor lê e grava (as regras não liberam a subcoleção).

/** O que o navegador entrega em PushSubscription.toJSON(). */
export const Inscricao = z.object({
  endpoint: z.url().max(2048).startsWith("https://"),
  keys: z.object({ p256dh: z.string().min(16).max(256), auth: z.string().min(8).max(128) }),
});
export type Inscricao = z.infer<typeof Inscricao>;

const idDe = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex").slice(0, 40);

let configurado = false;
/** Sem as chaves VAPID (ambiente de teste, preview sem a variável) não há push: nada quebra. */
function configurar() {
  const publica = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY, privada = process.env.VAPID_PRIVATE_KEY;
  if (!publica || !privada) return false;
  if (!configurado) {
    webpush.setVapidDetails("mailto:noreply@ruphus.site", publica, privada);
    configurado = true;
  }
  return true;
}

/** Guarda o aparelho de quem pediu; o mesmo aparelho de novo só atualiza. */
export async function inscrever(db: Firestore, tenantId: string, uid: string, i: Inscricao) {
  await db.doc(`tenants/${tenantId}/avisos/${idDe(i.endpoint)}`).set({ uid, endpoint: i.endpoint, keys: i.keys, criadoEm: FieldValue.serverTimestamp() });
}

/** Se este aparelho recebe os avisos deste negócio (o navegador tem uma inscrição só para todos). */
export async function inscrito(db: Firestore, tenantId: string, uid: string, endpoint: string) {
  const d = await db.doc(`tenants/${tenantId}/avisos/${idDe(endpoint)}`).get();
  return d.exists && d.get("uid") === uid;
}

export async function cancelar(db: Firestore, tenantId: string, endpoint: string) {
  await db.doc(`tenants/${tenantId}/avisos/${idDe(endpoint)}`).delete();
}

/** "hoje às 10:30", "amanhã às 9:00", "sexta, 09/10 às 14:00" */
export function quando(date: string, hora: string, hoje = todayIn()) {
  if (date === hoje) return `hoje às ${hora}`;
  if (date === addDays(hoje, 1)) return `amanhã às ${hora}`;
  const [, m, d] = date.split("-");
  return `${WEEKDAYS[weekday(date)].toLowerCase()}, ${d}/${m} às ${hora}`;
}

/** Manda o aviso a cada aparelho inscrito de quem ainda é membro do negócio (ou admin da plataforma).
 *  Inscrição vencida (404/410) ou de quem saiu da equipe é apagada. Devolve quantos receberam. */
export async function avisar(db: Firestore, tenantId: string, aviso: { title: string; body: string; url: string; tag?: string }) {
  if (!configurar()) return 0;
  const t = db.collection("tenants").doc(tenantId);
  const [inscritos, membros, admin] = await Promise.all([t.collection("avisos").get(), t.collection("members").select().get(), db.doc("config/admin").get()]);
  // admin da plataforma entra em qualquer negócio sem estar em members (como em requireMember)
  const ativos = new Set([...membros.docs.map((m) => m.id), ...((admin.get("uids") as string[] | undefined) ?? [])]);
  let enviados = 0;
  await Promise.all(inscritos.docs.map(async (d) => {
    if (!ativos.has(String(d.get("uid")))) return d.ref.delete();
    try {
      await webpush.sendNotification({ endpoint: d.get("endpoint"), keys: d.get("keys") }, JSON.stringify(aviso), { TTL: 6 * 3600, urgency: "high" });
      enviados++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await d.ref.delete();
      else console.error(`aviso de ${tenantId} não saiu (${status ?? (e as Error).message})`);
    }
  }));
  return enviados;
}
