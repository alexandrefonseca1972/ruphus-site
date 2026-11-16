// Rode: npm run test:modelos-lote  (lote do Estúdio e ações do admin, no emulador com Firestore e Auth)
import assert from "node:assert/strict";
import { getAuth } from "firebase-admin/auth";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb as db } from "@/lib/admin";
import { aplicarLote, contarLote, desfazerLote } from "@/lib/modelos/lote.server";
import { definirPadrao, lerCatalogoDireto, lerConfig, publicar, salvarRascunho } from "@/lib/modelos/repo.server";
import { recalcularCopias } from "@/lib/modelos/copias.server";
import { resolverModelo } from "@/lib/modelos/resolver";
import { doNichoAtivo } from "@/lib/modelos/tipos";
import { EMBUTIDOS } from "@/lib/modelos/embutidos";
import { lerSite, publicarSite, visualDoSite } from "@/lib/gerador.server";
import * as acoes from "@/app/admin/modelos-actions";
import { definirModelo, siteDoNegocio } from "@/app/admin/actions";
import { salvarCrm } from "@/lib/crm";
import { aplicarMigracao, congelarNegocio, planoMigracao } from "@/lib/modelos/congelar.server";

assert.ok(process.env.FIRESTORE_EMULATOR_HOST && process.env.FIREBASE_AUTH_EMULATOR_HOST, "rode pelo emulador (npm run test:modelos-lote)");
assert.equal(process.env.RUPHUS_E2E, "1", "o token do emulador só vale com RUPHUS_E2E=1");

const ID = "barbearia-3";
const base = EMBUTIDOS.find((m) => m.id === ID)!;
const negocio = async (slug: string, gerado: object, estagio?: string, city = "Fortaleza") => {
  await db.doc(`tenants/${slug}`).set({ name: `Casa ${slug}`, site: { phone: "5585999990000", city, uf: "CE" }, gerado: { sub: "barbearia", ...gerado } });
  if (estagio) await db.doc(`crm/${slug}`).set({ estagio });
};
const ref = async (slug: string) => (await db.doc(`tenants/${slug}`).get()).get("gerado.modelo");

await negocio("p-livre", { origem: "prospeccao" }, "oferta");
await negocio("p-manual", { origem: "prospeccao", modelo: { id: "barbearia-2", versao: null } });
await negocio("c-fechado", { origem: "prospeccao" }, "fechado");
await negocio("c-cadastro", { origem: "cadastro", modelo: { id: "barbearia-2", versao: 1 } });
await negocio("outra-cidade", { origem: "prospeccao" }, undefined, "Aracaju");
await db.doc("tenants/salao-claro").set({ name: "Claro", gerado: { sub: "odonto", origem: "prospeccao" } });

const f = { tipo: "site", modeloId: ID, sub: "barbearia", cidade: "Fortaleza", uf: "CE" } as const;

// contar: manual conta antes do filtro "só sem escolha manual"
assert.deepEqual(await contarLote(f), { prospeccao: 2, clientes: 2, comEscolhaManual: 2, total: 4 });
assert.deepEqual(await contarLote({ ...f, soSemEscolhaManual: true }), { prospeccao: 1, clientes: 1, comEscolhaManual: 2, total: 2 });
assert.deepEqual(await contarLote({ ...f, estagio: "fechado" }), { prospeccao: 0, clientes: 1, comEscolhaManual: 0, total: 1 });
assert.equal((await contarLote({ tipo: "site", modeloId: ID })).total, 5, "sem filtro: só a família editorial (o odonto é claro)");
await assert.rejects(contarLote({ ...f, modeloId: "bio-clara" }), /não é de site/);
await assert.rejects(contarLote({ ...f, cidade: "x", extra: 1 }), "filtro desconhecido não passa");

// cliente nunca entra sem a segunda confirmação
await assert.rejects(aplicarLote(f, { incluirClientes: true }), /confirme/);
await assert.rejects(aplicarLote(f, { incluirClientes: true, confirmouClientes: "sim" as unknown as boolean }), /confirme/);
assert.equal((await db.collection("lotes").get()).size, 0, "recusa não grava lote");
assert.equal(await ref("c-fechado"), undefined);

// sem incluir clientes: só a prospecção muda, seguindo a publicada
const l1 = await aplicarLote(f, {}, "admin@teste");
assert.deepEqual([l1.prospeccao, l1.clientes, l1.total], [2, 0, 2]);
assert.deepEqual(await ref("p-livre"), { id: ID, versao: null });
assert.deepEqual(await ref("p-manual"), { id: ID, versao: null });
assert.equal(await ref("c-fechado"), undefined, "cliente fechado não foi tocado");
assert.deepEqual(await ref("c-cadastro"), { id: "barbearia-2", versao: 1 }, "cliente do cadastro não foi tocado");
assert.equal(await ref("outra-cidade"), undefined, "fora do filtro de cidade");
{
  const d = await db.doc(`lotes/${l1.id}`).get();
  assert.deepEqual([d.get("modelo"), d.get("tipo"), d.get("por")], [ID, "site", "admin@teste"]);
  assert.deepEqual(new Map((d.get("antes") as { slug: string; anterior: unknown }[]).map((a) => [a.slug, a.anterior])), new Map<string, unknown>([["p-livre", null], ["p-manual", { id: "barbearia-2", versao: null }]]));
  assert.ok((d.get("antes") as { cliente: boolean }[]).every((a) => a.cliente === false), "guarda quem era cliente ao aplicar");
}

// desfazer devolve o anterior (apaga o campo de quem não tinha); a segunda vez não faz nada
await db.doc("tenants/p-livre").update({ "gerado.escolha": { kit: 0, cor: 0 } }); // mexida que não é no modelo
assert.deepEqual(await desfazerLote(l1.id!), { restaurados: 2, mudaram: 0, viraramClientes: 0, semModelo: 0, jaDesfeito: false });
assert.equal(await ref("p-livre"), undefined, "quem não tinha modelo volta a não ter o campo");
assert.deepEqual(await ref("p-manual"), { id: "barbearia-2", versao: null });
assert.ok((await db.doc(`lotes/${l1.id}`).get()).get("desfeitoEm"));
await db.doc("tenants/p-manual").update({ "gerado.modelo": { id: "barbearia-1", versao: null } });
assert.deepEqual(await desfazerLote(l1.id!), { restaurados: 0, mudaram: 0, viraramClientes: 0, semModelo: 0, jaDesfeito: true });
assert.deepEqual(await ref("p-manual"), { id: "barbearia-1", versao: null }, "o segundo desfazer não mexe em ninguém");
await db.doc("tenants/p-manual").update({ "gerado.modelo": { id: "barbearia-2", versao: null } });

// com a confirmação, clientes entram congelados na versão de agora
const l2 = await aplicarLote(f, { incluirClientes: true, confirmouClientes: true });
assert.deepEqual([l2.prospeccao, l2.clientes], [2, 2]);
assert.deepEqual(await ref("c-fechado"), { id: ID, versao: 1 });
assert.deepEqual(await ref("c-cadastro"), { id: ID, versao: 1 });
assert.deepEqual(await ref("p-livre"), { id: ID, versao: null });

// publicar não muda o cliente congelado; a prospecção passa a ver a nova
await salvarRascunho(ID, { ...base, nome: "Barbearia nova" });
assert.deepEqual((await publicar([ID]))[ID], { versao: 2, prospeccao: 2, clientes: 0 }, "clientes já estavam congelados");
{
  const { catalogo } = await lerCatalogoDireto();
  const config = await lerConfig();
  const resolve = (modelo: object, crmEstagio?: string) => resolverModelo({ gerado: { sub: "barbearia", modelo: modelo as never }, crmEstagio }, catalogo, config, "site").def?.nome;
  assert.equal(resolve((await ref("c-fechado"))!, "fechado"), base.nome, "cliente congelado segue na versão 1");
  assert.equal(resolve((await ref("p-livre"))!), "Barbearia nova");
  assert.equal((await lerSite(db, "c-fechado"))?.def?.nome, base.nome);
  assert.equal((await lerSite(db, "p-livre"))?.def?.nome, "Barbearia nova");
}

// desfazer com cliente: volta ao que era (cadastro para a barbearia-2 congelada; fechado sem campo)
assert.equal((await desfazerLote(l2.id!)).restaurados, 4);
assert.equal(await ref("c-fechado"), undefined);
assert.deepEqual(await ref("c-cadastro"), { id: "barbearia-2", versao: 1 });

// depois de 7 dias não desfaz
{
  const l = await aplicarLote(f, {});
  await db.doc(`lotes/${l.id}`).update({ feitoEm: Timestamp.fromMillis(Date.now() - 8 * 86_400_000) });
  await assert.rejects(desfazerLote(l.id!), /7 dias/);
  await assert.rejects(desfazerLote("nao-existe"), /não encontrado/);
}

// revisão Fable 2 H1: o modelo de antes saiu do catálogo (apagado): o desfazer não grava ref para o nada
{
  await negocio("sm-1", { origem: "prospeccao", modelo: { id: "modelo-apagado", versao: null } }, undefined, "Sumiu");
  const l = await aplicarLote({ ...f, cidade: "Sumiu" }, {});
  assert.deepEqual(await desfazerLote(l.id!), { restaurados: 0, mudaram: 0, viraramClientes: 0, semModelo: 1, jaDesfeito: false });
  assert.deepEqual(await ref("sm-1"), { id: ID, versao: null }, "fica no modelo do lote");
  await db.doc("tenants/sm-1").delete();
}

// lote grande: o "antes" vai em partes (teto de 1 MB do doc) e o desfazer as junta
{
  const slugs = Array.from({ length: 2101 }, (_, i) => `massa-${i}`);
  for (let i = 0; i < slugs.length; i += 400) {
    const b = db.batch();
    for (const s of slugs.slice(i, i + 400)) b.set(db.doc(`tenants/${s}`), { name: s, site: { city: "Massa", uf: "CE" }, gerado: { sub: "barbearia", origem: "prospeccao" } });
    await b.commit();
  }
  const fm = { ...f, cidade: "Massa" };
  const l = await aplicarLote(fm, {});
  assert.equal(l.total, 2101);
  const d = await db.doc(`lotes/${l.id}`).get();
  assert.equal(d.get("antes"), undefined);
  assert.equal(d.get("partes"), 2);
  assert.deepEqual(await ref("massa-2100"), { id: ID, versao: null });
  assert.equal((await desfazerLote(l.id!)).restaurados, 2101);
  assert.equal(await ref("massa-0"), undefined);
  assert.equal(await ref("massa-2100"), undefined);
}

// ————— ações: só admin, entrada validada —————
async function tokenDe(uid: string) {
  const custom = await getAuth().createCustomToken(uid);
  const r = await fetch(`http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=fake`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: custom, returnSecureToken: true }),
  });
  return ((await r.json()) as { idToken: string }).idToken;
}
await db.doc("config/admin").set({ uids: ["admin-modelos"], revogados: {} }, { merge: true });
const admin = await tokenDe("admin-modelos");
const intruso = await tokenDe("intruso-modelos");

const negado = { ok: false, error: "Área restrita." };
assert.deepEqual(await acoes.listarModelos(intruso, "site"), negado);
assert.deepEqual(await acoes.aplicarLote(intruso, f, { incluirClientes: true, confirmouClientes: true }), negado);
assert.deepEqual(await acoes.desfazerLote(intruso, l2.id!), negado);
assert.deepEqual(await acoes.publicar(intruso, [ID]), negado);
assert.deepEqual(await acoes.previaModelo(intruso, { def: base, slug: "p-livre", tipo: "site" }), negado);
assert.equal((await acoes.contarLote("token-falso", f)).ok, false);
assert.equal(await ref("c-fechado"), undefined, "a recusa não mexeu em ninguém");

// prévia do site: HTML com o nome do negócio e o caso aplicado, sem gravar
{
  const r = await acoes.previaModelo(admin, { def: { ...base, nome: "Qualquer" }, slug: "p-livre", tipo: "site", caso: "longo" });
  assert.ok(r.ok && "html" in r.dados, JSON.stringify(r).slice(0, 200));
  assert.ok(r.ok && "html" in r.dados && r.dados.html.includes("Casa p-livre · Estúdio de Beleza"), "nome do negócio (com o caso nome longo)");
  assert.ok(r.ok && "html" in r.dados && r.dados.html.includes('<base href="https://p-livre.ruphus.site/">'));
  const claro = await acoes.previaModelo(admin, { def: base, slug: "salao-claro", tipo: "site" });
  assert.equal(claro.ok, false, "layout editorial num negócio claro é recusado");
  process.env.CRON_SECRET ??= "segredo-de-teste"; // a prévia da bio assina com ele
  const bio = await acoes.previaModelo(admin, { def: EMBUTIDOS.find((m) => m.id === "bio-clara")!, slug: "p-livre", tipo: "bio" });
  assert.ok(bio.ok && "url" in bio.dados && bio.dados.url.startsWith("/bio/p-livre/previa?t="));
  assert.deepEqual(await acoes.previaModelo(admin, { def: base, slug: "../x", tipo: "site" }), { ok: false, error: "Confira slug: valor inválido." });
  assert.equal((await acoes.previaModelo(admin, { def: base, slug: "p-livre", tipo: "bio" })).ok, false, "tipo diferente do modelo");
}

// leitura e checagem pelo admin
{
  const r = await acoes.listarModelos(admin, "site");
  assert.ok(r.ok);
  const m = r.dados.modelos.find((x) => x.def.id === ID)!;
  assert.deepEqual([m.versao, m.embutido, m.rascunho], [2, true, null]);
  assert.ok(r.dados.modelos.every((x) => x.def.tipo === "site"));
  // só os nichos em que a Ruphus opera: pet (e os outros) ficam fora das listas, mas no catálogo
  assert.ok(r.dados.modelos.every((x) => doNichoAtivo(x.def.sub)) && !r.dados.modelos.some((x) => x.def.id === "petshop-1"));
  assert.ok((await lerCatalogoDireto()).catalogo.has("petshop-1"));
  assert.ok(r.dados.modelos.some((x) => x.def.sub === "odonto"), "saúde aparece");
  assert.ok(!("uso" in m), "a lista não conta o uso");
  await db.doc("tenants/p-livre").update({ "gerado.modelo": { id: ID, versao: null } });
  await db.doc("tenants/c-fechado").update({ "gerado.modelo": { id: ID, versao: 2 }, "gerado.escolha": { modelo: ID } });
  // legado = escolha da gaveta antiga SEM gerado.modelo (o c-fechado tem os dois: conta na ref)
  await db.doc("tenants/so-escolha").set({ gerado: { sub: "barbearia", origem: "prospeccao", escolha: { modelo: ID } } });
  const u = await acoes.usoDoModelo(admin, ID);
  assert.deepEqual(u, { ok: true, dados: { prospeccao: 2, clientes: 1, legado: 1 } });
  await db.doc("tenants/so-escolha").delete();
  assert.deepEqual(await acoes.listarModelos(admin, "outro" as "site"), { ok: false, error: "Confira dados: valor inválido." });

  const galeria = EMBUTIDOS.find((m) => m.id === "bio-galeria")!;
  await db.doc("tenants/poucas").set({ gerado: { sub: galeria.sub, personal: { fotos: { ga1: "fotos/ga1.jpg" } } } });
  await db.doc("tenants/so-kit").set({ gerado: { sub: galeria.sub } });
  const sem = await acoes.checar(admin, galeria);
  assert.ok(sem.ok && sem.dados.poucasFotos === null, "fotos do ramo só com a aba Checar aberta");
  const c = await acoes.checar(admin, galeria, {}, true);
  assert.ok(c.ok);
  assert.equal(c.dados.poucasFotos, 1);
  await db.doc("tenants/poucas2").set({ gerado: { sub: galeria.sub, personal: { fotos: { ga1: "fotos/ga1.jpg" } } } });
  const guardado = await acoes.checar(admin, galeria, {}, true);
  assert.ok(guardado.ok && guardado.dados.poucasFotos === 1, "5 minutos de cache por ramo");
  await db.doc("tenants/poucas2").delete();
  assert.ok(c.dados.avisos.some((a) => a.titulo === "Negócios com poucas fotos"));
  const c2 = await acoes.checar(admin, base, {}, true);
  assert.ok(c2.ok && c2.dados.poucasFotos === null);
}

// lote pelo admin: contar passa; cliente sem a segunda confirmação é recusado com a mensagem certa
{
  const r = await acoes.contarLote(admin, f);
  assert.ok(r.ok && r.dados.total === 4);
  const sem = await acoes.aplicarLote(admin, f, { incluirClientes: true });
  assert.ok(!sem.ok && /confirme/.test(sem.error));
  const torto = await acoes.aplicarLote(admin, { ...f, tipo: "nada" } as never, {});
  assert.ok(!torto.ok && torto.error.startsWith("Confira tipo"));
}

// revisão Fable 2 M3: padrão da bio por ramo (o que a ação definirPadrao grava; a ação em si chama
// revalidateTag, que exige requisição). A bio "todos" vale de padrão para qualquer ramo.
{
  await definirPadrao("bio", "salao", "bio-galeria");
  await definirPadrao("bio", "odonto", "bio-galeria");
  let bio = (await lerConfig()).padroes.bio;
  assert.deepEqual([bio.salao, bio.odonto], ["bio-galeria", "bio-galeria"]);
  const l = await acoes.listarModelos(admin, "bio");
  assert.ok(l.ok && Object.values(l.dados.padroes).filter((x) => x === "bio-galeria").length === 2);
  const { catalogo } = await lerCatalogoDireto();
  assert.equal(resolverModelo({ gerado: { sub: "odonto", origem: "prospeccao" } }, catalogo, await lerConfig(), "bio").def?.id, "bio-galeria");
  await definirPadrao("bio", "salao", null);
  bio = (await lerConfig()).padroes.bio;
  assert.deepEqual([bio.salao, bio.odonto], [undefined, "bio-galeria"]);
  await definirPadrao("bio", "odonto", null);
}

// ————— F7: congelar quem vira cliente, a gaveta e a migração —————
{
  // ID já está na versão 2 (publicado acima)
  const g = async (slug: string) => (await db.doc(`tenants/${slug}`).get()).get("gerado");
  await negocio("f-null", { origem: "prospeccao", modelo: { id: ID, versao: null } }, "negociando");
  await negocio("f-escolha", { origem: "prospeccao", escolha: { kit: 0, cor: 0, modelo: "barbearia-1" } }, "negociando");
  await negocio("f-padrao", { origem: "prospeccao" }, "negociando");
  await negocio("f-cad", { origem: "cadastro" });
  await negocio("f-hash", { origem: "prospeccao" }, "negociando");
  await db.doc("config/modelos").set({ padroes: { site: { barbearia: ID }, bio: { todos: "bio-clara" } } });

  // virar "fechado" no CRM congela: ref null na versão de agora, escolha.modelo vira ref na
  // versão publicada de agora (barbearia-1 nunca publicada: 1), sem nada o padrão do ramo que a prospecção via
  await salvarCrm(db, "f-null", { estagio: "fechado" });
  assert.deepEqual((await g("f-null")).modelo, { id: ID, versao: 2 });
  assert.deepEqual((await g("f-null")).bio, { id: "bio-clara", versao: 1 }, "bio sem ref: o padrão (todos), congelado");
  await salvarCrm(db, "f-escolha", { estagio: "fechado" });
  assert.deepEqual((await g("f-escolha")).modelo, { id: "barbearia-1", versao: 1 });
  assert.deepEqual((await g("f-escolha")).escolha, { kit: 0, cor: 0, modelo: "barbearia-1" }, "a escolha fica (leitores antigos)");
  await salvarCrm(db, "f-padrao", { estagio: "fechado" });
  assert.deepEqual((await g("f-padrao")).modelo, { id: ID, versao: 2 });
  // cadastro que fecha: já era cliente e nunca viu o padrão, então fica no caminho de hoje
  await salvarCrm(db, "f-cad", { estagio: "fechado" });
  assert.equal((await g("f-cad")).modelo, undefined);
  assert.equal((await g("f-cad")).bio, undefined);
  // idempotente: de novo (pelo CRM, que não muda o estágio, e direto) não mexe em nada
  await salvarCrm(db, "f-null", { estagio: "fechado", proximaAcao: "Implantar" });
  assert.deepEqual(await congelarNegocio(db, "f-null", "fechou"), {});
  assert.deepEqual((await g("f-null")).modelo, { id: ID, versao: 2 });
  // negócio sem tenant (só no CRM) não quebra o CRM
  await salvarCrm(db, "so-crm", { estagio: "fechado" });
  assert.deepEqual(await congelarNegocio(db, "nao-existe", "fechou"), {});
  // o cadastro do dono nasce no padrão do ramo, congelado
  assert.deepEqual(await congelarNegocio(db, "f-cad", "cadastro"), { modelo: { id: ID, versao: 2 }, bio: { id: "bio-clara", versao: 1 } });

  // gaveta: prospecção segue a publicada, cliente fica na versão de agora. A casca devolve erro fora
  // de requisição (renovarSite chama revalidatePath), mas a gravação vem antes: confere-se o banco
  await definirModelo(admin, "f-hash", ID);
  assert.deepEqual((await g("f-hash")).modelo, { id: ID, versao: null });
  assert.deepEqual((await g("f-hash")).escolha, { kit: 2, cor: 4, modelo: ID }, "escolha do embutido junto");
  await definirModelo(admin, "f-escolha", ID);
  assert.deepEqual((await g("f-escolha")).modelo, { id: ID, versao: 2 }, "cliente: versão de agora");
  await definirModelo(admin, "f-escolha", null);
  assert.equal((await g("f-escolha")).modelo, undefined, "padrão do sistema apaga a ref");
  assert.equal((await g("f-escolha")).escolha, undefined);
  assert.deepEqual(await definirModelo(intruso, "f-hash", null), negado);
  await db.doc("config/modelos").delete();

  // migração: simulação só lê; aplicar grava; rodar de novo não muda nada
  await negocio("m-cli-null", { origem: "cadastro", modelo: { id: ID, versao: null }, bio: { id: "bio-agenda", versao: null } });
  await negocio("m-cli-escolha", { origem: "prospeccao", escolha: { kit: 1, cor: 2, modelo: "barbearia-2" } }, "fechado");
  await negocio("m-pro-escolha", { origem: "prospeccao", escolha: { kit: 1, cor: 2, modelo: "barbearia-2" } }, "oferta");
  await negocio("m-pro-null", { origem: "prospeccao", modelo: { id: ID, versao: null } }, "oferta");
  await negocio("m-cli-legado", { origem: "prospeccao", escolha: { kit: 1, cor: 2 } }, "fechado");
  const { catalogo } = await lerCatalogoDireto();
  const config = await lerConfig();
  const plano = await planoMigracao(db, catalogo, config);
  const de = new Map(plano.itens.map((i) => [i.slug, i.depois]));
  assert.deepEqual(de.get("m-cli-null"), { modelo: { id: ID, versao: 2 }, bio: { id: "bio-agenda", versao: 1 } });
  assert.deepEqual(de.get("m-cli-escolha"), { modelo: { id: "barbearia-2", versao: 1 } });
  assert.deepEqual(de.get("m-pro-escolha"), { modelo: { id: "barbearia-2", versao: null } });
  assert.equal(de.has("m-pro-null"), false, "prospecção com ref fica como está");
  assert.equal(de.has("m-cli-legado"), false, "cliente sem modelo nem padrão fica no caminho de hoje");
  assert.equal(de.has("f-null"), false, "já congelado");
  assert.equal(await ref("m-cli-null").then((r) => r.versao), null, "simular não grava");
  assert.equal(await aplicarMigracao(db, plano.itens), plano.itens.length);
  assert.deepEqual(await ref("m-cli-null"), { id: ID, versao: 2 });
  assert.deepEqual(await ref("m-pro-escolha"), { id: "barbearia-2", versao: null });
  assert.deepEqual((await planoMigracao(db, catalogo, config)).itens, [], "segunda rodada: nada");

  // gaveta do cliente congelado numa versão velha: "versão de dd/mm · há versão nova"
  await db.doc("tenants/m-cli-escolha").update({ "gerado.modelo": { id: ID, versao: 1 } });
  const r = await siteDoNegocio(admin, "m-cli-escolha");
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.dados.cliente, true);
  assert.equal(r.dados.modeloAtual, ID);
  assert.deepEqual([r.dados.versao?.congelada, r.dados.versao?.atual], [1, 2]);
  assert.match(r.dados.versao?.data ?? "", /^\d\d\/\d\d$/);
  assert.ok(r.dados.modelos.some((m) => m.id === "barbearia-1") && r.dados.modelos.every((m) => !m.id.startsWith("bio-")), "catálogo da família, sem bio");
  const p = await siteDoNegocio(admin, "m-pro-null");
  assert.ok(p.ok && p.dados.versao === null && p.dados.cliente === false);
}

// ————— F8.1: cópias da bio (site.color) depois de publicar, padrão e lote; cliente não muda —————
{
  const A = "cabeleireira-1", B = "cabeleireira-2";
  const salao = async (slug: string, gerado: object, estagio?: string) => {
    await db.doc(`tenants/${slug}`).set({ name: slug, site: { city: "Natal", uf: "RN", color: "#000000", photo: "x" }, gerado: { sub: "salao", origem: "prospeccao", ...gerado } });
    if (estagio) await db.doc(`crm/${slug}`).set({ estagio });
  };
  const cor = async (slug: string) => (await db.doc(`tenants/${slug}`).get()).get("site.color");
  const corDe = (slug: string, def: (typeof EMBUTIDOS)[number]) => visualDoSite(slug, "salao", undefined, null, def).cor;
  await salao("cp-ref", { modelo: { id: A, versao: null } });
  await salao("cp-escolha", { escolha: { kit: 0, cor: 0, modelo: A } });
  await salao("cp-livre", {}, "oferta");
  await salao("cp-cli", { modelo: { id: A, versao: 1 } }, "fechado");
  await salao("cp-cli-escolha", { escolha: { kit: 0, cor: 0, modelo: A } }, "fechado");
  await salao("cp-cli-livre", {}, "fechado");
  const clientes = ["cp-cli", "cp-cli-escolha", "cp-cli-livre"];
  const intocados = async () => { for (const s of clientes) assert.equal(await cor(s), "#000000", `${s} é cliente: cópia intocada`); };

  // publicar A: quem segue (ref null e escolha da gaveta antiga) recebe a cor nova
  const a1 = EMBUTIDOS.find((m) => m.id === A)!;
  const a2 = { ...a1, paleta: { ...a1.paleta, acc: "#123456" } };
  await salvarRascunho(A, a2);
  const pub = await publicar([A]);
  assert.deepEqual([pub[A].prospeccao, pub[A].clientes], [2, 1], "a escolha da gaveta antiga conta; o cliente com escolha é congelado");
  assert.deepEqual(await ref("cp-cli-escolha"), { id: A, versao: 1 }, "cliente só com a escolha fica na versão de antes");
  assert.ok(await recalcularCopias(db, { modelos: [A] }) >= 2);
  assert.equal(await cor("cp-ref"), "#123456");
  assert.equal(await cor("cp-escolha"), "#123456", "escolha manual segue a publicada");
  assert.equal((await lerSite(db, "cp-escolha"))?.def?.paleta.acc, "#123456", "o site também");
  assert.equal(await cor("cp-livre"), "#000000", "quem não segue A não muda");
  await intocados();

  // padrão do ramo = B: só a prospecção sem escolha muda; escolha manual vence o padrão
  await definirPadrao("site", "salao", B);
  await recalcularCopias(db, { sub: "salao" });
  const b = EMBUTIDOS.find((m) => m.id === B)!;
  assert.equal(await cor("cp-livre"), corDe("cp-livre", b));
  assert.equal(await cor("cp-escolha"), "#123456", "escolha manual não recebe o padrão");
  assert.equal((await lerSite(db, "cp-escolha"))?.def?.id, A);
  await intocados();

  // lote B em Natal (sem clientes) e desfazer
  const lote = await aplicarLote({ tipo: "site", modeloId: B, sub: "salao", cidade: "Natal" }, {});
  await recalcularCopias(db, { lote: lote.id! });
  assert.equal(await cor("cp-ref"), corDe("cp-ref", b));
  await intocados();
  await desfazerLote(lote.id!);
  await recalcularCopias(db, { lote: lote.id! });
  assert.equal(await cor("cp-ref"), "#123456", "desfazer devolve a cópia do modelo de antes");
  await intocados();
  await definirPadrao("site", "salao", null);
  console.log("cópias da bio: ok");
}

// ————— revisão Fable —————
{
  const g = async (slug: string) => (await db.doc(`tenants/${slug}`).get()).get("gerado");
  // H1: cliente só com a escolha congela na versão PUBLICADA (a que o resolver mostrava), não na 1
  const M = "barbearia-2", m1 = EMBUTIDOS.find((m) => m.id === M)!;
  for (const acc of ["#111111", "#222222"]) {
    await salvarRascunho(M, { ...m1, paleta: { ...m1.paleta, acc } });
    await publicar([M]);
  }
  assert.equal((await lerCatalogoDireto()).catalogo.get(M)?.versao, 3);
  await negocio("h1-escolha", { origem: "prospeccao", escolha: { kit: 0, cor: 0, modelo: M } }, "negociando");
  const antes = (await lerSite(db, "h1-escolha"))?.def;
  assert.equal(antes?.paleta.acc, "#222222");
  await salvarCrm(db, "h1-escolha", { estagio: "fechado" });
  assert.deepEqual((await g("h1-escolha")).modelo, { id: M, versao: 3 });
  assert.deepEqual((await lerSite(db, "h1-escolha"))?.def, antes, "fechar não muda o visual");
  await negocio("h1-mig", { origem: "prospeccao", escolha: { kit: 0, cor: 0, modelo: M } }, "fechado");
  {
    const { catalogo } = await lerCatalogoDireto();
    const plano = await planoMigracao(db, catalogo, await lerConfig());
    assert.deepEqual(plano.itens.find((i) => i.slug === "h1-mig")?.depois, { modelo: { id: M, versao: 3 } }, "a migração também");
  }

  // L8: lote vazio não grava registro
  const lotes = (await db.collection("lotes").get()).size;
  assert.deepEqual(await aplicarLote({ ...f, cidade: "Lugar Nenhum" }, {}), { id: null, prospeccao: 0, clientes: 0, total: 0 });
  assert.equal((await db.collection("lotes").get()).size, lotes);

  // M1: quem virou cliente depois do lote não volta no desfazer
  await negocio("m1-a", { origem: "prospeccao" }, "oferta", "Sobral");
  await negocio("m1-b", { origem: "prospeccao" }, "oferta", "Sobral");
  const l = await aplicarLote({ ...f, cidade: "Sobral" }, {});
  assert.equal(l.total, 2);
  await db.doc("crm/m1-a").set({ estagio: "fechado" });
  assert.deepEqual(await desfazerLote(l.id!), { restaurados: 1, mudaram: 0, viraramClientes: 1, semModelo: 0, jaDesfeito: false });
  assert.deepEqual(await ref("m1-a"), { id: ID, versao: null }, "cliente novo fica no modelo do lote");
  assert.equal(await ref("m1-b"), undefined);

  // Q1: convite aceito e site publicado contam como cliente
  await db.doc("config/modelos").set({ padroes: { site: { barbearia: ID } } });
  await negocio("cv-ref", { origem: "prospeccao", modelo: { id: ID, versao: null } }, "negociando", "Crato");
  await db.doc("tenants/cv-ref/members/u-cv1").set({ uid: "u-cv1", role: "owner", viaConvite: true });
  await negocio("cv-livre", { origem: "prospeccao" }, "negociando", "Crato");
  await db.doc("tenants/cv-livre/members/u-cv2").set({ uid: "u-cv2", role: "owner", viaConvite: true });
  await negocio("pub-livre", { origem: "prospeccao", publicadoEm: Timestamp.now() }, "negociando", "Crato");
  await negocio("cv-prospecto", { origem: "prospeccao" }, "negociando", "Crato");
  // padrão do ramo: só a prospecção de verdade
  assert.equal((await lerSite(db, "cv-livre"))?.def, undefined, "convite aceito não recebe o padrão");
  assert.equal((await lerSite(db, "pub-livre"))?.def, undefined, "site publicado não recebe o padrão");
  assert.equal((await lerSite(db, "cv-prospecto"))?.def?.id, ID);
  // lote sem a segunda confirmação não os pega
  assert.deepEqual(await contarLote({ ...f, cidade: "Crato" }), { prospeccao: 1, clientes: 3, comEscolhaManual: 1, total: 4 });
  const lc = await aplicarLote({ ...f, cidade: "Crato" }, {});
  assert.equal(lc.total, 1);
  assert.equal(await ref("cv-livre"), undefined);
  assert.equal(await ref("pub-livre"), undefined);
  // publicar congela o convite aceito que seguia a publicada
  const v = (await lerCatalogoDireto()).catalogo.get(ID)!.versao;
  await salvarRascunho(ID, { ...base, nome: "Barbearia Q1" });
  assert.equal((await publicar([ID]))[ID].clientes >= 1, true);
  assert.deepEqual(await ref("cv-ref"), { id: ID, versao: v }, "convite aceito fica na versão de antes");
  assert.deepEqual(await ref("cv-prospecto"), { id: ID, versao: null }, "prospecção segue a publicada");
  // migração congela quem aceitou o convite (ref null criada depois do publicar)
  await negocio("cv-mig", { origem: "prospeccao", modelo: { id: ID, versao: null } }, "negociando", "Crato");
  await db.doc("tenants/cv-mig/members/u-cv3").set({ uid: "u-cv3", role: "owner", viaConvite: true });
  {
    const { catalogo } = await lerCatalogoDireto();
    const plano = await planoMigracao(db, catalogo, await lerConfig());
    assert.deepEqual(plano.itens.find((i) => i.slug === "cv-mig")?.depois, { modelo: { id: ID, versao: v + 1 } });
    assert.equal(plano.itens.find((i) => i.slug === "cv-mig")?.cliente, true);
  }
  // aceitar o convite congela no padrão que a prospecção via; publicar o site também
  await negocio("cv-aceita", { origem: "prospeccao" }, "negociando", "Crato");
  await db.doc("tenants/cv-aceita/members/u-cv4").set({ uid: "u-cv4", role: "owner", viaConvite: true });
  assert.deepEqual((await congelarNegocio(db, "cv-aceita", "convite"))?.modelo, { id: ID, versao: v + 1 });
  await negocio("pub-agora", { origem: "prospeccao" }, "negociando", "Crato");
  assert.ok(await publicarSite(db, "pub-agora"));
  assert.deepEqual((await g("pub-agora")).modelo, { id: ID, versao: v + 1 }, "publicarSite congela");
  // já era cliente por outro sinal (convite) e nunca viu o padrão: publicar não o põe no padrão
  await negocio("cv-e-pub", { origem: "prospeccao" }, "negociando", "Crato");
  await db.doc("tenants/cv-e-pub/members/u-cv5").set({ uid: "u-cv5", role: "owner", viaConvite: true });
  await publicarSite(db, "cv-e-pub");
  assert.equal((await g("cv-e-pub")).modelo, undefined);
  await db.doc("config/modelos").delete();
}

console.log("modelos-lote ok");
