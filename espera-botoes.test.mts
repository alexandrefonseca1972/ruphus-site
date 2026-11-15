// Rode: npm run test:espera-f5  (respostas da fila de espera: eq, es, en, et, em, no emulador do Firestore)
// Nenhum WhatsApp real: a resposta e a reoferta da vaga são injetadas e só gravam o que sairia.
process.env.ATENDYS_TEMPLATE_ESPERA = "1";
import assert from "node:assert/strict";
import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { adminDb as db } from "@/lib/admin";
import { lerBotao } from "@/lib/canal-oficial.server";
import { addDays, customerKey, todayIn, zonedTime } from "@/lib/datetime";
import { respostaDaEspera } from "@/lib/fila-espera-botoes.server";
import { book } from "@/lib/booking.server";
import type { Enviar } from "@/lib/fila-espera.server";

const slug = "espera-botoes";
const t = db.doc(`tenants/${slug}`);
const d = addDays(todayIn(), 7);
const telA = "11 91234-5678";
const telB = "11 98765-4321";
const fone = (n: number) => `11 97100-${String(n).padStart(4, "0")}`;
const dia = (n: number) => addDays(d, n);

await db.recursiveDelete(t);
// o limite de avisos por telefone vale entre negócios (coleção raiz): limpa o que outra rodada deixou
await Promise.all(Array.from({ length: 10 }, (_, i) => db.doc(`esperaFones/${customerKey(fone(i))}`).delete()));
await t.set({ name: "Salão Botões", ownerId: "dona", modulos: { espera: true } });
await t.collection("services").doc("corte").set({ name: "Corte", durationMin: 60, priceCents: 5000, active: true });
const hours = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((x) => [x, { start: "09:00", end: "18:00" }]));
await t.collection("staff").doc("ana").set({ name: "Ana", serviceIds: ["corte"], hours, active: true });

const marcar = async (time: string, customerPhone: string, customerName = "Outro Cliente", date = d) => {
  const r = await book(db, { tenantId: slug, serviceIds: ["corte"], staffId: "ana", date, time, customerName, customerPhone });
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.ok ? r.id : "";
};
const ocupados = async (time: string) =>
  (await t.collection("appointments").where("start", "==", Timestamp.fromDate(zonedTime(d, time))).get()).docs.filter((x) =>
    ["booked", "confirmed"].includes(String(x.get("status"))),
  ).length;
const aviso = (inicio: string, prazo = Date.now() + 10 * 60_000, data = d) => ({ data, inicio, ateMin: 24 * 60, staffId: "ana", eventoId: `ev-${data}-${inicio.replace(":", "")}`, tentativa: 1, prazo });
const seed = (id: string, over: Record<string, unknown>) =>
  t.collection("espera").doc(id).set({
    tipo: "esperar",
    customerKey: customerKey(telA),
    nome: "Maria Silva",
    telefone: customerKey(telA),
    serviceIds: ["corte"],
    staffId: "ana",
    data: d,
    preferido: "10:00",
    status: "avisada",
    criadaEm: Date.now(),
    avisos: [],
    tokenHash: "x",
    consentimento: { aceito: true, versao: "espera-2026-11", em: new Date() },
    avisoAtual: aviso("10:00"),
    ...over,
  });
const botao = (acao: string, espera: string, extra?: string) => {
  const b = lerBotao(`rph:${acao}:${slug}:${espera}${extra ? `:${extra}` : ""}`);
  assert.ok(b, "id de botão inválido");
  return b;
};
const get = async (id: string, campo: string) => (await t.collection("espera").doc(id).get()).get(campo);

let textos: string[] = [];
const responder = async (texto: string) => {
  textos.push(texto);
};
const enviados: Parameters<Enviar>[0][] = [];
const enviar: Enviar = async (args) => {
  enviados.push(args);
};
const tocar = (b: ReturnType<typeof botao>, telefone = telA, banco: Firestore = db) => respostaDaEspera(banco, b, telefone, { responder, enviar });
/** Outra espera do mesmo dia, na fila: a candidata da reoferta. */
const candidata = (id: string, data: string, telefone: string) =>
  seed(id, { data, status: "aguardando", avisoAtual: null, customerKey: customerKey(telefone), telefone: customerKey(telefone), nome: "Bruno Lima" });
const ofertado = (data: string, inicio: string) => enviados.filter((a) => JSON.stringify(a.template).includes(`${data}T${inicio}`)).map((a) => a.telefone);

// Cancelamento das 10:00: o horário fica livre (o agendamento cancelado não ocupa)
const apt10 = await marcar("10:00", "11 90000-1111");
await t.collection("appointments").doc(apt10).update({ status: "cancelled" });

// 1. eq: reserva o horário oferecido e responde
await seed("e1", {});
assert.equal(await tocar(botao("eq", "e1", `${d}T10:00`)), "agendada");
assert.equal(await get("e1", "status"), "agendada");
const reservado = String(await get("e1", "agendamentoId"));
assert.ok(reservado, "a espera guarda a reserva");
assert.equal(await ocupados("10:00"), 1);
assert.equal(textos.length, 1, JSON.stringify(textos));
assert.ok(textos[0].startsWith("Pronto, Maria! Reservamos Corte"), textos[0]);
assert.ok(!textos[0].includes("confirma com você por aqui"), "não promete confirmação pelo WhatsApp");
assert.equal((await t.collection("appointments").doc(reservado).get()).get("whatsappConsent.aceito"), false, "sem aceite de WhatsApp na reserva");

// 2. eq de novo (toque repetido): a mesma reserva, sem outra marca
textos = [];
assert.equal(await tocar(botao("eq", "e1", `${d}T10:00`)), "agendada");
assert.equal(await get("e1", "agendamentoId"), reservado);
assert.equal(await ocupados("10:00"), 1);
assert.ok(textos[0]?.includes("Reservamos"));
// o limite de 3 marcações por telefone: a reserva da espera já foi conferida, sai daqui
await t.collection("appointments").doc(reservado).update({ status: "cancelled" });

// 2b. eq depois que a reserva foi cancelada: a espera acabou, nada de reserva nova
textos = [];
assert.equal(await tocar(botao("eq", "e1", `${d}T10:00`)), "terminou");
assert.equal(await ocupados("10:00"), 0);
assert.equal(await get("e1", "agendamentoId"), reservado);
assert.ok(textos[0]?.includes("terminou"), textos[0]);

// 3. eq com o prazo vencido: não reserva, avisa que venceu
await seed("e2", { avisoAtual: aviso("11:00", Date.now() - 60_000) });
textos = [];
assert.equal(await tocar(botao("eq", "e2", `${d}T11:00`)), "aviso vencido");
assert.equal(await get("e2", "status"), "avisada");
assert.equal(await ocupados("11:00"), 0);
assert.ok(textos[0]?.includes("venceu"), textos[0]);

// 4. eq quando o horário foi ocupado antes: volta a aguardando e avisa
await marcar("12:00", "11 90000-1212");
await seed("e3", { avisoAtual: aviso("12:00") });
textos = [];
assert.equal(await tocar(botao("eq", "e3", `${d}T12:00`)), "ocupado");
assert.equal(await get("e3", "status"), "aguardando");
assert.equal(await get("e3", "avisoAtual"), undefined);
assert.ok(textos[0]?.includes("acabou de ser marcado"), textos[0]);

// 5. outro telefone: nada muda e não há resposta
await seed("e4", { avisoAtual: aviso("13:00") });
textos = [];
assert.equal(await tocar(botao("eq", "e4", `${d}T13:00`), telB), "outro telefone");
assert.equal(await get("e4", "status"), "avisada");
assert.equal(textos.length, 0);

// 5b. botão antigo (outro horário no id): não reserva nem o horário do botão nem o do aviso
await seed("e11", { avisoAtual: aviso("13:00") });
textos = [];
assert.equal(await tocar(botao("eq", "e11", `${d}T12:30`)), "aviso vencido");
assert.equal(await get("e11", "status"), "avisada");
assert.equal(await ocupados("13:00"), 0);
assert.ok(textos[0]?.includes("venceu"), textos[0]);
await t.collection("espera").doc("e11").update({ status: "saiu" });

// 5c. o prazo passou enquanto a reserva saía (expirarAvisos pôs em aguardando): a espera fica agendada
{
  const dr = dia(1);
  const telR = "11 97200-0001";
  await seed("e12", { data: dr, telefone: customerKey(telR), customerKey: customerKey(telR), avisoAtual: aviso("10:00", Date.now() + 10 * 60_000, dr) });
  let feito = false;
  // a primeira transação é a da reserva: antes dela, o cron devolve a espera à fila
  const corrida = new Proxy(db, {
    get(alvo, campo) {
      if (campo === "runTransaction" && !feito) {
        feito = true;
        return async (...args: Parameters<Firestore["runTransaction"]>) => {
          await t.collection("espera").doc("e12").update({ status: "aguardando", avisoAtual: FieldValue.delete() });
          return alvo.runTransaction(...args);
        };
      }
      const v = Reflect.get(alvo, campo);
      return typeof v === "function" ? v.bind(alvo) : v;
    },
  });
  textos = [];
  assert.equal(await tocar(botao("eq", "e12", `${dr}T10:00`), telR, corrida), "agendada");
  assert.ok(feito, "a corrida aconteceu");
  assert.equal(await get("e12", "status"), "agendada");
  assert.ok(await get("e12", "agendamentoId"));
  assert.equal(await get("e12", "avisoAtual.inicio"), "10:00");
  await t.collection("appointments").doc(String(await get("e12", "agendamentoId"))).update({ status: "cancelled" });
}

// 5d. eq numa espera de troca: o botão certo é o de trocar; nada é reservado
await seed("e13", { tipo: "troca", agendamentoId: "nenhum", preferido: "13:00", avisoAtual: aviso("13:00") });
textos = [];
assert.equal(await tocar(botao("eq", "e13", `${d}T13:00`)), "troca");
assert.equal(await get("e13", "status"), "avisada");
assert.equal(await ocupados("13:00"), 0);
assert.equal(textos[0], "Use o botão Trocar de horário.");
await t.collection("espera").doc("e13").update({ status: "saiu" });

// 6. es: só serve o preferido; o aviso de outro horário volta à fila
await seed("e5", { avisoAtual: aviso("15:00") });
textos = [];
assert.equal(await tocar(botao("es", "e5", `${d}T15:00`)), "volta");
assert.equal(await get("e5", "exato"), true);
assert.equal(await get("e5", "status"), "aguardando");
assert.ok(textos[0]?.includes("só avisamos se vagar 10:00"), textos[0]);

// 6b. es, en e em numa espera avisada: a vaga vai já à próxima espera da fila (sem esperar o prazo)
for (const [n, acao] of [[2, "es"], [3, "en"], [4, "em"]] as const) {
  const dx = dia(n);
  const ap = acao === "em" ? await marcar("09:00", fone(n), "Maria Silva", dx) : undefined;
  const troca = ap ? { tipo: "troca", agendamentoId: ap, preferido: "11:00", telefone: customerKey(fone(n)), customerKey: customerKey(fone(n)) } : {};
  await seed(`r${n}`, { data: dx, preferido: "11:00", avisoAtual: aviso("11:00", Date.now() + 10 * 60_000, dx), ...troca });
  await candidata(`c${n}`, dx, fone(n + 3));
  assert.deepEqual(ofertado(dx, "11:00"), []);
  await tocar(botao(acao, `r${n}`, `${dx}T11:00`), ap ? fone(n) : telA);
  assert.notEqual(await get(`r${n}`, "status"), "avisada", acao);
  assert.deepEqual(ofertado(dx, "11:00"), [customerKey(fone(n + 3))], `${acao}: a vaga foi oferecida à próxima`);
  assert.equal(await get(`c${n}`, "status"), "avisada");
  assert.equal(await get(`c${n}`, "avisoAtual.tentativa"), 2);
}

// 7. en: sai da fila
await seed("e6", {});
textos = [];
assert.equal(await tocar(botao("en", "e6", `${d}T10:00`)), "saiu");
assert.equal(await get("e6", "status"), "saiu");
assert.equal(await get("e6", "motivo"), "whatsapp");
assert.ok(textos[0]?.includes("saiu da fila"), textos[0]);

// 8. et: troca o 14:00 do cliente pelo 17:00 oferecido; o 14:00 fica livre
const ap14 = await marcar("14:00", telA, "Maria Silva");
await seed("e7", { tipo: "troca", agendamentoId: ap14, preferido: "17:00", avisoAtual: aviso("17:00") });
textos = [];
assert.equal(await tocar(botao("et", "e7", `${d}T17:00`)), "trocada");
assert.equal(await get("e7", "status"), "trocada");
assert.equal(await ocupados("14:00"), 0);
assert.equal(await ocupados("17:00"), 1);
await t.collection("appointments").doc(ap14).update({ status: "cancelled" });
assert.ok(textos[0]?.includes("Pronto!"), textos[0]);

// 9. et com o horário ocupado: o 09:00 continua e a espera volta a aguardando
const ap09 = await marcar("09:00", telA, "Maria Silva");
await seed("e8", { tipo: "troca", agendamentoId: ap09, preferido: "16:00", avisoAtual: aviso("16:00") });
await marcar("16:00", "11 90000-1616");
textos = [];
assert.equal(await tocar(botao("et", "e8", `${d}T16:00`)), "ocupado");
assert.equal(await get("e8", "status"), "aguardando");
assert.equal(await ocupados("09:00"), 1);
assert.ok(textos[0]?.includes("acabou de ser marcado"), textos[0]);

// 9b. et com sinal pendente: não remarca; o cliente fala com o negócio e a vaga vai à próxima espera
{
  const ds = dia(5);
  const apS = await marcar("09:00", fone(1), "Maria Silva", ds);
  await t.collection("appointments").doc(apS).update({ "sinal.status": "pendente" });
  await seed("e14", { tipo: "troca", agendamentoId: apS, data: ds, preferido: "11:00", telefone: customerKey(fone(1)), customerKey: customerKey(fone(1)), avisoAtual: aviso("11:00", Date.now() + 10 * 60_000, ds) });
  await candidata("c14", ds, fone(0));
  textos = [];
  assert.equal(await tocar(botao("et", "e14", `${ds}T11:00`), fone(1)), "precisa do negócio");
  assert.equal(String((await t.collection("appointments").doc(apS).get()).get("start").toDate().getTime()), String(zonedTime(ds, "09:00").getTime()), "não remarcou");
  assert.equal(await get("e14", "status"), "saiu");
  assert.equal(await get("e14", "motivo"), "precisa-do-negocio");
  assert.ok(textos[0]?.startsWith("Para trocar este horário, fale com"), textos[0]);
  assert.deepEqual(ofertado(ds, "11:00"), [customerKey(fone(0))]);
}

// 9c. et com o agendamento cancelado: a espera sai e a vaga vai à próxima espera
{
  const di = dia(6);
  const apI = await marcar("09:00", fone(9), "Maria Silva", di);
  await t.collection("appointments").doc(apI).update({ status: "cancelled" });
  await seed("e15", { tipo: "troca", agendamentoId: apI, data: di, preferido: "11:00", telefone: customerKey(fone(9)), customerKey: customerKey(fone(9)), avisoAtual: aviso("11:00", Date.now() + 10 * 60_000, di) });
  await candidata("c15", di, fone(8));
  textos = [];
  assert.equal(await tocar(botao("et", "e15", `${di}T11:00`), fone(9)), "agendamento inativo");
  assert.equal(await get("e15", "status"), "saiu");
  assert.equal(await get("e15", "motivo"), "agendamento-inativo");
  assert.deepEqual(ofertado(di, "11:00"), [customerKey(fone(8))]);
}

// 10. em: mantém o horário atual e sai da fila
const ap11 = await marcar("11:00", telA, "Maria Silva");
await seed("e9", { tipo: "troca", agendamentoId: ap11, preferido: "13:00", avisoAtual: aviso("13:00") });
textos = [];
assert.equal(await tocar(botao("em", "e9", `${d}T13:00`)), "mantido");
assert.equal(await get("e9", "status"), "saiu");
assert.equal(await get("e9", "motivo"), "manteve");
assert.equal(await ocupados("11:00"), 1);
assert.ok(textos[0]?.includes("mantivemos"), textos[0]);

// 10b. eq e um agendamento pelo site no mesmo instante, pelo mesmo horário: só um fica com ele, e a espera
//      fica coerente (agendada se ganhou, de volta a aguardando se perdeu)
{
  const dc = dia(10);
  // telefone próprio: o de Maria já está no limite de marcações
  const telC = "11 93333-0016";
  await seed("e16", { data: dc, telefone: customerKey(telC), customerKey: customerKey(telC), avisoAtual: aviso("10:00", Date.now() + 10 * 60_000, dc) });
  const [r] = await Promise.all([
    tocar(botao("eq", "e16", `${dc}T10:00`), telC),
    book(db, { tenantId: slug, serviceIds: ["corte"], staffId: "ana", date: dc, time: "10:00", customerName: "Outro Cliente", customerPhone: "11 90000-1010" }),
  ]);
  const ativos = (await t.collection("appointments").where("start", "==", Timestamp.fromDate(zonedTime(dc, "10:00"))).get()).docs.filter((x) =>
    ["booked", "confirmed"].includes(String(x.get("status"))),
  ).length;
  assert.equal(ativos, 1, "um só agendamento ativo no horário");
  assert.equal(await get("e16", "status"), r === "agendada" ? "agendada" : "aguardando", r);
}

// 11. sinal ligado: a resposta de reserva traz o Pix copia e cola numa segunda mensagem
await t.update({ pix: { chave: "52998224725", nome: "Ana Souza", cidade: "Belem" }, sinal: { ativo: true, tipo: "percentual", valor: 30, prazoMin: 30 } });
await seed("e10", { avisoAtual: aviso("15:00") });
textos = [];
assert.equal(await tocar(botao("eq", "e10", `${d}T15:00`)), "agendada");
assert.equal(textos.length, 2, JSON.stringify(textos));
assert.ok(textos[0].includes("sinal"), textos[0]);
assert.ok(textos[1].startsWith("000201"), textos[1]);

// 12. módulo desligado depois do aviso: só o telefone da espera fica sabendo; nada muda
await t.update({ "modulos.espera": false });
await seed("e17", { avisoAtual: aviso("16:30") });
textos = [];
assert.equal(await tocar(botao("en", "e17", `${d}T16:30`), telB), "outro telefone");
assert.equal(textos.length, 0, "outro telefone não recebe nada");
assert.equal(await tocar(botao("en", "e17", `${d}T16:30`)), "desligado");
assert.equal(textos.length, 1, JSON.stringify(textos));
assert.ok(textos[0].includes("Salão Botões") && textos[0].endsWith("foi encerrada."), textos[0]);
assert.equal(await get("e17", "status"), "avisada");
