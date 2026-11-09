// Rode: npm run test:atendys  (cliente do atendys, assinatura do webhook e comando do salão; fetch
// simulado, Firestore no emulador)
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { assinaturaValida, assinaturaV2Valida, assumirEnvio, criarInstancia, enviarSemOperador, enviarTexto, ErroAtendys, manterAgendada, garantirTenant, imagemDoQr, revogarChavesAntigas, versaoDaAssinatura } from "@/lib/atendys";
import { DEMO } from "@/lib/demo";
import { comAvisoSair, optInDoDoc } from "@/lib/consentimento-whatsapp";
import { codigosUnicos, conectarNegocio, espelharStatusDaInstancia, gravarConexao, lerConexao, lerConfigWhatsApp, lerComando, pareceComando, processarComandoAgendamento } from "@/lib/whatsapp.server";

// ── assinatura do webhook ──
const corpo = JSON.stringify({ event: "message.received", instance: "casa-main" });
const assina = (s: string, b: string) => createHmac("sha256", s).update(b, "utf8").digest("hex");
assert.equal(assinaturaValida("segredo", corpo, assina("segredo", corpo)), true);
assert.equal(assinaturaValida("segredo", corpo, assina("outro", corpo)), false, "segredo errado");
assert.equal(assinaturaValida("segredo", corpo + " ", assina("segredo", corpo)), false, "corpo alterado");
assert.equal(assinaturaValida("segredo", corpo, "curta"), false, "tamanho diferente não lança");
// v2 (anti-replay): HMAC de "${timestamp}.${corpo}", timestamp em segundos, janela de ±300 s
const agora = Date.parse("2026-11-09T12:00:00Z");
const ts = String(agora / 1000);
const v2 = (t: string, b = corpo, s = "segredo") => assina(s, `${t}.${b}`);
assert.equal(assinaturaV2Valida("segredo", corpo, ts, v2(ts), agora), true, "v2 válida na janela");
assert.equal(assinaturaV2Valida("segredo", corpo, String(agora / 1000 - 300), v2(String(agora / 1000 - 300)), agora), true, "300 s ainda vale");
assert.equal(assinaturaV2Valida("segredo", corpo, String(agora / 1000 - 301), v2(String(agora / 1000 - 301)), agora), false, "301 s atrás");
assert.equal(assinaturaV2Valida("segredo", corpo, String(agora / 1000 + 301), v2(String(agora / 1000 + 301)), agora), false, "301 s no futuro");
assert.equal(assinaturaV2Valida("segredo", corpo + " ", ts, v2(ts), agora), false, "corpo alterado");
assert.equal(assinaturaV2Valida("segredo", corpo, ts, assina("segredo", corpo), agora), false, "assinada sem o prefixo do timestamp");
assert.equal(assinaturaV2Valida("segredo", corpo, `${ts}.0`, v2(`${ts}.0`), agora), false, "timestamp fora do formato");
const h = (x: Partial<{ v1: string; v2: string; timestamp: string }>) => ({ v1: x.v1 ?? null, v2: x.v2 ?? null, timestamp: x.timestamp ?? null });
assert.equal(versaoDaAssinatura("segredo", corpo, h({ v1: assina("segredo", corpo) }), agora), null, "só v1 (válida): recusa, v2 exigida");
assert.equal(versaoDaAssinatura("segredo", corpo, h({ v1: assina("segredo", corpo), v2: v2(ts), timestamp: ts }), agora), "v2");
assert.equal(versaoDaAssinatura("segredo", corpo, h({ v1: assina("segredo", corpo), v2: v2(ts, corpo, "outro"), timestamp: ts }), agora), null, "v2 presente e inválida: recusa mesmo com v1 boa");
assert.equal(versaoDaAssinatura("segredo", corpo, h({ v1: assina("segredo", corpo), v2: v2(ts) }), agora), null, "v2 sem timestamp: recusa");
assert.equal(versaoDaAssinatura("segredo", corpo, h({}), agora), null);

// ── comando do salão ──
assert.deepEqual(lerComando("CONFIRMADO"), { verbo: "CONFIRMADO", recusar: false, codigo: undefined });
assert.deepEqual(lerComando("  recusar ab12 "), { verbo: "RECUSAR", recusar: true, codigo: "AB12" });
assert.deepEqual(lerComando("Confirmado, obrigado!"), { verbo: "CONFIRMADO", recusar: false, codigo: undefined });
assert.equal(lerComando("cancelar"), null, "cancelar é opt-out do gateway, não comando");
assert.equal(lerComando("confirmadoo"), null);
assert.equal(lerComando("oi, tudo bem?"), null);
assert.equal(lerComando("confirmado ab12c")?.codigo, "AB12C", "código mais longo quando 4 letras empatam");
// erro de digitação: a até 2 letras de um verbo (sem acento, maiúscula)
for (const t of ["CONCFIRMADO EOLQ", "confimado", "CONFRIMADO", "recuzar ab12", "Confírmado"]) assert.equal(pareceComando(t), true, t);
for (const t of ["bom dia", "ok", "obrigado", "oi, tudo bem?", "", "sair"]) assert.equal(pareceComando(t), false, t);
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
const optInTeste = { origem: "ruphus-agendamento-online", evidencia: "aceite de teste" };
assert.deepEqual(await enviarTexto(conn, "+55 (11) 91234-5678", "oi", optInTeste), { messageId: "m1", status: "queued" });
assert.deepEqual(chamadas.map((c) => c.caminho), ["/v1/message/send-text", "/v1/optin", "/v1/message/send-text"]);
assert.equal(chamadas[0].headers.apikey, "k1");
assert.equal(chamadas[0].headers.instance, "casa-main", "o atendys exige o header instance");
assert.deepEqual(chamadas[0].corpo, { number: "5511912345678", text: "oi" });
assert.equal((chamadas[1].corpo as { category: string }).category, "transactional");
// já optado: um envio só
novo(atendys);
await enviarTexto(conn, "5511912345678", "de novo", optInTeste);
assert.deepEqual(chamadas.map((c) => c.caminho), ["/v1/message/send-text"]);
// outro erro não tenta opt-in; a tela recebe a frase, não o corpo cru
novo({ "POST /v1/message/send-text": () => erro(409, "INSTANCE_DISCONNECTED") });
await assert.rejects(enviarTexto(conn, "5511912345678", "x", optInTeste), (e) => e instanceof ErroAtendys && e.codigo === "INSTANCE_DISCONNECTED" && e.status === 409 && /desconectado/.test(e.message) && !/INSTANCE_DISCONNECTED/.test(e.message));
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
await assert.rejects(enviarTexto(conn, "5511912345678", "x", null), /Limite diário/);
// corpo que não é JSON: frase genérica com o status
novo({ "POST /v1/message/send-text": () => new Response("<html>bad gateway</html>", { status: 502 }) });
await assert.rejects(enviarTexto(conn, "5511912345678", "x", null), (e) => e instanceof ErroAtendys && e.codigo === null && /\(502\)/.test(e.message) && !/html/.test(e.message));

// ── reativação depois do SAIR: o atendys (optin.service.ts) exige eventId + occurredAt de um
// aceite posterior à revogação; o mesmo eventId reenviado é "já registrado" ──
{
  const { optInDoAgendamento, saiuEm } = { optInDoAgendamento: (await import("@/lib/consentimento-whatsapp")).optInDoAgendamento, saiuEm: new Map<string, number>() };
  const { saiuDepoisDoAceite } = await import("@/lib/atendys");
  const ativos = new Set<string>();
  const eventos = new Set<string>();
  const enviados: string[] = [];
  let corrida = false; // outro envio do mesmo agendamento registrou o aceite entre o 403 e o opt-in
  const simulado = {
    "POST /v1/message/send-text": (corpo: unknown) => {
      const c = corpo as { number: string; text: string };
      if (corrida) return ((corrida = false), erro(403, "NOT_OPTED_IN"));
      if (!ativos.has(c.number)) return erro(403, "NOT_OPTED_IN");
      enviados.push(c.text);
      return Response.json({ id: "m2", status: "queued" });
    },
    "POST /v1/optin": (corpo: unknown) => {
      const c = corpo as { number: string; eventId?: string; occurredAt?: string };
      const revogado = saiuEm.get(c.number);
      const conflito = (message: string) => Response.json({ error: { code: "VALIDATION_ERROR", message } }, { status: 409 });
      if (revogado !== undefined) {
        if (!c.eventId || !c.occurredAt) return conflito("Reativação exige eventId e occurredAt de uma nova autorização");
        if (Date.parse(c.occurredAt) <= revogado) return conflito("A autorização precisa ser posterior à revogação");
      }
      if (c.eventId && eventos.has(c.eventId)) return conflito("Este evento de consentimento já foi registrado");
      if (c.eventId) eventos.add(c.eventId);
      ativos.add(c.number);
      return Response.json({ phone: c.number, status: "opted_in" });
    },
  };
  const numero = "5511948680554";
  const aceite = (id: string, em: string) => optInDoAgendamento({ tenantId: "ruphusbel", agendamentoId: id, versao: "2026-11-08", em: new Date(em) });

  // (a) o opt-in leva eventId (um por agendamento) e occurredAt (o momento do aceite)
  novo(simulado);
  await enviarTexto(conn, numero, "recibo 1", aceite("AgA1", "2026-11-09T01:00:00.000Z"));
  assert.deepEqual(
    (({ eventId, occurredAt }) => ({ eventId, occurredAt }))(chamadas[1].corpo as unknown as { eventId: string; occurredAt: string }),
    { eventId: "ruphus-agendamento:ruphusbel:AgA1", occurredAt: "2026-11-09T01:00:00.000Z" },
  );

  // o cliente responde SAIR às 02:00
  ativos.delete(numero);
  saiuEm.set(numero, Date.parse("2026-11-09T02:00:00Z"));

  // (c) aceite anterior ao SAIR (lembrete do agendamento antigo): 409 tratado, sem envio, sem console.error
  const erros: unknown[] = [];
  const errorOriginal = console.error;
  console.error = (...a: unknown[]) => void erros.push(a);
  enviados.length = 0;
  novo(simulado);
  try {
    await assert.rejects(enviarTexto(conn, numero, "lembrete antigo", aceite("AgA1", "2026-11-09T01:00:00.000Z")), (e) => saiuDepoisDoAceite(e) && /SAIR/.test((e as Error).message));
  } finally {
    console.error = errorOriginal;
  }
  assert.deepEqual(erros, [], "SAIR depois do aceite é aviso, não erro");
  assert.deepEqual(enviados, [], "nada sai");
  assert.equal(chamadas.filter((c) => c.caminho === "/v1/optin").length, 1, "sem nova tentativa");

  // (b) aceite novo, posterior ao SAIR: reativa e o recibo sai
  novo(simulado);
  await enviarTexto(conn, numero, "recibo 2", aceite("AgB2", "2026-11-09T02:55:00.000Z"));
  assert.deepEqual(enviados, ["recibo 2"]);
  assert.ok(ativos.has(numero));

  // (d) o mesmo eventId reenviado (corrida com outro envio do mesmo agendamento): "já registrado" não é erro
  corrida = true;
  novo(simulado);
  await enviarTexto(conn, numero, "recibo 2 de novo", aceite("AgB2", "2026-11-09T02:55:00.000Z"));
  assert.deepEqual(chamadas.map((c) => c.caminho), ["/v1/message/send-text", "/v1/optin", "/v1/message/send-text"]);
}

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
const marcar = (id: string) => db.doc(`tenants/salao/appointments/${id}`).set({ status: "booked", start: daqui, customerName: `Cliente ${id}`, customerPhone: "(11) 98888-0000", serviceName: "Corte", whatsappConsent: { aceito: true, versao: "2026-11-08", em: new Date() } });
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

// erro de digitação do dono: resposta de ajuda, nada muda; conversa comum e cliente: sem resposta
{
  await marcar("Eolq77");
  enviadas.length = 0;
  assert.equal(await comando("CONCFIRMADO EOLQ"), "nao entendido");
  assert.deepEqual(enviadas, [{ para: "5511900000099", texto: "Não entendi. Para confirmar, responda CONFIRMADO <código>; para recusar, RECUSAR <código>." }]);
  assert.equal((await db.doc("tenants/salao/appointments/Eolq77").get()).get("status"), "booked", "continua aguardando");
  assert.equal(await comando("confimado"), "nao entendido", "sem código também");
  assert.equal(await comando("eolq"), "nao entendido", "só o código de um pendente");
  enviadas.length = 0;
  assert.equal(await comando("bom dia"), "ignorado");
  assert.equal(await comando("CONCFIRMADO", "5511977776666"), "ignorado", "cliente não é o dono");
  assert.equal(enviadas.length, 0, "nem conversa comum nem cliente recebem resposta");
  await db.doc("tenants/salao/appointments/Eolq77").update({ status: "cancelled" });
}

// conta antiga (12 dígitos): o número do salão gravado pelo instance.status e o pessoal do dono
// ficam sem o 9, mas desde 2026-11-08 o atendys manda o remetente com o 9. Tem de confirmar igual.
{
  const c = await lerConexao(db, "salao");
  await gravarConexao(db, "salao", { ...c!, phone: "551188887777" });
  await marcar("Zz11aa");
  assert.equal(await comando("confirmado zz11", "5511988887777"), "confirmado", "self-chat do salão de conta antiga");
  const { gravarOwnerPhone } = await import("@/lib/whatsapp.server");
  await gravarOwnerPhone(db, "salao", "551166665555");
  await marcar("Yy22bb");
  assert.equal(await comando("confirmado yy22", "5511966665555"), "confirmado", "WhatsApp pessoal do dono gravado sem o 9");
  assert.equal(await comando("confirmado", "5511955554444"), "ignorado", "terceiro continua sem poder confirmar");
  await gravarOwnerPhone(db, "salao", null);
  await gravarConexao(db, "salao", { ...c! });
}

// ── WhatsApp pessoal do dono: fora do documento do negócio (a equipe o lê pelo navegador) ──
{
  const { gravarOwnerPhone, paraTela } = await import("@/lib/whatsapp.server");
  await db.doc("tenants/salao").set({ whatsapp: { ownerPhone: "5511911112222" } }, { merge: true }); // legado
  await gravarOwnerPhone(db, "salao", "5511933334444");
  assert.equal((await db.doc("tenants/salao").get()).get("whatsapp.ownerPhone"), undefined, "sai do documento que a equipe lê");
  assert.equal((await db.doc("tenants/salao/privado/whatsapp").get()).get("ownerPhone"), "5511933334444");
  const c = await lerConexao(db, "salao");
  assert.equal(c?.ownerPhone, "5511933334444", "o servidor (comando CONFIRMADO, aviso) continua vendo");
  assert.equal(paraTela(c)?.ownerPhone, "5511933334444", "e a tela de quem gere, pela ação do servidor");
  await gravarConexao(db, "salao", { ...c!, status: "connected" });
  assert.equal((await db.doc("tenants/salao").get()).get("whatsapp.ownerPhone"), undefined, "regravar a conexão não o devolve ao documento");
}

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
  const t = Math.floor(Date.now() / 1000);
  return POST(new Request("http://x/api/webhooks/atendys", {
    method: "POST",
    headers: { "x-atendys-event": String(payload.event), "x-atendys-timestamp": String(t), "x-atendys-signature-v2": assina(segredo, `${t}.${body}`), "content-type": "application/json" },
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
// v2: válida → 200; timestamp de 10 min atrás (replay) → 401; v2 ruim com v1 boa → 401
const entregarV2 = (payload: Record<string, unknown>, t = Math.floor(Date.now() / 1000), segredoV2 = "s-antigo") => {
  const body = JSON.stringify(payload);
  return POST(new Request("http://x/api/webhooks/atendys", {
    method: "POST",
    headers: { "x-atendys-event": String(payload.event), "x-atendys-signature": assina("s-antigo", body), "x-atendys-timestamp": String(t), "x-atendys-signature-v2": assina(segredoV2, `${t}.${body}`), "content-type": "application/json" },
    body,
  }));
};
assert.equal((await entregarV2({ event: "instance.status", instance: "casa-main", status: "connected" })).status, 200, "v2 válida");
assert.equal((await entregarV2({ event: "instance.status", instance: "casa-main", status: "connected" }, Math.floor(Date.now() / 1000) - 600)).status, 401, "v2 velha (replay)");
assert.equal((await entregarV2({ event: "instance.status", instance: "casa-main", status: "connected" }, undefined, "errado")).status, 401, "v2 presente manda");
// só a v1, mesmo válida (o atendys antes de 2026-11-09): 401
{
  const body = JSON.stringify({ event: "instance.status", instance: "casa-main", status: "connected" });
  const soV1 = await POST(new Request("http://x/api/webhooks/atendys", { method: "POST", headers: { "x-atendys-event": "instance.status", "x-atendys-signature": assina("s-antigo", body) }, body }));
  assert.equal(soV1.status, 401, "só v1: recusa");
}
// assinatura que nem tem formato de HMAC hex: 401 antes de procurar o negócio
const curta = await POST(new Request("http://x/api/webhooks/atendys", { method: "POST", headers: { "x-atendys-event": "instance.status", "x-atendys-timestamp": String(Math.floor(Date.now() / 1000)), "x-atendys-signature-v2": "abc" }, body: JSON.stringify({ event: "instance.status", instance: "casa-main", status: "connected" }) }));
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

// vigia do cron: conexão que consta conectada, mas caiu sem o webhook chegar, vira desconectada
const { vigiarConexoes } = await import("@/lib/whatsapp.server");
await gravarConexao(db, "vigia", { atendysTenantId: "t9", atendysApiKey: "k9", atendysWebhookSecret: "s9", instanceId: "vigia-main", phone: "5511900000088", status: "connected", updatedAt: 0 });
novo({ ...salao, "GET /v1/instance/vigia-main/status": json({ name: "vigia-main", status: "disconnected", phone: null }) });
assert.equal(await vigiarConexoes(db), 1, "só a que caiu conta");
assert.equal((await lerConfigWhatsApp(db, "vigia"))?.status, "disconnected");
assert.equal((await lerConfigWhatsApp(db, "salao"))?.status, "connected", "a conectada fica como está");
// atendys fora do ar não derruba ninguém
await db.doc("tenants/vigia").update({ "whatsapp.status": "connected", "whatsapp.statusAt": FieldValue.delete() });
novo({});
assert.equal(await vigiarConexoes(db), 0);
assert.equal((await lerConfigWhatsApp(db, "vigia"))?.status, "connected");

// ── cota do dia: awaiting_manual não é envio; handoff e resume; quem envia sem operador decide ──
{
  const ID = "1bd4d428-4361-4153-bc2c-60db816d8b77";
  const parada = { id: ID, status: "awaiting_manual", retryAt: "2026-11-08T03:00:00.000Z", manualHandoffRequired: true, manualHandoffUrl: "https://wa.me/5511987654321?text=oi" };
  novo({ "POST /v1/message/send-text": json(parada, 202), [`POST /v1/message/${ID}/resume`]: json({ id: ID, status: "queued", retryAt: parada.retryAt }), [`POST /v1/message/${ID}/manual-handoff`]: json({ id: ID, status: "manual_started", manualHandoffUrl: parada.manualHandoffUrl, manualHandoffAt: "x" }) });
  const e = await enviarTexto(conn, "5511987654321", "oi", null);
  assert.deepEqual(e, { messageId: ID, status: "awaiting_manual", retryAt: parada.retryAt, manualHandoffRequired: true, manualHandoffUrl: parada.manualHandoffUrl });
  const { situacaoDe } = await import("@/lib/envio-whatsapp");
  assert.deepEqual(situacaoDe(e), { estado: "cota", messageId: ID, retryAt: parada.retryAt });
  assert.deepEqual(situacaoDe({ messageId: "m", status: "queued", retryAt: "2026-11-07T21:10:00Z" }), { estado: "agendada", retryAt: "2026-11-07T21:10:00Z" });
  assert.deepEqual(situacaoDe({ messageId: "m", status: "queued" }), { estado: "enviada" });

  // handoff e resume: POST com {} e a apikey do negócio
  assert.equal((await assumirEnvio(conn, ID)).status, "manual_started");
  assert.deepEqual([chamadas.at(-1)!.caminho, chamadas.at(-1)!.corpo, chamadas.at(-1)!.headers.apikey], [`/v1/message/${ID}/manual-handoff`, {}, "k1"]);
  assert.equal((await manterAgendada(conn, ID)).status, "queued");
  await assert.rejects(assumirEnvio(conn, "../admin/tenants"), /Mensagem inválida/, "id fora do formato não vira caminho");

  // sem operador: retryAt antes do prazo volta à fila; depois do prazo fica parada
  chamadas = [];
  assert.equal((await enviarSemOperador(conn, "5511987654321", "oi", null, new Date("2026-11-08T12:00:00Z"))).destino, "agendada");
  assert.ok(chamadas.some((c) => c.caminho.endsWith("/resume")));
  chamadas = [];
  assert.equal((await enviarSemOperador(conn, "5511987654321", "oi", null, new Date("2026-11-08T01:00:00Z"))).destino, "parada");
  assert.ok(!chamadas.some((c) => c.caminho.endsWith("/resume")), "lembrete que sairia depois do horário não volta à fila");
  chamadas = [];
  assert.equal((await enviarSemOperador(conn, "5511987654321", "oi", null)).destino, "parada", "sem prazo não reagenda para amanhã");
  assert.ok(!chamadas.some((c) => c.caminho.endsWith("/resume")));
  // envio comum segue "enviada"
  novo({ "POST /v1/message/send-text": json({ id: "m9", status: "queued" }) });
  assert.equal((await enviarSemOperador(conn, "5511987654321", "oi", null)).destino, "enviada");
}

// ── fase 2: parada registrada para o painel; webhook de status acha o negócio pelo índice ──
{
  const { paradasDoNegocio, negocioDaMensagem } = await import("@/lib/mensagens-paradas.server");
  const ID = "5b4707a3-aab9-48fe-94fb-aadd0232c0a6";
  await db.doc("tenants/loja").set({ name: "Loja" });
  await gravarConexao(db, "loja", { atendysTenantId: "t5", atendysApiKey: "k5", atendysWebhookSecret: "s-loja", instanceId: "loja-main", phone: null, status: "connected", updatedAt: 0 });
  const casa = (await lerConexao(db, "loja"))!;
  assert.equal(casa.slug, "loja", "lerConexao diz de qual negócio é");
  novo({ "POST /v1/message/send-text": json({ id: ID, status: "awaiting_manual", retryAt: "2026-11-08T03:00:00.000Z", manualHandoffRequired: true, manualHandoffUrl: "https://wa.me/5511987654321?text=Ol%C3%A1" }, 202) });
  await enviarTexto(casa, "5511987654321", "Olá, Ana! Lembrete do seu horário", null);
  assert.equal(await negocioDaMensagem(ID), "loja");
  const [p] = await paradasDoNegocio("loja");
  assert.deepEqual([p.messageId, p.para, p.resumo, p.retryAt], [ID, "••••4321", "Olá, Ana! Lembrete do seu horário", "2026-11-08T03:00:00.000Z"]);
  assert.ok(!JSON.stringify(p).includes("wa.me"), "o link com número e texto não é guardado");
  // envio comum não registra
  novo({ "POST /v1/message/send-text": json({ id: "m-comum", status: "queued" }) });
  await enviarTexto(casa, "5511987654321", "oi", null);
  assert.equal(await negocioDaMensagem("m-comum"), null);
  // status assinado com o segredo do negócio: grava; assinatura errada: 401 e nada muda
  assert.equal((await entregar({ event: "message.status", messageId: ID, phone: "x", status: "manual_started" }, "errado")).status, 200, "recusada responde como desconhecida");
  assert.equal((await paradasDoNegocio("loja")).length, 1);
  assert.equal((await entregar({ event: "message.status", messageId: ID, phone: "x", status: "manual_started" }, "s-loja")).status, 200);
  assert.equal((await paradasDoNegocio("loja")).length, 0, "decidida sai da lista");
  assert.equal((await db.doc(`tenants/loja/mensagens/${ID}`).get()).get("status"), "manual_started");
  // webhook atrasado (at anterior à decisão) não traz de volta a pendência
  assert.equal((await entregar({ event: "message.status", messageId: ID, status: "awaiting_manual", at: "2020-01-01T00:00:00Z" }, "s-loja")).status, 200);
  assert.equal((await paradasDoNegocio("loja")).length, 0, "fato velho não desfaz a decisão");
  // failed incerto reconciliado como sent pelo atendys: o errorCode antigo some; failed atrasado não volta
  const doc = () => db.doc(`tenants/loja/mensagens/${ID}`).get();
  await entregar({ event: "message.status", messageId: ID, status: "failed", errorCode: "SEND_OUTCOME_UNKNOWN", at: "2030-01-01T00:00:01Z" }, "s-loja");
  assert.deepEqual([(await doc()).get("status"), (await doc()).get("errorCode")], ["failed", "SEND_OUTCOME_UNKNOWN"]);
  await entregar({ event: "message.status", messageId: ID, status: "sent", at: "2030-01-01T00:00:02Z" }, "s-loja");
  assert.deepEqual([(await doc()).get("status"), (await doc()).get("errorCode")], ["sent", undefined], "sent limpa o erro");
  await entregar({ event: "message.status", messageId: ID, status: "failed", errorCode: "SEND_OUTCOME_UNKNOWN", at: "2030-01-01T00:00:01Z" }, "s-loja");
  assert.deepEqual([(await doc()).get("status"), (await doc()).get("errorCode")], ["sent", undefined], "failed atrasado não volta");

  // sem operador e com prazo útil: volta à fila e sai da lista; com prazo vencido, some da lista
  const ID2 = "2bd4d428-4361-4153-bc2c-60db816d8b77", ID3 = "3bd4d428-4361-4153-bc2c-60db816d8b77";
  novo({ "POST /v1/message/send-text": json({ id: ID2, status: "awaiting_manual", retryAt: "2026-11-08T03:00:00.000Z" }, 202), [`POST /v1/message/${ID2}/resume`]: json({ id: ID2, status: "queued" }) });
  assert.equal((await enviarSemOperador(casa, "5511987654321", "lembrete", null, new Date("2026-11-08T12:00:00Z"))).destino, "agendada");
  assert.equal((await db.doc(`tenants/loja/mensagens/${ID2}`).get()).get("status"), "queued");
  novo({ "POST /v1/message/send-text": json({ id: ID3, status: "awaiting_manual", retryAt: "2099-01-01T00:00:00.000Z" }, 202) });
  assert.equal((await enviarSemOperador(casa, "5511987654321", "lembrete", null, new Date("2020-01-01T00:00:00Z"))).destino, "parada");
  assert.equal((await paradasDoNegocio("loja")).length, 0, "lembrete de horário que já passou não fica pedindo decisão");

  // validade do atendys (24 h da criação): vencida sai da lista, com o campo expira ou, nas antigas, pela criação
  const ID4 = "4bd4d428-4361-4153-bc2c-60db816d8b77";
  novo({ "POST /v1/message/send-text": json({ id: ID4, status: "awaiting_manual", retryAt: null }, 202) });
  assert.equal((await enviarSemOperador(casa, "5511987654321", "pedido", null)).destino, "parada");
  assert.ok(Number((await db.doc(`tenants/loja/mensagens/${ID4}`).get()).get("expira")) > Date.now(), "grava a validade");
  assert.equal((await paradasDoNegocio("loja")).length, 1, "dentro das 24 h aparece");
  await db.doc(`tenants/loja/mensagens/${ID4}`).update({ expira: Date.now() - 1 });
  assert.equal((await paradasDoNegocio("loja")).length, 0, "vencida sai da lista");
  const { Timestamp, FieldValue: FV } = await import("firebase-admin/firestore");
  await db.doc(`tenants/loja/mensagens/${ID4}`).update({ expira: FV.delete(), criadaEm: Timestamp.fromMillis(Date.now() - 25 * 3600_000) });
  assert.equal((await paradasDoNegocio("loja")).length, 0, "registrada antes do campo: vale a criação + 24 h");

  // status de mensagem fora do índice: 200 sem gravar
  assert.equal((await entregar({ event: "message.status", messageId: "1bd4d428-4361-4153-bc2c-60db816d8b77", status: "sent" }, "qualquer")).status, 200);
}

// ── consentimento explícito: sem aceite gravado, nada vai ao cliente ──
{
  const aceite = { id: "Ac01bb", get: (c: string) => (c === "whatsappConsent" ? { aceito: true, versao: "2026-11-08", em: new Date("2026-11-08T10:00:00Z") } : undefined) };
  const oi = optInDoDoc("salao", aceite)!;
  assert.equal(oi.origem, "ruphus-agendamento-online");
  for (const parte of ["Quero receber pelo WhatsApp a confirmação e os avisos deste agendamento.", "2026-11-08", "2026-11-08T10:00:00.000Z", "Ac01bb", "salao"]) assert.ok(oi.evidencia.includes(parte), parte);
  assert.ok(oi.evidencia.length < 500);
  assert.equal(optInDoDoc("salao", { id: "x", get: () => undefined }), null, "agendamento antigo, sem o campo");
  assert.equal(optInDoDoc("salao", { id: "x", get: () => ({ aceito: false, versao: "v", em: new Date() }) }), null, "não aceitou");
  assert.ok(comAvisoSair("oi").endsWith("Para não receber mais mensagens, responda SAIR."));
  assert.equal(lerComando("sair"), null, "SAIR é do cliente (gateway), não comando do dono");

  // recusar: cliente é convidado a fazer novo agendamento
  novo(salao);
  await marcar("Rec1zz");
  enviadas.length = 0;
  assert.equal(await comando("recusar rec1"), "recusado");
  const paraCliente = enviadas.find((m) => m.para === "5511988880000")!;
  assert.match(paraCliente.texto, /não está disponível/);
  assert.match(paraCliente.texto, /Faça um novo agendamento/);
  assert.doesNotMatch(paraCliente.texto, /Que tal/);
  assert.match(paraCliente.texto, /\/agendar\/salao/);
  assert.match(paraCliente.texto, /responda SAIR\.$/);
  await db.doc("tenants/salao/appointments/Sem1aa").set({ status: "booked", start: daqui, customerName: "Antigo", customerPhone: "(11) 97777-0000", serviceName: "Corte" });
  enviadas.length = 0;
  assert.equal(await comando("confirmado sem1a"), "confirmado");
  assert.ok(!enviadas.some((m) => m.para === "5511977770000"), "cliente sem aceite não recebe");
  assert.ok(enviadas.some((m) => m.para === "5511900000099" && /não autorizou/.test(m.texto)), "o dono é avisado");
}

console.log("atendys ok");
process.exit(0);
