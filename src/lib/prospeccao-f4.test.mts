// Rode: npm run test:prospeccao-f4  (biblioteca no Firestore: seed idempotente, versão, métricas separadas,
// trava do A/B da F1 e a prévia; emulador demo-siteflow, nada sai para a rede)
import assert from "node:assert/strict";

// o código, não a classe: o módulo pode chegar duplicado pelo carregador do teste
const codigo = (c: string) => (e: unknown) => (e as { codigo?: string }).codigo === c;
import { adminDb } from "@/lib/admin";
import { marcarContato, registrarMensagem } from "@/lib/crm";
import { varianteAB } from "@/lib/prospeccao";
import { VARIANTES_TRAVADAS } from "@/lib/prospeccao-biblioteca";
import { aprovarRascunho, COLECAO, duplicarVariante, editarVariante, leadParaPrevia, lerBiblioteca, mudarStatusVariante, semear } from "@/lib/prospeccao-biblioteca.server";
import { FILA } from "@/lib/prospeccao-fila";
import { VARIANTES, VARIANTES_F1 } from "@/lib/prospeccao-variantes";
import { paraVarianteId } from "@/lib/tipos-marca";

assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "rode pelo emulador (npm run test:prospeccao-f4)");
const db = adminDb;
const SLUGS = ["salao-f4-fila", "salao-f4-ab"];
const ITENS_FILA = ["f4-aberto", "f4-editar-pendente", "f4-pausar-pendente", "f4-pausar-reservado"];
const PARE = "Se não fizer sentido, responda PARE e não escrevo mais.";
const limpar = async () => {
  await Promise.all((await db.collection(COLECAO).get()).docs.map((d) => d.ref.delete()));
  for (const s of SLUGS) {
    await db.recursiveDelete(db.doc(`crm/${s}`));
    await db.doc(`tenants/${s}`).delete();
  }
  for (const i of ITENS_FILA) await db.doc(`${FILA}/${i}`).delete();
};
await limpar();
const ler = async (id: string) => (await db.doc(`${COLECAO}/${id}`).get()).data() ?? {};
// o que o editor abriu (M1): editadaEm e texto do doc
const baseDe = async (id: string) => {
  const d = await ler(id);
  return { editadaEm: typeof d.editadaEm === "number" ? d.editadaEm : null, texto: String(d.texto ?? "") };
};

// ————— 4.1: coleção vazia = biblioteca do código —————
let b = await lerBiblioteca(db);
assert.equal(b.fonte, "codigo");
assert.equal(b.ativas.length, VARIANTES.length);
await assert.rejects(editarVariante(db, "salao-primeiro-pergunta-aberta", { texto: `{oi} x ${PARE}`, angulo: "pergunta_aberta" }, { editadaEm: null, texto: "" }), codigo("VarianteNaoEncontrada"), "antes do seed não edita");

// ————— 4.1: seed idempotente, sem sobrescrever editada nem números —————
const PERGUNTA = "salao-primeiro-pergunta-aberta";
// o CRM já contou envios antes do seed (doc só com números)
await db.doc(`${COLECAO}/${PERGUNTA}`).set({ enviados: 7, respostas: 1, optouts: 0, nicho: "salao", etapa: "primeiro" });
// uma editada no admin (texto próprio e editadaEm)
const EDITADA = "barbearia-primeiro-faltas";
const textoEditado = `{oi} {prova} Texto do dono para o {nome}. ${PARE}`;
await db.doc(`${COLECAO}/${EDITADA}`).set({ id: EDITADA, nicho: "barbearia", etapa: "primeiro", angulo: "faltas", texto: textoEditado, status: "ativa", versao: 1, versaoDe: null, editadaEm: 123 });
// só com editadaEm (sem texto) também não é tocada
const SO_DATA = "unhas-primeiro-faltas";
await db.doc(`${COLECAO}/${SO_DATA}`).set({ editadaEm: 456 });

assert.deepEqual(await semear(db), { criadas: VARIANTES.length - 3, completadas: 1, mantidas: 2 });
const pergunta = await ler(PERGUNTA);
assert.deepEqual([pergunta.enviados, pergunta.respostas, pergunta.texto, pergunta.status], [7, 1, VARIANTES.find((v) => v.id === PERGUNTA)!.texto, "ativa"], "números ficam, texto entra");
assert.equal((await ler(EDITADA)).texto, textoEditado, "editada não é sobrescrita");
assert.deepEqual(await ler(SO_DATA), { editadaEm: 456 });
assert.deepEqual(await semear(db), { criadas: 0, completadas: 0, mantidas: VARIANTES.length }, "rodar de novo não muda nada");
// M3: travada com texto antigo (seed anterior): a leitura usa o do código e o seed reescreve
const TRAVADA = VARIANTES_F1[0];
await db.doc(`${COLECAO}/${TRAVADA.id}`).update({ texto: `{oi} Texto antigo. ${PARE}` });
assert.equal((await lerBiblioteca(db)).docs.find((d) => d.id === TRAVADA.id)?.texto, TRAVADA.texto, "leitura: o texto do código");
assert.deepEqual(await semear(db), { criadas: 0, completadas: 1, mantidas: VARIANTES.length - 1 });
assert.equal((await ler(TRAVADA.id)).texto, TRAVADA.texto, "seed reescreve a travada");
console.log("seed: ok");

b = await lerBiblioteca(db);
assert.equal(b.fonte, "firestore");
assert.equal(b.docs.length, VARIANTES.length - 1, "o doc sem texto fica fora");
assert.equal(b.stats[PERGUNTA].enviados, 7);
// doc torto vai para o log e fica fora; mexer nele é erro previsto, não ZodError (L5)
await db.doc(`${COLECAO}/torta`).set({ texto: "x", nicho: "lua" });
assert.equal((await lerBiblioteca(db)).docs.length, VARIANTES.length - 1);
await assert.rejects(editarVariante(db, "torta", { texto: `{oi} x ${PARE}`, angulo: "faltas" }, { editadaEm: null, texto: "x" }), codigo("VarianteInvalida"));
await assert.rejects(mudarStatusVariante(db, "torta", "pausada"), codigo("VarianteInvalida"));
await db.doc(`${COLECAO}/torta`).delete();

// ————— 4.2: editar com envios cria a versão nova e pausa a anterior —————
const novoTexto = `{oi} {prova} Pergunta rápida: a cliente do {nome} marca pelo Instagram? ${PARE}`;
const ed = await editarVariante(db, PERGUNTA, { texto: novoTexto, angulo: "pergunta_aberta" }, await baseDe(PERGUNTA), 1000);
assert.deepEqual(ed, { id: `${PERGUNTA}-v2`, novaVersao: true });
const [antiga, v2] = [await ler(PERGUNTA), await ler(ed.id)];
assert.deepEqual([antiga.status, antiga.enviados, antiga.texto === novoTexto], ["pausada", 7, false]);
assert.deepEqual([v2.status, v2.enviados, v2.respostas, v2.versao, v2.versaoDe, v2.texto, v2.editadaEm], ["ativa", 0, 0, 2, PERGUNTA, novoTexto, 1000]);
// sem envios: o mesmo doc
const LEMBRETE = "salao-lembrete-faltas";
const t2 = `{oi} Deixei a agenda do {nome} em {site}. Posso ajustar? Se não quiser mais mensagens, responda PARE.`;
assert.deepEqual(await editarVariante(db, LEMBRETE, { texto: t2, angulo: "faltas" }, await baseDe(LEMBRETE), 2000), { id: LEMBRETE, novaVersao: false });
assert.deepEqual([(await ler(LEMBRETE)).texto, (await ler(LEMBRETE)).editadaEm], [t2, 2000]);
// texto fora da regra: nada gravado
await assert.rejects(editarVariante(db, LEMBRETE, { texto: "R$ 10 sem saída", angulo: "faltas" }, await baseDe(LEMBRETE)), codigo("VarianteInvalida"));
// a regra do produtor também: link fora da lista no lembrete, @ (HIGH)
await assert.rejects(editarVariante(db, LEMBRETE, { texto: `{oi} Veja instagram.com/ruphus. ${PARE}`, angulo: "faltas" }, await baseDe(LEMBRETE)), codigo("VarianteInvalida"));
await assert.rejects(editarVariante(db, LEMBRETE, { texto: `{oi} Me chama no @ruphus. ${PARE}`, angulo: "faltas" }, await baseDe(LEMBRETE)), codigo("VarianteInvalida"));
assert.equal((await ler(LEMBRETE)).texto, t2);
// M1: duas edições abertas sobre a mesma base, ao mesmo tempo: uma passa, a outra recusa
const abriu = await baseDe(LEMBRETE);
const corrida = await Promise.allSettled([
  editarVariante(db, LEMBRETE, { texto: t2.replace("Posso", "Quer que eu"), angulo: "faltas" }, abriu, 2100),
  editarVariante(db, LEMBRETE, { texto: t2.replace("Posso ajustar?", "Ajusto algo?"), angulo: "faltas" }, abriu, 2200),
]);
assert.equal(corrida.filter((x) => x.status === "fulfilled").length, 1, "uma das duas grava");
const recusada = corrida.find((x) => x.status === "rejected");
assert.ok(recusada?.status === "rejected" && codigo("VarianteMudou")(recusada.reason), "a outra: a variante mudou");
// L1: a antiga que já tem sucessor (v2) não gera outra v2
await assert.rejects(editarVariante(db, PERGUNTA, { texto: novoTexto.replace("rápida", "curta"), angulo: "pergunta_aberta" }, await baseDe(PERGUNTA)), codigo("VarianteInvalida"));
assert.equal((await db.collection(COLECAO).where("versaoDe", "==", PERGUNTA).get()).size, 1, "uma v2 só");
// LOW-8 (revisão do núcleo): a antiga com sucessor não volta a ativa (duas versões ativas misturariam números)
await assert.rejects(mudarStatusVariante(db, PERGUNTA, "ativa"), codigo("VarianteInvalida"));
assert.equal((await ler(PERGUNTA)).status, "pausada");
// M2: sem envios, mas com item aberto na fila: versão nova (o item leva o texto antigo)
const ULTIMA = "salao-ultima-pergunta-aberta";
await db.doc(`${FILA}/f4-aberto`).set({ varianteId: ULTIMA, status: "reservado" });
await db.doc(`${FILA}/f4-editar-pendente`).set({ varianteId: ULTIMA, status: "pendente", telefoneNorm: "5511999990003" });
const t3 = `{oi} Não vou insistir. A prévia do {nome} fica em {site}. ${PARE}`;
assert.deepEqual(await editarVariante(db, ULTIMA, { texto: t3, angulo: "pergunta_aberta" }, await baseDe(ULTIMA), 2300), { id: `${ULTIMA}-v2`, novaVersao: true });
assert.equal((await ler(ULTIMA)).status, "pausada");
// a versão pausada pela edição cancela os pendentes dela (como pausar); o reservado já está saindo
const [editPend, editRes] = [(await db.doc(`${FILA}/f4-editar-pendente`).get()).data(), (await db.doc(`${FILA}/f4-aberto`).get()).data()];
assert.deepEqual([editPend?.status, editPend?.motivo, editPend?.canceladoEm, editRes?.status], ["cancelado", "variante_pausada", 2300, "reservado"]);
console.log("versão: ok");

// ————— trava do A/B da F1 —————
for (const id of VARIANTES_TRAVADAS) {
  await assert.rejects(editarVariante(db, id, { texto: `{oi} Outro. ${PARE}`, angulo: "elogio_google" }, await baseDe(id)), codigo("VarianteTravada"));
  await assert.rejects(mudarStatusVariante(db, id, "pausada"), codigo("VarianteTravada"));
  assert.equal((await ler(id)).status, "ativa");
}

// ————— ativar, pausar, duplicar, aprovar rascunho —————
const dup = await duplicarVariante(db, VARIANTES_TRAVADAS[0], 3000);
assert.equal(dup.id, `${VARIANTES_TRAVADAS[0]}-copia`);
assert.deepEqual([(await ler(dup.id)).status, (await ler(dup.id)).enviados], ["pausada", 0]);
await mudarStatusVariante(db, dup.id, "ativa");
assert.equal((await ler(dup.id)).status, "ativa");
// L6: pausar cancela o item aberto da variante na fila; o reservado (saindo) fica
await db.doc(`${FILA}/f4-pausar-pendente`).set({ varianteId: dup.id, status: "pendente", telefoneNorm: "5511999990001" });
await db.doc(`${FILA}/f4-pausar-reservado`).set({ varianteId: dup.id, status: "reservado", telefoneNorm: "5511999990002" });
assert.deepEqual(await mudarStatusVariante(db, dup.id, "pausada", 4000), { id: dup.id, cancelados: 1 });
const [cancelado, reservado] = [(await db.doc(`${FILA}/f4-pausar-pendente`).get()).data(), (await db.doc(`${FILA}/f4-pausar-reservado`).get()).data()];
assert.deepEqual([cancelado?.status, cancelado?.motivo, cancelado?.canceladoEm, reservado?.status], ["cancelado", "variante_pausada", 4000, "reservado"]);
await mudarStatusVariante(db, dup.id, "ativa");
const aprovada = await aprovarRascunho(db, { nicho: "salao", etapa: "primeiro", angulo: "faltas", texto: `{oi} {prova} Falta de cliente pesa no {nome}? ${PARE}` });
assert.equal((await ler(aprovada.id)).status, "pausada", "rascunho aprovado nasce pausado");

// o produtor sorteia só as ativas do Firestore
const ativas = (await lerBiblioteca(db)).ativas.filter((v) => v.nicho === "salao" && v.etapa === "primeiro").map((v) => v.id as string);
assert.ok(ativas.includes(`${PERGUNTA}-v2`) && ativas.includes(dup.id));
assert.ok(!ativas.includes(PERGUNTA) && !ativas.includes(aprovada.id), "sem pausada");
console.log("ações: ok");

// ————— métricas não se misturam; o A/B da F1 segue no código —————
for (const s of SLUGS) await db.doc(`tenants/${s}`).set({ name: s, gerado: { sub: "salao" } });
const envio = (n: number) => ({ envioId: `5d0c1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a${String(n).padStart(2, "0")}`, textoEnviado: "Oi! " + PARE, editado: false });
const V2 = paraVarianteId(`${PERGUNTA}-v2`)!;
assert.equal(await registrarMensagem(db, SLUGS[0], "Primeiro contato", "a recepção", "fila", envio(1), Date.now(), { varianteId: V2 }), true);
await marcarContato(db, SLUGS[0], "respondeu", "admin");
assert.deepEqual([(await ler(V2)).enviados, (await ler(V2)).respostas], [1, 1], "a versão nova conta os seus");
assert.deepEqual([(await ler(PERGUNTA)).enviados, (await ler(PERGUNTA)).respostas], [7, 1], "a anterior fica como estava");
assert.deepEqual([(await ler(V2)).nicho, (await ler(V2)).texto], ["salao", novoTexto], "contar não apaga o texto");
// A/B: sem variante da fila, a do hash do slug, do código, entre as travadas
await registrarMensagem(db, SLUGS[1], "Primeiro contato", "a recepção", "admin", envio(2));
const evAB = (await db.collection(`crm/${SLUGS[1]}/eventos`).where("tipo", "==", "envio_confirmado").get()).docs[0];
assert.equal(evAB.get("varianteId"), varianteAB(SLUGS[1]).id);
assert.ok(VARIANTES_TRAVADAS.includes(evAB.get("varianteId")));
console.log("métricas e A/B: ok");

// ————— prévia com um lead real —————
await db.doc(`tenants/${SLUGS[0]}`).set({ site: { rating: 4.8, reviews: 120 } }, { merge: true });
await db.doc(`crm/${SLUGS[0]}`).set({ donoNome: "Ana Souza" }, { merge: true });
const lead = await leadParaPrevia(db, "salao", SLUGS[0]);
assert.equal(lead?.slug, SLUGS[0]);
assert.equal(lead?.marcadores.oi, "Oi, Ana! Aqui é a assistente virtual da Ruphus.");
assert.equal(lead?.marcadores.prova, `Vi o ${SLUGS[0]} no Google, com 4,8 ★ e 120 avaliações.`);
assert.equal(await leadParaPrevia(db, "salao", "nao-existe-f4"), null);
assert.equal(await leadParaPrevia(db, "salao", "Slug Inválido!"), null, "slug inválido não cai em outro lead (L3)");
assert.equal((await leadParaPrevia(db, "salao"))?.slug, SLUGS[0], "sem slug: o primeiro do nicho com nota");
// LOW-9: "geral" não é gerado.sub de ninguém: busca sem filtro de nicho (qualquer tenant com nota)
assert.equal((await leadParaPrevia(db, "geral"))?.slug, SLUGS[0], "geral: um lead de qualquer nicho");
console.log("prévia: ok");

await limpar();
console.log("prospeccao-f4: ok");
