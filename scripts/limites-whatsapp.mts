// Uma vez, depois do deploy: sobe o limite por destinatário dos tenants do atendys criados antes
// (ficaram com o padrão de 3 por dia e 10 por semana). Só os deste site: cada negócio (o slug do
// tenant é o id em tenants/{slug}) e o tenant da plataforma (canal oficial).
//
//   npm run limites:whatsapp              # só lista
//   npm run limites:whatsapp -- --aplicar
import { adminDb } from "@/lib/admin";
import { ajustarLimitesDoTenant, LIMITES_DESTINATARIO, listarTenantsAtendys } from "@/lib/atendys";

const aplicar = process.argv.includes("--aplicar");
const { recipientMsgPerDay: dia, recipientMsgPerWeek: semana } = LIMITES_DESTINATARIO;
let ajustados = 0;
for (const t of await listarTenantsAtendys()) {
  const nosso = t.slug === "ruphus-plataforma" || (await adminDb.doc(`tenants/${t.slug}`).get()).exists;
  if (!nosso || (t.recipientMsgPerDay === dia && t.recipientMsgPerWeek === semana)) continue;
  console.log(`${t.slug}: ${t.recipientMsgPerDay ?? "?"}/dia, ${t.recipientMsgPerWeek ?? "?"}/semana`);
  ajustados++;
  if (aplicar) await ajustarLimitesDoTenant(t.id).catch((e) => console.error(`  ${t.slug} falhou: ${e instanceof Error ? e.message : e}`));
}
console.log(`${aplicar ? "ajustados" : "ajustaria"}: ${ajustados} tenant(s) para ${dia}/dia e ${semana}/semana`);
process.exit(0);
