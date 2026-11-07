// Rode: npm run test:booking  (lógica de horários + reservas no emulador do Firestore)
import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { verifyFirebaseToken } from "@/lib/verify-token";
import { agendaDias, availableSlots, book, createPlan, deleteCustomer, endPlan, LIMITS, loadCatalog, redeDoIp, renameCustomer, requireMember, reschedule, rescheduleSlots, salvarDadosCliente } from "@/lib/booking.server";
import { DadosCliente } from "@/lib/cliente-dados";
import { addDays, agoraNaParede, customerKey, formatPhone, fusoDaUF, maskBRL, freeSlots, phoneError, planDates, datasDoPlano, todayIn, weekday, zonedTime } from "@/lib/datetime";
import { BookingInput, PlanInput } from "@/lib/scheduling";
import { cotaDe, criarNegocio, definirLimite, negociosDe } from "@/lib/negocios.server";
import { anotar, linhaDoTempo, marcarContato, pedirRemocao, propostaRemovivel, registrarMensagem, registrarVistaDaProposta, salvarCrm } from "@/lib/crm";
import { saudeDe } from "@/lib/saude.server";

// Funções puras
assert.equal(zonedTime("2026-09-20", "09:00").toISOString(), "2026-09-20T12:00:00.000Z");
assert.equal(weekday("2026-09-20"), 0); // domingo
assert.equal(addDays("2026-12-31", 1), "2027-01-01");
assert.equal(customerKey("(11) 91234-5678"), "5511912345678");
assert.equal(customerKey("+55 11 91234-5678"), "5511912345678");
assert.deepEqual(planDates("2026-09-17", 1, 3), ["2026-09-21", "2026-09-28", "2026-10-05"]); // quinta → segundas
assert.deepEqual(planDates("2026-09-21", 1, 2), ["2026-09-21", "2026-09-28"]); // já é segunda
// plano que começa noutro dia: o primeiro fica no dia escolhido, os seguintes no dia do plano
assert.deepEqual(datasDoPlano("2026-11-07", 2, 3), ["2026-11-07", "2026-11-10", "2026-11-17"]); // sábado → terças
assert.deepEqual(datasDoPlano("2026-11-10", 2, 2), ["2026-11-10", "2026-11-17"]); // já é terça
assert.deepEqual(datasDoPlano("2026-11-07", 2, 1), ["2026-11-07"]);
assert.equal(formatPhone("11912345678"), "(11) 91234-5678");
assert.equal(formatPhone("1133334444"), "(11) 3333-4444");
assert.equal(formatPhone("5511912345678"), "(11) 91234-5678", "colado com DDI");
assert.equal(formatPhone("(11) 9123"), "(11) 9123");
assert.equal(formatPhone("1191234567890"), "(11) 91234-5678", "corta excesso");
assert.equal(formatPhone("1"), "(1");
assert.equal(formatPhone(""), "");
assert.equal(maskBRL("4500"), "R$\u00a045,00");
assert.equal(maskBRL("999999999"), "R$\u00a099.999,99", "corta excesso");
assert.equal(maskBRL("R$ 0,0"), "", "apagar o R$ 0,00 esvazia");
assert.equal(maskBRL("abc"), "");
assert.equal(phoneError("(11) 91234-5678"), "");
assert.equal(phoneError("(11) 3333-4444"), "");
assert.notEqual(phoneError("(11) 1234-56789"), "", "11 dígitos sem 9");
assert.notEqual(phoneError("(01) 91234-5678"), "", "DDD 0");
assert.notEqual(phoneError("(11) 9123"), "");
const phoneOk = (p: string) => BookingInput.shape.customerPhone.safeParse(p).success;
assert.ok(phoneOk("(11) 91234-5678") && phoneOk("+55 11 91234-5678") && phoneOk("1133334444"));
assert.ok(!phoneOk("--------") && !phoneOk("(((())))") && !phoneOk("1234-5678"), "telefone sem dígitos suficientes");
const day = "2030-01-07"; // segunda-feira
const at = (t: string) => zonedTime(day, t);
const w = { start: "09:00", end: "10:00" };
assert.deepEqual(freeSlots({ date: day, window: w, durationMin: 30, busy: [], now: new Date(0) }), ["09:00", "09:15", "09:30"]);
assert.deepEqual(freeSlots({ date: day, window: undefined, durationMin: 30, busy: [], now: new Date(0) }), []);
assert.deepEqual(
  freeSlots({ date: day, window: w, durationMin: 30, busy: [{ start: at("09:15"), end: at("09:45") }], now: new Date(0) }),
  [], // qualquer início colide com 09:15–09:45
);
assert.deepEqual(freeSlots({ date: day, window: w, durationMin: 15, busy: [], now: at("09:20") }), ["09:30", "09:45"]);

// Fuso por estado: a agenda grava hora de parede (convenção de Brasília); o fuso real entra
// só no "já passou" e no calendário do cliente
assert.deepEqual([fusoDaUF("AM"), fusoDaUF("rr"), fusoDaUF("AP"), fusoDaUF(null)], ["America/Manaus", "America/Boa_Vista", "America/Belem", "America/Sao_Paulo"]);
{
  const manaus1005 = new Date("2030-01-07T14:05:00Z"); // 10:05 em Manaus = 11:05 em Brasília
  assert.equal(agoraNaParede("America/Manaus", manaus1005).toISOString(), at("10:05").toISOString());
  const janela = { start: "09:00", end: "12:00" };
  assert.equal(freeSlots({ date: day, window: janela, durationMin: 30, busy: [], now: agoraNaParede("America/Manaus", manaus1005) })[0], "10:15", "Manaus às 10:05 ainda vê 10:15");
  assert.equal(freeSlots({ date: day, window: janela, durationMin: 30, busy: [], now: manaus1005 })[0], "11:15", "sem o fuso, sumia uma hora");
  assert.equal(zonedTime(day, "10:30", "America/Manaus").toISOString(), "2030-01-07T14:30:00.000Z", "calendário do cliente em Manaus");
}

// Reservas no emulador
const app = initializeApp({ projectId: "demo-siteflow" });
const db = getFirestore(app);
const t = db.collection("tenants").doc("salao");
await t.set({ name: "Salão Teste", ownerId: "owner" });
await t.collection("services").doc("corte").set({ name: "Corte", durationMin: 30, priceCents: 5000, active: true });
await t.collection("services").doc("luzes").set({ name: "Luzes", durationMin: 90, priceCents: 20000, active: true });
await t.collection("services").doc("off").set({ name: "Antigo", durationMin: 30, priceCents: 1, active: false });
await t.collection("services").doc("orfao").set({ name: "Sem ninguém", durationMin: 30, priceCents: 1000, active: true });
const hours = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, { start: "09:00", end: "12:00" }]));
await t.collection("staff").doc("ana").set({ name: "Ana", serviceIds: ["corte", "luzes"], hours, active: true });
await t.collection("staff").doc("bia").set({ name: "Bia", serviceIds: ["corte"], hours, active: true });

// IPv6 conta pelo /64: trocar o fim do endereço não abre um limite novo
assert.equal(redeDoIp("2804:14c:5b:8000:a1b2:c3d4:e5f6:1"), "2804:14c:5b:8000::/64");
assert.equal(redeDoIp("2804:14c:5b:8000::9"), "2804:14c:5b:8000::/64");
assert.equal(redeDoIp("2804:014c:005b:8000:0:0:0:1"), "2804:14c:5b:8000::/64", "zeros à esquerda");
assert.equal(redeDoIp("2001:db8::1"), "2001:db8:0:0::/64");
assert.equal(redeDoIp("189.6.10.20"), "189.6.10.20", "IPv4 como está");
assert.equal(redeDoIp("::ffff:189.6.10.20"), "189.6.10.20", "IPv4 mapeado");
const date = addDays(todayIn(), 7);
let seq = 0;
/** Cada cliente com seu telefone: o limite por telefone é testado à parte */
const outro = () => ({ customerPhone: `11 96${String(100000 + seq++)}` });
const base = { tenantId: "salao", staffId: "ana", date, customerName: "Cliente", customerPhone: "11 91234-5678" };

const catalog = await loadCatalog(db, "salao");
assert.deepEqual(catalog?.services.map((s) => s.id).sort(), ["corte", "luzes"]); // inativo fora, e o que ninguém faz também
assert.equal(JSON.stringify(catalog).includes("customer"), false);
assert.equal(await loadCatalog(db, "nao-existe"), null);
// recado do dono na confirmação: vazio (ou só espaço) volta ao texto padrão
assert.equal(catalog?.recadoDono, null);
await db.doc("tenants/salao").update({ "agenda.recado": "  Chegue 10 minutos antes.  " });
assert.equal((await loadCatalog(db, "salao"))?.recadoDono, "Chegue 10 minutos antes.");
await db.doc("tenants/salao").update({ "agenda.recado": "   " });
assert.equal((await loadCatalog(db, "salao"))?.recadoDono, null);

assert.equal((await availableSlots(db, { ...base, serviceIds: ["corte"] })).length, 11); // 09:00..11:30

const primeira = await book(db, { ...base, serviceIds: ["corte"], time: "09:00", pedido: "p1" });
const primeiraId = (await t.collection("appointments").limit(1).get()).docs[0]?.id ?? assert.fail();
// a confirmação mostra o que ficou gravado
assert.deepEqual(primeira, { ok: true, id: primeiraId, staffName: "Ana", serviceName: "Corte", durationMin: 30, priceCents: 5000, precoAberto: false, date, time: "09:00", sinal: null });
// o mesmo cliente confirmando de novo (resposta perdida na rede) recebe a mesma reserva, sem duplicar
assert.deepEqual(await book(db, { ...base, serviceIds: ["corte"], time: "09:00", pedido: "p1" }), primeira, "confirmar de novo é seguro");
// a resposta se perdeu e o cliente mudou a escolha: recebe o que ficou marcado, não um segundo horário
assert.deepEqual(await book(db, { ...base, serviceIds: ["luzes"], time: "10:00", pedido: "p1" }), primeira, "mesmo pedido, outra escolha");
assert.equal((await t.collection("appointments").get()).size, 1);
// sem o pedido certo não há repetição: ninguém descobre a reserva de um telefone pela hora
assert.equal((await book(db, { ...base, serviceIds: ["corte"], time: "09:00", pedido: "outro" })).ok, false, "outro pedido, mesmo horário: ocupado");
// duas tentativas do mesmo pedido ao mesmo tempo, com escolhas diferentes: uma reserva só
const juntas = await Promise.all(["10:00", "10:30"].map((time) => book(db, { ...base, date: addDays(todayIn(), 40), customerPhone: "11 97777-0001", serviceIds: ["corte"], time, pedido: "junto" })));
assert.equal(juntas[0].ok && juntas[1].ok && juntas[0].id === juntas[1].id, true, "mesmo pedido em paralelo: a mesma reserva");
assert.equal((await book(db, { ...base, ...outro(), serviceIds: ["corte"], time: "09:00" })).ok, false, "mesmo horário, outra pessoa");
assert.equal((await book(db, { ...base, serviceIds: ["luzes"], time: "08:45" })).ok, false, "fora do expediente");
assert.equal((await book(db, { ...base, serviceIds: ["luzes"], time: "09:15" })).ok, false, "sobreposição parcial");
assert.equal((await book(db, { ...base, serviceIds: ["corte"], time: "09:07" })).ok, false, "fora da grade de 15 min");
assert.equal((await book(db, { ...base, staffId: "bia", serviceIds: ["luzes"], time: "10:00" })).ok, false, "serviço que ela não faz");
assert.equal((await book(db, { ...base, serviceIds: ["off"], time: "10:00" })).ok, false, "serviço inativo");
assert.equal((await book(db, { ...base, ...outro(), staffId: "bia", serviceIds: ["corte"], time: "09:00" })).ok, true, "outra profissional, mesmo horário");
assert.equal((await book(db, { ...base, serviceIds: ["corte"], time: "09:00", date: addDays(todayIn(), -1) })).ok, false, "no passado");

// Vários serviços: Bia faz só corte; Ana faz corte + luzes (30 + 90 = 120 min, R$ 250)
assert.equal((await book(db, { ...base, staffId: "bia", serviceIds: ["corte", "luzes"], time: "11:00" })).ok, false, "profissional não faz todos");
assert.equal((await book(db, { ...base, serviceIds: ["corte", "off"], time: "11:00" })).ok, false, "um dos serviços inativo");
assert.equal(BookingInput.safeParse({ ...base, serviceIds: ["corte", "corte"], time: "11:00" }).success, false, "serviço repetido");
const combo = { ...base, ...outro(), date: addDays(todayIn(), 8), serviceIds: ["corte", "luzes"] };
assert.deepEqual(await availableSlots(db, combo), ["09:00", "09:15", "09:30", "09:45", "10:00"]); // termina até 12:00
const booked = await book(db, { ...combo, time: "09:30" });
assert.equal(booked.ok, true, "combo");
const saved = (await t.collection("appointments").doc(booked.ok ? booked.id : "").get()).data()!;
const created = (await t.collection("history").doc(saved.lastHistoryId).get()).data()!;
assert.deepEqual([created.type, created.by, created.byName, created.appointmentId], ["created", "cliente", "Cliente", booked.ok && booked.id]);
assert.equal(saved.serviceName, "Corte + Luzes");
assert.equal(saved.durationMin, 120);
assert.equal(saved.priceCents, 25000);
assert.equal(saved.precoAberto, false, "tudo com preço fixo");
assert.equal(saved.end.toMillis() - saved.start.toMillis(), 120 * 60_000);
assert.deepEqual(await availableSlots(db, { ...combo, serviceIds: ["corte"] }), ["09:00", "11:30"], "combo ocupa 09:30–11:30");

// Concorrência: 10 clientes no mesmo horário, só 1 consegue
const results = await Promise.all(
  Array.from({ length: 10 }, (_, i) =>
    book(db, { ...base, serviceIds: ["luzes"], time: "10:00", customerName: `C${i}`, customerPhone: `11 97000-00${String(10 + i)}` }),
  ),
);
assert.equal(results.filter((r) => r.ok).length, 1, "concorrência");

// Cancelado libera o horário
const luzes = await t.collection("appointments").where("serviceIds", "==", ["luzes"]).get();
await luzes.docs[0].ref.update({ status: "cancelled" });
assert.equal((await book(db, { ...base, ...outro(), serviceIds: ["luzes"], time: "10:00" })).ok, true, "após cancelamento");

// Remarcar (Ana: corte 09:00 no dia D; combo 09:30–11:30 no dia D+1)
const D = base.date, D1 = addDays(todayIn(), 8);
const [corte] = (await t.collection("appointments").where("staffId", "==", "ana").where("start", "==", zonedTime(D, "09:00")).get()).docs;
assert.ok((await rescheduleSlots(db, { tenantId: "salao", appointmentId: corte.id, date: D })).includes("09:00"), "próprio horário não conta como ocupado");
const actor = { uid: "owner", email: "dono@teste.dev" };
assert.equal((await reschedule(db, { tenantId: "salao", appointmentId: corte.id, date: D1, time: "10:00" }, actor)).ok, false, "conflito com combo");
await corte.ref.update({ status: "confirmed" });
assert.equal((await reschedule(db, { tenantId: "salao", appointmentId: corte.id, date: D, time: "09:15" }, actor)).ok, true, "sobrepõe só a si mesmo");
let moved = (await corte.ref.get()).data()!;
const log = (await t.collection("history").doc(moved.lastHistoryId).get()).data()!;
assert.deepEqual([log.type, log.by, log.byName], ["rescheduled", "owner", "dono@teste.dev"]);
assert.equal(log.from.start.toMillis(), zonedTime(D, "09:00").getTime());
assert.equal(log.to.start.toMillis(), zonedTime(D, "09:15").getTime());
assert.equal(moved.start.toMillis(), zonedTime(D, "09:15").getTime());
assert.equal(moved.end.toMillis() - moved.start.toMillis(), 30 * 60_000);
assert.equal(moved.status, "booked", "remarcado volta a aguardar confirmação");
// Serviço mudou de duração/preço depois da reserva: remarcar deixa tudo coerente
// e virou "a partir de": o valor do agendamento passa a ser o mínimo
await t.collection("services").doc("corte").update({ durationMin: 45, priceCents: 6000, tipoPreco: "aPartir" });
assert.equal((await reschedule(db, { tenantId: "salao", appointmentId: corte.id, date: D, time: "09:15" }, actor)).ok, true);
moved = (await corte.ref.get()).data()!;
assert.deepEqual([moved.durationMin, moved.priceCents, (moved.end.toMillis() - moved.start.toMillis()) / 60_000], [45, 6000, 45]);
assert.equal(moved.precoAberto, true);
await t.collection("services").doc("corte").update({ durationMin: 30, priceCents: 5000, tipoPreco: "fixo" });
assert.equal((await reschedule(db, { tenantId: "salao", appointmentId: corte.id, date: D, time: "09:15" }, actor)).ok, true);
moved = (await corte.ref.get()).data()!;
assert.equal((await reschedule(db, { tenantId: "salao", appointmentId: corte.id, date: D1, time: "11:30" }, actor)).ok, true, "outro dia");
moved = (await corte.ref.get()).data()!;
assert.equal(moved.start.toMillis(), zonedTime(D1, "11:30").getTime());
assert.ok((await availableSlots(db, { ...base, serviceIds: ["corte"] })).includes("09:00"), "horário antigo liberado");
assert.equal((await reschedule(db, { tenantId: "salao", appointmentId: "nao-existe", date: D1, time: "09:00" }, actor)).ok, false);
assert.equal((await t.collection("history").where("appointmentId", "==", corte.id).get()).size, 5, "criado + 4 remarcações");
await corte.ref.update({ status: "no_show" });
assert.equal((await reschedule(db, { tenantId: "salao", appointmentId: corte.id, date: D1, time: "09:00" }, actor)).ok, false, "falta não remarca");
await corte.ref.update({ status: "cancelled" });
assert.equal((await reschedule(db, { tenantId: "salao", appointmentId: corte.id, date: D1, time: "09:00" }, actor)).ok, false, "cancelado não remarca");

// Membro do tenant (emulador de Auth)
const auth = getAuth(app);
async function tokenFor(uid: string) {
  const custom = await auth.createCustomToken(uid);
  const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  return ((await r.json()) as { idToken: string }).idToken;
}
await t.collection("members").doc("owner").set({ uid: "owner", role: "owner" });
const emulatorVerify = async (token: string) => {
  const d = await auth.verifyIdToken(token);
  return { uid: d.uid, email: d.email, authTimeMs: (d.auth_time ?? 0) * 1000 };
};
assert.equal((await requireMember(emulatorVerify, db, await tokenFor("owner"), "salao")).uid, "owner");
await assert.rejects(requireMember(emulatorVerify, db, await tokenFor("intruso"), "salao"), /não tem acesso/);
await assert.rejects(requireMember(emulatorVerify, db, "token-falso", "salao"), /Sessão expirada/);
// Sessão encerrada pelo admin: o token continua válido, o acesso não
await db.doc("config/admin").set({ uids: [], revogados: { owner: Date.now() + 60_000 } }, { merge: true });
await assert.rejects(requireMember(emulatorVerify, db, await tokenFor("owner"), "salao"), /sessão foi encerrada/i);
await db.doc("config/admin").set({ revogados: {} }, { merge: true });
assert.equal((await requireMember(emulatorVerify, db, await tokenFor("owner"), "salao")).uid, "owner");
// Verificador de produção: token do emulador (sem assinatura) e lixo são recusados
await assert.rejects(verifyFirebaseToken(await tokenFor("owner"), "demo-siteflow"));
await assert.rejects(verifyFirebaseToken("a.b.c", "demo-siteflow"));

// Cliente salvo a cada reserva; reserva anônima com o mesmo telefone não troca o nome
const cliente = (await t.collection("customers").doc("5511912345678").get()).data()!;
assert.deepEqual([cliente.name, cliente.phone], ["Cliente", "11 91234-5678"]);
assert.equal((await book(db, { ...base, date: addDays(todayIn(), 9), serviceIds: ["corte"], time: "09:00", customerName: "Impostor" })).ok, true);
assert.equal((await t.collection("customers").doc("5511912345678").get()).get("name"), "Cliente", "nome não sobrescrito");
assert.ok((await t.collection("appointments").where("customerKey", "==", "5511912345678").get()).size > 0);

// Plano recorrente: toda segunda 10:00 com a Bia, 4 semanas a partir de daqui a 14 dias
// começa numa segunda: o primeiro dia é o do plano (outro dia da semana vira o 1º atendimento)
const planStart = planDates(addDays(todayIn(), 14), 1, 1)[0];
const segundas = planDates(planStart, 1, 4);
// ocupa a 2ª segunda antes de criar o plano
assert.equal((await book(db, { ...base, staffId: "bia", date: segundas[1], serviceIds: ["corte"], time: "10:00", customerName: "Outro", customerPhone: "11 90000-0000" })).ok, true);
const planInput = { tenantId: "salao", customerName: "Xavier", customerPhone: "(11) 97777-0000", serviceIds: ["corte"], staffId: "bia", weekday: 1, time: "10:00", startDate: planStart, weeks: 4 };
assert.equal((await createPlan(db, { ...planInput, serviceIds: ["luzes"] }, actor)).ok, false, "Bia não faz luzes");
const plan = await createPlan(db, planInput, actor);
assert.ok(plan.ok);
assert.deepEqual(plan.created, [segundas[0], segundas[2], segundas[3]]);
assert.deepEqual(plan.skipped, [segundas[1]]);
const planAppts = await t.collection("appointments").where("planId", "==", plan.planId).orderBy("start").get();
assert.equal(planAppts.size, 3);
assert.equal(planAppts.docs[0].get("start").toMillis(), zonedTime(segundas[0], "10:00").getTime());
assert.equal(planAppts.docs[0].get("customerKey"), "5511977770000");
const planLog = (await t.collection("history").doc(planAppts.docs[0].get("lastHistoryId")).get()).data()!;
assert.deepEqual([planLog.type, planLog.planId, planLog.byName], ["created", plan.planId, "dono@teste.dev"]);
assert.equal((await t.collection("customers").doc("5511977770000").get()).get("name"), "Xavier");
// e-mail opcional no plano: limpo como na ficha; inválido é recusado; informado, vai para a ficha
assert.equal(PlanInput.parse({ ...planInput, email: " Xavier@Gmail.COM " }).email, "xavier@gmail.com");
assert.equal(PlanInput.safeParse({ ...planInput, email: "xavier@" }).success, false);
assert.equal((await t.collection("customers").doc("5511977770000").get()).get("email"), undefined, "sem e-mail no plano, nada gravado");
{
  const comEmail = await createPlan(db, { ...planInput, customerName: "Yara", customerPhone: "(11) 96666-0101", startDate: planDates(addDays(todayIn(), 60), 1, 1)[0], weeks: 1, email: "yara@exemplo.com" }, actor);
  assert.ok(comEmail.ok, "plano com e-mail");
  assert.equal((await t.collection("customers").doc("5511966660101").get()).get("email"), "yara@exemplo.com");
}
assert.equal((await createPlan(db, planInput, actor)).ok, false, "mesmo plano de novo: tudo ocupado");

// Conta da equipe presa à Ana: não remarca, não cria nem encerra plano de outra agenda
await t.collection("members").doc("da-ana").set({ uid: "da-ana", role: "member", staffId: "ana" });
const daAna = { uid: "da-ana", email: "ana@teste.dev" };
assert.equal((await endPlan(db, { tenantId: "salao", planId: plan.planId }, daAna)).ok, false, "equipe não encerra plano da Bia");
assert.equal((await createPlan(db, planInput, daAna)).ok, false, "equipe não cria plano na agenda da Bia");
assert.equal((await createPlan(db, { ...planInput, staffId: "ana", qualquer: true }, daAna)).ok, false, "equipe não usa Qualquer um");
assert.equal((await reschedule(db, { tenantId: "salao", appointmentId: planAppts.docs[0].id, date: segundas[0], time: "10:30" }, daAna)).ok, false, "equipe não remarca horário da Bia");
await t.collection("members").doc("da-ana").delete();

// Encerrar plano: cancela os futuros, com histórico; não encerra duas vezes
await planAppts.docs[2].ref.update({ status: "no_show" }); // não ativo: fica como está
const ended = await endPlan(db, { tenantId: "salao", planId: plan.planId }, actor);
assert.deepEqual(ended, { ok: true, cancelled: 2 });
const after = await t.collection("appointments").where("planId", "==", plan.planId).orderBy("start").get();
assert.deepEqual(after.docs.map((d) => d.get("status")), ["cancelled", "cancelled", "no_show"]);
const endLog = (await t.collection("history").doc(after.docs[0].get("lastHistoryId")).get()).data()!;
assert.deepEqual([endLog.type, endLog.reason], ["cancelled", "plan_ended"]);
assert.equal((await t.collection("plans").doc(plan.planId).get()).get("status"), "ended");
assert.equal((await endPlan(db, { tenantId: "salao", planId: plan.planId }, actor)).ok, false);

// "Qualquer um": a semana em que a Bia está ocupada vai para a Ana (livre no mesmo horário), em vez de
// pular. Janela própria (~100 dias à frente, longe dos outros testes) para não depender do relógio do CI
{
  const inicio = planDates(addDays(todayIn(), 100), 2, 1)[0]; // começa numa terça
  const tercas = planDates(inicio, 2, 4);
  const base4 = { ...planInput, weekday: 2, time: "11:00", startDate: inicio, weeks: 4 }; // expediente de teste: 9h–12h
  // a Bia fica ocupada só na 2ª terça (plano de uma semana, para outro cliente)
  const ocupa = await createPlan(db, { ...base4, customerName: "Ocupante", customerPhone: "(11) 95555-1212" /* exclusivo deste bloco */, startDate: tercas[1], weeks: 1 }, actor);
  assert.deepEqual(ocupa.ok && ocupa.created, [tercas[1]]);
  const revezado = await createPlan(db, { ...base4, qualquer: true }, actor);
  assert.ok(revezado.ok);
  assert.deepEqual([revezado.created, revezado.skipped], [tercas, []], "nenhuma semana pulada");
  assert.deepEqual(revezado.outros, [{ date: tercas[1], nome: "Ana" }]);
  const doPlano = await t.collection("appointments").where("planId", "==", revezado.planId).orderBy("start").get();
  assert.deepEqual(doPlano.docs.map((d) => d.get("staffId")), ["bia", "ana", "bia", "bia"]);
  assert.deepEqual(doPlano.docs.map((d) => d.get("staffName")), ["Bia", "Ana", "Bia", "Bia"]);
  assert.equal((await t.collection("plans").doc(revezado.planId).get()).get("staffName"), "Bia, Ana");
  // sem "Qualquer um", a mesma situação pula a semana (como antes)
  // a conta da equipe do profissional principal não encerra: semanas dele foram para outros
  const principal = (await t.collection("plans").doc(revezado.planId).get()).get("staffId");
  await t.collection("members").doc("do-principal").set({ uid: "do-principal", role: "member", staffId: principal });
  assert.equal((await endPlan(db, { tenantId: "salao", planId: revezado.planId }, { uid: "do-principal" })).ok, false, "equipe não encerra plano Qualquer um");
  await t.collection("members").doc("do-principal").delete();
  assert.equal((await endPlan(db, { tenantId: "salao", planId: revezado.planId }, actor)).ok, true);
  const fixo = await createPlan(db, base4, actor);
  assert.ok(fixo.ok);
  assert.deepEqual([fixo.skipped, fixo.outros], [[tercas[1]], []]);
  for (const id of [fixo.planId, ocupa.ok ? ocupa.planId : ""]) assert.equal((await endPlan(db, { tenantId: "salao", planId: id }, actor)).ok, true);
}

// Limites contra reservas em massa (telefone e dispositivo)
// Longe da janela do plano (hoje+14 a hoje+35): com hoje+20, o 3º dia deste bloco
// caía em segundas[1] às 10:00 sempre que o teste rodava num domingo, e a recusa
// vinha do horário ocupado na linha 176, não do limite.
const limDate = addDays(todayIn(), 60);
const spam = { tenantId: "salao", staffId: "bia", serviceIds: ["corte"], customerName: "Robô", customerPhone: "11 98888-1111" };
const horarios = ["09:00", "09:30", "10:00", "10:30", "11:00"];
const feitas = [];
for (const [i, time] of horarios.entries()) feitas.push(await book(db, { ...spam, date: addDays(limDate, i), time }, "203.0.113.5"));
assert.deepEqual(feitas.map((r) => r.ok), [true, true, true, false, false], "4ª reserva barrada: já tem 3 futuras");
assert.match(("error" in feitas[3] && feitas[3].error) || "", /já tem 3 horários/);
// Cancelar libera o limite de "ativas"
const doRobo = await t.collection("appointments").where("customerKey", "==", "5511988881111").get();
for (const d of doRobo.docs.slice(0, 3)) await d.ref.update({ status: "cancelled" });
assert.equal((await book(db, { ...spam, date: addDays(limDate, 10), time: "09:00" }, "203.0.113.5")).ok, true, "após cancelar, volta a poder");
// Limite diário por telefone: conta as que deram certo (5 por dia)
const cancelarTudo = async () => {
  const snap = await t.collection("appointments").where("customerKey", "==", "5511988881111").get();
  for (const d of snap.docs) await d.ref.update({ status: "cancelled" });
};
await cancelarTudo();
assert.equal((await book(db, { ...spam, date: addDays(limDate, 11), time: "09:00" }, "203.0.113.5")).ok, true, "5ª do dia ainda passa");
await cancelarTudo();
const r5 = await book(db, { ...spam, date: addDays(limDate, 12), time: "09:30" }, "203.0.113.5");
assert.equal(r5.ok, false, "6ª do dia barrada mesmo sem horários ativos");
assert.match(("error" in r5 && r5.error) || "", /Muitos agendamentos com este WhatsApp/);
// Outro telefone, mesmo dispositivo, continua funcionando (limite maior)
assert.equal((await book(db, { ...spam, customerPhone: "11 98888-2222", date: addDays(limDate, 13), time: "09:00" }, "203.0.113.5")).ok, true);
// Contadores ficam fora do alcance do app (regras) e guardam só o hash do IP
const limits = await t.collection("limits").get();
assert.ok(limits.size >= 2);
assert.equal(limits.docs.some((d) => d.id.includes("203.0.113.5")), false, "IP não aparece em claro");
// Somando todos os negócios: quem já marcou 8 vezes hoje em outros salões não dispara
// mais recibos pelo WhatsApp de ninguém
assert.equal((await db.doc(`limitesAgenda/phone-5511988882222-${todayIn()}`).get()).get("count"), 1, "conta também fora do negócio");
await db.doc(`limitesAgenda/phone-5511977773333-${todayIn()}`).set({ count: LIMITS.globalPerPhone, day: todayIn() });
const global = await book(db, { ...spam, customerPhone: "11 97777-3333", date: addDays(limDate, 14), time: "09:00" }, "198.51.100.7");
assert.match(("error" in global && global.error) || "", /Muitos agendamentos com este WhatsApp/, "limite somado entre negócios");

// Corrigir o nome do cliente: o futuro acompanha, o historico nao
{
  const chave = "5511966660000"; // exclusivo deste bloco: 97777 é do plano do Xavier
  const cli = t.collection("customers").doc(chave);
  await cli.set({ name: "Mrcia", phone: "(11) 96666-0000" });
  const passado = t.collection("appointments").doc("ap-passado");
  const futuro = t.collection("appointments").doc("ap-futuro");
  await passado.set({ customerKey: chave, customerName: "Mrcia", start: Timestamp.fromDate(new Date(Date.now() - 864e5)), status: "confirmed" });
  await futuro.set({ customerKey: chave, customerName: "Mrcia", start: Timestamp.fromDate(new Date(Date.now() + 864e5)), status: "booked" });

  const r = await renameCustomer(db, { tenantId: "salao", customerId: chave, name: "Márcia" }, { uid: "owner" });
  // recepção (papel "member") não renomeia: o nome vai para todos os horários futuros
  await t.collection("members").doc("recepcao").set({ uid: "recepcao", role: "member" });
  await assert.rejects(
    renameCustomer(db, { tenantId: "salao", customerId: chave, name: "Outra" }, { uid: "recepcao" }),
    /dono ou um administrador/,
  );
  assert.deepEqual([r.ok, r.agendamentos], [true, 1]);
  assert.equal((await cli.get()).get("name"), "Márcia");
  assert.equal((await futuro.get()).get("customerName"), "Márcia", "o que o dono ainda vai atender é corrigido");
  assert.equal((await passado.get()).get("customerName"), "Mrcia", "o histórico guarda o que foi dito na época");

  await assert.rejects(
    renameCustomer(db, { tenantId: "salao", customerId: "5500000000000", name: "Ninguém" }, { uid: "owner" }),
    /Cliente nao encontrado/,
  );

  // Nascimento e e-mail: o dono registra; o servidor limpa e confere de novo
  const dados = DadosCliente.parse({ nascimento: "1990-12-31", email: " Marcia@Email.COM " });
  assert.deepEqual(dados, { nascimento: "1990-12-31", email: "marcia@email.com" }, "e-mail sem espaço e minúsculo");
  await salvarDadosCliente(db, { tenantId: "salao", customerId: chave, dados }, { uid: "owner" });
  assert.deepEqual([(await cli.get()).get("nascimento"), (await cli.get()).get("email")], ["1990-12-31", "marcia@email.com"]);
  await assert.rejects(salvarDadosCliente(db, { tenantId: "salao", customerId: chave, dados }, { uid: "recepcao" }), /dono ou um administrador/, "dado pessoal: a equipe não grava");
  for (const ruim of [{ nascimento: "1990-02-31", email: "" }, { nascimento: "2999-01-01", email: "" }, { nascimento: "", email: "marcia@" }]) {
    assert.equal(DadosCliente.safeParse(ruim).success, false, JSON.stringify(ruim));
  }
  // vazio apaga
  await salvarDadosCliente(db, { tenantId: "salao", customerId: chave, dados: DadosCliente.parse({ nascimento: "", email: "" }) }, { uid: "owner" });
  assert.deepEqual([(await cli.get()).get("nascimento"), (await cli.get()).get("email")], [undefined, undefined]);

  // Excluir: só dono/admin, e nunca com horário marcado
  await t.collection("members").doc("func").set({ uid: "func", role: "member" });
  await t.collection("members").doc("gerente").set({ uid: "gerente", role: "admin" });
  await cli.collection("notas").add({ texto: "prefere manhã" });
  const del = (uid: string) => deleteCustomer(db, { tenantId: "salao", customerId: chave }, { uid });
  await assert.rejects(del("func"), /Só o dono ou um administrador/);
  await assert.rejects(del("gerente"), /tem horário marcado/);
  await futuro.update({ status: "cancelled" });
  assert.equal((await del("gerente")).ok, true);
  assert.equal((await cli.get()).exists, false);
  assert.equal((await cli.collection("notas").get()).size, 0, "anotações vão junto");
  assert.equal((await passado.get()).exists, true, "o histórico fica");
}

// A semana que a página pública desenha: contagem por dia e união da equipe
{
  const semana = addDays(todayIn(), 20); // longe dos agendamentos criados acima
  const dias = [semana, addDays(semana, 1)];
  const corte = { tenantId: "salao", serviceIds: ["corte"] };

  const soAna = await agendaDias(db, { ...corte, staffId: "ana", from: semana }, dias);
  assert.deepEqual(soAna.map((d) => d.date), dias);
  assert.equal(soAna[0].horarios.length, 11, "09:00..11:30 de 15 em 15");
  assert.ok(soAna[0].horarios.every((h) => h.staffId === "ana"));

  const qualquer = await agendaDias(db, { ...corte, staffId: "", from: semana }, dias);
  assert.equal(qualquer[0].horarios.length, 11, "união não duplica horário que as duas atendem");
  assert.ok(qualquer[0].horarios.every((h) => h.staffId === "ana"), "ordem do catálogo decide o empate");

  // Ana ocupada às 09:00: quem sobra é Bia, e o horário continua na lista
  assert.equal((await book(db, { ...corte, ...outro(), staffId: "ana", date: semana, time: "09:00", customerName: "Cliente" })).ok, true);
  const depois = await agendaDias(db, { ...corte, staffId: "", from: semana }, dias);
  assert.equal(depois[0].horarios.find((h) => h.hora === "09:00")?.staffId, "bia", "o horário passa para quem está livre");
  const soAnaDepois = await agendaDias(db, { ...corte, staffId: "ana", from: semana }, dias);
  assert.ok(!soAnaDepois[0].horarios.some((h) => h.hora === "09:00"), "para quem pediu Ana, 09:00 sumiu");

  // Luzes só a Ana faz: escolher os dois serviços tira a Bia da conta
  const combo2 = await agendaDias(db, { tenantId: "salao", serviceIds: ["corte", "luzes"], staffId: "", from: semana }, [semana]);
  assert.ok(combo2[0].horarios.every((h) => h.staffId === "ana"));

  // fechado é dia em que ninguém atende; dia com equipe e sem horário é lotação
  assert.equal(soAna[0].fechado, false);
  const diaDaSemana = String(new Date(`${semana}T12:00:00Z`).getUTCDay());
  await t.collection("staff").doc("caio").set({ name: "Caio", serviceIds: ["corte"], hours: { [diaDaSemana]: { start: "09:00", end: "12:00" } }, active: true });
  const doCaio = await agendaDias(db, { ...corte, staffId: "caio", from: semana }, dias);
  assert.deepEqual(doCaio.map((d) => d.fechado), [false, true], "Caio só atende no primeiro dia");
  await t.collection("staff").doc("caio").delete();
  assert.deepEqual(await agendaDias(db, { ...corte, staffId: "", from: semana }, []), [], "sem dias, sem consulta");
  assert.deepEqual(await agendaDias(db, { ...corte, staffId: "", from: semana, tenantId: "nao-existe" }, dias), []);
}

// Ordem dos serviços na página pública: o que mais se agenda vem primeiro
{
  const c0 = await loadCatalog(db, "salao");
  // "usos" já subiu nos agendamentos deste teste; sem nada agendado valeria "ordem"
  const usos = async (id: string) => (await t.collection("services").doc(id).get()).get("usos") ?? 0;
  assert.ok((await usos("corte")) > 0, "cada agendamento conta como uso do serviço");
  const ordenado = [...(c0?.services ?? [])].map((s) => s.id);
  const contagens = await Promise.all(ordenado.map(usos));
  assert.deepEqual(contagens, [...contagens].sort((a, b) => b - a), "mais agendados primeiro");

  // Empate em usos: decide a ordem em que o site lista (campo ordem)
  await t.collection("services").doc("corte").set({ usos: 0 }, { merge: true });
  await t.collection("services").doc("luzes").set({ usos: 0 }, { merge: true });
  await t.collection("services").doc("corte").set({ ordem: 1 }, { merge: true });
  await t.collection("services").doc("luzes").set({ ordem: 0 }, { merge: true });
  assert.deepEqual((await loadCatalog(db, "salao"))?.services.map((s) => s.id), ["luzes", "corte"]);
}

// Um negócio por conta, até o admin da plataforma liberar mais
{
  const dona = { uid: "dona-limite", email: "dona@teste.dev" };
  // o cadastro pede ramo, WhatsApp e cidade: o negócio já nasce com site e agenda
  const NEGOCIO = { sub: "barbearia", telefone: "(96) 99123-4567", cidade: "Macapá", uf: "AP" };
  assert.equal(await criarNegocio(db, dona, { ...NEGOCIO, name: "Primeiro", slug: "primeiro-limite" }), "primeiro-limite");
  const membro = await db.doc("tenants/primeiro-limite/members/dona-limite").get();
  assert.deepEqual([membro.get("role"), membro.get("email")], ["owner", "dona@teste.dev"]);
  assert.deepEqual(await cotaDe(db, dona.uid), { usados: 1, limite: 1 });
  await assert.rejects(criarNegocio(db, dona, { ...NEGOCIO, name: "Segundo", slug: "segundo-limite" }), /Sua conta inclui 1 negócio/);
  assert.equal((await db.doc("tenants/segundo-limite").get()).exists, false, "recusado não deixa nada gravado");

  await definirLimite(db, dona.uid, 2);
  assert.equal(await criarNegocio(db, dona, { ...NEGOCIO, name: "Segundo", slug: "segundo-limite" }), "segundo-limite");
  await assert.rejects(criarNegocio(db, dona, { ...NEGOCIO, name: "Terceiro", slug: "terceiro-limite" }), /Sua conta inclui 2 negócios/);

  const outra = { uid: "outra-limite" };
  await assert.rejects(criarNegocio(db, outra, { ...NEGOCIO, name: "Tomado", slug: "primeiro-limite" }), /já está em uso/);
  await assert.rejects(criarNegocio(db, outra, { ...NEGOCIO, name: "Reservado", slug: "painel" }), /reservado/);
  // Funcionário de outro negócio não gasta a cota
  await db.doc("tenants/primeiro-limite/members/outra-limite").set({ uid: "outra-limite", role: "member" });
  assert.equal(await criarNegocio(db, outra, { ...NEGOCIO, name: "Dela", slug: "dela-limite" }), "dela-limite");
  await assert.rejects(definirLimite(db, dona.uid, 0), /de 1 a 50/);
  // Admin adicionado por outro dono não gasta a cota; admin que entrou por convite gasta
  const alvo = { uid: "alvo-limite" };
  await db.doc("tenants/primeiro-limite/members/alvo-limite").set({ uid: "alvo-limite", role: "admin" });
  assert.equal((await cotaDe(db, alvo.uid)).usados, 0, "admin sem convite não conta");
  await db.doc("tenants/primeiro-limite/members/alvo-limite").set({ uid: "alvo-limite", role: "admin", viaConvite: true });
  assert.equal((await cotaDe(db, alvo.uid)).usados, 1, "admin do convite conta");
}

// CRM: perda pede motivo; estágio e mensagem viram eventos; a linha do tempo junta tudo
{
  const slug = "primeiro-limite";
  await salvarCrm(db, slug, { estagio: "oferta" }, "vendedor@teste.dev");
  await assert.rejects(salvarCrm(db, slug, { estagio: "perdido" }, "vendedor@teste.dev"), /motivo da perda/);
  await salvarCrm(db, slug, { estagio: "perdido", motivoPerda: "preco", detalhePerda: "achou alto" }, "vendedor@teste.dev");
  await assert.rejects(salvarCrm(db, slug, { donoEmail: "sem-arroba" }), /E-mail inválido/);
  await salvarCrm(db, slug, { donoNome: "Dona Teste", donoWhatsapp: "92991234567", donoEmail: "dona@teste.dev" });
  await registrarMensagem(db, slug, "Proposta", "Dona Teste", "vendedor@teste.dev");
  await anotar(db, slug, "pediu para voltar em janeiro", "vendedor@teste.dev");
  await db.doc(`tenants/${slug}/members/cliente-crm`).set({ uid: "cliente-crm", role: "admin", email: "cliente@teste.dev", createdAt: Timestamp.now() });
  await db.collection("cobrancas").doc(`${slug}-entrada`).set({ slug, tipo: "entrada", competencia: null, valorCents: 25000, criadaEm: Timestamp.now(), pagoEm: null });

  const linha = await linhaDoTempo(db, slug);
  const tipos = new Set(linha.map((e) => e.tipo));
  for (const t of ["estagio", "mensagem", "nota", "convite", "cobranca"]) assert.ok(tipos.has(t as never), `falta ${t} na linha do tempo`);
  const perda = linha.find((e) => e.titulo === "Oferta enviada → Perdido");
  assert.equal(perda?.detalhe, "Preço · achou alto");
  // feito no /admin aparece como da Ruphus, não com o e-mail da conta (um login, não uma caixa)
  assert.equal(perda?.autor, "por Ruphus");
  assert.ok(linha.filter((e) => ["estagio", "mensagem", "nota"].includes(e.tipo)).every((e) => e.autor === "por Ruphus"));
  assert.equal(linha.find((e) => e.tipo === "convite")?.autor, "cliente@teste.dev", "a entrada do cliente segue com o e-mail dele");
  assert.ok(linha.every((e, i) => i === 0 || linha[i - 1].quando >= e.quando), "do mais novo ao mais antigo");

  const crmDoc = async () => (await db.doc(`crm/${slug}`).get());
  // A mensagem enviada marca o dia no próprio negócio: é o que alimenta "Falei hoje"
  assert.ok((await crmDoc()).get("ultimoContatoEm"), "mensagem registra o último contato");
  // Destaque por alguns dias, e sair dele
  await salvarCrm(db, slug, { fixadoAte: "2030-01-31" });
  assert.equal((await crmDoc()).get("fixadoAte"), "2030-01-31");
  await salvarCrm(db, slug, { fixadoAte: null });
  assert.equal((await crmDoc()).get("fixadoAte"), null);
  const entrou = (await crmDoc()).get("entrouEm");
  assert.ok(entrou, "sair de novo marca o começo da negociação");
  assert.ok((await crmDoc()).get("perdidoEm"), "perda tem data");

  // Voltar ao funil apaga o motivo e a data da perda; o começo da negociação fica
  await salvarCrm(db, slug, { estagio: "negociando" });
  assert.equal((await crmDoc()).get("motivoPerda"), undefined);
  assert.equal((await crmDoc()).get("perdidoEm"), undefined);
  assert.ok((await crmDoc()).get("entrouEm").isEqual(entrou), "entrouEm não é reescrito");

  await salvarCrm(db, slug, { origem: "indicacao", indicadoPor: "Jéssica" });
  await assert.rejects(salvarCrm(db, slug, { origem: "tv" as never }));
  assert.equal((await crmDoc()).get("origem"), "indicacao");
}

// Cadência: cada toque agenda o próximo; resposta para a cadência; pedir para parar bloqueia
{
  const slug = "cadencia-teste";
  const crmDoc = async () => (await db.doc(`crm/${slug}`).get());
  const hoje = todayIn();
  await registrarMensagem(db, slug, "Primeiro contato", "a recepção", "vendedor@teste.dev");
  let d = await crmDoc();
  assert.equal(d.get("toques"), 1);
  assert.equal(d.get("proximaAcao"), "Lembrete");
  assert.equal(d.get("proximaData"), addDays(hoje, 3));
  await registrarMensagem(db, slug, "Lembrete", "a recepção", "vendedor@teste.dev");
  d = await crmDoc();
  assert.equal(d.get("toques"), 2);
  assert.equal(d.get("proximaData"), addDays(hoje, 7));
  // mensagem fora da cadência não conta toque nem mexe no combinado
  await registrarMensagem(db, slug, "Cobrança de 2026-11", "o dono", "vendedor@teste.dev");
  assert.equal((await crmDoc()).get("toques"), 2);

  await marcarContato(db, slug, "respondeu", "vendedor@teste.dev");
  d = await crmDoc();
  assert.ok(d.get("respondeuEm"));
  assert.equal(d.get("proximaData"), hoje, "respondeu: o próximo passo é falar com ele hoje");
  assert.equal(d.get("proximaAcao"), "Responder e mandar a proposta");
  await registrarMensagem(db, slug, "Última tentativa", "a recepção", "vendedor@teste.dev");
  assert.equal((await crmDoc()).get("toques"), 2, "depois da resposta, não é mais cadência");

  // combinado pelo vendedor sobrevive à resposta
  await salvarCrm(db, slug, { proximaAcao: "ligar às 10h", proximaData: "2030-01-10" });
  await marcarContato(db, slug, "respondeu", "vendedor@teste.dev");
  assert.equal((await crmDoc()).get("proximaData"), "2030-01-10");

  await marcarContato(db, slug, "parar", "vendedor@teste.dev");
  d = await crmDoc();
  assert.ok(d.get("naoContatarEm"));
  assert.equal(d.get("estagio"), "perdido");
  assert.equal(d.get("motivoPerda"), "sem_interesse");
  assert.equal(d.get("proximaData"), undefined);
  await assert.rejects(registrarMensagem(db, slug, "Lembrete", "a recepção", "vendedor@teste.dev"), /pediu para não receber/);
  await marcarContato(db, slug, "liberar", "vendedor@teste.dev");
  d = await crmDoc();
  assert.equal(d.get("naoContatarEm"), undefined);
  assert.equal(d.get("estagio"), "novo", "desfazer o pedido devolve ao funil");
  assert.equal(d.get("motivoPerda"), undefined);

  // a primeira vista da proposta vira evento, as seguintes não
  await registrarVistaDaProposta(db, slug);
  const primeira = (await crmDoc()).get("propostaVistaEm");
  await registrarVistaDaProposta(db, slug);
  assert.ok((await crmDoc()).get("propostaVistaEm").isEqual(primeira));
  const linha = await linhaDoTempo(db, slug);
  const vistas = linha.filter((e) => e.titulo === "Abriu a proposta");
  assert.equal(vistas.length, 1);
  assert.equal(vistas[0].autor, "o dono, pelo link", "o que o dono fez não aparece como da Ruphus");
  assert.equal(linha.filter((e) => e.titulo === "Novo → Perdido").length, 1);
}

// Cadência não pisa no combinado à mão; encerrar como perdido tira o toque agendado
{
  const slug = "cadencia-manual";
  const crmDoc = async () => (await db.doc(`crm/${slug}`).get());
  await salvarCrm(db, slug, { proximaAcao: "ligar terça", proximaData: "2030-02-05" });
  await registrarMensagem(db, slug, "Primeiro contato", "a recepção", "vendedor@teste.dev");
  let d = await crmDoc();
  assert.equal(d.get("proximaData"), "2030-02-05");
  assert.equal(d.get("toques"), 1, "o toque conta mesmo sem agendar");
  await salvarCrm(db, slug, { proximaAcao: null, proximaData: null });
  await registrarMensagem(db, slug, "Última tentativa", "a recepção", "vendedor@teste.dev");
  assert.ok((await crmDoc()).get("proximaData"));
  await salvarCrm(db, slug, { estagio: "perdido", motivoPerda: "nao_respondeu" });
  d = await crmDoc();
  assert.equal(d.get("proximaData"), undefined, "perdido não volta em Atrasados");
  assert.equal(d.get("proximaAcao"), undefined);
}

// salvarCrm concorrente: a mudança de estágio vira um evento só
{
  const slug = "corrida-teste";
  await Promise.all([salvarCrm(db, slug, { estagio: "oferta" }), salvarCrm(db, slug, { estagio: "oferta" })]);
  const eventos = await db.collection(`crm/${slug}/eventos`).get();
  assert.equal(eventos.size, 1, "duas gravações iguais ao mesmo tempo, um evento");
}

// Saúde: implantação lida do tenant, cobrança aberta vencida vira risco
{
  const slug = "dela-limite";
  const hoje = todayIn();
  let x = await saudeDe(db, slug, hoje);
  // criado pelo próprio dono no /painel: o dono já está dentro, e o negócio nasce
  // com os serviços do ramo e uma equipe — falta só o primeiro agendamento
  assert.deepEqual(x.passos, { convite: true, servicos: true, profissionais: true, agendamento: false });
  assert.equal(x.saude, "atencao");
  await db.doc(`tenants/${slug}/members/dono-saude`).set({ uid: "dono-saude", role: "admin", email: "dono@teste.dev", createdAt: Timestamp.now() });
  await db.doc(`tenants/${slug}/services/corte`).set({ name: "Corte", durationMin: 30, priceCents: 4000, active: true });
  await db.collection("cobrancas").doc(`${slug}-mensal`).set({ slug, tipo: "mensal", competencia: "2026-01", valorCents: 5990, vencimento: addDays(hoje, -2), status: "aberta" });
  x = await saudeDe(db, slug, hoje);
  assert.deepEqual([x.passos.convite, x.passos.servicos, x.passos.profissionais], [true, true, true]);
  assert.equal(x.detalhes.convite, "dono@teste.dev");
  assert.deepEqual([x.cobranca, x.diasParaVencer, x.saude], ["atrasada", -2, "risco"]);
}

// Demonstração: restaurar apaga o que o cliente fez, volta ao padrão e troca a senha
{
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??= "demo-siteflow";
  const { acessoDemo, montarAgenda, restaurarDemo } = await import("@/lib/demo.server");
  // a agenda de exemplo encaixa em qualquer dia do ano: passado fica no passado, futuro no futuro
  for (let i = 0; i < 61; i++) {
    const hoje = addDays("2026-01-01", i * 6);
    for (const a of montarAgenda(hoje)) assert.ok(a.status === "booked" || a.data !== hoje, `${hoje}: nada de exemplo cai hoje`);
  }
  const slug = "demo-teste";
  const d = db.collection("tenants").doc(slug);
  await d.set({ name: "Nome do teste", ownerId: "dono-original", limiteStaff: 1, site: { url: `https://${slug}.ruphus.site`, phone: "5511911112222" }, gerado: { origem: "cadastro", sub: "barbearia" } });
  await d.collection("members").doc("dono-original").set({ uid: "dono-original", role: "owner" });
  await d.collection("members").doc("convidado").set({ uid: "convidado", role: "staff" });
  await d.collection("services").doc("lixo").set({ name: "Criado no teste", durationMin: 30, priceCents: 1, active: true });
  await d.collection("appointments").doc("lixo").set({ status: "booked" });
  await d.collection("limits").doc("device-x").set({ count: 20 });

  const entra = async (senha: string) => (await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=x`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "demo@ruphus.site", password: senha, returnSecureToken: true }),
  })).ok;
  const estado = async () => {
    const [m, sv, st, ap, cl, pl, lim, t] = await Promise.all(["members", "services", "staff", "appointments", "customers", "plans", "limits"].map((c) => d.collection(c).get()).concat([d.get() as never]));
    return { m, sv, st, ap, cl, pl, lim, t: t as unknown as FirebaseFirestore.DocumentSnapshot };
  };

  const r1 = await restaurarDemo(db, { slug, adminUid: "admin" });
  let e = await estado();
  const dono = e.m.docs.find((x) => x.id !== "dono-original")!;
  assert.deepEqual(e.m.docs.map((x) => x.id).sort(), ["dono-original", dono.id].sort(), "convidado sai, o dono original fica");
  assert.deepEqual([dono.get("role"), dono.get("email")], ["owner", "demo@ruphus.site"]);
  assert.deepEqual(e.sv.docs.map((x) => x.id).sort(), ["barba", "corte", "corte-barba", "infantil", "pigmentacao", "sobrancelha"]);
  assert.deepEqual([e.st.size, e.cl.size, e.pl.size, e.lim.size], [3, 10, 1, 0]);
  assert.ok(e.ap.size > r1.agendamentos && !e.ap.docs.some((x) => x.id === "lixo"), "exemplo + plano, sem o que o teste criou");
  assert.deepEqual([e.t.get("name"), e.t.get("site.phone"), e.t.get("ownerId"), e.t.get("limiteStaff")], ["Barbearia Force", "5596999990000", "dono-original", undefined]);
  assert.equal(e.sv.docs.find((x) => x.id === "corte")!.get("usos") > 0, true, "popularidade ordena a página pública");
  assert.ok(await entra(r1.senha));
  const quantos = e.ap.size;

  // o cliente testa: agenda pela página pública, cria serviço; o vendedor restaura
  const segunda = [...Array(7).keys()].map((i) => addDays(todayIn(), i + 1)).find((x) => weekday(x) === 1)!;
  const livres = await availableSlots(db, { tenantId: slug, serviceIds: ["sobrancelha"], staffId: "mario", date: segunda });
  assert.ok(livres.length > 0);
  assert.equal((await book(db, { tenantId: slug, serviceIds: ["sobrancelha"], staffId: "mario", date: segunda, time: livres[0], customerName: "Cliente Testando", customerPhone: "(96) 98888-7777" })).ok, true);
  await d.collection("services").doc("outro").set({ name: "Outro", durationMin: 30, priceCents: 1, active: true });
  // e conecta um WhatsApp: a restauração desconecta (a chave no privado some com as subcoleções)
  await d.set({ whatsapp: { instanceId: "demo-main", status: "connected", phone: "5591900000000", termsAcceptedAt: 1 } }, { merge: true });
  await d.collection("privado").doc("whatsapp").set({ atendysApiKey: "k" });

  const r2 = await restaurarDemo(db, { slug, adminUid: "admin" });
  e = await estado();
  assert.deepEqual(
    [e.t.get("whatsapp.status"), e.t.get("whatsapp.instanceId"), e.t.get("whatsapp.phone"), e.t.get("whatsapp.termsAcceptedAt")],
    ["disconnected", undefined, undefined, 1],
    "WhatsApp desconectado, termo aceito fica",
  );
  assert.equal((await d.collection("privado").doc("whatsapp").get()).exists, false);
  assert.equal(e.ap.size, quantos, "mesma demonstração de novo");
  assert.equal(e.cl.docs.some((x) => x.id === customerKey("(96) 98888-7777")), false);
  assert.equal(e.sv.size, 6);
  assert.notEqual(r2.senha, r1.senha);
  assert.ok(await entra(r2.senha) && !(await entra(r1.senha)), "senha antiga não entra mais");
  assert.equal(typeof (await db.doc("config/admin").get()).get(`revogados.${dono.id}`), "number", "sessão de quem testou é recusada");
  assert.equal((await acessoDemo(db))?.senha, r2.senha);
  // quem tem a senha compartilhada troca o e-mail da conta: a restauração acha pelo uid guardado,
  // devolve o e-mail ao padrão e não cria outra conta (a antiga ficaria viva com a senha do golpista)
  const { contas } = await import("@/lib/demo.server");
  assert.equal((await db.doc("config/demo").get()).get("uid"), dono.id, "uid da conta da demo guardado");
  await contas(":update", { localId: dono.id, email: "golpe@teste.dev" });
  const r3 = await restaurarDemo(db, { slug, adminUid: "admin" });
  assert.equal((await contas(":lookup", { localId: [dono.id] })).users?.[0] && (await contas(":lookup", { email: ["demo@ruphus.site"] })).users?.[0]?.localId, dono.id, "a mesma conta, com o e-mail da demo de volta");
  assert.ok(await entra(r3.senha), "entra com a senha nova");
  // e ainda cria outra conta com o e-mail da demo, para a restauração esbarrar em EMAIL_EXISTS:
  // a intrusa sai, a conta guardada volta ao e-mail da demo (antes a restauração travava de vez)
  await contas(":update", { localId: dono.id, email: "golpe2@teste.dev" });
  const intrusa = (await contas("", { email: "demo@ruphus.site", password: "golpe123", emailVerified: true })).localId!;
  const r4 = await restaurarDemo(db, { slug, adminUid: "admin" });
  assert.equal((await contas(":lookup", { email: ["demo@ruphus.site"] })).users?.[0]?.localId, dono.id);
  assert.equal((await contas(":lookup", { localId: [intrusa] }).catch(() => ({ users: undefined }))).users?.length ?? 0, 0, "a intrusa foi apagada");
  assert.ok(await entra(r4.senha));
  // apagaram a conta da demo e criaram outra com o e-mail dela: a restauração tira a intrusa e cria a demo de novo
  await contas(":delete", { localId: dono.id });
  const intrusa2 = (await contas("", { email: "demo@ruphus.site", password: "golpe123", emailVerified: false })).localId!;
  const r5 = await restaurarDemo(db, { slug, adminUid: "admin" });
  const nova = (await contas(":lookup", { email: ["demo@ruphus.site"] })).users?.[0]?.localId;
  assert.ok(nova && nova !== intrusa2, "conta nova da demo, não a intrusa");
  assert.ok(await entra(r5.senha));
}

// Negócio tirado do ar (cobrança): a agenda pública não abre nem reserva, por qualquer endereço
{
  await db.doc("crm/salao").set({ publicado: false }, { merge: true });
  assert.equal(await loadCatalog(db, "salao"), null);
  assert.deepEqual(await availableSlots(db, { ...base, serviceIds: ["corte"], date: addDays(todayIn(), 9) }), []);
  const r = await book(db, { ...base, ...outro(), serviceIds: ["corte"], date: addDays(todayIn(), 9), time: "10:00" });
  assert.deepEqual([r.ok, !r.ok && "field" in r], [false, true], "recusa fica na confirmação, com o aviso");
  // reservou, a resposta se perdeu e o negócio saiu do ar: confirmar de novo ainda mostra a reserva
  await db.doc("crm/salao").set({ publicado: true }, { merge: true });
  const antesDeSair = { ...base, ...outro(), serviceIds: ["corte"], date: addDays(todayIn(), 9), time: "10:30", pedido: "fora1" };
  const feita = await book(db, antesDeSair);
  await db.doc("crm/salao").set({ publicado: false }, { merge: true });
  assert.deepEqual(await book(db, antesDeSair), feita, "fora do ar, a repetição devolve a reserva");
  await db.doc("crm/salao").set({ publicado: true }, { merge: true });
  assert.notEqual(await loadCatalog(db, "salao"), null, "de volta ao ar, abre de novo");
}

// Agenda desligada pelo dono: a página vira lista de preços e a reserva é recusada
{
  await db.doc("tenants/salao").update({ "agenda.online": false });
  assert.equal((await loadCatalog(db, "salao"))?.agendaOnline, false);
  const r = await book(db, { ...base, ...outro(), serviceIds: ["corte"], date: addDays(todayIn(), 9), time: "11:00" });
  assert.deepEqual([r.ok, !r.ok && "field" in r], [false, true], "desligada, recusa com o aviso");
  await db.doc("tenants/salao").update({ "agenda.online": true });
  assert.equal((await loadCatalog(db, "salao"))?.agendaOnline, true, "religada, agenda de novo");
}

// "Qualquer profissional": o oferecido foi tomado, vale quem está livre na mesma hora
{
  const dia = addDays(todayIn(), 10);
  const usos = async () => ((await t.collection("services").doc("corte").get()).get("usos") as number) ?? 0;
  const antes = await usos();
  assert.equal((await book(db, { ...base, ...outro(), date: dia, serviceIds: ["corte"], time: "10:00" })).ok, true, "alguém pega Ana às 10h");
  const semEscolha = await book(db, { ...base, ...outro(), date: dia, serviceIds: ["corte"], time: "10:00", qualquer: true });
  assert.deepEqual([semEscolha.ok, semEscolha.ok && semEscolha.staffName], [true, "Bia"], "qualquer: fica com a Bia");
  assert.equal((await book(db, { ...base, ...outro(), date: dia, serviceIds: ["corte"], time: "10:00" })).ok, false, "escolheu a Ana: ocupado");
  assert.equal((await book(db, { ...base, ...outro(), date: dia, serviceIds: ["corte"], time: "10:00", qualquer: true })).ok, false, "as duas ocupadas");
  // popularidade: uma vez por reserva nova, fora da transação; repetir a confirmação não conta
  assert.equal(await usos(), antes + 2);
  const c = { ...base, ...outro(), date: dia, serviceIds: ["corte"], time: "11:00", pedido: "c1" };
  const criadas: string[] = [];
  const r1 = await book(db, c, undefined, (n) => criadas.push(n.id));
  assert.deepEqual(await book(db, c, undefined, (n) => criadas.push(n.id)), r1, "confirmar de novo devolve a mesma reserva");
  assert.deepEqual(criadas, [r1.ok && r1.id], "aviso só da reserva nova, uma vez");
  assert.equal(await usos(), antes + 3, "confirmar de novo não conta de novo");
  // a mãe marca os dois filhos às 11:30 com o mesmo WhatsApp: são duas reservas, não repetição
  const mae = { ...base, ...outro(), date: dia, serviceIds: ["corte"], time: "11:30", qualquer: true };
  const filhos = [await book(db, { ...mae, pedido: "f1" }), await book(db, { ...mae, pedido: "f2" })];
  assert.deepEqual(filhos.map((f) => f.ok && f.staffName), ["Ana", "Bia"], "dois filhos, duas reservas");
  // o servidor aplica a regra de telefone da tela
  assert.equal(BookingInput.safeParse({ ...base, serviceIds: ["corte"], time: "11:00", customerPhone: "0000000000" }).success, false);
}

// "Pedir remoção" da faixa de proposta: tira do ar e registra no CRM
{
  const { assinaturaDeRemocao, assinaturaValida } = await import("@/lib/remocao.server");
  const segredo = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  assert.equal(assinaturaDeRemocao("x"), null, "sem segredo, sem assinatura");
  assert.equal(assinaturaValida("x", ""), false, "sem segredo, ninguém remove");
  process.env.CRON_SECRET = "segredo-de-teste";
  const t = assinaturaDeRemocao("rem-ok")!;
  assert.ok(assinaturaValida("rem-ok", t));
  assert.equal(assinaturaValida("rem-outro", t), false, "a assinatura é de um slug só");
  assert.equal(assinaturaValida("rem-ok", t.slice(0, -1) + "x"), false);
  assert.equal(assinaturaValida("rem-ok", undefined), false);
  if (segredo === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = segredo;

  await db.doc("config/admin").set({ uids: ["conta-ruphus"] }, { merge: true });
  const proposta = (slug: string, gerado: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    db.doc(`tenants/${slug}`).set({ name: `Casa ${slug}`, ownerId: "conta-ruphus", gerado: { sub: "salao", ...gerado }, ...extra });
  await proposta("rem-ok", { origem: "prospeccao" });
  await db.doc("crm/rem-ok").set({ estagio: "oferta" });
  assert.deepEqual(await propostaRemovivel(db, "rem-ok"), { nome: "Casa rem-ok", removida: false });
  assert.equal(await pedirRemocao(db, "rem-ok"), true);
  const c = await db.doc("crm/rem-ok").get();
  assert.deepEqual([c.get("publicado"), c.get("estagio"), c.get("motivoPerda"), c.get("estagioAntesDaRemocao")], [false, "perdido", "remocao", "oferta"], "fora do ar, perdido, motivo, estágio de antes");
  assert.ok(c.get("remocaoPedidaEm") && c.get("perdidoEm"), "data do pedido e da perda");
  const ev = await linhaDoTempo(db, "rem-ok");
  assert.ok(ev.some((e) => e.titulo === "Oferta enviada → Perdido" && e.detalhe === "Pediu a remoção da página"), "evento com o motivo");
  assert.equal(await pedirRemocao(db, "rem-ok"), true, "pedir de novo: já removida");
  assert.equal((await linhaDoTempo(db, "rem-ok")).length, ev.length, "sem evento repetido");

  // sem CRM: nasce perdido, sem marcar entrada na negociação
  await proposta("rem-sem-crm", {});
  assert.equal(await pedirRemocao(db, "rem-sem-crm"), true);
  const semCrm = await db.doc("crm/rem-sem-crm").get();
  assert.deepEqual([semCrm.get("estagio"), semCrm.get("entrouEm"), semCrm.get("estagioAntesDaRemocao")], ["perdido", undefined, "novo"]);

  // já perdido por outro motivo: o motivo de antes fica, e o pedido é registrado
  await proposta("rem-perdido", {});
  await db.doc("crm/rem-perdido").set({ estagio: "perdido", motivoPerda: "preco", detalhePerda: "achou caro" });
  assert.equal(await pedirRemocao(db, "rem-perdido"), true);
  const perdido = await db.doc("crm/rem-perdido").get();
  assert.deepEqual([perdido.get("publicado"), perdido.get("motivoPerda"), perdido.get("detalhePerda")], [false, "preco", "achou caro"]);
  assert.ok((await linhaDoTempo(db, "rem-perdido")).some((e) => e.titulo === "Página tirada do ar"));

  // não sai pelo link: cliente, em negociação, convite aceito, dono de fora, cadastro, publicado, inexistente
  await proposta("rem-cliente", {});
  await db.doc("crm/rem-cliente").set({ estagio: "fechado" });
  await proposta("rem-negociando", {});
  await db.doc("crm/rem-negociando").set({ estagio: "negociando" });
  await proposta("rem-convite", {});
  await db.doc("tenants/rem-convite/members/dono-1").set({ uid: "dono-1", role: "owner", viaConvite: true });
  await proposta("rem-dono", {}, { ownerId: "dono-de-fora" });
  await proposta("rem-cadastro", { origem: "cadastro" });
  await proposta("rem-publicado", { publicadoEm: new Date() });
  for (const slug of ["rem-cliente", "rem-negociando", "rem-convite", "rem-dono", "rem-cadastro", "rem-publicado", "rem-nao-existe"]) {
    assert.equal(await propostaRemovivel(db, slug), null, slug);
    assert.equal(await pedirRemocao(db, slug), false, slug);
  }
  assert.equal((await db.doc("crm/rem-cliente").get()).get("publicado"), undefined, "cliente intocado");
  assert.equal((await db.doc("crm/rem-convite").get()).exists, false, "convite aceito intocado");

  // teto do dia: quem raspou as assinaturas das páginas não tira tudo do ar de uma vez
  const { REMOCOES_POR_DIA, remocoesEsgotadas } = await import("@/lib/crm");
  assert.equal(await remocoesEsgotadas(db), false);
  const usadas = (await db.doc(`limitesRemocao/${todayIn()}`).get()).get("count");
  assert.equal(usadas, 3, "conta só as remoções de verdade (não as repetidas nem as negadas)");
  await db.doc(`limitesRemocao/${todayIn()}`).set({ count: REMOCOES_POR_DIA });
  await proposta("rem-cheio", {});
  assert.equal(await remocoesEsgotadas(db), true, "a página mostra o aviso em vez do botão");
  assert.equal(await pedirRemocao(db, "rem-cheio"), "cheio");
  assert.equal((await db.doc("crm/rem-cheio").get()).exists, false, "passou do teto: fica no ar");
  assert.equal(await pedirRemocao(db, "rem-ok"), true, "a já removida continua respondendo removida");
  console.log("pedir remoção: ok");
}

// SMS de confirmação e lembrete (Comtele): só com o SMS ligado no negócio, uma vez por agendamento
{
  const { avisarConfirmacaoPorSms, enviarLembretesPorSms } = await import("@/lib/sms-agendamento.server");
  const enviados: { numero: string; texto: string }[] = [];
  const enviar = async (numero: string, texto: string) => (enviados.push({ numero, texto }), "id-1");
  const falha = async () => {
    throw new Error("Comtele fora");
  };
  const dia = addDays(todayIn(), 2);
  await db.doc("tenants/sms-casa").set({ name: "Casa SMS", site: { uf: "SP", phone: "11933334444" }, sms: { ligado: true } });
  await db.doc("tenants/sms-off").set({ name: "Casa sem SMS", site: { uf: "SP" } });
  const horario = (slug: string, id: string, extra: Record<string, unknown> = {}) =>
    db.doc(`tenants/${slug}/appointments/${id}`).set({ status: "confirmed", start: zonedTime(dia, "15:00"), serviceName: "Corte", customerName: "Marina Souza", customerPhone: "5511912345678", ...extra });
  await horario("sms-casa", "a1");
  await horario("sms-off", "a1");
  await horario("sms-casa", "fixo", { customerPhone: "551133334444" });
  await horario("sms-casa", "pendente", { status: "booked" });

  assert.equal(await avisarConfirmacaoPorSms(db, "sms-off", "a1", { enviar }), "desligado");
  assert.equal(await avisarConfirmacaoPorSms(db, "sms-casa", "pendente", { enviar }), "nada a avisar", "sem confirmação, sem SMS");
  assert.equal(await avisarConfirmacaoPorSms(db, "sms-casa", "fixo", { enviar }), "sem celular", "fixo não recebe SMS");
  assert.equal(await avisarConfirmacaoPorSms(db, "sms-casa", "a1", { enviar }), "enviado");
  assert.equal(await avisarConfirmacaoPorSms(db, "sms-casa", "a1", { enviar }), "nada a avisar", "uma vez só");
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].numero, "11912345678");
  assert.match(enviados[0].texto, /^Casa SMS: seu horario .* às 15:00 \(Corte\) esta confirmado\. Imprevisto\? Ligue \(11\) 93333-4444\.$/);
  assert.equal((await db.doc("tenants/sms-casa/appointments/a1").get()).get("smsConfirmacaoId"), "id-1");

  // envio que falha devolve a reserva
  await horario("sms-casa", "a2");
  const alertas: string[] = [];
  const alertar = async (assunto: string, texto: string) => void alertas.push(`${assunto}: ${texto}`);
  assert.equal(await avisarConfirmacaoPorSms(db, "sms-casa", "a2", { enviar: falha, alertar }), "falhou");
  assert.equal((await db.doc("tenants/sms-casa/appointments/a2").get()).get("smsConfirmacaoEm"), undefined, "reserva devolvida");
  assert.equal(alertas.length, 1, "a falha vira aviso para o admin");
  assert.match(alertas[0], /tenants\/sms-casa\/appointments\/a2/);
  // erro antes do envio (banco fora, por exemplo) também não sobe para quem confirmou
  const quebrado = { doc: () => { throw new Error("banco fora"); } } as unknown as typeof db;
  assert.equal(await avisarConfirmacaoPorSms(quebrado, "sms-casa", "a2", { enviar, alertar }), "falhou");
  assert.equal(await enviarLembretesPorSms(quebrado, { enviar, alertar }), 0);
  assert.equal(alertas.length, 3);

  // lembrete: só dentro das 2 h antes, uma vez, e nunca no silêncio da noite
  enviados.length = 0;
  assert.equal(await enviarLembretesPorSms(db, { enviar, agora: zonedTime(dia, "12:30") }), 0, "cedo demais");
  assert.equal(await enviarLembretesPorSms(db, { enviar, agora: zonedTime(dia, "13:30") }), 2, "a1 e a2 (o fixo e o pendente não)");
  assert.equal(await enviarLembretesPorSms(db, { enviar, agora: zonedTime(dia, "14:00") }), 0, "uma vez só");
  assert.ok(enviados.every((e) => e.texto.startsWith("Lembrete, Marina: seu horario")), enviados[0]?.texto);
  await horario("sms-casa", "noite", { start: zonedTime(dia, "23:30") });
  assert.equal(await enviarLembretesPorSms(db, { enviar, agora: zonedTime(dia, "22:15") }), 0, "silêncio das 22h às 7h30");

  // configuração por negócio: confirmação e lembrete separados, e quantas horas antes
  await db.doc("tenants/sms-cfg").set({ name: "Casa Config", site: { uf: "SP" }, sms: { ligado: true, confirmacao: false, lembrete: true, horasAntes: 4 } });
  await horario("sms-cfg", "c1");
  assert.equal(await avisarConfirmacaoPorSms(db, "sms-cfg", "c1", { enviar }), "desligado", "confirmação desmarcada");
  assert.equal(await enviarLembretesPorSms(db, { enviar, agora: zonedTime(dia, "10:30") }), 0, "4h30 antes: ainda não");
  assert.equal(await enviarLembretesPorSms(db, { enviar, agora: zonedTime(dia, "11:30") }), 1, "3h30 antes, com 4 h escolhidas: sai");
  await db.doc("tenants/sms-cfg").set({ sms: { lembrete: false } }, { merge: true });
  await horario("sms-cfg", "c2", { start: zonedTime(dia, "16:00") });
  assert.equal(await enviarLembretesPorSms(db, { enviar, agora: zonedTime(dia, "15:00") }), 0, "lembrete desmarcado");
  const { configSms } = await import("@/lib/sms-agendamento.server");
  assert.deepEqual(configSms({ ligado: true }), { ligado: true, confirmacao: true, lembrete: true, horasAntes: 2 }, "sem escolha: tudo ligado, 2 h");
  assert.equal(configSms({ horasAntes: 5 }).horasAntes, 2, "valor fora da lista volta ao padrão");
  console.log("sms no agendamento: ok");
}

// /painel: os negócios da conta, pelo servidor, por nome; "members" fora de tenants/ não conta
await db.doc("tenants/zeta").set({ name: "Alfa" }); // nome antes do slug: a ordem é a do nome
await db.doc("tenants/zeta/members/lista").set({ uid: "lista", role: "admin" });
await db.doc("tenants/salao/members/lista").set({ uid: "lista", role: "estranho" });
await db.doc("outros/x/members/lista").set({ uid: "lista", role: "owner" });
const lista = await negociosDe(db, "lista");
assert.deepEqual(Object.fromEntries(lista.map((n) => [n.id, n.role])), { salao: "member", zeta: "admin" }, "papel desconhecido vira member");
assert.deepEqual(lista.map((n) => n.id), ["zeta", "salao"], "por nome");
assert.deepEqual(await negociosDe(db, "ninguem"), []);

console.log("booking ok");
process.exit(0);
