// Rode: npm run test:foto-rota  (a rota de upload de fotos: validação e autorização, sem emulador e sem rede)
import assert from "node:assert/strict";
process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ??= "demo-siteflow";
const { POST } = await import("./src/app/api/admin/foto/route");

const form = (campos: Record<string, string | Blob>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(campos)) f.set(k, v);
  return f;
};
const jpeg = new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], "x.jpg", { type: "image/jpeg" });
const post = (body: FormData | string, headers: Record<string, string> = {}) =>
  POST(new Request("http://x/api/admin/foto", { method: "POST", body, headers }));

// o teto de tamanho vale pelo cabeçalho, antes de qualquer leitura
assert.equal((await post(form({ slug: "navalha", slot: "hero", arquivo: jpeg }), { "content-length": String(13 * 1024 * 1024) })).status, 413, "corpo acima do teto é recusado antes de ler");

// sem admin o corpo nem é lido: 401 com o formato das actions, sem vazar nada
const semToken = await post(form({ slug: "navalha", slot: "hero", arquivo: jpeg }));
assert.equal(semToken.status, 401);
assert.deepEqual(await semToken.json(), { ok: false, error: "Sessão expirada. Entre novamente." });
const tokenRuim = await post(form({ slug: "navalha", slot: "hero", arquivo: jpeg }), { authorization: "Bearer abc.def.ghi" });
assert.equal(tokenRuim.status, 401);
console.log("foto-rota: ok");
