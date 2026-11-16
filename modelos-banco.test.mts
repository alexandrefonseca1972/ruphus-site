// Rode: npm run test:modelos-banco  (repositório do Estúdio de modelos no emulador do Firestore)
import assert from "node:assert/strict";
import { adminDb as db } from "@/lib/admin";
import { EMBUTIDOS } from "@/lib/modelos/embutidos";
import {
  criar, definirPadrao, descartar, duplicar, historico, lerCatalogoDireto, lerConfig, ligar, publicar, restaurar, salvarRascunho,
} from "@/lib/modelos/repo.server";
import { CONFIG_VAZIA } from "@/lib/modelos/tipos";
import { lerSite } from "@/lib/gerador.server";

const base = EMBUTIDOS.find((m) => m.id === "barbearia-1")!;
const nome = (d: { nome: string } | undefined) => d?.nome;

// sem docs no banco, o catálogo é o dos embutidos, todos na versão 1
{
  const { catalogo, rascunhos } = await lerCatalogoDireto();
  assert.equal(catalogo.size, EMBUTIDOS.length);
  assert.deepEqual(catalogo.get("barbearia-1")?.publicado, base);
  assert.equal(catalogo.get("barbearia-1")?.versao, 1);
  assert.deepEqual(rascunhos, {});
  assert.equal((await db.collection("modelos").get()).size, 0, "embutido não é gravado de saída");
}

// negócios que apontam para barbearia-1: dois seguem a publicada (um cliente, um em prospecção), um já é congelado
await db.doc("tenants/cliente-fechado").set({ gerado: { sub: "barbearia", origem: "prospeccao", modelo: { id: "barbearia-1", versao: null } } });
await db.doc("crm/cliente-fechado").set({ estagio: "fechado" });
await db.doc("tenants/cliente-cadastro").set({ gerado: { sub: "barbearia", origem: "cadastro", modelo: { id: "barbearia-1", versao: null } } });
await db.doc("tenants/prospecto").set({ gerado: { sub: "barbearia", origem: "prospeccao", modelo: { id: "barbearia-1", versao: null } } });
await db.doc("crm/prospecto").set({ estagio: "contatado" });
await db.doc("tenants/ja-congelado").set({ gerado: { sub: "barbearia", origem: "cadastro", modelo: { id: "barbearia-1", versao: 1 } } });

// rascunho não muda o publicado
await salvarRascunho("barbearia-1", { ...base, nome: "Salão novo" });
{
  const { catalogo, rascunhos } = await lerCatalogoDireto();
  assert.equal(nome(catalogo.get("barbearia-1")?.publicado), base.nome, "rascunho não aparece no publicado");
  assert.equal(catalogo.get("barbearia-1")?.versao, 1);
  assert.equal(nome(rascunhos["barbearia-1"]), "Salão novo");
  assert.equal((await db.doc("modelos/barbearia-1/versoes/1").get()).get("def.nome"), base.nome, "embutido vira a versão 1 no histórico");
}
await assert.rejects(salvarRascunho("barbearia-1", { ...base, nome: "" }), "rascunho inválido não grava");
await assert.rejects(salvarRascunho("barbearia-1", { ...base, id: "outro" }), /não bate/);

// publicar: versão 2, foto em versoes/2, rascunho limpo; cliente congela na 1, prospecção segue null
{
  const r = await publicar(["barbearia-1"], "admin-teste");
  assert.deepEqual(r, { "barbearia-1": { versao: 2, prospeccao: 1, clientes: 2 } });
  const d = await db.doc("modelos/barbearia-1").get();
  assert.equal(d.get("versao"), 2);
  assert.equal(d.get("publicado.nome"), "Salão novo");
  assert.equal(d.get("rascunho"), undefined);
  const v2 = await db.doc("modelos/barbearia-1/versoes/2").get();
  assert.equal(v2.get("def.nome"), "Salão novo");
  assert.equal(v2.get("por"), "admin-teste");
  assert.equal((await db.doc("tenants/cliente-fechado").get()).get("gerado.modelo.versao"), 1, "cliente fechado congela");
  assert.equal((await db.doc("tenants/cliente-cadastro").get()).get("gerado.modelo.versao"), 1, "cliente do cadastro congela");
  assert.equal((await db.doc("tenants/prospecto").get()).get("gerado.modelo.versao"), null, "prospecção segue a publicada");
  assert.equal((await db.doc("tenants/ja-congelado").get()).get("gerado.modelo.versao"), 1);
  const e = (await lerCatalogoDireto()).catalogo.get("barbearia-1")!;
  assert.equal(e.versao, 2);
  assert.equal(nome(e.versoes?.[1]), base.nome, "a versão congelada continua no catálogo");
}
await assert.rejects(publicar(["barbearia-1"]), /Sem rascunho para publicar: barbearia-1/);

// restaurar copia a versão para o rascunho, sem publicar
await restaurar("barbearia-1", 1);
{
  const h = await historico("barbearia-1");
  assert.equal(h.versao, 2);
  assert.deepEqual(h.rascunho, base, "restaurar volta os campos");
  assert.deepEqual(h.versoes.map((v) => v.n), [2, 1]);
  assert.equal((await db.doc("modelos/barbearia-1").get()).get("publicado.nome"), "Salão novo");
}
await descartar(["barbearia-1", "nao-existe"]);
assert.equal((await db.doc("modelos/barbearia-1").get()).get("rascunho"), undefined, "descartar limpa o rascunho");

// duas gravações de versão ao mesmo tempo não perdem número: publicar e desligar juntos dão 3 e 4
await salvarRascunho("barbearia-1", { ...base, nome: "Salão 3" });
await Promise.all([publicar(["barbearia-1"]), ligar("barbearia-1", false)]);
{
  const h = await historico("barbearia-1");
  assert.equal(h.versao, 4);
  assert.deepEqual(h.versoes.map((v) => v.n), [4, 3, 2, 1]);
  const p = (await db.doc("modelos/barbearia-1").get()).get("publicado");
  assert.equal(p.ativo, false);
}

// ligar num embutido sem doc: cria a versão 1 e já grava a 2
await ligar("barbearia-2", false);
assert.deepEqual((await historico("barbearia-2")).versoes.map((v) => [v.n, v.def.ativo]), [[2, false], [1, true]]);

// criar: combinação nova nasce desligada, na versão 1; id de embutido e id repetido não passam
{
  const id = await criar({ ...base, id: "barbearia-teste", nome: "Teste" });
  const e = (await lerCatalogoDireto()).catalogo.get(id)!;
  assert.equal(e.versao, 1);
  assert.equal(e.publicado.ativo, false);
  await assert.rejects(criar({ ...base, id: "barbearia-teste" }), /já existe/);
  await assert.rejects(criar(base), /embutido/);
  const copia = await duplicar("barbearia-1", "Cópia");
  assert.match(copia, /^barbearia-1-/);
  assert.equal(nome((await lerCatalogoDireto()).catalogo.get(copia)?.publicado), "Cópia");
}

// config: inválida vira vazia; definirPadrao grava e apaga
await db.doc("config/modelos").set({ padroes: { site: { barbearia: 42 } } });
assert.deepEqual(await lerConfig(), CONFIG_VAZIA);
await db.doc("config/modelos").delete();
assert.deepEqual(await lerConfig(), CONFIG_VAZIA);
await definirPadrao("site", "barbearia", "barbearia-1");
await definirPadrao("bio", "todos", "bio-clara");
assert.deepEqual((await lerConfig()).padroes, { site: { barbearia: "barbearia-1" }, bio: { todos: "bio-clara" } });
await definirPadrao("site", "barbearia", null);
assert.deepEqual((await lerConfig()).padroes.site, {});
await assert.rejects(definirPadrao("site", "barbearia", "bio-clara"), /não é de site/);
await assert.rejects(definirPadrao("site", "nao-e-ramo", "barbearia-1"));

// lerSite (F3.2): negócio com modelo leva a def; padrão do ramo só para prospecção; sem nada, caminho de hoje
{
  const site = (slug: string, gerado: object) => db.doc(`tenants/${slug}`).set({ name: "Casa", site: { phone: "5585999990000" }, gerado });
  await site("com-modelo", { sub: "barbearia", origem: "prospeccao", modelo: { id: "barbearia-2", versao: null } });
  await site("sem-modelo", { sub: "barbearia", origem: "prospeccao" });
  await site("fechou", { sub: "barbearia", origem: "prospeccao" });
  await db.doc("crm/fechou").set({ estagio: "fechado" });
  await site("bio-no-site", { sub: "barbearia", origem: "prospeccao", modelo: { id: "bio-clara", versao: null } });
  assert.equal((await lerSite(db, "com-modelo"))?.def?.id, "barbearia-2");
  assert.equal((await lerSite(db, "sem-modelo"))?.def, undefined, "sem modelo e sem padrão: escolha/hash");
  assert.equal((await lerSite(db, "bio-no-site"))?.def, undefined, "layout de outra família fica de fora");
  await definirPadrao("site", "barbearia", "barbearia-3");
  assert.equal((await lerSite(db, "sem-modelo"))?.def?.id, "barbearia-3", "prospecção segue o padrão do ramo");
  assert.equal((await lerSite(db, "fechou"))?.def, undefined, "cliente não segue o padrão");
  await definirPadrao("site", "barbearia", null);
}

// ————— revisão Fable —————
// H2: um id sem rascunho barra a publicação inteira, antes de publicar qualquer um
{
  const b3 = EMBUTIDOS.find((m) => m.id === "barbearia-3")!;
  await salvarRascunho("barbearia-3", { ...b3, nome: "Barbearia H2" });
  const v = (await lerCatalogoDireto()).catalogo.get("barbearia-3")!.versao;
  await assert.rejects(publicar(["barbearia-3", "barbearia-2", "cabeleireira-1"]), /Sem rascunho para publicar: barbearia-2, cabeleireira-1\. Nada foi publicado/);
  assert.equal((await lerCatalogoDireto()).catalogo.get("barbearia-3")!.versao, v, "nenhum foi ao ar");
  await descartar(["barbearia-3"]);
}

// M4: restaurar uma versão velha mantém o ligado/desligado de agora (barbearia-1 está desligado na 4)
await restaurar("barbearia-1", 2);
assert.equal((await historico("barbearia-1")).rascunho?.ativo, false, "restaurar não religa");
await descartar(["barbearia-1"]);

// M7: layout de site não troca de família; ramo só troca sem ninguém usando
{
  const b2 = (await lerCatalogoDireto()).catalogo.get("barbearia-2")!.publicado;
  await assert.rejects(salvarRascunho("barbearia-2", { ...b2, layout: "claro" }), /layout/);
  await assert.rejects(salvarRascunho("barbearia-2", { ...b2, sub: "salao" }), /ramo/, "com-modelo usa a barbearia-2");
  await salvarRascunho("barbearia-teste", { ...(await lerCatalogoDireto()).catalogo.get("barbearia-teste")!.publicado, sub: "salao" });
  assert.equal((await historico("barbearia-teste")).rascunho?.sub, "salao", "sem uso, troca");
  await descartar(["barbearia-teste"]);
  // a escolha da gaveta antiga também conta como uso
  await db.doc("tenants/so-escolha").set({ gerado: { sub: "barbearia", escolha: { modelo: "barbearia-teste" } } });
  await assert.rejects(salvarRascunho("barbearia-teste", { ...(await lerCatalogoDireto()).catalogo.get("barbearia-teste")!.publicado, sub: "salao" }), /ramo/);
  await db.doc("tenants/so-escolha").delete();
}

// L6: duplicar não deixa o id crescer sem fim
{
  let id = "barbearia-teste";
  for (let i = 0; i < 6; i++) id = await duplicar(id, "Cópia");
  assert.ok(id.length <= 60, id);
  assert.match(id, /^[a-z0-9-]+$/);
}

// M3: kit só em /assets, sem ".."
await assert.rejects(criar({ ...base, id: "kit-fora", kit: "/assets/../segredo" }));
await assert.rejects(criar({ ...base, id: "kit-fora", kit: "/assets/beleza/\"><script>" }));

// M6: modelo gravado com fonte que saiu do código continua no catálogo (leitura tolerante)
{
  await db.doc("modelos/barbearia-teste").update({ "publicado.fonte": "Fonte Que Saiu" });
  const e = (await lerCatalogoDireto()).catalogo.get("barbearia-teste");
  assert.ok(e, "não some do catálogo");
  assert.equal(e.publicado.fonte, undefined, "fonte desconhecida vira a do modelo");
  await db.doc("modelos/barbearia-teste").update({ "publicado.kit": 42 });
  assert.equal((await lerCatalogoDireto()).catalogo.has("barbearia-teste"), false, "dado quebrado sai do catálogo");
}

console.log("modelos-banco ok");
