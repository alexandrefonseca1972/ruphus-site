// Rode: npm run test:conversas  (Central de conversas: permissão de quem atende e cliente do
// /v1/inbox do atendys; fetch simulado, Firestore no emulador)
import assert from "node:assert/strict";
import { getFirestore } from "firebase-admin/firestore";
import {
  agirNaMensagem,
  arquivarConversa,
  buscarNasConversas,
  ErroAtendys,
  listarConversas,
  marcarConversa,
  mensagensDaConversa,
  midiaDaMensagem,
  responderComMidia,
  responderConversa,
} from "@/lib/atendys";
import { conexaoParaAtender, permitirEquipeNasConversas, podeAtenderConversas } from "@/lib/conversas.server";
import { gravarConexao } from "@/lib/whatsapp.server";

const db = getFirestore();

// ── permissão: dono, admin, equipe com e sem liberação, outro negócio, plataforma ──
await db.doc("config/admin").set({ uids: ["plataforma"] });
await db.doc("tenants/bel").set({ name: "Bel", ownerId: "dono" });
await db.doc("tenants/bel/members/dono").set({ role: "owner" });
await db.doc("tenants/bel/members/gerente").set({ role: "admin" });
await db.doc("tenants/bel/members/equipe").set({ role: "member", staffId: "s1" });
await db.doc("tenants/outro").set({ name: "Outro", ownerId: "donoOutro" });
await db.doc("tenants/outro/members/donoOutro").set({ role: "owner" });
await gravarConexao(db, "bel", { atendysTenantId: "t1", atendysApiKey: "k-bel", atendysWebhookSecret: "s", instanceId: "bel-main", phone: "5591900000001", status: "connected", updatedAt: 0 });

assert.equal(await podeAtenderConversas(db, "bel", "dono"), true, "dono atende");
assert.equal(await podeAtenderConversas(db, "bel", "gerente"), true, "admin do negócio atende");
assert.equal(await podeAtenderConversas(db, "bel", "plataforma"), true, "admin da plataforma atende");
assert.equal(await podeAtenderConversas(db, "bel", "equipe"), false, "equipe não atende sem liberação (padrão)");
assert.equal(await podeAtenderConversas(db, "bel", "donoOutro"), false, "dono de outro negócio não vê este");
assert.equal(await podeAtenderConversas(db, "bel", "ninguem"), false, "quem não é membro");
assert.equal(await podeAtenderConversas(db, "naoexiste", "plataforma"), false, "negócio que não existe");

await permitirEquipeNasConversas(db, "bel", true);
assert.equal(await podeAtenderConversas(db, "bel", "equipe"), true, "equipe liberada pelo dono");
assert.equal(await podeAtenderConversas(db, "outro", "equipe"), false, "liberar em um negócio não abre outro");
await permitirEquipeNasConversas(db, "bel", false);
assert.equal(await podeAtenderConversas(db, "bel", "equipe"), false, "desligar volta a bloquear");

assert.equal((await conexaoParaAtender(db, "bel", "dono")).atendysApiKey, "k-bel");
await assert.rejects(conexaoParaAtender(db, "bel", "equipe"), /Só o dono atende/);
await assert.rejects(conexaoParaAtender(db, "bel", "donoOutro"), /Só o dono atende/);
await assert.rejects(conexaoParaAtender(db, "outro", "donoOutro"), /Conecte o WhatsApp/, "sem conexão, sem conversas");

// ── cliente HTTP: fetch simulado, uma resposta por rota ──
type Chamada = { metodo: string; caminho: string; busca: string; corpo?: unknown; headers: Record<string, string> };
let chamadas: Chamada[] = [];
let rotas: Record<string, (c: Chamada) => Response> = {};
globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
  const u = new URL(String(url));
  const c: Chamada = { metodo: init.method ?? "GET", caminho: u.pathname, busca: u.search, corpo: init.body ? JSON.parse(String(init.body)) : undefined, headers: init.headers as Record<string, string> };
  chamadas.push(c);
  const rota = rotas[`${c.metodo} ${c.caminho}`];
  return rota ? rota(c) : new Response("rota não simulada", { status: 500 });
}) as typeof fetch;
const json = (d: unknown, status = 200, headers: Record<string, string> = {}) => () => Response.json(d, { status, headers });
const erro = (status: number, code: string, headers: Record<string, string> = {}) => json({ error: { code, message: "texto técnico do servidor" } }, status, headers);
const novo = (r: typeof rotas) => ((chamadas = []), (rotas = r));
const conn = await conexaoParaAtender(db, "bel", "dono");

// lista: filtro, cursor e limite na query; a apikey do negócio no cabeçalho
const conversa = { id: "cv/opaco+1", contactName: null, contactPhone: "5591988887777", lastMessage: null, lastActivityAt: "2026-11-09T12:00:00Z", unreadCount: 2, manuallyUnread: false, archived: false, canReply: true, replyBlockedReason: null, replyWindowEndsAt: "2026-11-10T12:00:00Z" };
novo({ "GET /v1/inbox/conversations": json({ items: [conversa], nextCursor: "c2" }) });
const pagina = await listarConversas(conn, { filtro: "unread", cursor: "c1", limite: 20 });
assert.equal(pagina.items[0].id, "cv/opaco+1");
assert.equal(chamadas[0].busca, "?filter=unread&cursor=c1&limit=20");
assert.equal(chamadas[0].headers.apikey, "k-bel");

// id opaco com "/" e "+" vai codificado no caminho: nunca abre outro caminho da API
novo({ "GET /v1/inbox/conversations/cv%2Fopaco%2B1/messages": json({ items: [], nextCursor: null }) });
await mensagensDaConversa(conn, "cv/opaco+1", { cursor: "m1" });
assert.equal(chamadas[0].busca, "?cursor=m1");

novo({ "GET /v1/inbox/search": json({ items: [], nextCursor: null }) });
await buscarNasConversas(conn, "corte amanhã");
assert.equal(new URLSearchParams(chamadas[0].busca).get("q"), "corte amanhã");

novo({ "POST /v1/inbox/conversations/c1/read": () => new Response(null, { status: 204 }), "POST /v1/inbox/conversations/c1/unread": () => new Response(null, { status: 204 }) });
await marcarConversa(conn, "c1", true);
await marcarConversa(conn, "c1", false);
assert.deepEqual(chamadas.map((c) => c.caminho), ["/v1/inbox/conversations/c1/read", "/v1/inbox/conversations/c1/unread"]);

novo({ "POST /v1/inbox/conversations/c1/archive": () => new Response(null, { status: 204 }) });
await arquivarConversa(conn, "c1", true);
assert.deepEqual(chamadas[0].corpo, { archived: true });

// resposta: Idempotency-Key no cabeçalho; repetir a chave devolve o resultado original
novo({ "POST /v1/inbox/conversations/c1/reply": json({ id: "m9", status: "queued", duplicate: true }, 202) });
const envio = await responderConversa(conn, "c1", "Olá!", "resp-0001", "m1");
assert.deepEqual(envio, { id: "m9", status: "queued", duplicate: true });
assert.equal(chamadas[0].headers["idempotency-key"], "resp-0001");
assert.deepEqual(chamadas[0].corpo, { text: "Olá!", quotedMessageId: "m1" });
await assert.rejects(responderConversa(conn, "c1", "Olá!", "curta"), /Chave de envio inválida/);
await assert.rejects(responderConversa(conn, "c1", "Olá!", "tem espaço aqui"), /Chave de envio inválida/);

novo({ "POST /v1/inbox/conversations/c1/reply-media": json({ id: "m10", status: "queued" }, 202) });
await responderComMidia(conn, "c1", { media: "data:image/png;base64,AAAA", caption: "foto" }, "resp-0002");
assert.equal(chamadas[0].headers["idempotency-key"], "resp-0002");

// contingência manual: o link do wa.me chega para a tela
novo({ "POST /v1/inbox/conversations/c1/reply": json({ id: "m11", status: "awaiting_manual", manualHandoffRequired: true, manualHandoffUrl: "https://wa.me/5591988887777" }, 202) });
assert.equal((await responderConversa(conn, "c1", "Oi", "resp-0003")).manualHandoffUrl, "https://wa.me/5591988887777");

// ações na mensagem: rota e corpo por tipo, sempre com a chave
novo({
  "POST /v1/inbox/messages/m1/reaction": json({ status: "sent" }),
  "PATCH /v1/inbox/messages/m1": json({ status: "sent" }),
  "DELETE /v1/inbox/messages/m1": json({ status: "queued" }),
});
await agirNaMensagem(conn, "m1", { tipo: "reacao", emoji: "👍" }, "acao-0001");
await agirNaMensagem(conn, "m1", { tipo: "editar", texto: "corrigido" }, "acao-0002");
await agirNaMensagem(conn, "m1", { tipo: "apagar" }, "acao-0003");
assert.deepEqual(chamadas.map((c) => [c.metodo, c.corpo]), [["POST", { reaction: "👍" }], ["PATCH", { text: "corrigido" }], ["DELETE", undefined]]);
assert.ok(chamadas.every((c) => c.headers["idempotency-key"]?.startsWith("acao-")));

// mídia: bytes repassados como vieram
novo({ "GET /v1/inbox/media/m1": () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } }) });
const midia = await midiaDaMensagem(conn, "m1");
assert.equal(midia.headers.get("content-type"), "image/jpeg");
assert.deepEqual([...new Uint8Array(await midia.arrayBuffer())], [1, 2, 3]);

// ── erros previstos: código do contrato, frase para o dono (nunca o texto do servidor) e Retry-After ──
const casos: [number, string, RegExp][] = [
  [403, "REPLY_WINDOW_CLOSED", /mais de 24 horas/],
  [403, "RECIPIENT_OPTED_OUT", /pediu para não receber/],
  [409, "INSTANCE_PAUSED", /em pausa/],
  [409, "SENDER_CHANGED", /número do WhatsApp do negócio mudou/],
  [400, "CONVERSATION_NOT_ADDRESSABLE", /não informou o número/],
  [403, "INSUFFICIENT_SCOPE", /não está liberada/],
  [404, "NOT_FOUND", /não foi encontrada/],
  [409, "INSTANCE_DISCONNECTED", /desconectado/],
];
const avisos = console.warn;
const erros = console.error;
let logErro = 0;
console.warn = () => {};
console.error = () => void logErro++;
for (const [status, code, frase] of casos) {
  novo({ "POST /v1/inbox/conversations/c1/reply": erro(status, code) });
  const e = await responderConversa(conn, "c1", "Oi", "resp-0004").then(() => null, (x) => x);
  assert.ok(e instanceof ErroAtendys, code);
  assert.equal(e.codigo, code);
  assert.equal(e.status, status);
  assert.match(e.message, frase, code);
  assert.doesNotMatch(e.message, /texto técnico/, `${code}: a frase é nossa`);
}
assert.equal(logErro, 0, "recusa prevista da Central vai como aviso, não como erro no log");

// limite de requisições da Central: Retry-After em segundos
novo({ "GET /v1/inbox/conversations": erro(429, "INBOX_RATE_LIMITED", { "retry-after": "17" }) });
const limitada = await listarConversas(conn).then(() => null, (x) => x);
assert.equal(limitada.codigo, "INBOX_RATE_LIMITED");
assert.equal(limitada.retryAfter, 17);
assert.match(limitada.message, /Espere alguns segundos/);

// cota de mensagens (RATE_LIMITED): a explicação do atendys, que diz qual limite foi
novo({ "POST /v1/inbox/conversations/c1/reply": () => Response.json({ error: { code: "RATE_LIMITED", message: "Limite diário do número atingido." } }, { status: 429, headers: { "retry-after": "60" } }) });
const cota = await responderConversa(conn, "c1", "Oi", "resp-0005").then(() => null, (x) => x);
assert.equal(cota.codigo, "RATE_LIMITED");
assert.equal(cota.retryAfter, 60);
assert.equal(cota.message, "Limite diário do número atingido.");

// mídia expirada
novo({ "GET /v1/inbox/media/m1": erro(410, "MEDIA_UNAVAILABLE") });
const expirada = await midiaDaMensagem(conn, "m1").then(() => null, (x) => x);
assert.equal(expirada.status, 410);
assert.match(expirada.message, /não está mais disponível/);

// fora do contrato (erro 500 sem código): frase genérica e log de erro
logErro = 0;
novo({ "GET /v1/inbox/conversations": () => new Response("<html>bad gateway</html>", { status: 502 }) });
const quebrou = await listarConversas(conn).then(() => null, (x) => x);
assert.equal(quebrou.codigo, null);
assert.match(quebrou.message, /recusou o pedido \(502\)/);
assert.equal(logErro, 1);
console.warn = avisos;
console.error = erros;

console.log("conversas ok");
process.exit(0);
