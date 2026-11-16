import assert from "node:assert/strict";
import { EMBUTIDOS } from "@/lib/modelos/embutidos";

// Token da prévia da bio (F4.6): assinado, de 10 minutos, preso ao negócio.
process.env.CRON_SECRET = "segredo-de-teste";
const { assinarPreviaBio, lerPreviaBio } = await import("@/lib/modelos/previa-bio.server");

const def = EMBUTIDOS.find((m) => m.id === "bio-galeria")!;
const token = assinarPreviaBio({ slug: "studio-olhar", def, caso: "semnota" });
assert.deepEqual(lerPreviaBio(token), { slug: "studio-olhar", def, caso: "semnota" });
assert.deepEqual(lerPreviaBio(token, "studio-olhar"), { slug: "studio-olhar", def, caso: "semnota" });
assert.deepEqual(lerPreviaBio(assinarPreviaBio({ slug: "a", def }), "a"), { slug: "a", def });

// de outro negócio
assert.equal(lerPreviaBio(token, "outro-negocio"), null);

// adulterado: carga trocada (outro slug, mesma assinatura), assinatura trocada, lixo
const [dados, assinatura] = token.split(".");
const outro = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(dados, "base64url").toString()), slug: "outro" })).toString("base64url");
assert.equal(lerPreviaBio(`${outro}.${assinatura}`), null);
assert.equal(lerPreviaBio(`${dados}.${assinatura.slice(0, -2)}xx`), null);
assert.equal(lerPreviaBio(`${dados}.${assinatura}.x`), null);
assert.equal(lerPreviaBio("lixo"), null);
assert.equal(lerPreviaBio(""), null);

// modelo de site num token assinado de verdade: não passa (só bio)
const site = EMBUTIDOS.find((m) => m.tipo === "site")!;
assert.equal(lerPreviaBio(assinarPreviaBio({ slug: "a", def: site })), null);

// vencido: 10 minutos depois
const agora = Date.now;
Date.now = () => agora() + 10 * 60 * 1000 + 1;
assert.equal(lerPreviaBio(token), null);
Date.now = () => agora() + 9 * 60 * 1000;
assert.ok(lerPreviaBio(token));
Date.now = agora;

// outra chave (CRON_SECRET trocado) invalida; sem chave, nem assina nem lê
process.env.CRON_SECRET = "outro";
assert.equal(lerPreviaBio(token), null);
delete process.env.CRON_SECRET;
assert.equal(lerPreviaBio(token), null);
assert.throws(() => assinarPreviaBio({ slug: "a", def }), (e: Error) => e.constructor.name === "ErroPrevisto" && /falta configurar CRON_SECRET/.test(e.message));

console.log("prévia da bio: ok");
