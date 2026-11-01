import assert from "node:assert/strict";
import { abas, bairrosDe, CAPITAIS, LIMITES, problemaNoPedido, UFS, fichaParaLead, fim8, lotes, montarBase, motivoCurto, paraGerador, placeId, separar, type Base, type Ficha } from "@/lib/coleta";

const link = "https://www.google.com/maps/place/Studio+X/data=!4m7!3m6!1s0xa69b5e09b276a7:0x6b9885d00aaf5340!8m2!3d-19.9?authuser=0&hl=pt-BR";
const ficha = (f: Partial<Ficha>): Ficha => ({
  nome: "Studio X", categoria: "Salão de beleza", telefone: "(31) 98765-4321", site: "", nota: "4,8", avaliacoes: "",
  endereco: "R. Pernambuco, 100 - Savassi, Belo Horizonte - MG, 30130-150", fechado: false, link_maps: link, ...f,
});
const padrao = { cidade: "Belo Horizonte", uf: "MG" };

// o lugar é o mesmo em qualquer link de busca; link sem id não é ficha
assert.equal(placeId(link), "0xa69b5e09b276a7:0x6b9885d00aaf5340");
assert.equal(placeId("https://www.google.com/maps/search/barbearia"), null);
// celular com e sem o 9, com e sem 55: mesmos 8 finais
assert.equal(fim8("5531987654321"), fim8("(31) 8765-4321"));

const l = fichaParaLead(ficha({ site: "https://www.instagram.com/studiox.bh/" }), padrao);
assert.equal(l.telefone, "5531987654321");
assert.deepEqual([l.bairro, l.cidade, l.uf], ["Savassi", "Belo Horizonte", "MG"]);
assert.equal(l.nota, "4.8");
assert.equal(l.instagram, "studiox.bh");
assert.equal(l.link_maps, link.split("?")[0]);
// 0800 e telefone curto não viram número; endereço sem cidade fica com a da coleta
assert.equal(fichaParaLead(ficha({ telefone: "0800 123" }), padrao).telefone, "");
assert.deepEqual(fichaParaLead(ficha({ endereco: "Galeria Ouvidor, loja 3" }), padrao).cidade, "Belo Horizonte");
// fixo com 0 de operadora na frente; celular que já vem com +55
assert.equal(fichaParaLead(ficha({ telefone: "0 31 3222-1100" }), padrao).telefone, "553132221100");
assert.equal(fichaParaLead(ficha({ telefone: "+55 31 98765-4321" }), padrao).telefone, "5531987654321");
// endereço sem "- Bairro": a cidade sai do fim, não da coleta
assert.deepEqual(
  (({ bairro, cidade, uf }) => [bairro, cidade, uf])(fichaParaLead(ficha({ endereco: "Eduardo Gomes, São Cristóvão - SE, 49107-062" }), padrao)),
  ["", "São Cristóvão", "SE"]);

const base: Base = {
  tel: new Map([["87654321", "Studio X (site studio-x)"]]),
  nomeCidade: new Map([["barbeariadoze|belohorizonte", "Barbearia do Zé (site barbearia-do-ze)"]]),
};
const s = separar([
  ficha({}), // já temos pelo telefone
  ficha({ nome: "Barbearia do Zé", telefone: "31 99999-1111" }), // mesmo nome na cidade, outro número
  ficha({ nome: "Nail Ana", telefone: "31 98888-2222" }),
  ficha({ nome: "Nail Ana (outra busca)", telefone: "(31) 8888-2222" }), // mesmo celular: aparece uma vez
  ficha({ nome: "Sem Fone", telefone: "" }),
  ficha({ nome: "Fechou", telefone: "31 97777-3333", fechado: true }),
  ficha({ nome: "" }), // página que não carregou
  ficha({ nome: "***", telefone: "31 96666-4444" }), // nome que não vira endereço de site
], base, padrao);
assert.deepEqual(s.novos.map((x) => x.nome), ["Nail Ana"]);
assert.deepEqual(s.conferir.map((x) => x.nome), ["Barbearia do Zé"]);
assert.deepEqual(s.fora.map((x) => x.motivo), ["já temos: Studio X (site studio-x)", "sem telefone no Maps", "fechado no Maps", "nome sem letras no Maps"]);

assert.deepEqual(lotes([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
assert.deepEqual(lotes([]), [[]]); // sem novos ainda sai uma planilha (com conferir e fora)

// só a aba Leads tem "nome" no cabeçalho: o gerador lê toda aba com essa coluna
const [leads, conferir, fora] = abas(s.novos, s.conferir, s.fora);
assert.equal(leads.data[0][0], "nome");
assert.equal(conferir.data[0][0], "Lead");
assert.equal(fora.data[0].at(-1), "motivo");
assert.equal(leads.data[1][1], "5531988882222");

// bairros para a segunda volta: os mais citados da cidade; citado uma vez, ou de outra cidade, não entra
const em = (bairro: string, cidade = "Belo Horizonte") => ficha({ endereco: `Rua A, 1 - ${bairro}, ${cidade} - MG, 30000-000` });
assert.deepEqual(bairrosDe([em("Savassi"), em("Prado"), em("savassi"), em("Prado"), em("Prado"), em("Lourdes"), em("Eldorado", "Contagem"), em("Eldorado", "Contagem")], padrao),
  ["Prado", "Savassi"]);

// a base sai de qualquer listagem com nome, telefone e cidade (o worker lê do Firestore)
const b = montarBase([{ nome: "Studio X", telefone: "5531987654321", cidade: "Belo Horizonte", origem: "site studio-x" }, { nome: null, telefone: null, cidade: null, origem: "site vazio" }]);
assert.equal(b.tel.get("87654321"), "Studio X (site studio-x)");

// o que o gerador recusaria (nicho fora de beleza) sai dos novos, com o motivo dele
const g = paraGerador(separar([ficha({ nome: "Nail Ana", telefone: "31 99164-3827" }), ficha({ nome: "Bar do Zé", categoria: "Lounge bar", telefone: "31 99520-1178" })], { tel: new Map(), nomeCidade: new Map() }, padrao));
assert.deepEqual(g.novos.map((n) => n.lead.nome), ["Nail Ana"]);
assert.equal(g.novos[0].link_maps, link.split("?")[0]);
assert.equal(g.novos[0].lead.maps, link.split("?")[0], "o link da ficha segue no lead até o site gerado");
assert.equal(g.fora.length, 1);
assert.match(g.fora[0].motivo, /^gerador: Não reconheci o nicho/);
assert.equal(motivoCurto(g.fora[0].motivo), "Não reconheci o nicho");
assert.equal(motivoCurto("já temos: Studio X (site studio-x)"), "já temos");

// toda UF tem capital
assert.deepEqual(Object.keys(CAPITAIS).sort(), Object.keys(UFS).sort());

// o pedido é conferido na tela e no servidor com as mesmas regras
const pedido = (p: Partial<{ cidades: string[]; bairros: string[]; termos: string[] }>) => problemaNoPedido({ cidades: ["Castanhal"], bairros: [], termos: [], ...p });
assert.equal(pedido({}), "");
assert.match(pedido({ cidades: [] }), /pelo menos uma/);
assert.match(pedido({ termos: Array.from({ length: LIMITES.termos + 1 }, (_, i) => `termo ${i}`) }), /No máximo 20 termos \(são 21\)/);
assert.match(pedido({ cidades: ["A", "B"], bairros: ["Centro"] }), /uma cidade só/);
assert.match(pedido({ termos: ["x"] }), /curto demais/);
assert.match(pedido({ termos: ["salão de beleza barbearia manicure estética sobrancelha"] }), /longo demais/);

console.log("coleta: ok");
