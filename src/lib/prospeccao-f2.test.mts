// Rode: npm run test:prospeccao-f2  (estatísticas por variante e troca de modelo sem deploy, no emulador)
import assert from "node:assert/strict";
import { adminDb } from "@/lib/admin";
import { historicoDoCopiloto, marcarContato, registrarMensagem } from "@/lib/crm";
import { ambienteFirestore, chamarIA, custosDaIA, lerRoteamento, salvarRoteamento, type Provedor } from "@/lib/ia-roteador.server";
import { varianteAB } from "@/lib/prospeccao";
import { Sugestao } from "@/lib/prospeccao-ia.server";
import { varianteDoId } from "@/lib/prospeccao-variantes";

assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "rode pelo emulador (npm run test:prospeccao-f2)");
const db = adminDb;
const SLUG = "salao-f2-teste";
const VARIANTE = varianteAB(SLUG).id;
const limpar = async () => {
  await db.recursiveDelete(db.doc(`crm/${SLUG}`));
  await db.doc(`tenants/${SLUG}`).delete();
  await db.doc(`prospeccaoVariantes/${VARIANTE}`).delete();
  await db.doc("config/ia-roteamento").delete();
  await Promise.all((await db.collection("iaChamadas").get()).docs.map((d) => d.ref.delete()));
};
await limpar();
const stats = async () => (await db.doc(`prospeccaoVariantes/${VARIANTE}`).get()).data() ?? {};

// ————— 2.3: cada evento conta uma vez, com incremento atômico —————
await db.doc(`tenants/${SLUG}`).set({ name: "Salão F2", gerado: { sub: "salao" } });
const envio = { envioId: "5d0c1a2b-3c4d-4e5f-8a6b-7c8d9e0f1a2b", textoEnviado: "Oi! Se não fizer sentido, responda PARE.", editado: false };
// três "Sim" do mesmo envio ao mesmo tempo, mais um depois: enviados = 1
await Promise.all([1, 2, 3].map(() => registrarMensagem(db, SLUG, "Primeiro contato", "a recepção", "admin", envio)));
await registrarMensagem(db, SLUG, "Primeiro contato", "a recepção", "admin", envio);
let s = await stats();
assert.equal(s.enviados, 1, "o envio conta uma vez");
assert.deepEqual([s.nicho, s.etapa], [varianteDoId(VARIANTE)!.nicho, "primeiro"]);
assert.ok(s.ultimoEnvioEm, "a última enviada no nicho sai daqui");
// resposta humana clicada duas vezes (e em paralelo): respostas = 1
await Promise.all([marcarContato(db, SLUG, "respondeu", "admin"), marcarContato(db, SLUG, "respondeu", "admin")]);
await marcarContato(db, SLUG, "respondeu", "admin");
await marcarContato(db, SLUG, "automatica", "admin");
await marcarContato(db, SLUG, "parar", "admin");
await marcarContato(db, SLUG, "parar", "admin");
s = await stats();
assert.deepEqual([s.enviados, s.respostas, s.automaticas, s.optouts], [1, 1, 1, 1], "cada tipo conta uma vez por envio");
const ligados = (await db.collection(`crm/${SLUG}/eventos`).get()).docs.filter((d) => ["resposta_humana", "resposta_automatica", "optout"].includes(d.get("tipo")));
assert.equal(ligados.length, 3, "um evento por tipo");
// editado não mede a variante: nada sobe
await db.recursiveDelete(db.doc(`crm/${SLUG}`));
await registrarMensagem(db, SLUG, "Primeiro contato", "a recepção", "admin", { ...envio, envioId: "6e1d2b3c-4d5e-4f60-9b7c-8d9e0f1a2b3c", editado: true });
assert.equal((await stats()).enviados, 1, "texto editado não conta para a variante");
console.log("estatísticas por variante: ok");

// ————— a resposta depois do lembrete conta na variante do primeiro contato, uma vez por lead —————
{
  await db.recursiveDelete(db.doc(`crm/${SLUG}`));
  await db.doc(`prospeccaoVariantes/${VARIANTE}`).delete();
  const id = (n: number) => `7f2e3c4d-5e6f-4a71-8b2c-3d4e5f6a7b${String(n).padStart(2, "0")}`;
  await registrarMensagem(db, SLUG, "Primeiro contato", "a recepção", "admin", { ...envio, envioId: id(1) });
  await registrarMensagem(db, SLUG, "Lembrete", "a recepção", "admin", { ...envio, envioId: id(2), textoEnviado: "Lembrete: viu a prévia? PARE para sair." });
  assert.equal((await db.doc(`crm/${SLUG}`).get()).get("ultimoEnvio.varianteId"), null, "o lembrete troca o ultimoEnvio (sem variante)");
  await marcarContato(db, SLUG, "respondeu", "admin");
  assert.equal((await stats()).respostas, 1, "a resposta conta na variante A do primeiro contato");
  const resposta = (await db.collection(`crm/${SLUG}/eventos`).where("tipo", "==", "resposta_humana").get()).docs;
  assert.deepEqual(resposta.map((d) => d.get("varianteId")), [VARIANTE]);
  // outro envio e outra resposta: novo evento, mas a variante conta o lead uma vez só
  await registrarMensagem(db, SLUG, "Última tentativa", "a recepção", "admin", { ...envio, envioId: id(3) });
  await marcarContato(db, SLUG, "respondeu", "admin");
  assert.equal((await db.collection(`crm/${SLUG}/eventos`).where("tipo", "==", "resposta_humana").get()).size, 2);
  assert.equal((await stats()).respostas, 1, "uma vez por lead");
  // o histórico do copiloto sai do CRM, do mais antigo ao mais novo (a tela não manda histórico)
  assert.deepEqual(
    (await historicoDoCopiloto(db, SLUG)).map((f) => [f.de, f.texto]),
    [["ruphus", envio.textoEnviado], ["ruphus", "Lembrete: viu a prévia? PARE para sair."], ["ruphus", envio.textoEnviado]],
  );
  // só o ultimoEnvio no doc (eventos fora da janela lida): ainda entra
  await db.doc(`crm/${SLUG}-hist`).set({ ultimoEnvio: { id: "x", varianteId: null, textoEnviado: "Só no doc." } });
  assert.deepEqual(await historicoDoCopiloto(db, `${SLUG}-hist`), [{ de: "ruphus", texto: "Só no doc." }]);
  await db.doc(`crm/${SLUG}-hist`).delete();
  assert.deepEqual(await historicoDoCopiloto(db, "nao-existe"), [], "sem CRM, histórico vazio");

  // parar, liberar, parar no mesmo envio: o estado final é parado e cada mudança tem o seu evento
  await marcarContato(db, SLUG, "parar", "admin");
  await marcarContato(db, SLUG, "liberar", "admin");
  await marcarContato(db, SLUG, "parar", "admin");
  await marcarContato(db, SLUG, "parar", "admin"); // clique repetido: nada muda
  const doc = await db.doc(`crm/${SLUG}`).get();
  assert.ok(doc.get("naoContatarEm"), "parado de novo");
  assert.equal(doc.get("estagio"), "perdido");
  const linha = (await db.collection(`crm/${SLUG}/eventos`).orderBy("quando").get()).docs.map((d) => d.get("tipo") === "optout" ? "optout" : d.get("titulo"));
  assert.deepEqual(linha.slice(-3), ["optout", "Perdido → Novo", "optout"], "cada mudança de estado com o seu evento");
  assert.equal((await stats()).optouts, 1, "o segundo PARE não conta de novo na variante");
}
// MEDIUM-2 (revisão do núcleo): lembrete da fila COM variante própria; a resposta e o opt-out depois dele
// contam na variante da raiz (a do primeiro contato), não na do lembrete
{
  const LEMBRETE_FILA = "salao-lembrete-faltas";
  await db.recursiveDelete(db.doc(`crm/${SLUG}`));
  await db.doc(`prospeccaoVariantes/${VARIANTE}`).delete();
  await db.doc(`prospeccaoVariantes/${LEMBRETE_FILA}`).delete();
  const id = (n: number) => `8a3f4d5e-6f7a-4b82-9c3d-4e5f6a7b8c${String(n).padStart(2, "0")}`;
  await registrarMensagem(db, SLUG, "Primeiro contato", "a recepção", "admin", { ...envio, envioId: id(1) });
  await registrarMensagem(db, SLUG, "Lembrete", "a recepção", "fila", { ...envio, envioId: id(2) }, Date.now(), { varianteId: LEMBRETE_FILA as never });
  assert.equal((await db.doc(`crm/${SLUG}`).get()).get("ultimoEnvio.varianteId"), LEMBRETE_FILA, "o ultimoEnvio é o lembrete, com a variante dele");
  await marcarContato(db, SLUG, "respondeu", "admin");
  await marcarContato(db, SLUG, "parar", "admin");
  assert.deepEqual([(await stats()).respostas, (await stats()).optouts], [1, 1], "contam na variante do primeiro contato");
  const lembrete = (await db.doc(`prospeccaoVariantes/${LEMBRETE_FILA}`).get()).data() ?? {};
  assert.deepEqual([lembrete.enviados, lembrete.respostas ?? 0, lembrete.optouts ?? 0], [1, 0, 0], "a do lembrete só conta o envio");
  const ligadosM2 = (await db.collection(`crm/${SLUG}/eventos`).where("tipo", "in", ["resposta_humana", "optout"]).get()).docs;
  assert.deepEqual(ligadosM2.map((d) => d.get("varianteId")), [VARIANTE, VARIANTE]);
  await db.doc(`prospeccaoVariantes/${LEMBRETE_FILA}`).delete();
}
// LOW-5: proposta e boas-vindas confirmadas (tipo "mensagem" com textoEnviado) entram no histórico do
// copiloto; mensagem sem confirmação (sem texto) não
{
  const S = `${SLUG}-low5`;
  await db.recursiveDelete(db.doc(`crm/${S}`));
  await db.doc(`crm/${S}`).set({ estagio: "negociando" });
  await registrarMensagem(db, S, "Proposta", "o dono", "admin", { envioId: "9b4a5e6f-7a8b-4c93-8d4e-5f6a7b8c9d01", textoEnviado: "Montei a proposta. PARE para sair.", editado: false });
  await registrarMensagem(db, S, "Cobrança de 2026-11", "o dono", "admin");
  await registrarMensagem(db, S, "Boas-vindas", "o dono", "admin", { envioId: "9b4a5e6f-7a8b-4c93-8d4e-5f6a7b8c9d02", textoEnviado: "Bem-vindo! PARE para sair.", editado: true });
  assert.deepEqual((await historicoDoCopiloto(db, S)).map((f) => f.texto), ["Montei a proposta. PARE para sair.", "Bem-vindo! PARE para sair."]);
  await db.recursiveDelete(db.doc(`crm/${S}`));
}
console.log("resposta atribuída à variante do lead: ok");

// ————— 2.6: troca de modelo sem deploy (config no Firestore, chamarIA lê na hora) —————
const mock: Provedor = async () => ({ bruto: { resposta: "Quantos profissionais atendem aí?", etapaSugerida: "oferta", motivo: "teste" }, tokensEntrada: 0, tokensSaida: 0 });
const amb = { ...ambienteFirestore(db), provedores: { ...ambienteFirestore(db).provedores, mock } };
const pedir = () => chamarIA({ tarefa: "sugerir_resposta", entrada: { sistema: "s", mensagens: [{ role: "user", content: "oi" }] }, schema: Sugestao }, amb);
const rota = (modelo: string) => ({ sugerir_resposta: { cadeia: [{ provedor: "mock", modelo, maxTokens: 600, timeoutMs: 1000 }] } });
await salvarRoteamento(db, rota("modelo-a"));
assert.equal((await pedir()).modelo, "modelo-a");
await salvarRoteamento(db, rota("modelo-b"));
assert.equal((await pedir()).modelo, "modelo-b", "a próxima chamada já usa o modelo novo");
// config inválida é recusada e a anterior fica
await assert.rejects(salvarRoteamento(db, { sugerir_resposta: { cadeia: [] } }));
await assert.rejects(salvarRoteamento(db, { inventada: rota("x").sugerir_resposta }));
assert.equal((await lerRoteamento(db)).sugerir_resposta?.cadeia[0].modelo, "modelo-b");
// a tabela de custo por tarefa sai de iaChamadas
const { linhas } = await custosDaIA(db);
assert.deepEqual(
  linhas.map((l) => [l.tarefa, l.modelo, l.chamadas, l.erros]).sort(),
  [["sugerir_resposta", "modelo-a", 1, 0], ["sugerir_resposta", "modelo-b", 1, 0]],
);
console.log("troca de modelo sem deploy: ok");

await limpar();
console.log("prospecção F2 no emulador: ok");
process.exit(0);
