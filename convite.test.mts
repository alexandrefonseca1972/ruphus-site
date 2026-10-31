// Rode: npm run test:convite  (uso único do link de convite, no emulador do Firestore)
import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { SignJWT } from "jose";
import { assumirNegocio, consumirConvite, conviteAbrePara, criarConvite, lerConvite, entrarNaEquipe, revogarConvitesDaEquipe, revogarConvitesDoNegocio, tirarAcessosDoProfissional } from "@/lib/convite";

const db = getFirestore(initializeApp({ projectId: "demo-siteflow" }));

const token = await criarConvite(db, "acme", "dona@acme.com");
const convite = await lerConvite(db, token);
assert.equal(convite?.tenantId, "acme");
assert.ok(convite?.jti, "sem jti não há como queimar o link");

// O dono entra; o mesmo link repassado a outra pessoa não entra
assert.equal(await consumirConvite(db, convite!.jti, "dona"), true);
assert.equal(await consumirConvite(db, convite!.jti, "estranho"), false);

// Link adulterado ou que não é um JWT
assert.equal(await lerConvite(db, "nao-e-um-jwt"), null);
// Trocar o ULTIMO caractere nao serve: em base64url ele carrega bits de
// padding, e varios caracteres diferentes decodificam para os mesmos bytes —
// as vezes a "adulteracao" nao muda assinatura nenhuma e o teste passa por
// sorte. O primeiro caractere do segmento cai em fronteira de byte e sempre
// muda o conteudo.
const [cabecalho, corpo, assinatura] = token.split(".");
const adulterado = `${cabecalho}.${corpo}.${assinatura[0] === "A" ? "B" : "A"}${assinatura.slice(1)}`;
assert.notEqual(adulterado, token);
assert.equal(await lerConvite(db, adulterado), null, "assinatura quebrada");

// Links do formato antigo, sem jti, deixam de valer: são justamente os que
// circulam por aí sem uso único
const secret = (await db.doc("config/convite").get()).get("secret") as string;
const antigo = await new SignJWT({ t: "acme" })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("30d")
  .sign(new TextEncoder().encode(secret));
assert.equal(await lerConvite(db, antigo), null, "convite sem uso único não vale mais");

// ————— Convite preso a um e-mail —————

// O e-mail entra normalizado: quem cadastrou "Dona@Salao.com" e quem entra com
// "dona@salao.com" são a mesma pessoa
const presoToken = await criarConvite(db, "salao", "Dona@Salao.com");
const preso = await lerConvite(db, presoToken);
assert.equal(preso?.email, "dona@salao.com", "o e-mail viaja normalizado no token");
assert.equal(preso?.tenantId, "salao");

// Sem destinatário não existe convite: assinar sem e-mail é erro, não link aberto
await assert.rejects(() => criarConvite(db, "salao", ""), /e-mail do dono/i, "e-mail vazio não gera link");

// E um token assinado sem destinatário não vale — mesmo tratamento dos links
// antigos sem jti: é justamente o formato que abre para quem chegar primeiro
const semDestino = await new SignJWT({ t: "salao" })
  .setProtectedHeader({ alg: "HS256" })
  .setJti("abc123")
  .setIssuedAt()
  .setExpirationTime("7d")
  .sign(new TextEncoder().encode(secret));
assert.equal(await lerConvite(db, semDestino), null, "convite sem destinatário não vale mais");

// Trocar o destinatário exige assinar de novo: ele não está na URL
const [cab2, corpo2, ass2] = presoToken.split(".");
const outroCorpo = Buffer.from(
  JSON.stringify({ ...JSON.parse(Buffer.from(corpo2, "base64url").toString()), e: "ladrao@x.com" }),
).toString("base64url");
assert.equal(await lerConvite(db, `${cab2}.${outroCorpo}.${ass2}`), null, "trocar o e-mail quebra a assinatura");

// ————— Quem o convite preso deixa entrar —————

const dona = { email: "dona@salao.com" };
const ok = (c: string, u: { email?: string; emailPendente?: string }) => conviteAbrePara({ email: c }, u).ok;

// preso: só a dona, e só confirmada
assert.equal(ok("dona@salao.com", dona), true);
assert.equal(ok("dona@salao.com", { email: "DONA@Salao.com" }), true, "confirmação de e-mail não diferencia maiúscula");
assert.equal(ok("dona@salao.com", { email: "ladrao@x.com" }), false, "outra conta confirmada não entra");
assert.equal(ok("dona@salao.com", {}), false, "conta sem e-mail confirmado não entra");

// o buraco que o e-mail não confirmado abriria: criar conta com o endereço da
// dona e aceitar o convite dela sem nunca provar que o endereço é seu
assert.equal(ok("dona@salao.com", { emailPendente: "dona@salao.com" }), false, "e-mail não confirmado não vale como prova");

// a mensagem precisa dizer o que fazer, não só que não deu
const recusa = conviteAbrePara({ email: "dona@salao.com" }, { emailPendente: "dona@salao.com" });
assert.equal(recusa.ok, false);
assert.ok(recusa.ok === false && recusa.error.includes("dona@salao.com"), "a recusa diz qual e-mail confirmar");

// ————— Convite da equipe —————
// o dono convida o profissional: o token diz que é funcionário e de qual profissional
const equipe = await lerConvite(db, await criarConvite(db, "salao", "Bruna@Salao.com", { staffId: "bruna" }));
assert.equal(equipe?.papel, "member", "convite da equipe entra como funcionário");
assert.equal(equipe?.papel === "member" && equipe.staffId, "bruna");
assert.equal(equipe?.email, "bruna@salao.com");
// o do dono, sem papel no token, continua admin
assert.equal(preso?.papel, "admin", "convite sem papel é o do dono");
await assert.rejects(() => criarConvite(db, "salao", "", { staffId: "bruna" }), /e-mail de quem vai entrar/i);

// ————— O cliente assume o site da fábrica —————
const seg = () => Date.now();
let n = 0;
const aceite = (tenantId: string, extra: object = {}) => ({ tenantId, jti: `jti-${++n}`, emitidoEm: seg() + 1000, ...extra });
await db.doc("config/admin").set({ uids: ["ruphus"] }, { merge: true });
await db.doc("tenants/fabrica").set({ name: "Fábrica", ownerId: "ruphus" });
await db.doc("tenants/fabrica/members/ruphus").set({ uid: "ruphus", role: "owner" });
const doCliente = aceite("fabrica");
assert.equal(await assumirNegocio(db, doCliente, "cliente", { email: "dona@fabrica.com" }), null);
assert.equal((await db.doc("tenants/fabrica").get()).get("ownerId"), "cliente", "o negócio passa a ser do cliente");
const cliente = (await db.doc("tenants/fabrica/members/cliente").get()).data();
assert.equal(cliente?.role, "owner");
assert.equal(cliente?.viaConvite, true, "viaConvite segue marcando o cliente (cota e gerador)");
assert.equal(cliente?.uid, "cliente", "o uid fica no membro: é por ele que o painel acha os negócios");
assert.equal((await db.doc("tenants/fabrica/members/ruphus").get()).get("role"), "admin", "a Ruphus fica como admin");
assert.equal((await db.doc(`convitesUsados/${doCliente.jti}`).get()).exists, true, "o link é queimado junto com a entrada");
// o mesmo cliente abre outro link ao mesmo tempo: não o rebaixa a admin
assert.equal(await assumirNegocio(db, aceite("fabrica"), "cliente", {}), null);
assert.equal((await db.doc("tenants/fabrica/members/cliente").get()).get("role"), "owner", "segundo aceite não rebaixa o dono");
// link já usado não abre para outra conta
assert.match(String(await assumirNegocio(db, doCliente, "outra", {})), /já foi usado/);

// negócio que não é da Ruphus (criado pelo próprio dono): o convidado entra como admin, nada muda de dono
await db.doc("tenants/proprio").set({ name: "Próprio", ownerId: "fulana" });
await db.doc("tenants/proprio/members/fulana").set({ uid: "fulana", role: "owner" });
assert.equal(await assumirNegocio(db, aceite("proprio"), "socio", {}), null);
assert.equal((await db.doc("tenants/proprio").get()).get("ownerId"), "fulana");
assert.equal((await db.doc("tenants/proprio/members/socio").get()).get("role"), "admin");
assert.equal((await db.doc("tenants/proprio/members/fulana").get()).get("role"), "owner");

// ————— Convite da equipe amarrado ao profissional —————
await db.doc("tenants/salao/staff/bruna").set({ name: "Bruna", active: true });
const cBruna = (await lerConvite(db, await criarConvite(db, "salao", "bruna@salao.com", { staffId: "bruna" })))!;
assert.ok(cBruna.papel === "member" && cBruna.emitidoEm > 0);
const daBruna = () => aceite("salao", { staffId: "bruna" }) as ReturnType<typeof aceite> & { staffId: string };
assert.match(String(await entrarNaEquipe(db, { ...daBruna(), staffId: "fantasma" }, "x", {})), /não está mais no cadastro/);
assert.equal(await entrarNaEquipe(db, daBruna(), "bruna-uid", {}), null, "profissional existe, link novo, ninguém dentro: entra");
const bruna = (await db.doc("tenants/salao/members/bruna-uid").get()).data();
assert.equal(bruna?.role, "member");
assert.equal(bruna?.staffId, "bruna");
// um acesso por profissional
assert.match(String(await entrarNaEquipe(db, daBruna(), "outra-uid", {})), /já tem um acesso/);
// quem já é membro entra sem mudar de papel
assert.equal(await entrarNaEquipe(db, daBruna(), "bruna-uid", {}), null);
// tirar o acesso leva a conta e cancela o link que sobrou
const sobrou = { ...daBruna(), emitidoEm: seg() - 1000 };
await tirarAcessosDoProfissional(db, "salao", "bruna");
assert.equal((await db.doc("tenants/salao/members/bruna-uid").get()).exists, false, "a conta sai junto");
assert.match(String(await entrarNaEquipe(db, sobrou, "bruna-uid", {})), /cancelado/, "link de antes do corte não abre");
assert.equal(await entrarNaEquipe(db, daBruna(), "bruna-uid", {}), null, "link gerado depois do corte abre de novo");
// tirar não leva dono nem admin, mesmo com staffId
await db.doc("tenants/salao/members/gerente").set({ uid: "gerente", role: "admin", staffId: "bruna" });
await tirarAcessosDoProfissional(db, "salao", "bruna");
assert.equal((await db.doc("tenants/salao/members/gerente").get()).exists, true);

// link gerado logo depois de "Tirar acesso", no mesmo segundo, abre: o corte é por ms
await db.doc("tenants/salao/staff/carla").set({ name: "Carla", active: true });
await revogarConvitesDaEquipe(db, "salao", "carla");
const logoDepois = (await lerConvite(db, await criarConvite(db, "salao", "carla@salao.com", { staffId: "carla" })))!;
assert.equal(await entrarNaEquipe(db, { ...logoDepois, staffId: "carla" }, "carla-uid", {}), null, "link novo logo após o corte vale");

// ————— Corte do negócio inteiro (a Ruphus tirou o cliente) —————
const antigoDono = { ...aceite("fabrica"), emitidoEm: seg() - 1000 };
const antigoEquipe = { ...aceite("salao", { staffId: "bruna" }), emitidoEm: seg() - 1000 } as ReturnType<typeof daBruna>;
await revogarConvitesDoNegocio(db, "fabrica");
await revogarConvitesDoNegocio(db, "salao");
assert.match(String(await assumirNegocio(db, antigoDono, "volta", {})), /cancelado/, "link de dono anterior ao corte não abre");
assert.match(String(await entrarNaEquipe(db, antigoEquipe, "volta", {})), /cancelado/, "nem link da equipe");
assert.equal(await assumirNegocio(db, aceite("fabrica"), "novo-cliente", {}), null, "convite novo, depois do corte, abre");

console.log("convite: ok");
