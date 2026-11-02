// Rode: npm run test:painel-indice  (índice do painel e GET /api/admin/painel no emulador)
import assert from "node:assert/strict";
import { adminDb as db } from "@/lib/admin";
import { criarIndice, espacoDe, IndiceIndisponivel } from "@/lib/painel-indice.server";
import { responderPainel } from "@/lib/painel-rota.server";
import type { RespostaPainel } from "@/lib/painel-tipos";

// Testes 5 e 6 do docs/plano-paginacao-admin.md (6.5).

const mudo = { info: () => {}, error: () => {} };
const ate = async (cond: () => boolean, msg: string) => {
  for (let i = 0; i < 100 && !cond(); i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(cond(), msg);
};
const hoje = new Date().toISOString().slice(0, 10);

// ---- limpeza de um tenant (6.3), sem banco
{
  const doc = (campos: Record<string, unknown>) => (c: string) => campos[c];
  const limpo = espacoDe("salao-a", doc({
    name: "  Salão\u0000 A‮ ", "site.phone": "(91) 98888-7777", "site.category": "HairSalon", "site.city": "Belém",
    "site.uf": "PA", "site.rating": 4.5, "site.reviews": 12, limiteStaff: 3, "modulos.financeiro": true,
  }), 2);
  assert.deepEqual(limpo, {
    corrigido: false,
    espaco: { slug: "salao-a", nome: "Salão A", telefone: "(91) 98888-7777", nicho: "Cabeleireiro", cidade: "Belém", uf: "PA", nota: 4.5, avaliacoes: 12, acessos: 2, limiteStaff: 3, caixa: true },
  });
  const sujo = espacoDe("sujo", doc({
    name: { x: 1 }, "site.phone": "ligar", "site.city": 42, "site.uf": "Pará", "site.rating": 50, "site.reviews": -3, limiteStaff: "9", "modulos.financeiro": "sim",
  }), 1);
  assert.equal(sujo.corrigido, true);
  assert.deepEqual(sujo.espaco, { slug: "sujo", nome: "sujo", telefone: null, nicho: "Outros", cidade: null, uf: null, nota: null, avaliacoes: null, acessos: 1, limiteStaff: espacoDe("x", () => undefined, 1).espaco.limiteStaff, caixa: false });
  assert.equal(espacoDe("vazio", () => undefined, 1).corrigido, false, "campo ausente não é correção");
  assert.equal(espacoDe("v", doc({ name: "   " }), 1).espaco.nome, "v", "nome vazio usa o slug");
  assert.equal(espacoDe("v", doc({ name: "x".repeat(500) }), 1).espaco.nome.length, 120);
  assert.equal(espacoDe("v", doc({ "site.uf": "pa" }), 1).espaco.uf, null, "UF fora das siglas");
}

// ---- base no emulador
const ADMIN = "admin-1";
const limpar = async () => {
  for (const c of ["tenants", "crm"]) {
    const docs = await db.collection(c).listDocuments();
    for (const d of docs) await db.recursiveDelete(d);
  }
};
await limpar();
await db.doc("config/admin").set({ uids: [ADMIN] });
const tenant = (slug: string, dados: Record<string, unknown>) => db.doc(`tenants/${slug}`).set(dados);
await tenant("ana-cabelos", { name: "Ana Cabelos", site: { phone: "91988887777", category: "HairSalon", city: "Belém", uf: "PA", rating: 4.8, reviews: 40 } });
await tenant("bia-unhas", { name: "Bia Unhas", site: { category: "NailSalon", city: "Belém", uf: "PA", rating: 4, reviews: 3 } });
await tenant("estranho", { name: 7, site: { rating: "cinco", uf: "XX" } });
await db.doc("tenants/ana-cabelos/members/" + ADMIN).set({ uid: ADMIN, role: "owner" });
await db.doc("tenants/bia-unhas/members/" + ADMIN).set({ uid: ADMIN, role: "owner" });
await db.doc("crm/ana-cabelos").set({ estagio: "negociando", mensalCents: 8990 });
await db.doc("crm/bia-unhas").set({ origem: "importado", notas: 2 }); // trivial

// ---- índice: montagem, mudanças ao vivo
const indice = criarIndice(db, { log: mudo });
assert.equal(indice.montado(), null, "nada montado antes da primeira consulta");
const [i1, i2] = await Promise.all([indice.pronto(), indice.pronto()]);
assert.equal(i1.montadoEm, i2.montadoEm, "chamadas juntas esperam a mesma montagem");
const porSlug = () => Object.fromEntries(indice.montado()!.lista().map((e) => [e.slug, e]));
assert.deepEqual(i1.lista().map((e) => e.slug), ["ana-cabelos", "bia-unhas", "estranho"], "ordenada por nome");
assert.equal(porSlug().estranho.nome, "estranho");
assert.equal(porSlug().estranho.uf, null);
assert.deepEqual(Object.keys(i1.crm), ["ana-cabelos"], "CRM trivial não entra");
assert.equal(porSlug()["ana-cabelos"].acessos, 1, "só a plataforma");
assert.deepEqual(i1.admins, [ADMIN]);

const lista1 = indice.montado()!.lista();
assert.equal(indice.montado()!.lista(), lista1, "mesmo array enquanto nada muda");

await tenant("caio-barba", { name: "Caio Barba", site: { category: "BarberShop" } });
await ate(() => !!porSlug()["caio-barba"], "negócio criado aparece");
assert.notEqual(indice.montado()!.lista(), lista1, "mudança gera array novo");
await db.doc("tenants/caio-barba").update({ name: "Caio Barbearia" });
await ate(() => porSlug()["caio-barba"]?.nome === "Caio Barbearia", "negócio alterado aparece");
await db.doc("tenants/caio-barba").delete();
await ate(() => !porSlug()["caio-barba"], "negócio apagado some");

await db.doc("crm/bia-unhas").set({ estagio: "oferta" }, { merge: true });
await ate(() => indice.montado()!.crm["bia-unhas"]?.estagio === "oferta", "CRM que deixa de ser trivial entra");
await db.doc("crm/bia-unhas").delete();
await ate(() => !indice.montado()!.crm["bia-unhas"], "CRM apagado sai");

// cliente entra: acessos = cliente + plataforma; sai: volta a 1
await db.doc("tenants/ana-cabelos/members/cliente-1").set({ uid: "cliente-1", role: "owner" });
await ate(() => porSlug()["ana-cabelos"].acessos === 2, "cliente que entra soma com a plataforma");
await db.doc("tenants/bia-unhas/members/equipe-1").set({ uid: "equipe-1", role: "member" });
await new Promise((r) => setTimeout(r, 300));
assert.equal(porSlug()["bia-unhas"].acessos, 1, "profissional da equipe não conta");
await db.doc("tenants/ana-cabelos/members/cliente-1").delete();
await ate(() => porSlug()["ana-cabelos"].acessos === 1, "cliente que sai some dos acessos");

// conta da plataforma muda: troca atômica, o velho responde até o novo ficar pronto
const antes = indice.montado()!;
await db.doc("config/admin").set({ uids: [ADMIN, "admin-2"] });
assert.ok(indice.montado(), "durante a remontagem ainda há índice");
await ate(() => indice.montado()!.montadoEm !== antes.montadoEm, "remontado com as contas novas");
assert.deepEqual(indice.montado()!.admins, [ADMIN, "admin-2"]);
assert.equal(indice.montado()!.lista().length, 3, "o novo veio inteiro");

// revogação chega pelo listener (a rota usa esta cópia)
await db.doc("config/admin").update({ revogados: { [ADMIN]: Date.now() + 60_000 } });
await ate(() => !!(indice.montado()!.revogados as Record<string, number> | undefined)?.[ADMIN], "revogação na cópia");
await db.doc("config/admin").set({ uids: [ADMIN, "admin-2"] });
await ate(() => !indice.montado()!.revogados, "revogação desfeita");

indice.soltar();
assert.equal(indice.montado(), null, "solto");

// ociosidade
{
  const curto = criarIndice(db, { ociosoMs: 200, log: mudo });
  await curto.pronto();
  assert.ok(curto.montado());
  await ate(() => curto.montado() === null, "solto depois de ocioso");
}

// o banco com config/admin trocado; o resto (e o que o SDK chama por dentro) é o de verdade
const trocarConfig = (trocar: (ref: FirebaseFirestore.DocumentReference) => object) =>
  new Proxy(db, {
    get: (alvo, p) => {
      if (p === "doc") return (c: string) => (c === "config/admin" ? trocar(alvo.doc(c)) : alvo.doc(c));
      const v = Reflect.get(alvo, p);
      return typeof v === "function" ? v.bind(alvo) : v;
    },
  });

// montagem que falha: espera crescente antes de tentar de novo (sem reler 30 mil a cada consulta)
{
  const quebrado = trocarConfig((ref) => ({ ...ref, onSnapshot: (_: unknown, erro: (e: Error) => void) => (setTimeout(() => erro(new Error("sem rede"))), () => {}) }));
  const ruim = criarIndice(quebrado, { log: mudo });
  await assert.rejects(ruim.pronto(), /sem rede/);
  await assert.rejects(ruim.pronto(), IndiceIndisponivel, "segunda tentativa logo em seguida é recusada");
}

// listener que cai depois de montado solta o índice; a próxima consulta monta de novo
{
  let derrubar: (e: Error) => void = () => {};
  const instavel = trocarConfig((ref) => ({ onSnapshot: (ok: never, erro: (e: Error) => void) => ((derrubar = erro), ref.onSnapshot(ok, erro)) }));
  const ind = criarIndice(instavel, { log: mudo });
  await ind.pronto();
  derrubar(new Error("permissão"));
  assert.equal(ind.montado(), null, "listener caído solta o índice");
  assert.ok((await ind.pronto()).lista().length, "e a próxima consulta monta de novo");
  ind.soltar();
}

// ---- rota (teste 6)
{
  const indiceRota = criarIndice(db, { log: mudo });
  const verificar = async (token: string) => {
    if (token === "admin") return { uid: ADMIN, authTimeMs: Date.now() };
    if (token === "dono") return { uid: "dono-1", authTimeMs: Date.now() };
    throw new Error("token inválido");
  };
  const pedir = async (query: string, token?: string, esperaMs?: number) => {
    const res = await responderPainel(
      new Request(`http://x/api/admin/painel?${query}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }),
      { db, indice: indiceRota, verificar, esperaMs },
    );
    assert.equal(res.headers.get("cache-control"), "no-store, private", "nunca em cache");
    return { status: res.status, corpo: (await res.json()) as RespostaPainel, res };
  };
  const q = `hoje=${hoje}`;

  assert.equal((await pedir(q)).status, 401, "sem token");
  assert.equal((await pedir(q, "lixo")).status, 401, "token inválido");
  const semPermissao = await pedir(q, "dono");
  assert.equal(semPermissao.status, 403);
  assert.deepEqual(semPermissao.corpo, { ok: false, codigo: "restrito", erro: "Área restrita." });
  assert.equal(indiceRota.montado(), null, "quem não é admin não monta o índice");

  const ruim = await pedir(`${q}&n=0`, "admin");
  assert.equal(ruim.status, 400);
  assert.ok(!ruim.corpo.ok && ruim.corpo.codigo === "invalido" && /n/.test(ruim.corpo.erro));
  assert.equal((await pedir(`${q}&outro=1`, "admin")).status, 400, "parâmetro desconhecido");
  assert.equal((await pedir("", "admin")).status, 400, "sem hoje");

  const montando = await pedir(q, "admin", 0);
  assert.equal(montando.status, 503, "índice montando");
  assert.equal(montando.res.headers.get("retry-after"), "2");

  const ok = await pedir(`${q}&n=1&ordem=nome`, "admin");
  assert.equal(ok.status, 200);
  assert.ok(ok.corpo.ok);
  if (ok.corpo.ok) {
    assert.deepEqual(ok.corpo.itens.map((e) => e.slug), ["ana-cabelos"], "só a página pedida");
    assert.equal(ok.corpo.total, 3);
    assert.deepEqual(Object.keys(ok.corpo.crm), ["ana-cabelos"], "CRM só da página");
    assert.deepEqual(ok.corpo.contagens.ufs, [["PA", 2]]);
    assert.equal(ok.corpo.contagens.estagios.negociando, 1);
    assert.ok(ok.corpo.contagens.avisos.every((a) => typeof a.total === "number" && !("slugs" in a)), "alertas sem a lista de slugs");
    assert.ok(Date.parse(ok.corpo.montadoEm) > 0);
  }
  const filtrado = await pedir(`${q}&uf=PA&busca=bia`, "admin");
  assert.ok(filtrado.corpo.ok && filtrado.corpo.total === 1 && filtrado.corpo.itens[0].slug === "bia-unhas");

  // com o índice montado, a permissão vem da cópia: revogar chega sem reler config/admin
  await db.doc("config/admin").update({ revogados: { [ADMIN]: Date.now() + 60_000 } });
  await ate(() => !!indiceRota.montado()?.revogados, "revogação no índice da rota");
  const revogado = await pedir(q, "admin");
  assert.equal(revogado.status, 403);
  assert.ok(!revogado.corpo.ok && /encerrada/.test(revogado.corpo.erro));
  indiceRota.soltar();
}

await limpar();
console.log("painel-indice: ok");
process.exit(0);
