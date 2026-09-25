// Rode: npm run test:lembrete
import assert from "node:assert/strict";
import { ics, linkGoogleAgenda, mapas } from "@/lib/lembrete";
import { zonedTime } from "@/lib/datetime";

// 28/09 às 11:30 em São Paulo é 14:30 em UTC: é o que a agenda do celular precisa
const c = {
  id: "barbearia-force-2026-09-28-1130",
  titulo: "Corte Masculino · Barbearia Force",
  inicio: zonedTime("2026-09-28", "11:30"),
  fim: zonedTime("2026-09-28", "12:00"),
  local: "Rua A, 10; Trem, Macapá/AP",
  detalhes: "Com Mario Pessoa\nR$ 30,00, paga no local",
};
const arquivo = ics(c, new Date("2026-09-25T12:00:00Z"));
assert.ok(arquivo.includes("DTSTART:20260928T143000Z") && arquivo.includes("DTEND:20260928T150000Z"), "horário em UTC");
assert.ok(arquivo.includes("DTSTAMP:20260925T120000Z"));
assert.ok(arquivo.includes("LOCATION:Rua A\\, 10\\; Trem\\, Macapá/AP"), "vírgula e ; escapados");
assert.ok(arquivo.includes("DESCRIPTION:Com Mario Pessoa\\nR$ 30\\,00\\, paga no local"), "quebra de linha vira \\n");
assert.ok(arquivo.includes("UID:barbearia-force-2026-09-28-1130@ruphus.site"));
assert.ok(arquivo.includes("TRIGGER:-PT2H"), "lembra 2 horas antes");
assert.ok(arquivo.split("\r\n").length > 10 && !/[^\r]\n/.test(arquivo), "linhas terminam em CRLF");
assert.ok(!ics({ ...c, local: "" }).includes("LOCATION:"), "sem endereço, sem LOCATION");

const g = new URL(linkGoogleAgenda(c));
assert.equal(g.searchParams.get("dates"), "20260928T143000Z/20260928T150000Z");
assert.equal(g.searchParams.get("location"), c.local);
assert.equal(new URL(linkGoogleAgenda({ ...c, local: "" })).searchParams.get("location"), null);

const m = mapas("Trem, Macapá/AP");
assert.equal(new URL(m.google).searchParams.get("query"), "Trem, Macapá/AP");
assert.equal(new URL(m.waze).searchParams.get("q"), "Trem, Macapá/AP");
assert.equal(new URL(m.embed).searchParams.get("output"), "embed");
console.log("lembrete: ok");
