// Rode: npm run test:prospeccao-fb  (telemetria do roteador de IA em iaChamadas; Firestore no emulador, provedor mock)
import assert from "node:assert/strict";
import { Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { adminDb } from "@/lib/admin";
import { ambienteFirestore, chamarIA, gastoHoje, lerRoteamento, registrarChamada, type Provedor } from "@/lib/ia-roteador.server";
import { todayIn } from "@/lib/datetime";
import type { ModeloId } from "@/lib/tipos-marca";

assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "rode pelo emulador (npm run test:prospeccao-fb)");
const db = adminDb;
const limpar = async () => {
  const s = await db.collection("iaChamadas").get();
  await Promise.all(s.docs.map((d) => d.ref.delete()));
  await db.doc("config/ia-roteamento").delete();
};
await limpar();

// sem config: vale o padrão; config inválida também cai no padrão (e loga)
assert.deepEqual(await lerRoteamento(db), {});
await db.doc("config/ia-roteamento").set({ sugerir_resposta: { cadeia: [] } });
assert.deepEqual(await lerRoteamento(db), {}, "inválida vira padrão");
// MEDIUM-1: para o roteador, a inválida é null (orçamento esgotado), não o padrão sem teto
assert.equal(await ambienteFirestore(db).config(), null, "inválida: o roteador recebe null");
await assert.rejects(chamarIA({ tarefa: "visual_site", entrada: { sistema: "s", mensagens: [{ role: "user", content: "oi" }] }, schema: z.object({}) }), /orçamento de IA do dia acabou/, "config inválida não libera o Opus");

// cadeia: um elo que falha e o mock; a falha e o sucesso viram dois docs
await db.doc("config/ia-roteamento").set({
  sugerir_resposta: { cadeia: [{ provedor: "local", modelo: "quebrado", maxTokens: 50, timeoutMs: 1000 }, { provedor: "mock", modelo: "mock", maxTokens: 50, timeoutMs: 1000 }] },
});
const falha: Provedor = async () => {
  throw new Error("sem servidor local");
};
const amb = ambienteFirestore(db);
const Saida = z.object({ resposta: z.string(), etapaSugerida: z.string(), motivo: z.string() });
const antes = Date.now();
const r = await chamarIA({ tarefa: "sugerir_resposta", entrada: { sistema: "s", mensagens: [{ role: "user", content: "oi" }] }, schema: Saida }, { ...amb, provedores: { ...amb.provedores, local: falha } });
assert.equal(r.provedor, "mock");

const docs = (await db.collection("iaChamadas").orderBy("ok").get()).docs.map((d) => d.data());
assert.equal(docs.length, 2, "uma linha por tentativa");
const [erro, ok] = docs;
assert.deepEqual(
  [erro.tarefa, erro.modelo, erro.provedor, erro.ok, erro.erro, erro.fallbackDe],
  ["sugerir_resposta", "quebrado", "local", false, "Error", undefined],
);
assert.deepEqual([ok.modelo, ok.provedor, ok.ok, ok.fallbackDe, ok.custoCentavos, ok.tokensEntrada, ok.tokensSaida], ["mock", "mock", true, "quebrado", 0, 0, 0]);
for (const d of docs) {
  assert.equal(typeof d.latenciaMs, "number");
  assert.equal(d.dia, todayIn());
  assert.ok(d.criadaEm instanceof Timestamp, "criadaEm do servidor");
  assert.ok(d.expiraEm instanceof Timestamp, "expiraEm para a política de TTL");
  const dias = (d.expiraEm.toMillis() - antes) / 86_400_000;
  assert.ok(dias >= 89.99 && dias <= 90.01, `TTL de 90 dias (${dias})`);
}

// gasto do dia soma o custo da tarefa e só dela
const base = { modelo: "claude-haiku-5-5" as ModeloId, provedor: "anthropic" as const, tokensEntrada: 0, tokensSaida: 0, latenciaMs: 1, ok: true };
await registrarChamada(db, { ...base, tarefa: "sugerir_resposta", custoCentavos: 1.5 });
await registrarChamada(db, { ...base, tarefa: "sugerir_resposta", custoCentavos: 2 });
await registrarChamada(db, { ...base, tarefa: "agente_lead", custoCentavos: 100 });
assert.equal(await gastoHoje(db, "sugerir_resposta"), 3.5);
assert.equal(await gastoHoje(db, "classificar_resposta"), 0);

// corte por max_tokens com uso > 0 entra no gasto do dia
const cortado: Provedor = async () => ({ bruto: null, tokensEntrada: 1000, tokensSaida: 2000, parada: "max_tokens" });
await assert.rejects(
  chamarIA(
    { tarefa: "personalizar", entrada: { sistema: "s", mensagens: [{ role: "user", content: "oi" }] }, schema: Saida },
    { ...amb, config: async () => ({ personalizar: { cadeia: [{ provedor: "anthropic", modelo: "claude-haiku-5-5" as ModeloId, maxTokens: 50, timeoutMs: 1000 }] } }), provedores: { ...amb.provedores, anthropic: cortado } },
  ),
);
assert.ok((await gastoHoje(db, "personalizar")) > 0, "corte custa");

await limpar();
console.log("ia-telemetria: ok");
process.exit(0);
