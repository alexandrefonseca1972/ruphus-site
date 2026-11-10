// Rode: npm run test:rules
import { assertFails, assertSucceeds, initializeTestEnvironment } from "@firebase/rules-unit-testing";
import { collection, collectionGroup, deleteDoc, doc, getDoc, getDocs, query, serverTimestamp, setDoc, updateDoc, where, writeBatch } from "firebase/firestore";
import { getBytes, ref, uploadBytes } from "firebase/storage";
import { readFileSync } from "node:fs";

const env = await initializeTestEnvironment({
  projectId: "demo-siteflow",
  firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8085 },
  storage: { rules: readFileSync("storage.rules", "utf8"), host: "127.0.0.1", port: 9199 },
});
const as = (uid) => env.authenticatedContext(uid, { email: `${uid}@teste.dev`, email_verified: true }).firestore();
// conta com e-mail ainda sem confirmar: o e-mail não vale como autor
const semConfirmar = (uid) => env.authenticatedContext(uid, { email: `${uid}@teste.dev`, email_verified: false }).firestore();

function create(db, slug, uid) {
  const b = writeBatch(db);
  b.set(doc(db, "tenants", slug), { name: slug, ownerId: uid });
  b.set(doc(db, `tenants/${slug}/members/${uid}`), { uid, role: "owner" });
  return b.commit();
}

const alice = as("alice"), bob = as("bob"), mallory = as("mallory");

// Criar negócio é só pelo servidor (limite por conta): nem o próprio dono cria pelo app
await assertFails(create(alice, "acme", "alice"));
await env.withSecurityRulesDisabled((ctx) => create(ctx.firestore(), "acme", "alice"));
await assertFails(create(mallory, "acme", "mallory")); // slug já existe
await assertFails(setDoc(doc(mallory, "tenants/x"), { name: "x", ownerId: "alice" })); // sem membro owner
await assertFails(setDoc(doc(mallory, "tenants/acme/members/mallory"), { uid: "mallory", role: "admin" }));

// Isolamento
// subcoleção sem regra (a antiga "sites" não era usada): nem o dono grava
await assertFails(setDoc(doc(alice, "tenants/acme/sites/s1"), { title: "a" }));
await assertFails(getDoc(doc(mallory, "tenants/acme")));

// Admin da plataforma: entra em qualquer espaço para dar suporte; quem não está na lista, não
await env.withSecurityRulesDisabled((ctx) =>
  setDoc(doc(ctx.firestore(), "config/admin"), { uids: ["suporte"] }),
);
const suporte = as("suporte");
await assertSucceeds(getDoc(doc(suporte, "tenants/acme")));
await assertSucceeds(setDoc(doc(suporte, "tenants/acme/services/corte"), { name: "Corte", durationMin: 30, priceCents: 4000, active: true }));
await assertFails(setDoc(doc(suporte, "tenants/acme/services/longo"), { name: "x".repeat(81), durationMin: 30, priceCents: 1, active: true }), "nome longo");
await assertFails(setDoc(doc(suporte, "tenants/acme/services/extra"), { name: "Corte", durationMin: 30, priceCents: 1, active: true, usos: 999 }), "usos é do servidor");
await assertFails(getDoc(doc(mallory, "config/admin")));   // a lista não é pública
// Dinheiro mora fora do tenant de propósito: dentro dele a regra pega-tudo libera
// coleção nova para qualquer membro, e cobrança não é assunto de quem usa a agenda.
await assertFails(getDoc(doc(alice, "cobrancas/acme-2026-10")), "membro nao le cobranca");
await assertFails(setDoc(doc(alice, "cobrancas/acme-2026-10"), { valorCents: 1 }));
await assertFails(getDoc(doc(alice, "config/pix")), "a chave Pix da Ruphus nao e publica");
await assertFails(getDoc(doc(alice, "config/integracoes")), "as chaves de SMS, e-mail e WhatsApp nao sao publicas");
await assertFails(getDoc(doc(suporte, "cobrancas/acme-2026-10")), "nem o admin le pelo cliente: so o Admin SDK")
await assertFails(setDoc(doc(suporte, "config/admin"), { uids: ["mallory"] })); // nem o admin escreve nela
// sessão encerrada ("encerrar sessões" grava revogados[uid] em ms): o token emitido antes não lê mais
const agoraS = Math.floor(Date.now() / 1000);
const suporteAntigo = env.authenticatedContext("suporte", { email: "suporte@teste.dev", email_verified: true, auth_time: agoraS - 600 }).firestore();
const suporteNovo = env.authenticatedContext("suporte", { email: "suporte@teste.dev", email_verified: true, auth_time: agoraS + 5 }).firestore();
await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "config/admin"), { uids: ["suporte"], revogados: { suporte: (agoraS - 60) * 1000 } }));
await assertFails(getDoc(doc(suporteAntigo, "tenants/acme")), "sessão de antes da revogação não lê");
await assertSucceeds(getDoc(doc(suporteNovo, "tenants/acme")), "entrou de novo depois: lê");
// a conta da plataforma também é membro de verdade (dona) de milhares de espaços: revogada, não passa pelo exists
await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "tenants/acme/members/suporte"), { uid: "suporte", role: "owner" }));
await assertFails(getDoc(doc(suporteAntigo, "tenants/acme")), "membro dono revogado também não lê");
await assertFails(setDoc(doc(suporteAntigo, "tenants/acme/services/x"), { name: "x", durationMin: 30, priceCents: 1, active: true }), "nem grava");
await assertSucceeds(getDoc(doc(suporteNovo, "tenants/acme")));
await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "config/admin"), { uids: ["suporte"] }));

// Demonstração (senha compartilhada): nome de serviço e profissional aparece no site público
await env.withSecurityRulesDisabled(async (ctx) => {
  const f = ctx.firestore();
  await create(f, "barbearia-force", "demo");
  await setDoc(doc(f, "tenants/barbearia-force/services/corte"), { name: "Corte", durationMin: 30, priceCents: 3500, active: true, usos: 12, ordem: 0 });
  await setDoc(doc(f, "tenants/barbearia-force/staff/paulo"), { name: "Paulo", serviceIds: ["corte"], hours: {}, active: true });
});
const demo = as("demo");
await assertSucceeds(updateDoc(doc(demo, "tenants/barbearia-force/services/corte"), { priceCents: 4000, durationMin: 45 }), "preço e duração: pode testar");
await assertFails(updateDoc(doc(demo, "tenants/barbearia-force/services/corte"), { name: "PAGUE O PIX 123" }), "nome não");
// como o painel salva (setDoc com merge, todos os campos do formulário): preço muda, usos/ordem ficam
await assertSucceeds(setDoc(doc(demo, "tenants/barbearia-force/services/corte"), { name: "Corte", durationMin: 30, priceCents: 4200, tipoPreco: "fixo", active: true }, { merge: true }), "salvar do painel na demo");
await assertFails(setDoc(doc(demo, "tenants/barbearia-force/services/corte"), { name: "Golpe", durationMin: 30, priceCents: 4200, tipoPreco: "fixo", active: true }, { merge: true }), "salvar do painel trocando o nome: não");
await assertFails(setDoc(doc(demo, "tenants/barbearia-force/services/novo"), { name: "golpe", durationMin: 30, priceCents: 1, active: true }), "serviço novo não");
await assertFails(deleteDoc(doc(demo, "tenants/barbearia-force/services/corte")), "excluir não");
await assertSucceeds(updateDoc(doc(demo, "tenants/barbearia-force/staff/paulo"), { active: false }), "ativo do profissional: pode");
await assertFails(updateDoc(doc(demo, "tenants/barbearia-force/staff/paulo"), { name: "golpe" }), "nome do profissional não");
await assertSucceeds(updateDoc(doc(suporte, "tenants/barbearia-force/services/corte"), { name: "Corte masculino" }), "a plataforma muda");
await assertFails(getDoc(doc(mallory, "tenants/acme/sites/s1")));
await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), "tenants/acme")));

// Papéis
await assertFails(setDoc(doc(alice, "tenants/acme/members/bob"), { uid: "bob", role: "member" }), "membro so pelo servidor");
await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "tenants/acme/members/bob"), { uid: "bob", role: "member" }));
await assertFails(getDoc(doc(bob, "tenants/acme/sites/s1"))); // sem regra para "sites": ninguém lê pelo navegador
await assertFails(setDoc(doc(bob, "tenants/acme/members/mallory"), { uid: "mallory", role: "member" }));
await assertFails(updateDoc(doc(bob, "tenants/acme/members/bob"), { role: "admin" })); // auto-promoção
await assertFails(setDoc(doc(alice, "tenants/acme/members/bob"), { uid: "bob", role: "owner" }));
await assertFails(updateDoc(doc(alice, "tenants/acme/members/bob"), { role: "admin" }));
await assertFails(deleteDoc(doc(alice, "tenants/acme/members/bob")));
await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), "tenants/acme/members/bob"), { role: "admin" }));
await assertFails(updateDoc(doc(bob, "tenants/acme/members/alice"), { role: "member" })); // admin não rebaixa owner
await assertFails(updateDoc(doc(bob, "tenants/acme"), { ownerId: "bob" }));

// Meus tenants
await assertSucceeds(getDocs(query(collectionGroup(bob, "members"), where("uid", "==", "bob"))));
await assertFails(getDocs(collectionGroup(mallory, "members")));

// Tenant não pode ser apagado pelo app (slug seria recriado por outro com os dados antigos)
await assertFails(deleteDoc(doc(alice, "tenants/acme")));
// Subcoleções aninhadas: nem "members" falso nem nada abaixo de um nível
await assertFails(setDoc(doc(bob, "tenants/acme/services/evil/members/carol"), { uid: "carol", role: "owner" }));
await assertFails(setDoc(doc(bob, "tenants/acme/services/s1/qualquer/x"), { a: 1 }));
await assertSucceeds(setDoc(doc(bob, "tenants/acme/services/s1"), { name: "Corte" }));
// Registro de histórico sozinho, sem a mudança no agendamento
await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "tenants/acme/appointments/solo"), { status: "booked" }));
await assertFails(setDoc(doc(bob, "tenants/acme/history/h-solo"), { appointmentId: "solo", type: "confirmed", at: serverTimestamp(), by: "bob", byName: "bob@teste.dev" }));

// Agendamentos + histórico (criados pelo servidor; aqui simulados sem regras)
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "tenants/acme/appointments/a1"), { status: "booked", start: new Date(), customerName: "X" });
  await setDoc(doc(db, "tenants/acme/history/old"), { appointmentId: "a1", type: "created", by: "cliente" });
});
function changeStatus(db, uid, status, { apptId = "a1", type = status, byName = `${uid}@teste.dev`, extra = {}, apptExtra = {}, reuse } = {}) {
  const h = reuse ? doc(db, "tenants/acme/history", reuse) : doc(collection(db, "tenants/acme/history"));
  const b = writeBatch(db);
  b.set(h, { appointmentId: apptId, type, at: serverTimestamp(), by: uid, byName, ...extra });
  b.update(doc(db, "tenants/acme/appointments", apptId), { status, lastHistoryId: h.id, ...apptExtra });
  return b.commit();
}
await assertFails(updateDoc(doc(bob, "tenants/acme/appointments/a1"), { status: "confirmed" })); // sem histórico
await assertFails(changeStatus(mallory, "mallory", "confirmed")); // não membro
await assertFails(changeStatus(bob, "bob", "confirmed", { type: "cancelled" })); // histórico mente o tipo
await assertFails(changeStatus(bob, "bob", "confirmed", { byName: "alice@teste.dev" })); // se passa por outro
await assertFails(changeStatus(bob, "bob", "confirmed", { reuse: "old" })); // reaproveita registro existente
await assertFails(updateDoc(doc(bob, "tenants/acme/appointments/a1"), { status: "cancelled", lastHistoryId: "old" })); // aponta para registro antigo
await assertFails(changeStatus(bob, "bob", "confirmed", { apptExtra: { start: new Date(0) } })); // muda horário pelo cliente
await assertFails(changeStatus(bob, "bob", "confirmed", { extra: { note: "x" } })); // campo extra
await assertFails(changeStatus(bob, "bob", "booked")); // status inválido
await assertSucceeds(changeStatus(bob, "bob", "confirmed"));
await assertSucceeds(changeStatus(alice, "alice", "no_show"));
await assertFails(changeStatus(alice, "alice", "confirmed")); // falta é final no painel
await assertFails(updateDoc(doc(alice, "tenants/acme/history/old"), { type: "x" }));
// Conta da equipe presa a um profissional: muda só o status dos horários dele
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "tenants/acme/members/dani"), { uid: "dani", role: "member", staffId: "ana" });
  await setDoc(doc(db, "tenants/acme/appointments/da-ana"), { status: "booked", staffId: "ana", start: new Date(), customerName: "Y" });
  await setDoc(doc(db, "tenants/acme/appointments/da-bia"), { status: "booked", staffId: "bia", start: new Date(), customerName: "Z" });
});
const dani = as("dani");
await assertFails(changeStatus(dani, "dani", "cancelled", { apptId: "da-bia" })); // horário de outro profissional
await assertSucceeds(changeStatus(dani, "dani", "confirmed", { apptId: "da-ana" }));
await assertSucceeds(changeStatus(bob, "bob", "cancelled", { apptId: "da-bia" })); // quem gere muda qualquer um
// recebido no Caixa: não cancela nem vira falta (o dinheiro ficaria contando); confirmar ainda pode
await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "tenants/acme/appointments/pago"), { status: "booked", start: new Date(), customerName: "W" });
  await setDoc(doc(db, "tenants/acme/lancamentos/ag-pago"), { tipo: "entrada", valorCents: 1000 });
});
await assertFails(changeStatus(bob, "bob", "cancelled", { apptId: "pago" }));
await assertFails(changeStatus(bob, "bob", "no_show", { apptId: "pago" }));
await assertSucceeds(changeStatus(bob, "bob", "confirmed", { apptId: "pago" }));
await assertFails(deleteDoc(doc(alice, "tenants/acme/history/old")));
await assertFails(deleteDoc(doc(alice, "tenants/acme/appointments/a1")));
await assertFails(setDoc(doc(alice, "tenants/acme/appointments/novo"), { status: "booked" })); // só o servidor cria
await assertSucceeds(getDocs(query(collection(bob, "tenants/acme/history"), where("appointmentId", "==", "a1"))));
await assertFails(getDocs(query(collection(mallory, "tenants/acme/history"), where("appointmentId", "==", "a1"))));

// Clientes e planos: membros leem, ninguém grava pelo app
await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "tenants/acme/customers/5511912345678"), { name: "X" }));
await assertSucceeds(getDoc(doc(bob, "tenants/acme/customers/5511912345678")));
await assertFails(getDoc(doc(mallory, "tenants/acme/customers/5511912345678")));
await assertFails(setDoc(doc(alice, "tenants/acme/customers/5511912345678"), { name: "Y" }));
await assertFails(setDoc(doc(alice, "tenants/acme/plans/p1"), { status: "active" }));
await assertSucceeds(getDocs(collection(bob, "tenants/acme/plans")));

// Storage: nada pelo cliente, nem para membro
const file = (uid, path) => ref(env.authenticatedContext(uid).storage(), path);
const imagem = { contentType: "image/png" };
await assertFails(uploadBytes(file("bob", "tenants/acme/logo.png"), new Uint8Array(10), imagem));
await assertFails(getBytes(file("alice", "tenants/acme/logo.png")));
await assertFails(getBytes(ref(env.unauthenticatedContext().storage(), "tenants/acme/logo.png")));

// Clientes: o que o dono escreve sobre o cliente e dele; nome e telefone nao
await env.withSecurityRulesDisabled((ctx) =>
  setDoc(doc(ctx.firestore(), "tenants/acme/customers/5511999990000"), { name: "Ana", phone: "(11) 99999-0000" }),
);
const cliente = (db) => doc(db, "tenants/acme/customers/5511999990000");

await assertSucceeds(updateDoc(cliente(alice), { semCampanha: true, etiquetas: ["vip", "manha"] }));
await assertFails(updateDoc(cliente(alice), { name: "Outro Nome" }));
await assertFails(updateDoc(cliente(alice), { phone: "(11) 90000-0000" }));
await assertFails(updateDoc(cliente(alice), { semCampanha: "sim" }));
await assertFails(updateDoc(cliente(alice), { etiquetas: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] }));
await assertFails(updateDoc(cliente(alice), { etiquetas: ["x".repeat(41)] }), "etiqueta longa");
await assertFails(updateDoc(cliente(alice), { etiquetas: ["ok", 5] }), "etiqueta não texto");
await assertFails(updateDoc(cliente(mallory), { etiquetas: ["invadido"] }));
// nascimento e e-mail são dado pessoal: só o servidor grava (dono/admin, validado)
await assertFails(updateDoc(cliente(alice), { email: "x@y.com" }));
await assertFails(updateDoc(cliente(alice), { nascimento: "1990-01-01" }));
await assertFails(getDoc(cliente(mallory)));

const notas = (db) => collection(db, "tenants/acme/customers/5511999990000/notas");
const nota = (extra = {}) => ({
  texto: "Alergica a acetona. Prefere manha.",
  quando: serverTimestamp(),
  por: "alice",
  porNome: "alice@teste.dev",
  ...extra,
});
await assertSucceeds(setDoc(doc(notas(alice), "n1"), nota()));
await assertFails(setDoc(doc(notas(alice), "n2"), nota({ por: "bob" })), "nao da para assinar no lugar de outro");
await assertFails(setDoc(doc(notas(alice), "n3"), nota({ porNome: "outro@teste.dev" })));
// e-mail sem confirmar não vale como autor: grava, mas sem o nome (o painel manda null)
const aliceNova = semConfirmar("alice");
await assertFails(setDoc(doc(notas(aliceNova), "n3b"), nota()), "e-mail sem confirmar como autor");
await assertSucceeds(setDoc(doc(notas(aliceNova), "n3c"), nota({ porNome: null })));
await assertFails(setDoc(doc(notas(alice), "n4"), nota({ quando: new Date(0) })), "a data e a do servidor");
await assertFails(setDoc(doc(notas(alice), "n5"), nota({ texto: "" })));
await assertFails(setDoc(doc(notas(alice), "n6"), nota({ texto: "x".repeat(601) })));
await assertFails(setDoc(doc(notas(alice), "n7"), nota({ extra: "campo a mais" })));
await assertFails(updateDoc(doc(notas(alice), "n1"), { texto: "reescrito" }), "anotacao nao se reescreve");
await assertSucceeds(deleteDoc(doc(notas(alice), "n1")));
await assertFails(getDocs(notas(mallory)));

// O doc do negócio só muda pelo servidor: nem o dono grava site.*, gerado.*, whatsapp.* ou o limite
await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "tenants/acme"), { name: "acme", ownerId: "alice", limiteStaff: 5 }));
await assertFails(setDoc(doc(alice, "tenants/acme"), { name: "Acme Salão", ownerId: "alice", limiteStaff: 5 }));
await assertFails(setDoc(doc(alice, "tenants/acme"), { name: "Acme Salão", ownerId: "alice", limiteStaff: 50 }));
await assertFails(updateDoc(doc(alice, "tenants/acme"), { "site.phone": '55"><img src=x onerror=alert(1)>' }));
await assertFails(updateDoc(doc(alice, "tenants/acme"), { "whatsapp.instanceId": "outro" }));

// Profissional novo só pelo servidor (é lá que o limite do plano é contado)
await assertFails(setDoc(doc(alice, "tenants/acme/staff/novo"), { name: "Bia", active: true }));
await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "tenants/acme/staff/bia"), { name: "Bia", active: true }));
await assertSucceeds(setDoc(doc(alice, "tenants/acme/staff/bia"), { name: "Bia Souza", active: true }));
await assertFails(deleteDoc(doc(alice, "tenants/acme/staff/bia")), "excluir profissional e pelo servidor: leva junto o acesso dele");
await assertFails(setDoc(doc(alice, "tenants/acme/staff/bia"), { name: "x".repeat(81), active: true }), "nome longo");
await assertFails(updateDoc(doc(alice, "tenants/acme/staff/bia"), { lixo: "a" }), "campo fora da lista");

// Coleção que ninguém liberou nasce negada (antes o coringa abria tudo)
await assertFails(setDoc(doc(alice, "tenants/acme/inventada/x"), { a: 1 }));
await assertFails(getDoc(doc(alice, "tenants/acme/inventada/x")));

// "viaConvite" é do servidor: sem isto dá para queimar a cota de outra conta
await assertFails(setDoc(doc(alice, "tenants/acme/members/vitima"), { uid: "vitima", role: "admin", viaConvite: true }));

// Caixa incluído: só quem gere lê, mesmo com o campo legado desligado, e ninguém grava pelo app
await env.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), "tenants/acme/members/carla"), { uid: "carla", role: "member" });
  await setDoc(doc(ctx.firestore(), "tenants/acme/lancamentos/l1"), { tipo: "entrada", valorCents: 5000, mes: "2026-10" });
});
const carla = as("carla");
const lanc = (db) => doc(db, "tenants/acme/lancamentos/l1");
await assertSucceeds(getDoc(lanc(alice)), "campo legado desligado nao bloqueia o dono");
await env.withSecurityRulesDisabled((ctx) => updateDoc(doc(ctx.firestore(), "tenants/acme"), { "modulos.financeiro": true }));
await assertSucceeds(getDoc(lanc(alice)));
await assertSucceeds(getDoc(lanc(bob)), "admin do negocio le");
await assertSucceeds(getDoc(lanc(suporte)), "admin da plataforma le");
await assertFails(getDoc(lanc(carla)), "funcionario nao ve dinheiro");
await assertFails(getDoc(lanc(mallory)));
await assertFails(setDoc(doc(alice, "tenants/acme/lancamentos/l2"), { tipo: "entrada", valorCents: 1, mes: "2026-10" }), "so o servidor grava");
await assertFails(updateDoc(lanc(alice), { valorCents: 1 }));
await assertFails(deleteDoc(lanc(alice)));
await assertFails(updateDoc(doc(alice, "tenants/acme"), { "modulos.financeiro": false }), "o dono nao liga nem desliga o modulo");
// contas fixas e comissões: a mesma porta dos lançamentos
const cfg = (db) => doc(db, "tenants/acme/caixa/config");
await assertSucceeds(getDoc(cfg(alice)));
await assertFails(getDoc(cfg(carla)), "funcionario nao ve a comissao");
await assertFails(setDoc(cfg(alice), { fixas: [], comissoes: {} }), "so o servidor grava");
// consumo de mensagens: só quem gere lê; ninguém grava pelo app
await env.withSecurityRulesDisabled(async (ctx) => {
  await setDoc(doc(ctx.firestore(), "tenants/acme/envios/m1"), { canal: "whatsapp", status: "aceito", custoCents: 5 });
  await setDoc(doc(ctx.firestore(), "tenants/acme/consumo/2026-11"), { total: 1, custoCents: 5 });
  await setDoc(doc(ctx.firestore(), "tenants/acme/creditos/recarga:c1"), { tipo: "recarga", valorCents: 2000, saldoAposCents: 2000 });
  await setDoc(doc(ctx.firestore(), "tenants/acme/privado/mensagens"), { saldoCents: 2000 });
  await setDoc(doc(ctx.firestore(), "config/mensagens"), { whatsappUtilityCents: 5, whatsappServiceCents: 0, smsCents: 12 });
});
for (const caminho of ["tenants/acme/envios/m1", "tenants/acme/consumo/2026-11", "tenants/acme/creditos/recarga:c1"]) {
  await assertSucceeds(getDoc(doc(alice, caminho)), `dono le ${caminho}`);
  await assertSucceeds(getDoc(doc(bob, caminho)), `admin do negocio le ${caminho}`);
  await assertSucceeds(getDoc(doc(suporte, caminho)), `admin da plataforma le ${caminho}`);
  await assertFails(getDoc(doc(carla, caminho)), `funcionario nao le ${caminho}`);
  await assertFails(getDoc(doc(mallory, caminho)));
  await assertFails(setDoc(doc(alice, caminho), { custoCents: 0 }), "so o servidor grava");
  await assertFails(setDoc(doc(suporte, caminho), { custoCents: 0 }), "nem o admin grava pelo app");
}
await assertSucceeds(getDoc(doc(suporte, "config/mensagens")), "admin da plataforma le o preco");
await assertFails(getDoc(doc(alice, "config/mensagens")), "o dono nao le config");
await assertFails(setDoc(doc(suporte, "config/mensagens"), { smsCents: 0 }), "preco so pelo servidor");
await assertFails(getDoc(doc(alice, "tenants/acme/privado/mensagens")), "o saldo cru fica no privado: o dono le pelo servidor");
await assertFails(setDoc(doc(alice, "tenants/acme/privado/mensagens"), { saldoCents: 999999 }), "ninguem se da saldo");

// Funcionário (convite da equipe): lê a agenda e o cadastro, não muda preço, equipe, site nem notas
await assertSucceeds(getDoc(doc(carla, "tenants/acme/services/s1")));
await assertFails(setDoc(doc(carla, "tenants/acme/services/s1"), { name: "Corte", priceCents: 1 }), "funcionario nao muda preco");
await assertFails(deleteDoc(doc(carla, "tenants/acme/services/s1")));
await assertFails(setDoc(doc(carla, "tenants/acme/services/novo"), { name: "Novo" }));
await assertSucceeds(getDoc(doc(carla, "tenants/acme/staff/bia")));
await assertFails(updateDoc(doc(carla, "tenants/acme/staff/bia"), { active: false }), "funcionario nao tira ninguem do link");
await assertFails(setDoc(doc(carla, "tenants/acme/sites/s1"), { title: "x" }));
await env.withSecurityRulesDisabled((ctx) => setDoc(doc(notas(ctx.firestore()), "n9"), nota()));
await assertFails(deleteDoc(doc(notas(carla), "n9")), "funcionario nao apaga anotacao do dono");
await assertSucceeds(getDoc(doc(carla, "tenants/acme/members/carla")), "le o proprio acesso");
await assertFails(getDoc(doc(carla, "tenants/acme/members/alice")), "a lista da equipe e de quem gere");
await assertSucceeds(getDoc(doc(alice, "tenants/acme/members/carla")));

// a credencial do gateway de WhatsApp fica num doc que só o servidor lê: nem o dono, nem a equipe
await env.withSecurityRulesDisabled((ctx) => setDoc(doc(ctx.firestore(), "tenants/acme/privado/whatsapp"), { atendysApiKey: "k", atendysWebhookSecret: "s" }));
await assertFails(getDoc(doc(alice, "tenants/acme/privado/whatsapp")), "o dono não lê a credencial do gateway");
await assertFails(getDoc(doc(carla, "tenants/acme/privado/whatsapp")), "a equipe não lê a credencial do gateway");
await assertFails(setDoc(doc(alice, "tenants/acme/privado/whatsapp"), { atendysApiKey: "outra" }), "nem grava");

await env.cleanup();
console.log("rules ok");
