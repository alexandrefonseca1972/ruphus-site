// Canal oficial do WhatsApp (número da plataforma, API da Meta, pelo atendys).
//
//   npm run canal-oficial -- provisionar [--forcar]          # emite apikey/segredo, aponta o webhook e reserva o número da Meta
//   npm run canal-oficial -- reservar 5511999999999          # reserva outro remetente da Meta
//   npm run canal-oficial -- <slug>                          # mostra o estado do negócio
//   npm run canal-oficial -- <slug> on [--dono 5511999999999]
//   npm run canal-oficial -- <slug> off
import { adminDb } from "@/lib/admin";
import { provisionarPlataforma } from "@/lib/canal-oficial.server";
import { ERRO_TELEFONE_DA_META, soDigitosComDDI } from "@/lib/telefone";
import { registrarNumeroDaMeta, telefoneReservadoPelaMeta, validarContatoDoNegocio } from "@/lib/telefones-meta.server";

const [alvo, acao] = process.argv.slice(2);
if (!alvo) throw new Error("Informe 'provisionar' ou o slug do negócio.");

if (alvo === "provisionar") {
  // o webhook do tenant da plataforma passa a apontar para PUBLIC_SITE_URL: só para o site de produção
  const site = (process.env.PUBLIC_SITE_URL ?? "https://ruphus.site").replace(/\/+$/, "");
  const atendys = process.env.ATENDYS_BASE_URL ?? "http://127.0.0.1:3002";
  console.log(`webhook → ${site}/api/webhooks/atendys · atendys ${atendys}`);
  if (!/^https:\/\/(www\.)?ruphus\.site$/.test(site) && !process.argv.includes("--url-ok")) {
    throw new Error(`PUBLIC_SITE_URL (${site}) não é o site de produção; confira o .env ou passe --url-ok.`);
  }
  const r = await provisionarPlataforma(adminDb, process.argv.includes("--forcar"));
  console.log(`plataforma provisionada: tenant ${r.tenantId}${r.novaChave ? " (chave nova emitida)" : ""}`);
} else if (alvo === "reservar") {
  if (!acao) throw new Error("Informe o número da Meta com DDI e DDD.");
  console.log(`número reservado pela Meta: ${await registrarNumeroDaMeta(adminDb, acao)}`);
} else {
  const iDono = process.argv.indexOf("--dono");
  const dono = iDono > 0 ? process.argv[iDono + 1] : undefined;
  const ref = adminDb.doc(`tenants/${alvo}`);
  const atual = await ref.get();
  if (!atual.exists) throw new Error(`Negócio ${alvo} não existe.`);
  if (acao === "on") {
    const contato = await validarContatoDoNegocio(adminDb, String(atual.get("site.phone") ?? ""));
    if ("erro" in contato) throw new Error(contato.erro);
  }
  if (acao === "on" || acao === "off") await ref.set({ whatsapp: { canalOficial: acao === "on" } }, { merge: true });
  if (dono) {
    const numero = soDigitosComDDI(dono);
    if (!numero) throw new Error("WhatsApp do dono inválido.");
    if (await telefoneReservadoPelaMeta(adminDb, numero)) throw new Error(ERRO_TELEFONE_DA_META);
    await adminDb.doc(`tenants/${alvo}/privado/whatsapp`).set({ ownerPhone: numero }, { merge: true });
  }
  const depois = await ref.get();
  const fone = (await adminDb.doc(`tenants/${alvo}/privado/whatsapp`).get()).get("ownerPhone");
  console.log(`${alvo}: canalOficial=${depois.get("whatsapp.canalOficial") === true} dono=${typeof fone === "string" ? `…${fone.slice(-4)}` : "não cadastrado"} lembretes=${depois.get("whatsapp.remindersEnabled") === true}`);
}
