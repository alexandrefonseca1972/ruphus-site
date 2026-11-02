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
// já com cliente antes de montar: com a plataforma junto (2) e sozinho, por cadastro no site (1)
await db.doc("tenants/dani-spa/members/cliente-0").set({ uid: "cliente-0", role: "owner" });
await db.doc("tenants/dani-spa/members/" + ADMIN).set({ uid: ADMIN, role: "owner" });
await tenant("dani-spa", { name: "Dani Spa", site: { category: "DaySpa" } });
await db.doc("tenants/eva-nails/members/cliente-9").set({ uid: "cliente-9", role: "owner" });
await tenant("eva-nails", { name: "Eva Nails", site: { category: "NailSalon" } });

// ---- índice: montagem, mudanças ao vivo
const indice = criarIndice(db, { log: mudo });
assert.equal(indice.montado(), null, "nada montado antes da primeira consulta");
const [i1, i2] = await Promise.all([indice.pronto(), indice.pronto()]);
assert.equal(i1.montadoEm, i2.montadoEm, "chamadas juntas esperam a mesma montagem");
const porSlug = () => Object.fromEntries(indice.montado()!.lista().map((e) => [e.slug, e]));
assert.deepEqual(i1.lista().map((e) => e.slug), ["ana-cabelos", "bia-unhas", "dani-spa", "estranho", "eva-nails"], "ordenada por nome");
assert.equal(porSlug()["dani-spa"].acessos, 2, "cliente da montagem + plataforma");
assert.equal(porSlug()["eva-nails"].acessos, 1, "cliente sem a plataforma no espaço");
assert.equal(porSlug().estranho.nome, "estranho");
assert.equal(porSlug().estranho.uf, null);
assert.deepEqual(Object.keys(i1.crm), ["ana-cabelos"], "CRM trivial não entra");
assert.equal(porSlug()["ana-cabelos"].acessos, 1, "só a plataforma");
assert.deepEqual(i1.admins, [ADMIN]);

const lista1 = indice.montado()!.lista();
assert.equal(indice.montado()!.lista(), lista1, "mesmo array enquanto nada muda");
{
  const v = indice.montado()!.versao;
  await db.doc("crm/estranho").set({ estagio: "oferta" });
  await ate(() => indice.montado()!.versao > v, "mudança no CRM muda a versão");
  assert.equal(indice.montado()!.lista(), lista1, "mas não refaz a lista (nem a ordenação)");
  await db.doc("crm/estranho").delete();
}

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
assert.equal(indice.montado()!.lista().length, 5, "o novo veio inteiro");

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

// o banco com config/admin ou tenants trocados; o resto (e o que o SDK chama por dentro) é o de verdade
type Ref = { onSnapshot: (ok: never, erro: (e: Error) => void) => () => void };
const bancoCom = ({ config, tenants }: { config?: (ref: Ref) => object; tenants?: (ref: Ref) => object }) =>
  new Proxy(db, {
    get: (alvo, p) => {
      if (p === "doc") return (c: string) => (c === "config/admin" && config ? config(alvo.doc(c) as unknown as Ref) : alvo.doc(c));
      if (p === "collection") return (c: string) => (c === "tenants" && tenants ? tenants(alvo.collection(c) as unknown as Ref) : alvo.collection(c));
      const v = Reflect.get(alvo, p);
      return typeof v === "function" ? v.bind(alvo) : v;
    },
  });
const trocarConfig = (config: (ref: Ref) => object) => bancoCom({ config });

// montagem que falha: espera crescente antes de tentar de novo (sem reler 30 mil a cada consulta)
{
  const quebrado = trocarConfig((ref) => ({ ...ref, onSnapshot: (_: unknown, erro: (e: Error) => void) => (setTimeout(() => erro(new Error("sem rede"))), () => {}) }));
  const ruim = criarIndice(quebrado, { log: mudo });
  await assert.rejects(ruim.pronto(), /sem rede/);
  await assert.rejects(ruim.pronto(), IndiceIndisponivel, "segunda tentativa logo em seguida é recusada");
  await new Promise((r) => setTimeout(r, 1100));
  await assert.rejects(ruim.pronto(), /sem rede/, "passada a espera, tenta de novo");
}

// listener que cai no meio da montagem: a montagem falha (não fica pendurada para sempre)
{
  const silencio = (): Ref => ({ onSnapshot: () => () => {} }); // tenants nunca responde
  const cai = bancoCom({
    config: (ref) => ({ onSnapshot: (ok: never, erro: (e: Error) => void) => (setTimeout(() => erro(new Error("caiu")), 100), ref.onSnapshot(ok, erro)) }),
    tenants: silencio,
  });
  await assert.rejects(criarIndice(cai, { log: mudo }).pronto(), /solto durante a montagem/, "listener caído aborta a montagem");
  // primeira resposta que nunca chega: o prazo aborta
  await assert.rejects(criarIndice(bancoCom({ tenants: silencio }), { log: mudo, prazoMs: 300 }).pronto(), /passou de/);
}

// troca de índice sem deixar listener órfão
{
  let vivos = 0;
  const contando = bancoCom({
    tenants: (ref) => ({
      onSnapshot: (ok: never, erro: (e: Error) => void) => {
        vivos++;
        // cada resposta 300 ms depois: a montagem demora o bastante para ser interrompida no meio
        const devagar = ((snap: unknown) => setTimeout(() => (ok as (s: unknown) => void)(snap), 300)) as never;
        const soltar = ref.onSnapshot(devagar, erro);
        return () => (vivos--, soltar());
      },
    }),
  });
  const ind = criarIndice(contando, { log: mudo });
  await ind.pronto();
  assert.equal(vivos, 1);
  const antes = ind.montado()!.montadoEm;
  await db.doc("config/admin").set({ uids: [ADMIN, "admin-3"] });
  await ate(() => ind.montado()?.montadoEm !== antes && vivos === 1, "trocado, e o velho soltou os listeners");
  // o velho é solto enquanto o novo monta: o novo não tem quem o use e não pode ficar ouvindo
  await db.doc("config/admin").set({ uids: [ADMIN] });
  await ate(() => vivos === 2, "nova montagem começou");
  ind.soltar();
  await ate(() => vivos === 0, "nenhum listener órfão");
  assert.equal(ind.montado(), null);
}

// escrita do próprio processo (R9): atualizar aplica antes de o listener chegar
{
  const devagar = bancoCom({
    tenants: (ref) => ({
      onSnapshot: (ok: never, erro: (e: Error) => void) =>
        ref.onSnapshot(((snap: unknown) => setTimeout(() => (ok as (s: unknown) => void)(snap), 1000)) as never, erro),
    }),
  });
  const ind = criarIndice(devagar, { log: mudo });
  await ind.atualizar(["ana-cabelos"]); // sem índice montado: não faz nada (nem lê)
  await ind.pronto();
  await db.doc("tenants/ana-cabelos").update({ name: "Ana Cabelos Nova" });
  await db.doc("crm/ana-cabelos").update({ estagio: "oferta" });
  await ind.atualizar(["ana-cabelos", "nao-existe"]);
  const agora = ind.montado()!;
  assert.equal(agora.lista().find((e) => e.slug === "ana-cabelos")?.nome, "Ana Cabelos Nova", "nome novo antes do listener");
  assert.equal(agora.crm["ana-cabelos"]?.estagio, "oferta", "CRM novo antes do listener");
  assert.ok(!agora.lista().some((e) => e.slug === "nao-existe"), "negócio que não existe não entra");
  await db.doc("tenants/ana-cabelos").update({ name: "Ana Cabelos" });
  await db.doc("crm/ana-cabelos").update({ estagio: "negociando" });
  await ind.atualizar(["ana-cabelos"]);
  ind.soltar();
}

// contas mudam durante a montagem: o not-in velho não fica valendo
{
  const ind = criarIndice(db, { log: mudo });
  const montagem = ind.pronto();
  await db.doc("config/admin").set({ uids: [ADMIN, "cliente-0"] }); // o cliente de dani-spa vira da plataforma
  await montagem;
  const dani = () => ind.montado()?.lista().find((e) => e.slug === "dani-spa")?.acessos;
  await ate(() => dani() === 1, "cliente que virou conta da plataforma não conta mais como cliente");
  await db.doc("config/admin").set({ uids: [ADMIN] });
  await ate(() => dani() === 2, "e volta a contar");
  ind.soltar();
}

// sem contas da plataforma (sem not-in): conta todos os membros que gerem, como antes
{
  await db.doc("config/admin").set({ uids: [] });
  const ind = criarIndice(db, { log: mudo });
  const acessos = Object.fromEntries((await ind.pronto()).lista().map((e) => [e.slug, e.acessos]));
  assert.deepEqual([acessos["ana-cabelos"], acessos["dani-spa"], acessos["eva-nails"], acessos.estranho], [1, 2, 1, 0]);
  ind.soltar();
  await db.doc("config/admin").set({ uids: [ADMIN] });
}

// listener que cai depois de montado solta o índice; a próxima consulta monta de novo
{
  let derrubar: (e: Error) => void = () => {};
  const instavel = trocarConfig((ref) => ({ onSnapshot: (ok: never, erro: (e: Error) => void) => ((derrubar = erro), ref.onSnapshot(ok, erro)) }));
  const ind = criarIndice(instavel, { log: mudo });
  await ind.pronto();
  derrubar(new Error("permissão"));
  assert.equal(ind.montado(), null, "listener caído solta o índice");
  await assert.rejects(ind.pronto(), IndiceIndisponivel, "caiu logo depois de montado: espera antes de remontar");
  await new Promise((r) => setTimeout(r, 1100));
  assert.ok((await ind.pronto()).lista().length, "passada a espera, a próxima consulta monta de novo");
  ind.soltar();
}

// ---- rota (teste 6)
{
  const indiceRota = criarIndice(db, { log: mudo });
  const verificar = async (token: string) => {
    if (token === "admin") return { uid: ADMIN, authTimeMs: Date.now() };
    if (token === "dono") return { uid: "dono-1", authTimeMs: Date.now() };
    if (token === "rede") throw new TypeError("fetch failed");
    if (token === "google") throw new (await import("jose")).errors.JOSEError("Expected 200 OK from the JSON Web Key Set HTTP response");
    if (token === "vencido") throw new (await import("jose")).errors.JWTExpired("exp", {});
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
  assert.equal((await pedir(q, "rede")).status, 500, "sem as chaves do Google não é sessão expirada");
  assert.equal((await pedir(q, "google")).status, 500, "Google fora do 200 também não");
  assert.equal((await pedir(q, "vencido")).status, 401, "token vencido é sessão expirada");
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
    assert.equal(ok.corpo.total, 5);
    assert.deepEqual(Object.keys(ok.corpo.crm), ["ana-cabelos"], "CRM só da página");
    assert.deepEqual(ok.corpo.contagens.ufs, [["PA", 2]]);
    assert.equal(ok.corpo.contagens.estagios.negociando, 1);
    assert.ok(ok.corpo.contagens.avisos.every((a) => typeof a.total === "number" && !("slugs" in a)), "alertas sem a lista de slugs");
    assert.ok(Date.parse(ok.corpo.montadoEm) > 0);
  }
  const comFunil = await pedir(`${q}&funil=1&periodo=tudo&novos=1`, "admin");
  assert.ok(comFunil.corpo.ok && comFunil.corpo.funil, "funil=1 traz o resumo");
  if (comFunil.corpo.ok && comFunil.corpo.funil) {
    const f = comFunil.corpo.funil;
    assert.equal(f.colunas.negociando.total, 1);
    assert.equal(f.colunas.novo.cartoes.length, 1, "novos=1: um cartão em Novo");
    assert.ok(f.colunas.novo.total >= 3);
    assert.ok(comFunil.corpo.crm["ana-cabelos"], "o CRM dos cartões vai junto");
  }
  const semFunil = (await pedir(`${q}&n=1`, "admin")).corpo;
  assert.ok(semFunil.ok && semFunil.funil === undefined, "sem funil=1, sem resumo");
  assert.equal((await pedir(`${q}&funil=1&periodo=ano`, "admin")).status, 400);
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
