// Rode: npx tsx fila-espera.test.mts  (regras puras da fila de espera, sem Firestore)
import assert from "node:assert/strict";
import {
  compativel,
  EntradaEsperaInput,
  ordenar,
  paraMin,
  podeAvisar,
  prazoDoAviso,
  venceEm,
  type Espera,
} from "@/lib/fila-espera";

const base: Espera = {
  id: "e1",
  tipo: "esperar",
  customerKey: "k1",
  nome: "Ana Souza",
  telefone: "11912345678",
  serviceIds: ["s1"],
  staffId: null,
  data: "2026-12-01",
  preferido: "14:00",
  status: "aguardando",
  criadaEm: 1,
  avisos: [],
};
const vaga = { data: "2026-12-01", inicio: "14:00", staffId: "p1", livreAteMin: 15 * 60 };
const ctx = { duracaoMin: 60, hoje: "2026-11-15", agoraMin: 10 * 60 };

// compativel: caso feliz e cada regra isolada
assert.ok(compativel(base, vaga, ctx));
assert.ok(!compativel(base, { ...vaga, livreAteMin: 15 * 60 - 1 }, ctx), "termina 1 min depois da vaga");
assert.ok(compativel(base, { ...vaga, livreAteMin: 15 * 60 }, ctx), "termina exatamente na vaga");
assert.ok(!compativel({ ...base, status: "avisada" }, vaga, ctx));
assert.ok(!compativel({ ...base, data: "2026-12-02" }, vaga, ctx), "outro dia");
assert.ok(!compativel({ ...base, staffId: "p2" }, vaga, ctx), "outro profissional");
assert.ok(compativel({ ...base, staffId: "p1" }, vaga, ctx), "mesmo profissional");
assert.ok(compativel(base, { ...vaga, staffId: "qualquer-outro" }, ctx), "staffId null casa com qualquer um");

// antecedência: exatamente 60 min vale, 59 não
const mesmoDia = { ...base, data: "2026-11-15" };
const vagaHoje = { ...vaga, data: "2026-11-15" };
assert.ok(compativel(mesmoDia, vagaHoje, { ...ctx, agoraMin: 14 * 60 - 60 }), "exatamente 60 min");
assert.ok(!compativel(mesmoDia, vagaHoje, { ...ctx, agoraMin: 14 * 60 - 59 }), "59 min não vale");
// outro dia ignora agoraMin
assert.ok(compativel(base, vaga, { ...ctx, agoraMin: 99999 }), "dia futuro ignora a antecedência");
assert.ok(!compativel({ ...base, data: "2026-11-14" }, { ...vaga, data: "2026-11-14" }, { ...ctx, hoje: "2026-11-15", agoraMin: 0 }), "dia passado");

// troca só serve no horário exato
const troca: Espera = { ...base, tipo: "troca", staffId: "p1", preferido: "14:00" };
assert.ok(compativel(troca, vaga, ctx), "troca no horário exato");
assert.ok(!compativel(troca, { ...vaga, inicio: "15:00", livreAteMin: 18 * 60 }, ctx), "troca em outro horário");

// ordenar: esperar antes de troca; exato antes; depois distância, criadaEm, id
const lista: Espera[] = [
  { ...base, id: "a", preferido: "10:00", criadaEm: 1 },
  { ...base, id: "b", preferido: "14:00", criadaEm: 5 },
  { ...base, id: "c", tipo: "troca", preferido: "14:00", criadaEm: 0 },
  { ...base, id: "d", preferido: "13:00", criadaEm: 2 },
  { ...base, id: "e", preferido: "15:00", criadaEm: 2 },
  { ...base, id: "f", preferido: "15:00", criadaEm: 1 },
];
const entrada = [...lista];
const ordem = ordenar(lista, "14:00");
assert.deepEqual(ordem.map((e) => e.id), ["b", "f", "d", "e", "a", "c"]);
assert.deepEqual(lista, entrada, "não altera a entrada");
assert.notEqual(ordem, lista);

// podeAvisar
const H = 60 * 60000;
assert.ok(podeAvisar([], 100 * H));
assert.ok(!podeAvisar([100 * H - 5 * H], 100 * H), "último aviso há 5 h");
assert.ok(podeAvisar([100 * H - 7 * H], 100 * H), "último aviso há 7 h");
assert.ok(!podeAvisar([100 * H - 7 * H, 100 * H - 8 * H], 100 * H), "dois nas últimas 24 h");
assert.ok(podeAvisar([100 * H - 25 * H, 100 * H - 7 * H], 100 * H), "um de 25 h atrás não conta");

// prazoDoAviso
assert.equal(prazoDoAviso(1000), 1000 + 10 * 60000);

// venceEm
assert.deepEqual(venceEm(troca), { data: "2026-12-01", ateMin: 13 * 60 }, "troca morre 60 min antes do preferido");
assert.deepEqual(venceEm(base), { data: "2026-12-01", ateMin: 24 * 60 });
assert.equal(paraMin("09:30"), 570);

// EntradaEsperaInput
const entradaValida = {
  tenantId: "t1",
  serviceIds: ["s1"],
  staffId: "p1",
  date: "2026-12-01",
  customerName: "Maria Silva",
  customerPhone: "(11) 91234-5678",
  preferido: "14:00",
  aceite: true,
  token: "abcdefghijklmnop",
};
assert.ok(EntradaEsperaInput.safeParse(entradaValida).success);
assert.equal(EntradaEsperaInput.parse({ ...entradaValida, staffId: "" }).staffId, null, "qualquer profissional vira null");

const erro = (x: unknown) => {
  const r = EntradaEsperaInput.safeParse(x);
  assert.ok(!r.success);
  return r.error.issues.map((i) => i.message);
};
assert.ok(erro({ ...entradaValida, aceite: false }).includes("Marque o aceite para receber o aviso no WhatsApp."));
assert.ok(erro({ ...entradaValida, token: "curto" }).length > 0, "token curto");
assert.ok(erro({ ...entradaValida, token: "abc/def/ghi/jkl/mno" }).length > 0, "token com barra");
assert.ok(erro({ ...entradaValida, preferido: "25:00" }).length > 0, "preferido inválido");

console.log("fila-espera ok");
