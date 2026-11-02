import assert from "node:assert/strict";
import { BUSCA_MAX, ConsultaPainel, dataValida, ehOrdem, ehUf, fusoValido, hojePlausivel, nichoDe, NICHOS_DO_PAINEL, PAGINA, PAGINA_MAX } from "@/lib/painel-tipos";

// O schema da consulta do painel é a fronteira entre a URL e o servidor (fase 2 do
// docs/plano-paginacao-admin.md): tudo o que passa daqui já está no formato certo.

const hoje = new Date().toISOString().slice(0, 10);
const ok = (x: Record<string, unknown>) => ConsultaPainel.parse({ hoje, ...x });
const recusa = (x: Record<string, unknown>, motivo: string) => assert.equal(ConsultaPainel.safeParse({ hoje, ...x }).success, false, motivo);

// padrão: sem filtro, 40 itens, por relevância
assert.deepEqual(ok({}), {
  busca: "", uf: "", cidade: "", nicho: "", situacao: "", estagio: "", prazo: "", alerta: "",
  fora: false, caixa: false, contato: false, fixados: false, ordem: "relevancia", n: PAGINA, hoje,
  funil: false, periodo: "mes", novos: 6,
});

// funil
assert.deepEqual([ok({ funil: "1", periodo: "90", novos: "12" }).funil, ok({ periodo: "90" }).periodo, ok({ novos: "12" }).novos], [true, "90", 12]);
recusa({ periodo: "ano" }, "período inexistente");
for (const novos of ["0", "601", "1e2", "-1"]) recusa({ novos }, `novos=${novos}`);

// como chega da URL: tudo texto
const daUrl = ok(Object.fromEntries(new URLSearchParams("busca=Sal%C3%A3o&uf=PA&estagio=negociando&fora=true&caixa=0&n=80&ordem=nome&tz=America%2FManaus")));
assert.deepEqual([daUrl.busca, daUrl.uf, daUrl.estagio, daUrl.fora, daUrl.caixa, daUrl.n, daUrl.ordem, daUrl.tz], ["Salão", "PA", "negociando", true, false, 80, "nome", "America/Manaus"]);

// sanitização da busca: forma canônica, sem controle, sem espaço nas pontas
assert.equal(ok({ busca: "  Salão\u0000\u0007 " }).busca, "Salão", "NFC junta o til; controles saem");
assert.equal(ok({ busca: "a\u0085b\u009fc" }).busca, "abc", "controles C1 saem");
assert.equal(ok({ busca: "\u202eoãlas\u2066x\u2069" }).busca, "oãlasx", "controles de direção saem");
assert.equal(ok({ busca: "👨\u200d👩" }).busca, "👨\u200d👩", "o ZWJ do emoji composto fica");
recusa({ busca: "\u0000".repeat(BUSCA_MAX * 4 + 1) }, "texto bruto enorme é recusado antes de ser limpo");
assert.equal(ok({ busca: "\t\n" }).busca, "");
// texto estranho é só texto: a consulta compara, nada é interpretado
for (const t of [`<script>alert(1)</script>`, `"; DROP TABLE x; --`, "=HYPERLINK(1)", "salão 💈", "../../etc"]) assert.equal(ok({ busca: t }).busca, t);
assert.equal(ok({ busca: "a".repeat(BUSCA_MAX) }).busca.length, BUSCA_MAX);
recusa({ busca: "a".repeat(BUSCA_MAX + 1) }, "busca longa");

// estrito: parâmetro desconhecido é recusado
recusa({ outro: "1" }, "parâmetro desconhecido");
// da URL, "__proto__" vira chave própria (num literal ele trocaria o protótipo e não testaria nada)
const comProto = Object.fromEntries(new URLSearchParams("__proto__=x&constructor=y"));
assert.ok(Object.hasOwn(comProto, "__proto__"));
recusa(comProto, "__proto__ e constructor vindos da URL");

// enums fechados
recusa({ uf: "XX" }, "UF inexistente");
recusa({ uf: "pa" }, "UF minúscula");
recusa({ estagio: "ganho" }, "estágio inexistente");
recusa({ prazo: "ontem" }, "prazo inexistente");
recusa({ situacao: "todos" }, "situação inexistente");
recusa({ alerta: "qualquer" }, "alerta inexistente");
recusa({ ordem: "nome desc" }, "ordem inexistente");
recusa({ nicho: "Padaria" }, "nicho fora da lista");
assert.equal(ok({ nicho: "Outros" }).nicho, "Outros");

// booleanos da URL
assert.equal(ok({ fixados: "1" }).fixados, true);
assert.equal(ok({ fixados: "false" }).fixados, false);
recusa({ fixados: "talvez" }, "booleano inválido");

// página
assert.equal(ok({ n: String(PAGINA_MAX) }).n, PAGINA_MAX);
assert.equal(ok({ n: "1" }).n, 1);
for (const n of ["0", "-40", String(PAGINA_MAX + 1), "40.5", "abc", "1e9", "0x28", "4e1", " 40 ", ""]) recusa({ n }, `n=${n}`);

// data de hoje: formato, calendário e janela de um dia
recusa({ hoje: "2026-02-30" }, "data que não existe");
recusa({ hoje: "01/11/2026" }, "formato errado");
recusa({ hoje: "2020-01-01" }, "longe demais do dia de hoje");
assert.equal(ConsultaPainel.safeParse({}).success, false, "hoje é obrigatório");
assert.equal(dataValida("2028-02-29"), true, "ano bissexto");
assert.equal(dataValida("2026-13-01"), false);
const agora = Date.UTC(2026, 10, 1, 15);
assert.equal(hojePlausivel("2026-10-31", agora), true, "fuso a oeste ainda em ontem");
assert.equal(hojePlausivel("2026-11-02", agora), true, "fuso a leste já em amanhã");
assert.equal(hojePlausivel("2026-11-03", agora), false);

// fuso
assert.equal(fusoValido("America/Sao_Paulo"), true);
assert.equal(fusoValido("Lua/Base"), false);
recusa({ tz: "Lua/Base" }, "fuso desconhecido");
recusa({ tz: "A".repeat(65) }, "fuso longo");
assert.equal(ok({ tz: "america/sao_paulo" }).tz, "America/Sao_Paulo", "fuso vira a grafia canônica");

// guardas de tipo
assert.equal(ehUf("PA"), true);
assert.equal(ehUf("XX"), false);
assert.equal(ehOrdem("compromisso"), true);
assert.equal(ehOrdem("__proto__"), false);

// nichos: tipo do schema.org vira rótulo; desconhecido vira "Outros", que está na lista
assert.equal(nichoDe("BarberShop"), "Barbearia");
assert.equal(nichoDe(undefined), "Outros");
assert.ok(NICHOS_DO_PAINEL.includes("Outros"));
assert.equal(new Set(NICHOS_DO_PAINEL).size, NICHOS_DO_PAINEL.length);

console.log("painel-tipos: ok");
