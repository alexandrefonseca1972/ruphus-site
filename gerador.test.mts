// Gerador de sites: planilha → leads → HTML. Sem banco.
//   npm run test:gerador
import assert from "node:assert/strict";
import lerAbas from "read-excel-file/node";
import { candidatos, type DadosSite, fixo, lerPlanilha as lerAbasDaPlanilha, nichoDe, ufDoTelefone, variante } from "@/lib/gerador";

// uma aba só, como a maioria das planilhas
const lerPlanilha = (linhas: unknown[][]) => lerAbasDaPlanilha([{ aba: "Leads", linhas }]);
import { renderEditorial as renderBeleza } from "@/lib/site-editorial";
import { existsSync } from "node:fs";
import { AULAS } from "@/lib/nichos/aulas";
import { AUTOMOTIVO } from "@/lib/nichos/automotivo";
import { FITNESS } from "@/lib/nichos/fitness";
import { PET } from "@/lib/nichos/pet";
import { SAUDE } from "@/lib/nichos/saude";
import { ehClaro, renderClaro, renderClaro as renderPet } from "@/lib/site-claro";

// cabeçalho com acento, maiúscula e nome em inglês, depois de uma linha de título
{
  const { leads, erros, ignoradas } = lerPlanilha([
    ["Leads de setembro"],
    ["Nome", "WhatsApp", "Categoria", "Endereço", "Cidade", "UF", "Nota", "Reviews", "Instagram", "Serviços", "E-mail", "Tempo de atividade"],
    ["Pet Feliz", "(91) 99372-1156", "Pet shop", "Av. Nazaré, 10", "Belém", "pa", "4,6", 59, "https://instagram.com/petfeliz/", "Banho, Tosa; Banho", "Dono@Pet.com", "x"],
    ["Barbearia do Zé", 92991234567, "Barbearia", "", "Manaus", "AM", 4.9, "120", "@barbadoze", "", "", ""],
    [],
    ["Sem Telefone", "", "Pet shop"],
    ["Restaurante do Zé", "(11) 98888-7777", "Restaurante"],
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
  assert.deepEqual(leads.map((l) => [l.aba, l.lead.nome]), [["Leads Qualificados", "Clínica Day Spa"], ["Leads Qualificados", "Kaos Tattoo"], ["3ª leva", "Bestlaser"]]);
  const [spa, , laser] = leads.map((l) => l.lead);
  assert.equal(spa.avaliacoes, 224, "Nº avaliações");
  assert.equal(nichoDe(spa)?.sub, "estetica", "Categoria(s)");
  assert.equal(spa.instagram, "dayspa_ap", "@ tirado do texto da rede social");
  assert.equal(laser.instagram, "", "texto sem @ não vira Instagram");
  assert.deepEqual([spa.score, spa.abordagem], ["ALTA", "Vocês são o 1º resultado do Google"]);
  assert.ok(fixo(laser.telefone) && !fixo(spa.telefone), "fixo tem 8 dígitos depois do DDD");
  assert.deepEqual(erros.map((e) => [e.aba, e.linha]), [["3ª leva", 2]], "a aba de notas não gera erro");
  assert.match(erros[0].motivo, /Mesmo telefone da linha 2 \(Leads Qualificados\)/, "repetido entre abas aponta a aba");
}
// os ramos do levantamento de beleza que antes caíam fora
for (const [categoria, sub] of [["Massoterapia", "estetica"], ["Podologia", "estetica"], ["Salão de bronzeamento", "estetica"], ["Biomedicina estética", "estetica"],
  ["Studio de Maquiagem / Beleza", "estetica"], ["Clínica de dermatologia", "estetica"], ["Tranças / Penteados Afro", "salao"], ["Esmalteria (shopping)", "unhas"]] as const) {
  assert.equal(nichoDe({ categoria, nome: "" })?.sub, sub, categoria);
}

// sem coluna de nome não há o que ler
assert.match(lerPlanilha([["a", "b"], [1, 2]]).erros[0].motivo, /cabeçalho/);

// o levantamento do Piauí: "Nota geral", "Nº de avaliações", "Score de oportunidade",
// sem coluna UF e com "não verificado" onde não achou o dado
{
  const { leads, erros } = lerPlanilha([
    ["Nome", "Categoria(s)", "Endereço completo", "Bairro", "Nota geral", "Nº de avaliações", "Horário de funcionamento (S/N)", "Rede social principal", "Telefone / WhatsApp", "Score de oportunidade", "Cidade"],
    ["Alan Barbearia", "Barbearia", "Ao lado da antiga Panificadora", "não verificado", "5.0", "107.0", "Sim", "não verificado", "(89) 99999-1234", "Alta", "Floriano"],
    ["Yalodê Studio", "Salão de Beleza", "R. São João, 811", "Não visível", "4.8", "26.0", "não verificado", "@yalode", "não verificado", "Média", "Piripiri"],
    ["Mascarado", "Barbearia", "", "", "4.9", "40", "", "", "(86) 3XXX-XXXX", "Alta", "Teresina"],
  ]);
  assert.equal(leads.length, 1, "sem telefone de verdade, a linha não vira site");
  const l = leads[0].lead;
  assert.deepEqual([l.nota, l.avaliacoes, l.score], [5, 107, "Alta"], "nota, avaliações e score com os nomes do levantamento");
  // estimativa do levantamento ("~4.4", "aprox. 120") vale o número
  const aprox = lerPlanilha([["Nome", "Telefone", "Categoria", "Nota geral", "Nº de avaliações"], ["Studio Aprox", "(86) 99111-0009", "Estética", "~4.4", "aprox. 120"]]).leads[0].lead;
  assert.deepEqual([aprox.nota, aprox.avaliacoes], [4.4, 120]);
  assert.equal(l.bairro, "", "\"não verificado\" não vira bairro no site");
  assert.equal(l.instagram, "");
  assert.equal(l.horario, "", "Horário (S/N) responde sim/não, não é horário");
  assert.equal(l.uf, "PI", "UF pelo DDD quando a planilha não tem a coluna");
  assert.deepEqual(erros.map((e) => e.motivo), ["Telefone ausente ou inválido.", "Telefone ausente ou inválido."], "\"não verificado\" e (86) 3XXX-XXXX são sem telefone");
}
// a coluna UF, quando existe, manda; o DDD só preenche o que falta
assert.equal(lerPlanilha([["Nome", "Telefone", "Categoria", "UF"], ["Corte Fino", "(96) 99111-2222", "Barbearia", "pa"]]).leads[0].lead.uf, "PA");
// sem coluna UF, a do DDD mais comum vale para todos: o dono com número de fora não muda o estado
assert.deepEqual(
  lerPlanilha([["Nome", "Telefone", "Categoria"], ["Corte Um", "(86) 99111-0001", "Barbearia"], ["Corte Dois", "(86) 99111-0002", "Barbearia"], ["Corte Três", "(51) 99111-0003", "Barbearia"]]).leads.map((x) => x.lead.uf),
  ["PI", "PI", "PI"],
);
assert.deepEqual(["5586999990000", "5596991112222", "5592991112222", "5511988887777", "5500123456789"].map(ufDoTelefone), ["PI", "AP", "AM", "SP", ""]);

// nicho: veterinária antes de pet shop, unha antes de salão,
// e o nome só decide quando não há categoria
assert.equal(nichoDe({ categoria: "Clínica Veterinária", nome: "" })?.sub, "vet");
assert.equal(nichoDe({ categoria: "Banho e tosa", nome: "" })?.sub, "petshop");
assert.equal(nichoDe({ categoria: "Esmalteria", nome: "" })?.sub, "unhas");
assert.equal(nichoDe({ categoria: "Salão de Beleza", nome: "" })?.tipo, "HairSalon");
assert.equal(nichoDe({ categoria: "Design de sobrancelhas", nome: "" })?.sub, "estetica");
assert.equal(nichoDe({ categoria: "Studio de tatuagem", nome: "" })?.tipo, "TattooParlor", "tatuagem antes de “studio” virar salão");
assert.equal(nichoDe({ categoria: "", nome: "Kaos Tattoo Studio" })?.sub, "tatuagem");
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
  ["tatuagem", renderBeleza({ ...base, sub: "tatuagem", tipo: "TattooParlor", servicos: ["Fine line", "Orçamento"] })],
] as const) {
  assert.ok(!html.includes("<script>alert"), `${nome}: nome escapado`);
  assert.ok(!/"telephone":"\+5511948680554"/.test(html), `${nome}: JSON-LD com o telefone do negócio, não o nosso`);
  assert.ok(html.includes('"telephone":"+5591993721156"'), `${nome}: telefone do lead no JSON-LD`);
  assert.ok(!html.includes("sobreassets"), `${nome}: caminho da imagem do JSON-LD`);
  assert.ok(!html.includes("instagram.com/"), `${nome}: sem Instagram, sem link de Instagram`);
  assert.ok(html.includes('data-ysis="proposta"') && html.includes('data-agendar="1"') && html.includes('data-ysis="aviso"'), `${nome}: camada Ruphus`);
  assert.ok(html.includes('<link rel="canonical" href="https://pet-feliz.ruphus.site/">'), `${nome}: canonical`);
  assert.ok(html.includes('content="noindex, nofollow"'), `${nome}: fora do Google`);
  assert.ok(html.includes('<meta property="og:image" content="https://pet-feliz.ruphus.site/og.jpg">') && html.includes('content="1200"'), `${nome}: prévia do WhatsApp em og.jpg 1200×630`);
  assert.ok(!html.includes("undefined") && !html.includes("null"), `${nome}: nenhum campo vazio vazou`);
}
// JSON-LD não fecha a tag com "</script>" no nome
assert.ok(renderPet({ ...base, nome: "A</script><b>" }).includes("A\\u003c/script>\\u003cb>"));
// tatuagem: fotos, rótulo e textos do estúdio, não os de salão
{
  const html = renderBeleza({ ...base, sub: "tatuagem", tipo: "TattooParlor", servicos: ["Fine line", "Cobertura de tatuagem", "Orçamento"] });
  assert.match(html, /assets\/beleza\/tatuagem-\d\/hero\.jpg/);
  assert.ok(html.includes("Estúdio de tatuagem"));
  assert.ok(html.includes("Traços finos e delicados") && html.includes("Transforme ou renove tatuagens antigas") && html.includes("sem compromisso"));
  assert.ok(html.includes('"@type":"TattooParlor"'));
}
// sem nota, a seção de avaliações some
assert.ok(!renderBeleza({ ...base, sub: "salao", nota: null, avaliacoes: null }).includes('id="depoimentos"'));
assert.ok(!renderPet({ ...base, nota: null, avaliacoes: null }).includes('id="avaliacoes"'));
// com Instagram, o link aparece
assert.ok(renderPet({ ...base, instagram: "petfeliz" }).includes("https://www.instagram.com/petfeliz/"));

// ─── Os modelos-base: todo nicho completo, sem foto faltando nem repetida ───
for (const [sub, c] of Object.entries({ ...PET, ...SAUDE, ...AULAS })) {
  const citadas = [...c.topo, ...c.galeria, ...c.passos.map(([f]) => f)];
  for (const f of citadas) {
    assert.ok(c.fotos[f], `${sub}: ${f} sem alt`);
    for (const t of ["", "-800"]) assert.ok(existsSync(`public/s/assets/${c.pasta}/${f}${t}.jpg`), `${sub}: falta ${c.pasta}/${f}${t}.jpg`);
  }
  // a galeria pula de 2 em 2: com 4 fotos a terceira repetia a primeira
  for (let i = 0; i < 40; i++) {
    const html = renderClaro({ ...base, slug: `site-${i}`, sub: sub as DadosSite["sub"] });
    const galeria = /<div class="galeria">([\s\S]*?)<\/div>/.exec(html)![1];
    const fotos = [...galeria.matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
    assert.equal(new Set(fotos).size, 3, `${sub}: galeria repetida em site-${i}`);
  }
}
for (const [sub, e] of Object.entries({ ...FITNESS, ...AUTOMOTIVO })) {
  for (const kit of e.kits) for (const f of ["hero", "ga1", "ga2", "ga3"]) assert.ok(existsSync(`public/s${kit}/${f}.jpg`), `${sub}: falta ${kit}/${f}.jpg`);
}

// cada nicho novo reconhecido pela categoria, com a ordem das regras respeitada
for (const [categoria, sub] of [
  ["Clínica odontológica", "odonto"], ["Dentista", "odonto"], ["Fisioterapia", "fisio"], ["RPG e pilates", "fisio"],
  ["Psicóloga", "psico"], ["Nutricionista", "nutri"], ["Clínica médica", "clinica"], ["Consultório pediátrico", "clinica"],
  ["Escola de inglês", "idiomas"], ["Reforço escolar", "reforco"], ["Escola de música", "musica"], ["Autoescola", "autoescola"], ["CFC Centro de Formação de Condutores", "autoescola"],
  ["Academia", "academia"], ["Crossfit", "academia"], ["Studio de Pilates", "pilates"], ["Academia de Jiu-jitsu", "lutas"], ["Escola de dança", "danca"],
  ["Oficina mecânica", "oficina"], ["Estética automotiva", "lavagem"], ["Lava-jato", "lavagem"], ["Borracharia", "pneus"], ["Baterias automotivas", "oficina"],
  // o que já existia continua onde estava
  ["Clínica de Estética", "estetica"], ["Clínica veterinária", "vet"], ["Biomedicina estética", "estetica"], ["Salão de Beleza", "salao"], ["Studio de Tatuagem", "tatuagem"],
] as const) assert.equal(nichoDe({ categoria, nome: "" })?.sub, sub, categoria);
assert.equal(nichoDe({ categoria: "Academia de competição", nome: "" })?.sub, "academia", "“competição” não é pet");

// toda página de todo nicho: nada vazio vazando, camada Ruphus, e saúde sem preço nem antes/depois
const subs: DadosSite["sub"][] = ["petshop", "vet", "barbearia", "salao", "estetica", "unhas", "tatuagem", "odonto", "fisio", "psico", "nutri", "clinica",
  "idiomas", "reforco", "musica", "autoescola", "academia", "pilates", "lutas", "danca", "oficina", "lavagem", "pneus"];
for (const sub of subs) {
  const d = { ...base, sub, nome: "Negócio Exemplo", servicos: [] };
  const html = ehClaro(sub) ? renderClaro(d) : renderBeleza(d);
  assert.ok(!html.includes("undefined") && !html.includes("null") && !html.includes("NaN"), `${sub}: campo vazio vazou`);
  assert.ok(html.includes('data-ysis="proposta"') && html.includes('data-agendar="1"'), `${sub}: camada Ruphus`);
  if (["odonto", "fisio", "psico", "nutri", "clinica"].includes(sub)) {
    assert.ok(!/R\$\s?\d/.test(html), `${sub}: saúde não anuncia preço`);
    assert.ok(!/antes e depois|resultado garantido|o melhor/i.test(html), `${sub}: publicidade vedada em saúde`);
  }
}

console.log("gerador: ok");
