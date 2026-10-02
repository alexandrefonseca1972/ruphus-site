// Publica um site da fábrica sem deploy: a pasta vai para o Storage em
// sites/{slug}/ e as rotas de /s/{slug}/ passam a servi-la em até um minuto.
//
//   npm run site -- publicar <slug> <pasta> [--miniatura arquivo.webp]   # só mostra o que faria
//   npm run site -- publicar <slug> <pasta> ... --aplicar                 # publica
//   npm run site -- baixar <slug> <pasta>
//
// publicar sincroniza: envia o que mudou, apaga do bucket o que saiu da pasta.
// Enquanto existir public/s/{slug}, é ela que responde: apague a pasta do repositório
// no mesmo passo em que publicar pela primeira vez.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { cacheDe, objetoDoSite, PREFIXO, tipoDe } from "@/lib/site-arquivo";

const [acao, slug, pasta, ...resto] = process.argv.slice(2);
const opcao = (nome: string) => { const i = resto.indexOf(nome); return i < 0 ? undefined : resto[i + 1]; };
const aplicar = resto.includes("--aplicar");
if (!["publicar", "baixar"].includes(acao) || !slug || !pasta) {
  console.error("uso: npm run site -- publicar <slug> <pasta> [--miniatura arquivo.webp] [--aplicar]\n     npm run site -- baixar <slug> <pasta>");
  process.exit(1);
}
if (!objetoDoSite(slug, ["index.html"]) || slug === "_p") throw new Error(`slug inválido: ${slug}`);

const app = initializeApp({
  credential: process.env.FIREBASE_SERVICE_ACCOUNT ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) : applicationDefault(),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
});
const bucket = getStorage(app).bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
const raiz = `${PREFIXO}/${slug}/`;
const [remotos] = await bucket.getFiles({ prefix: raiz });

if (acao === "baixar") {
  if (!remotos.length) throw new Error(`${slug} não está publicado no Storage`);
  for (const f of remotos) {
    const destino = join(pasta, f.name.slice(raiz.length));
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, (await f.download())[0]);
  }
  console.log(`${remotos.length} arquivos de ${slug} em ${resolve(pasta)}`);
  process.exit(0);
}

// publicar
const lista = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => (n.startsWith(".") ? [] : statSync(join(dir, n)).isDirectory() ? lista(join(dir, n)) : [join(dir, n)]));
// previa.jpg é a miniatura do catálogo da fábrica, não do site (o mesmo corte do sync-sites)
const locais = lista(pasta).map((c) => relative(pasta, c).split(sep)).filter((p) => p.at(-1) !== "previa.jpg" && !p.at(-1)!.endsWith(".py"));
if (!locais.some((p) => p.join("/") === "index.html")) throw new Error(`${pasta} não tem index.html`);
const ruins = locais.filter((p) => !objetoDoSite(slug, p)).map((p) => p.join("/"));
if (ruins.length) throw new Error(`nomes que o site não serve (sem espaço, acento ou mais de 4 níveis):\n  ${ruins.join("\n  ")}`);

const tenant = await getFirestore(app).collection("tenants").doc(slug).get();
if (!tenant.exists) console.warn(`aviso: não há tenant ${slug}: o site abre, mas a bio, a agenda e o painel não`);
if (existsSync(join("public/s", slug))) console.warn(`aviso: public/s/${slug} existe e responde antes do Storage enquanto estiver no repositório`);

const md5 = (b: Buffer) => createHash("md5").update(b).digest("base64");
const noBucket = new Map(remotos.map((f) => [f.name, f.metadata.md5Hash]));
const envios: { nome: string; corpo: Buffer }[] = [];
for (const p of locais) {
  const nome = objetoDoSite(slug, p)!;
  const corpo = readFileSync(join(pasta, ...p));
  if (noBucket.get(nome) !== md5(corpo)) envios.push({ nome, corpo });
  noBucket.delete(nome);
}
const miniatura = opcao("--miniatura");
const apagar = [...noBucket.keys()];

console.log(`${slug}: ${envios.length} para enviar, ${apagar.length} para apagar, ${locais.length - envios.length} iguais${miniatura ? ", + miniatura" : ""}`);
for (const e of envios) console.log(`  + ${e.nome}`);
for (const n of apagar) console.log(`  - ${n}`);
if (!aplicar) {
  console.log("simulação: rode de novo com --aplicar para publicar");
  process.exit(0);
}

const grava = (nome: string, corpo: Buffer) =>
  bucket.file(nome).save(corpo, { resumable: false, contentType: tipoDe(nome), metadata: { cacheControl: cacheDe(nome) } });
for (let i = 0; i < envios.length; i += 8) await Promise.all(envios.slice(i, i + 8).map((e) => grava(e.nome, e.corpo)));
await Promise.all(apagar.map((n) => bucket.file(n).delete()));
if (miniatura) await grava(`${PREFIXO}/_p/${slug}.webp`, readFileSync(miniatura));
console.log(`publicado: https://${slug}.ruphus.site (aparece em até um minuto)`);
