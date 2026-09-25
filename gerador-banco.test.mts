// Rode: npm run test:gerador-banco  (gravação do gerador de sites no emulador do Firestore)
import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { lerPlanilha } from "@/lib/gerador";
import { gerarNoBanco } from "@/lib/gerador.server";

const db = getFirestore(initializeApp({ projectId: "demo-siteflow" }));
const planilha = (...linhas: unknown[][]) =>
  lerPlanilha([{ aba: "Leads", linhas: [["nome", "telefone", "categoria", "cidade", "uf", "nota", "avaliacoes", "servicos", "email", "score", "gancho"], ...linhas] }]).leads;

// um site da fábrica já mora em "pet-feliz": o gerador não pode encostar nele
await db.collection("tenants").doc("pet-feliz").set({ name: "Pet Feliz (fábrica)", site: { phone: "5591000000000", city: "Belém" } });

const lote = planilha(
  ["Pet Feliz", "(91) 99372-1156", "Pet shop", "Belém", "PA", 4.6, 59, "Banho, Tosa", "dono@petfeliz.com", "ALTA", "Nota 4,6 e nenhum site"],
  ["Pet Feliz", "(91) 98888-0000", "Pet shop", "Belém", "PA", "", "", "", "", "", ""],
  ["Navalha", "(92) 99123-4567", "Barbearia", "Manaus", "AM", "", "", "", "", "", ""],
  // o mesmo negócio da fábrica, com outro nome na planilha: não ganha segundo site
  ["Patinhas do Umarizal", "(91) 00000-0000", "Pet shop", "Belém", "PA", "", "", "", "", "", ""],
  ["Salão Fixo", "(96) 3217-8751", "Salão de beleza", "Macapá", "AP", "", "", "", "", "", ""],
);

// prévia não grava nada
const previa = await gerarNoBanco(db, lote, false, "dono-plataforma");
assert.deepEqual(previa.map((l) => [l.slug, l.acao, l.conflito, l.aviso]), [
  // o nome estava ocupado pela fábrica, na mesma cidade e com outro telefone: gera, mas avisa
  ["pet-feliz-belem", "criar", "pet-feliz", "possível duplicado de pet-feliz"],
  ["pet-feliz-belem-2", "criar", "pet-feliz", "possível duplicado de pet-feliz"],
  ["navalha", "criar", null, null],
  ["pet-feliz", "pular", null, null],
  ["salao-fixo", "criar", null, "telefone fixo: o botão de WhatsApp do site não vai funcionar"],
]);
assert.equal(previa[3].motivo, "já tem site: pet-feliz.ruphus.site");
assert.equal((await db.collection("tenants").doc("navalha").get()).exists, false, "prévia não grava");

// grava: tenant, dono, agenda e CRM no mesmo formato do importador
const feito = await gerarNoBanco(db, lote, true, "dono-plataforma");
assert.deepEqual(feito, previa, "o que a prévia mostrou é o que foi gravado");
assert.equal((await db.collection("tenants").doc("patinhas-do-umarizal").get()).exists, false, "linha pulada não grava");
assert.equal((await db.doc("tenants/pet-feliz").get()).get("site.phone"), "5591000000000", "e não mexe no site que já existe");
const t = (await db.collection("tenants").doc("pet-feliz-belem").get()).data()!;
assert.equal(t.name, "Pet Feliz");
assert.equal(t.ownerId, "dono-plataforma");
assert.equal(t.site.phone, "5591993721156");
assert.equal(t.site.category, "PetStore");
assert.equal(t.site.rating, 4.6);
assert.match(t.site.photo, /^\/assets\/pet\/.+-800\.jpg$/);
assert.equal(t.gerado.sub, "petshop");
assert.equal((await db.doc("tenants/pet-feliz-belem/members/dono-plataforma").get()).get("role"), "owner");
const servicos = await db.collection("tenants/pet-feliz-belem/services").orderBy("ordem").get();
assert.deepEqual(servicos.docs.map((d) => [d.id, d.get("durationMin")]), [["banho", 60], ["tosa", 90]]);
assert.deepEqual((await db.doc("tenants/pet-feliz-belem/staff/equipe").get()).get("serviceIds"), ["banho", "tosa"]);
const crm = (await db.doc("crm/pet-feliz-belem").get()).data()!;
assert.deepEqual([crm.origem, crm.donoEmail, crm.notas], ["importado", "dono@petfeliz.com", 1]);
// o levantamento do lead vira nota no funil
const notas = await db.collection("crm/pet-feliz-belem/notas").get();
assert.deepEqual(notas.docs.map((d) => [d.get("texto"), d.get("autor")]), [["Score do levantamento: ALTA. Abordagem sugerida: Nota 4,6 e nenhum site", "Gerador de sites"]]);
assert.equal((await db.collection("crm/navalha/notas").get()).size, 0, "sem levantamento, sem nota");
// sem serviços na planilha, o catálogo sai do ramo
assert.deepEqual((await db.collection("tenants/navalha/services").get()).docs.map((d) => d.id).sort(), ["barba", "corte", "corte-barba"]);
// a fábrica continua intacta
assert.equal((await db.doc("tenants/pet-feliz").get()).get("name"), "Pet Feliz (fábrica)");

// o dono mexeu no negócio: preço, serviço desligado e estágio no funil
await db.doc("tenants/pet-feliz-belem/services/banho").update({ priceCents: 7500 });
await db.doc("crm/pet-feliz-belem").update({ estagio: "negociando" });

// reenviar a planilha atualiza o site (mesmo telefone = mesmo lead), sem duplicar
// nem apagar o que o dono e o funil fizeram
const reenvio = planilha(["Pet Feliz", "91993721156", "Pet shop", "Belém", "PA", 4.8, 70, "Banho, Tosa, Hotel", "", "ALTA", "outra nota"]);
const [de_novo] = await gerarNoBanco(db, reenvio, true, "outro-admin");
assert.deepEqual([de_novo.slug, de_novo.acao], ["pet-feliz-belem", "atualizar"]);
const t2 = (await db.doc("tenants/pet-feliz-belem").get()).data()!;
assert.deepEqual([t2.site.rating, t2.site.reviews], [4.8, 70], "dados do Google atualizados");
assert.equal(t2.ownerId, "dono-plataforma", "dono não troca no reenvio");
assert.equal((await db.doc("tenants/pet-feliz-belem/services/banho").get()).get("priceCents"), 7500, "preço do dono fica");
assert.equal((await db.doc("tenants/pet-feliz-belem/services/hotel").get()).exists, false, "agenda não é refeita no reenvio");
assert.equal((await db.doc("crm/pet-feliz-belem").get()).get("estagio"), "negociando", "funil fica");
assert.equal((await db.doc("crm/pet-feliz-belem").get()).get("donoEmail"), "dono@petfeliz.com", "e-mail do dono fica");
assert.equal((await db.collection("crm/pet-feliz-belem/notas").get()).size, 1, "reenvio não repete a nota");

// o lead mudou de nome na planilha, mas o telefone é o mesmo: atualiza o site que já
// existe, em vez de abrir outro endereço para o mesmo negócio
const [renomeado] = await gerarNoBanco(db, planilha(["Pet Feliz Nazaré", "(91) 99372-1156", "Pet shop", "Belém", "PA", 4.8, 70, "", "", "", ""]), true, "a");
assert.deepEqual([renomeado.slug, renomeado.acao], ["pet-feliz-belem", "atualizar"]);
assert.equal((await db.doc("tenants/pet-feliz-nazare").get()).exists, false);
assert.equal((await db.doc("tenants/pet-feliz-belem").get()).get("name"), "Pet Feliz Nazaré", "o nome novo vale");

// mais de 30 telefones: o "in" do Firestore vai em blocos, e o 33º ainda é conferido
const grande = planilha(...Array.from({ length: 35 }, (_, i) =>
  [`Loja ${i}`, i === 32 ? "91000000000" : `(96) 99${String(i).padStart(3, "0")}-0000`, "Barbearia", "Macapá", "AP", "", "", "", "", "", ""]));
const conferido = await gerarNoBanco(db, grande, false, "a");
assert.equal(conferido.length, 35);
assert.deepEqual([conferido[32].acao, conferido[32].slug], ["pular", "pet-feliz"]);
assert.equal(conferido.filter((l) => l.acao === "pular").length, 1);

// a rota monta a página do que foi gravado; site da fábrica e slug estranho não passam por ela
const { GET } = await import("@/app/s/[slug]/index.html/route");
const pagina = (slug: string) => GET(new Request(`http://x/s/${slug}/index.html`), { params: Promise.resolve({ slug }) });
const r = await pagina("pet-feliz-belem");
assert.equal(r.status, 200);
assert.match(r.headers.get("content-type") ?? "", /text\/html/);
const html = await r.text();
assert.ok(html.includes("<title>Pet Feliz Nazaré | Pet shop em Belém</title>"), "nome (já renomeado) e cidade do tenant");
assert.ok(html.includes("4,8 &middot; 70 avaliações"), "nota atualizada no reenvio");
assert.ok(html.includes("<h3>Banho</h3>") && html.includes("<h3>Tosa</h3>"), "serviços vêm da agenda");
assert.equal((await pagina("navalha")).status, 200);
assert.match(await (await pagina("navalha")).text(), /assets\/gerado\/beleza\.css/, "barbearia usa o modelo beleza");
assert.equal((await pagina("pet-feliz")).status, 404, "tenant da fábrica não é gerado");
assert.equal((await pagina("nao-existe")).status, 404);
assert.equal((await pagina("../etc")).status, 404);

// entrada adulterada no navegador não passa
await assert.rejects(gerarNoBanco(db, [{ linha: 1, lead: { nome: "x" } }], true, "a"), /Planilha inválida/);
await assert.rejects(gerarNoBanco(db, Array(301).fill(lote[0]), false, "a"), /300/);

console.log("gerador-banco: ok");
