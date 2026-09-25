// Rode: npm run test:gerador-banco  (gravação do gerador de sites no emulador do Firestore)
import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { dateIn } from "@/lib/datetime";
import { lerPlanilha } from "@/lib/gerador";
import { gerarNoBanco, lerSite } from "@/lib/gerador.server";
import { criarNegocio, lerNegocio, lerSiteDoNegocio, previaDoSite, salvarNegocio } from "@/lib/negocios.server";

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

// ─── Cadastro pelo dono: o negócio já nasce com site, agenda, equipe e funil ───
{
  const dona = { uid: "dona-cadastro", email: "dona@exemplo.com", name: "Dra. Ana" };
  const base = { name: "Sorriso Leve", slug: "sorriso-leve", sub: "odonto", telefone: "(96) 99111-2222", cidade: "Macapá", uf: "ap", bairro: "Centro" };
  await assert.rejects(criarNegocio(db, dona, { ...base, sub: "" }), /ramo/, "sem ramo não cria");
  await assert.rejects(criarNegocio(db, dona, { ...base, telefone: "123" }), /WhatsApp/);
  assert.equal(await criarNegocio(db, dona, base), "sorriso-leve");

  const t = (await db.doc("tenants/sorriso-leve").get()).data()!;
  assert.deepEqual([t.name, t.ownerId, t.site.phone, t.site.uf, t.site.category], ["Sorriso Leve", "dona-cadastro", "5596991112222", "AP", "Dentist"]);
  assert.deepEqual([t.gerado.sub, t.gerado.origem], ["odonto", "cadastro"]);
  const membro = (await db.doc("tenants/sorriso-leve/members/dona-cadastro").get()).data()!;
  assert.deepEqual([membro.role, membro.email, membro.nome], ["owner", "dona@exemplo.com", "Dra. Ana"]);
  const servicos = await db.collection("tenants/sorriso-leve/services").get();
  assert.ok(servicos.size >= 3, "a agenda já nasce com os serviços do ramo");
  assert.ok(servicos.docs.every((d) => d.get("priceCents") === 0), "saúde sem preço");
  const equipe = (await db.doc("tenants/sorriso-leve/staff/equipe").get()).data()!;
  assert.equal(equipe.name, "Dra. Ana", "a equipe começa com o nome do dono");
  assert.equal(equipe.serviceIds.length, servicos.size, "e faz todos os serviços: a agenda abre no primeiro minuto");
  const crm = (await db.doc("crm/sorriso-leve").get()).data()!;
  assert.deepEqual([crm.origem, crm.donoEmail, crm.donoNome], ["cadastro", "dona@exemplo.com", "Dra. Ana"]);
  // ninguém é avisado de um cadastro: ele já entra no funil com o contato combinado para hoje
  assert.deepEqual([crm.proximaAcao, crm.proximaData], ["Dar boas-vindas: cadastrou sozinho no site", dateIn(new Date())]);

  // o site é dele: sem a faixa de proposta nem o "Pedir remoção"
  const site = (await lerSite(db, "sorriso-leve"))!;
  assert.equal(site.origem, "cadastro");
  const { GET } = await import("@/app/s/[slug]/index.html/route");
  const html = await (await GET(new Request("http://x/"), { params: Promise.resolve({ slug: "sorriso-leve" }) })).text();
  assert.ok(!html.includes('data-ysis="proposta"') && !html.includes("Pedir remoção"), "cadastro não é proposta");
  assert.ok(html.includes("Site criado com Ruphus"));
  assert.ok(!/R\$\s?\d/.test(html), "e continua sem preço de saúde");

  // a cota continua valendo: 1 negócio por conta
  await assert.rejects(criarNegocio(db, dona, { ...base, slug: "outro-sorriso" }), /Sua conta inclui 1 negócio/);
  assert.equal((await db.doc("tenants/outro-sorriso").get()).exists, false, "e nada foi gravado");

  // "Meu negócio": muda os dados e o ramo sem mexer na agenda
  await db.doc("tenants/sorriso-leve/services/limpeza").update({ priceCents: 12000 });
  await salvarNegocio(db, "sorriso-leve", { name: "Sorriso Leve Odonto", sub: "odonto", telefone: "96991113333", cidade: "Macapá", uf: "AP", instagram: "@sorrisoleve", horario: "Seg a sex, 8h às 18h" });
  const t2 = (await db.doc("tenants/sorriso-leve").get()).data()!;
  assert.deepEqual([t2.name, t2.site.phone, t2.site.instagram, t2.gerado.horario, t2.gerado.origem], ["Sorriso Leve Odonto", "5596991113333", "sorrisoleve", "Seg a sex, 8h às 18h", "cadastro"]);
  assert.equal((await db.doc("tenants/sorriso-leve/services/limpeza").get()).get("priceCents"), 12000, "o preço que o dono pôs fica");
  assert.equal((await lerNegocio(db, "sorriso-leve")).instagram, "sorrisoleve");
  await assert.rejects(salvarNegocio(db, "sorriso-leve", { name: "X" }), /nome|ramo/);
}
// negócio criado antes do site automático ganha o site ao escolher o ramo
{
  await db.doc("tenants/antigo").set({ name: "Antigo", ownerId: "alguem" });
  assert.equal(await lerSite(db, "antigo"), null);
  await salvarNegocio(db, "antigo", { name: "Antigo", sub: "barbearia", telefone: "96991114444", cidade: "Santana", uf: "AP" });
  assert.equal((await lerSite(db, "antigo"))?.origem, "cadastro");
  assert.equal((await db.collection("tenants/antigo/services").get()).size, 0, "a agenda de quem já existia não é mexida");
}
// site da fábrica: os dados mudam, mas ele não vira site gerado (a página é o arquivo)
{
  await db.doc("tenants/fabrica-x").set({ name: "Fábrica X", ownerId: "p", site: { url: "https://fabrica-x.ruphus.site", phone: "5591000000001", rating: 4.8 } });
  assert.equal((await lerNegocio(db, "fabrica-x")).fabrica, true);
  await salvarNegocio(db, "fabrica-x", { name: "Fábrica X", sub: "petshop", telefone: "91988887777", cidade: "Belém", uf: "PA" });
  const f = (await db.doc("tenants/fabrica-x").get()).data()!;
  assert.deepEqual([f.site.phone, f.site.rating, f.gerado], ["5591988887777", 4.8, undefined]);
}
// a prospecção que o dono edita não perde a nota do Google
{
  await salvarNegocio(db, "navalha", { name: "Navalha", sub: "barbearia", telefone: "(92) 99123-4567", cidade: "Manaus", uf: "AM" });
  const n = (await db.doc("tenants/navalha").get()).data()!;
  assert.equal(n.gerado.origem, "prospeccao", "o site continua sendo proposta até a Ruphus mudar");
}

// ─── Gaveta do admin, aba "Site": completar o site de quem se cadastrou ───
{
  // a planilha com o telefone de um cliente do cadastro não regrava o site dele como proposta
  const [p] = await gerarNoBanco(db, planilha(["Sorriso da Planilha", "(96) 99111-3333", "Odontologia", "Macapá", "AP", 4.9, 30, "", "", "", ""]), true, "a");
  assert.deepEqual([p.slug, p.acao], ["sorriso-leve", "pular"]);
  assert.match(p.motivo ?? "", /cliente do cadastro/);
  const intacto = (await db.doc("tenants/sorriso-leve").get()).data()!;
  assert.deepEqual([intacto.name, intacto.gerado.origem], ["Sorriso Leve Odonto", "cadastro"], "nome e origem do dono ficam");

  const pedido = { name: "Sorriso Leve Odonto", sub: "odonto", telefone: "96991113333", cidade: "Macapá", uf: "AP", bairro: "Trem", instagram: "@sorrisoleve", horario: "Seg a sex, 8h às 18h" };
  const google = { nota: 4.9, avaliacoes: 30 };
  assert.equal((await lerSiteDoNegocio(db, "sorriso-leve")).tipo, "cadastro");
  // a prévia diz só o que muda, e não grava
  const pr = await previaDoSite(db, "sorriso-leve", pedido, google);
  assert.deepEqual(pr.mudancas.map((m) => [m.campo, m.antes, m.depois]), [["Bairro", "", "Trem"], ["Nota no Google", "", "4,9"], ["Avaliações no Google", "", "30"]]);
  assert.equal((await db.doc("tenants/sorriso-leve").get()).get("gerado.bairro"), "", "prévia não grava");
  await assert.rejects(previaDoSite(db, "sorriso-leve", { ...pedido, sub: "" }, google), /ramo/);

  // gravar leva a nota do Google e o site continua do dono
  await salvarNegocio(db, "sorriso-leve", pedido, google);
  const s = (await db.doc("tenants/sorriso-leve").get()).data()!;
  assert.deepEqual([s.site.rating, s.site.reviews, s.gerado.bairro, s.gerado.origem], [4.9, 30, "Trem", "cadastro"]);
  assert.equal((await db.doc("tenants/sorriso-leve/services/limpeza").get()).get("priceCents"), 12000, "a agenda do dono não muda");
  assert.equal((await previaDoSite(db, "sorriso-leve", pedido, google)).mudancas.length, 0, "depois de gravar, nada a mudar");
  // e o dono salvando pelo "Meu negócio" depois não apaga a nota
  await salvarNegocio(db, "sorriso-leve", pedido);
  assert.equal((await lerSiteDoNegocio(db, "sorriso-leve")).google.nota, 4.9);

  // os outros tipos que a aba reconhece
  await db.doc("tenants/sem-site").set({ name: "Sem Site", ownerId: "alguem" });
  assert.equal((await lerSiteDoNegocio(db, "sem-site")).tipo, "sem-site");
  assert.equal((await lerSiteDoNegocio(db, "fabrica-x")).tipo, "fabrica");
  assert.equal((await lerSiteDoNegocio(db, "navalha")).tipo, "prospeccao");
  // na fábrica, a prévia não oferece o que não muda a página
  const pf = await previaDoSite(db, "fabrica-x", { name: "Fábrica X", sub: "vet", telefone: "91988887777", cidade: "Belém", uf: "PA", bairro: "Nazaré" }, google);
  assert.deepEqual(pf.mudancas, []);
}

// entrada adulterada no navegador não passa
await assert.rejects(gerarNoBanco(db, [{ linha: 1, lead: { nome: "x" } }], true, "a"), /Planilha inválida/);
await assert.rejects(gerarNoBanco(db, Array(301).fill(lote[0]), false, "a"), /300/);

console.log("gerador-banco: ok");
