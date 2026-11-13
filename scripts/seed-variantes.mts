// Copia a biblioteca de variantes do código (src/lib/prospeccao-variantes.ts) para prospeccaoVariantes/{id}
// (F4). Idempotente: cria só o que falta; variante com texto (seed anterior ou editada no admin, campo
// editadaEm) não é tocada; doc só com números (o CRM contou antes) ganha o texto e mantém os números.
// A aba Prospecção do admin tem o mesmo botão ("Copiar para o Firestore").
//
//   Emulador:  FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-siteflow npx tsx --conditions=react-server scripts/seed-variantes.mts
//   Produção:  npx tsx --conditions=react-server --env-file=.env.local scripts/seed-variantes.mts --producao
import { adminDb } from "@/lib/admin";
import { semear } from "@/lib/prospeccao-biblioteca.server";

// trava contra rodar sem querer no projeto real: fora do emulador, só com --producao
if (!process.env.FIRESTORE_EMULATOR_HOST && !process.argv.includes("--producao")) {
  console.error("Sem FIRESTORE_EMULATOR_HOST: isto escreveria no Firestore real. Use --producao se for a intenção.");
  process.exit(1);
}
console.log("seed-variantes:", await semear(adminDb));
