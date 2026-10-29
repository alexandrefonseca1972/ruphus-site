import { collection, doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { auth } from "@/lib/firebase";
import { db } from "@/lib/firebase-db";

export const STATUS = {
  booked: { label: "Aguardando confirmação", className: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  confirmed: { label: "Confirmado", className: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" },
  cancelled: { label: "Cancelado", className: "bg-muted text-muted-foreground" },
  no_show: { label: "Faltou", className: "bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200" },
};

/** Muda o status pelo navegador: o registro no histórico vai no mesmo batch (exigido pelas
 *  regras). Lança o erro do Firestore; quem chama mostra a mensagem. */
export async function mudarStatus(tenantId: string, appointmentId: string, status: "confirmed" | "cancelled" | "no_show") {
  const user = auth.currentUser;
  if (!user) throw new Error("Sessão expirada. Entre novamente.");
  const entry = doc(collection(db, "tenants", tenantId, "history"));
  const batch = writeBatch(db);
  batch.set(entry, { appointmentId, type: status, at: serverTimestamp(), by: user.uid, byName: user.email });
  batch.update(doc(db, "tenants", tenantId, "appointments", appointmentId), { status, lastHistoryId: entry.id });
  await batch.commit();
}
