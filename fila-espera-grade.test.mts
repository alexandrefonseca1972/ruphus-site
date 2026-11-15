// Rode: npm run test:espera-f2  (fila de espera: os horários ocupados que a agenda pública mostra; sem rede)
import assert from "node:assert/strict";
import { ocupadosDoDia, zonedTime } from "@/lib/datetime";

const dia = "2026-12-01";
const antes = zonedTime("2026-11-30", "12:00");
const as = (hora: string, data = dia) => zonedTime(data, hora);

// O começo de cada atendimento, em ordem e sem repetir (dois profissionais às 10:00 = um botão)
assert.deepEqual(ocupadosDoDia({ date: dia, inicios: [as("11:00"), as("09:00"), as("10:00"), as("10:00")], livres: new Set(), now: antes }), ["09:00", "10:00", "11:00"]);

// Horário que outro profissional ainda pode atender não é ocupado
assert.deepEqual(ocupadosDoDia({ date: dia, inicios: [as("09:00"), as("10:00")], livres: new Set(["09:00"]), now: antes }), ["10:00"]);

// Já passou (ou está dentro da antecedência, que quem chama soma ao now): fica de fora
assert.deepEqual(ocupadosDoDia({ date: dia, inicios: [as("09:00"), as("10:00"), as("11:00")], livres: new Set(), now: as("10:00") }), ["11:00"]);

// Atendimento de outro dia não entra
assert.deepEqual(ocupadosDoDia({ date: dia, inicios: [as("09:00", "2026-12-02")], livres: new Set(), now: antes }), []);

// Dia sem agendamento
assert.deepEqual(ocupadosDoDia({ date: dia, inicios: [], livres: new Set(), now: antes }), []);

console.log("fila-espera-grade ok");
