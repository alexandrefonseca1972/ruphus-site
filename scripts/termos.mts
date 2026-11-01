// Gera public/termos/{versão}/index.html (e /termos, a versão atual) a partir de
// docs/contrato-prestacao-servico.md. npm run termos — o texto aceito no cadastro e
// no convite é o que sai daqui. Versão publicada não muda: o aceite aponta para ela.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { marked } from "marked"; // vem com o firebase-tools (devDependency)
import { CONTRATO_VERSAO } from "../src/lib/contrato";

const md = readFileSync("docs/contrato-prestacao-servico.md", "utf8").replace(/<!--[\s\S]*?-->\s*/g, "");
const [, titulo, corpo] = /^# (.+)\n([\s\S]*)$/.exec(md.trim())!;

const falha = (msg: string) => { console.error(msg); process.exit(1); };
const pendente = corpo.match(/\[\[[^\]]+\]\]/g);
if (pendente) falha(`Contrato com campo a preencher: ${[...new Set(pendente)].join(", ")}`);
const versao = /\*\*Versão ([\d.]+)/.exec(corpo)?.[1];
if (versao !== CONTRATO_VERSAO) falha(`O contrato diz versão ${versao}, e CONTRATO_VERSAO é ${CONTRATO_VERSAO}: deixe as duas iguais.`);

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Termos de Contratação · Ruphus</title>
<meta name="description" content="Contrato de prestação de serviço de site e agenda online da Ruphus.">
<link rel="canonical" href="https://www.ruphus.site/termos">
<meta name="theme-color" content="#171013">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600&family=Bodoni+Moda:opsz,wght@6..96,500;6..96,700&display=swap" rel="stylesheet">
<style>
:root{--noite:#171013;--borda:#372b30;--luz:#f2b56b;--osso:#f0e7e2;--fumo:#a2918d;
  --disp:'Bodoni Moda',Georgia,serif;--corpo:'Archivo',system-ui,sans-serif}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--noite);color:var(--osso);font-family:var(--corpo);font-size:16px;line-height:1.65;-webkit-font-smoothing:antialiased}
a{color:var(--luz)}
:focus-visible{outline:2px solid var(--luz);outline-offset:3px;border-radius:4px}
.wrap{max-width:760px;margin:0 auto;padding:28px clamp(16px,5vw,32px) 80px}
.topo{padding-bottom:22px;border-bottom:1px solid var(--borda);margin-bottom:36px}
.marca{font-family:var(--disp);font-size:1.6rem;font-weight:700;color:var(--osso);text-decoration:none}
h1{font-family:var(--disp);font-weight:500;font-size:clamp(2rem,5vw,2.8rem);line-height:1.1;margin:0 0 16px}
h2{font-family:var(--disp);font-weight:500;font-size:1.4rem;margin:36px 0 10px}
h3{font-size:1.05rem;font-weight:600;margin:24px 0 8px}
p{margin:10px 0}
ul,ol{padding-left:1.4em;margin:8px 0 16px}
li{margin:6px 0}
hr{border:0;border-top:1px solid var(--borda);margin:32px 0}
.tabela{overflow-x:auto;margin:12px 0 18px}
table{border-collapse:collapse;width:100%;font-size:.94rem}
th,td{border:1px solid var(--borda);padding:8px 10px;text-align:left;vertical-align:top}
th{color:var(--fumo);font-weight:600}
code{font-size:.9em}
blockquote{border:1px solid var(--luz);border-radius:10px;padding:4px 18px;margin:18px 0;background:#221a1e}
blockquote p:first-child strong{color:var(--luz)}
@media print{body{background:#fff;color:#000}a{color:#000}th,td{border-color:#999}.topo{display:none}}
</style>
</head>
<body>
<main class="wrap">
  <div class="topo"><a class="marca" href="/sobre">Ruphus</a></div>
  <h1>${titulo}</h1>
${(marked.parse(corpo) as string).replace(/<table>/g, '<div class="tabela"><table>').replace(/<\/table>/g, "</table></div>")}
</main>
</body>
</html>
`;

const fixa = `public/termos/${versao}/index.html`;
// a versão publicada é a do git, não só a do disco: apagar o arquivo não libera reescrever
const noGit = (() => { try { return execFileSync("git", ["show", `HEAD:${fixa}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; } })();
const publicada = noGit ?? (existsSync(fixa) ? readFileSync(fixa, "utf8") : null);
if (publicada !== null && publicada !== html) {
  falha(`A versão ${versao} já foi publicada com outro texto. Quem aceitou leu aquela: suba a versão.`);
}
mkdirSync(`public/termos/${versao}`, { recursive: true });
writeFileSync(fixa, html);
writeFileSync("public/termos/index.html", html);
console.log(`${fixa} e public/termos/index.html gerados`);
