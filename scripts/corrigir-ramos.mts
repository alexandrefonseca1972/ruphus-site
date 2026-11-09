#!/usr/bin/env -S npx tsx
/** Corrige o ramo dos sites de prospecção em que o nome diz, sem dúvida, outro ramo.
 *
 * Só os casos claros da revisão de 08/11/2026 (o resto — negócio que faz duas coisas — fica):
 * - clínica médica cujo nome diz a especialidade ("AC Clinic Estética Avançada" → estética);
 * - estética automotiva / lava-jato gravado como oficina, estética ou salão → lavagem;
 * - "Curso de …" gravado num ramo de beleza → cursos profissionalizantes;
 * - academia cujo nome é de estética ("Bronze Das Rainhas").
 * Só negócio no estágio "novo", da prospecção (não cadastro, não cliente). Como em
 * migrar-podologia: a escolha de modelo sai (o site sorteia no ramo novo), e cor e foto da
 * bio são as do ramo novo.
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/corrigir-ramos.mts [--csv arquivo]   # simula
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/corrigir-ramos.mts --aplicar
 */
import { writeFileSync } from "node:fs";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/admin";
import { nichoDe, SUBS, type Sub } from "@/lib/gerador";
import { ehClaro, visualClaro } from "@/lib/site-claro";
import { visualEditorial } from "@/lib/site-editorial";

const aplicar = process.argv.includes("--aplicar");
const csv = process.argv.includes("--csv") ? process.argv[process.argv.indexOf("--csv") + 1] : null;

/** O ramo novo, se o caso é um dos claros; senão null. */
function ramoCerto(nome: string, atual: Sub): Sub | null {
  const peloNome = nichoDe({ categoria: "", nome })?.sub;
  if (!peloNome || peloNome === atual) return null;
  // clínica que faz várias coisas ("Estética, Fisioterapia e Pilates", "Estética e Nutrição") fica: só a especialidade clara
  if (atual === "clinica" && ["estetica", "salao", "unhas", "podologia", "odonto", "fisio"].includes(peloNome)) return peloNome;
  if (peloNome === "lavagem" && ["oficina", "estetica", "salao"].includes(atual)) return "lavagem";
  if (peloNome === "profissionalizante" && SUBS[atual].nicho === "beleza") return "profissionalizante";
  if (atual === "academia" && peloNome === "estetica") return "estetica";
  return null;
}

const plataforma = new Set(((await adminDb.doc("config/admin").get()).get("uids") as string[] | undefined) ?? []);
const [tenants, crm] = await Promise.all([adminDb.collection("tenants").get(), adminDb.collection("crm").get()]);
const estagio = new Map(crm.docs.map((d) => [d.id, String(d.get("estagio") ?? "novo")]));

const alvos: { t: (typeof tenants.docs)[number]; de: Sub; para: Sub }[] = [];
for (const t of tenants.docs) {
  const g = t.get("gerado");
  if (!g?.sub || !SUBS[g.sub as Sub] || g.origem === "cadastro") continue;
  if ((estagio.get(t.id) ?? "novo") !== "novo") continue;
  if (t.get("ownerId") && !plataforma.has(t.get("ownerId"))) continue;
  const para = ramoCerto(String(t.get("name") ?? ""), g.sub as Sub);
  if (para) alvos.push({ t, de: g.sub as Sub, para });
}

const pares: Record<string, number> = {};
for (const a of alvos) pares[`${a.de} → ${a.para}`] = (pares[`${a.de} → ${a.para}`] ?? 0) + 1;
console.log(`${alvos.length} sites com ramo errado claro:`, JSON.stringify(pares));
if (csv) {
  const linhas = [["slug", "nome", "de", "para"], ...alvos.map(({ t, de, para }) => [t.id, String(t.get("name") ?? ""), SUBS[de].rotulo, SUBS[para].rotulo])];
  writeFileSync(csv, "﻿" + linhas.map((l) => l.map((c) => `"${c.replace(/"/g, '""')}"`).join(";")).join("\r\n") + "\r\n");
  console.log("lista:", csv);
}

if (aplicar) {
  let lote = adminDb.batch();
  let n = 0;
  for (const { t, para } of alvos) {
    const visual = ehClaro(para) ? visualClaro(t.id, para) : visualEditorial(t.id, para);
    lote.update(t.ref, {
      "gerado.sub": para,
      "gerado.nicho": SUBS[para].nicho,
      "gerado.escolha": FieldValue.delete(),
      "gerado.atualizadoEm": FieldValue.serverTimestamp(),
      "site.category": SUBS[para].tipo,
      "site.color": visual.cor,
      "site.photo": visual.foto,
    });
    if (++n % 400 === 0) { await lote.commit(); lote = adminDb.batch(); }
  }
  if (n % 400) await lote.commit();
  console.log(`${n} sites corrigidos`);
} else console.log("simulação: nada gravado (use --aplicar)");
process.exit(0);
