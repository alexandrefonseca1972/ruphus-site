// Rode: npm run test:atendys  (cliente do atendys, assinatura do webhook e comando do salão; fetch
// simulado, Firestore no emulador)
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { assinaturaValida, assinaturaV2Valida, assumirEnvio, chaveDeEnvio, criarInstancia, enviarSemOperador, enviarTexto, ErroAtendys, manterAgendada, garantirTenant, imagemDoQr, revogarChavesAntigas, versaoDaAssinatura } from "@/lib/atendys";
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
assert.deepEqual(
  { dia: (chamadas[1].corpo as { recipientMsgPerDay?: number }).recipientMsgPerDay, semana: (chamadas[1].corpo as { recipientMsgPerWeek?: number }).recipientMsgPerWeek },
  { dia: 30, semana: 150 },
  "tenant novo nasce com o limite por destinatário da Ruphus, não com o padrão 3/10",
);

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
  enviadas.length = 0;
  assert.equal(await comando("confimado", "5511966665555"), "nao entendido");
  assert.equal(enviadas.at(-1)?.para, "5511966665555", "a resposta volta ao WhatsApp pessoal de quem mandou, não ao self-chat");
  assert.equal((chamadas.at(-1)!.corpo as { replyToInbound?: boolean }).replyToInbound, true, "resposta ao pessoal vai como replyToInbound");
  await gravarOwnerPhone(db, "salao", null);
  await gravarConexao(db, "salao", { ...c! });
}

// atendys fora do ar com comando do dono: lança (o pendente fica para o cron); conversa comum, não
{
  novo({ ...salao, "GET /v1/instance/salao-main/status": () => new Response("fora", { status: 503 }) });
  await assert.rejects(comando("confirmado"), "comando não some quando o atendys não responde");
  assert.equal(await comando("bom dia"), "ignorado", "conversa comum segue ignorada");
  novo(salao);
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

// ── aviso de novo agendamento: o pessoal do dono primeiro; o self-chat só avisa ──
{
  const { destinoDoAvisoAoDono } = await import("@/lib/whatsapp.server");
  assert.deepEqual(destinoDoAvisoAoDono({ phone: "5511900000099", ownerPhone: "5511933334444" }), { para: "5511933334444", podeResponder: true }, "o pessoal do dono vem primeiro");
  assert.deepEqual(destinoDoAvisoAoDono({ phone: "5511900000099", ownerPhone: null }), { para: "5511900000099", podeResponder: false }, "self-chat: só aviso, sem pedir resposta");
  assert.equal(destinoDoAvisoAoDono({ phone: null, ownerPhone: null }), null);
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
// o servidor do Next põe o AsyncLocalStorage no globalThis antes de carregar as rotas (o after() dos
// testes da rodada 2 depende dele)
(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= (await import("node:async_hooks")).AsyncLocalStorage;
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
  const parada = { id: ID, status: "awaiting_manual", retryAt: new Date(Date.now() + 3 * 3_600_000).toISOString(), manualHandoffRequired: true, manualHandoffUrl: "https://wa.me/5511987654321?text=oi" };
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
  assert.equal((await enviarSemOperador(conn, "5511987654321", "oi", null, new Date(Date.now() + 5 * 3_600_000))).destino, "agendada");
  assert.ok(chamadas.some((c) => c.caminho.endsWith("/resume")));
  chamadas = [];
  assert.equal((await enviarSemOperador(conn, "5511987654321", "oi", null, new Date(Date.now() + 2 * 3_600_000))).destino, "parada");
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
  // envio comum não vai para o painel, mas é vigiado (a falha depois do aceite acha o negócio)
  novo({ "POST /v1/message/send-text": json({ id: "m-comum", status: "queued" }) });
  await enviarTexto(casa, "5511987654321", "oi", null);
  assert.equal(await negocioDaMensagem("m-comum"), "loja");
  assert.equal((await paradasDoNegocio("loja")).length, 1);
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
  novo({ "POST /v1/message/send-text": json({ id: ID2, status: "awaiting_manual", retryAt: new Date(Date.now() + 3 * 3_600_000).toISOString() }, 202), [`POST /v1/message/${ID2}/resume`]: json({ id: ID2, status: "queued" }) });
  assert.equal((await enviarSemOperador(casa, "5511987654321", "lembrete", null, new Date(Date.now() + 5 * 3_600_000))).destino, "agendada");
  assert.equal((await db.doc(`tenants/loja/mensagens/${ID2}`).get()).get("status"), "queued");
  novo({ "POST /v1/message/send-text": json({ id: ID3, status: "awaiting_manual", retryAt: "2099-01-01T00:00:00.000Z" }, 202) });
  assert.equal((await enviarSemOperador(casa, "5511987654321", "lembrete", null, new Date("2020-01-01T00:00:00Z"))).destino, "nao_sai");
  assert.equal(chamadas.length, 0, "prazo vencido: nem envia");
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
  // botão do dono vira CONFIRMADO com o código longo (12): acha o agendamento sem ambiguidade
  const { codigoDoAgendamento } = await import("@/lib/whatsapp.server");
  await marcar("Btn1zzzzzzzzzzzzzzzz");
  await marcar("Btn1yyyyyyyyyyyyyyyy");
  assert.equal(await comando(`CONFIRMADO ${codigoDoAgendamento("Btn1zzzzzzzzzzzzzzzz", 12)}`), "confirmado");
  assert.equal((await db.doc("tenants/salao/appointments/Btn1zzzzzzzzzzzzzzzz").get()).get("status"), "confirmed");
  assert.equal((await db.doc("tenants/salao/appointments/Btn1yyyyyyyyyyyyyyyy").get()).get("status"), "booked", "o de mesmo início não muda");
  // comando pendente sai na mesma transação da confirmação: repetir depois não diz "não encontrei"
  await marcar("Pen1zz");
  await db.doc("comandosPendentes/salao__P1").set({ slug: "salao", text: "confirmado pen1", pegoEm: 0, tentativas: 1 });
  assert.equal(await processarComandoAgendamento(db, "salao", { phone: "5511900000099", data: { text: "confirmado pen1" } }, "salao", "salao__P1"), "confirmado");
  assert.ok(!(await db.doc("comandosPendentes/salao__P1").get()).exists);
}

// ── P1: prazo (expiresAt), falha depois do aceite visível, comando do dono reprocessável ──
{
  const { negocioDaMensagem } = await import("@/lib/mensagens-paradas.server");
  const { executarComandoPendente, idDoComando, registrarMensagemRecebida, reprocessarComandos } = await import("@/lib/whatsapp.server");
  const loja = (await lerConexao(db, "loja"))!;
  const prazo = new Date(Date.now() + 3 * 3_600_000);
  const ID4 = "4cd4d428-4361-4153-bc2c-60db816d8b77";
  // prazo útil vai como expiresAt; adiado (horário silencioso) para depois do prazo: não é "agendada"
  novo({ "POST /v1/message/send-text": json({ id: ID4, status: "queued", retryAt: new Date(prazo.getTime() + 3_600_000).toISOString() }, 202) });
  assert.equal((await enviarSemOperador(loja, "5511987654321", "lembrete", null, prazo)).destino, "nao_sai", "sairia depois do horário");
  assert.equal((chamadas[0].corpo as { expiresAt?: string }).expiresAt, prazo.toISOString());
  assert.equal(await negocioDaMensagem(ID4), "loja", "vigiada: o status failed (vencida) acha o negócio");
  novo({ "POST /v1/message/send-text": json({ id: "m-x", status: "queued" }) });
  // prazo sem folga (o atendys recusaria o expiresAt e a mensagem sairia atrasada): nem envia
  assert.equal((await enviarSemOperador(loja, "5511987654321", "oi", null, new Date(Date.now() + 30_000))).destino, "nao_sai");
  assert.equal(chamadas.length, 0);
  // lembrete: idempotency-key determinística; sem chave, sem cabeçalho
  const k = chaveDeEnvio("lembrete", "loja", "ag1", "2026-11-10T10:00");
  assert.match(k, /^lembrete-[0-9a-f]{40}$/);
  assert.equal(k, chaveDeEnvio("lembrete", "loja", "ag1", "2026-11-10T10:00"), "a mesma em toda tentativa");
  assert.notEqual(k, chaveDeEnvio("lembrete", "loja", "ag1", "2026-11-10T11:00"), "remarcou: outra chave");
  novo({ "POST /v1/message/send-text": json({ id: "m-k", status: "queued" }) });
  await enviarSemOperador(loja, "5511987654321", "lembrete", null, undefined, { chave: k });
  assert.equal(chamadas[0].headers["idempotency-key"], k);
  novo({ "POST /v1/message/send-text": json({ id: "m-k2", status: "queued" }) });
  await enviarSemOperador(loja, "5511987654321", "oi", null);
  assert.equal(chamadas[0].headers["idempotency-key"], undefined, "sem chave: sem cabeçalho");

  // todo envio aceito é vigiado; failed depois do aceite vai para a gaveta, uma vez
  const ID5 = "5cd4d428-4361-4153-bc2c-60db816d8b77";
  novo({ "POST /v1/message/send-text": json({ id: ID5, status: "queued" }) });
  assert.equal((await enviarSemOperador(loja, "5511987654321", "Seu horário está confirmado", null)).destino, "enviada");
  assert.equal(await negocioDaMensagem(ID5), "loja");
  await db.doc("tenants/loja").set({ whatsapp: { lastNotifyError: null } }, { merge: true });
  assert.equal((await entregar({ event: "message.status", messageId: ID5, status: "failed", errorCode: "META_131026" }, "s-loja")).status, 200);
  const erro = (await lerConfigWhatsApp(db, "loja"))?.lastNotifyError;
  assert.match(erro?.message ?? "", /não foi entregue: o número do cliente não recebe/);
  assert.match(erro?.message ?? "", /Seu horário está confirmado/);
  await db.doc("tenants/loja").set({ whatsapp: { lastNotifyError: null } }, { merge: true });
  await entregar({ event: "message.status", messageId: ID5, status: "failed", errorCode: "META_131026" }, "s-loja");
  assert.equal((await lerConfigWhatsApp(db, "loja"))?.lastNotifyError ?? null, null, "reentrega não repete o aviso");
  // negócio desconectado (sem instanceId) ainda recebe o message.status do que mandou antes
  const ID6 = "6cd4d428-4361-4153-bc2c-60db816d8b77";
  novo({ "POST /v1/message/send-text": json({ id: ID6, status: "queued" }) });
  await enviarSemOperador(loja, "5511987654321", "Lembrete de amanhã", null);
  await db.doc("tenants/loja").update({ "whatsapp.instanceId": FieldValue.delete() });
  assert.equal((await entregar({ event: "message.status", messageId: ID6, status: "failed", errorCode: "META_131026" }, "s-loja")).status, 200);
  assert.match((await lerConfigWhatsApp(db, "loja"))?.lastNotifyError?.message ?? "", /Lembrete de amanhã/, "desconectado: a falha chega à gaveta");
  await db.doc("tenants/loja").update({ "whatsapp.instanceId": "loja-main", "whatsapp.lastNotifyError": FieldValue.delete() });

  // comando do dono: pendente gravado com a caixa de entrada; sai só depois de processado
  assert.equal(await registrarMensagemRecebida(db, "loja", { phone: "5511900000001", messageId: "CMD/1", data: { text: "oi" } }, "salao"), true);
  const pend = db.doc(`comandosPendentes/${idDoComando("loja", "CMD_1")}`);
  assert.ok((await pend.get()).exists);
  assert.equal(await registrarMensagemRecebida(db, "loja", { phone: "5511900000001", messageId: "CMD/1", data: { text: "oi" } }, "salao"), false, "reentrega cai no dedupe");
  assert.equal(await reprocessarComandos(db), 0, "recém-chegado é de quem recebeu (after), não do cron");
  await pend.update({ pegoEm: Date.now() - 6 * 60_000 }); // o processo caiu antes de terminar
  assert.equal(await reprocessarComandos(db), 1);
  assert.ok(!(await pend.get()).exists, "processado sai");
  assert.equal(await executarComandoPendente(db, idDoComando("loja", "CMD_1")), null, "sem pendente: nada");
  // falhou 3 vezes: desiste e avisa na gaveta
  await pend.set({ slug: "loja", phone: "5511900000001", text: "CONFIRMADO AB12", via: "salao", pegoEm: 0, tentativas: 3 });
  assert.equal(await reprocessarComandos(db), 0);
  assert.ok(!(await pend.get()).exists);
  assert.match((await lerConfigWhatsApp(db, "loja"))?.lastNotifyError?.message ?? "", /comando do dono .* descartado/);
  // aviso de agendamento que saiu não apaga a falha de outra coisa (lembrete, comando descartado)
  const { limparErroDeAgendamento, registrarErroNotificacao } = await import("@/lib/whatsapp.server");
  await registrarErroNotificacao(db, "loja", { message: "O lembrete de Ana não saiu", at: 1 });
  await limparErroDeAgendamento(db, "loja");
  assert.equal((await lerConfigWhatsApp(db, "loja"))?.lastNotifyError?.message, "O lembrete de Ana não saiu", "falha de lembrete fica");
  await registrarErroNotificacao(db, "loja", { message: "Agendamento de Ana — aviso ao salão não chegou.", at: 2 });
  await limparErroDeAgendamento(db, "loja");
  assert.equal((await lerConfigWhatsApp(db, "loja"))?.lastNotifyError ?? null, null, "falha de aviso de agendamento sai");
  // sem messageId: fica na caixa de entrada, sem pendente
  const pendentesAntes = (await db.collection("comandosPendentes").get()).size;
  assert.equal(await registrarMensagemRecebida(db, "loja", { phone: "5511900000001", data: { text: "CONFIRMADO" } }, "salao"), true);
  assert.equal((await db.collection("comandosPendentes").get()).size, pendentesAntes);
}

// ── botões: o cliente confirma presença, remarca por lista e cancela; o dono confirma por botão ──
{
  const { idBotao, lerBotao, templateCliente: tc, templateNovoDono: tnd, TEMPLATES } = await import("@/lib/canal-oficial.server");
  const { acaoDoCliente, chaveDoHorario, pedidoDesatualizado } = await import("@/lib/botoes-whatsapp.server");
  const { enviarTemplate } = await import("@/lib/atendys");
  const { zonedTime, addDays, todayIn } = await import("@/lib/datetime");
  assert.deepEqual(lerBotao(idBotao("ch", "ofc", "A1b2", "2026-11-14T15:00")), { acao: "ch", slug: "ofc", agendamento: "A1b2", extra: "2026-11-14T15:00" });
  assert.equal(lerBotao("rph:zz:ofc:A1"), null);
  assert.equal(lerBotao("rph:cp:../x:A1"), null, "id fora do formato não vira caminho");
  // templates com botões só com a chave ligada (depois da aprovação na Meta)
  const c = { nome: "A", negocio: "B", servico: "C", quando: "D", contato: "E" };
  assert.equal(tc("lembrete", c, { slug: "ofc", agendamento: "A1" }).nome, TEMPLATES.lembrete);
  process.env.ATENDYS_TEMPLATES_BOTOES = "1";
  const lem = tc("lembrete", c, { slug: "ofc", agendamento: "A1" });
  assert.deepEqual([lem.nome, lem.botoes], [TEMPLATES.lembreteBotoes, ["rph:cp:ofc:A1", "rph:cr:ofc:A1", "rph:cx:ofc:A1"]]);
  assert.deepEqual(tnd({ negocio: "B", cliente: "M", telefone: "1", servico: "C", quando: "D", codigo: "X" }, { slug: "ofc", agendamento: "A1" }).botoes, ["rph:dc:ofc:A1", "rph:dr:ofc:A1"]);
  novo({ "POST /v1/message/send-template": json({ id: "t1", status: "queued" }) });
  await enviarTemplate({ atendysApiKey: "k", instanceId: "i" }, "5511988881111", lem, null);
  const comps = (chamadas[0].corpo as { components: { type: string; sub_type?: string; index?: string; parameters: { payload?: string }[] }[] }).components;
  assert.deepEqual(comps.filter((x) => x.type === "button").map((x) => [x.sub_type, x.index, x.parameters[0].payload]), [["quick_reply", "0", "rph:cp:ofc:A1"], ["quick_reply", "1", "rph:cr:ofc:A1"], ["quick_reply", "2", "rph:cx:ofc:A1"]]);

  // negócio no canal oficial, com agenda e um agendamento de amanhã às 10:00
  await db.doc("config/atendys-plataforma").set({ tenantId: "tp", apikey: "kp", webhookSecret: "sp" });
  const t = db.doc("tenants/ofc");
  await t.set({ name: "Ofc", whatsapp: { canalOficial: true } });
  await db.doc("tenants/ofc/privado/whatsapp").set({ ownerPhone: "5591992361726" });
  await t.collection("services").doc("corte").set({ name: "Corte", durationMin: 30, priceCents: 5000, active: true });
  const todos = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, { start: "08:00", end: "20:00" }]));
  await t.collection("staff").doc("ana").set({ name: "Ana", serviceIds: ["corte"], hours: todos, active: true });
  const amanha = addDays(todayIn(), 1);
  const ag = (id: string, extra: Record<string, unknown> = {}) => t.collection("appointments").doc(id).set({
    status: "booked", start: zonedTime(amanha, "10:00"), end: zonedTime(amanha, "10:30"), customerName: "Maria Souza", customerPhone: "(11) 98888-1111",
    serviceIds: ["corte"], staffId: "ana", serviceName: "Corte", durationMin: 30, priceCents: 5000, whatsappConsent: { aceito: true, versao: "2026-11-08", em: new Date() }, ...extra,
  });
  await ag("Ag1aaaaaaaaaaaaaaaaa");
  const enviadas: { caminho: string; corpo: Record<string, unknown> }[] = [];
  const guarda = (caminho: string) => (corpo: unknown) => (enviadas.push({ caminho, corpo: corpo as Record<string, unknown> }), Response.json({ id: `m${enviadas.length}`, status: "queued" }));
  novo({ "POST /v1/message/send-text": guarda("texto"), "POST /v1/message/send-interactive": guarda("lista"), "POST /v1/message/send-template": guarda("template") });
  const b = (acao: string, extra?: string) => lerBotao(idBotao(acao as "cp", "ofc", "Ag1aaaaaaaaaaaaaaaaa", extra))!;

  assert.equal(await acaoDoCliente(db, b("cp"), "5511977770000"), "agendamento de outro telefone");
  assert.equal(enviadas.length, 0);
  assert.equal(await acaoDoCliente(db, b("cp"), "5511988881111"), "presença confirmada");
  assert.ok((await t.collection("appointments").doc("Ag1aaaaaaaaaaaaaaaaa").get()).get("presencaConfirmadaEm"));
  // ainda não confirmado pelo estabelecimento: não diz "confirmado"
  assert.match(String(enviadas.at(-1)!.corpo.text), /Avisamos o estabelecimento que você vai: Corte, amanhã às 10:00. Ele ainda vai confirmar/);
  assert.equal(enviadas.at(-1)!.corpo.replyToInbound, true, "resposta: fora da cota por destinatário e do dedupe");
  // mesmo horário (lista antiga, toque repetido) não remarca nem desfaz nada
  assert.equal(await acaoDoCliente(db, b("ch", `${amanha}T10:00`), "5511988881111"), "mesmo horário");
  assert.equal(await acaoDoCliente(db, b("ch", "2020-01-01T10:00"), "5511988881111"), "horário inválido");
  assert.equal(await acaoDoCliente(db, b("ch", `${addDays(todayIn(), 200)}T10:00`), "5511988881111"), "horário inválido", "fora da janela da agenda");

  // remarcar: lista com até 10 horários livres; tocar num deles remarca e o dono recebe o pedido com botões
  assert.equal(await acaoDoCliente(db, b("cr"), "5511988881111"), "horários enviados");
  const lista = enviadas.at(-1)!;
  assert.equal(lista.caminho, "lista");
  const itens = lista.corpo.list as { id: string; title: string }[];
  assert.ok(itens.length > 0 && itens.length <= 10);
  // ch leva "<origem>_<destino>": o horário de agora e o escolhido
  assert.ok(itens.every((i) => lerBotao(i.id)!.extra!.startsWith(`${amanha}T10:00_`)), "origem no id");
  assert.ok(!itens.some((i) => lerBotao(i.id)!.extra!.split("_")[1] === `${amanha}T10:00`), "o horário atual não entra na lista");
  assert.equal(lista.corpo.replyToInbound, true);
  const escolhido = lerBotao(itens.at(-1)!.id)!;
  assert.equal(escolhido.acao, "ch");
  assert.equal(await acaoDoCliente(db, escolhido, "5511988881111"), "remarcado");
  const destinoEscolhido = escolhido.extra!.split("_")[1];
  const [d, h] = destinoEscolhido.split("T");
  const depois = await t.collection("appointments").doc("Ag1aaaaaaaaaaaaaaaaa").get();
  assert.equal(depois.get("start").toDate().getTime(), zonedTime(d, h).getTime());
  assert.equal(depois.get("status"), "booked", "remarcado volta a aguardar o dono");
  assert.equal(depois.get("presencaConfirmadaEm"), undefined, "a presença confirmada era do horário antigo: a remarcação apaga");
  const pedido = enviadas.find((e) => e.caminho === "template")!;
  assert.equal(pedido.corpo.name, TEMPLATES.novoDonoBotoes);
  assert.equal(pedido.corpo.number, "5591992361726");
  // o pedido leva o horário novo no id: o botão do pedido antigo fica desatualizado
  const doPedido = (pedido.corpo.components as { type: string; parameters: { payload?: string }[] }[]).filter((x) => x.type === "button").map((x) => lerBotao(x.parameters[0].payload)!);
  assert.equal(doPedido[0].extra, destinoEscolhido);
  assert.equal(await pedidoDesatualizado(db, doPedido[0]), false);
  assert.equal(await pedidoDesatualizado(db, lerBotao(idBotao("dc", "ofc", "Ag1aaaaaaaaaaaaaaaaa", `${amanha}T10:00`))!), true);
  // confirmado pelo dono: remarcar pelo cliente mantém confirmado e não pede de novo
  await t.collection("appointments").doc("Ag1aaaaaaaaaaaaaaaaa").update({ status: "confirmed" });
  enviadas.length = 0;
  await acaoDoCliente(db, b("cr"), "5511988881111");
  const outro = lerBotao((enviadas.at(-1)!.corpo.list as { id: string }[])[0].id)!;
  assert.equal(await acaoDoCliente(db, outro, "5511988881111"), "remarcado");
  const conf = await t.collection("appointments").doc("Ag1aaaaaaaaaaaaaaaaa").get();
  assert.deepEqual([conf.get("status"), chaveDoHorario(conf.get("start").toDate())], ["confirmed", outro.extra!.split("_")[1]]);
  assert.ok(!enviadas.some((e) => e.caminho === "template"), "confirmado não gera pedido novo ao dono");

  // cancelar em dois toques: cx só pergunta; cxx libera o horário; de novo, já não está ativo
  assert.equal(await acaoDoCliente(db, b("cx"), "5511988881111"), "confirmação pedida");
  assert.equal((await t.collection("appointments").doc("Ag1aaaaaaaaaaaaaaaaa").get()).get("status"), "confirmed", "o primeiro toque não cancela");
  assert.equal(await acaoDoCliente(db, b("cxx"), "5511988881111"), "cancelado");
  assert.equal((await t.collection("appointments").doc("Ag1aaaaaaaaaaaaaaaaa").get()).get("status"), "cancelled");
  assert.equal(await acaoDoCliente(db, b("cxx"), "5511988881111"), "inativo");
  // sinal pago: quem decide é o negócio
  await ag("Ag2aaaaaaaaaaaaaaaaa", { sinal: { status: "pago", cents: 1000 } });
  assert.equal(await acaoDoCliente(db, lerBotao(idBotao("cx", "ofc", "Ag2aaaaaaaaaaaaaaaaa"))!, "5511988881111"), "precisa do negócio");
  assert.equal((await t.collection("appointments").doc("Ag2aaaaaaaaaaaaaaaaa").get()).get("status"), "booked");
  delete process.env.ATENDYS_TEMPLATES_BOTOES;
}

// ── rodada 2: horário silencioso, prazo no fuso do negócio, botões antigos, falha visível ──
{
  const { instanteReal, zonedTime, addDays, todayIn } = await import("@/lib/datetime");
  const { atualizarParada, avisarFalhaDeEnvio, lerIndice, vigiarEnvio } = await import("@/lib/mensagens-paradas.server");
  const { idBotao, lerBotao, templateCliente: tc } = await import("@/lib/canal-oficial.server");
  const { acaoDoCliente } = await import("@/lib/botoes-whatsapp.server");
  const { codigoDoAgendamento, executarComandoPendente, idDoComando, registrarMensagemRecebida } = await import("@/lib/whatsapp.server");
  const loja = (await lerConexao(db, "loja"))!;
  const erro = async () => (await lerConfigWhatsApp(db, "loja"))?.lastNotifyError?.message ?? null;
  const limpar = () => db.doc("tenants/loja").set({ whatsapp: { lastNotifyError: null, falhaAvisadaEm: FieldValue.delete() } }, { merge: true });
  const H = 3_600_000;

  // #2: start é hora de parede; o prazo é o instante real no fuso do negócio
  const parede = zonedTime("2026-11-20", "10:00");
  assert.equal(instanteReal(parede, { uf: "SP" }).toISOString(), "2026-11-20T13:00:00.000Z");
  assert.equal(instanteReal(parede, { uf: "AM" }).toISOString(), "2026-11-20T14:00:00.000Z", "Manaus: 1 h depois de SP");
  assert.equal(instanteReal(parede, { uf: "AC" }).toISOString(), "2026-11-20T15:00:00.000Z", "Acre: 2 h depois");
  assert.equal(instanteReal(parede, { fuso: "America/Noronha" }).toISOString(), "2026-11-20T12:00:00.000Z", "Noronha: 1 h antes");

  // #1: envio vigiado guarda o prazo; queued com retryAt depois dele é falha já, não na hora do atendimento
  const prazo = new Date(Date.now() + 3 * H);
  const Q1 = "a1d4d428-4361-4153-bc2c-60db816d8b77";
  novo({ "POST /v1/message/send-text": json({ id: Q1, status: "queued" }) });
  assert.equal((await enviarSemOperador(loja, "5511987654321", "Lembrete às 21h", null, prazo)).destino, "enviada");
  assert.equal((await lerIndice(Q1))?.prazo, prazo.getTime());
  await limpar();
  await entregar({ event: "message.status", messageId: Q1, status: "queued", retryAt: new Date(prazo.getTime() - H).toISOString() }, "s-loja");
  assert.equal(await erro(), null, "ainda sai antes do horário");
  await entregar({ event: "message.status", messageId: Q1, status: "queued", retryAt: new Date(prazo.getTime() + 11 * H).toISOString() }, "s-loja");
  assert.match((await erro()) ?? "", /não sai antes do horário/);
  assert.match((await erro()) ?? "", /Lembrete às 21h/);
  // #10: a marca e o erro visível juntos; a reentrega não repete
  assert.equal((await db.doc(`mensagensWhatsapp/${Q1}`).get()).get("falhou"), true);
  await limpar();
  await entregar({ event: "message.status", messageId: Q1, status: "failed", errorCode: "MESSAGE_EXPIRED" }, "s-loja");
  assert.equal(await erro(), null, "já avisada");

  // #8: a falha chegou antes do índice (o webhook não achou o negócio): a conferência depois do envio avisa
  // (só no canal oficial e fora das respostas: o resto não paga o GET a mais)
  const F1 = "b1d4d428-4361-4153-bc2c-60db816d8b77";
  novo({ "POST /v1/message/send-text": json({ id: F1, status: "queued" }), [`GET /v1/message/${F1}/status`]: json({ id: F1, status: "failed", errorCode: "META_131026" }) });
  await limpar();
  await enviarSemOperador(loja, "5511987654321", "Confirmado amanhã", null);
  await enviarSemOperador({ ...loja, oficial: true }, "5511987654321", "Confirmado amanhã", null, undefined, { resposta: true });
  assert.ok(!chamadas.some((c) => c.caminho.endsWith("/status")), "número do salão e resposta: sem GET de status");
  assert.equal(await erro(), null);
  // QA3 R1: a falha achada na conferência volta a quem chama (antes vinha "enviada" e /api/agendar limpava o aviso)
  assert.equal((await enviarSemOperador({ ...loja, oficial: true }, "5511987654321", "Confirmado amanhã", null)).destino, "falhou");
  assert.match((await erro()) ?? "", /não recebe mensagens/);
  // QA3 R3: adiada para depois do prazo, com o webhook perdido antes do índice: a conferência acha
  const R3 = "b3d4d428-4361-4153-bc2c-60db816d8b77";
  novo({ "POST /v1/message/send-text": json({ id: R3, status: "queued" }), [`GET /v1/message/${R3}/status`]: json({ id: R3, status: "queued", retryAt: new Date(prazo.getTime() + 11 * H).toISOString() }) });
  await limpar();
  assert.equal((await enviarSemOperador({ ...loja, oficial: true }, "5511987654321", "Lembrete adiado", null, prazo)).destino, "nao_sai");
  assert.match((await erro()) ?? "", /não sai antes do horário/);
  const R3b = "b4d4d428-4361-4153-bc2c-60db816d8b77";
  novo({ "POST /v1/message/send-text": json({ id: R3b, status: "queued" }), [`GET /v1/message/${R3b}/status`]: json({ id: R3b, status: "queued", retryAt: new Date(prazo.getTime() - H).toISOString() }) });
  await limpar();
  assert.equal((await enviarSemOperador({ ...loja, oficial: true }, "5511987654321", "Lembrete adiado a tempo", null, prazo)).destino, "agendada");
  assert.equal(await erro(), null, "adiada para antes do horário: ainda sai");
  await limpar();
  await entregar({ event: "message.status", messageId: F1, status: "failed", errorCode: "META_131026" }, "s-loja");
  assert.equal(await erro(), null, "o webhook atrasado não repete o aviso");

  // #9: parada na cota só é vigiada quando volta à fila; esquecida e vencida no atendys, o painel
  // já mostrou "parou na cota" e não vem um segundo aviso
  const P1 = "c1d4d428-4361-4153-bc2c-60db816d8b77";
  novo({ "POST /v1/message/send-text": json({ id: P1, status: "awaiting_manual", retryAt: null }, 202) });
  assert.equal((await enviarSemOperador(loja, "5511987654321", "Pedido parado", null, prazo)).destino, "parada");
  const ix = await lerIndice(P1);
  assert.deepEqual([ix?.vigiada, ix?.parada, ix?.prazo], [false, true, prazo.getTime()]);
  await limpar();
  await entregar({ event: "message.status", messageId: P1, status: "failed", errorCode: "MESSAGE_EXPIRED", at: "2098-01-01T00:00:00Z" }, "s-loja");
  assert.equal(await erro(), null, "parada esquecida que vence: sem aviso");
  await db.doc(`tenants/loja/mensagens/${P1}`).update({ status: "awaiting_manual", at: 0 });
  // Manter agendada: volta à fila e passa a ser vigiada
  await atualizarParada("loja", P1, "queued", null);
  assert.equal((await lerIndice(P1))?.vigiada, true);
  await entregar({ event: "message.status", messageId: P1, status: "manual_started" }, "s-loja");
  assert.equal((await db.doc(`tenants/loja/mensagens/${P1}`).get()).get("status"), "manual_started", "parada segue atualizando o painel");
  await entregar({ event: "message.status", messageId: P1, status: "failed", errorCode: "MESSAGE_EXPIRED", at: "2099-01-01T00:00:00Z" }, "s-loja");
  assert.equal((await db.doc(`tenants/loja/mensagens/${P1}`).get()).get("status"), "failed");
  assert.match((await erro()) ?? "", /Pedido parado/);

  // #14: um push por negócio a cada 10 min; a gaveta mostra sempre a última falha
  const [G1, G2, G3] = ["d1", "d2", "d3"].map((p) => `${p}d4d428-4361-4153-bc2c-60db816d8b77`);
  for (const [g, texto] of [[G1, "primeira"], [G2, "segunda"], [G3, "terceira"]]) await vigiarEnvio("loja", g, texto);
  await limpar();
  assert.equal(await avisarFalhaDeEnvio("loja", G1, "META_131026"), "push");
  assert.equal(await avisarFalhaDeEnvio("loja", G2, "META_131026"), "agrupada", "dentro da janela: sem push");
  assert.match((await erro()) ?? "", /segunda/);
  assert.equal(await avisarFalhaDeEnvio("loja", G2, "META_131026"), null, "a mesma mensagem não avisa de novo");
  assert.equal(await avisarFalhaDeEnvio("casa", G3, "META_131026"), null, "índice de outro negócio");
  await db.doc("tenants/loja").update({ "whatsapp.falhaAvisadaEm": Date.now() - 11 * 60_000 });
  assert.equal(await avisarFalhaDeEnvio("loja", G3, "META_131026"), "push", "janela vencida: push de novo");

  // canal oficial num negócio de Manaus
  const t = db.doc("tenants/ofc");
  await t.set({ site: { uf: "AM" } }, { merge: true });
  const amanha = addDays(todayIn(), 1);
  const novoAg = (id: string) => t.collection("appointments").doc(id).set({
    status: "booked", start: zonedTime(amanha, "10:00"), end: zonedTime(amanha, "10:30"), customerName: "Rita Lima", customerPhone: "(11) 98888-3333",
    serviceIds: ["corte"], staffId: "ana", serviceName: "Corte", durationMin: 30, priceCents: 5000, whatsappConsent: { aceito: true, versao: "2026-11-08", em: new Date() },
  });
  const enviadas: { caminho: string; corpo: Record<string, unknown> }[] = [];
  const guarda = (caminho: string) => (corpo: unknown) => (enviadas.push({ caminho, corpo: corpo as Record<string, unknown> }), Response.json({ id: `m${enviadas.length}`, status: "queued" }));
  const rotasOfc = { "POST /v1/message/send-text": guarda("texto"), "POST /v1/message/send-interactive": guarda("botoes"), "POST /v1/message/send-template": guarda("template") };
  novo(rotasOfc);
  const DONO = "5591992361726", CLI = "5511988883333";

  // #4: o pendente do botão leva o horário do pedido; o cliente remarcou antes do cron: nada muda
  const A3 = "Ag3aaaaaaaaaaaaaaaaa";
  await novoAg(A3);
  const texto = `CONFIRMADO ${codigoDoAgendamento(A3, 12)}`;
  await registrarMensagemRecebida(db, "ofc", { phone: DONO, messageId: "BTN/1", data: { text: texto } }, "plataforma", { agendamento: A3, horario: `${amanha}T09:00` });
  assert.deepEqual((await db.doc(`comandosPendentes/${idDoComando("ofc", "BTN_1")}`).get()).get("esperado"), { agendamento: A3, horario: `${amanha}T09:00` });
  assert.equal(await executarComandoPendente(db, idDoComando("ofc", "BTN_1")), "sem pendente");
  assert.equal((await t.collection("appointments").doc(A3).get()).get("status"), "booked");
  assert.ok(!(await db.doc(`comandosPendentes/${idDoComando("ofc", "BTN_1")}`).get()).exists);
  assert.match(String(enviadas.at(-1)!.corpo.text), /mudou de horário/);
  // QA3 R2: o agendamento do botão já não existe: o único pendente que sobrou (A3) não é confirmado no lugar
  const SUMIU = "Ag9zzzzzzzzzzzzzzzzz";
  await registrarMensagemRecebida(db, "ofc", { phone: DONO, messageId: "BTN/1b", data: { text: `CONFIRMADO ${codigoDoAgendamento(SUMIU, 12)}` } }, "plataforma", { agendamento: SUMIU, horario: `${amanha}T10:00` });
  assert.equal(await executarComandoPendente(db, idDoComando("ofc", "BTN_1b")), "sem pendente");
  assert.equal((await t.collection("appointments").doc(A3).get()).get("status"), "booked", "outro agendamento não é tocado");
  assert.match(String(enviadas.at(-1)!.corpo.text), /Não encontrei agendamento/);
  // pedido antigo, sem horário no id do botão: o agendamento do pedido vale do mesmo jeito
  await registrarMensagemRecebida(db, "ofc", { phone: DONO, messageId: "BTN/1c", data: { text: `CONFIRMADO ${codigoDoAgendamento(SUMIU, 12)}` } }, "plataforma", { agendamento: SUMIU });
  assert.equal(await executarComandoPendente(db, idDoComando("ofc", "BTN_1c")), "sem pendente");
  assert.equal((await t.collection("appointments").doc(A3).get()).get("status"), "booked");
  // #5: resposta ao dono pelo canal oficial: replyToInbound (fora da cota, do dedupe e do silêncio)
  assert.equal(enviadas.at(-1)!.corpo.replyToInbound, true);
  // horário certo: confirma; #2: o aviso ao cliente vence no horário de Manaus, não no de SP
  await registrarMensagemRecebida(db, "ofc", { phone: DONO, messageId: "BTN/2", data: { text: texto } }, "plataforma", { agendamento: A3, horario: `${amanha}T10:00` });
  assert.equal(await executarComandoPendente(db, idDoComando("ofc", "BTN_2")), "confirmado");
  const aviso = enviadas.find((e) => e.caminho === "template" && e.corpo.number === CLI)!;
  assert.equal(aviso.corpo.expiresAt, zonedTime(amanha, "10:00", "America/Manaus").toISOString());
  enviadas.length = 0;
  assert.equal(await processarComandoAgendamento(db, "ofc", { phone: DONO, data: { text: "confimado" } }, "plataforma"), "nao entendido");
  assert.equal(enviadas.at(-1)!.corpo.replyToInbound, true);

  // #7: a resposta que falha (409 do dedupe) não prende o pendente
  novo({ "POST /v1/message/send-text": json({ error: { code: "IDEMPOTENCY_CONFLICT" } }, 409) });
  await registrarMensagemRecebida(db, "ofc", { phone: DONO, messageId: "BTN/3", data: { text: "confimado" } }, "plataforma");
  await assert.rejects(executarComandoPendente(db, idDoComando("ofc", "BTN_3")));
  assert.ok(!(await db.doc(`comandosPendentes/${idDoComando("ofc", "BTN_3")}`).get()).exists, "sem pendente preso, sem falso 'descartado'");

  // #3: botão de um lembrete anterior à remarcação não age sobre o horário novo
  novo(rotasOfc);
  const A4 = "Ag4aaaaaaaaaaaaaaaaa";
  await novoAg(A4);
  const b4 = (acao: string, extra?: string) => lerBotao(idBotao(acao as "cp", "ofc", A4, extra))!;
  assert.equal(await acaoDoCliente(db, b4("cp", `${amanha}T09:00`), CLI), "horário mudou");
  assert.match(String(enviadas.at(-1)!.corpo.text), /Esse lembrete é de um horário que mudou; o atual é amanhã às 10:00\./);
  assert.ok(!(await t.collection("appointments").doc(A4).get()).get("presencaConfirmadaEm"));
  assert.equal(await acaoDoCliente(db, b4("cx", `${amanha}T09:00`), CLI), "horário mudou");
  assert.equal(await acaoDoCliente(db, b4("cxx", `${amanha}T09:00`), CLI), "horário mudou");
  assert.equal(await acaoDoCliente(db, b4("ch", `${amanha}T09:00_${amanha}T15:00`), CLI), "horário mudou", "lista antiga: não remarca de novo");
  assert.equal((await t.collection("appointments").doc(A4).get()).get("status"), "booked");
  assert.equal(await acaoDoCliente(db, b4("cp", `${amanha}T10:00`), CLI), "presença confirmada");
  assert.equal(await acaoDoCliente(db, b4("cp"), CLI), "presença confirmada", "id sem horário (antes desta mudança) vale como antes");
  process.env.ATENDYS_TEMPLATES_BOTOES = "1";
  assert.deepEqual(tc("lembrete", { nome: "A", negocio: "B", servico: "C", quando: "D", contato: "E" }, { slug: "ofc", agendamento: "A1", horario: "2026-11-14T15:00" }).botoes, ["rph:cp:ofc:A1:2026-11-14T15:00", "rph:cr:ofc:A1:2026-11-14T15:00", "rph:cx:ofc:A1:2026-11-14T15:00"]);
  delete process.env.ATENDYS_TEMPLATES_BOTOES;

  // #15: cancelar em dois toques
  assert.equal(await acaoDoCliente(db, b4("cx", `${amanha}T10:00`), CLI), "confirmação pedida");
  const pergunta = enviadas.at(-1)!;
  assert.equal(pergunta.caminho, "botoes");
  assert.equal(pergunta.corpo.replyToInbound, true);
  const [sim, manter] = pergunta.corpo.buttons as { id: string; title: string }[];
  assert.deepEqual([lerBotao(sim.id), lerBotao(manter.id)], [{ acao: "cxx", slug: "ofc", agendamento: A4, extra: `${amanha}T10:00` }, { acao: "cm", slug: "ofc", agendamento: A4, extra: `${amanha}T10:00` }]);
  assert.ok([sim, manter].every((x) => x.title.length <= 20), "título de botão: até 20 caracteres na Meta");
  assert.equal((await t.collection("appointments").doc(A4).get()).get("status"), "booked", "o primeiro toque não cancela");
  assert.equal(await acaoDoCliente(db, lerBotao(manter.id)!, CLI), "mantido");
  assert.match(String(enviadas.at(-1)!.corpo.text), /^Mantido/);
  assert.equal((await t.collection("appointments").doc(A4).get()).get("status"), "booked");
  assert.equal(await acaoDoCliente(db, lerBotao(sim.id)!, CLI), "cancelado");
  assert.equal((await t.collection("appointments").doc(A4).get()).get("status"), "cancelled");

  // #6: /api/agendar: pedido ao dono parado na cota vira falha visível (after() com um contexto mínimo)
  const { workAsyncStorage } = await import("next/dist/server/app-render/work-async-storage.external.js");
  const { workUnitAsyncStorage } = await import("next/dist/server/app-render/work-unit-async-storage.external.js");
  const comAfter = async <T,>(fn: () => Promise<T>) => {
    const tarefas: unknown[] = [];
    const contexto = { afterContext: { after: (tarefa: unknown) => void tarefas.push(typeof tarefa === "function" ? tarefa() : tarefa) } };
    const r = await workAsyncStorage.run(contexto as never, () => workUnitAsyncStorage.run({} as never, fn));
    await Promise.all(tarefas);
    return r;
  };
  const { POST: agendar } = await import("@/app/api/agendar/route");
  novo({ "POST /v1/message/send-template": json({ id: "e1d4d428-4361-4153-bc2c-60db816d8b77", status: "awaiting_manual", retryAt: null }, 202) });
  await db.doc("tenants/ofc").set({ whatsapp: { lastNotifyError: null } }, { merge: true });
  const pedido = new Request("http://x/api/agendar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: "ofc", serviceIds: ["corte"], staffId: "ana", date: addDays(todayIn(), 2), time: "11:00", customerName: "Joana Lima", customerPhone: "(11) 98888-2222" }) });
  const resposta = await comAfter(() => agendar(pedido));
  assert.equal(((await resposta.json()) as { ok: boolean }).ok, true);
  assert.match((await lerConfigWhatsApp(db, "ofc"))?.lastNotifyError?.message ?? "", /aviso ao salão parou na cota/);
}

// ── resposta automática a quem escreve ao número da plataforma fora do fluxo ──
{
  const { responderForaDoFluxo } = await import("@/lib/canal-oficial.server");
  const { zonedTime, addDays, todayIn } = await import("@/lib/datetime");
  const t = db.doc("tenants/ofc");
  await t.set({ site: { phone: "(91) 3222-4444" } }, { merge: true });
  // agendamento antigo gravado com a chave sem o 9 (12 dígitos): o cliente escreve do número com o 9
  await t.collection("appointments").doc("ANT1").set({ status: "confirmed", start: zonedTime(addDays(todayIn(), -3), "10:00"), customerKey: "551188887777", customerPhone: "1188887777" });
  const enviadas: Record<string, unknown>[] = [];
  novo({ "POST /v1/message/send-text": (corpo) => (enviadas.push(corpo as Record<string, unknown>), Response.json({ id: "r1", status: "queued" })) });
  const msg = "Oi, posso remarcar?";
  await responderForaDoFluxo(db, "5511988887777", msg, "inst-evento");
  assert.deepEqual(enviadas.map((e) => [e.number, e.text, e.replyToInbound]), [["5511988887777", "Este número da Ruphus só envia avisos de agendamento. Para falar com *Ofc*, chame (91) 3222-4444.", true]]);
  assert.equal(chamadas.at(-1)!.headers.instance, "inst-evento", "responde pela instância que recebeu");
  const marca = await db.doc("config/atendys-plataforma/respostas/5511988887777").get();
  assert.ok(marca.get("expira").toMillis() > Date.now() + 23 * 3_600_000, "expira: TTL de 24 h");
  // uma vez a cada 24 h por telefone
  await responderForaDoFluxo(db, "11988887777", msg, "inst-evento");
  assert.equal(enviadas.length, 1);
  // sem agendamento: texto genérico; SAIR fica com o atendys
  await responderForaDoFluxo(db, "5511977776666", "SAIR", "inst-evento");
  await responderForaDoFluxo(db, "5511977776666", msg, "inst-evento");
  assert.equal(enviadas.at(-1)!.text, "Este número da Ruphus só envia avisos de agendamento. Fale com o estabelecimento onde você agendou.");
  // o fixo 3222-4444 de outro negócio não é o celular 93222-4444 (só celular perde o 9)
  await db.doc("tenants/fixo").set({ name: "Fixo", whatsapp: { canalOficial: true } });
  await db.collection("tenants/fixo/appointments").doc("F1").set({ status: "confirmed", start: zonedTime(addDays(todayIn(), -1), "10:00"), customerKey: "551132224444", customerPhone: "1132224444" });
  await responderForaDoFluxo(db, "5511932224444", msg, "inst-evento");
  assert.equal(enviadas.at(-1)!.text, "Este número da Ruphus só envia avisos de agendamento. Fale com o estabelecimento onde você agendou.");
  // falha do atendys só loga; a marca fica (não insiste no mesmo dia)
  const antes = enviadas.length;
  novo({});
  await responderForaDoFluxo(db, "5511966665555", msg, "inst-evento");
  assert.equal(enviadas.length, antes);
  assert.ok((await db.doc("config/atendys-plataforma/respostas/5511966665555").get()).exists);
}

// ── mensagens pré-pagas: cada envio vai para tenants/{slug}/envios, soma no mês (consumo/{YYYY-MM}) e,
// com a conta aberta, sai do saldo (privado/mensagens) com o lançamento no extrato (creditos) ──
{
  const { salvarConfigMensagens, ajustarSaldo, boasVindas, criarRecarga, creditarRecarga, definirMensagensDoNegocio, SemSaldo } = await import("@/lib/consumo.server");
  const { CONFIG_PADRAO, quandoFoi } = await import("@/lib/consumo");
  const { baixar } = await import("@/lib/cobranca");
  const { avisarConfirmacaoPorSms } = await import("@/lib/sms-agendamento.server");
  const { zonedTime, addDays, todayIn } = await import("@/lib/datetime");
  const { optInDoAgendamento } = await import("@/lib/consentimento-whatsapp");
  const { OPTIN_DONO } = await import("@/lib/atendys");
  await db.doc("tenants/gasto").set({ name: "Gasto", sms: { ligado: true } });
  await gravarConexao(db, "gasto", { atendysTenantId: "t-g", atendysApiKey: "k-g", atendysWebhookSecret: "s-gasto", instanceId: "gasto-main", phone: null, status: "connected", updatedAt: 0 });
  const conn = (await lerConexao(db, "gasto"))!;
  // preço do /admin: o snapshot de cada envio usa o vigente
  await salvarConfigMensagens({ ...CONFIG_PADRAO, whatsappUtilityCents: 7, whatsappServiceCents: 1, smsCents: 20, avisoSaldoCents: 95 }, "teste");
  const { mes } = quandoFoi(new Date());
  const consumo = async () => (await db.doc(`tenants/gasto/consumo/${mes}`).get()).data()!;
  const envio = async (id: string) => (await db.doc(`tenants/gasto/envios/${id}`).get()).data()!;
  const saldo = async () => (await db.doc("tenants/gasto/privado/mensagens").get()).get("saldoCents");
  // o extrato fecha com o saldo: a soma dos lançamentos é o saldo, e o último saldoApos também
  const extratoFecha = async () => {
    const docs = (await db.collection("tenants/gasto/creditos").get()).docs;
    assert.equal(docs.reduce((t, d) => t + Number(d.get("valorCents")), 0), await saldo(), "soma do extrato = saldo");
    const ultimo = docs.sort((a, b) => a.get("em").toMillis() - b.get("em").toMillis()).at(-1)!;
    assert.equal(ultimo.get("saldoAposCents"), await saldo(), "saldoApos do último lançamento = saldo");
  };

  // conta aberta pelo ajuste do /admin (com motivo)
  await assert.rejects(ajustarSaldo("gasto", 100, " ", "teste"), /motivo/);
  assert.equal(await ajustarSaldo("gasto", 100, "crédito de teste", "teste"), 100);

  // lembrete pelo número do salão: tipo, via, destino mascarado, agendamento (do aceite), custo e débito
  const G1 = "a1d4d428-4361-4153-bc2c-60db816d8b77";
  const optIn = optInDoAgendamento({ tenantId: "gasto", agendamentoId: "AG1", versao: "v", em: new Date() });
  novo({ "POST /v1/message/send-text": json({ id: G1, status: "queued" }) });
  await enviarSemOperador(conn, "5591988776389", "Lembrete do seu horário", optIn, undefined, { tipo: "lembrete" });
  const e1 = await envio(G1);
  assert.deepEqual(
    [e1.canal, e1.via, e1.tipo, e1.destino, e1.destinatario, e1.agendamentoId, e1.status, e1.precoCents, e1.custoCents, e1.debitadoCents, e1.moeda, e1.mes],
    ["whatsapp", "salao", "lembrete", "(91) •••••-6389", "cliente", "AG1", "aceito", 7, 7, 7, "BRL", mes],
  );
  assert.ok(!JSON.stringify(e1).includes("988776389") && !JSON.stringify(e1).includes("Lembrete do seu"), "nem telefone inteiro nem texto (LGPD)");
  assert.equal(await saldo(), 93);
  // cruzou o aviso (95) para baixo: marcado uma vez
  assert.ok((await db.doc("tenants/gasto/privado/mensagens").get()).get("avisadoSaldoBaixoEm"), "aviso de saldo baixo marcado");
  const avisos = async () => (await db.collection("tenants/gasto/creditos").where("tipo", "==", "aviso").get()).docs;
  const [av] = await avisos();
  assert.deepEqual([av.get("valorCents"), av.get("saldoAposCents")], [0, 93], "o aviso aparece no extrato, com valor 0");
  assert.match(av.get("motivo"), /^Seu saldo de mensagens está em R\$ 0,93 e deve acabar em ~\d+ dias\. Para garantir o mês, recarregue R\$ \d+,00 \(pacote/);
  assert.equal((await db.doc("tenants/gasto/privado/mensagens").get()).get("previsao").nivel, "atencao", "a previsão fica pronta na conta");
  let c = await consumo();
  assert.deepEqual([c.total, c.custoCents, c.canais.whatsapp.total, c.vias.salao, c.tipos.lembrete.total, c.status.aceito], [1, 7, 1, 1, 1, 1]);
  // o mesmo envio de novo (idempotency-key devolve a mensagem já aceita): não soma nem debita duas vezes
  await enviarSemOperador(conn, "5591988776389", "Lembrete do seu horário", optIn, undefined, { tipo: "lembrete" });
  assert.deepEqual([(await consumo()).total, await saldo()], [1, 93]);

  // webhook: entregue e lido seguem cobrados; um delivered atrasado não volta o status
  await entregar({ event: "message.status", messageId: G1, status: "delivered", at: "2030-01-01T00:00:01Z" }, "s-gasto");
  await entregar({ event: "message.status", messageId: G1, status: "read", at: "2030-01-01T00:00:02Z" }, "s-gasto");
  await entregar({ event: "message.status", messageId: G1, status: "delivered", at: "2030-01-01T00:00:01Z" }, "s-gasto");
  assert.equal((await envio(G1)).status, "lido");
  c = await consumo();
  assert.deepEqual([c.status.aceito, c.status.entregue, c.status.lido, c.custoCents, await saldo()], [0, 0, 1, 7, 93]);

  // webhook failed: o status muda, o erro fica, o custo sai do mês e o saldo é estornado
  const G2 = "a2d4d428-4361-4153-bc2c-60db816d8b77";
  novo({ "POST /v1/message/send-text": json({ id: G2, status: "queued" }) });
  await enviarSemOperador(conn, "5591988776389", "Seu horário está confirmado", optIn, undefined, { tipo: "confirmado" });
  assert.deepEqual([(await consumo()).custoCents, await saldo()], [14, 86]);
  assert.equal((await entregar({ event: "message.status", messageId: G2, status: "failed", errorCode: "META_131026" }, "s-gasto")).status, 200);
  const e2 = await envio(G2);
  assert.deepEqual([e2.status, e2.erro, e2.custoCents, e2.debitadoCents], ["falhou", "META_131026", 0, 0]);
  c = await consumo();
  assert.deepEqual([c.total, c.custoCents, c.status.falhou, c.tipos.confirmado.custoCents, c.canais.whatsapp.custoCents], [2, 7, 1, 0, 7]);
  assert.equal(await saldo(), 93, "falhou estorna");
  const dia = `${mes}-${quandoFoi(new Date()).dia}`;
  assert.equal((await db.doc(`tenants/gasto/creditos/estorno:${dia}`).get()).get("valorCents"), 7);
  assert.equal((await db.doc(`tenants/gasto/creditos/consumo:${dia}`).get()).get("valorCents"), -14, "o consumo do dia num documento só");
  // reentrega do failed: não estorna de novo
  await entregar({ event: "message.status", messageId: G2, status: "failed", errorCode: "META_131026" }, "s-gasto");
  assert.equal(await saldo(), 93);
  // assinatura errada não mexe em nada
  const G3 = "a3d4d428-4361-4153-bc2c-60db816d8b77";
  novo({ "POST /v1/message/send-text": json({ id: G3, status: "queued" }) });
  await enviarSemOperador(conn, "5591988776389", "oi", optIn);
  await entregar({ event: "message.status", messageId: G3, status: "failed" }, "errado");
  assert.deepEqual([(await envio(G3)).status, (await envio(G3)).tipo, await saldo()], ["aceito", "outro", 86]);

  // parada na cota não cobra; voltou à fila (queued) cobra
  const G4 = "a4d4d428-4361-4153-bc2c-60db816d8b77";
  novo({ "POST /v1/message/send-text": json({ id: G4, status: "awaiting_manual", retryAt: "2030-01-01T03:00:00.000Z" }, 202) });
  await enviarTexto(conn, "5591988776389", "aviso", OPTIN_DONO);
  assert.deepEqual([(await envio(G4)).status, (await envio(G4)).custoCents, (await envio(G4)).destinatario, await saldo()], ["parado", 0, "dono", 86]);
  await entregar({ event: "message.status", messageId: G4, status: "queued" }, "s-gasto");
  assert.deepEqual([(await envio(G4)).status, (await envio(G4)).custoCents, await saldo()], ["aceito", 7, 79]);

  // SMS: grava no aceite da Comtele, com o preço do SMS, e debita
  const amanha = addDays(todayIn(), 1);
  await db.doc("tenants/gasto/appointments/AGS").set({ status: "confirmed", start: zonedTime(amanha, "10:00"), customerName: "Ana", customerPhone: "(91) 98877-6389", serviceName: "Corte" });
  assert.equal(await avisarConfirmacaoPorSms(db, "gasto", "AGS", { enviar: async () => "req-123", alertar: async () => {} }), "enviado");
  const s1 = await envio("sms-req-123");
  assert.deepEqual([s1.canal, s1.tipo, s1.status, s1.destino, s1.agendamentoId, s1.custoCents], ["sms", "confirmado", "enviado", "(91) •••••-6389", "AGS", 20]);
  c = await consumo();
  assert.deepEqual([c.canais.sms.total, c.canais.sms.custoCents, c.dias[quandoFoi(new Date()).dia].sms, await saldo()], [1, 20, 1, 59]);
  await extratoFecha();

  // sem saldo (pausar-clientes): aviso ao cliente não sai e fica "sem-saldo"; lembrete e aviso ao dono saem
  await ajustarSaldo("gasto", -55, "zerar para o teste", "teste");
  novo({ "POST /v1/message/send-text": json({ id: "a5d4d428-4361-4153-bc2c-60db816d8b77", status: "queued" }) });
  await assert.rejects(enviarSemOperador(conn, "5591988776389", "Confirmado!", optIn, undefined, { tipo: "confirmado", chave: "confirmado-gasto-1" }), (e: unknown) => e instanceof SemSaldo);
  assert.equal(chamadas.length, 0, "nem chega ao atendys");
  const bloqueado = await envio("sem-saldo-confirmado-gasto-1");
  assert.deepEqual([bloqueado.status, bloqueado.custoCents, bloqueado.tipo, await saldo()], ["sem-saldo", 0, "confirmado", 4]);
  assert.equal((await consumo()).status["sem-saldo"], 1);
  await enviarSemOperador(conn, "5591988776389", "Lembrete", optIn, undefined, { tipo: "lembrete" });
  assert.equal(await saldo(), -3, "lembrete sai mesmo sem saldo");
  // SMS a cliente sem saldo: não sai, a reserva fica
  await db.doc("tenants/gasto/appointments/AGS2").set({ status: "confirmed", start: zonedTime(amanha, "11:00"), customerName: "Ana", customerPhone: "(91) 98877-6389", serviceName: "Corte" });
  let smsSaiu = false;
  assert.equal(await avisarConfirmacaoPorSms(db, "gasto", "AGS2", { enviar: async () => ((smsSaiu = true), "req-9"), alertar: async () => {} }), "falhou");
  assert.equal(smsSaiu, false);
  assert.equal((await envio("sem-saldo-sms-AGS2-smsConfirmacaoEm")).status, "sem-saldo");
  assert.ok((await db.doc("tenants/gasto/appointments/AGS2").get()).get("smsConfirmacaoEm"), "a reserva fica: sem nova tentativa a cada ciclo");
  // pausar-tudo: até o lembrete para; o pedido ao dono sempre sai
  await salvarConfigMensagens({ ...CONFIG_PADRAO, whatsappUtilityCents: 7, whatsappServiceCents: 1, smsCents: 20, semSaldo: "pausar-tudo" }, "teste");
  await assert.rejects(enviarSemOperador(conn, "5591988776389", "Lembrete", optIn, undefined, { tipo: "lembrete" }), (e: unknown) => e instanceof SemSaldo);
  novo({ "POST /v1/message/send-text": json({ id: "a6d4d428-4361-4153-bc2c-60db816d8b77", status: "queued" }) });
  await enviarSemOperador(conn, "5591988776389", "Novo agendamento", OPTIN_DONO, undefined, { tipo: "pedido_dono" });
  assert.equal(await saldo(), -10);
  // o /admin desliga a cobrança só deste negócio: sai e não debita
  await definirMensagensDoNegocio("gasto", { cobrar: false, precos: null });
  novo({ "POST /v1/message/send-text": json({ id: "a7d4d428-4361-4153-bc2c-60db816d8b77", status: "queued" }) });
  await enviarSemOperador(conn, "5591988776389", "Confirmado", optIn, undefined, { tipo: "confirmado" });
  assert.deepEqual([(await envio("a7d4d428-4361-4153-bc2c-60db816d8b77")).custoCents, await saldo()], [0, -10]);
  await definirMensagensDoNegocio("gasto", { cobrar: null, precos: { smsCents: 3 } });
  assert.equal((await db.doc("tenants/gasto/privado/mensagens").get()).get("cobrar"), undefined, "null volta ao geral");
  await extratoFecha();

  // recarga por Pix: pacote de R$ 50 + R$ 5 de bônus; o saldo entra só depois da baixa, uma vez
  await assert.rejects(criarRecarga("gasto", { valorCents: 500 }), /mínima/);
  await assert.rejects(criarRecarga("gasto", { pacoteId: "nao-existe" }), /pacote/);
  const r = await criarRecarga("gasto", { pacoteId: "p50" });
  assert.ok(r.url.endsWith(`/pagar/${r.id}?t=${(await db.doc(`cobrancas/${r.id}`).get()).get("token")}`));
  const cob = await db.doc(`cobrancas/${r.id}`).get();
  assert.deepEqual([cob.get("tipo"), cob.get("valorCents"), cob.get("bonusCents"), cob.get("status")], ["recarga", 5000, 500, "aberta"]);
  await assert.rejects(creditarRecarga(r.id), /não paga/);
  assert.equal(await saldo(), -10);
  assert.equal((await baixar(db, r.id, { recebidoCents: 5000, pagoEm: todayIn(), por: "teste" })).tipo, "recarga");
  assert.equal(await creditarRecarga(r.id), 5490);
  assert.equal(await creditarRecarga(r.id), null, "a mesma recarga não credita duas vezes");
  const conta = await db.doc("tenants/gasto/privado/mensagens").get();
  assert.deepEqual([conta.get("saldoCents"), conta.get("previsao").nivel, typeof conta.get("ultimaRecargaEm")], [5490, "ok", "number"], "recarga soma valor + bônus e a previsão volta a ok");
  // até a recarga, um aviso só (o saldo passou por atenção e crítico); depois dela, um novo aviso cabe
  assert.equal((await avisos()).length, 1, "um aviso por recarga");
  await ajustarSaldo("gasto", -5450, "baixar para o teste", "teste");
  assert.equal((await avisos()).length, 2, "depois da recarga, o nível piorou: novo aviso");
  await ajustarSaldo("gasto", -30, "baixar mais", "teste");
  assert.equal((await avisos()).length, 2, "piorou de novo sem recarga: não repete");
  const lanc = await db.doc(`tenants/gasto/creditos/recarga:${r.id}`).get();
  assert.deepEqual([lanc.get("tipo"), lanc.get("valorCents"), lanc.get("saldoAposCents"), lanc.get("ref").cobrancaId], ["recarga", 5500, 5490, r.id]);
  // recarga livre (mínimo R$ 10)
  const livre = await criarRecarga("gasto", { valorCents: 1500 });
  assert.equal((await db.doc(`cobrancas/${livre.id}`).get()).get("bonusCents"), 0);
  await extratoFecha();

  // boas-vindas: uma vez só por negócio (cobrar e pré-pago)
  await boasVindas("novo-negocio");
  await boasVindas("novo-negocio");
  const bv = await db.collection("tenants/novo-negocio/creditos").get();
  assert.deepEqual([bv.size, bv.docs[0].get("tipo"), bv.docs[0].get("valorCents"), (await db.doc("tenants/novo-negocio/privado/mensagens").get()).get("saldoCents")], [1, "boas-vindas", 1000, 1000]);
  await salvarConfigMensagens({ ...CONFIG_PADRAO, cobrar: false }, "teste");
  await boasVindas("sem-cobranca");
  assert.equal((await db.collection("tenants/sem-cobranca/creditos").get()).size, 0, "sem cobrar: sem boas-vindas");
  await salvarConfigMensagens(CONFIG_PADRAO, "teste");
}

console.log("atendys ok");
process.exit(0);
