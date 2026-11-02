// Rode: npm run test:integracoes  (chaves do /admin passam na frente do .env, no emulador do Firestore)
import assert from "node:assert/strict";
import { gravarIntegracao, integracao, integracoesNaTela } from "@/lib/integracoes.server";

process.env.COMTELE_API_KEY = "do-env-1234";
assert.equal(await integracao("COMTELE_API_KEY"), "do-env-1234", "sem painel, vale o .env");

await gravarIntegracao("COMTELE_API_KEY", "chave-do-painel-9876");
assert.equal(await integracao("COMTELE_API_KEY"), "chave-do-painel-9876", "o painel passa na frente");
await gravarIntegracao("GMAIL_APP_PASSWORD", "curta123");
await gravarIntegracao("GMAIL_USER", "ruphus@gmail.com");
const tela = Object.fromEntries((await integracoesNaTela()).map((i) => [i.nome, i]));
assert.deepEqual([tela.COMTELE_API_KEY.origem, tela.COMTELE_API_KEY.mostra], ["painel", "••••9876"], "segredo só com os 4 últimos");
assert.equal(tela.GMAIL_APP_PASSWORD.mostra, "••••", "segredo curto não mostra nem o final");
assert.equal(tela.GMAIL_USER.mostra, "ruphus@gmail.com", "o que não é segredo aparece inteiro");
await gravarIntegracao("GMAIL_APP_PASSWORD", "");
await gravarIntegracao("GMAIL_USER", "");

await gravarIntegracao("COMTELE_API_KEY", "");
assert.equal(await integracao("COMTELE_API_KEY"), "do-env-1234", "remover volta ao .env");
delete process.env.COMTELE_API_KEY;
assert.equal(await integracao("COMTELE_API_KEY"), "");
assert.equal((await integracoesNaTela()).find((i) => i.nome === "COMTELE_API_KEY")!.origem, "nenhuma");

console.log("integracoes ok");
