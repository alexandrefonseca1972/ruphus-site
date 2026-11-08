// Gerador de sites: planilha → leads → HTML. Sem banco.
//   npm run test:gerador
import assert from "node:assert/strict";
import lerAbas from "read-excel-file/node";
import { montar, porRamo } from "@/lib/catalogo";
import { candidatos, type DadosSite, fixo, lerPlanilha as lerAbasDaPlanilha, nichoDe, outraForma, ufDe, ufDoTelefone, variante } from "@/lib/gerador";

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
    ["Restaurante do Zé", "(11) 97531-2468", "Restaurante"],
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
for (const [categoria, sub] of [["Massoterapia", "estetica"], ["Podologia", "podologia"], ["Salão de bronzeamento", "estetica"], ["Biomedicina estética", "estetica"],
  ["Studio de Maquiagem / Beleza", "estetica"], ["Clínica de dermatologia", "estetica"], ["Tranças / Penteados Afro", "salao"], ["Esmalteria (shopping)", "unhas"]] as const) {
  assert.equal(nichoDe({ categoria, nome: "" })?.sub, sub, categoria);
}

// sem coluna de nome não há o que ler
assert.match(lerPlanilha([["a", "b"], [1, 2]]).erros[0].motivo, /cabeçalho/);

// o levantamento do Piauí: "Nota geral", "Nº de avaliações", "Score de oportunidade",
// sem coluna UF e com "não verificado" onde não achou o dado
{
  const { leads, erros, semTelefone } = lerPlanilha([
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
  // levantamento de Rondônia: "Nome da Empresa", "Nicho/Categoria", "Avaliação Google", e o
  // Excel guardou "4.9" como 4 de setembro — a nota volta; "5.0" chega como texto
  const ro = lerPlanilha([
    ["#", "Nome da Empresa", "Cidade", "Estado", "Nicho/Categoria", "Avaliação Google", "Nº Avaliações", "Telefone"],
    [1, "Chalé das Unhas", "Porto Velho", "RO", "Esmalteria/Unhas", new Date(Date.UTC(2026, 8, 4)), 863, "(69) 99111-0001"],
    [2, "Kapitan Barbearia", "Ariquemes", "RO", "Barbearia", "5.0", 831, "(69) 99111-0002"],
    [3, "Studio Sobrancelha", "Cacoal", "RO", "Design de Sobrancelha", new Date(Date.UTC(2026, 2, 4)), 40, "(69) 99111-0003"],
    [4, "Laser Depil", "Vilhena", "RO", "Depilação/Laser", new Date(Date.UTC(2026, 6, 4)), 50, "(69) 99111-0004"],
    [5, "Spa Zen", "Jaru", "RO", "Spa/Massagem", new Date(Date.UTC(2026, 11, 25)), 60, "(69) 99111-0005"],
  ]);
  assert.deepEqual(ro.erros, []);
  assert.deepEqual(ro.leads.map((x) => [x.lead.nome, x.lead.categoria, x.lead.nota]), [
    ["Chalé das Unhas", "Esmalteria/Unhas", 4.9],
    ["Kapitan Barbearia", "Barbearia", 5],
    ["Studio Sobrancelha", "Design de Sobrancelha", 4.3],
    ["Laser Depil", "Depilação/Laser", 4.7],
    ["Spa Zen", "Spa/Massagem", null], // 25/12 não é nota que o Excel converteu: fica sem nota
  ]);
  assert.equal(l.bairro, "", "\"não verificado\" não vira bairro no site");
  assert.equal(l.instagram, "");
  assert.equal(l.horario, "", "Horário (S/N) responde sim/não, não é horário");
  assert.equal(l.uf, "PI", "UF pelo DDD quando a planilha não tem a coluna");
  // Yalodê tem @yalode na rede social: sem telefone, mas fica na lista de contato pela rede
  assert.deepEqual(erros.map((e) => e.motivo), ["Telefone ausente ou inválido."], "(86) 3XXX-XXXX sem rede social é sem telefone");
  assert.deepEqual(semTelefone.map((s) => s.nome), ["Yalodê Studio"]);
}
// telefone inventado não vira site; número real com dígito repetido passa
{
  const { leads, erros } = lerPlanilha([
    ["Nome", "Telefone", "Categoria"],
    ["Um", "(94) 99999-9999", "Salão de Beleza"],
    ["Dois", "(83) 98811-2233", "Salão de Beleza"],
    ["Três", "(91) 91234-5678", "Salão de Beleza"],
    ["Quatro", "(86) 2222-2222", "Salão de Beleza"],
    ["Real", "(94) 99255-5522", "Salão de Beleza"],
  ]);
  assert.deepEqual(leads.map((x) => x.lead.nome), ["Real"]);
  assert.equal(erros.length, 4);
  assert.match(erros[0].motivo, /inventado/);
}
// "Verificar…" é o levantamento dizendo que não achou; "Sim" na coluna Horário não é horário
{
  const [a, b] = lerPlanilha([
    ["Nome", "Telefone", "Categoria", "Bairro", "Horário"],
    ["Salão Um", "(63) 99111-0001", "Salão de Beleza", "Verificar", "Sim"],
    ["Salão Dois", "(63) 99111-0002", "Salão de Beleza", "A verificar (ver Google Maps)", "Verificar"],
  ]).leads.map((x) => x.lead);
  assert.deepEqual([a.bairro, a.horario, b.bairro, b.horario], ["", "", "", ""]);
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
// nomes que as regras confundiam (revisão de ramos, 08/11/2026)
for (const [nome, sub] of [
  ["Bárbara Cílios e Sobrancelhas", "estetica"], ["Ana Paula Barbie das unhas", "unhas"], ["Barbearia Status", "barbearia"], ["Salão Status", "salao"],
  ["Salão Beleza Absoluta", "salao"], ["Muay Thai Luta Livre", "lutas"],
  ["MS encanto beauty", "salao"], ["Recanto da Beleza", "salao"], ["Escola de Canto Vozes", "musica"],
  ["Cléo Estética Personalizada", "estetica"], ["Rafa Personal Trainer", "academia"],
  ["Pétalas Esmalteria e Estética", "unhas"], ["Le Petit Atelier Hair", "salao"], ["Pet Shop Amigo", "petshop"], ["Petshop do Bairro", "petshop"], ["Ki Linda Estética Animal", "petshop"],
  ["Oficina da Beleza", "salao"], ["Oficina GT Barbearia", "barbearia"], ["Oficina do Zé Mecânica", "oficina"],
  ["Auto Estética Dirceu", "lavagem"], ["Clínica Estética - Lauane Cunha", "estetica"], ["Funilaria e pintura Martelinho de ouro Leandro", "oficina"], ["Unhas da Bia", "unhas"], ["Studio Unha Bonita", "unhas"], ["CJS ESTÉTICA CAR", "lavagem"], ["Front Car Estética Automotiva", "lavagem"],
  ["Clínica Remove - Remoção de Tatuagem", "estetica"], ["Kaos Tattoo Studio", "tatuagem"],
] as const) assert.equal(nichoDe({ categoria: "", nome })?.sub, sub, nome);
// categoria genérica de clínica: o nome diz a especialidade
assert.equal(nichoDe({ categoria: "Clínica", nome: "AC Clinic Estética Avançada" })?.sub, "estetica");
assert.equal(nichoDe({ categoria: "Clínica médica", nome: "Clínica Sorriso Odontologia" })?.sub, "odonto");
assert.equal(nichoDe({ categoria: "Clínica médica", nome: "Clínica São Lucas" })?.sub, "clinica");
assert.equal(nichoDe({ categoria: "Salão de Beleza", nome: "Oficina do Zé" })?.sub, "salao", "a categoria específica continua valendo");
assert.equal(nichoDe({ categoria: "", nome: "Barbearia Navalha" })?.sub, "barbearia");
// cursos profissionalizantes: formação vence o ramo ensinado, e cursinho continua reforço
assert.equal(nichoDe({ categoria: "Escola de cabeleireiro", nome: "" })?.sub, "profissionalizante");
assert.equal(nichoDe({ categoria: "", nome: "Curso de Manicure Profissional" })?.sub, "profissionalizante");
assert.equal(nichoDe({ categoria: "Escola técnica", nome: "" })?.sub, "profissionalizante");
assert.equal(nichoDe({ categoria: "Centro de formação profissional", nome: "" })?.sub, "profissionalizante");
assert.equal(nichoDe({ categoria: "Cursinho pré-vestibular", nome: "" })?.sub, "reforco");
assert.equal(nichoDe({ categoria: "Salão de beleza", nome: "" })?.sub, "salao");
assert.equal(nichoDe({ categoria: "Autoescola", nome: "" })?.sub, "autoescola");

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
  assert.ok(/getElementById\('(wf-dia|agData)'\)\.min=new Date/.test(html), `${nome}: data do formulário a partir de hoje`);
}
// domínio próprio ativo vira o endereço oficial; pendente, segue o subdomínio
{
  const ativo = renderBeleza({ ...base, sub: "barbearia", tipo: "BarberShop", dominio: { host: "www.petfeliz.com.br", status: "ativo" } });
  assert.ok(ativo.includes('<link rel="canonical" href="https://www.petfeliz.com.br/">'), "canonical no domínio do cliente");
  assert.ok(ativo.includes('<meta property="og:image" content="https://www.petfeliz.com.br/og.jpg">'), "og.jpg no domínio do cliente");
  assert.ok(ativo.includes('"url":"https://www.petfeliz.com.br/"') && !ativo.includes("pet-feliz.ruphus.site"), "JSON-LD no domínio e nada do subdomínio");
  const pendente = renderBeleza({ ...base, sub: "barbearia", tipo: "BarberShop", dominio: { host: "www.petfeliz.com.br", status: "pendente" } });
  assert.ok(pendente.includes('<link rel="canonical" href="https://pet-feliz.ruphus.site/">'), "domínio pendente não muda o endereço");
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
assert.equal(nichoDe({ categoria: "Salão / Coloração", nome: "" })?.sub, "salao", "“coloração” não é ração");
assert.equal(nichoDe({ categoria: "Ração e acessórios", nome: "" })?.sub, "petshop");
assert.equal(nichoDe({ categoria: "Espaço de Beleza", nome: "" })?.sub, "salao", "“espaço” não é spa");
assert.equal(nichoDe({ categoria: "Day Spa", nome: "" })?.sub, "estetica");
// os serviços padrão leem o mesmo texto: "Coloração" não traz banho e tosa, "Espaço" não traz massagem
assert.deepEqual(porRamo("salão cabelo Salão / Coloração").map((s) => s.name), ["Corte", "Escova", "Coloração", "Hidratação"]);
assert.deepEqual(porRamo("estética Espaço de Beleza").map((s) => s.name), ["Limpeza de pele", "Avaliação estética"]);
assert.deepEqual(porRamo("pet shop Ração e acessórios").map((s) => s.name), ["Banho", "Tosa", "Banho e tosa"]);
// preço e duração pelo nome: massagem não é relaxamento capilar, harmonização facial não é limpeza de pele
assert.deepEqual([montar("Massagem relaxante").durationMin, montar("Massagem relaxante").priceCents], [60, 12000]);
assert.deepEqual([montar("Relaxamento").durationMin, montar("Relaxamento").priceCents], [180, 25000]);
assert.equal(montar("Harmonização facial").priceCents, 20000);
assert.equal(montar("Limpeza de pele").priceCents, 12000);

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

// UF do cadastro: só as 27 que existem ("XX" passava pelo formato de duas letras)
{
  const { DadosNegocio } = await import("@/lib/gerador");
  assert.equal(DadosNegocio.shape.uf.safeParse("ap").data, "AP");
  assert.equal(DadosNegocio.shape.uf.safeParse("XX").error?.issues[0].message, "Escolha a UF");
  assert.equal(DadosNegocio.shape.uf.safeParse("").success, false);
  console.log("uf do cadastro: ok");
}

// levantamento de Belém (Prospecção, out/2026): "Nome do negócio", "Cidade/UF" com distrito,
// "Nicho / Segmento", telefone com dois números separados por barra
{
  const { leads, erros } = lerPlanilha([
    ["PROSPECÇÃO — título", ...Array(10).fill(null)],
    [null, "Nome do negócio", "Nicho / Segmento", "Endereço", "Bairro", "Cidade/UF", "Telefone / WhatsApp", "Instagram / Redes sociais", "Nota Google (estrelas)", "Total de avaliações", "Site"],
    [null, "Maria Bonita Salão", "Salão de beleza", "Av. Nazaré, 1", "—", "Belém/PA (Icoaraci)", "(91) 98859-8809 / (91) 98274-6294", "@mariabonita", 4.8, 120, "—"],
    [null, "Barbearia Dois", "Barbearia", "", "Umarizal", "Ananindeua/PA", "(91) 3241-8660 / (91) 98615-6886", "", "", "", "—"],
    [null, "Sem Celular", "Barbearia", "", "", "Belém/PA", "(91) 3241-8661", "", "", "", "—"],
  ]);
  assert.equal(erros.length, 0, JSON.stringify(erros));
  const [a, b, c] = leads.map((x) => x.lead);
  assert.deepEqual([a.nome, a.cidade, a.uf, a.bairro], ["Maria Bonita Salão", "Belém", "PA", "Icoaraci"]);
  assert.equal(a.telefone, "5591988598809", "vale o primeiro celular");
  assert.deepEqual([a.instagram, a.nota, a.avaliacoes], ["mariabonita", 4.8, 120]);
  assert.deepEqual([b.cidade, b.uf, b.bairro, b.telefone], ["Ananindeua", "PA", "Umarizal", "5591986156886"]);
  assert.equal(c.telefone, "559132418661", "sem celular, vale o fixo");
  // sem WhatsApp, mas com perfil: não vira site, fica como "sem telefone" (não é erro)
  const semZap = lerPlanilha([
    ["Nome", "Telefone", "Categoria", "Instagram", "Cidade"],
    ["Studio Sem Zap", "", "Salão de Beleza", "@studiosemzap", "Belém/PA"],
    ["Sem Nada", "", "Salão de Beleza", "", "Belém/PA"],
  ]);
  assert.deepEqual([semZap.leads.length, semZap.semTelefone.map((s) => [s.nome, s.redeSocial]), semZap.erros.length], [0, [["Studio Sem Zap", "@studiosemzap"]], 1]);
  assert.equal(semZap.erros[0].motivo, "Telefone ausente ou inválido.");
  console.log("levantamento de Belém: ok");
}

// escolha de kit e paleta por região: o menos repetido na cidade, e sites antigos saem como antes
{
  const { sortearVisual } = await import("@/lib/gerador");
  const { visualEditorial, escolhaEditorial } = await import("@/lib/site-editorial");
  const dim = { kits: 4, cores: 6 };
  const pick = sortearVisual("novo-site", [{ kit: 0, cor: 0 }, { kit: 0, cor: 1 }, { kit: 1, cor: 0 }], dim);
  assert.notEqual(pick.kit, 0, "kit mais usado na cidade fica de fora");
  assert.ok(pick.cor >= 0 && pick.cor < 6);
  // doze sites seguidos na mesma cidade: cada kit entra três vezes
  const usos: { kit: number; cor: number }[] = [];
  for (let i = 0; i < 12; i++) usos.push(sortearVisual(`estetica-${i}`, usos, dim));
  const porKit = [0, 1, 2, 3].map((k) => usos.filter((u) => u.kit === k).length);
  assert.deepEqual(porKit, [3, 3, 3, 3], `kits espalhados: ${porKit}`);
  // kit extra na cidade (depilação) não entra no sorteio dos outros sites
  assert.ok(sortearVisual("vizinho", [0, 1, 2, 3].map((kit) => ({ kit, cor: 0 })).concat({ kit: 4, cor: 0 }), dim).kit < 4);
  assert.equal(visualEditorial("segredo-do-pello", "estetica", { kit: 4 }).foto, "/assets/beleza/depilacao-1/hero.jpg");
  assert.equal(visualEditorial("x", "salao", { kit: 7 }).kit, visualEditorial("x", "salao").kit, "índice fora do estilo cai no do slug");
  assert.equal(visualEditorial("x", "salao", { kit: 6 }).kit, "/assets/beleza/infantil-3");
  // salão infantil: fotos e cores próprias só pelo modelo; o sorteio do salão segue igual
  assert.equal(visualEditorial("x", "salao", { kit: 4 }).kit, "/assets/beleza/infantil-1");
  const kids = visualEditorial("tio-rafa", "salao", { kit: 4, cor: 6, modelo: "infantil-1" });
  assert.equal(kids.acc, "#FF7A59");
  assert.equal(kids.e.rotulo, "Salão infantil");
  assert.ok(kids.e.padrao.includes("Primeiro corte"));
  assert.equal(visualEditorial("tio-rafa", "salao").e.rotulo, "Salão de beleza", "sem o modelo, o salão é o de sempre");
  assert.ok(escolhaEditorial("salao", "qualquer").cor < 6, "as cores infantis não entram no sorteio");
  // sem escolha, o site sai como sempre saiu
  const padrao = escolhaEditorial("barbearia", "salao-antigo");
  assert.deepEqual(visualEditorial("salao-antigo", "barbearia").foto, visualEditorial("salao-antigo", "barbearia", padrao).foto);
  assert.notEqual(visualEditorial("salao-antigo", "barbearia", { kit: (padrao.kit + 1) % 4 }).foto, visualEditorial("salao-antigo", "barbearia").foto);
  console.log("escolha por região: ok");
}

// personalização pelo /admin (gerado.personal): por cima do modelo, da escolha e do sorteio
{
  const { Personal, paletaDe, visualEditorial, capaEditorial, renderEditorial } = await import("@/lib/site-editorial");
  assert.equal(Personal.parse({ cores: { acc: "#B5732F" } }).cores?.acc, "#b5732f", "hex vira minúscula");
  for (const ruim of [{ cores: { acc: "#bbb" } }, { cores: { ink: "red" } }, { fotos: { hero: "fotos/../x.jpg" } }, { fotos: { hero: "index.html" } }, { fonte: "Comic Sans" }, { layout: "x" }]) {
    assert.ok(!Personal.safeParse(ruim).success, `recusa ${JSON.stringify(ruim)}`);
  }
  assert.deepEqual(paletaDe("#000000"), { deep: "#000000", tint: "#e0e0e0" });
  assert.deepEqual(paletaDe("#ffffff"), { deep: "#bfbfbf", tint: "#ffffff" }, "branco: deep escurece, tint fica branco");
  assert.equal(paletaDe("#ABCDEF").deep, paletaDe("#abcdef").deep, "maiúscula e minúscula dão o mesmo");
  const modelo = visualEditorial("x", "barbearia", { modelo: "barbearia-2" });
  const v = visualEditorial("x", "barbearia", { modelo: "barbearia-2" }, { cores: { acc: "#112233" }, fonte: "Italiana", fotos: { ga2: "fotos/ga2.jpg" } });
  assert.equal(v.acc, "#112233");
  assert.equal(v.ink, modelo.ink, "só o destaque mudou: a tinta segue a do modelo");
  assert.deepEqual([v.deep, v.tint], [paletaDe("#112233").deep, paletaDe("#112233").tint], "deep e tint derivam do destaque");
  assert.equal(v.fonte[0], "Italiana");
  assert.equal(v.fotos.hero, modelo.fotos.hero, "sem foto própria no topo, fica a do kit");
  assert.equal(v.fotos.ga2, "fotos/ga2.jpg");
  assert.equal(v.foto, modelo.foto, "a bio segue a foto do topo do kit");
  assert.equal(visualEditorial("x", "barbearia", undefined, { fotos: { hero: "fotos/hero.jpg" } }).foto, "/fotos/hero.jpg", "topo próprio vira a foto da bio");
  assert.equal(visualEditorial("x", "barbearia", undefined, { fotos: { bio: "fotos/bio.jpg" } }).foto, "/fotos/bio.jpg");
  const d: DadosSite = { ...base, slug: "navalha", sub: "barbearia", tipo: "BarberShop", personal: { fotos: { hero: "fotos/hero.jpg", ga1: "fotos/ga1.jpg" }, cores: { acc: "#112233" }, textos: { frase: "Corte na régua.", sobre: "Desde 2010 no bairro.", galeria: "Nosso espaço" } } };
  const html = renderEditorial(d);
  assert.ok(html.includes('src="fotos/hero.jpg"'), "foto própria é relativa à raiz do site");
  assert.ok(html.includes('src="fotos/ga1.jpg"') && html.includes("/ga2.jpg"), "galeria mistura própria e do kit");
  assert.ok(html.includes("--acc:#112233"));
  assert.equal((html.match(/Imagem ilustrativa/g) ?? []).length, 2, "legenda só nas fotos do banco");
  assert.ok(html.includes("Imagens ilustrativas"), "rodapé avisa enquanto há foto do banco");
  assert.ok(html.includes('class="sub rv">Corte na régua.') && html.includes('sobre-big">Desde 2010 no bairro.') && html.includes("<h2>Nosso espaço</h2>"));
  assert.ok(html.includes('"image":"https://navalha.ruphus.site/fotos/hero.jpg"'), "JSON-LD aponta a foto própria");
  const carimbada = renderEditorial({ ...d, personal: { fotos: { hero: "fotos/hero.jpg", bio: "fotos/bio.jpg" }, versao: 1730000000000 } });
  assert.ok(carimbada.includes('src="fotos/hero.jpg?v=1730000000000"') && carimbada.includes('"image":"https://navalha.ruphus.site/fotos/hero.jpg?v=1730000000000"'), "foto própria leva o carimbo da publicação");
  assert.equal(visualEditorial("navalha", "barbearia", undefined, { fotos: { bio: "fotos/bio.jpg" }, versao: 7 }).foto, "/fotos/bio.jpg?v=7", "a bio também");
  assert.equal(capaEditorial({ ...d, personal: { fotos: { hero: "fotos/hero.jpg" }, versao: 7 } }).foto, "/navalha/fotos/hero.jpg?v=7", "e o og.jpg");
  assert.ok(!Personal.safeParse({ versao: -1 }).success && Personal.safeParse({ versao: 5 }).success);
  const todas = renderEditorial({ ...d, personal: { fotos: { hero: "fotos/hero.jpg", ga1: "fotos/ga1.jpg", ga2: "fotos/ga2.jpg", ga3: "fotos/ga3.jpg" } } });
  assert.ok(!todas.includes("ilustrativa"), "só fotos próprias: sem aviso de banco");
  assert.equal(capaEditorial(d).foto, "/navalha/fotos/hero.jpg", "og.jpg lê a foto própria do Storage");
  const vazios = renderEditorial({ ...d, personal: { textos: { frase: "", sobre: "" } } });
  assert.ok(!vazios.includes('class="sub rv"></p>') && vazios.includes("sobre-big"), "texto vazio cai no do modelo, sem parágrafo em branco");
  assert.ok(renderEditorial({ ...d, personal: { textos: { frase: "Só a frase." } } }).includes('sobre-big">Só a frase.'), "sem Sobre, repete a frase");
  assert.ok(capaEditorial({ ...d, personal: null }).foto.startsWith("/assets/"));
  console.log("personalização: ok");
}

// personalização no modelo claro: modelos por ramo, cores em --accent/--gold, fonte, fotos próprias e textos
{
  const { modelosClaro, modeloClaroDoId, visualClaro, capaClaro, renderClaro } = await import("@/lib/site-claro");
  const m = modelosClaro("petshop");
  assert.equal(m.length, 4, "um modelo por foto de topo");
  assert.deepEqual(m.map((x) => x.id), ["petshop-1", "petshop-2", "petshop-3", "petshop-4"]);
  assert.equal(modeloClaroDoId("petshop", "petshop-2")?.escolha.kit, 1);
  assert.equal(modeloClaroDoId("vet", "petshop-2"), undefined, "modelo de outro ramo não vale");
  assert.equal(modelosClaro("profissionalizante").length, 4);
  // destaque do topo legível sobre a foto: o azul escuro do idiomas clareia, o dourado fica
  const { destaqueNoTopo } = await import("@/lib/site-claro");
  assert.equal(destaqueNoTopo("#F0B429"), "#F0B429", "cor que já passa volta igual");
  assert.notEqual(destaqueNoTopo("#2F5D8A"), "#2F5D8A", "azul escuro clareia");
  assert.match(destaqueNoTopo("#2F5D8A"), /^#[0-9A-F]{6}$/);
  assert.equal(modelosClaro("idiomas").length, 3);
  const { MODELOS } = await import("@/lib/site-editorial");
  const { SUBS } = await import("@/lib/gerador");
  assert.equal(MODELOS.filter((x) => SUBS[x.sub].nicho === "fitness").length, 12, "3 por ramo de fitness");
  assert.equal(MODELOS.filter((x) => SUBS[x.sub].nicho === "automotivo").length, 9, "3 por ramo automotivo");
  assert.equal(MODELOS.filter((x) => SUBS[x.sub].nicho === "beleza").length, 33, "30 de beleza + 3 do salão infantil");
  const { galeriaClaro } = await import("@/lib/site-claro");
  const g = galeriaClaro("pet-feliz", "petshop");
  assert.equal(new Set(g).size, 3, "três fotos distintas");
  assert.ok(renderClaro({ ...base }).includes(`/${g[0]}-800.jpg`) && renderClaro({ ...base }).includes(`/${g[2]}-800.jpg`), "o site mostra as mesmas três que a gaveta");
  const semNada = visualClaro("x", "petshop");
  const v = visualClaro("x", "petshop", undefined, { cores: { ink: "#112233", acc: "#ffcc00" }, fonte: "Italiana", fotos: { ga2: "fotos/ga2.jpg", bio: "fotos/bio.jpg" }, versao: 5 });
  assert.equal(v.cor, "#112233", "tinta vira --accent (a cor da bio)");
  assert.ok(v.paleta[0].includes("--accent:#112233;--gold:#ffcc00;--accent-ink:#FFFFFF;--gold-ink:#1B1208;"), "as duas cores nos dois temas, com o texto pelo contraste");
  assert.ok(v.paleta[1].includes("--accent:#112233"));
  assert.equal(v.fonte?.[0], "Italiana");
  assert.equal(v.fotos.hero, semNada.fotos.hero, "sem topo próprio, o do modelo");
  assert.deepEqual([v.fotos.ga2, v.foto], ["fotos/ga2.jpg?v=5", "/fotos/bio.jpg?v=5"]);
  assert.ok(visualClaro("x", "petshop", { kit: 99, cor: 99 }).cor.startsWith("#"), "índice fora do ramo não quebra");
  const d: DadosSite = { ...base, slug: "pet-feliz", personal: { fotos: { hero: "fotos/hero.jpg", ga1: "fotos/ga1.jpg" }, cores: { ink: "#112233" }, fonte: "Marcellus", textos: { frase: "Banho sem estresse.", sobre: "Desde 2015 no bairro.", galeria: "Nosso espaço" }, versao: 7 } };
  const html = renderClaro(d);
  assert.ok(html.includes('url("fotos/hero.jpg?v=7")') && html.includes('href="fotos/hero.jpg?v=7"'), "topo próprio no CSS e no preload");
  assert.ok(html.includes('<img src="fotos/ga1.jpg?v=7"') && html.includes("-800.jpg"), "galeria mistura própria e do banco");
  assert.ok(html.includes("--accent:#112233") && html.includes("--font-display:'Marcellus',serif") && html.includes("family=Marcellus"), "cor e fonte próprias");
  assert.ok(html.includes("Banho sem estresse.") && html.includes('<div class="sobre-box">Desde 2015 no bairro.</div>') && html.includes("<h2 class=\"section-title\">Nosso espaço</h2>"), "textos próprios");
  assert.ok(html.includes("Algumas fotos são ilustrativas"), "ainda há foto do banco (passos e galeria)");
  assert.ok(html.includes('"image":"https://pet-feliz.ruphus.site/fotos/hero.jpg?v=7"'), "JSON-LD aponta o topo próprio");
  assert.equal(capaClaro(d).foto, "/pet-feliz/fotos/hero.jpg?v=7");
  assert.equal(capaClaro(d).fonte, "Marcellus");
  assert.ok(capaClaro({ ...d, personal: null }).foto.startsWith("/assets/pet/") && capaClaro({ ...d, personal: null }).foto.endsWith(".jpg"));
  assert.ok(!renderClaro({ ...d, personal: null }).includes('id="sobre"'), "sem Sobre próprio não há seção Sobre");
  console.log("personalização no claro: ok");
}

// levantamento de Manaus: "Não identificado" é dado faltando, em qualquer coluna
{
  const { leads, erros, semTelefone } = lerPlanilha([
    ["Nome do negócio", "Nicho / Segmento", "Cidade/UF", "Telefone / WhatsApp", "E-mail", "Instagram / Redes sociais"],
    ["Com Fone", "Salão de beleza", "Manaus/AM", "(92) 98194-3667", "Não identificado", "Não identificado"],
    ["Com Fone Dois", "Salão de beleza", "Manaus/AM", "(92) 99490-8306 / (92) 99312-1156", "Não identificado (site)", "Não identificado (Instagram)"],
    ["Sem Fone Sem Rede", "Salão de beleza", "Manaus/AM", "Não identificado", "Não identificado", "Não identificado"],
    ["Sem Fone Com Rede", "Salão de beleza", "Manaus/AM", "Não identificado", "Não identificado", "@semfonecomrede"],
  ]);
  assert.deepEqual(leads.map((x) => [x.lead.nome, x.lead.email, x.lead.instagram]), [["Com Fone", "", ""], ["Com Fone Dois", "", ""]], "e-mail e rede 'não identificado' viram vazio");
  assert.deepEqual(semTelefone.map((s) => [s.nome, s.redeSocial]), [["Sem Fone Com Rede", "@semfonecomrede"]], "só rede de verdade conta como sem telefone");
  assert.deepEqual(erros.map((e) => [e.linha, e.motivo]), [[4, "Telefone ausente ou inválido."]]);
  console.log("não identificado: ok");
}

// textos: sites antigos (sem a flag) mantêm o texto original; sites novos sorteiam variantes
{
  const base = { nome: "Barbearia Teste", telefone: "5592999990000", sub: "barbearia" as const, tipo: "Barbearia", endereco: "Rua A, 10", bairro: "Centro", cidade: "Manaus", uf: "AM", nota: 4.8, avaliacoes: 120, instagram: "", horario: "", servicos: ["Corte", "Barba"], consultado: "outubro de 2026", publicado: false };
  const antigo = renderBeleza({ ...base, slug: "barbearia-antiga" });
  assert.match(antigo, /Marque seu horário/);
  assert.match(antigo, /Escolha o serviço e o melhor dia para você/);
  const titulo = (s: string) => /<span class="label">Agendamento<\/span><h2>([^<]+)<\/h2>/.exec(renderBeleza({ ...base, slug: `barbearia-${s}`, variantes: true }))![1];
  assert.ok(new Set(["a", "b", "c", "d", "e", "f", "g", "h"].map(titulo)).size >= 2, "sites novos variam o título do agendamento");
  console.log("variantes de texto: ok");
}

// modelo claro: sites novos variam frases de nicho e a ordem de cartões e perguntas; antigos não
{
  const base = { nome: "Clínica Teste", telefone: "5598999990000", sub: "odonto" as const, tipo: "Clínica odontológica", endereco: "Rua A, 10", bairro: "Centro", cidade: "Imperatriz", uf: "MA", nota: 4.8, avaliacoes: 120, instagram: "", horario: "", servicos: [], consultado: "outubro de 2026", publicado: false };
  const antigo = renderClaro({ ...base, slug: "clinica-antiga" });
  assert.match(antigo, /Como é o atendimento, do primeiro contato ao retorno/);
  const sl = ["a", "b", "c", "d", "e", "f", "g", "h"].map((s) => `clinica-${s}`);
  const TITULOS = ["Um lugar pensado para você", "Por dentro e no dia a dia", "Ambiente e rotina"];
  const galeria = new Set(sl.map((s) => TITULOS.find((t) => renderClaro({ ...base, slug: s, variantes: true }).includes(`<h2 class="section-title">${t}</h2>`))));
  const primeiraPergunta = new Set(sl.map((s) => /<details[^>]*>\s*<summary[^>]*>([^<]+)/.exec(renderClaro({ ...base, slug: s, variantes: true }))?.[1]));
  assert.ok(galeria.size >= 2, "títulos da galeria variam");
  assert.ok(primeiraPergunta.size >= 2, "ordem das perguntas varia");
  console.log("variantes do modelo claro: ok");
}

// UF por extenso: as duas primeiras letras davam a UF errada ("Paraíba" → PA)
assert.deepEqual(["PB", "pb", "Paraíba", "Paraná", "Minas Gerais", "São Paulo", "Xx"].map(ufDe), ["PB", "PB", "PB", "PR", "MG", "SP", ""]);
console.log("uf por extenso: ok");

// o mesmo celular com e sem o 9; fixo não tem outra forma
assert.deepEqual(["5591993721156", "559193721156", "559632178751", "14155550100"].map(outraForma), ["559193721156", "5591993721156", null, null]);
console.log("nono dígito: ok");

// número fixo: o WhatsApp não atende — tudo vira ligação, nos dois modelos e em todos os ramos
for (const sub of ["petshop", "vet", "odonto", "salao", "barbearia", "estetica", "unhas", "podologia"] as const) {
  const d = { ...base, nome: "Casa Teste", sub, telefone: "559232364727" };
  const html = ehClaro(sub) ? renderClaro(d) : renderBeleza(d);
  assert.ok(!html.includes("wa.me/559232364727"), `${sub} fixo: sem link de WhatsApp do negócio`);
  // a faixa de proposta: "Pedir remoção" segue indo para a página de remoção, não vira ligação ao negócio
  assert.ok(html.includes(`href="https://www.ruphus.site/remover/${d.slug}"`) && /Pedir remoção/.test(html), `${sub} fixo: Pedir remoção intacto`);
  assert.ok(!/whatsapp/i.test(html.replace(/wa\.me\/\d+/g, "")), `${sub} fixo: o texto não promete WhatsApp (${/.{40}whatsapp.{40}/i.exec(html)?.[0]})`);
  assert.ok(html.includes('href="tel:+559232364727"'), `${sub} fixo: botão de ligar`);
  assert.ok(!html.includes("data-wa="), `${sub} fixo: sem o formulário que monta a mensagem`);
  assert.ok(!/envie|mensagem pronta|uma mensagem<\/em>/i.test(html), `${sub} fixo: nada de "envie a mensagem" (${/.{30}(envie|mensagem pronta).{30}/i.exec(html)?.[0]})`);
  assert.ok(!/getElementById\('(wf-dia|agData)'\)/.test(html), `${sub} fixo: sem o script do formulário (quebraria sem ele)`);
  // com celular, o modelo segue com WhatsApp
  const cel = ehClaro(sub) ? renderClaro({ ...d, telefone: "5592993721156" }) : renderBeleza({ ...d, telefone: "5592993721156" });
  assert.ok(cel.includes("wa.me/5592993721156") && cel.includes("data-wa="), `${sub} celular: WhatsApp e formulário`);
}
console.log("telefone fixo vira ligação: ok");
