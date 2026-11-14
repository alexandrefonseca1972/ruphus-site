// Rode: npm run test:avaliacoes
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { concluirAtendimento, reschedule, rescheduleSlots } from "@/lib/booking.server";
import { abrirAvaliacao, hashTokenAvaliacao, refAvaliacao, responderAvaliacao, tokenAvaliacao } from "@/lib/avaliacoes.server";
import { enviarAvaliacoesDoDia } from "@/lib/avaliacoes-whatsapp.server";
import { mediaGeral, primeiroNome, RespostaAvaliacao } from "@/lib/avaliacoes";
import { TERMO_WHATSAPP_VERSAO } from "@/lib/consentimento-whatsapp";
import { todayIn } from "@/lib/datetime";

process.env.CRON_SECRET = "segredo-de-teste-para-avaliacoes";
assert.equal(mediaGeral({ servico: 5, profissional: 4, atendimento: 5, ambiente: null, localizacao: null }), 14 / 3);
assert.equal(primeiroNome("  Maria   Souza "), "Maria");
assert.equal(RespostaAvaliacao.safeParse({}).success, false);

const db = getFirestore(getApps()[0] ?? initializeApp({ projectId: "demo-siteflow" }));
const agora = new Date("2026-11-13T11:30:00.000Z");
const at = (iso: string) => Timestamp.fromDate(new Date(iso));
const consentimento = { aceito: true, versao: TERMO_WHATSAPP_VERSAO, em: new Date("2026-11-13T09:00:00.000Z") };
const baseAgenda = {
  status: "confirmed",
  start: at("2026-11-13T10:00:00.000Z"),
  end: at("2026-11-13T10:30:00.000Z"),
  serviceIds: ["corte"], serviceName: "Corte", staffId: "ana", staffName: "Ana",
  customerKey: "5511999990000", customerName: "Maria Souza", customerPhone: "5511999990000", whatsappConsent: consentimento,
};

await db.doc("tenants/loja").set({
  name: "Salão Teste", site: { uf: "SP", phone: "5511988880000" }, whatsapp: { canalOficial: true },
  avaliacoes: { enabled: true, delayMin: 30, enabledAt: at("2026-11-13T10:00:00.000Z") },
});
await db.doc("tenants/loja/members/maria").set({ uid: "maria", role: "member", staffId: "ana" });
const agenda = (id: string, extra: Record<string, unknown> = {}) => db.doc(`tenants/loja/appointments/${id}`).set({ ...baseAgenda, completedAt: at("2026-11-13T11:00:00.000Z"), ...extra });
await agenda("a1");
await agenda("cedo", { completedAt: at("2026-11-13T11:01:00.000Z") });
await agenda("antes", { completedAt: at("2026-11-13T09:59:00.000Z") });
await agenda("semcon", { whatsappConsent: { ...consentimento, versao: "2026-11-08" } });
await agenda("cancelado", { status: "cancelled" });
await agenda("booked", { status: "booked" });
await db.doc("tenants/desligada").set({ name: "Desligada", avaliacoes: { enabled: false } });
await db.doc("tenants/desligada/appointments/a1").set(baseAgenda);
await db.doc("tenants/am").set({
  name: "Manaus", site: { uf: "AM", phone: "5511988880000" }, whatsapp: { canalOficial: true },
  avaliacoes: { enabled: true, delayMin: 30, enabledAt: at("2026-11-13T10:00:00.000Z") },
});
await db.doc("tenants/am/appointments/a1").set({ ...baseAgenda, completedAt: at("2026-11-13T11:00:00.000Z") });

const envios: { key?: string; prazo?: Date; template: { nome: string; parametros: string[] } }[] = [];
const deps = {
  conexao: async () => ({ atendysApiKey: "teste", instanceId: "teste" }),
  enviar: async (_c: unknown, _phone: string, template: { nome: string; parametros: string[] }, _optIn: unknown, prazo?: Date, opcoes?: { chave?: string }) => {
    envios.push({ key: opcoes?.chave, prazo, template });
    return { messageId: `m${envios.length}`, status: "sent", destino: "enviada" as const };
  },
};
assert.equal(await enviarAvaliacoesDoDia(db, agora, deps), 1);
assert.equal(envios.length, 1);
assert.equal(envios[0].template.nome, "avaliacao_atendimento");
assert.match(envios[0].template.parametros[4], /\/avaliar\/loja\/a1\?t=[a-f0-9]{64}$/);
assert.equal(envios[0].prazo?.toISOString(), "2026-11-20T11:30:00.000Z", "a fila não entrega depois da validade do link");
const a1 = await refAvaliacao(db, "loja", "a1").get();
assert.equal(a1.get("status"), "enviada");
assert.equal(a1.get("token"), undefined, "token nunca é gravado em texto puro");
assert.ok(a1.get("tokenHash"));
assert.equal((await db.doc("tenants/loja/appointments/a1").get()).get("reviewRequestCreatedAt") != null, true);
for (const id of ["cedo", "antes", "cancelado", "booked"]) assert.equal((await refAvaliacao(db, "loja", id).get()).exists, false, id);
assert.equal((await refAvaliacao(db, "loja", "semcon").get()).get("status"), "ignorada", "aceite antigo não cobre avaliação");
assert.equal((await refAvaliacao(db, "desligada", "a1").get()).exists, false);
assert.equal((await refAvaliacao(db, "am", "a1").get()).exists, false, "7h30 em Manaus ainda é horário silencioso");
await enviarAvaliacoesDoDia(db, agora, deps);
assert.equal(envios.length, 1, "cron repetido não reenvia");

const token = tokenAvaliacao("loja", "a1");
assert.equal(token.length, 64);
assert.equal(token, tokenAvaliacao("loja", "a1"), "retry reutiliza o mesmo link");
assert.equal((await abrirAvaliacao(db, "loja", "a1", token))?.status, "aberta");
assert.equal(await abrirAvaliacao(db, "loja", "a1", "0".repeat(64)), null);
assert.equal(await abrirAvaliacao(db, "am", "a1", token), null, "token não cruza tenant");
assert.equal(Object.hasOwn((await abrirAvaliacao(db, "loja", "a1", token)) ?? {}, "tokenHash"), false);

const notas = { servico: 5, profissional: 5, atendimento: 4, ambiente: null, localizacao: null };
const resposta = { tenantId: "loja", appointmentId: "a1", token, notas, comentario: "  <script>alert(1)</script>\u200b\n  Ótimo   atendimento  " };
const respondida = await responderAvaliacao(db, resposta, "203.0.113.10");
assert.deepEqual(respondida, { ok: true, already: false });
const salva = await refAvaliacao(db, "loja", "a1").get();
assert.equal(salva.get("status"), "respondida");
assert.equal(salva.get("notaGeral"), 14 / 3);
assert.equal(salva.get("comentario"), "<script>alert(1)</script>\nÓtimo atendimento");
assert.deepEqual(await responderAvaliacao(db, { ...resposta, comentario: "mudança não vale" }, "203.0.113.10"), { ok: true, already: true });
assert.equal((await refAvaliacao(db, "loja", "a1").get()).get("comentario"), "<script>alert(1)</script>\nÓtimo atendimento");
assert.equal((await abrirAvaliacao(db, "loja", "a1", token))?.status, "respondida");
assert.equal((await responderAvaliacao(db, { ...resposta, notas: { ...notas, servico: 6 } })).ok, false);
assert.equal((await responderAvaliacao(db, { ...resposta, appointmentId: "semcon" })).ok, false, "token não responde outro atendimento");

// Expiração e rate limit por hash de IP.
await agenda("exp");
await refAvaliacao(db, "loja", "exp").set({ status: "enviada", tokenHash: hashTokenAvaliacao(tokenAvaliacao("loja", "exp")), expiraEm: at("2026-11-12T00:00:00.000Z"), customerName: "Exp", businessName: "Salão", serviceName: "Corte", staffName: "Ana", siteUrl: "https://loja.ruphus.site/" });
assert.equal((await abrirAvaliacao(db, "loja", "exp", tokenAvaliacao("loja", "exp")))?.status, "expirada");
assert.equal((await responderAvaliacao(db, { ...resposta, appointmentId: "exp", token: tokenAvaliacao("loja", "exp") })).ok, false);
await agenda("limite");
await refAvaliacao(db, "loja", "limite").set({ status: "enviada", tokenHash: hashTokenAvaliacao(tokenAvaliacao("loja", "limite")), expiraEm: at("2026-11-20T00:00:00.000Z") });
const ipHash = createHash("sha256").update("ruphus-avaliacao-ip:203.0.113.11").digest("hex").slice(0, 16);
await db.doc(`tenants/loja/limits/review-${ipHash}-${todayIn()}`).set({ count: 10 });
assert.match((await responderAvaliacao(db, { ...resposta, appointmentId: "limite", token: tokenAvaliacao("loja", "limite") }, "203.0.113.11")).error ?? "", /Muitas tentativas/);

// Conclusão explícita: só depois do fim, pelo profissional certo, uma vez e sem remarcação depois.
await agenda("futuro", { completedAt: null, end: new Date(Date.now() + 60_000) });
await assert.rejects(concluirAtendimento(db, { tenantId: "loja", appointmentId: "futuro" }, { uid: "dona" }), /ainda não terminou/);
await agenda("de-outra", { completedAt: null, staffId: "bia" });
await assert.rejects(concluirAtendimento(db, { tenantId: "loja", appointmentId: "de-outra" }, { uid: "maria" }), /outro profissional/);
await agenda("concluir", { completedAt: null, status: "booked", end: Timestamp.fromMillis(Date.now() - 60_000) });
await concluirAtendimento(db, { tenantId: "loja", appointmentId: "concluir" }, { uid: "maria", email: "maria@teste.dev" });
const concluido = await db.doc("tenants/loja/appointments/concluir").get();
assert.equal(concluido.get("status"), "confirmed");
assert.ok(concluido.get("completedAt"));
assert.equal((await db.doc(`tenants/loja/history/${concluido.get("lastHistoryId")}`).get()).get("type"), "completed");
const quando = concluido.get("completedAt").toMillis();
await concluirAtendimento(db, { tenantId: "loja", appointmentId: "concluir" }, { uid: "maria" });
assert.equal((await db.doc("tenants/loja/appointments/concluir").get()).get("completedAt").toMillis(), quando);
assert.equal((await db.collection("tenants/loja/history").where("appointmentId", "==", "concluir").where("type", "==", "completed").get()).size, 1);
assert.deepEqual(await rescheduleSlots(db, { tenantId: "loja", appointmentId: "concluir", date: "2026-11-20" }, false), []);
assert.equal((await reschedule(db, { tenantId: "loja", appointmentId: "concluir", date: "2026-11-20", time: "09:00" }, { uid: "dona" }, { exigirAtivo: false })).ok, false);

// Falha transitória: espera backoff e repete a mesma chave/link; cron concorrente envia uma vez.
await agenda("retry");
let tentativas = 0;
const retryKeys: (string | undefined)[] = [];
const retryDeps = { ...deps, enviar: async (...args: Parameters<typeof deps.enviar>) => {
  tentativas += 1;
  retryKeys.push(args[5]?.chave);
  if (tentativas === 1) throw new Error("rede");
  return deps.enviar(...args);
} };
await enviarAvaliacoesDoDia(db, agora, retryDeps);
assert.equal((await refAvaliacao(db, "loja", "retry").get()).get("status"), "pendente");
await enviarAvaliacoesDoDia(db, agora, retryDeps);
assert.equal(tentativas, 1, "backoff impede retry imediato");
await enviarAvaliacoesDoDia(db, new Date(agora.getTime() + 11 * 60_000), retryDeps);
assert.ok(tentativas >= 2);
assert.equal(retryKeys[1], retryKeys[0], "retry usa a mesma chave de idempotência");
assert.equal((await refAvaliacao(db, "loja", "retry").get()).get("status"), "enviada");

await agenda("sem-campanha");
await db.doc("tenants/loja/customers/5511999990000").set({ semCampanha: true });
await enviarAvaliacoesDoDia(db, agora, deps);
assert.equal((await refAvaliacao(db, "loja", "sem-campanha").get()).get("status"), "ignorada");
await db.doc("tenants/loja/customers/5511999990000").set({ semCampanha: false });

await agenda("vencido");
const falhaVencido = { ...deps, enviar: async (...args: Parameters<typeof deps.enviar>) => {
  if (args[2].parametros[4].includes("/vencido?")) throw new Error("rede antes do vencimento");
  return deps.enviar(...args);
} };
await enviarAvaliacoesDoDia(db, agora, falhaVencido);
assert.equal((await refAvaliacao(db, "loja", "vencido").get()).get("status"), "pendente");
await enviarAvaliacoesDoDia(db, new Date(agora.getTime() + 8 * 24 * 60 * 60_000), deps);
assert.equal((await refAvaliacao(db, "loja", "vencido").get()).get("status"), "ignorada", "convite vencido não entra na fila do WhatsApp");

await agenda("concorrente");
const antesConcorrencia = envios.length;
await Promise.all([enviarAvaliacoesDoDia(db, agora, deps), enviarAvaliacoesDoDia(db, agora, deps)]);
assert.equal(envios.length - antesConcorrencia, 1, "duas execuções não duplicam a mensagem");

await db.terminate();
console.log("avaliacoes: ok");
