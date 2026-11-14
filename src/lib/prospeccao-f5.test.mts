// Rode: npm run test:prospeccao-f5  (fila de envios da prospecção: Firestore no emulador demo-siteflow e
// fetch simulado para o atendys, com idempotency-key de verdade). Nada sai para a rede.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/admin";
import { chaveDeEnvio } from "@/lib/atendys";
import { dateIn, zonedTime } from "@/lib/datetime";
import { prng } from "@/lib/teste-prng";
import { escolherVariante, varianteAB } from "@/lib/prospeccao";
import { VARIANTES, VARIANTES_F1 } from "@/lib/prospeccao-variantes";
import { travada } from "@/lib/prospeccao-biblioteca";
import { semear } from "@/lib/prospeccao-biblioteca.server";
import { marcarContato, registrarMensagem } from "@/lib/crm";
import { atenderProspeccao } from "@/lib/prospeccao-agente.server";
import { espalhar, FILA, formaDoEnvio, ItemFila, naJanela, TemplatesFila } from "@/lib/prospeccao-fila";
import { candidatasDoProdutor, concluir, consumirUm, LIMITES_FILA, produzir, reconciliarCrm, reservar } from "@/lib/prospeccao-fila.server";

const t = (dia: string, hora: string) => zonedTime(dia, hora).getTime();
// quarta-feira, 18/11/2026
const QUA = "2026-11-18";
const T = t(QUA, "10:00");

// ————— puro: a janela —————
assert.equal(naJanela(T), true);
assert.equal(naJanela(t(QUA, "09:00")), true);
assert.equal(naJanela(t(QUA, "11:30")), false);
assert.equal(naJanela(t(QUA, "12:00")), false);
assert.equal(naJanela(t(QUA, "17:29")), true);
assert.equal(naJanela(t("2026-11-21", "10:00")), false, "sábado");
const dez = espalhar(10, t(QUA, "07:00"));
assert.equal(new Set(dez).size, 10, "horários distintos");
assert.ok(dez.every((h) => naJanela(h) && dateIn(new Date(h)) === QUA), "todos na janela do dia");
assert.deepEqual([...dez].sort((a, b) => a - b), dez);
assert.ok(espalhar(3, t("2026-11-20", "18:00")).every((h) => dateIn(new Date(h)) === "2026-11-23" && naJanela(h)), "sexta à noite vai para segunda");
assert.ok(espalhar(4, T).every((h) => h > T && naJanela(h)), "a partir de agora");
// as travadas do A/B da F1 nunca entram no pool do escolherVariante do produtor (só pelo varianteAB)
assert.ok(VARIANTES_F1.some((f) => f.id === escolherVariante({ nicho: "salao", recebidas: [] }, "primeiro", {}, () => 0).variante?.id), "sem o filtro, a travada sairia");
const pesado = Object.fromEntries(VARIANTES.map((v) => [v.id, { enviados: 500, respostas: travada(v.id) ? 400 : 1, optouts: 0 }]));
const sorteioPool = prng(7);
for (let i = 0; i < 300; i++) {
  const v = escolherVariante({ nicho: "salao", recebidas: [] }, "primeiro", pesado, sorteioPool, candidatasDoProdutor(VARIANTES, new Set())).variante;
  assert.ok(v && !travada(v.id), `travada no pool do produtor: ${v?.id}`);
}
// janela de 24 h da Meta: fora dela só template; template torto na config é recusado (vira ausente)
const TPL = { primeiro: { nome: "ruphus_primeiro", idioma: "pt_BR" }, lembrete: { nome: "ruphus_lembrete", idioma: "pt_BR" }, ultima: { nome: "ruphus_ultima", idioma: "pt_BR" } };
const base = ItemFila.parse({ status: "pendente", slug: "s", etapa: "lembrete", telefoneNorm: "5511900000000", varianteId: "v", texto: "Oi! Responda PARE para sair.", agendadoPara: T, tentativas: 0, criadoEm: T, crmEnvioId: randomUUID(), templateParametros: ["Salão X", "s.ruphus.site/?c=1"] });
assert.deepEqual(formaDoEnvio(base, undefined, false), { tipo: "sem_template" }, "fora da janela sem template não sai");
assert.deepEqual(formaDoEnvio(base, TemplatesFila.parse({ primeiro: TPL.primeiro }), false), { tipo: "sem_template" }, "só o template de outra etapa");
assert.deepEqual(formaDoEnvio(base, TPL, false), { tipo: "template", nome: "ruphus_lembrete", idioma: "pt_BR", parametros: ["Salão X", "s.ruphus.site/?c=1"] }, "fora da janela com template");
assert.deepEqual(formaDoEnvio(base, TPL, true), { tipo: "texto" }, "dentro da janela, texto livre");
assert.deepEqual(formaDoEnvio({ ...base, templateParametros: undefined }, TPL, false), { tipo: "sem_template" }, "item sem as variáveis");
assert.deepEqual(formaDoEnvio({ ...base, templateNome: "ruphus_lembrete", templateIdioma: "pt_BR" }, undefined, true), { tipo: "template", nome: "ruphus_lembrete", idioma: "pt_BR", parametros: ["Salão X", "s.ruphus.site/?c=1"] }, "o template gravado vale na retomada");
assert.deepEqual(formaDoEnvio(base, TPL, false, true), { tipo: "texto" }, "retomada sem template repete o texto (mesma chave)");
const tortos = TemplatesFila.parse({ primeiro: { nome: "Com Espaço", idioma: "pt_BR" }, lembrete: { nome: "ok_nome", idioma: "portugues" }, ultima: { nome: "ruphus_ultima" } });
assert.deepEqual(tortos, { primeiro: undefined, lembrete: undefined, ultima: undefined }, "nome, idioma ou campo faltando: recusado");
assert.deepEqual(formaDoEnvio({ ...base, etapa: "ultima" }, tortos, false), { tipo: "sem_template" });
console.log("puro: ok");

// ————— emulador —————
assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "rode pelo emulador (npm run test:prospeccao-f5)");
const db = adminDb;
// templates: os leads do teste não escreveram nas últimas 24 h (fora da janela da Meta)
const CFG = { ativo: true, instancia: "ruphus-prospeccao-teste", numero: "5511900000042", apikey: "chave-teste", webhookSecret: "segredo-f5", cotaDiaria: 2, templates: TPL };
const FONES = Array.from({ length: 12 }, (_, i) => `55119000020${String(i).padStart(2, "0")}`);
const SLUGS = FONES.map((_, i) => `salao-f5-${i}`);

const apagar = async (c: string) => Promise.all((await db.collection(c).get()).docs.map((d) => db.recursiveDelete(d.ref)));
const limpar = async () => {
  for (const c of [FILA, "prospeccaoConversas", "prospeccaoEnvios", "prospeccaoDias", "prospeccaoVariantes"]) await apagar(c);
  for (const s of SLUGS) {
    await db.recursiveDelete(db.doc(`crm/${s}`));
    await db.doc(`tenants/${s}`).delete();
  }
  await db.doc("config/prospeccao").delete();
};
const novaRodada = async (cfg: Record<string, unknown> = CFG) => {
  await apagar(FILA);
  await apagar("prospeccaoDias");
  await db.doc("config/prospeccao").set(cfg);
  // o relógio do teste (T) é fixo e o ultimoContatoEm do CRM é do servidor (hora real): sem limpar, o
  // item da rodada nova seria cancelado por "cadencia" quando a data real passasse de T
  for (const s of SLUGS) await db.doc(`crm/${s}`).set({ ultimoContatoEm: FieldValue.delete() }, { merge: true });
  chamadas.length = 0;
};

// fetch simulado: o atendys guarda a mensagem pela idempotency-key (como o unique tenantId+idempotencyKey)
type Chamada = { caminho: string; corpo: Record<string, unknown>; chave: string | undefined };
const chamadas: Chamada[] = [];
const porChave = new Map<string, string>();
let prazoNoProximo = false;
/** a próxima chave nova recebe esta recusa (o atendys confere a chave antes da instância);
 *  mesmoComChave: também a chave já aceita (a retomada) */
let recusaNoProximo: { status: number; code: string; mesmoComChave?: boolean } | null = null;
/** a próxima resposta 2xx do envio leva este status (e retryAt) em vez de "queued" */
let respostaNoProximo: { status: string; retryAt?: string } | null = null;
/** o que GET /v1/message/:id/status responde */
let statusMensagem = "queued";
let foraDoAtendys = 0;
globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
  const u = new URL(String(url));
  if (u.port !== "3002") {
    foraDoAtendys++;
    return new Response("rede bloqueada no teste", { status: 500 });
  }
  const headers = init.headers as Record<string, string>;
  const corpo = init.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
  chamadas.push({ caminho: `${init.method} ${u.pathname}`, corpo, chave: headers["idempotency-key"] });
  if (u.pathname === "/v1/message/send-text" || u.pathname === "/v1/message/send-template") {
    const chave = headers["idempotency-key"];
    if (recusaNoProximo && (recusaNoProximo.mesmoComChave || !(chave && porChave.has(chave)))) {
      const { status, code } = recusaNoProximo;
      recusaNoProximo = null;
      return Response.json({ error: { code, message: code } }, { status });
    }
    const id = (chave && porChave.get(chave)) ?? randomUUID();
    if (chave) porChave.set(chave, id);
    // o atendys aceitou, mas a resposta não chegou
    if (prazoNoProximo) {
      prazoNoProximo = false;
      throw new DOMException("prazo", "TimeoutError");
    }
    const resposta = respostaNoProximo ?? { status: "queued" };
    respostaNoProximo = null;
    return Response.json({ id, ...resposta });
  }
  if (/^\/v1\/message\/[^/]+\/status$/.test(u.pathname)) return Response.json({ id: u.pathname.split("/")[3], status: statusMensagem });
  const inst = /^\/v1\/instance\/([^/]+)\/status$/.exec(u.pathname)?.[1];
  if (inst) return Response.json({ name: inst, status: inst.includes("desconectada") ? "disconnected" : "connected", phone: CFG.numero });
  return new Response("rota não simulada", { status: 500 });
}) as typeof fetch;
const posts = () => chamadas.filter((c) => c.caminho === "POST /v1/message/send-text" || c.caminho === "POST /v1/message/send-template");

/** Um lead pronto para a fila: site com nota, CRM no funil e opt-in na conversa do número de prospecção. */
const lead = async (i: number, o: { tenant?: Record<string, unknown>; crm?: Record<string, unknown>; conversa?: Record<string, unknown>; fone?: string } = {}) => {
  await db.doc(`tenants/${SLUGS[i]}`).set({ name: `Salão F5 ${i}`, site: { rating: 4.8, reviews: 120 }, gerado: { sub: "salao" }, ...o.tenant });
  await db.doc(`crm/${SLUGS[i]}`).set({ estagio: "novo", telefone: o.fone ?? FONES[i], ...o.crm });
  await db.doc(`prospeccaoConversas/${o.fone ?? FONES[i]}`).set({ slug: SLUGS[i], optinEm: 1, identificadoEm: 1, ...o.conversa });
};
/** Um item pendente direto na fila (create). */
const item = async (i: number, agendadoPara: number, extra: Record<string, unknown> = {}) => {
  const dados = ItemFila.parse({ status: "pendente", slug: SLUGS[i], etapa: "primeiro", telefoneNorm: FONES[i], varianteId: "salao-primeiro-elogio-google", texto: `Oi! Teste ${i}. Responda PARE para sair.`, agendadoPara, tentativas: 0, criadoEm: agendadoPara - 3_600_000, crmEnvioId: randomUUID(), templateParametros: [`Salão F5 ${i}`], ...extra });
  const ref = db.doc(`${FILA}/${SLUGS[i]}__${dados.etapa}`);
  await ref.create({ ...dados, ...extra });
  return ref;
};
/** Um item já enviado (fixture no schema): conta no limite por destinatário. */
const jaEnviado = (id: string, fone: string, enviadoEm: number) =>
  db.doc(`${FILA}/${id}`).create(ItemFila.parse({ status: "enviado", slug: "outro", etapa: "primeiro", telefoneNorm: fone, varianteId: "salao-primeiro-elogio-google", texto: "Oi! Responda PARE para sair.", agendadoPara: enviadoEm, tentativas: 1, criadoEm: enviadoEm, crmEnvioId: randomUUID(), enviadoEm, envioId: randomUUID() }));
const lido = async (ref: FirebaseFirestore.DocumentReference) => (await ref.get()).data() ?? {};
const ESP = LIMITES_FILA.espacamentoPadraoMs;

await limpar();
await db.doc("config/prospeccao").set(CFG);

// ————— 5.2 produtor —————
for (const i of [0, 1, 2, 3, 4]) await lead(i);
await lead(5, { tenant: { site: {} } }); // sem nota
await lead(6, { conversa: { naoContatarEm: 1 } }); // PARE no número de prospecção
await lead(7, { crm: { estagio: "fechado" } });
await lead(8, { fone: "551132000208" }); // fixo: não é celular
await lead(9, { conversa: { optinEm: null } }); // sem opt-in: não entra (permissão da F3)
const p1 = await produzir(db, { agora: t(QUA, "07:00"), aleatorio: prng(1) });
assert.equal(p1.criados, 2, `cota do dia (2): ${JSON.stringify(p1)}`);
await db.doc("config/prospeccao").set({ ...CFG, cotaDiaria: 10 });
const p2 = await produzir(db, { agora: t(QUA, "07:00"), aleatorio: prng(1) });
assert.equal(p2.criados, 3, JSON.stringify(p2));
assert.equal(p2.ignorados.telefone_na_fila, 2, "dedupe por telefone: os de antes já estão na fila");
assert.equal(p2.ignorados.sem_nota, 1);
assert.equal(p2.ignorados.nao_contatar, 1);
assert.equal(p2.ignorados.fora_do_funil, 1);
assert.equal(p2.ignorados.sem_celular, 1);
const fila = (await db.collection(FILA).get()).docs.map((d) => ItemFila.parse(d.data()));
assert.equal(fila.length, 5);
assert.ok(fila.every((x) => x.status === "pendente" && x.etapa === "primeiro" && /\bPARE\b/.test(x.texto) && x.texto.includes("4,8 ★") && naJanela(x.agendadoPara)), "pendentes, com PARE e a nota, na janela");
assert.equal(new Set(fila.map((x) => x.telefoneNorm)).size, 5);
const p3 = await produzir(db, { agora: t(QUA, "07:00") });
assert.equal(p3.criados, 0, "segunda rodada não cria nada");
// create duplicado falha (ALREADY_EXISTS), sem sobrescrever
const ref0 = db.doc(`${FILA}/${SLUGS[0]}__primeiro`);
const antes0 = await lido(ref0);
await assert.rejects(ref0.create({ ...antes0, texto: "outro" }), (e: { code?: number }) => e.code === 6);
assert.equal((await lido(ref0)).texto, antes0.texto);
assert.equal(posts().length, 0, "o produtor não envia");
// a cota desconta o que ainda está aberto (de outro dia, reagendado ou reservado)
await novaRodada({ ...CFG, cotaDiaria: 3 });
await item(5, T);
await item(6, T);
assert.equal((await produzir(db, { agora: t(QUA, "07:00"), aleatorio: prng(1) })).criados, 1, "3 de cota - 2 abertos");
// dois produtores em paralelo: um item por telefone
await novaRodada({ ...CFG, cotaDiaria: 10 });
const par = await Promise.all([1, 2].map(() => produzir(db, { agora: t(QUA, "07:00"), aleatorio: prng(1) })));
const filaPar = (await db.collection(FILA).get()).docs.map((d) => String(d.get("telefoneNorm")));
assert.equal(filaPar.length, 5, JSON.stringify(par));
assert.equal(new Set(filaPar).size, 5, "nenhum telefone com dois itens");
assert.equal(par[0].criados + par[1].criados, 5);
// HIGH-2 (revisão do núcleo): salão no primeiro contato leva a variante do A/B da F1 (varianteAB); outro
// nicho segue escolherVariante (amostra zero: a primeira ativa do nicho)
await novaRodada({ ...CFG, cotaDiaria: 10 });
await lead(10, { tenant: { gerado: { sub: "barbearia" } } });
await produzir(db, { agora: t(QUA, "07:00"), aleatorio: prng(3) });
const variantePorSlug = Object.fromEntries((await db.collection(FILA).get()).docs.map((d) => [String(d.get("slug")), String(d.get("varianteId"))]));
for (const i of [0, 1, 2, 3, 4]) assert.equal(variantePorSlug[SLUGS[i]], varianteAB(SLUGS[i]).id, `salão ${i}: a do A/B`);
assert.equal(variantePorSlug[SLUGS[10]], escolherVariante({ nicho: "barbearia", recebidas: [] }, "primeiro", {}, () => 0).variante?.id, "barbearia: escolherVariante");
assert.ok(!VARIANTES_F1.some((v) => v.id === variantePorSlug[SLUGS[10]]));
await db.doc(`prospeccaoConversas/${FONES[10]}`).delete();
console.log("produtor: ok");

// ————— 5.3 dois consumidores em paralelo: cota e espaçamento —————
await novaRodada();
for (const i of [0, 1, 2]) await item(i, T - 60_000 + i);
const juntos = await Promise.all([1, 2, 3, 4].map(() => consumirUm(db, { agora: T })));
assert.equal(juntos.filter((r) => r === "enviado").length, 1, `um só sai no mesmo minuto: ${juntos}`);
assert.ok(juntos.filter((r) => r !== "enviado").every((r) => r === "espacamento"), String(juntos));
assert.equal(posts().length, 1);
assert.equal(posts()[0].corpo.category, "marketing");
assert.equal(posts()[0].corpo.replyToInbound, undefined, "envio ativo, não resposta");
const depois = await Promise.all([1, 2, 3].map(() => consumirUm(db, { agora: T + ESP })));
assert.equal(depois.filter((r) => r === "enviado").length, 1, String(depois));
// cota do dia (2) acabou: nem com o espaçamento cumprido
const fim = await Promise.all([1, 2].map(() => consumirUm(db, { agora: T + 2 * ESP })));
assert.deepEqual(fim, ["cota", "cota"]);
assert.equal(posts().length, 2);
assert.equal((await lido(db.doc("config/prospeccao"))).enviadosHoje.n, 2);
const enviados = (await db.collection(FILA).where("status", "==", "enviado").get()).docs;
assert.equal(enviados.length, 2);
assert.equal(new Set(posts().map((p) => p.chave)).size, 2, "uma chave por item");
// o toque foi registrado no CRM com a variante escolhida
assert.equal((await lido(db.doc(`crm/${enviados[0].get("slug")}`))).toques, 1);
console.log("paralelo: ok");

// ————— 5.3.3 leaseToken antigo não conclui —————
await novaRodada();
await item(0, T - 60_000);
const r1 = await reservar(db, T);
assert.ok(typeof r1 !== "string");
// a execução 1 travou; o lease venceu e outra execução retomou o item
const r2 = await reservar(db, T + Math.max(LIMITES_FILA.leaseMs, ESP) + 1);
assert.ok(typeof r2 !== "string" && r2.token !== r1.token);
assert.equal(await concluir(db, r1.ref, r1.token, { status: "enviado", enviadoEm: T, envioId: "x" }), false, "token antigo não conclui");
assert.equal((await lido(r1.ref)).status, "reservado");
assert.equal(await concluir(db, r2.ref, r2.token, { status: "enviado", enviadoEm: T, envioId: "y" }), true);
assert.equal((await lido(r1.ref)).envioId, "y");
assert.equal((await lido(db.doc("config/prospeccao"))).enviadosHoje.n, 1, "a retomada não gasta cota");
console.log("lease: ok");

// ————— 5.4 timeout: reconcilia sem reenviar —————
await novaRodada();
const refT = await item(1, T - 60_000);
prazoNoProximo = true;
assert.equal(await consumirUm(db, { agora: T }), "incerto");
assert.equal((await lido(refT)).status, "reservado");
assert.ok((await lido(refT)).incertoEm);
// antes do lease vencer, ninguém mexe
assert.equal(await consumirUm(db, { agora: T + 60_000 }), "nada");
assert.equal(await consumirUm(db, { agora: T + LIMITES_FILA.leaseMs + ESP }), "enviado");
const [pa, pb] = posts();
assert.equal(posts().length, 2, "o POST repetido...");
assert.equal(pa.chave, pb.chave, "...com a mesma chave");
assert.deepEqual(pa.corpo, pb.corpo, "...e o mesmo payload");
assert.equal(new Set(posts().map((p) => porChave.get(p.chave!))).size, 1, "uma mensagem só no atendys");
assert.equal((await lido(refT)).envioId, porChave.get(pa.chave!));
assert.equal((await lido(db.doc("config/prospeccao"))).enviadosHoje.n, 1, "a reconciliação não gasta cota");
assert.equal((await lido(db.doc(`prospeccaoDias/${QUA}`))).enviadas, 1, "prospeccaoDias conta o item uma vez");
assert.equal(pa.chave, chaveDeEnvio("prospeccao-fila", refT.id, String((await lido(refT)).crmEnvioId)), "chave com o crmEnvioId do item");
// timeout de novo até tentativasMax: falhou (talvez enviado), sem POST novo
await novaRodada();
const rT3 = await item(2, T - 60_000);
let quando = T;
for (let k = 0; k < LIMITES_FILA.tentativasMax; k++) {
  prazoNoProximo = true;
  assert.equal(await consumirUm(db, { agora: quando }), "incerto");
  quando += LIMITES_FILA.leaseMs + ESP;
}
assert.equal(posts().length, LIMITES_FILA.tentativasMax);
assert.equal(await consumirUm(db, { agora: quando }), "falhou");
assert.equal((await lido(rT3)).status, "falhou");
assert.equal((await lido(rT3)).talvezEnviado, true);
assert.equal(posts().length, LIMITES_FILA.tentativasMax, "sem POST novo");
assert.equal((await lido(db.doc(`prospeccaoDias/${QUA}`))).enviadas, undefined, "nada confirmado, nada contado");
// IDEMPOTENCY_CONFLICT (409 pelo conteúdo): pode ter saído, fica incerto
await novaRodada();
const rIc = await item(2, T - 60_000);
recusaNoProximo = { status: 409, code: "IDEMPOTENCY_CONFLICT" };
assert.equal(await consumirUm(db, { agora: T }), "incerto");
assert.equal((await lido(rIc)).status, "reservado");
assert.ok((await lido(rIc)).incertoEm);
// envio incerto e depois PARE: a retomada não reenvia nem grava cancelado limpo
await novaRodada();
const rP = await item(1, T - 60_000);
prazoNoProximo = true;
assert.equal(await consumirUm(db, { agora: T }), "incerto");
const chaveP = posts()[0].chave;
assert.equal(await atenderProspeccao(db, CFG, { messageId: "f5-pare-incerto", phone: FONES[1], type: "text", text: "PARE" }, { agora: T + 1_000 }), "optout");
assert.equal((await lido(rP)).status, "reservado", "o PARE não mexe no reservado");
assert.equal(await consumirUm(db, { agora: T + LIMITES_FILA.leaseMs + ESP }), "cancelado");
assert.equal((await lido(rP)).status, "cancelado");
assert.equal((await lido(rP)).talvezEnviado, true, "cancelado com talvezEnviado");
assert.equal(posts().filter((p) => p.chave === chaveP).length, 1, "não reenviou");
console.log("timeout: ok");

// ————— 5.4 atrasados não saem em rajada —————
await novaRodada({ ...CFG, cotaDiaria: 50 });
for (const i of [0, 1, 2, 3, 4]) await item(i, T - 3 * 3_600_000 + i);
assert.equal(await consumirUm(db, { agora: T }), "nada", "nenhum atrasado sai agora");
const reag = (await db.collection(FILA).get()).docs.map((d) => d.data());
assert.ok(reag.every((x) => x.status === "reagendado" && x.agendadoPara > T && naJanela(x.agendadoPara)), JSON.stringify(reag.map((x) => [x.status, x.agendadoPara])));
assert.equal(new Set(reag.map((x) => x.agendadoPara)).size, 5, "espalhados");
assert.equal(posts().length, 0);
// o primeiro reagendado sai na sua hora, um por vez
const primeiroReag = Math.min(...reag.map((x) => x.agendadoPara));
assert.equal(await consumirUm(db, { agora: primeiroReag }), "enviado");
assert.equal(posts().length, 1);
console.log("atrasados: ok");

// ————— 5.4 cancelamento: opt-out, resposta, naoContatarEm, disjuntor —————
await novaRodada();
const rOpt = await item(3, T + 3_600_000);
const rOutro = await item(4, T + 3_600_000);
assert.equal(await atenderProspeccao(db, CFG, { messageId: "f5-pare", phone: FONES[3], type: "text", text: "PARE" }, { agora: T }), "optout");
assert.equal((await lido(rOpt)).status, "cancelado");
assert.equal((await lido(rOpt)).motivo, "optout");
assert.equal((await lido(rOutro)).status, "pendente", "o outro telefone segue");
// resposta do lead (agente desligado: nada sai e a IA não é chamada) também cancela
assert.equal(await atenderProspeccao(db, { ...CFG, ativo: false }, { messageId: "f5-oi", phone: FONES[4], type: "text", text: "oi, tudo bem?" }, { agora: T }), "desligado");
assert.equal((await lido(rOutro)).motivo, "resposta");
// naoContatarEm no CRM depois de criado: conferido no envio, não sai
await novaRodada();
const rCrm = await item(5, T - 60_000);
await db.doc(`crm/${SLUGS[5]}`).set({ naoContatarEm: new Date() }, { merge: true });
assert.equal(await consumirUm(db, { agora: T }), "cancelado");
assert.equal((await lido(rCrm)).motivo, "naoContatar");
assert.equal(posts().length, 0);
// disjuntor ou à mão: desligado, nada sai e nada é cancelado; religado, sai sem item duplicado
await novaRodada({ ...CFG, ativo: false, desligadoEm: new Date(), motivoDesligamento: "opt-out + bloqueio acima de 2%" });
const rDesl = await item(0, T - 60_000);
assert.equal(await consumirUm(db, { agora: T }), "desligado");
assert.equal((await lido(rDesl)).status, "pendente", "o disjuntor não cancela");
await db.doc("config/prospeccao").set({ ...CFG, ativo: false });
assert.equal(await consumirUm(db, { agora: T }), "desligado");
assert.equal((await lido(rDesl)).status, "pendente", "desligado à mão não cancela");
// desligado entre o início da execução e a reserva: a transação relê e não reserva
assert.equal(await reservar(db, T), "desligado");
assert.equal((await lido(rDesl)).status, "pendente");
assert.equal(posts().length, 0);
await db.doc("config/prospeccao").set(CFG);
const pRel = await produzir(db, { agora: T, aleatorio: prng(1) });
assert.ok((pRel.ignorados.telefone_na_fila ?? 0) >= 1, JSON.stringify(pRel));
assert.equal((await db.collection(FILA).where("telefoneNorm", "==", FONES[0]).get()).size, 1, "religado: o produtor não duplica");
assert.equal(await consumirUm(db, { agora: T }), "enviado");
assert.equal((await lido(rDesl)).status, "enviado");
console.log("cancelamento: ok");

// ————— limites por destinatário e janela —————
await novaRodada({ ...CFG, cotaDiaria: 50 });
for (const e of ["lembrete", "ultima"]) await jaEnviado(`outro-${e}`, FONES[6], T - 3_600_000);
await jaEnviado("outro-3", FONES[6], T - 7_200_000);
const rLim = await item(6, T - 60_000);
assert.equal(await consumirUm(db, { agora: T }), "adiado", "3 no dia para o mesmo telefone");
assert.equal((await lido(rLim)).status, "reagendado");
assert.ok((await lido(rLim)).agendadoPara > T + 12 * 3_600_000, "para o dia seguinte");
assert.equal(await consumirUm(db, { agora: t("2026-11-21", "10:00") }), "fora_da_janela");
// 10 na semana, 1 só nas últimas 24 h: adiado pelo limite semanal
await novaRodada({ ...CFG, cotaDiaria: 50 });
for (let k = 0; k < LIMITES_FILA.porDestinatarioSemana; k++) await jaEnviado(`semana-${k}`, FONES[8], T - (k + 1) * 14 * 3_600_000);
const rSem = await item(8, T - 60_000);
assert.equal(await consumirUm(db, { agora: T }), "adiado", "10 na semana para o mesmo telefone");
assert.equal((await lido(rSem)).status, "reagendado");
assert.equal(posts().length, 0);
// mais de 50 atrasados: o reagendamento pega 50 e a reserva não pega o resto (nada sai com mais de 2 h)
await novaRodada({ ...CFG, cotaDiaria: 50 });
await Promise.all(
  Array.from({ length: 51 }, (_, k) =>
    db.doc(`${FILA}/atrasado-${k}`).create(ItemFila.parse({ status: "pendente", slug: `atrasado-${k}`, etapa: "primeiro", telefoneNorm: `55119000030${String(k).padStart(2, "0")}`, varianteId: "salao-primeiro-elogio-google", texto: "Oi! Responda PARE para sair.", agendadoPara: T - 3 * 3_600_000 - k, tentativas: 0, criadoEm: T - 5 * 3_600_000, crmEnvioId: randomUUID() })),
  ),
);
assert.equal(await consumirUm(db, { agora: T }), "nada");
const atrasados = (await db.collection(FILA).get()).docs.map((d) => String(d.get("status")));
assert.equal(atrasados.filter((x) => x === "reagendado").length, 50);
assert.equal(atrasados.filter((x) => x === "pendente").length, 1, "o 51º espera a próxima execução");
assert.equal(posts().length, 0);
// item fora do schema vai a falhou e não trava a fila
await novaRodada();
await db.doc(`${FILA}/torto`).create({ status: "pendente", agendadoPara: T - 120_000, telefoneNorm: "x" });
const rDepois = await item(2, T - 60_000);
assert.equal(await consumirUm(db, { agora: T }), "falhou");
assert.deepEqual([(await lido(db.doc(`${FILA}/torto`))).status, (await lido(db.doc(`${FILA}/torto`))).erro], ["falhou", "schema"]);
assert.equal(await consumirUm(db, { agora: T + ESP }), "enviado");
assert.equal((await lido(rDepois)).status, "enviado");
console.log("limites: ok");

// ————— instância 1726 recusada pelo consumidor —————
await novaRodada({ ...CFG, instancia: "ruphus-plataforma-cloud-1726" });
const r1726 = await item(7, T - 60_000);
assert.equal(await consumirUm(db, { agora: T }), "recusada");
assert.equal((await lido(r1726)).status, "pendente", "não reservou nem gastou tentativa");
assert.equal(posts().length, 0, "nenhum POST");
assert.equal((await lido(db.doc("config/prospeccao"))).enviadosHoje, undefined, "não gastou cota");
console.log("1726: ok");

// ————— instância desconectada: recusa de canal, nunca falhou —————
// 409 no envio (desconectou entre a trava e o POST): volta a pendente, sem gastar tentativa nem cota
await novaRodada();
const r409 = await item(9, T - 60_000);
recusaNoProximo = { status: 409, code: "INSTANCE_DISCONNECTED" };
assert.equal(await consumirUm(db, { agora: T }), "recusada");
const d409 = await lido(r409);
assert.deepEqual([d409.status, d409.tentativas, d409.leaseToken], ["pendente", 0, undefined]);
assert.equal((await lido(db.doc("config/prospeccao"))).enviadosHoje.n, 0, "não consumiu cota");
// desconectada já na trava: nada é reservado
await novaRodada({ ...CFG, instancia: "ruphus-prospeccao-desconectada" });
const rDesc = await item(9, T - 60_000);
assert.equal(await consumirUm(db, { agora: T }), "recusada");
assert.equal((await lido(rDesc)).status, "pendente");
assert.equal((await lido(db.doc("config/prospeccao"))).enviadosHoje, undefined);
assert.equal(posts().length, 0);
console.log("desconectada: ok");

// ————— PARE marcado no CRM também cancela a fila dos telefones do negócio —————
await novaRodada();
const rCrmPare = await item(0, T + 3_600_000);
await marcarContato(db, SLUGS[0], "parar", "admin");
assert.deepEqual([(await lido(rCrmPare)).status, (await lido(rCrmPare)).motivo], ["cancelado", "optout"]);
console.log("crm parar: ok");

// ————— cadência: o lembrete espera os dias do primeiro; toque por fora cancela o item —————
const DIA = 86_400_000;
const L = 11;
await novaRodada({ ...CFG, cotaDiaria: 10 });
await lead(L);
const primeiroEm = (em: number) => ({ toques: 1, ultimoEnvio: { id: "f5-primeiro", varianteId: null, textoEnviado: "Oi! Responda PARE para sair.", etapa: "primeiro", em }, ultimoContatoEm: Timestamp.fromMillis(em) });
const refLemb = db.doc(`${FILA}/${SLUGS[L]}__lembrete`);
await db.doc(`crm/${SLUGS[L]}`).set(primeiroEm(T - DIA), { merge: true });
const pOntem = await produzir(db, { agora: T, aleatorio: prng(1) });
assert.equal((await refLemb.get()).exists, false, "primeiro enviado ontem: sem lembrete hoje");
assert.ok((pOntem.ignorados.cadencia ?? 0) >= 1, JSON.stringify(pOntem));
// a proximaData combinada no futuro também segura
await db.doc(`crm/${SLUGS[L]}`).set({ ...primeiroEm(T - 4 * DIA), proximaData: "2026-11-25" }, { merge: true });
await produzir(db, { agora: T, aleatorio: prng(1) });
assert.equal((await refLemb.get()).exists, false, "proximaData no futuro: nada");
// 4 dias depois do primeiro (a cadência pede 3): sai o lembrete, com os toques lidos na criação
await db.doc(`crm/${SLUGS[L]}`).set({ proximaData: FieldValue.delete() }, { merge: true });
await produzir(db, { agora: T, aleatorio: prng(1) });
const lemb = await lido(refLemb);
assert.deepEqual([lemb.status, lemb.etapa, lemb.toques], ["pendente", "lembrete", 1]);
for (const d of (await db.collection(FILA).get()).docs) if (d.id !== refLemb.id) await d.ref.delete();
// toque manual (gaveta) depois que o item nasceu: o item não sai
await registrarMensagem(db, SLUGS[L], "Lembrete", FONES[L], "admin", { envioId: randomUUID(), textoEnviado: "Oi! Responda PARE para sair.", editado: false }, T);
assert.equal(await consumirUm(db, { agora: lemb.agendadoPara }), "cancelado");
assert.equal((await lido(refLemb)).motivo, "cadencia");
assert.equal(posts().length, 0);
console.log("cadência: ok");

// ————— credencial recusada (403 FORBIDDEN, 401): recusa do canal, o item não queima —————
for (const recusa of [{ status: 403, code: "FORBIDDEN" }, { status: 401, code: "INVALID_API_KEY" }]) {
  await novaRodada();
  const rCred = await item(9, T - 60_000);
  recusaNoProximo = recusa;
  assert.equal(await consumirUm(db, { agora: T }), "recusada", recusa.code);
  const dCred = await lido(rCred);
  assert.deepEqual([dCred.status, dCred.tentativas], ["pendente", 0], recusa.code);
  assert.equal((await lido(db.doc("config/prospeccao"))).enviadosHoje.n, 0, "a cota volta");
}
// timeout e depois um erro definitivo na retomada: falhou com talvezEnviado
await novaRodada();
const rDef = await item(9, T - 60_000);
prazoNoProximo = true;
assert.equal(await consumirUm(db, { agora: T }), "incerto");
recusaNoProximo = { status: 403, code: "OPT_OUT", mesmoComChave: true };
assert.equal(await consumirUm(db, { agora: T + LIMITES_FILA.leaseMs + ESP }), "falhou");
assert.deepEqual([(await lido(rDef)).status, (await lido(rDef)).talvezEnviado], ["falhou", true]);
console.log("recusas: ok");

// ————— 2xx sem sair agora (queued com retryAt): o CRM espera o status da mensagem —————
await novaRodada();
const rRetry = await item(9, T - 60_000);
const toquesDe9 = async () => Number((await lido(db.doc(`crm/${SLUGS[9]}`))).toques ?? 0);
const toques9 = await toquesDe9();
respostaNoProximo = { status: "queued", retryAt: new Date(T + 3_600_000).toISOString() };
assert.equal(await consumirUm(db, { agora: T }), "enviado");
let dRetry = await lido(rRetry);
assert.deepEqual([dRetry.status, dRetry.crmPendente, dRetry.aguardaStatus], ["enviado", true, true]);
assert.equal(await toquesDe9(), toques9, "o toque não entra antes do status");
assert.equal((await lido(db.doc(`prospeccaoDias/${QUA}`))).enviadas, undefined);
statusMensagem = "queued";
assert.equal(await consumirUm(db, { agora: T + ESP }), "nada");
assert.equal((await lido(rRetry)).crmPendente, true, "ainda na fila do atendys");
statusMensagem = "sent";
assert.equal(await consumirUm(db, { agora: T + 2 * ESP }), "nada");
dRetry = await lido(rRetry);
assert.deepEqual([dRetry.crmPendente, dRetry.aguardaStatus], [undefined, undefined]);
assert.equal(await toquesDe9(), toques9 + 1, "saiu: o toque entrou");
assert.equal((await lido(db.doc(`prospeccaoDias/${QUA}`))).enviadas, 1);
// adiada que acaba failed: o item vira falhou e o CRM não conta
await novaRodada();
const rManual = await item(7, T - 60_000, {});
await db.doc(`crm/${SLUGS[7]}`).set({ estagio: "novo" }, { merge: true });
respostaNoProximo = { status: "queued", retryAt: new Date(T + 3_600_000).toISOString() };
assert.equal(await consumirUm(db, { agora: T }), "enviado");
statusMensagem = "failed";
await consumirUm(db, { agora: T + ESP });
assert.deepEqual([(await lido(rManual)).status, (await lido(rManual)).erro, (await lido(rManual)).crmPendente], ["falhou", "atendys: failed", undefined]);
statusMensagem = "queued";
console.log("aguarda status: ok");

// ————— o CRM falha depois do envio: crmPendente, e a próxima execução registra o toque —————
await novaRodada();
const rCrmF = await item(8, T - 60_000);
const rtReal = db.runTransaction.bind(db) as (...a: unknown[]) => Promise<unknown>;
const crmFora = new Proxy(db, {
  get(alvo, k) {
    if (k === "runTransaction") return (...a: unknown[]) => ((new Error().stack ?? "").includes("registrarMensagem") ? Promise.reject(new Error("firestore fora do ar")) : rtReal(...a));
    const v = Reflect.get(alvo, k);
    return typeof v === "function" ? v.bind(alvo) : v;
  },
});
const toques8 = Number((await lido(db.doc(`crm/${SLUGS[8]}`))).toques ?? 0);
assert.equal(await consumirUm(crmFora, { agora: T }), "enviado");
assert.deepEqual([(await lido(rCrmF)).status, (await lido(rCrmF)).crmPendente], ["enviado", true]);
assert.equal(Number((await lido(db.doc(`crm/${SLUGS[8]}`))).toques ?? 0), toques8);
assert.equal(await consumirUm(db, { agora: T + ESP }), "nada");
assert.equal((await lido(rCrmF)).crmPendente, undefined);
assert.equal(Number((await lido(db.doc(`crm/${SLUGS[8]}`))).toques ?? 0), toques8 + 1, "o lead não fica preso na etapa");
console.log("crm pendente: ok");

// ————— M-2 (terceira rodada): um item preso (queued sem fim) não ocupa a vaga dos outros —————
await novaRodada();
{
  const enviado = (id: string, i: number, extra: Record<string, unknown>) =>
    db.doc(`${FILA}/${id}`).create(ItemFila.parse({ status: "enviado", slug: SLUGS[i], etapa: "primeiro", telefoneNorm: FONES[i], varianteId: "salao-primeiro-elogio-google", texto: "Oi! Responda PARE para sair.", agendadoPara: T - 60_000, tentativas: 1, criadoEm: T - 60_000, crmEnvioId: randomUUID(), enviadoEm: T - 60_000, envioId: randomUUID(), crmPendente: true, ...extra }));
  // o preso é o mais antigo (vem primeiro na ordem); o outro só espera o CRM
  await enviado("preso", 6, { aguardaStatus: true, reconciliarApos: T - 60_000 });
  await enviado("bom", 5, { reconciliarApos: T - 30_000 });
  const cfg = CFG;
  await db.doc(`crm/${SLUGS[5]}`).set({ estagio: "novo", toques: 0, naoContatarEm: FieldValue.delete() }, { merge: true });
  const toques5 = 0;
  statusMensagem = "queued";
  await reconciliarCrm(db, cfg, T, 1);
  assert.equal((await lido(db.doc(`${FILA}/preso`))).tentativasCrm, 1, "o preso passou uma vez");
  assert.equal((await lido(db.doc(`${FILA}/bom`))).crmPendente, true, "vaga única: o bom espera a vez");
  await reconciliarCrm(db, cfg, T + 1_000, 1);
  assert.equal((await lido(db.doc(`${FILA}/bom`))).crmPendente, undefined, "o preso foi para o fim: o bom entrou");
  assert.equal(Number((await lido(db.doc(`crm/${SLUGS[5]}`))).toques ?? 0), toques5 + 1);
  // passagens até o limite: o preso sai da reconciliação com crmErro
  let agora = T;
  for (let i = 0; i < 25 && (await lido(db.doc(`${FILA}/preso`))).crmPendente; i++) {
    agora += 6 * 3_600_000 + 1;
    await reconciliarCrm(db, cfg, agora, 1);
  }
  const preso = await lido(db.doc(`${FILA}/preso`));
  assert.deepEqual([preso.status, preso.crmPendente, preso.aguardaStatus], ["enviado", undefined, undefined]);
  assert.match(String(preso.crmErro), /reconciliação esgotada \(20 de 20/);
  statusMensagem = "queued";
}
console.log("reconciliação sem preso: ok");

// ————— limite por destinatário conta falhou/cancelado com talvezEnviado —————
const fechado = (id: string, fone: string, status: "falhou" | "cancelado", em: number, talvezEnviado: boolean) =>
  db.doc(`${FILA}/${id}`).create(ItemFila.parse({ status, slug: "outro", etapa: "primeiro", telefoneNorm: fone, varianteId: "salao-primeiro-elogio-google", texto: "Oi! Responda PARE para sair.", agendadoPara: em, tentativas: 1, criadoEm: em, crmEnvioId: randomUUID(), ...(status === "falhou" ? { falhouEm: em, erro: "x" } : { canceladoEm: em, motivo: "optout" }), ...(talvezEnviado && { talvezEnviado }) }));
await novaRodada({ ...CFG, cotaDiaria: 50 });
await fechado("talvez-1", FONES[2], "falhou", T - 3_600_000, true);
await fechado("talvez-2", FONES[2], "cancelado", T - 7_200_000, true);
await fechado("limpo-3", FONES[2], "cancelado", T - 7_200_000, false);
await item(2, T - 60_000);
assert.equal(typeof (await reservar(db, T)), "object", "2 talvez + 1 limpo: abaixo de 3 no dia");
await novaRodada({ ...CFG, cotaDiaria: 50 });
for (const k of [1, 2, 3]) await fechado(`talvez-${k}`, FONES[2], k === 3 ? "cancelado" : "falhou", T - k * 3_600_000, true);
const rTalvez = await item(2, T - 60_000);
assert.equal(await consumirUm(db, { agora: T }), "adiado", "3 talvez enviados no dia");
assert.equal((await lido(rTalvez)).status, "reagendado");
assert.equal(posts().length, 0);
console.log("limite talvez: ok");

// ————— variante pausada entre a leitura da biblioteca e o create: o item não nasce —————
await novaRodada({ ...CFG, cotaDiaria: 10 });
await semear(db);
await lead(10, { tenant: { gerado: { sub: "barbearia" } } });
const barbearia = (await db.collection("prospeccaoVariantes").where("nicho", "==", "barbearia").get()).docs.filter((d) => d.get("etapa") === "primeiro");
assert.ok(barbearia.length > 0);
const pausaNoMeio = new Proxy(db, {
  get(alvo, k) {
    if (k === "runTransaction")
      return async (...a: unknown[]) => {
        await Promise.all(barbearia.map((d) => d.ref.update({ status: "pausada" })));
        return rtReal(...a);
      };
    const v = Reflect.get(alvo, k);
    return typeof v === "function" ? v.bind(alvo) : v;
  },
});
const pPausa = await produzir(pausaNoMeio, { agora: T, aleatorio: prng(1) });
assert.equal((await db.doc(`${FILA}/${SLUGS[10]}__primeiro`).get()).exists, false, "pausada no meio: não sai");
assert.ok((pPausa.ignorados.variante_pausada ?? 0) >= 1, JSON.stringify(pPausa));
console.log("pausa concorrente: ok");

// ————— janela de 24 h da Meta (Cloud API): fora dela só template —————
// sem template válido (o torto é recusado): não sai, reagendado com sem_template, sem gastar cota nem tentativa
await novaRodada({ ...CFG, templates: { primeiro: { nome: "Torto Com Espaço", idioma: "pt_BR" } } });
await lead(11);
const refJ = await item(11, T - 60_000);
assert.equal(await consumirUm(db, { agora: T }), "sem_template");
assert.equal(posts().length, 0, "fora da janela sem template: nenhum POST");
const semTpl = await lido(refJ);
assert.equal(semTpl.status, "reagendado");
assert.equal(semTpl.motivo, "sem_template");
assert.equal(semTpl.tentativas, 0);
assert.ok(semTpl.agendadoPara > T + 12 * 3_600_000 && naJanela(semTpl.agendadoPara), "próximo dia útil, na janela");
assert.equal((await lido(db.doc("config/prospeccao"))).enviadosHoje.n, 0, "a cota voltou");
// com template: send-template com nome, idioma, as variáveis e a categoria marketing; o item guarda o template
await novaRodada();
await lead(11);
const refK = await item(11, T - 60_000);
assert.equal(await consumirUm(db, { agora: T }), "enviado");
assert.equal(posts().length, 1);
const pk = posts()[0];
assert.equal(pk.caminho, "POST /v1/message/send-template");
assert.equal(pk.corpo.name, "ruphus_primeiro");
assert.equal(pk.corpo.language, "pt_BR");
assert.equal(pk.corpo.category, "marketing");
assert.equal(pk.corpo.text, undefined, "nada de texto livre");
assert.deepEqual(pk.corpo.components, [{ type: "body", parameters: [{ type: "text", text: "Salão F5 11" }] }]);
const comTpl = await lido(refK);
assert.equal(comTpl.status, "enviado");
assert.equal(comTpl.templateNome, "ruphus_primeiro");
assert.equal(comTpl.templateIdioma, "pt_BR");
assert.equal(comTpl.motivo, undefined);
assert.equal((await lido(db.doc(`crm/${SLUGS[11]}`))).ultimoEnvio?.textoEnviado, "[ruphus_primeiro] Salão F5 11");
// dentro da janela (o lead escreveu há 2 h, antes de o item nascer): texto livre, como antes
await novaRodada();
await lead(11);
const refL = await item(11, T - 60_000);
await db.doc(`prospeccaoConversas/${FONES[11]}/recebidas/janela-f5`).set({ texto: "oi", tipo: "text", em: T - 2 * 3_600_000 });
assert.equal(await consumirUm(db, { agora: T }), "enviado");
assert.equal(posts().length, 1);
assert.equal(posts()[0].caminho, "POST /v1/message/send-text");
assert.equal(posts()[0].corpo.text, (await lido(refL)).texto);
assert.equal((await lido(refL)).templateNome, undefined);
await db.recursiveDelete(db.doc(`prospeccaoConversas/${FONES[11]}`));
chamadas.length = 0;
console.log("janela da Meta: ok");

// ————— as rotas do cron sem o Bearer: 401 —————
process.env.CRON_SECRET = "segredo-cron-f5";
const { GET: consumidor } = await import("@/app/api/cron/prospeccao/route");
const { GET: produtor } = await import("@/app/api/cron/prospeccao-produtor/route");
for (const get of [consumidor, produtor]) {
  for (const headers of [{}, { authorization: "Bearer errado" }, { authorization: "segredo-cron-f5" }] as Record<string, string>[]) {
    const res = await get(new Request("http://localhost/api/cron/prospeccao", { headers }) as Parameters<typeof get>[0]);
    assert.equal(res.status, 401);
  }
}
assert.equal(posts().length, 0);
console.log("rotas: ok");

assert.equal(foraDoAtendys, 0, "nenhuma chamada fora do atendys simulado");
await limpar();
console.log("prospeccao-f5: ok");
process.exit(0);
