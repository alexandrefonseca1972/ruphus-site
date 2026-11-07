// Uma vez (05/11/2026): "Oferta enviada" virou "mandei o 1º contato" — ~1.400 leads marcados como
// oferta logo depois da primeira mensagem, sem proposta e sem próximo passo. Voltam para "novo" com
// 1 toque contado e o Lembrete para hoje, e a cadência segue dali. Quem tem sinal de conversa de
// verdade (proposta gerada, dono identificado, contato depois da marcação, anotação do vendedor)
// fica em oferta, com "Revisar a conversa" para hoje.
//
//   npm run oferta-para-novo              # prévia: quantos mudariam
//   npm run oferta-para-novo -- --aplicar # grava backup em dblocal/ e aplica
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { FieldValue, Timestamp, type DocumentSnapshot } from "firebase-admin/firestore";
import { adminDb } from "@/lib/admin";
import { ROTULO } from "@/lib/crm-tipos";
import { todayIn } from "@/lib/datetime";

const aplicar = process.argv.includes("--aplicar");
const hoje = todayIn();
const ms = (v: unknown) => (v instanceof Timestamp ? v.toMillis() : 0);

/** Conversa de verdade: a marcação de oferta não foi só o reflexo do 1º contato. */
const conversa = (d: DocumentSnapshot) =>
  !!d.get("propostaToken") ||
  !!d.get("donoNome") ||
  !!d.get("donoEmail") ||
  !!d.get("respondeuEm") ||
  (d.get("notas") ?? 0) >= 2 ||
  ms(d.get("ultimoContatoEm")) - ms(d.get("entrouEm")) > 3_600_000;

const docs = (await adminDb.collection("crm").where("estagio", "==", "oferta").get()).docs;
const ficam = docs.filter(conversa);
const voltam = docs.filter((d) => !conversa(d));
const revisar = ficam.filter((d) => !d.get("proximaData"));
console.log(`${docs.length} em oferta: ${voltam.length} voltam para novo; ${ficam.length} ficam (${revisar.length} ganham "Revisar a conversa" para hoje)`);
for (const d of ficam) console.log(`  fica: ${d.id}`);
if (!aplicar) process.exit(0);

const pasta = resolve(import.meta.dirname, "../dblocal");
mkdirSync(pasta, { recursive: true });
const backup = resolve(pasta, `backup-oferta-${hoje}-${Date.now()}.json`);
writeFileSync(backup, JSON.stringify(docs.map((d) => ({ id: d.id, dados: d.data() })), null, 1));
console.log(`backup: ${backup}`);

const AUTOR = "revisão do funil";
let lote = adminDb.batch();
let n = 0;
const gravar = async (fim = false) => {
  if (n && (fim || n >= 400)) {
    await lote.commit();
    lote = adminDb.batch();
    n = 0;
  }
};
for (const d of voltam) {
  lote.set(
    d.ref,
    {
      estagio: "novo",
      toques: 1,
      proximaAcao: "Lembrete",
      proximaData: hoje,
      entrouEm: FieldValue.delete(),
      atualizadoEm: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  lote.set(d.ref.collection("eventos").doc(), {
    tipo: "estagio",
    titulo: `${ROTULO.oferta} → ${ROTULO.novo}`,
    detalhe: "Só o 1º contato tinha saído: volta para a cadência, com o Lembrete",
    autor: AUTOR,
    quando: FieldValue.serverTimestamp(),
  });
  n += 2;
  await gravar();
}
for (const d of revisar) {
  lote.set(d.ref, { proximaAcao: "Revisar a conversa", proximaData: hoje, atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
  n += 1;
  await gravar();
}
await gravar(true);
console.log(`aplicado: ${voltam.length} para novo, ${revisar.length} para revisar`);
process.exit(0);
