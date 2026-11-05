// Rode: npm run test:integracoes  (chaves do /admin passam na frente do .env, no emulador do Firestore)
import assert from "node:assert/strict";
import { getFirestore } from "firebase-admin/firestore";
import { alertarAdmin } from "@/lib/alerta-admin.server";
import { gravarIntegracao, integracao, integracoesNaTela } from "@/lib/integracoes.server";
import { verificarIntegracoes } from "@/lib/verificar-integracoes.server";

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

// verificação ao vivo de Ajustes: fetch simulado, nada enviado; o detalhe nunca leva a chave
{
  const original = globalThis.fetch;
  let respostas: Record<string, () => Response> = {};
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = String(url instanceof Request ? url.url : url);
    const chave = Object.keys(respostas).find((k) => u.includes(k));
    return chave ? respostas[chave]() : new Response("não simulado", { status: 500 });
  }) as typeof fetch;
  for (const k of ["COMTELE_API_KEY", "RESEND_API_KEY", "GMAIL_USER", "GMAIL_APP_PASSWORD", "ATENDYS_ADMIN_KEY", "ALERTA_EMAIL", "ANTHROPIC_API_KEY"]) delete process.env[k];

  // (o "ausente" não é conferido aqui: o teste carrega integracoes.server duas vezes, e uma leitura
  // vazia antes de gravar ficaria no cache da outra cópia por 60 s)
  let v;

  // pelo .env (o painel está vazio aqui): ver a nota acima sobre as duas cópias do cache
  Object.assign(process.env, { COMTELE_API_KEY: "segredo-comtele-1", RESEND_API_KEY: "segredo-resend-2", ATENDYS_ADMIN_KEY: "segredo-atendys-3", ALERTA_EMAIL: "alertas@ruphus.site", ANTHROPIC_API_KEY: "segredo-ia-4" });
  respostas = {
    "comtele.com.br/api/v2/credits": () => Response.json({ Success: true, Object: 1234 }),
    "api.resend.com/domains": () => Response.json({ name: "restricted_api_key", message: "only send" }, { status: 401 }),
    "/admin/tenants": () => Response.json([{ id: "t1" }, { id: "t2" }]),
    "api.anthropic.com/v1/models": () => Response.json({ data: [{ id: "m", type: "model" }], has_more: false, first_id: "m", last_id: "m" }),
  };
  v = await verificarIntegracoes();
  assert.equal(v["SMS (Comtele)"].situacao, "ok");
  assert.match(v["SMS (Comtele)"].detalhe, /1\.234 SMS/);
  assert.deepEqual([v["E-mail"].situacao, v["E-mail"].detalhe], ["ok", "Resend válido (chave só de envio)."], "chave só de envio é válida");
  assert.match(v["WhatsApp (atendys)"].detalhe, /2 negócios/);
  assert.equal(v.Alertas.detalhe, "Alertas vão para alertas@ruphus.site.");
  assert.equal(v["IA (Anthropic)"].situacao, "ok");

  // recusas e falta de saldo viram "erro" com o motivo, sem a chave
  respostas = {
    "comtele.com.br/api/v2/credits": () => Response.json({ Success: true, Object: 0 }),
    "api.resend.com/domains": () => Response.json({ data: [{ name: "ruphus.site", status: "pending" }] }),
    "/admin/tenants": () => Response.json({ error: { code: "UNAUTHORIZED", message: "x" } }, { status: 401 }),
    "api.anthropic.com/v1/models": () => Response.json({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }, { status: 401 }),
  };
  v = await verificarIntegracoes();
  assert.deepEqual(Object.values(v).map((x) => x.situacao), ["erro", "erro", "erro", "ok", "erro"]);
  assert.match(v["SMS (Comtele)"].detalhe, /sem saldo/);
  assert.match(v["E-mail"].detalhe, /pending/);
  assert.match(v["IA (Anthropic)"].detalhe, /recusou a chave \(401\)/);
  assert.ok(!JSON.stringify(v).includes("segredo-"), "nenhuma chave no que vai para a tela");

  for (const k of ["COMTELE_API_KEY", "RESEND_API_KEY", "ATENDYS_ADMIN_KEY", "ALERTA_EMAIL", "ANTHROPIC_API_KEY"]) delete process.env[k];
  globalThis.fetch = original;
}

console.log("integracoes ok");
