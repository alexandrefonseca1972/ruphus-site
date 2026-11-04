// Rode: npm run test:atendys  (cliente do atendys, assinatura do webhook e comando do salão; fetch
// simulado, Firestore no emulador)
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { assinaturaValida, criarInstancia, enviarTexto, garantirTenant, imagemDoQr } from "@/lib/atendys";
import { conectarNegocio, gravarConexao, lerConfigWhatsApp, lerComando } from "@/lib/whatsapp.server";

// ── assinatura do webhook ──
const corpo = JSON.stringify({ event: "message.received", instance: "casa-main" });
const assina = (s: string, b: string) => createHmac("sha256", s).update(b, "utf8").digest("hex");
assert.equal(assinaturaValida("segredo", corpo, assina("segredo", corpo)), true);
assert.equal(assinaturaValida("segredo", corpo, assina("outro", corpo)), false, "segredo errado");
assert.equal(assinaturaValida("segredo", corpo + " ", assina("segredo", corpo)), false, "corpo alterado");
assert.equal(assinaturaValida("segredo", corpo, "curta"), false, "tamanho diferente não lança");

// ── comando do salão ──
assert.deepEqual(lerComando("CONFIRMADO"), { verbo: "CONFIRMADO", recusar: false, codigo: undefined });
assert.deepEqual(lerComando("  recusar ab12 "), { verbo: "RECUSAR", recusar: true, codigo: "AB12" });
assert.deepEqual(lerComando("Confirmado, obrigado!"), { verbo: "CONFIRMADO", recusar: false, codigo: undefined });
assert.equal(lerComando("cancelar"), null, "cancelar é opt-out do gateway, não comando");
assert.equal(lerComando("confirmadoo"), null);
assert.equal(lerComando("oi, tudo bem?"), null);

// ── QR: a Evolution manda com o prefixo data:, só o base64 ou o texto do pareamento ──
assert.equal(await imagemDoQr("data:image/png;base64,iVBORw0KGgo="), "data:image/png;base64,iVBORw0KGgo=", "não prefixa de novo");
assert.equal(await imagemDoQr("iVBORw0KGgoAAAANSUhEUg=="), "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==");
assert.match(await imagemDoQr("2@AbCdEf,GhIjKl,MnOp=="), /^data:image\/png;base64,iVBOR/, "texto do pareamento vira PNG");

// ── cliente HTTP: fetch simulado, uma resposta por rota ──
process.env.ATENDYS_ADMIN_KEY = "chave-admin";
let chamadas: { metodo: string; caminho: string; corpo?: unknown; headers: Record<string, string> }[] = [];
let rotas: Record<string, (corpo: unknown) => Response> = {};
globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
  const caminho = new URL(String(url)).pathname;
  const metodo = init.method ?? "GET";
  const corpo = init.body ? JSON.parse(String(init.body)) : undefined;
  chamadas.push({ metodo, caminho, corpo, headers: init.headers as Record<string, string> });
  const rota = rotas[`${metodo} ${caminho}`];
  return rota ? rota(corpo) : new Response("rota não simulada", { status: 500 });
}) as typeof fetch;
const json = (d: unknown, status = 200) => () => Response.json(d, { status });
const novo = (r: typeof rotas) => ((chamadas = []), (rotas = r));

// tenant novo: cria e rotaciona (é a única forma de conhecer o segredo)
novo({
  "GET /admin/tenants": json([]),
  "POST /admin/tenants": json({ tenant: { id: "t1" }, apikey: "k1" }),
  "POST /admin/tenants/t1/webhook-secret/rotate": json({ webhookSecret: "s1" }),
});
assert.deepEqual(await garantirTenant("casa", "Casa"), { tenantId: "t1", apikey: "k1", webhookSecret: "s1" });
assert.equal(chamadas[0].headers["x-admin-key"], "chave-admin");

// tenant que já existe, com segredo gravado do lado de cá: não rotaciona
novo({ "GET /admin/tenants": json([{ id: "t1", slug: "casa" }]) });
assert.deepEqual(await garantirTenant("casa", "Casa"), { tenantId: "t1", apikey: "", webhookSecret: "" });
assert.ok(!chamadas.some((c) => c.caminho.endsWith("/rotate")), "reconexão não troca o segredo");

// sem segredo gravado: rotaciona; sem apikey: emite outra
novo({
  "GET /admin/tenants": json([{ id: "t1", slug: "casa" }]),
  "POST /admin/tenants/t1/keys": json({ apikey: "k2" }),
  "POST /admin/tenants/t1/webhook-secret/rotate": json({ webhookSecret: "s2" }),
});
assert.deepEqual(await garantirTenant("casa", "Casa", { reatribuirChave: true, rotacionarSegredo: true }), { tenantId: "t1", apikey: "k2", webhookSecret: "s2" });

// instância: o nome é {slug}-main (como o atendys monta); 409 é idempotente, outro erro sobe
novo({ "POST /admin/tenants/t1/instances": json({ ok: true }, 201) });
assert.deepEqual(await criarInstancia("t1", "casa"), { name: "casa-main" });
assert.deepEqual(chamadas[0].corpo, { name: "main" });
novo({ "POST /admin/tenants/t1/instances": () => new Response("Instância casa-main já existe", { status: 409 }) });
assert.deepEqual(await criarInstancia("t1", "casa"), { name: "casa-main" });
novo({ "POST /admin/tenants/t1/instances": () => new Response("fora", { status: 500 }) });
await assert.rejects(criarInstancia("t1", "casa"), /500/);

// envio: sem opt-in, inscreve e manda de novo uma vez. O simulado cobra o que o atendys cobra
// (apps/api/src/messages/messages.controller.ts, dto/index.ts): header `instance` no envio,
// `source` + `evidence` no opt-in, NOT_OPTED_IN como 403 no envelope { error: { code } }
const conn = { atendysApiKey: "k1", instanceId: "casa-main" };
const erro = (status: number, code: string) => Response.json({ error: { code, message: code } }, { status });
const optados = new Set<string>();
const atendys = {
  "POST /v1/message/send-text": (corpo: unknown) => {
    const ultima = chamadas[chamadas.length - 1]!;
    if (!ultima.headers.instance) return erro(400, "VALIDATION_ERROR");
    if (!optados.has((corpo as { number: string }).number)) return erro(403, "NOT_OPTED_IN");
    return Response.json({ id: "m1", status: "queued" });
  },
  "POST /v1/optin": (corpo: unknown) => {
    const c = corpo as { number: string; source?: string; evidence?: string };
    if (!c.source?.trim() || !c.evidence?.trim()) return erro(400, "VALIDATION_ERROR");
    optados.add(c.number);
    return Response.json({ phone: c.number, status: "opted_in" });
  },
};
novo(atendys);
assert.deepEqual(await enviarTexto(conn, "+55 (11) 91234-5678", "oi"), { messageId: "m1", status: "queued" });
assert.deepEqual(chamadas.map((c) => c.caminho), ["/v1/message/send-text", "/v1/optin", "/v1/message/send-text"]);
assert.equal(chamadas[0].headers.apikey, "k1");
assert.equal(chamadas[0].headers.instance, "casa-main", "o atendys exige o header instance");
assert.deepEqual(chamadas[0].corpo, { number: "5511912345678", text: "oi" });
assert.equal((chamadas[1].corpo as { category: string }).category, "transactional");
// já optado: um envio só
novo(atendys);
await enviarTexto(conn, "5511912345678", "de novo");
assert.deepEqual(chamadas.map((c) => c.caminho), ["/v1/message/send-text"]);
// outro erro não tenta opt-in
novo({ "POST /v1/message/send-text": () => erro(409, "INSTANCE_DISCONNECTED") });
await assert.rejects(enviarTexto(conn, "5511912345678", "x"), /409.*INSTANCE_DISCONNECTED/);
assert.equal(chamadas.length, 1);

// ── reconectar mantém o segredo gravado (o webhook segue aceitando) ──
const db = getFirestore();
await db.doc("tenants/casa").set({ name: "Casa" });
await gravarConexao(db, "casa", { atendysTenantId: "t1", atendysApiKey: "k1", atendysWebhookSecret: "s-antigo", instanceId: "casa-main", phone: null, status: "disconnected", updatedAt: 0 });
novo({ "GET /admin/tenants": json([{ id: "t1", slug: "casa" }]), "POST /admin/tenants/t1/instances": () => new Response("já existe", { status: 409 }) });
await conectarNegocio(db, "casa", "Casa", true);
const depois = await lerConfigWhatsApp(db, "casa");
assert.equal(depois?.atendysWebhookSecret, "s-antigo");
assert.equal(depois?.atendysApiKey, "k1");
assert.ok(!chamadas.some((c) => c.caminho.endsWith("/rotate")));

// ── webhook: o que o atendys entrega (queue-workers.service.ts: corpo = JSON.stringify(payload),
// HMAC hex em x-atendys-signature, evento em x-atendys-event) ──
const { POST } = await import("@/app/api/webhooks/atendys/route");
const entregar = (payload: Record<string, unknown>, segredo = "s-antigo") => {
  const body = JSON.stringify(payload);
  return POST(new Request("http://x/api/webhooks/atendys", {
    method: "POST",
    headers: { "x-atendys-event": String(payload.event), "x-atendys-signature": assina(segredo, body), "content-type": "application/json" },
    body,
  }));
};
// message.status não traz instância: 200 (400 fazia o atendys repetir 5 vezes cada status)
assert.equal((await entregar({ event: "message.status", messageId: "m1", phone: "5511", status: "delivered", at: "2026-11-03T12:00:00Z" })).status, 200);
// instância órfã: ack
assert.equal((await entregar({ event: "instance.status", instance: "ninguem-main", status: "connected" })).status, 200);
// assinatura com outro segredo: 401
assert.equal((await entregar({ event: "instance.status", instance: "casa-main", status: "connected" }, "errado")).status, 401);
// assinada: espelha o status
assert.equal((await entregar({ event: "instance.status", instance: "casa-main", status: "pending_qr" })).status, 200);
assert.equal((await lerConfigWhatsApp(db, "casa"))?.status, "qr");
// mensagem recebida (mídia, sem comando) vai para a caixa de entrada uma vez só
assert.equal((await entregar({ event: "message.received", instance: "casa-main", messageId: "ABC/1", phone: "5511999", type: "media", at: "2026-11-03T12:00:00Z" })).status, 200);
assert.equal((await entregar({ event: "message.received", instance: "casa-main", messageId: "ABC/1", phone: "5511999", type: "media", at: "2026-11-03T12:00:00Z" })).status, 200);
assert.equal((await db.collection("tenants/casa/whatsappInbox").get()).size, 1);

console.log("atendys ok");
process.exit(0);
