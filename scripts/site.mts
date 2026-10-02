// Publica sites da fábrica sem deploy: a pasta vai para o Storage em sites/{slug}/
// e as rotas de /s/{slug}/ passam a servi-la em até um minuto.
//
//   npm run site -- publicar <slug> <pasta> [--miniatura arquivo.webp]   # só mostra o que faria
//   npm run site -- publicar <slug> <pasta> ... --aplicar                 # publica
//   npm run site -- publicar-todos <raiz> [--aplicar]                     # cada <raiz>/<slug>/ com index.html,
//                                                                         # e a miniatura de <raiz>/_p/<slug>.webp
//   npm run site -- baixar <slug> <pasta>
//   npm run site -- restaurar <slug>                                      # lista os momentos publicados
//   npm run site -- restaurar <slug> <momento> [--aplicar]                # volta o site ao que estava no ar
//
// publicar sincroniza: envia o que mudou, apaga do bucket o que saiu da pasta.
// Enquanto existir public/s/{slug}, é ela que responde. O bucket guarda versões
// (até 5 por arquivo, por 90 dias): é delas que o restaurar tira o site de volta.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { cacheDe, objetoDoSite, PREFIXO, tipoDe } from "@/lib/site-arquivo";
import { RESERVADOS } from "@/lib/tenant-input";

const [acao, alvo, pastaArg, ...resto] = process.argv.slice(2);
const opcao = (nome: string) => { const i = resto.indexOf(nome); return i < 0 ? undefined : resto[i + 1]; };
const aplicar = process.argv.includes("--aplicar");
const USO = "uso: npm run site -- publicar <slug> <pasta> [--miniatura arquivo.webp] [--aplicar]\n" +
  "     npm run site -- publicar-todos <raiz> [--aplicar]\n     npm run site -- baixar <slug> <pasta>\n" +
  "     npm run site -- restaurar <slug> [momento] [--aplicar]";
if (!(["publicar-todos", "restaurar"].includes(acao) ? alvo : ["publicar", "baixar"].includes(acao) && alvo && pastaArg)) {
  console.error(USO);
  process.exit(1);
}

const app = initializeApp({
  credential: process.env.FIREBASE_SERVICE_ACCOUNT ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) : applicationDefault(),
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
});
const bucket = getStorage(app).bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
const tenants = getFirestore(app).collection("tenants");
// a pasta da fábrica (../sites) também guarda páginas do app antigo (login, catalogo…), que não são sites
const FORA = new Set([...RESERVADOS, "catalogo", "_p"]);
const slugValido = (s: string) => !FORA.has(s) && !!objetoDoSite(s, ["index.html"]);

const md5 = (b: Buffer) => createHash("md5").update(b).digest("base64");
const grava = (nome: string, corpo: Buffer) =>
  bucket.file(nome).save(corpo, { resumable: false, contentType: tipoDe(nome), metadata: { cacheControl: cacheDe(nome) } });
const lista = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => (n.startsWith(".") ? [] : statSync(join(dir, n)).isDirectory() ? lista(join(dir, n)) : [join(dir, n)]));

/** Sincroniza uma pasta com sites/{slug}/. Devolve o que fez (ou faria). */
async function publicar(slug: string, pasta: string, miniatura: string | undefined, detalhar: boolean) {
  if (!slugValido(slug)) throw new Error(`slug inválido: ${slug}`);
  // previa.jpg é a miniatura do catálogo da fábrica, não do site (o mesmo corte do sync-sites)
  const locais = lista(pasta).map((c) => relative(pasta, c).split(sep)).filter((p) => p.at(-1) !== "previa.jpg" && !p.at(-1)!.endsWith(".py"));
  if (!locais.some((p) => p.join("/") === "index.html")) throw new Error(`${pasta} não tem index.html`);
  const ruins = locais.filter((p) => !objetoDoSite(slug, p)).map((p) => p.join("/"));
  if (ruins.length) throw new Error(`${slug}: nomes que o site não serve (sem espaço, acento ou mais de 4 níveis):\n  ${ruins.join("\n  ")}`);

  const [remotos] = await bucket.getFiles({ prefix: `${PREFIXO}/${slug}/` });
  const noBucket = new Map(remotos.map((f) => [f.name, f.metadata.md5Hash]));
  const envios: { nome: string; corpo: Buffer }[] = [];
  for (const p of locais) {
    const nome = objetoDoSite(slug, p)!;
    const corpo = readFileSync(join(pasta, ...p));
    if (noBucket.get(nome) !== md5(corpo)) envios.push({ nome, corpo });
    noBucket.delete(nome);
  }
  const apagar = [...noBucket.keys()];
  let mini: Buffer | null = miniatura ? readFileSync(miniatura) : null;
  if (mini) {
    const [m] = await bucket.file(`${PREFIXO}/_p/${slug}.webp`).getMetadata().catch(() => [null]);
    if (m?.md5Hash === md5(mini)) mini = null;
  }
  if (detalhar) {
    for (const e of envios) console.log(`  + ${e.nome}`);
    for (const n of apagar) console.log(`  - ${n}`);
  }
  if (aplicar) {
    for (let i = 0; i < envios.length; i += 8) await Promise.all(envios.slice(i, i + 8).map((e) => grava(e.nome, e.corpo)));
    await Promise.all(apagar.map((n) => bucket.file(n).delete()));
    if (mini) await grava(`${PREFIXO}/_p/${slug}.webp`, mini);
  }
  return { enviar: envios.length, apagar: apagar.length, iguais: locais.length - envios.length, miniatura: !!mini };
}

if (acao === "baixar") {
  const raiz = `${PREFIXO}/${alvo}/`;
  const [remotos] = await bucket.getFiles({ prefix: raiz });
  if (!remotos.length) throw new Error(`${alvo} não está publicado no Storage`);
  for (const f of remotos) {
    const destino = join(pastaArg, f.name.slice(raiz.length));
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, (await f.download())[0]);
  }
  console.log(`${remotos.length} arquivos de ${alvo} em ${resolve(pastaArg)}`);
} else if (acao === "restaurar") {
  if (!slugValido(alvo)) throw new Error(`slug inválido: ${alvo}`);
  const [versoes] = await bucket.getFiles({ prefix: `${PREFIXO}/${alvo}/`, versions: true });
  if (!versoes.length) throw new Error(`${alvo} não tem nada no Storage`);
  const criado = (v: (typeof versoes)[number]) => new Date(v.metadata.timeCreated!).getTime();
  // até quando a versão ficou no ar: substituída ou apagada (as atuais não têm)
  const saiu = (v: (typeof versoes)[number]) => (v.metadata.timeDeleted ? new Date(v.metadata.timeDeleted).getTime() : Infinity);
  const minuto = (t: number) => new Date(t).toISOString().slice(0, 16);
  if (!pastaArg) {
    const momentos = new Map<string, number>();
    for (const v of versoes) momentos.set(minuto(criado(v)), (momentos.get(minuto(criado(v))) ?? 0) + 1);
    console.log(`publicações de ${alvo} (UTC, arquivos gravados):`);
    for (const [m, n] of [...momentos].sort()) console.log(`  ${m}  ${n}`);
    console.log(`para voltar: npm run site -- restaurar ${alvo} <momento> --aplicar`);
  } else {
    // o momento vale até o fim do minuto: é o que a listagem mostra
    const ate = new Date(`${pastaArg.slice(0, 16)}:59.999Z`).getTime();
    if (Number.isNaN(ate)) throw new Error(`momento inválido: ${pastaArg} (use o formato da listagem, ex.: 2026-10-02T15:40)`);
    const porNome = Map.groupBy(versoes, (v) => v.name);
    const acoes: { nome: string; de?: (typeof versoes)[number]; apagar: boolean }[] = [];
    for (const [nome, vs] of porNome) {
      const viva = vs.find((v) => saiu(v) === Infinity);
      const naquele = vs.find((v) => criado(v) <= ate && saiu(v) > ate);
      if (naquele && naquele.metadata.generation !== viva?.metadata.generation) acoes.push({ nome, de: naquele, apagar: false });
      else if (!naquele && viva) acoes.push({ nome, apagar: true });
    }
    for (const a of acoes) console.log(`  ${a.apagar ? "-" : "↺"} ${a.nome}`);
    console.log(`${alvo}: ${acoes.filter((a) => !a.apagar).length} para voltar, ${acoes.filter((a) => a.apagar).length} para apagar`);
    if (!aplicar) console.log("simulação: rode de novo com --aplicar para restaurar");
    else {
      for (const a of acoes) await (a.apagar ? bucket.file(a.nome).delete() : a.de!.copy(bucket.file(a.nome)));
      console.log(`restaurado: https://${alvo}.ruphus.site (aparece em até um minuto)`);
    }
  }
} else if (acao === "publicar") {
  if (!(await tenants.doc(alvo).get()).exists) console.warn(`aviso: não há tenant ${alvo}: o site abre, mas a bio, a agenda e o painel não`);
  if (existsSync(join("public/s", alvo))) console.warn(`aviso: public/s/${alvo} existe e responde antes do Storage enquanto estiver no repositório`);
  const r = await publicar(alvo, pastaArg, opcao("--miniatura"), true);
  console.log(`${alvo}: ${r.enviar} para enviar, ${r.apagar} para apagar, ${r.iguais} iguais${r.miniatura ? ", + miniatura" : ""}`);
  console.log(aplicar ? `publicado: https://${alvo}.ruphus.site (aparece em até um minuto)` : "simulação: rode de novo com --aplicar para publicar");
} else {
  const raiz = alvo;
  const slugs = readdirSync(raiz).filter((d) => slugValido(d) && existsSync(join(raiz, d, "index.html")));
  const comTenant = new Set((await tenants.select().get()).docs.map((d) => d.id));
  const soma = { enviar: 0, apagar: 0, iguais: 0, miniaturas: 0 };
  const erros: string[] = [];
  // quatro sites por vez, cada um com até oito envios simultâneos
  for (let i = 0; i < slugs.length; i += 4) {
    await Promise.all(slugs.slice(i, i + 4).map(async (s) => {
      const mini = join(raiz, "_p", `${s}.webp`);
      try {
        const r = await publicar(s, join(raiz, s), existsSync(mini) ? mini : undefined, false);
        soma.enviar += r.enviar; soma.apagar += r.apagar; soma.iguais += r.iguais; soma.miniaturas += +r.miniatura;
      } catch (e) {
        erros.push(`${s}: ${(e as Error).message}`);
      }
    }));
    if ((i / 4) % 25 === 24) console.log(`  ${Math.min(i + 4, slugs.length)}/${slugs.length}…`);
  }
  const semTenant = slugs.filter((s) => !comTenant.has(s));
  console.log(`${slugs.length} sites: ${soma.enviar} arquivos para enviar, ${soma.apagar} para apagar, ${soma.iguais} iguais, ${soma.miniaturas} miniaturas`);
  if (semTenant.length) console.warn(`aviso: ${semTenant.length} sem tenant (bio e agenda não abrem): ${semTenant.slice(0, 10).join(", ")}${semTenant.length > 10 ? "…" : ""}`);
  if (erros.length) { console.error(`${erros.length} com erro:\n  ${erros.join("\n  ")}`); process.exitCode = 1; }
  if (!aplicar) console.log("simulação: rode de novo com --aplicar para publicar");
}
