// Rode: npm run test:prospeccao-f1  (envio confirmado, respostas e visita no Firestore do emulador)
import assert from "node:assert/strict";
import { adminDb } from "@/lib/admin";
import { lerCrm, linhaDoTempo, marcarContato, registrarMensagem, registrarVisita } from "@/lib/crm";
import { EventoProspeccao } from "@/lib/crm-tipos";
import { porVariante } from "@/lib/funil-consulta";
import { varianteAB } from "@/lib/prospeccao";

assert.ok(process.env.FIRESTORE_EMULATOR_HOST, "rode pelo emulador (npm run test:prospeccao-f1)");
const db = adminDb;
const SLUG = "salao-f1-teste";
const limpar = async () => {
  await db.recursiveDelete(db.doc(`crm/${SLUG}`));
  await db.doc(`tenants/${SLUG}`).delete();
};
await limpar();
const eventos = async () => (await db.collection(`crm/${SLUG}/eventos`).get()).docs;
const ENVIO_ID = "0b6f3a52-7c1e-4d2a-9f3b-5e8d1c2a4b6f";
const envio = { envioId: ENVIO_ID, textoEnviado: "Oi! Se não fizer sentido, responda PARE.", editado: false };
// a variante sai do tenant (gerado.sub), no servidor
await db.doc(`tenants/${SLUG}`).set({ name: "Salão F1", gerado: { sub: "salao" } });
const VARIANTE = varianteAB(SLUG).id;

// dois "Sim" ao mesmo tempo: o create() deixa um passar; o outro relê e não grava
const juntos = await Promise.all([1, 2, 3].map(() => registrarMensagem(db, SLUG, "Primeiro contato", "a recepção", "admin", envio)));
assert.deepEqual(juntos.filter(Boolean).length, 1, "um só registra");
assert.equal(await registrarMensagem(db, SLUG, "Primeiro contato", "a recepção", "admin", envio), false, "repetido depois também não");
const [ev] = await eventos();
assert.equal(ev.id, `${SLUG}__primeiro__${ENVIO_ID}`);
assert.deepEqual(EventoProspeccao.parse(ev.data()), { tipo: "envio_confirmado", etapa: "primeiro", toque: 1, varianteId: VARIANTE, textoEnviado: envio.textoEnviado, editado: false });
const crm = (await lerCrm(db, [SLUG]))[SLUG];
assert.equal(crm.toques, 1, "o toque conta uma vez");
assert.equal(crm.varianteId, VARIANTE);
assert.equal(crm.proximaAcao, "Lembrete", "a cadência agenda o próximo");

// a resposta automática não para a cadência; a humana para; PARE tira do funil. As três ligadas ao envio
await marcarContato(db, SLUG, "automatica", "admin");
assert.equal((await lerCrm(db, [SLUG]))[SLUG].respondeuEm, null, "automática não é resposta");
await marcarContato(db, SLUG, "respondeu", "admin");
await marcarContato(db, SLUG, "parar", "admin");
const ligados = (await eventos()).map((d) => EventoProspeccao.safeParse(d.data())).flatMap((r) => (r.success && r.data.tipo !== "envio_confirmado" && r.data.tipo !== "site_visto" && r.data.tipo !== "ia_falha" ? [r.data] : []));
assert.deepEqual(ligados.map((e) => e.tipo).sort(), ["optout", "resposta_automatica", "resposta_humana"]);
for (const e of ligados) assert.deepEqual([e.envioId, e.varianteId, e.textoEnviado], [`${SLUG}__primeiro__${ENVIO_ID}`, VARIANTE, envio.textoEnviado]);
// os tipos novos aparecem como mensagem na linha do tempo (a tela só conhece os tipos dela)
assert.ok((await linhaDoTempo(db, SLUG)).every((e) => ["mensagem", "estagio"].includes(e.tipo)));

// visita: só site feito pela Ruphus; a primeira grava siteVistoEm
await db.doc(`tenants/${SLUG}`).set({ name: "Salão F1" });
assert.equal(await registrarVisita(db, SLUG), false, "sem tenant gerado, não conta");
await db.doc(`tenants/${SLUG}`).set({ name: "Salão F1", gerado: { sub: "salao" } });
assert.equal(await registrarVisita(db, SLUG), true);
const visto = (await lerCrm(db, [SLUG]))[SLUG].siteVistoEm;
assert.ok(visto);
assert.equal(await registrarVisita(db, SLUG), true);
assert.equal((await lerCrm(db, [SLUG]))[SLUG].siteVistoEm, visto, "a primeira visita fica");
assert.equal((await eventos()).filter((d) => d.get("tipo") === "site_visto").length, 2);

// a tabela por variante bate com o que foi gravado
const final = await lerCrm(db, [SLUG]);
assert.deepEqual(porVariante([{ slug: SLUG, nome: "Salão F1", telefone: null, nicho: "Cabeleireiro", cidade: null, uf: null, nota: null, avaliacoes: null, acessos: 1, limiteStaff: 2, caixa: false }], final), [
  { varianteId: VARIANTE, confirmados: 1, humanas: 1, optouts: 1, visitas: 1, avancaram: 0 },
]);

await limpar();
console.log("prospecção F1 no emulador: ok");
