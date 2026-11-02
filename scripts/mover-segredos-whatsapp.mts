// Uma vez: tira as credenciais do gateway de WhatsApp (atendysApiKey, atendysWebhookSecret,
// atendysTenantId) do documento do negócio — que qualquer membro lê pelo navegador — e as põe em
// tenants/{slug}/privado/whatsapp, que só o servidor lê. O código novo já lê e grava lá.
//
//   npm run mover:segredos-whatsapp              # só conta
//   npm run mover:segredos-whatsapp -- --aplicar
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/admin";

const aplicar = process.argv.includes("--aplicar");
const SEGREDOS = ["atendysApiKey", "atendysWebhookSecret", "atendysTenantId"] as const;

const snap = await adminDb.collection("tenants").where("whatsapp.atendysApiKey", "!=", null).get();
let movidos = 0;
for (const t of snap.docs) {
  const w = (t.get("whatsapp") ?? {}) as Record<string, unknown>;
  const segredos = Object.fromEntries(SEGREDOS.filter((k) => w[k] !== undefined).map((k) => [k, w[k]]));
  if (!Object.keys(segredos).length) continue;
  movidos++;
  if (!aplicar) continue;
  const privado = adminDb.doc(`tenants/${t.id}/privado/whatsapp`);
  // o que já estiver no privado (gravado pelo código novo) vale mais que o antigo
  const atual = (await privado.get()).data() ?? {};
  const lote = adminDb.batch();
  lote.set(privado, { ...segredos, ...atual }, { merge: true });
  lote.update(t.ref, Object.fromEntries(SEGREDOS.map((k) => [`whatsapp.${k}`, FieldValue.delete()])));
  await lote.commit();
}
console.log(`${aplicar ? "movidos" : "moveria"}: ${movidos} negócio(s) com credencial no documento público`);
process.exit(0);
