// Rode: npm run test:espera-f4  (motor da fila: libera vaga, avisa a espera certa, expira aviso, no emulador)
// Nenhum envio real: o aviso é injetado e só grava a chamada.
process.env.ATENDYS_TEMPLATE_ESPERA = "1";
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb as db } from "@/lib/admin";
import { book } from "@/lib/booking.server";
import { addDays, customerKey, todayIn, zonedTime } from "@/lib/datetime";
import { EntradaEsperaInput } from "@/lib/fila-espera";
import { DEMO } from "@/lib/demo";
import { entrarNaFila, expirarAvisos, processarLiberacoes, type Enviar } from "@/lib/fila-espera.server";

// import dinâmico: o estático carrega outra cópia do módulo e o instanceof do motor não reconhece o erro
const { SemSaldo } = await import("@/lib/consumo.server");
const slug = "espera-motor";
const t = db.doc(`tenants/${slug}`);
const d1 = addDays(todayIn(), 7);
const d2 = addDays(todayIn(), 8);
const base = Date.now();
const agora = new Date(base);
const ip = "189.6.10.30";
const telA = "11 91234-5678";
const telB = "11 98765-4321";
const telT = "11 96666-0001";
const telE = "11 95555-0001";
const fone = (n: number) => `11 97000-${String(n).padStart(4, "0")}`;

// Cursor do evento: cada cancelamento ganha um instante maior que o anterior (o cursor só anda para a frente)
let k = 0;
const tick = () => Timestamp.fromMillis(base + ++k * 1000);

await db.recursiveDelete(t);
await db.recursiveDelete(db.doc("tenants/espera-motor-off"));
await db.doc("config/cron").delete();
await db.doc("config/alertas").delete();
// o limite por telefone vale entre negócios (coleção raiz): limpa o que outra rodada deixou
await Promise.all([telA, telB, telT, telE, ...Array.from({ length: 30 }, (_, i) => fone(i))].map((f) => db.doc(`esperaFones/${customerKey(f)}`).delete()));
await t.set({ name: "Espera Motor", ownerId: "dona", modulos: { espera: true } });
await t.collection("services").doc("corte").set({ name: "Corte", durationMin: 60, priceCents: 5000, active: true });
const hours = Object.fromEntries(["0", "1", "2", "3", "4", "5", "6"].map((d) => [d, { start: "09:00", end: "12:00" }]));
await t.collection("staff").doc("ana").set({ name: "Ana", serviceIds: ["corte"], hours, active: true });

const agendou = (r: Awaited<ReturnType<typeof book>>) => {
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.ok ? r.id : "";
};
const marcar = (date: string, time: string, customerName: string, customerPhone: string) =>
  book(db, { tenantId: slug, serviceIds: ["corte"], staffId: "ana", date, time, customerName, customerPhone }).then(agendou);

let entradas = 0;
const entrar = async (over: Record<string, unknown>, criadaEm: number) => {
  const input = EntradaEsperaInput.parse({
    tenantId: slug,
    serviceIds: ["corte"],
    staffId: "ana",
    date: d1,
    customerName: "Pessoa Teste",
    customerPhone: telA,
    preferido: "10:00",
    aceite: true,
    token: `token${criadaEm}AAAAAAAAAAAAAAAA`,
    ...over,
  });
  // o aparelho tem limite de 10 pedidos por dia: um IP novo a cada 9 entradas
  const r = await entrarNaFila(db, input, `${ip}${Math.floor(entradas++ / 9) || ""}`, new Date(criadaEm));
  assert.equal(r.ok, true, JSON.stringify(r));
  return r.ok ? r.id : "";
};

// Dia 1: 10:00 (cliente de outro telefone) e 11:00 (Clara) ocupados; Tiago tem 09:00 e quer trocar para 11:00
const apt10 = await marcar(d1, "10:00", "Outro Cliente", "11 90000-1111");
const aptClara = await marcar(d1, "11:00", "Clara Dias", "11 90000-3333");
const aptT = await marcar(d1, "09:00", "Tiago Reis", telT);
const idA = await entrar({ customerName: "Maria Silva", customerPhone: telA, preferido: "10:00" }, base - 3000);
const idB = await entrar({ customerName: "Bruno Lima", customerPhone: telB, preferido: "10:00" }, base - 2000);
const idT = await entrar({ customerName: "Tiago Reis", customerPhone: telT, preferido: "11:00", agendamentoId: aptT }, base - 1000);

// Dia 2: 09:00 ocupado por outro cliente; Erica espera esse horário
const aptD2 = await marcar(d2, "09:00", "Outro Dois", "11 90000-2222");
const idE = await entrar({ date: d2, customerName: "Erica Lima", customerPhone: telE, preferido: "09:00" }, base - 500);

// Negócio com o módulo desligado: a espera existe, mas o motor não pode tocar nela
const off = db.doc("tenants/espera-motor-off");
await off.set({ name: "Sem fila", modulos: { espera: false } });
await off.collection("services").doc("corte").set({ name: "Corte", durationMin: 60, priceCents: 5000, active: true });
await off.collection("appointments").doc("ag1").set({ status: "cancelled", staffId: "ana", start: Timestamp.fromDate(zonedTime(d1, "10:00")) });
await off.collection("espera").doc("x").set({
  tipo: "esperar", customerKey: customerKey("11 92222-0000"), nome: "Fulano", telefone: customerKey("11 92222-0000"), serviceIds: ["corte"],
  staffId: null, data: d1, preferido: "10:00", status: "aguardando", criadaEm: 1, avisos: [], tokenHash: "x",
  consentimento: { aceito: true, versao: "x", em: new Date() },
});
await off.collection("history").doc("h1").set({ appointmentId: "ag1", type: "cancelled", at: tick() });

const cancelar = async (aptId: string) => {
  const hist = t.collection("history").doc();
  const at = tick();
  await hist.set({ appointmentId: aptId, type: "cancelled", reason: "teste", at });
  await t.collection("appointments").doc(aptId).update({ status: "cancelled", lastHistoryId: hist.id });
  return { eventoId: hist.id, at };
};

const enviados: Parameters<Enviar>[0][] = [];
let falhar: unknown = null;
const destinos: Record<string, string> = {}; // telefone -> destino que o atendys devolve
const enviar: Enviar = async (args) => {
  enviados.push(args);
  if (falhar) throw falhar;
  return { destino: destinos[args.telefone] ?? "enviada" };
};
const status = async (id: string) => (await t.collection("espera").doc(id).get()).get("status");

// 1. Cancelamento das 10:00: A (entrou primeiro) recebe o aviso, e só ele. O evento do outro negócio é ignorado.
await cancelar(apt10);
assert.deepEqual(await processarLiberacoes(db, { agora, enviar }), { eventos: 2, avisos: 1 });
assert.equal(enviados.length, 1, JSON.stringify(enviados));
assert.equal(enviados[0].slug, slug);
assert.equal(enviados[0].telefone, customerKey(telA));
assert.ok(JSON.stringify(enviados[0].template).includes(idA), "o botão leva o id da espera");
assert.equal(await status(idA), "avisada");
assert.equal(await status(idB), "aguardando");

// 2. Repetir não manda nada: o cursor já passou do evento
assert.deepEqual(await processarLiberacoes(db, { agora, enviar }), { eventos: 0, avisos: 0 });
assert.equal(enviados.length, 1);

// 3. Sem resposta no prazo (10 min): A volta a aguardando e a vaga das 10:00 vai para B
assert.deepEqual(await expirarAvisos(db, { agora: new Date(base + 11 * 60_000), enviar }), { expiradas: 0, avisos: 1 });
assert.equal(enviados.length, 2);
assert.equal(enviados[1].telefone, customerKey(telB));
assert.equal(await status(idA), "aguardando");
assert.equal(await status(idB), "avisada");

// 4. Cancelamento das 11:00: A está no limite de 6 h do telefone dele, então não recebe; Tiago (troca de 09:00
//    para 11:00) é avisado, porque 11:00 é exatamente o preferido dele
await cancelar(aptClara);
assert.deepEqual(await processarLiberacoes(db, { agora, enviar }), { eventos: 1, avisos: 1 });
assert.equal(enviados.length, 3);
assert.equal(enviados[2].telefone, customerKey(telT));
assert.equal(await status(idA), "aguardando");
assert.equal(await status(idT), "avisada");

// 5. Template desligado: o evento passa, o cursor anda, nada sai
delete process.env.ATENDYS_TEMPLATE_ESPERA;
const desligado = await cancelar(aptD2);
assert.deepEqual(await processarLiberacoes(db, { agora, enviar }), { eventos: 1, avisos: 0 });
assert.equal(enviados.length, 3, "com o template desligado não manda");
assert.equal(await status(idE), "aguardando");
assert.equal((await db.doc("config/cron").get()).get("esperaCursor").toMillis(), desligado.at.toMillis());
process.env.ATENDYS_TEMPLATE_ESPERA = "1";

// 6. Sem saldo: a espera volta a aguardando, sem aviso registrado; o motor não insiste no mesmo evento
const aptD2b = await marcar(d2, "09:00", "Outro Tres", "11 90000-4444");
await cancelar(aptD2b);
falhar = new SemSaldo("Mensagem não enviada: sem saldo");
assert.deepEqual(await processarLiberacoes(db, { agora, enviar }), { eventos: 1, avisos: 0 });
falhar = null;
assert.equal(enviados.length, 4);
assert.equal(await status(idE), "aguardando");
assert.deepEqual((await t.collection("espera").doc(idE).get()).get("avisos"), []);
assert.equal((await t.collection("esperaPendentes").get()).size, 0, "sem saldo não vira pendência");

// 7. Módulo desligado: o negócio é ignorado por completo
assert.equal((await off.collection("espera").doc("x").get()).get("status"), "aguardando");
assert.equal(enviados.some((e) => e.slug === "espera-motor-off"), false);

// Esperas fora do motor (DEMO, negócio apagado): expiram pela data mesmo assim
const esperaDireta = (ref: FirebaseFirestore.DocumentReference, telefone: string, data: string, extra: Record<string, unknown> = {}) =>
  ref.set({
    tipo: "esperar", customerKey: customerKey(telefone), nome: "Fixa Teste", telefone: customerKey(telefone), serviceIds: ["corte"], staffId: null,
    data, preferido: "10:00", status: "aguardando", criadaEm: 1, avisos: [], tokenHash: "x", consentimento: { aceito: true, versao: "x", em: new Date() }, ...extra,
  });
const naDemo = db.doc(`tenants/${DEMO}/espera/motor-teste`);
const semNegocio = db.doc("tenants/espera-motor-sumiu/espera/z");
await esperaDireta(naDemo, fone(28), d1);
await esperaDireta(semNegocio, fone(29), d1);

// 8. Dia passou: a espera que sobrou expira
const depoisDoDia = new Date(Date.parse(`${addDays(d2, 1)}T12:00:00-03:00`));
const exp = await expirarAvisos(db, { agora: depoisDoDia, enviar });
assert.ok(exp.expiradas >= 1, JSON.stringify(exp));
assert.equal(await status(idE), "expirada");
// módulo desligado, DEMO e negócio apagado também: só o envio depende do negócio
assert.equal((await off.collection("espera").doc("x").get()).get("status"), "expirada");
assert.equal((await naDemo.get()).get("status"), "expirada");
assert.equal((await semNegocio.get()).get("status"), "expirada");
await naDemo.delete();
await semNegocio.delete();

const dia = (n: number) => addDays(todayIn(), n);
const rodar = (quando = agora) => processarLiberacoes(db, { agora: quando, enviar });
const doDia = (d: string) => enviados.filter((a) => JSON.stringify(a.template).includes(`${d}T`));

// 9. Remarcação: a vaga é o horário de antes (from), não o novo
const d3 = dia(9);
const apt3 = await marcar(d3, "10:00", "Outro Cliente", fone(1));
const idP = await entrar({ date: d3, customerName: "Paula Reis", customerPhone: fone(2), preferido: "10:00" }, base + 100);
{
  const ref = t.collection("appointments").doc(apt3);
  const ag = await ref.get();
  const start = zonedTime(d3, "11:00");
  const end = new Date(start.getTime() + 60 * 60_000);
  const hist = t.collection("history").doc();
  await hist.set({ appointmentId: apt3, type: "rescheduled", at: tick(), from: { start: ag.get("start"), end: ag.get("end") }, to: { start, end } });
  await ref.update({ start, end, lastHistoryId: hist.id });
}
assert.deepEqual(await rodar(), { eventos: 1, avisos: 1 });
assert.equal(enviados.at(-1)!.telefone, customerKey(fone(2)));
assert.ok(JSON.stringify(enviados.at(-1)!.template).includes(`${d3}T10:00`), "oferece o horário antigo");
assert.equal(await status(idP), "avisada");

// 10. Só dentro da janela que vagou: 10:00 está livre desde sempre, mas quem vagou foi 11:00-12:00
const d4 = dia(10);
await marcar(d4, "09:00", "Outro Cliente", fone(3));
const apt4 = await marcar(d4, "11:00", "Outro Cliente", fone(4));
await entrar({ date: d4, customerName: "Quitéria Melo", customerPhone: fone(5), preferido: "09:00" }, base + 200);
await cancelar(apt4);
assert.deepEqual(await rodar(), { eventos: 1, avisos: 1 });
assert.ok(JSON.stringify(enviados.at(-1)!.template).includes(`${d4}T11:00`), "11:00, não 10:00 (fora da vaga)");

// 11. Troca: só o preferido exato, e dentro da vaga. Vagou 10:00, a troca quer 11:00: ninguém é avisado
const d5 = dia(11);
const aptT2 = await marcar(d5, "09:00", "Tadeu Lins", fone(6));
await marcar(d5, "11:00", "Outro Cliente", fone(7));
const apt5 = await marcar(d5, "10:00", "Outro Cliente", fone(8));
const idT2 = await entrar({ date: d5, customerName: "Tadeu Lins", customerPhone: fone(6), preferido: "11:00", agendamentoId: aptT2 }, base + 300);
await cancelar(apt5);
const antes11 = enviados.length;
assert.deepEqual(await rodar(), { eventos: 1, avisos: 0 });
assert.equal(enviados.length, antes11);
assert.equal(await status(idT2), "aguardando");

// 12. Reprocessar (cursor voltou): a marca da vaga impede novo aviso, mesmo com outra espera que serviria
const idP2 = "motor-p2";
await esperaDireta(t.collection("espera").doc(idP2), fone(9), d3);
await db.doc("config/cron").set({ esperaCursor: Timestamp.fromMillis(base), esperaCursorIds: [] }, { merge: true });
const antes12 = enviados.length;
assert.equal((await rodar()).avisos, 0);
assert.equal(enviados.length, antes12, "nada de novo a ninguém");
assert.equal(await status(idP2), "aguardando");

// 13. Falha comum vira pendência: 1 envio + 4 retentativas; na 5ª o admin é avisado e para
const d6 = dia(12);
const apt6 = await marcar(d6, "10:00", "Outro Cliente", fone(10));
const idR = await entrar({ date: d6, customerName: "Rita Alves", customerPhone: fone(11), preferido: "10:00" }, base + 400);
const ev6 = await cancelar(apt6);
falhar = new Error("atendys fora");
const antes13 = enviados.length;
assert.deepEqual(await rodar(), { eventos: 1, avisos: 0 });
for (let i = 0; i < 5; i++) await rodar();
falhar = null;
assert.equal(enviados.length - antes13, 5, "para depois de 5 tentativas");
assert.equal((await t.collection("esperaPendentes").doc(`${ev6.eventoId}-1`).get()).get("tentativas"), 5);
assert.ok((await db.doc("config/alertas").get()).get(`espera-pendente-${slug}`), "admin avisado");
assert.equal(await status(idR), "aguardando");
assert.deepEqual((await db.doc(`esperaFones/${customerKey(fone(11))}`).get()).get("avisos"), [], "o que não saiu não conta no limite");

// 14. nao_sai (opt-out, número inválido): a reserva é desfeita e a vaga vai à próxima espera
const d7 = dia(13);
const apt7 = await marcar(d7, "10:00", "Outro Cliente", fone(12));
const idS1 = await entrar({ date: d7, customerName: "Sara Costa", customerPhone: fone(13), preferido: "10:00" }, base + 500);
const idS2 = await entrar({ date: d7, customerName: "Saulo Dias", customerPhone: fone(14), preferido: "10:00" }, base + 600);
destinos[customerKey(fone(13))] = "nao_sai";
await cancelar(apt7);
assert.deepEqual(await rodar(), { eventos: 1, avisos: 1 });
assert.deepEqual(doDia(d7).map((a) => a.telefone), [customerKey(fone(13)), customerKey(fone(14))]);
assert.equal(await status(idS1), "aguardando");
assert.equal(await status(idS2), "avisada");

// 15. Limite por telefone entre esperas: 2 avisos em 24 h, mesmo que uma das esperas já tenha saído
const [d8, d9, d10] = [dia(14), dia(15), dia(16)];
const [apt8, apt9, apt10b] = [await marcar(d8, "10:00", "Outro", fone(16)), await marcar(d9, "10:00", "Outro", fone(17)), await marcar(d10, "10:00", "Outro", fone(18))];
const idH1 = await entrar({ date: d8, customerName: "Helena Paz", customerPhone: fone(15), preferido: "10:00" }, base + 700);
const idH2 = await entrar({ date: d9, customerName: "Helena Paz", customerPhone: fone(15), preferido: "10:00" }, base + 800);
const idH3 = await entrar({ date: d10, customerName: "Helena Paz", customerPhone: fone(15), preferido: "10:00" }, base + 900);
const H = 3_600_000;
await cancelar(apt8);
assert.equal((await rodar(new Date(base))).avisos, 1);
await t.collection("espera").doc(idH1).update({ status: "saiu" });
await cancelar(apt9);
assert.equal((await rodar(new Date(base + 7 * H))).avisos, 1);
assert.equal(await status(idH2), "avisada");
await cancelar(apt10b);
assert.equal((await rodar(new Date(base + 14 * H))).avisos, 0, "3º aviso em 24 h: bloqueado");
assert.equal(await status(idH3), "aguardando");

// 16. No máximo 3 avisos por vaga: a 4ª espera nunca é avisada
const d11 = dia(17);
const apt11 = await marcar(d11, "10:00", "Outro Cliente", fone(19));
const idC = [];
for (let i = 0; i < 4; i++) idC.push(await entrar({ date: d11, customerName: `Cliente ${"ABCD"[i]}`, customerPhone: fone(20 + i), preferido: "10:00" }, base + 1000 + i));
await cancelar(apt11);
await rodar();
for (const min of [11, 22, 33]) await expirarAvisos(db, { agora: new Date(base + min * 60_000), enviar });
assert.deepEqual(doDia(d11).map((a) => a.telefone), [20, 21, 22].map((n) => customerKey(fone(n))));
assert.equal(await status(idC[3]), "aguardando");

// 16b. Troca só com o profissional do agendamento: vagou 10:00 com a Bia, o agendamento é com a Ana
const d12 = dia(18);
await t.collection("staff").doc("bia").set({ name: "Bia", serviceIds: ["corte"], hours, active: true });
const aptAna = await marcar(d12, "09:00", "Tadeu Lins", fone(24));
const aptBia = agendou(await book(db, { tenantId: slug, serviceIds: ["corte"], staffId: "bia", date: d12, time: "10:00", customerName: "Outro Cliente", customerPhone: fone(25) }));
const idTB = "motor-troca-bia";
await esperaDireta(t.collection("espera").doc(idTB), fone(24), d12, { tipo: "troca", agendamentoId: aptAna, preferido: "10:00" });
await cancelar(aptBia);
assert.equal((await rodar()).avisos, 0);
assert.deepEqual(doDia(d12), [], "a troca não recebe vaga de outro profissional");
assert.equal(await status(idTB), "aguardando");

// 16c. DEMO com o módulo ligado, espera e cancelamento: nada sai para a DEMO
const d13 = dia(19);
const demo = db.doc(`tenants/${DEMO}`);
const demoAntes = await demo.get();
await demo.set({ name: "Demo", modulos: { espera: true } }, { merge: true });
await demo.collection("services").doc("motor-corte").set({ name: "Corte", durationMin: 60, priceCents: 5000, active: true });
await demo.collection("appointments").doc("motor-ag").set({ status: "cancelled", staffId: "ana", start: Timestamp.fromDate(zonedTime(d13, "10:00")), durationMin: 60 });
await demo.collection("history").doc("motor-h").set({ appointmentId: "motor-ag", type: "cancelled", at: tick() });
const esperaDemo = demo.collection("espera").doc("motor-demo");
await esperaDireta(esperaDemo, fone(29), d13, { serviceIds: ["motor-corte"] });
await rodar();
assert.equal(enviados.some((e) => e.slug === DEMO), false, "a DEMO nunca manda aviso");
assert.equal((await esperaDemo.get()).get("status"), "aguardando");
await Promise.all([esperaDemo, demo.collection("services").doc("motor-corte"), demo.collection("appointments").doc("motor-ag"), demo.collection("history").doc("motor-h")].map((r) => r.delete()));
await (demoAntes.exists ? demo.set(demoAntes.data()!) : demo.delete());

// 16d. Espera sem consentimento.em não é avisada: a vaga vai à próxima, e nada sai para aquele telefone
const apt13 = await marcar(d13, "10:00", "Outro Cliente", fone(28));
const idSemAceite = "motor-sem-aceite";
const idComAceite = "motor-com-aceite";
await esperaDireta(t.collection("espera").doc(idSemAceite), fone(26), d13, { consentimento: null, criadaEm: 0 });
await esperaDireta(t.collection("espera").doc(idComAceite), fone(27), d13, { criadaEm: 2 });
await cancelar(apt13);
assert.equal((await rodar()).avisos, 1);
assert.deepEqual(doDia(d13).map((a) => a.telefone), [customerKey(fone(27))], "sem aceite não recebe; a próxima sim");
assert.equal(await status(idSemAceite), "aguardando");
assert.equal(await status(idComAceite), "avisada");

// 17. Trava do cron: com outra execução em andamento, a rota sai sem trabalho
process.env.CRON_SECRET = "segredo-teste";
await db.doc("config/cron").set({ esperaLease: { ate: Date.now() + 60_000 } }, { merge: true });
const { GET } = await import("@/app/api/cron/fila-espera/route");
const resposta = await GET(new Request("http://localhost/api/cron/fila-espera", { headers: { authorization: "Bearer segredo-teste" } }) as never);
assert.deepEqual(await resposta.json(), { ok: true, ocupado: true });

