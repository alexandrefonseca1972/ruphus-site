// Rode: npm run test:convite  (uso único do link de convite, no emulador do Firestore)
import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { SignJWT } from "jose";
import { consumirConvite, conviteAbrePara, criarConvite, lerConvite } from "@/lib/convite";

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

console.log("convite: ok");
