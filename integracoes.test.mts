// Rode: npm run test:integracoes  (chaves do /admin passam na frente do .env, no emulador do Firestore)
import assert from "node:assert/strict";
import { getFirestore } from "firebase-admin/firestore";
import { alertarAdmin } from "@/lib/alerta-admin.server";
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

// alerta ao admin: vai para ALERTA_EMAIL (ou o Gmail), no máximo um por assunto a cada 6 h
{
  const db = getFirestore();
  const saidos: { para: string; texto: string }[] = [];
  const enviar = async (e: { para: string; texto: string }) => void saidos.push(e);
  const h = 3_600_000;
  process.env.GMAIL_USER = "conta@ruphus.site";
  assert.equal(await alertarAdmin(db, "teste", "Falhou", "detalhe", { enviar, agora: 0 }), true);
  assert.equal(saidos[0].para, "conta@ruphus.site", "sem ALERTA_EMAIL, vai para o Gmail");
  assert.equal(await alertarAdmin(db, "teste", "Falhou", "detalhe", { enviar, agora: 1 * h }), false, "dentro das 6 h, segura");
  assert.equal(await alertarAdmin(db, "teste", "Falhou", "detalhe", { enviar, agora: 2 * h }), false);
  // pelo ambiente: o tsx carrega integracoes.server duas vezes (teste e alerta), cada uma com seu
  // cache de 60 s; a leitura do painel já tem teste acima
  process.env.ALERTA_EMAIL = "alertas@ruphus.site";
  assert.equal(await alertarAdmin(db, "teste", "Falhou", "detalhe", { enviar, agora: 7 * h }), true);
  assert.equal(saidos[1].para, "alertas@ruphus.site");
  assert.match(saidos[1].texto, /mais 2 vez/, "conta o que repetiu no intervalo");
  delete process.env.ALERTA_EMAIL;
  delete process.env.GMAIL_USER;
  assert.equal(await alertarAdmin(db, "outro", "Falhou", "x", { enviar, agora: 0 }), false, "sem e-mail nenhum, não quebra");
  assert.equal(await alertarAdmin(db, "quebra", "Falhou", "x", { enviar: async () => { throw new Error("smtp fora"); }, agora: 0 }), false, "e-mail fora não quebra");
}

console.log("integracoes ok");
