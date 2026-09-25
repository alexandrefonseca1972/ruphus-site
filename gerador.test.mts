// Gerador de sites: planilha → leads → HTML. Sem banco.
//   npm run test:gerador
import assert from "node:assert/strict";
import lerAbas from "read-excel-file/node";
import { candidatos, type DadosSite, fixo, lerPlanilha as lerAbasDaPlanilha, nichoDe, variante } from "@/lib/gerador";

// uma aba só, como a maioria das planilhas
const lerPlanilha = (linhas: unknown[][]) => lerAbasDaPlanilha([{ aba: "Leads", linhas }]);
import { renderBeleza } from "@/lib/site-beleza";
import { renderPet } from "@/lib/site-pet";

// cabeçalho com acento, maiúscula e nome em inglês, depois de uma linha de título
{
  const { leads, erros, ignoradas } = lerPlanilha([
    ["Leads de setembro"],
    ["Nome", "WhatsApp", "Categoria", "Endereço", "Cidade", "UF", "Nota", "Reviews", "Instagram", "Serviços", "E-mail", "Tempo de atividade"],
    ["Pet Feliz", "(91) 99372-1156", "Pet shop", "Av. Nazaré, 10", "Belém", "pa", "4,6", 59, "https://instagram.com/petfeliz/", "Banho, Tosa; Banho", "Dono@Pet.com", "x"],
    ["Barbearia do Zé", 92991234567, "Barbearia", "", "Manaus", "AM", 4.9, "120", "@barbadoze", "", "", ""],
    [],
    ["Sem Telefone", "", "Pet shop"],
    ["Oficina X", "(11) 98888-7777", "Mecânica"],
    ["Pet Repetido", "91 99372 1156", "Pet shop"],
  ]);
  assert.deepEqual(ignoradas, ["Tempo de atividade"], "coluna desconhecida é avisada, não quebra");
  assert.equal(leads.length, 2);
  const [pet, barba] = leads.map((l) => l.lead);
  assert.equal(leads[0].linha, 3, "linha como o Excel numera, contando o título");
  assert.equal(pet.telefone, "5591993721156");
  assert.equal(pet.nota, 4.6, "vírgula decimal");
  assert.equal(pet.uf, "PA");
  assert.equal(pet.instagram, "petfeliz", "URL do Instagram vira o perfil");
  assert.deepEqual(pet.servicos, ["Banho", "Tosa"], "vírgula e ponto e vírgula separam, repetido sai");
  assert.equal(pet.email, "dono@pet.com");
  assert.equal(barba.telefone, "5592991234567", "número vindo como número da planilha");
  assert.equal(barba.avaliacoes, 120);
  assert.equal(barba.instagram, "barbadoze");
  assert.deepEqual(erros.map((e) => e.linha), [6, 7, 8], "linha em branco não conta como erro");
  assert.match(erros[0].motivo, /Telefone/);
  assert.match(erros[1].motivo, /nicho/);
  assert.match(erros[2].motivo, /linha 3/, "telefone repetido aponta a primeira linha");
}
// a planilha modelo que o admin baixa sai inteira, sem coluna ignorada
{
  // a aba "Como preencher" não tem cabeçalho de leads e é pulada sem erro
  const modelo = lerAbasDaPlanilha((await lerAbas("public/modelo-leads.xlsx")).map(({ sheet, data }) => ({ aba: sheet, linhas: data as unknown[][] })));
  assert.deepEqual([modelo.leads.length, modelo.erros, modelo.ignoradas], [2, [], []]);
  assert.deepEqual(modelo.leads.map((l) => nichoDe(l.lead)?.sub), ["petshop", "barbearia"]);
  assert.equal(modelo.leads[0].lead.nota, 4.7);
}
// várias abas (levas de um levantamento): o mesmo negócio em duas abas entra uma vez só,
// aba de notas é pulada, e as colunas do levantamento são reconhecidas
{
  const cab = ["#", "Empresa", "Cidade", "Categoria(s)", "Nota", "Nº avaliações", "Telefone / WhatsApp", "Rede social principal + frequência", "Score", "Gancho de abordagem sugerido"];
  const { leads, erros } = lerAbasDaPlanilha([
    { aba: "Leads Qualificados", linhas: [cab,
      [1, "Clínica Day Spa", "Macapá", "Spa de saúde / Estética", "4,9", 224, "(96) 99108-6847", "Instagram @dayspa_ap (27,7k) — ativa", "ALTA", "Vocês são o 1º resultado do Google"],
      [2, "Kaos Tattoo", "Macapá", "Studio de Tatuagem", "4,9", 99, "(96) 98100-4332", "", "ALTA", ""]] },
    { aba: "Metodologia e Notas", linhas: [["Notas metodológicas"], ["Data do levantamento: 23/09/2026"]] },
    { aba: "3ª leva", linhas: [cab,
      [71, "CLÍNICA DAY SPA", "Macapá", "Clínica de Estética / Spa", "4,9", 224, "(96) 99108-6847", "", "ALTA", ""],
      [72, "Bestlaser", "Macapá", "Clínica de Estética / Laser", "5,0", 433, "(96) 3217-8751", "Facebook provável (não auditado)", "MÉDIA", ""]] },
  ]);
  assert.deepEqual(leads.map((l) => [l.aba, l.lead.nome]), [["Leads Qualificados", "Clínica Day Spa"], ["3ª leva", "Bestlaser"]]);
  const [spa, laser] = leads.map((l) => l.lead);
  assert.equal(spa.avaliacoes, 224, "Nº avaliações");
  assert.equal(nichoDe(spa)?.sub, "estetica", "Categoria(s)");
  assert.equal(spa.instagram, "dayspa_ap", "@ tirado do texto da rede social");
  assert.equal(laser.instagram, "", "texto sem @ não vira Instagram");
  assert.deepEqual([spa.score, spa.abordagem], ["ALTA", "Vocês são o 1º resultado do Google"]);
  assert.ok(fixo(laser.telefone) && !fixo(spa.telefone), "fixo tem 8 dígitos depois do DDD");
  assert.deepEqual(erros.map((e) => [e.aba, e.linha]), [["Leads Qualificados", 3], ["3ª leva", 2]], "a aba de notas não gera erro");
  assert.match(erros[0].motivo, /nicho/, "tatuagem fica de fora");
  assert.match(erros[1].motivo, /Mesmo telefone da linha 2 \(Leads Qualificados\)/, "repetido entre abas aponta a aba");
}
// os ramos do levantamento de beleza que antes caíam fora
for (const [categoria, sub] of [["Massoterapia", "estetica"], ["Podologia", "estetica"], ["Salão de bronzeamento", "estetica"], ["Biomedicina estética", "estetica"],
  ["Studio de Maquiagem / Beleza", "estetica"], ["Clínica de dermatologia", "estetica"], ["Tranças / Penteados Afro", "salao"], ["Esmalteria (shopping)", "unhas"]] as const) {
  assert.equal(nichoDe({ categoria, nome: "" })?.sub, sub, categoria);
}

// sem coluna de nome não há o que ler
assert.match(lerPlanilha([["a", "b"], [1, 2]]).erros[0].motivo, /cabeçalho/);

// nicho: veterinária antes de pet shop, unha antes de salão, tatuagem fora,
// e o nome só decide quando não há categoria
assert.equal(nichoDe({ categoria: "Clínica Veterinária", nome: "" })?.sub, "vet");
assert.equal(nichoDe({ categoria: "Banho e tosa", nome: "" })?.sub, "petshop");
assert.equal(nichoDe({ categoria: "Esmalteria", nome: "" })?.sub, "unhas");
assert.equal(nichoDe({ categoria: "Salão de Beleza", nome: "" })?.tipo, "HairSalon");
assert.equal(nichoDe({ categoria: "Design de sobrancelhas", nome: "" })?.sub, "estetica");
assert.equal(nichoDe({ categoria: "Studio de tatuagem", nome: "" }), null);
assert.equal(nichoDe({ categoria: "Restaurante", nome: "Petisco Bar" }), null);
assert.equal(nichoDe({ categoria: "", nome: "Barbearia Navalha" })?.sub, "barbearia");

// endereço: nome, depois nome + cidade; reservado e acento resolvidos
assert.deepEqual(candidatos({ nome: "Salão da Ná", cidade: "São Luís", slug: "" }).slice(0, 2), ["salao-da-na", "salao-da-na-sao-luis"]);
assert.equal(candidatos({ nome: "Admin", cidade: "Belém", slug: "" })[0], "admin-belem", "nome reservado pula para o próximo");
assert.equal(candidatos({ nome: "Qualquer", cidade: "", slug: "meu-pet" })[0], "meu-pet", "slug da planilha vence");
assert.ok(candidatos({ nome: "x".repeat(90), cidade: "Manaus", slug: "" }).every((s) => s.length <= 63));

// variante: estável para o mesmo slug, e espalha
assert.equal(variante("pet-feliz", 7), variante("pet-feliz", 7));
assert.ok(new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map((s) => variante(s, 4))).size > 1);

// HTML: o que vem da planilha sai escapado, e a camada da Ruphus vai em todo site
const base: DadosSite = {
  slug: "pet-feliz", nome: 'Pet <script>alert("x")</script> Feliz', telefone: "5591993721156", sub: "petshop", tipo: "PetStore",
  endereco: "Av. Nazaré, 10", bairro: "Nazaré", cidade: "Belém", uf: "PA", nota: 4.6, avaliacoes: 59, instagram: "",
  horario: "seg-sab 8h às 18h", servicos: ["Banho", "Tosa"], consultado: "setembro de 2026",
};
for (const [nome, html] of [
  ["pet", renderPet(base)],
  ["vet", renderPet({ ...base, sub: "vet", tipo: "VeterinaryCare" })],
  ["barbearia", renderBeleza({ ...base, sub: "barbearia", tipo: "BarberShop" })],
  ["unhas", renderBeleza({ ...base, sub: "unhas", tipo: "NailSalon", nota: null, avaliacoes: null })],
] as const) {
  assert.ok(!html.includes("<script>alert"), `${nome}: nome escapado`);
  assert.ok(!/"telephone":"\+5511948680554"/.test(html), `${nome}: JSON-LD com o telefone do negócio, não o nosso`);
  assert.ok(html.includes('"telephone":"+5591993721156"'), `${nome}: telefone do lead no JSON-LD`);
  assert.ok(!html.includes("sobreassets"), `${nome}: caminho da imagem do JSON-LD`);
  assert.ok(!html.includes("instagram.com/"), `${nome}: sem Instagram, sem link de Instagram`);
  assert.ok(html.includes('data-ysis="proposta"') && html.includes('data-agendar="1"') && html.includes('data-ysis="aviso"'), `${nome}: camada Ruphus`);
  assert.ok(html.includes('<link rel="canonical" href="https://pet-feliz.ruphus.site/">'), `${nome}: canonical`);
  assert.ok(html.includes('content="noindex, nofollow"'), `${nome}: fora do Google`);
  assert.ok(!html.includes("undefined") && !html.includes("null"), `${nome}: nenhum campo vazio vazou`);
}
// JSON-LD não fecha a tag com "</script>" no nome
assert.ok(renderPet({ ...base, nome: "A</script><b>" }).includes("A\\u003c/script>\\u003cb>"));
// sem nota, a seção de avaliações some
assert.ok(!renderBeleza({ ...base, sub: "salao", nota: null, avaliacoes: null }).includes('id="depoimentos"'));
assert.ok(!renderPet({ ...base, nota: null, avaliacoes: null }).includes('id="avaliacoes"'));
// com Instagram, o link aparece
assert.ok(renderPet({ ...base, instagram: "petfeliz" }).includes("https://www.instagram.com/petfeliz/"));

console.log("gerador: ok");
