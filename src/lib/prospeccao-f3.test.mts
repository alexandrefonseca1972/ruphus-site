// Rode: npm run test:prospeccao-f3  (agente da prospecção: webhook com HMAC v2 de teste, fetch simulado
// para o atendys, IA pelo provedor mock e Firestore no emulador). Nada sai para a rede.
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/admin";
import {
  aceitaContinuar, APRESENTACAO, CanalProibido, CONFIRMA_SAIDA, disjuntorDispara, ehOptOut, LIMITES_AGENTE, motivoDeEscalada, PASSA_PARA_HUMANO, PEDE_TEXTO, pedeParar, PERGUNTA_OPTIN, podeProspectar, reservaDoTurno, slugDaEntrada, mensagemDeEntrada, travaDeProspeccao,
} from "@/lib/prospeccao-canal";
import { normalizarSaida, problemasDaResposta } from "@/lib/prospeccao-variantes";
import { mascararDigitos } from "@/lib/sanitizar";
import { todayIn } from "@/lib/datetime";
import { atenderProspeccao, configProspeccao, contarNoDia, enviarProspeccao, registrarQualidade, resumoDoErro, type ConfigProspeccao } from "@/lib/prospeccao-agente.server";
import { paraTelefoneNorm } from "@/lib/tipos-marca";

// ————— puro —————
// L3: NFKD (fullwidth). H-1 (12/11): a palavra de saída em qualquer posição de mensagem de até 6 palavras.
// "não quero parar agora", "cancelar meu horário" e "pare de me mandar essas mensagens" eram false até a
// revisão do agente (12/11): agora são opt-out, de propósito (conservador)
for (const t of ["PARE", "pare", "Páre!", " STOP ", "sair.", "SAIR", "Parar", "SAIR!!!", "pare por favor", "pare de mandar", "ｓａｉｒ", "não quero parar agora", "cancelar meu horário", "pare de me mandar essas mensagens"]) assert.equal(ehOptOut(t), true, t);
for (const t of ["oi", "", "stopp", "como funciona a agenda?", "quero ver o site", "pode parar de me mandar mensagem por favor obrigado"]) assert.equal(ehOptOut(t), false, t);
// H-1: as 8 frases do relatório são opt-out (ehOptOut ou pedeParar) e nenhuma é aceite
const SAIDAS_H1 = ["quero sair", "pode parar", "quero cancelar", "quero sair da lista", "sim, pode tirar meu numero", "ok pare", "pode me remover", "me descadastra"];
for (const t of SAIDAS_H1) {
  assert.ok(ehOptOut(t) || pedeParar(t), `opt-out: ${t}`);
  assert.equal(aceitaContinuar(t), false, `não é aceite: ${t}`);
}
assert.equal(pedeParar("pode parar de me mandar mensagem por favor obrigado"), true, "\"parar de\" em frase longa");
// M3: pedido de parar sem a palavra exata
for (const t of ["não quero", "para de mandar isso", "pare de me mandar essas mensagens", "me tira da lista", "isso é spam", "me deixa em paz", "vou bloquear"]) assert.equal(pedeParar(t), true, t);
for (const t of ["como funciona a agenda?", "que porra é essa", "quanto custa?"]) assert.equal(pedeParar(t), false, t);
// M-5: "não quero"/"me deixa" em frase longa só com o contexto de receber mensagem ou contato
for (const t of ["Oi, não quero pagar caro, como funciona?", "me deixa ver com a minha sócia e te falo amanhã", "não quero perder cliente por causa de agenda, como funciona?", "me tira uma dúvida sobre a mensalidade da agenda online"]) {
  assert.equal(pedeParar(t), false, t);
  assert.equal(ehOptOut(t), false, `ehOptOut: ${t}`);
}
for (const t of ["não quero mais receber essas mensagens de vocês, obrigado", "não quero receber nada disso por aqui no meu whatsapp", "olha, não quero mais mensagens sobre esse assunto aqui", "por favor me deixa em paz com essas propostas de agenda", "me tira da lista de vocês que eu não pedi nada"]) assert.equal(pedeParar(t), true, t);
// M5: filtro da saída (qualquer TLD, gratuidade, link soletrado, @)
for (const t of ["veja em salao.pt", "acesse agenda.cc", "entra no ruphus.top", "site ponto xyz", "1 ano grátis", "sem custo nenhum", "fala comigo no @ruphus", "ruphus ponto com", "é de graça"]) assert.ok(problemasDaResposta(t, []).length, t);
assert.deepEqual(problemasDaResposta("Que bom! A agenda online deixa o cliente marcar sozinho.", []), []);

// 3.1: a trava recusa a instância e o número da plataforma sem depender de config
const recusa = (c: { instancia: string; numero: string }, extras?: Parameters<typeof travaDeProspeccao>[1]) => assert.throws(() => travaDeProspeccao(c, extras), CanalProibido, JSON.stringify(c));
recusa({ instancia: "ruphus-plataforma-cloud-1726", numero: "5511900000042" });
recusa({ instancia: "ruphus-plataforma-cloud-1726-b", numero: "5511900000042" });
recusa({ instancia: "prospeccao", numero: "5591992361726" });
recusa({ instancia: "prospeccao", numero: "559192361726" }, {}); // o 1726 sem o 9
recusa({ instancia: "prospeccao", numero: "(91) 99236-1726" });
recusa({ instancia: "", numero: "5511900000042" });
recusa({ instancia: "prospeccao", numero: "" });
recusa({ instancia: "plataforma-escolhida", numero: "5511900000042" }, { instancias: ["plataforma-escolhida"] });
recusa({ instancia: "prospeccao", numero: "5511900000077" }, { reservados: ["11900000077"] });
assert.doesNotThrow(() => travaDeProspeccao({ instancia: "ruphus-prospeccao", numero: "5511900000042" }));
assert.equal(podeProspectar("5591992361726"), false);
assert.equal(podeProspectar("5511900000042"), true);
assert.equal(slugDaEntrada(mensagemDeEntrada("salao-da-ana")), "salao-da-ana");
assert.equal(slugDaEntrada("oi"), null);
for (const t of ["sim", "Sim!", "pode", "pode sim 😊", "claro", "ok", "Sim, pode", "claro, pode mandar", "ok obrigado", "ｓｉｍ"]) assert.equal(aceitaContinuar(t), true, t);
for (const t of ["não", "sim, mas não agora", "pode não", "quanto custa?", "talvez", "quero ver o site", "sim nem pensar", "obrigado", "sim quero saber o preço"]) assert.equal(aceitaContinuar(t), false, t);
assert.equal(motivoDeEscalada("Quanto custa?"), "preço");
assert.equal(motivoDeEscalada("quero fechar"), "fechamento");
assert.equal(motivoDeEscalada("isso é spam"), "irritação");
assert.equal(motivoDeEscalada("como funciona a agenda?"), null);
// 3.5: disjuntor
// M-2 (12/11): no mínimo 5 casos (eram 2)
assert.equal(disjuntorDispara({ enviadas: 250, optouts: 4, bloqueios: 1 }), null, "2% exato não passa");
assert.ok(disjuntorDispara({ enviadas: 100, optouts: 4, bloqueios: 1 }), "5 casos e 5% desliga");
assert.equal(disjuntorDispara({ enviadas: 3, optouts: 1, bloqueios: 0 }), null, "1 caso só não desliga");
assert.equal(disjuntorDispara({ enviadas: 10, optouts: 2, bloqueios: 2 }), null, "4 casos, mesmo a 40%, não desliga");
assert.ok(disjuntorDispara({ enviadas: 0, optouts: 0, bloqueios: 0 }, { antes: "GREEN", agora: "YELLOW" }), "quality caiu");
assert.equal(disjuntorDispara({ enviadas: 0, optouts: 0, bloqueios: 0 }, { antes: "YELLOW", agora: "GREEN" }), null, "quality subiu");
// M-3: o validador confere o texto normalizado (NFKC, sem largura zero, ponto ideográfico) e o agente manda esse texto
for (const t of ["Me liga: １１９９９９９８８８８", "Me liga: ٠١١٩٩٩٩٩٨٨٨٨", "liga 11‒99999‒8888", "Fica R\u200d$ 10", "é gr\u200datis", "é gr\u200catis", "veja exemplo\u3002com", "veja exemplo.рф"]) assert.ok(problemasDaResposta(t, []).length, t);
assert.equal(normalizarSaida("Ｏｌá\u200b! gr\u200datis exemplo\u3002com"), "Olá! gratis exemplo.com");
assert.equal(normalizarSaida("👩\u200d🔧 ok"), "👩\u200d🔧 ok", "emoji composto fica");
assert.deepEqual(problemasDaResposta("Que bom! 👩\u200d🔧 A agenda online deixa o cliente marcar sozinho.", []), []);
// L-1: logs sem telefone completo
assert.equal(mascararDigitos("erro 5511999998888 no 123456 e 12345"), "erro …8888 no …3456 e 12345");
assert.ok(!/\d{6}/.test(resumoDoErro(new Error("número 5511999998888 inválido"))), resumoDoErro(new Error("número 5511999998888 inválido")));
assert.ok(!/\d{6}/.test(resumoDoErro({ codigo: "X", status: 409, message: "5511999998888" })));
// L-2: a reserva cobre a cadeia toda mais o atendys, calculada na hora
assert.ok(reservaDoTurno([60_000], 35_000) > 60_000 + 35_000);
assert.ok(reservaDoTurno([200_000, 300_000], 35_000) > 500_000 + 35_000, "cadeia longa estende a reserva");
console.log("puro: ok");

// ————— emulador —————
assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "rode pelo emulador (npm run test:prospeccao-f3)");
const db = adminDb;
const SLUG = "salao-f3-teste";
const INST = "ruphus-prospeccao-teste";
const SEGREDO = "segredo-de-teste-f3";
const CFG = { ativo: true, instancia: INST, numero: "5511900000042", apikey: "chave-teste", webhookSecret: SEGREDO };
const FONES = Array.from({ length: 40 }, (_, i) => `55119000010${String(i + 1).padStart(2, "0")}`);
// H1: outro negócio, com telefone próprio (FONES[9]) e token de proposta
const SLUG2 = "salao-f3-outro";

const limpar = async () => {
  for (const f of FONES) await db.recursiveDelete(db.doc(`prospeccaoConversas/${f}`));
  for (const s of [SLUG, SLUG2]) {
    await db.recursiveDelete(db.doc(`crm/${s}`));
    await db.doc(`tenants/${s}`).delete();
  }
  for (const c of ["iaChamadas", "prospeccaoEnvios", "prospeccaoDias"]) await Promise.all((await db.collection(c).get()).docs.map((d) => d.ref.delete()));
  for (const d of ["config/prospeccao", "config/ia-roteamento", "config/atendys-plataforma", "config/telefones-meta"]) await db.doc(d).delete();
};
await limpar();
await db.doc("config/prospeccao").set(CFG);
// IA pelo provedor local (OpenAI-compatível), respondido pelo fetch simulado: cada pedido à IA é contado
const IA_URL = "http://127.0.0.1:11434/v1/chat/completions";
await db.doc("config/ia-roteamento").set({ agente_lead: { cadeia: [{ provedor: "local", modelo: "teste", maxTokens: 100, timeoutMs: 2000, endpoint: IA_URL }] } });
let respostaIA: { resposta: string; acao: string } = { resposta: "", acao: "escalar" };
let pedidosIA = 0;
// M1: segura a resposta da IA para o PARE chegar no meio
let segurarIA: Promise<void> | null = null;
await db.doc(`tenants/${SLUG}`).set({ name: "Salão F3" });
// H1: o slug citado vira identidade só para um telefone do negócio
await db.doc(`crm/${SLUG}`).set({ estagio: "novo", telefone: FONES[0] });
await db.doc(`tenants/${SLUG2}`).set({ name: "Salão Outro" });
await db.doc(`crm/${SLUG2}`).set({ estagio: "novo", telefone: FONES[9], propostaToken: "tok-secreto" });
// o dia já com muitas enviadas: os PAREs do teste não disparam o disjuntor (ele tem teste próprio, em outro dia)
await db.doc(`prospeccaoDias/${todayIn()}`).set({ enviadas: 1000 });

// fetch simulado: só o atendys responde; qualquer outra rede (Anthropic, Meta) é falha do teste
type Chamada = { caminho: string; corpo: Record<string, unknown>; headers: Record<string, string> };
const chamadas: Chamada[] = [];
const NUMEROS_REAIS: Record<string, string> = { "inst-real-plataforma": "5591992361726", "inst-outro-numero": "5511900000077" };
let foraDoAtendys = 0;
/** M-3 (terceira rodada): o próximo send-text recebe esta recusa */
let falhaNoEnvio: { status: number; code: string } | null = null;
globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
  const u = new URL(String(url));
  if (u.href === IA_URL) {
    pedidosIA++;
    if (segurarIA) await segurarIA;
    return Response.json({ choices: [{ message: { content: JSON.stringify(respostaIA) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } });
  }
  if (u.port !== "3002") {
    foraDoAtendys++;
    return new Response("rede bloqueada no teste", { status: 500 });
  }
  const corpo = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  chamadas.push({ caminho: `${init.method} ${u.pathname}`, corpo, headers: init.headers as Record<string, string> });
  if (u.pathname === "/v1/message/send-text") {
    if (falhaNoEnvio) {
      const { status, code } = falhaNoEnvio;
      falhaNoEnvio = null;
      return Response.json({ error: { code, message: code } }, { status });
    }
    return Response.json({ id: randomUUID(), status: "queued" });
  }
  if (u.pathname === "/v1/optin") return Response.json({ ok: true });
  // M4: o número real da instância vem do atendys, não da config
  const inst = /^\/v1\/instance\/([^/]+)\/status$/.exec(u.pathname)?.[1];
  if (inst === "inst-fora") return new Response("fora do ar", { status: 503 });
  // LOW-4: resposta torta (phone número): Zod recusa, vira CanalProibido, sem TypeError
  if (inst === "inst-phone-numero") return Response.json({ name: inst, status: "connected", phone: 5511900000042 });
  if (inst) return Response.json({ name: inst, status: "connected", phone: NUMEROS_REAIS[decodeURIComponent(inst)] ?? CFG.numero });
  return new Response("rota não simulada", { status: 500 });
}) as typeof fetch;
const enviados = () => chamadas.filter((c) => c.caminho === "POST /v1/message/send-text");
const iaChamadas = async () => pedidosIA;

(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??= (await import("node:async_hooks")).AsyncLocalStorage;
const { POST } = await import("@/app/api/webhooks/atendys/route");
const assina = (s: string, b: string) => createHmac("sha256", s).update(b, "utf8").digest("hex");
const entregar = (payload: Record<string, unknown>, segredo = SEGREDO) => {
  const body = JSON.stringify({ event: "message.received", instance: INST, type: "text", ...payload });
  const t = Math.floor(Date.now() / 1000);
  return POST(new Request("http://x/api/webhooks/atendys", {
    method: "POST",
    headers: { "x-atendys-event": String(payload.event ?? "message.received"), "x-atendys-timestamp": String(t), "x-atendys-signature-v2": assina(segredo, `${t}.${body}`), "content-type": "application/json" },
    body,
  }));
};
const conversa = async (f: string) => (await db.doc(`prospeccaoConversas/${f}`).get()).data() ?? {};

// HMAC: segredo errado → 401 e nada acontece
assert.equal((await entregar({ messageId: "x0", phone: FONES[0], text: "oi" }, "errado")).status, 401);
assert.equal(enviados().length, 0);
// L-4: corpo acima de 64 KB leva 413 (pelo content-length, antes de ler; sem ele, depois de ler)
const grande = (headers: Record<string, string>) => POST(new Request("http://x/api/webhooks/atendys", { method: "POST", headers: { "x-atendys-event": "message.received", ...headers }, body: "x".repeat(70_000) }));
assert.equal((await grande({ "content-length": "70000" })).status, 413, "content-length grande");
assert.equal((await grande({})).status, 413, "corpo grande sem content-length");

// entrada pelo botão do site: a primeira resposta se identifica e pergunta se pode continuar
respostaIA = { resposta: "Que bom! A agenda online deixa o cliente marcar sozinho.", acao: "responder" };
assert.equal((await entregar({ messageId: "m1", phone: FONES[0], text: mensagemDeEntrada(SLUG) })).status, 200);
assert.equal(enviados().length, 1, "uma resposta");
const primeira = String(enviados()[0].corpo.text);
assert.ok(primeira.startsWith(APRESENTACAO) && primeira.includes(PERGUNTA_OPTIN), primeira);
assert.equal(enviados()[0].corpo.replyToInbound, true, "resposta dentro da janela");
assert.equal(enviados()[0].headers.instance, INST, "sai pela instância de prospecção");
assert.ok(enviados()[0].headers["idempotency-key"], "com idempotency-key");
assert.equal((await conversa(FONES[0])).slug, SLUG, "o código liga a conversa ao lead");
assert.equal(await iaChamadas(), 1);

// messageId repetido: ignorado (sem IA, sem envio)
await entregar({ messageId: "m1", phone: FONES[0], text: mensagemDeEntrada(SLUG) });
assert.equal(enviados().length, 1, "reentrega não responde de novo");
assert.equal(await iaChamadas(), 1, "reentrega não chama a IA");

// 3.4: "sim" depois da pergunta grava o opt-in com a evidência exata
await entregar({ messageId: "m2", phone: FONES[0], text: "Sim, pode" });
const optin = chamadas.find((c) => c.caminho === "POST /v1/optin");
assert.ok(optin, "opt-in registrado");
assert.equal(optin.corpo.category, "marketing");
assert.equal(optin.corpo.source, "ruphus-prospeccao-whatsapp");
assert.equal(optin.corpo.eventId, "m2");
assert.ok(String(optin.corpo.evidence).includes(PERGUNTA_OPTIN) && String(optin.corpo.evidence).includes('"Sim, pode"'), String(optin.corpo.evidence));
assert.ok((await conversa(FONES[0])).optinEm);
assert.equal(enviados().length, 2);
assert.ok(!String(enviados()[1].corpo.text).startsWith(APRESENTACAO), "só a primeira se apresenta");

// PARE: grava naoContatarEm no CRM sem chamar a IA e confirma a saída
const iaAntes = await iaChamadas();
await entregar({ messageId: "m3", phone: FONES[0], text: "PARE" });
assert.ok((await db.doc(`crm/${SLUG}`).get()).get("naoContatarEm"), "naoContatarEm no CRM");
assert.equal((await db.doc(`crm/${SLUG}`).get()).get("estagio"), "perdido");
assert.equal(await iaChamadas(), iaAntes, "PARE não chama a IA");
assert.equal(String(enviados().at(-1)!.corpo.text), CONFIRMA_SAIDA, "confirma a saída");
const nEnvios = enviados().length;
const eventos = (await db.collection(`crm/${SLUG}/eventos`).get()).size;
await entregar({ messageId: "m3", phone: FONES[0], text: "PARE" });
assert.equal(enviados().length, nEnvios, "PARE repetido não confirma de novo");
assert.equal((await db.collection(`crm/${SLUG}/eventos`).get()).size, eventos, "PARE repetido não grava outro evento");
await entregar({ messageId: "m4", phone: FONES[0], text: "oi de novo" });
assert.equal(enviados().length, nEnvios, "depois do PARE, silêncio");
assert.equal(await iaChamadas(), iaAntes, "depois do PARE, sem IA");
assert.equal((await db.doc(`prospeccaoDias/${(await db.collection("prospeccaoDias").get()).docs[0].id}`).get()).get("optouts"), 1);

// áudio: pede texto e escala, sem IA
await entregar({ messageId: "a1", phone: FONES[1], type: "media", mediaKind: "audio" });
assert.equal(String(enviados().at(-1)!.corpo.text), `${APRESENTACAO} ${PEDE_TEXTO}`);
assert.ok((await conversa(FONES[1])).escaladoEm);
assert.equal(await iaChamadas(), iaAntes);

// preço: escala antes da IA
await entregar({ messageId: "p1", phone: FONES[2], text: "quanto custa?" });
assert.equal((await conversa(FONES[2])).motivoEscalada, "preço");
assert.equal(await iaChamadas(), iaAntes);

// validador: resposta com preço vinda da IA não sai; escala
respostaIA = { resposta: "Fica R$ 50 por mês.", acao: "responder" };
const nAntes = enviados().length;
await entregar({ messageId: "v1", phone: FONES[3], text: "me conta mais" });
assert.equal((await conversa(FONES[3])).motivoEscalada, "a resposta da IA não passou no validador");
assert.ok(!enviados().slice(nAntes).some((c) => String(c.corpo.text).includes("R$")), "o preço não saiu");

// laço com resposta automática: na 4ª mensagem em segundos, escala (3 respostas automáticas seguidas)
respostaIA = { resposta: "Claro! Me conta como vocês marcam hoje.", acao: "responder" };
const cfg = (await configProspeccao(db))!;
const t0 = Date.now();
for (let i = 0; i < 3; i++) assert.equal(await atenderProspeccao(db, cfg, { messageId: `l${i}`, phone: FONES[4], type: "text", text: "Olá! Obrigado pelo contato." }, { agora: t0 + i * 5_000 }), "respondida");
assert.equal(await atenderProspeccao(db, cfg, { messageId: "l3", phone: FONES[4], type: "text", text: "Olá! Obrigado pelo contato." }, { agora: t0 + 15_000 }), "escalada");
assert.equal((await conversa(FONES[4])).motivoEscalada, "3 respostas automáticas seguidas");
// turnos por dia: 6 respostas espaçadas, a 7ª escala
for (let i = 0; i < 6; i++) assert.equal(await atenderProspeccao(db, cfg, { messageId: `t${i}`, phone: FONES[5], type: "text", text: `pergunta ${i}` }, { agora: t0 + i * 120_000 }), "respondida", `turno ${i}`);
assert.equal(await atenderProspeccao(db, cfg, { messageId: "t6", phone: FONES[5], type: "text", text: "mais uma" }, { agora: t0 + 6 * 120_000 }), "escalada");
assert.equal((await conversa(FONES[5])).motivoEscalada, "limite de turnos do dia");
// custo máximo por conversa: a conversa que já gastou o teto escala sem chamar a IA
await db.doc(`prospeccaoConversas/${FONES[5]}`).set({ escaladoEm: FieldValue.delete(), turnos: FieldValue.delete(), custoCentavos: 10 }, { merge: true });
const iaCusto = await iaChamadas();
assert.equal(await atenderProspeccao(db, cfg, { messageId: "c1", phone: FONES[5], type: "text", text: "e aí?" }, { agora: t0 + 30 * 60_000 }), "escalada");
assert.equal((await conversa(FONES[5])).motivoEscalada, "custo máximo da conversa");
assert.equal(await iaChamadas(), iaCusto);

// ————— revisão de segurança F3 —————
const crm2 = async () => (await db.doc(`crm/${SLUG2}`).get()).data() ?? {};
const notas2 = async () => (await db.collection(`crm/${SLUG2}/notas`).get()).size;
const optoutsHoje = async () => ((await db.doc(`prospeccaoDias/${todayIn()}`).get()).get("optouts") as number | undefined) ?? 0;
// H1: outro telefone que cita o slug do negócio: sem proposta, sem nota e sem opt-out no CRM dele
respostaIA = { resposta: "Segue a sua proposta.", acao: "enviarProposta" };
let n0 = enviados().length;
assert.equal(await atenderProspeccao(db, cfg, { messageId: "h1", phone: FONES[7], type: "text", text: mensagemDeEntrada(SLUG2) }), "escalada");
assert.ok(!enviados().slice(n0).some((c) => String(c.corpo.text).includes("tok-secreto")), "sem link de proposta");
assert.equal(String(enviados().at(-1)!.corpo.text), `${APRESENTACAO} ${PASSA_PARA_HUMANO}`);
assert.equal((await conversa(FONES[7])).slug, null, "slug não confirmado");
assert.equal((await conversa(FONES[7])).slugAlegado, SLUG2);
assert.equal(await notas2(), 0, "sem nota no CRM do negócio");
assert.equal(await atenderProspeccao(db, cfg, { messageId: "h2", phone: FONES[7], type: "text", text: "PARE" }), "optout");
assert.ok(!(await crm2()).naoContatarEm, "o PARE de outro telefone não marca o CRM do negócio");
assert.equal((await crm2()).estagio, "novo");
assert.ok((await conversa(FONES[7])).naoContatarEm, "o PARE fica na conversa");
// sem a confirmação, o site demo (público) pode sair
respostaIA = { resposta: "Olha o seu site:", acao: "enviarLinkDemo" };
assert.equal(await atenderProspeccao(db, cfg, { messageId: "h3", phone: FONES[8], type: "text", text: mensagemDeEntrada(SLUG2) }), "respondida");
assert.ok(String(enviados().at(-1)!.corpo.text).includes(`https://${SLUG2}.ruphus.site/`));
// o telefone do negócio recebe a proposta
respostaIA = { resposta: "Segue a sua proposta.", acao: "enviarProposta" };
assert.equal(await atenderProspeccao(db, cfg, { messageId: "h4", phone: FONES[9], type: "text", text: mensagemDeEntrada(SLUG2) }), "respondida");
assert.ok(String(enviados().at(-1)!.corpo.text).includes(`/proposta/${SLUG2}?t=tok-secreto`));
assert.equal((await conversa(FONES[9])).slug, SLUG2);
// F2-16: falha da IA (validador) com o slug confirmado vira evento com código no CRM do negócio. A
// falha do FONES[3] acima (sem slug confirmado) não gravou nada em CRM nenhum (H1)
respostaIA = { resposta: "Fica R$ 50 por mês.", acao: "responder" };
assert.equal(await atenderProspeccao(db, cfg, { messageId: "h5", phone: FONES[9], type: "text", text: "me conta mais" }), "escalada");
const falhasIA = (await db.collection(`crm/${SLUG2}/eventos`).where("tipo", "==", "ia_falha").get()).docs.map((d) => d.data());
assert.deepEqual(falhasIA.map((f) => [f.origem, f.codigo]), [["agente", "SaidaIAInvalida"]]);
assert.equal((await db.collection(`crm/${SLUG}/eventos`).where("tipo", "==", "ia_falha").get()).size, 0);

// M-3 (terceira rodada): a resposta do turno que não sai (5xx, 403 NOT_OPTED_IN) não some: escala sem
// outro envio e anota no CRM; o aviso de escalada que falha só vai ao log, com a nota já gravada
{
  const SLUG3 = "salao-f3-envio";
  await db.doc(`tenants/${SLUG3}`).set({ name: "Salão Envio" });
  await db.doc(`crm/${SLUG3}`).set({ estagio: "novo", telefone: FONES[38], donoWhatsapp: FONES[39] });
  const notas3 = async () => (await db.collection(`crm/${SLUG3}/notas`).get()).docs.map((d) => String(d.get("texto")));
  const erroLog = console.error;
  console.error = () => {};
  try {
    respostaIA = { resposta: "Claro! Me conta como vocês marcam hoje.", acao: "responder" };
    for (const [fone, falha] of [[FONES[38], { status: 403, code: "NOT_OPTED_IN" }], [FONES[39], { status: 503, code: "UNAVAILABLE" }]] as const) {
      await db.recursiveDelete(db.doc(`prospeccaoConversas/${fone}`));
      const n = enviados().length;
      const antes = (await notas3()).length;
      falhaNoEnvio = falha;
      assert.equal(await atenderProspeccao(db, cfg, { messageId: `m3e-${falha.code}`, phone: fone, type: "text", text: mensagemDeEntrada(SLUG3) }), "escalada", falha.code);
      assert.equal(enviados().length, n + 1, `${falha.code}: só a tentativa que falhou, sem aviso depois`);
      assert.match(String((await conversa(fone)).motivoEscalada), /^envio falhou/, falha.code);
      const notas = await notas3();
      assert.equal(notas.length, antes + 1, `${falha.code}: nota no CRM`);
      assert.ok(notas.some((t) => t.includes("envio falhou")), notas.join(" | "));
    }
    // o aviso da escalada (preço) que não sai: a nota entra antes, e a escalada não cai
    await db.recursiveDelete(db.doc(`prospeccaoConversas/${FONES[38]}`));
    await db.doc(`prospeccaoConversas/${FONES[38]}`).set({ slug: SLUG3 });
    const antes = (await notas3()).length;
    falhaNoEnvio = { status: 503, code: "UNAVAILABLE" };
    assert.equal(await atenderProspeccao(db, cfg, { messageId: "m3e-aviso", phone: FONES[38], type: "text", text: "quanto custa?" }), "escalada");
    assert.equal((await conversa(FONES[38])).motivoEscalada, "preço");
    assert.equal((await notas3()).length, antes + 1, "nota antes do aviso que falhou");
  } finally {
    console.error = erroLog;
    falhaNoEnvio = null;
    await db.recursiveDelete(db.doc(`crm/${SLUG3}`));
    await db.doc(`tenants/${SLUG3}`).delete();
    for (const f of [FONES[38], FONES[39]]) await db.recursiveDelete(db.doc(`prospeccaoConversas/${f}`));
  }
  console.log("envio do turno que falha: ok");
}

// M2: o disjuntor conta o opt-out uma vez por telefone. M-2 (12/11): só de conversa que a Ruphus abordou
// primeiro (envio ativo da fila ou slug confirmado); o FONES[8] recebe um envio ativo antes
let o0 = await optoutsHoje();
await enviarProspeccao(db, cfg, paraTelefoneNorm(FONES[8])!, "Oi! Tem novidade na sua proposta.", "abordagem-o", Date.now(), { ativo: true });
await atenderProspeccao(db, cfg, { messageId: "o1", phone: FONES[8], type: "text", text: "PARE" });
await atenderProspeccao(db, cfg, { messageId: "o2", phone: FONES[8], type: "text", text: "SAIR" });
assert.equal(await optoutsHoje(), o0 + 1, "dois PAREs do mesmo telefone contam 1");
o0 = await optoutsHoje();
assert.equal(await atenderProspeccao(db, cfg, { messageId: "o3", phone: FONES[10], type: "text", text: "PARE" }), "optout");
assert.equal(await optoutsHoje(), o0, "PARE de quem nunca recebeu não conta");
assert.equal(String(enviados().at(-1)!.corpo.text), `${APRESENTACAO} ${CONFIRMA_SAIDA}`);
// M-2: dois PAREs de números que nunca receberam nada, num dia com poucas enviadas, não desligam
const diaDoc = db.doc(`prospeccaoDias/${todayIn()}`);
const diaAntes = (await diaDoc.get()).data() ?? {};
await diaDoc.set({ enviadas: 1, optouts: 0, bloqueios: 0 });
for (const f of [FONES[20], FONES[21]]) assert.equal(await atenderProspeccao(db, cfg, { messageId: `m2-${f}`, phone: f, type: "text", text: "PARE" }), "optout");
assert.equal(await optoutsHoje(), 0, "não contam");
assert.equal((await db.doc("config/prospeccao").get()).get("ativo"), true, "o disjuntor segue ligado");
await diaDoc.set(diaAntes);
// M-2: a Ruphus respondeu (identificadoEm), mas o lead escreveu primeiro e o slug não foi confirmado: não conta
o0 = await optoutsHoje();
respostaIA = { resposta: "Claro! Me conta como vocês marcam hoje.", acao: "responder" };
assert.equal(await atenderProspeccao(db, cfg, { messageId: "m2-r", phone: FONES[19], type: "text", text: "oi" }), "respondida");
assert.equal(await atenderProspeccao(db, cfg, { messageId: "m2-p", phone: FONES[19], type: "text", text: "PARE" }), "optout");
assert.equal(await optoutsHoje(), o0, "conversa só respondida não conta");

// H-1: com a pergunta do opt-in aberta, as 8 frases de saída são opt-out e nenhuma grava opt-in
const comPergunta = (f: string, historico: { de: string; texto: string }[]) =>
  db.doc(`prospeccaoConversas/${f}`).set({ identificadoEm: Date.now(), optinPerguntadoEm: Date.now(), historico });
const perguntaOptin = { de: "ruphus", texto: `${APRESENTACAO} Que bom!\n\n${PERGUNTA_OPTIN}` };
const optins = () => chamadas.filter((c) => c.caminho === "POST /v1/optin").length;
let nOptin = optins();
for (const [i, t] of SAIDAS_H1.entries()) {
  const f = FONES[22 + i];
  await comPergunta(f, [{ de: "lead", texto: "oi" }, perguntaOptin]);
  assert.equal(await atenderProspeccao(db, cfg, { messageId: `h1-${i}`, phone: f, type: "text", text: t }), "optout", t);
  assert.ok((await conversa(f)).naoContatarEm, t);
  assert.equal((await conversa(f)).optinEm, undefined, t);
}
assert.equal(optins(), nOptin, "nenhuma frase de saída registrou opt-in");
// M-1: o opt-in só vale como resposta à última pergunta de opt-in da Ruphus
await comPergunta(FONES[30], [perguntaOptin, { de: "lead", texto: "como funciona?" }, { de: "ruphus", texto: "Quer ver como fica a agenda do salão?" }]);
assert.equal(await atenderProspeccao(db, cfg, { messageId: "m1-a", phone: FONES[30], type: "text", text: "quero ver o site" }), "respondida");
await comPergunta(FONES[31], [perguntaOptin, { de: "lead", texto: "como funciona?" }, { de: "ruphus", texto: "Quer ver como fica a agenda do salão?" }]);
assert.equal(await atenderProspeccao(db, cfg, { messageId: "m1-b", phone: FONES[31], type: "text", text: "sim" }), "respondida");
// a fala do lead veio depois da pergunta (mensagem que entrou enquanto outro turno estava em andamento)
await comPergunta(FONES[32], [perguntaOptin, { de: "lead", texto: "e quanto tempo leva?" }]);
assert.equal(await atenderProspeccao(db, cfg, { messageId: "m1-c", phone: FONES[32], type: "text", text: "sim" }), "respondida");
assert.equal(optins(), nOptin, "sim depois de outra pergunta não grava opt-in");
for (const f of [FONES[30], FONES[31], FONES[32]]) {
  assert.equal((await conversa(f)).optinEm, undefined, f);
  assert.equal((await conversa(f)).optinPerguntadoEm, undefined, `a pergunta fecha depois de qualquer resposta (${f})`);
}
// o sim logo depois da pergunta grava (controle positivo do M-1)
await comPergunta(FONES[33], [{ de: "lead", texto: "oi" }, perguntaOptin]);
assert.equal(await atenderProspeccao(db, cfg, { messageId: "m1-d", phone: FONES[33], type: "text", text: "pode sim" }), "respondida");
assert.equal(optins(), nOptin + 1, "sim à pergunta grava");
nOptin = optins();
// M-3: o agente envia o texto normalizado que o validador conferiu
respostaIA = { resposta: "Claro！ Ｍe conta como vocês marcam hoje.", acao: "responder" };
assert.equal(await atenderProspeccao(db, cfg, { messageId: "m3-a", phone: FONES[34], type: "text", text: "oi" }), "respondida");
const normalizada = String(enviados().at(-1)!.corpo.text);
assert.ok(normalizada.includes("Claro! Me conta como vocês marcam hoje.") && !normalizada.includes("！"), normalizada);

// M3: pedido de parar sem a palavra: opt-out sem IA, confirmação curta e o CRM em "parar"
let ia0 = pedidosIA;
assert.equal(await atenderProspeccao(db, cfg, { messageId: "q1", phone: FONES[9], type: "text", text: "me tira dessa lista" }), "optout");
assert.equal(pedidosIA, ia0, "sem IA");
assert.equal(String(enviados().at(-1)!.corpo.text), CONFIRMA_SAIDA);
assert.ok((await conversa(FONES[9])).naoContatarEm);
assert.ok((await crm2()).naoContatarEm, "o CRM do telefone confirmado vira parar");
assert.equal((await crm2()).estagio, "perdido");
// xingamento sem pedido de parar: escala, sem mensagem ao lead e sem IA
n0 = enviados().length;
assert.equal(await atenderProspeccao(db, cfg, { messageId: "q2", phone: FONES[11], type: "text", text: "que porra é essa" }), "escalada");
assert.equal(enviados().length, n0, "nada sai para o lead");
assert.equal(pedidosIA, ia0);
assert.equal((await conversa(FONES[11])).motivoEscalada, "irritação");

// M1: PARE enquanto a IA pensa no "oi": nada sai depois do PARE além da confirmação
respostaIA = { resposta: "Claro! Me conta como vocês marcam hoje.", acao: "responder" };
let liberarIA = () => {};
segurarIA = new Promise((r) => (liberarIA = r));
ia0 = pedidosIA;
const oi = atenderProspeccao(db, cfg, { messageId: "r1", phone: FONES[12], type: "text", text: "oi" });
while (pedidosIA === ia0) await new Promise((r) => setTimeout(r, 10));
n0 = enviados().length;
assert.equal(await atenderProspeccao(db, cfg, { messageId: "r2", phone: FONES[12], type: "text", text: "PARE" }), "optout");
segurarIA = null;
liberarIA();
assert.equal(await oi, "silencio", "a resposta do oi não sai");
assert.deepEqual(enviados().slice(n0).map((c) => String(c.corpo.text)), [`${APRESENTACAO} ${CONFIRMA_SAIDA}`]);
// rajada: N mensagens ao mesmo tempo respeitam turnosPorDia (uma chama a IA, as outras esperam)
n0 = enviados().length;
const rajada = await Promise.all(Array.from({ length: 8 }, (_, i) => atenderProspeccao(db, cfg, { messageId: `b${i}`, phone: FONES[13], type: "text", text: `pergunta ${i}` })));
const respondidas = rajada.filter((r) => r === "respondida").length;
assert.ok(respondidas >= 1 && respondidas <= LIMITES_AGENTE.turnosPorDia, String(rajada));
// as que não couberam ficam em silêncio ou escalam (o aviso de escalada é o único texto a mais)
assert.equal(enviados().slice(n0).filter((c) => !String(c.corpo.text).includes(PASSA_PARA_HUMANO)).length, respondidas);
assert.ok(((await conversa(FONES[13])).turnos as { n: number }).n <= LIMITES_AGENTE.turnosPorDia);
assert.equal((await conversa(FONES[13])).emAndamento, undefined, "a reserva foi liberada");
assert.equal((await conversa(FONES[13])).reservaToken, undefined, "com o token");
// F3-reserva: só quem reservou libera. A reserva venceu e outra mensagem a tomou (outro token): a
// chamada antiga termina sem apagar a reserva da outra
respostaIA = { resposta: "Claro! Me conta como vocês marcam hoje.", acao: "responder" };
let soltarIA = () => {};
segurarIA = new Promise((r) => (soltarIA = r));
ia0 = pedidosIA;
const lenta = atenderProspeccao(db, cfg, { messageId: "k1", phone: FONES[15], type: "text", text: "oi" });
while (pedidosIA === ia0) await new Promise((r) => setTimeout(r, 10));
assert.ok((await conversa(FONES[15])).reservaToken, "a reserva leva o token de quem reservou");
await db.doc(`prospeccaoConversas/${FONES[15]}`).set({ emAndamento: Date.now(), reservaToken: "outro-dono" }, { merge: true });
segurarIA = null;
soltarIA();
assert.equal(await lenta, "respondida");
assert.equal((await conversa(FONES[15])).reservaToken, "outro-dono", "a reserva de outro fica");
assert.ok((await conversa(FONES[15])).emAndamento);

// M4: a trava usa o número REAL da instância (atendys), não o da config; falha na consulta recusa
const telM4 = paraTelefoneNorm(FONES[14])!;
n0 = chamadas.filter((c) => c.caminho.startsWith("POST")).length;
const recusado = (e: unknown) => (e as { codigo?: string }).codigo === "CanalProibido";
await assert.rejects(enviarProspeccao(db, { ...CFG, instancia: "inst-real-plataforma" }, telM4, "oi", "k"), recusado, "número real 1726");
await assert.rejects(enviarProspeccao(db, { ...CFG, instancia: "inst-fora" }, telM4, "oi", "k"), recusado, "consulta falhou");
await assert.rejects(enviarProspeccao(db, { ...CFG, instancia: "inst-outro-numero" }, telM4, "oi", "k"), recusado, "config diz outro número");
await assert.rejects(enviarProspeccao(db, { ...CFG, instancia: "inst-phone-numero" }, telM4, "oi", "k"), recusado, "LOW-4: phone número vira CanalProibido (fail-closed), não TypeError");
assert.equal(await atenderProspeccao(db, { ...CFG, instancia: "inst-real-plataforma" }, { messageId: "n1", phone: FONES[14], type: "text", text: "oi" }), "recusada");
// L6: o botão do site e o agente usam o mesmo número
process.env.RUPHUS_WHATSAPP_PROSPECCAO = "5511900000099";
await assert.rejects(enviarProspeccao(db, CFG, telM4, "oi", "k"), recusado, "botão com outro número");
delete process.env.RUPHUS_WHATSAPP_PROSPECCAO;
assert.equal(chamadas.filter((c) => c.caminho.startsWith("POST")).length, n0, "nenhum POST ao atendys");
console.log("revisão F3: ok");

// tsx carrega o módulo duas vezes (teste e rota): compara pelo código, não pela classe
const proibido = (e: unknown) => (e as { codigo?: string }).codigo === "CanalProibido";
// 3.1 no envio: instância 1726 (ou o número dela) é recusada, sem chamar o atendys
const antes = chamadas.length;
const tel = paraTelefoneNorm(FONES[0])!;
const proibidas: ConfigProspeccao[] = [
  { ...CFG, instancia: "ruphus-plataforma-cloud-1726" },
  { ...CFG, numero: "5591992361726" },
];
for (const c of proibidas) await assert.rejects(enviarProspeccao(db, c, tel, "oi", "k"), proibido);
// a instância da plataforma escolhida no admin (config/atendys-plataforma) também
await db.doc("config/atendys-plataforma").set({ instanceId: "plataforma-escolhida-no-admin" });
await assert.rejects(enviarProspeccao(db, { ...CFG, instancia: "plataforma-escolhida-no-admin" }, tel, "oi", "k"), proibido);
// M-4: config/prospeccao com credenciais do tenant da plataforma é recusada; L-3: o phone da plataforma é reservado
await db.doc("config/atendys-plataforma").set({ apikey: CFG.apikey, webhookSecret: "outro" });
await assert.rejects(enviarProspeccao(db, CFG, tel, "oi", "k"), proibido, "apikey da plataforma");
await db.doc("config/atendys-plataforma").set({ apikey: "outra", webhookSecret: SEGREDO });
await assert.rejects(enviarProspeccao(db, CFG, tel, "oi", "k"), proibido, "webhookSecret da plataforma");
await db.doc("config/atendys-plataforma").set({ apikey: "outra", webhookSecret: "outro", phone: `+${CFG.numero}` });
await assert.rejects(enviarProspeccao(db, CFG, tel, "oi", "k"), proibido, "phone da plataforma");
await db.doc("config/atendys-plataforma").delete();
assert.equal(chamadas.length, antes, "nada foi ao atendys");
// pelo webhook: config apontando a prospecção para a 1726 → recusada, nada sai
await db.doc("config/prospeccao").set({ ...CFG, instancia: "ruphus-plataforma-cloud-1726" });
const body = JSON.stringify({ event: "message.received", instance: "ruphus-plataforma-cloud-1726", type: "text", messageId: "z1", phone: "5511900002468", text: "oi" });
const ts = Math.floor(Date.now() / 1000);
await POST(new Request("http://x/api/webhooks/atendys", { method: "POST", headers: { "x-atendys-event": "message.received", "x-atendys-timestamp": String(ts), "x-atendys-signature-v2": assina(SEGREDO, `${ts}.${body}`) }, body }));
assert.equal(chamadas.length, antes, "webhook na 1726 não envia prospecção");
assert.equal(await atenderProspeccao(db, { ...CFG, instancia: "ruphus-plataforma-cloud-1726" }, { messageId: "z2", phone: "5511900002468", type: "text", text: "oi" }), "recusada");
assert.equal((await db.doc("prospeccaoConversas/5511900002468/recebidas/z1").get()).exists, false, "nem chega à IA");
await db.doc("config/prospeccao").set(CFG);
console.log("webhook e trava: ok");

// 3.5: disjuntor no Firestore. Opt-out + bloqueio acima de 2% desliga config/prospeccao.ativo
const DIA = "2099-01-01";
for (let i = 0; i < 10; i++) await contarNoDia(db, "enviadas", DIA);
// M-2 (12/11): mínimo de 5 casos (eram 2)
for (let i = 0; i < 4; i++) await contarNoDia(db, "optouts", DIA);
assert.equal((await db.doc("config/prospeccao").get()).get("ativo"), true, "4 casos: segue");
await contarNoDia(db, "bloqueios", DIA);
assert.equal((await db.doc("config/prospeccao").get()).get("ativo"), false, "5 em 10: desliga");
assert.ok((await db.doc("config/prospeccao").get()).get("motivoDesligamento"));
// desligado: o agente não responde nem chama a IA. Nada fica marcado para sempre (sem escaladoEm,
// mudança da revisão F3 "operacional"): só o evento agente_desligado no log da conversa
const [nE, nI] = [enviados().length, await iaChamadas()];
await entregar({ messageId: "d1", phone: FONES[6], text: "oi, quero saber mais" });
assert.equal(enviados().length, nE, "desligado não envia");
assert.equal(await iaChamadas(), nI, "desligado não chama a IA");
assert.equal((await conversa(FONES[6])).escaladoEm, undefined, "desligado não escala para sempre");
assert.deepEqual((await db.collection(`prospeccaoConversas/${FONES[6]}/eventos`).get()).docs.map((d) => d.get("tipo")), ["agente_desligado"]);
assert.equal(await atenderProspeccao(db, { ...CFG, ativo: false }, { messageId: "d1b", phone: FONES[6], type: "text", text: "alô?" }), "desligado");
// religado: a próxima mensagem da mesma conversa é atendida
await db.doc("config/prospeccao").set(CFG);
respostaIA = { resposta: "Claro! Me conta como vocês marcam hoje.", acao: "responder" };
await entregar({ messageId: "d2", phone: FONES[6], text: "oi de novo" });
assert.equal(enviados().length, nE + 1, "religado, responde");
assert.ok(((await conversa(FONES[6])).historico as { texto: string }[]).some((f) => f.texto === "oi, quero saber mais"), "a mensagem do desligado ficou no histórico");
await db.recursiveDelete(db.doc(`prospeccaoConversas/${FONES[6]}`));
// quality_rating caiu: desliga
await db.doc("config/prospeccao").set(CFG);
await registrarQualidade(db, "GREEN");
assert.equal((await db.doc("config/prospeccao").get()).get("ativo"), true);
await registrarQualidade(db, "YELLOW");
assert.equal((await db.doc("config/prospeccao").get()).get("ativo"), false, "queda de quality desliga");
// message.status failed de um envio da prospecção conta como bloqueio (assinado pelo tenant de prospecção)
await db.doc("config/prospeccao").set(CFG);
// M-2: só envio ativo (ou conversa com slug confirmado) conta; antes era um envio qualquer da coleção
const idEnvio = (await enviarProspeccao(db, CFG, paraTelefoneNorm(FONES[35])!, "Oi! Tem novidade na sua proposta.", "bloqueio-ativo", Date.now(), { ativo: true }))!.messageId;
const idResposta = (await enviarProspeccao(db, CFG, paraTelefoneNorm(FONES[36])!, "Resposta a quem escreveu.", "bloqueio-resposta"))!.messageId;
const diaHoje = (await db.collection("prospeccaoDias").get()).docs.find((d) => d.id !== DIA)!.id;
const bloqueiosAntes = (await db.doc(`prospeccaoDias/${diaHoje}`).get()).get("bloqueios") ?? 0;
const status = (segredo: string, messageId = idEnvio) => {
  const b = JSON.stringify({ event: "message.status", messageId, phone: FONES[0], status: "failed", errorCode: "131026" });
  const t = Math.floor(Date.now() / 1000);
  return POST(new Request("http://x/api/webhooks/atendys", { method: "POST", headers: { "x-atendys-event": "message.status", "x-atendys-timestamp": String(t), "x-atendys-signature-v2": assina(segredo, `${t}.${b}`) }, body: b }));
};
await status("errado");
assert.equal((await db.doc(`prospeccaoDias/${diaHoje}`).get()).get("bloqueios") ?? 0, bloqueiosAntes, "assinatura errada não conta");
assert.equal((await status(SEGREDO)).status, 200);
await status(SEGREDO); // reentrega
assert.equal((await db.doc(`prospeccaoDias/${diaHoje}`).get()).get("bloqueios"), bloqueiosAntes + 1, "conta uma vez");
await status(SEGREDO, idResposta);
assert.equal((await db.doc(`prospeccaoDias/${diaHoje}`).get()).get("bloqueios"), bloqueiosAntes + 1, "M-2: falha da resposta a quem escreveu (sem slug confirmado) não conta");
assert.equal((await db.doc(`prospeccaoEnvios/${idResposta}`).get()).get("falhou"), true, "mas fica marcada");
console.log("disjuntor: ok");

assert.equal(foraDoAtendys, 0, "nenhuma chamada fora dos simulados (Anthropic, Meta)");
await limpar();
console.log("prospecção F3: ok");
