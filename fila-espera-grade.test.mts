// Rode: npx tsx fila-espera-grade.test.mts  (pura, sem emulador)
import assert from "node:assert/strict";
import { ocupadosDoDia, zonedTime } from "@/lib/datetime";

const dia = "2026-11-20";
const antes = new Date("2026-11-19T12:00:00Z");
const janela = { start: "09:00", end: "12:00" };

// sem nada livre: uma opção por hora (o corte de 1h não vira 15 em 15 min)
assert.deepEqual(ocupadosDoDia({ date: dia, windows: [janela], durationMin: 60, livres: new Set([]), now: antes }), ["09:00", "10:00", "11:00"]);

// 09:00 está livre: fica de fora e a contagem recomeça em 09:15
assert.deepEqual(ocupadosDoDia({ date: dia, windows: [janela], durationMin: 60, livres: new Set(["09:00"]), now: antes }), ["09:15", "10:15"]);

// 10:00 a 10:45 livres: o recomeço cai em 11:00, não em 10:00
assert.deepEqual(
  ocupadosDoDia({ date: dia, windows: [janela], durationMin: 60, livres: new Set(["10:00", "10:15", "10:30", "10:45"]), now: antes }),
  ["09:00", "11:00"],
);

// agora é 10:30: 09:00 a 10:30 já passaram (10:30 inclusive), sobra 10:45
assert.deepEqual(ocupadosDoDia({ date: dia, windows: [janela], durationMin: 60, livres: new Set([]), now: zonedTime(dia, "10:30") }), ["10:45"]);

// sem janela de expediente neste dia da semana: nada
assert.deepEqual(ocupadosDoDia({ date: dia, windows: [undefined], durationMin: 60, livres: new Set([]), now: antes }), []);

// serviço de 30 min: início a cada 30 min
assert.deepEqual(ocupadosDoDia({ date: dia, windows: [janela], durationMin: 30, livres: new Set([]), now: antes }), [
  "09:00",
  "09:30",
  "10:00",
  "10:30",
  "11:00",
  "11:30",
]);

// Equipe com janelas que começam em horas diferentes: junta antes de rarear
assert.deepEqual(
  ocupadosDoDia({ date: dia, windows: [janela, { start: "09:15", end: "12:00" }], durationMin: 60, livres: new Set(), now: antes }),
  ["09:00", "10:00", "11:00"],
  "sem 09:15 e 10:15 intercalados",
);

console.log("fila-espera-grade ok");
