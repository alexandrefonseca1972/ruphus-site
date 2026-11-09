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
import { atenderComo, conexaoParaAtender, exigeConversaVisivel, midiaParaNavegador, responderArquivoDoNavegador, permitirEquipeNasConversas, podeAtenderConversas, visiveis } from "@/lib/conversas.server";
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
await gravarConexao(db, "bel", { atendysTenantId: "t1", atendysApiKey: "k-bel", atendysWebhookSecret: "s", instanceId: "bel-main", phone: "5591900000001", ownerPhone: "(91) 99112-1306", status: "connected", updatedAt: 0 });

assert.equal(await podeAtenderConversas(db, "bel", "dono"), true, "dono atende");
assert.equal(await podeAtenderConversas(db, "bel", "gerente"), true, "admin do negócio atende");
assert.equal(await podeAtenderConversas(db, "bel", "plataforma"), true, "admin da plataforma atende");
assert.equal(await podeAtenderConversas(db, "bel", "equipe"), false, "equipe não atende sem liberação (padrão)");
assert.equal(await podeAtenderConversas(db, "bel", "donoOutro"), false, "dono de outro negócio não vê este");
assert.equal(await podeAtenderConversas(db, "bel", "ninguem"), false, "quem não é membro");
assert.equal(await podeAtenderConversas(db, "naoexiste", "plataforma"), false, "negócio que não existe");

// só quem gere liga a equipe; slug que não existe não vira negócio
await assert.rejects(permitirEquipeNasConversas(db, "bel", "equipe", true), /Só o dono ou um administrador/);
await assert.rejects(permitirEquipeNasConversas(db, "bel", "donoOutro", true), /Só o dono ou um administrador/);
await assert.rejects(permitirEquipeNasConversas(db, "fantasma", "plataforma", true));
assert.equal((await db.doc("tenants/fantasma").get()).exists, false, "nenhum negócio fantasma");
await permitirEquipeNasConversas(db, "bel", "dono", true);
assert.equal(await podeAtenderConversas(db, "bel", "equipe"), true, "equipe liberada pelo dono");
assert.equal(await podeAtenderConversas(db, "outro", "equipe"), false, "liberar em um negócio não abre outro");
await permitirEquipeNasConversas(db, "bel", "gerente", false);
assert.equal(await podeAtenderConversas(db, "bel", "equipe"), false, "desligar volta a bloquear");

const doDono = await conexaoParaAtender(db, "bel", "dono");
assert.equal(doDono.conn.atendysApiKey, "k-bel");
assert.deepEqual([doDono.gestor, doDono.ocultos], [true, []], "quem gere vê tudo");
await permitirEquipeNasConversas(db, "bel", "dono", true);
const daEquipe = await conexaoParaAtender(db, "bel", "equipe");
assert.equal(daEquipe.gestor, false);
assert.deepEqual(daEquipe.ocultos.sort(), ["5591900000001", "5591991121306"], "WhatsApp pessoal do dono (canônico) e o do negócio");
const lista = [
  { contactPhone: "5591991121306" },
  { contactPhone: "559191121306" }, // conta antiga, sem o 9º dígito: o mesmo número do dono
  { contactPhone: "5591900000001" },
  { contactPhone: "5591988887777" },
  { contactPhone: null },
] as Parameters<typeof visiveis>[1];
assert.deepEqual(visiveis(daEquipe, lista).map((c) => c.contactPhone), ["5591988887777", null], "a equipe não vê o dono nem o self-chat");
assert.equal(visiveis(doDono, lista).length, 5);

// sessão e membro, como nas ações: token inválido, sessão encerrada, membro removido
const verificador = (uid: string, authTimeMs = Date.now()) => async (t: string) => {
  if (t !== "ok") throw new Error("token inválido");
  return { uid, authTimeMs, email: undefined, emailPendente: undefined, name: undefined };
};
await assert.rejects(atenderComo(verificador("dono"), db, "ruim", "bel"), /Sessão expirada/);
assert.equal((await atenderComo(verificador("dono"), db, "ok", "bel")).user.uid, "dono");
await db.doc("config/admin").set({ uids: ["plataforma"], revogados: { dono: Date.now() + 60_000 } });
await assert.rejects(atenderComo(verificador("dono", Date.now() - 1000), db, "ok", "bel"), /sessão foi encerrada/i, "sessão revogada");
await db.doc("config/admin").set({ uids: ["plataforma"] });
await db.doc("tenants/bel/members/saiu").set({ role: "member" });
await db.doc("tenants/bel/members/saiu").delete();
await assert.rejects(atenderComo(verificador("saiu"), db, "ok", "bel"), /não tem acesso/, "membro removido");
await assert.rejects(atenderComo(verificador("donoOutro"), db, "ok", "bel"), /não tem acesso/, "dono de outro negócio");
await permitirEquipeNasConversas(db, "bel", "dono", false);
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
const { conn } = await conexaoParaAtender(db, "bel", "dono");

// lista: filtro, cursor e limite na query; a apikey do negócio no cabeçalho
const conversa = { id: "cv_opaco-1", contactName: null, contactPhone: "5591988887777", lastMessage: null, lastActivityAt: "2026-11-09T12:00:00Z", unreadCount: 2, manuallyUnread: false, archived: false, canReply: true, replyBlockedReason: null, replyWindowEndsAt: "2026-11-10T12:00:00Z" };
novo({ "GET /v1/inbox/conversations": json({ items: [conversa], nextCursor: "c2" }) });
const pagina = await listarConversas(conn, { filtro: "unread", cursor: "c1", limite: 20 });
assert.equal(pagina.items[0].id, "cv_opaco-1");
assert.equal(chamadas[0].busca, "?filter=unread&cursor=c1&limit=20");
assert.equal(chamadas[0].headers.apikey, "k-bel");

// id fora do alfabeto do contrato não sai daqui: ".." reescrevia o caminho no fetch
novo({ "GET /v1/inbox/conversations/cv_opaco-1/messages": json({ items: [], nextCursor: null }) });
await mensagensDaConversa(conn, "cv_opaco-1", { cursor: "m1" });
assert.equal(chamadas[0].busca, "?cursor=m1");
for (const ruim of ["..", ".", "a/b", "a%2Fb", "a+b", "", "x".repeat(513)]) {
  novo({});
  await assert.rejects(responderConversa(conn, ruim, "Oi", "resp-0001"), /Conversa inválida/, JSON.stringify(ruim));
  await assert.rejects(midiaDaMensagem(conn, ruim), /Conversa inválida/);
  assert.equal(chamadas.length, 0, "nada chega ao atendys");
}

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
assert.equal(logErro, 1, "recusa prevista da Central vai como aviso; só a falta do escopo (configuração) alarma");

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

// ── rota de mídia: status por falha e tipos que abrem no navegador ──
const rota = (uid: string, token = "ok", mensagem = "m1", tenant = "bel") => midiaParaNavegador(verificador(uid), db, token, tenant, mensagem);
novo({ "GET /v1/inbox/media/m1": () => new Response("<svg onload=alert(1)>", { headers: { "content-type": "image/svg+xml", "content-disposition": "inline" } }) });
let r = await rota("dono");
assert.equal(r.status, 200);
assert.equal(r.headers.get("content-type"), "application/octet-stream", "SVG não abre no navegador");
assert.equal(r.headers.get("content-disposition"), "attachment");
assert.equal(r.headers.get("x-content-type-options"), "nosniff");
assert.equal(r.headers.get("cache-control"), "private, no-store");
novo({ "GET /v1/inbox/media/m1": () => new Response("x", { headers: { "content-type": "text/html; charset=utf-8" } }) });
assert.equal((await rota("dono")).headers.get("content-type"), "application/octet-stream", "HTML vira download");
novo({ "GET /v1/inbox/media/m1": () => new Response("x", { headers: { "content-type": "image/jpeg" } }) });
r = await rota("dono");
assert.deepEqual([r.headers.get("content-type"), r.headers.get("content-disposition")], ["image/jpeg", "inline"]);
assert.equal((await rota("dono", "ruim")).status, 401, "token inválido: 401 para o painel renovar");
assert.equal((await rota("donoOutro")).status, 403, "outro negócio");
assert.equal((await rota("equipe")).status, 403, "equipe sem liberação");
assert.equal((await rota("dono", "ok", "..")).status, 400);
assert.equal((await rota("donoOutro", "ok", "m1", "outro")).status, 409, "negócio sem WhatsApp conectado");
novo({ "GET /v1/inbox/media/m1": erro(410, "MEDIA_UNAVAILABLE") });
assert.equal((await rota("dono")).status, 410);
novo({ "GET /v1/inbox/media/m1": erro(429, "INBOX_RATE_LIMITED", { "retry-after": "9" }) });
r = await rota("dono");
assert.deepEqual([r.status, r.headers.get("retry-after")], [429, "9"]);
const fetchSimulado = globalThis.fetch;
globalThis.fetch = (async () => {
  throw new TypeError("fetch failed");
}) as typeof fetch;
assert.equal((await rota("dono")).status, 502, "atendys fora do ar não é 'sem acesso'");
globalThis.fetch = fetchSimulado;

// ── envio de arquivo pela rota (multipart) ──
const formulario = (campos: Record<string, string | File>) => async () => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};
const foto = new File([new Uint8Array([137, 80, 78, 71])], "foto.png", { type: "image/png" });
novo({ "POST /v1/inbox/conversations/c1/reply-media": json({ id: "m20", status: "queued" }, 202) });
let lidoSemAcesso = false;
assert.equal((await responderArquivoDoNavegador(verificador("equipe"), db, "ok", "bel", async () => ((lidoSemAcesso = true), new FormData()))).status, 403);
assert.equal(lidoSemAcesso, false, "sem acesso, o corpo nem é lido");
r = await responderArquivoDoNavegador(verificador("dono"), db, "ok", "bel", formulario({ conversa: "c1", chave: "arq-00001", arquivo: foto, legenda: " olha " }));
assert.equal(r.status, 200);
assert.deepEqual(await r.json(), { ok: true, envio: { id: "m20", status: "queued" } });
assert.equal(chamadas[0].headers["idempotency-key"], "arq-00001");
assert.deepEqual(chamadas[0].corpo, { media: "data:image/png;base64,iVBORw==", mimetype: "image/png", fileName: "foto.png", caption: "olha" });
const enviar = (campos: Record<string, string | File>) => responderArquivoDoNavegador(verificador("dono"), db, "ok", "bel", formulario(campos));
assert.equal((await enviar({ conversa: "..", chave: "arq-00001", arquivo: foto })).status, 400);
assert.equal((await enviar({ conversa: "c1", chave: "x", arquivo: foto })).status, 400);
assert.equal((await enviar({ conversa: "c1", chave: "arq-00001", arquivo: new File([new Uint8Array(1)], "a.html", { type: "text/html" }) })).status, 415);
assert.equal((await enviar({ conversa: "c1", chave: "arq-00001", arquivo: new File([], "vazio.png", { type: "image/png" }) })).status, 400);
novo({ "POST /v1/inbox/conversations/c1/reply-media": erro(403, "MESSAGE_TYPE_NOT_ALLOWED") });
r = await enviar({ conversa: "c1", chave: "arq-00002", arquivo: foto });
assert.equal(r.status, 403);
assert.equal((await r.json()).codigo, "MESSAGE_TYPE_NOT_ALLOWED");

// form ilegível (corpo cortado pelo teto do proxy) e tipo executável
assert.equal((await responderArquivoDoNavegador(verificador("dono"), db, "ok", "bel", async () => null)).status, 400);
assert.equal((await enviar({ conversa: "c1", chave: "arq-00003", arquivo: new File([new Uint8Array(1)], "x.exe", { type: "application/x-msdownload" }) })).status, 415);
assert.equal((await enviar({ conversa: "c1", chave: "arq-00003", arquivo: new File([new Uint8Array(1)], "x.svg", { type: "image/svg+xml" }) })).status, 415);
novo({ "POST /v1/inbox/conversations/c1/reply-media": json({ id: "m21", status: "queued" }, 202) });
assert.equal((await enviar({ conversa: "c1", chave: "arq-00004", arquivo: new File([new Uint8Array(1)], "a.pdf", { type: "application/pdf" }) })).status, 200);
// credencial do negócio recusada não é "sessão vencida" do navegador
novo({ "POST /v1/inbox/conversations/c1/reply-media": erro(401, "INVALID_API_KEY") });
assert.equal((await enviar({ conversa: "c1", chave: "arq-00005", arquivo: foto })).status, 502);

// ── a equipe não age na conversa do dono nem pelo id (link antigo, ex-gestor) ──
await permitirEquipeNasConversas(db, "bel", "dono", true);
const listaComDono = json({
  items: [
    { ...conversa, id: "cv_dono", contactPhone: "5591991121306" },
    { ...conversa, id: "cv_cliente", contactPhone: "5591988887777" },
  ],
  nextCursor: null,
});
novo({ "GET /v1/inbox/conversations": listaComDono, "POST /v1/inbox/conversations/cv_dono/reply-media": json({ id: "x", status: "queued" }, 202) });
const daEquipeAgora = { ...(await conexaoParaAtender(db, "bel", "equipe")), tenantId: "bel" };
await assert.rejects(exigeConversaVisivel(daEquipeAgora, "cv_dono"), /só do dono/);
await exigeConversaVisivel(daEquipeAgora, "cv_cliente");
await exigeConversaVisivel(await conexaoParaAtender(db, "bel", "dono"), "cv_dono"); // quem gere vê
r = await responderArquivoDoNavegador(verificador("equipe"), db, "ok", "bel", formulario({ conversa: "cv_dono", chave: "arq-00006", arquivo: foto }));
assert.equal(r.status, 403, "equipe não manda arquivo para a conversa do dono");
assert.ok(!chamadas.some((c) => c.caminho.endsWith("/reply-media")), "nada chega ao atendys");
await permitirEquipeNasConversas(db, "bel", "dono", false);

// requestId do corpo fora do formato: vale o do cabeçalho
novo({ "GET /v1/inbox/conversations": () => Response.json({ error: { code: "INTERNAL", requestId: "<x>" } }, { status: 500, headers: { "x-request-id": "cab-12345678" } }) });
assert.equal((await listarConversas(conn).catch((x) => x)).requestId, "cab-12345678");

// credencial recusada na Central é erro no log (alerta), não aviso
logErro = 0;
novo({ "GET /v1/inbox/conversations": erro(401, "INVALID_API_KEY") });
await listarConversas(conn).catch(() => {});
assert.equal(logErro, 1, "chave revogada alarma");
// código herdado de Object não vira a frase
novo({ "GET /v1/inbox/conversations": erro(400, "toString") });
assert.match((await listarConversas(conn).catch((x) => x)).message, /recusou o pedido \(400\)/);

// requestId do atendys: no 5xx vira o código curto para o suporte; no 4xx não aparece
novo({ "GET /v1/inbox/conversations": () => Response.json({ error: { code: "INTERNAL", message: "x", requestId: "3f2b9c1d-aaaa-bbbb" } }, { status: 500 }) });
const com5xx = await listarConversas(conn).catch((x) => x);
assert.equal(com5xx.requestId, "3f2b9c1d-aaaa-bbbb");
assert.match(com5xx.message, /Código para suporte: 3f2b9c1d\.$/);
novo({ "GET /v1/inbox/conversations": () => new Response("<html>", { status: 502, headers: { "x-request-id": "abcdef1234" } }) });
assert.match((await listarConversas(conn).catch((x) => x)).message, /Código para suporte: abcdef12\.$/, "sem JSON: o do cabeçalho");
novo({ "POST /v1/inbox/conversations/c1/reply": () => Response.json({ error: { code: "REPLY_WINDOW_CLOSED", message: "x", requestId: "r-4xx-000" } }, { status: 403 }) });
const com4xx = await responderConversa(conn, "c1", "Oi", "resp-0006").catch((x) => x);
assert.equal(com4xx.requestId, "r-4xx-000");
assert.doesNotMatch(com4xx.message, /suporte/);
novo({ "GET /v1/inbox/conversations": () => Response.json({ error: { code: "INTERNAL", requestId: "<script>" } }, { status: 500 }) });
assert.equal((await listarConversas(conn).catch((x) => x)).requestId, null, "requestId fora do formato é descartado");
console.warn = avisos;
console.error = erros;

console.log("conversas ok");
process.exit(0);
