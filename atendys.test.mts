// Rode: npm run test:atendys  (cliente do atendys, assinatura do webhook e comando do salão; fetch
// simulado, Firestore no emulador)
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { assinaturaValida, criarInstancia, enviarTexto, ErroAtendys, garantirTenant, imagemDoQr, revogarChavesAntigas } from "@/lib/atendys";
import { DEMO } from "@/lib/demo";
import { codigosUnicos, conectarNegocio, espelharStatusDaInstancia, gravarConexao, lerConexao, lerConfigWhatsApp, lerComando, processarComandoAgendamento } from "@/lib/whatsapp.server";

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
assert.equal(lerComando("confirmado ab12c")?.codigo, "AB12C", "código mais longo quando 4 letras empatam");
// ids do Firestore diferem em maiúscula/minúscula: "Ab12…" e "aB12…" davam o mesmo AB12
assert.deepEqual([...codigosUnicos(["Ab12x9", "aB12y9", "zz99k1"]).values()], ["AB12X", "AB12Y", "ZZ99K"]);
assert.deepEqual([...codigosUnicos(["Ab12x9", "zz99k1"]).values()], ["AB12", "ZZ99"], "sem empate, 4 letras");

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
assert.deepEqual(await garantirTenant("casa", "Casa"), { tenantId: "t1", apikey: "k1", keyId: "", webhookSecret: "s1" });
assert.equal(chamadas[0].headers["x-admin-key"], "chave-admin");

// tenant que já existe, com segredo gravado do lado de cá: não rotaciona
novo({ "GET /admin/tenants": json([{ id: "t1", slug: "casa" }]), "GET /admin/tenants/t1/keys": json([{ id: "c0", label: "default", createdAt: "x", revokedAt: null }]) });
assert.deepEqual(await garantirTenant("casa", "Casa"), { tenantId: "t1", apikey: "", keyId: "", webhookSecret: "" });
assert.ok(!chamadas.some((c) => c.caminho.endsWith("/rotate")), "reconexão não troca o segredo");

// sem segredo gravado: rotaciona; sem apikey: emite outra
novo({
  "GET /admin/tenants": json([{ id: "t1", slug: "casa" }]),
  "POST /admin/tenants/t1/keys": json({ id: "c3", apikey: "k2" }),
  "POST /admin/tenants/t1/webhook-secret/rotate": json({ webhookSecret: "s2" }),
});
assert.deepEqual(await garantirTenant("casa", "Casa", { reatribuirChave: true, rotacionarSegredo: true }), { tenantId: "t1", apikey: "k2", keyId: "c3", webhookSecret: "s2" });
assert.ok(!chamadas.some((c) => c.metodo === "DELETE"), "garantirTenant não revoga: só depois de gravar");

// revogar: só as da Ruphus mais antigas que a nova, nunca a gravada. c4 é de uma conexão
// simultânea (mais nova que c3): revogá-la deixava o negócio sem chave nenhuma
novo({
  "GET /admin/tenants/t1/keys": json([
    { id: "c4", label: "ruphus-recovery", createdAt: "2026-11-04T10:00:02Z", revokedAt: null },
    { id: "c3", label: "ruphus-recovery", createdAt: "2026-11-04T10:00:01Z", revokedAt: null },
    { id: "c5", label: "ruphus-recovery", createdAt: "2026-11-03T10:00:00Z", revokedAt: null },
    { id: "c1", label: "default", createdAt: "2026-11-01T10:00:00Z", revokedAt: null },
    { id: "c2", label: "ruphus-recovery", createdAt: "2026-11-02T10:00:00Z", revokedAt: "2026-11-02T11:00:00Z" },
    { id: "c9", label: "integração manual", createdAt: "2026-10-01T10:00:00Z", revokedAt: null },
  ]),
  "DELETE /admin/tenants/t1/keys/c1": json({ revoked: true }),
  "DELETE /admin/tenants/t1/keys/c5": json({ revoked: true }),
});
await revogarChavesAntigas("t1", "c3", async () => "c3");
assert.deepEqual(chamadas.filter((c) => c.metodo === "DELETE").map((c) => c.caminho), ["/admin/tenants/t1/keys/c5", "/admin/tenants/t1/keys/c1"], "as antigas da Ruphus (c1, c5); nem a nova, nem a mais nova (c4), nem a revogada, nem a manual");
// outra conexão gravou a chave dela (c4) no meio: esta (c3) não é mais a dona e não revoga nada
novo({ ...rotas });
await revogarChavesAntigas("t1", "c3", async () => "c4");
assert.ok(!chamadas.some((c) => c.metodo === "DELETE"));

// chave gravada revogada no atendys: reconectar emite outra (antes ficava 401 para sempre)
novo({
  "GET /admin/tenants/t1": json({ id: "t1", slug: "casa" }),
  "GET /admin/tenants/t1/keys": json([{ id: "c3", label: "ruphus-recovery", createdAt: "2026-11-04T10:00:01Z", revokedAt: "2026-11-04T11:00:00Z" }]),
  "POST /admin/tenants/t1/keys": json({ id: "c7", apikey: "k7" }),
});
assert.deepEqual(await garantirTenant("casa", "Casa", { tenantId: "t1", keyId: "c3" }), { tenantId: "t1", apikey: "k7", keyId: "c7", webhookSecret: "" });
// chave gravada viva: nada muda
novo({ "GET /admin/tenants/t1": json({ id: "t1", slug: "casa" }), "GET /admin/tenants/t1/keys": json([{ id: "c3", label: "ruphus-recovery", createdAt: "x", revokedAt: null }]) });
assert.equal((await garantirTenant("casa", "Casa", { tenantId: "t1", keyId: "c3" })).apikey, "");

// tenant já conhecido do lado de cá: busca pelo id, sem baixar a lista inteira
novo({ "GET /admin/tenants/t1": json({ id: "t1", slug: "casa" }), "GET /admin/tenants/t1/keys": json([{ id: "c0", label: "default", createdAt: "x", revokedAt: null }]) });
assert.deepEqual(await garantirTenant("casa", "Casa", { tenantId: "t1" }), { tenantId: "t1", apikey: "", keyId: "", webhookSecret: "" });
// conexão antiga (sem id da chave) num tenant sem nenhuma chave da Ruphus ativa: emite outra
novo({
  "GET /admin/tenants/t1": json({ id: "t1", slug: "casa" }),
  "GET /admin/tenants/t1/keys": json([{ id: "c0", label: "default", createdAt: "x", revokedAt: "y" }, { id: "c9", label: "manual", createdAt: "x", revokedAt: null }]),
  "POST /admin/tenants/t1/keys": json({ id: "c8", apikey: "k8" }),
});
assert.equal((await garantirTenant("casa", "Casa", { tenantId: "t1" })).apikey, "k8");
assert.ok(!chamadas.some((c) => c.caminho === "/admin/tenants"));
// apagado no atendys (404) e recriado com o mesmo slug: chave e segredo do antigo não valem
novo({
  "GET /admin/tenants/t1": () => Response.json({ error: { code: "TENANT_NOT_FOUND" } }, { status: 404 }),
  "GET /admin/tenants": json([{ id: "t2", slug: "casa" }]),
  "POST /admin/tenants/t2/keys": json({ id: "d1", apikey: "k-t2" }),
  "POST /admin/tenants/t2/webhook-secret/rotate": json({ webhookSecret: "s-t2" }),
});
assert.deepEqual(await garantirTenant("casa", "Casa", { tenantId: "t1" }), { tenantId: "t2", apikey: "k-t2", keyId: "d1", webhookSecret: "s-t2" });

// instância: o nome vem da resposta (tenants.controller.ts devolve { instance: { name } });
// 409 diz que exatamente {slug}-main existe (instances.service.ts monta {slug}-{nome}). Outro erro sobe
novo({ "POST /admin/tenants/t1/instances": json({ instance: { id: "i1", name: "casa-main", status: "pending_qr" } }, 201) });
assert.deepEqual(await criarInstancia("t1", "casa"), { name: "casa-main" });
assert.deepEqual(chamadas[0].corpo, { name: "main" });
novo({ "POST /admin/tenants/t1/instances": () => Response.json({ error: { code: "VALIDATION_ERROR" } }, { status: 409 }), "GET /admin/instances": json([{ name: "casa-teste" }]) });
assert.deepEqual(await criarInstancia("t1", "casa"), { name: "casa-main" }, "não pega outra instância do tenant");
assert.equal(chamadas.length, 1);
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
// outro erro não tenta opt-in; a tela recebe a frase, não o corpo cru
novo({ "POST /v1/message/send-text": () => erro(409, "INSTANCE_DISCONNECTED") });
await assert.rejects(enviarTexto(conn, "5511912345678", "x"), (e) => e instanceof ErroAtendys && e.codigo === "INSTANCE_DISCONNECTED" && e.status === 409 && /desconectado/.test(e.message) && !/INSTANCE_DISCONNECTED/.test(e.message));
assert.equal(chamadas.length, 1);
// envio avulso (teste do dono, optIn null): não alega consentimento
optados.clear();
novo(atendys);
await assert.rejects(enviarTexto(conn, "5511900000001", "teste", null), /ainda não autorizou/);
assert.deepEqual(chamadas.map((c) => c.caminho), ["/v1/message/send-text"]);
// a evidência é a de quem chama
novo(atendys);
await enviarTexto(conn, "5511900000002", "recibo", { origem: "ruphus-agendamento-online", evidencia: "digitado no agendamento online de casa" });
assert.deepEqual(chamadas[1].corpo, { number: "5511900000002", source: "ruphus-agendamento-online", category: "transactional", evidence: "digitado no agendamento online de casa" });
// limite: a explicação do atendys (o "espere um pouco" enganava no limite do dia)
novo({ "POST /v1/message/send-text": () => Response.json({ error: { code: "RATE_LIMITED", message: "Limite diário de mensagens para este número atingido" } }, { status: 429 }) });
await assert.rejects(enviarTexto(conn, "5511912345678", "x"), /Limite diário/);
// corpo que não é JSON: frase genérica com o status
novo({ "POST /v1/message/send-text": () => new Response("<html>bad gateway</html>", { status: 502 }) });
await assert.rejects(enviarTexto(conn, "5511912345678", "x"), (e) => e instanceof ErroAtendys && e.codigo === null && /\(502\)/.test(e.message) && !/html/.test(e.message));

// ── reconectar mantém o segredo gravado (o webhook segue aceitando) ──
const db = getFirestore();
await db.doc("tenants/casa").set({ name: "Casa" });
await gravarConexao(db, "casa", { atendysTenantId: "t1", atendysApiKey: "k1", atendysWebhookSecret: "s-antigo", instanceId: "casa-main", phone: null, status: "disconnected", updatedAt: 0 });
novo({ "GET /admin/tenants/t1": json({ id: "t1", slug: "casa" }), "GET /admin/tenants/t1/keys": json([{ id: "c0", label: "default", createdAt: "x", revokedAt: null }]), "POST /admin/tenants/t1/instances": () => new Response("já existe", { status: 409 }) });
await conectarNegocio(db, "casa", "Casa", true);
const depois = await lerConfigWhatsApp(db, "casa");
assert.equal(depois?.atendysWebhookSecret, "s-antigo");
assert.equal(depois?.atendysApiKey, "k1");
assert.ok(!chamadas.some((c) => c.caminho.endsWith("/rotate")));

// ── comando do salão no WhatsApp: remetente, palavra educada, códigos empatados ──
await db.doc("tenants/salao").set({ name: "Salão" });
await gravarConexao(db, "salao", { atendysTenantId: "t5", atendysApiKey: "k5", atendysWebhookSecret: "s5", instanceId: "salao-main", phone: "5511900000099", status: "connected", updatedAt: 0 });
const daqui = new Date(Date.now() + 2 * 86_400_000);
const marcar = (id: string) => db.doc(`tenants/salao/appointments/${id}`).set({ status: "booked", start: daqui, customerName: `Cliente ${id}`, customerPhone: "(11) 98888-0000", serviceName: "Corte" });
const enviadas: { para: string; texto: string }[] = [];
const salao = {
  "GET /v1/instance/salao-main/status": json({ name: "salao-main", status: "connected", phone: "5511900000099" }),
  "POST /v1/message/send-text": (corpo: unknown) => {
    const c = corpo as { number: string; text: string };
    enviadas.push({ para: c.number, texto: c.text });
    return Response.json({ id: "m", status: "queued" });
  },
};
const comando = (texto: string, de = "5511900000099") => processarComandoAgendamento(db, "salao", { phone: de, data: { text: texto } });
novo(salao);
await marcar("Xy99aa");
assert.equal(await comando("confirmado", "5511977776666"), "ignorado", "cliente não confirma o próprio horário");
assert.equal(await comando("Confirmado obrigado!"), "confirmado", "palavra educada depois do verbo não é código");
assert.equal((await db.doc("tenants/salao/appointments/Xy99aa").get()).get("status"), "confirmed");
await marcar("Ab12xQ");
await marcar("aB12yR");
enviadas.length = 0;
assert.equal(await comando("confirmado ab12"), "sem pendente", "AB12 empata: pergunta");
assert.match(enviadas.at(-1)!.texto, /AB12X: .*\n?AB12Y|AB12Y: .*AB12X|AB12X[\s\S]*AB12Y/);
assert.equal(await comando("confirmado ab12y"), "confirmado");
assert.equal((await db.doc("tenants/salao/appointments/aB12yR").get()).get("status"), "confirmed");
assert.equal((await db.doc("tenants/salao/appointments/Ab12xQ").get()).get("status"), "booked");
// reenviar o código já confirmado não pode cair no único pendente que sobrou (o cliente errado)
assert.equal(await comando("confirmado ab12y"), "sem pendente");
assert.equal((await db.doc("tenants/salao/appointments/Ab12xQ").get()).get("status"), "booked", "AB12X continua aguardando");
assert.match(enviadas.at(-1)!.texto, /código AB12Y/);
// código só de letras (~40% dos ids): reenviado depois de confirmado, também não cai no outro
await marcar("Bcdefq");
await marcar("bCdegr");
assert.equal(await comando("confirmado bcdef"), "confirmado");
assert.equal(await comando("confirmado bcdef"), "sem pendente");
assert.equal((await db.doc("tenants/salao/appointments/bCdegr").get()).get("status"), "booked", "BCDEG continua aguardando");

// ── demonstração: não conecta e nada sai dela, mesmo com conexão esquecida no documento ──
await db.doc(`tenants/${DEMO}`).set({ name: "Demo" });
novo({});
await assert.rejects(conectarNegocio(db, DEMO, "Demo", true), /demonstração não conecta/);
assert.equal(chamadas.length, 0, "nem chega ao atendys");
await gravarConexao(db, DEMO, { atendysTenantId: "t9", atendysApiKey: "k9", atendysWebhookSecret: "s9", instanceId: "demo-main", phone: "559100000000", status: "connected", updatedAt: 0 });
assert.equal(await lerConexao(db, DEMO), null);

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
// demonstração com instância esquecida pareada: ack sem processar (lerConexao dela é null)
assert.equal((await entregar({ event: "instance.status", instance: "demo-main", status: "connected" }, "qualquer")).status, 200);
// instância órfã: ack
assert.equal((await entregar({ event: "instance.status", instance: "ninguem-main", status: "connected" })).status, 200);
// assinatura com outro segredo: 401
assert.equal((await entregar({ event: "instance.status", instance: "casa-main", status: "connected" }, "errado")).status, 401);
// assinatura que nem tem formato de HMAC hex: 401 antes de procurar o negócio
const curta = await POST(new Request("http://x/api/webhooks/atendys", { method: "POST", headers: { "x-atendys-event": "instance.status", "x-atendys-signature": "abc" }, body: JSON.stringify({ event: "instance.status", instance: "casa-main", status: "connected" }) }));
assert.equal(curta.status, 401);
// assinada: espelha o status
assert.equal((await entregar({ event: "instance.status", instance: "casa-main", status: "pending_qr" })).status, 200);
assert.equal((await lerConfigWhatsApp(db, "casa"))?.status, "qr");
// fora de ordem: o "disconnected" mais antigo, entregue depois, não desfaz o "connected" mais novo
await entregar({ event: "instance.status", instance: "casa-main", status: "connected", at: "2026-11-04T12:00:05Z" });
await entregar({ event: "instance.status", instance: "casa-main", status: "disconnected", at: "2026-11-04T12:00:00Z" });
assert.equal((await lerConfigWhatsApp(db, "casa"))?.status, "connected");
// a queda (connected → disconnected) devolve caiu: a rota manda o aviso no after(), que só existe
// dentro de uma requisição do Next — aqui, a função direto
assert.deepEqual(await espelharStatusDaInstancia(db, "casa", { status: "disconnected", at: "2026-11-04T12:00:09Z" }), { caiu: true });
assert.equal((await lerConfigWhatsApp(db, "casa"))?.status, "disconnected", "o mais novo vale");
assert.deepEqual(await espelharStatusDaInstancia(db, "casa", { status: "disconnected", at: "2026-11-04T12:00:10Z" }), { caiu: false }, "já estava desconectado: não avisa de novo");
assert.deepEqual(await espelharStatusDaInstancia(db, "casa", { status: "connecting" }), { caiu: false }, "status fora do contrato não muda nada");
assert.equal((await lerConfigWhatsApp(db, "casa"))?.status, "disconnected");
// reconectou: a falha antiga some; caiu de novo: o aviso ao dono roda (sem VAPID no teste, não envia) e não quebra
await db.doc("tenants/casa").set({ whatsapp: { lastNotifyError: { message: "WhatsApp desconectado: ninguém foi avisado", at: 1 } } }, { merge: true });
assert.equal((await entregar({ event: "instance.status", instance: "casa-main", status: "connected", at: "2026-11-04T12:01:00Z" })).status, 200);
assert.equal((await lerConfigWhatsApp(db, "casa"))?.lastNotifyError, undefined, "reconectar limpa a falha antiga");
assert.equal(typeof (await lerConfigWhatsApp(db, "casa"))?.conectadoEm, "number", "marca que já houve conexão (a faixa depende disso)");
// status ao vivo (polling/lembrete/agendamento) passa pelo mesmo espelho e não desfaz o statusAt
const { espelharStatusVivo } = await import("@/lib/whatsapp.server");
// mensagem recebida (mídia, sem comando) vai para a caixa de entrada uma vez só
assert.equal((await entregar({ event: "message.received", instance: "casa-main", messageId: "ABC/1", phone: "5511999", type: "media", at: "2026-11-03T12:00:00Z" })).status, 200);
assert.equal((await entregar({ event: "message.received", instance: "casa-main", messageId: "ABC/1", phone: "5511999", type: "media", at: "2026-11-03T12:00:00Z" })).status, 200);
assert.equal((await db.collection("tenants/casa/whatsappInbox").get()).size, 1);
// leitura ao vivo que começou ANTES do webhook "connected" mais novo: descartada (sem aviso falso ao reconectar)
await espelharStatusVivo(db, "casa", { status: "disconnected", phone: null }, Date.parse("2026-11-04T12:00:30Z"));
assert.equal((await lerConfigWhatsApp(db, "casa"))?.status, "connected", "leitura velha não desfaz o connected");
// leitura ao vivo nova: vale (webhook perdido também vira status)
await espelharStatusVivo(db, "casa", { status: "disconnected", phone: null }, Date.parse("2026-11-04T12:03:00Z"));
assert.equal((await lerConfigWhatsApp(db, "casa"))?.status, "disconnected");

// conexão anterior ao marcador (sem conectadoEm) que cai: ganha o marcador e a faixa aparece
await db.doc("tenants/casa").update({ "whatsapp.status": "connected", "whatsapp.conectadoEm": FieldValue.delete(), "whatsapp.statusAt": FieldValue.delete() });
assert.deepEqual(await espelharStatusDaInstancia(db, "casa", { status: "disconnected" }), { caiu: true });
assert.equal(typeof (await lerConfigWhatsApp(db, "casa"))?.conectadoEm, "number");
// desconectar zera o marcador: QR novo que expira sem ler não é "desconectou"
const { desligarConexao } = await import("@/lib/whatsapp.server");
await desligarConexao(db, "casa");
assert.equal((await lerConfigWhatsApp(db, "casa"))?.conectadoEm, undefined);

console.log("atendys ok");
process.exit(0);
