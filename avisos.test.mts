import assert from "node:assert/strict";
import { Inscricao, quando } from "@/lib/avisos.server";

// o "quando" do aviso, visto de uma sexta (2026-10-02)
assert.equal(quando("2026-10-02", "10:30", "2026-10-02"), "hoje às 10:30");
assert.equal(quando("2026-10-03", "09:00", "2026-10-02"), "amanhã às 09:00");
assert.equal(quando("2026-10-09", "14:00", "2026-10-02"), "sexta, 09/10 às 14:00");
assert.equal(quando("2026-11-01", "08:15", "2026-10-31"), "amanhã às 08:15", "virada do mês");
console.log("quando ok");

// inscrição: só https, com as duas chaves
const boa = { endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys: { p256dh: "B".repeat(87), auth: "a".repeat(22) } };
assert.equal(Inscricao.safeParse(boa).success, true);
assert.equal(Inscricao.safeParse({ ...boa, endpoint: "http://fcm.googleapis.com/x" }).success, false);
assert.equal(Inscricao.safeParse({ ...boa, keys: { p256dh: boa.keys.p256dh } }).success, false);
console.log("inscrição ok");
