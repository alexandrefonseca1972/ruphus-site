// Rode: npm run test:convite  (uso único do link de convite, no emulador do Firestore)
import assert from "node:assert/strict";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { SignJWT } from "jose";
import { consumirConvite, criarConvite, lerConvite } from "@/lib/convite";

const db = getFirestore(initializeApp({ projectId: "demo-siteflow" }));

const token = await criarConvite(db, "acme");
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

console.log("convite: ok");
