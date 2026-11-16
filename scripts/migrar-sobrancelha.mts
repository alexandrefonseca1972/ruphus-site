#!/usr/bin/env -S npx tsx
/** Põe as designers de sobrancelha no sub novo "sobrancelha": fotos de sobrancelha e
 *  serviços do ramo no lugar dos de salão ou estética.
 *
 * Até aqui quem só faz sobrancelha caía em salão (o Google diz "salão de beleza") ou em
 * estética, e o site mostrava corte e escova. O alvo é o que nichoDe lê do nome
 * (src/lib/gerador.ts): só sobrancelha, sem cabelo, unha, cílios ou estética no nome.
 *
 * Os serviços só são trocados quando são o padrão que o gerador inventou (nenhum
 * agendamento e o conjunto igual a um dos catálogos de ramo); lista própria fica.
 * Escolha de modelo gravada (escolha.modelo) fica; kit/cor soltos são apagados, porque
 * apontam para kits de outro ramo. Site de dono cadastrado fica de fora.
 * Roda depois do deploy: as fotos vêm de public/.
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/migrar-sobrancelha.mts            # simula
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/migrar-sobrancelha.mts --aplicar  # backup + aplica
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb as db } from "@/lib/admin";
import { porRamo } from "@/lib/catalogo";
import { nichoDe, SUBS } from "@/lib/gerador";
import { visualEditorial } from "@/lib/site-editorial";

const aplicar = process.argv.includes("--aplicar");
// os catálogos de ramo que o gerador pôs nesses sites (contados no dblocal em 15/11/2026)
const PADROES = [
  "Coloração|Corte|Escova|Hidratação", "Design de sobrancelha|Extensão de cílios", "Avaliação estética|Limpeza de pele",
  "Avaliação|Depilação a laser", "Alongamento em gel|Manicure|Pedicure", "Check-up|Consulta|Retorno", "Barba|Corte|Corte + barba",
];
const NOVOS = porRamo("design de sobrancelha");

const snap = await db.collection("tenants").get();
const alvos = snap.docs.filter((d) => {
  const gerado = d.get("gerado");
  if (!gerado || gerado.origem === "cadastro" || gerado.sub === "sobrancelha") return false;
  return nichoDe({ categoria: "", nome: String(d.get("name") ?? "") })?.sub === "sobrancelha";
});

const planos = [];
for (let i = 0; i < alvos.length; i += 25) {
  planos.push(...await Promise.all(alvos.slice(i, i + 25).map(async (d) => {
    const [servicos, agendamentos, equipe] = await Promise.all([
      d.ref.collection("services").get(), d.ref.collection("appointments").limit(1).get(), d.ref.collection("staff").get(),
    ]);
    const nomes = servicos.docs.map((s) => String(s.get("name"))).sort().join("|");
    const trocaServicos = agendamentos.empty && PADROES.includes(nomes);
    return { d, servicos, equipe, nomes, trocaServicos };
  })));
}

const porDe = new Map<string, number>();
for (const p of planos) porDe.set(p.d.get("gerado.sub"), (porDe.get(p.d.get("gerado.sub")) ?? 0) + 1);
console.log(`${planos.length} de ${snap.size} sites vão para o sub sobrancelha${aplicar ? "" : " (simulação)"}: ${[...porDe].map(([s, n]) => `${n} de ${s}`).join(", ")}`);
console.log(`serviços trocados por ${NOVOS.map((s) => s.name).join(", ")}: ${planos.filter((p) => p.trocaServicos).length}; mantidos: ${planos.filter((p) => !p.trocaServicos).length}`);
for (const p of planos.filter((p) => !p.trocaServicos)) console.log(`  mantém ${p.d.id}: ${p.nomes || "(sem serviços)"}`);
if (!aplicar) process.exit(0);

const backup = resolve(import.meta.dirname, `../dblocal/backup-sobrancelha-${Date.now()}.json`);
writeFileSync(backup, JSON.stringify(planos.map((p) => ({
  slug: p.d.id, gerado: p.d.get("gerado"), site: p.d.get("site"),
  services: p.servicos.docs.map((s) => ({ id: s.id, ...s.data() })), staff: p.equipe.docs.map((s) => ({ id: s.id, ...s.data() })),
}))));
console.log(`backup: ${backup}`);

let lote = db.batch();
let n = 0;
const somar = async () => { if (++n % 50 === 0) { await lote.commit(); lote = db.batch(); } };
for (const p of planos) {
  const escolha = p.d.get("gerado.escolha");
  const modelo = escolha?.modelo ? escolha : undefined;
  const visual = visualEditorial(p.d.id, "sobrancelha", modelo);
  lote.update(p.d.ref, {
    "gerado.nicho": "beleza",
    "gerado.sub": "sobrancelha",
    ...(!modelo && { "gerado.escolha": FieldValue.delete() }),
    "gerado.atualizadoEm": FieldValue.serverTimestamp(),
    "site.category": SUBS.sobrancelha.tipo,
    "site.color": visual.cor,
    "site.photo": visual.foto,
  });
  if (p.trocaServicos) {
    for (const s of p.servicos.docs) lote.delete(s.ref);
    NOVOS.forEach(({ id, ...s }, ordem) => lote.set(p.d.ref.collection("services").doc(id), { ...s, ordem }));
    for (const e of p.equipe.docs) lote.update(e.ref, { serviceIds: NOVOS.map((s) => s.id) });
  }
  await somar();
}
if (n % 50) await lote.commit();
console.log(`${n} sites atualizados`);
process.exit(0);
