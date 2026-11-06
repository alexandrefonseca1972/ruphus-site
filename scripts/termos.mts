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

// O texto do contrato: é o que o aceite congela. A moldura (estilo, cabeçalho, rodapé) segue
// a identidade atual do ruphus.site e pode mudar sem subir a versão.
const contrato = `<h1>${titulo}</h1>
${(marked.parse(corpo) as string).replace(/<table>/g, '<div class="tabela"><table>').replace(/<\/table>/g, "</table></div>")}`;

const html = `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Termos de Contratação · Ruphus</title>
<meta name="description" content="Contrato de prestação de serviço de site e agenda online da Ruphus.">
<link rel="canonical" href="https://www.ruphus.site/termos">
<meta name="theme-color" content="#e5e5e5">
<link rel="stylesheet" href="/marca/legal.css">
<link rel="icon" type="image/svg+xml" href="/marca/icone.svg">
</head>
<body>
<a class="pular" href="#conteudo">Pular para o conteúdo</a>
<main class="wrap" id="conteudo" tabindex="-1">
  <header class="topo"><a class="marca" href="/" aria-label="Ruphus, início">ruphus</a><nav aria-label="Navegação institucional"><a href="/">Início</a><a href="/termos">Termos</a><a href="/privacidade">Privacidade</a></nav></header>
  ${contrato}
<footer><span>Ruphus · Fonseca Gestão e Tecnologia Ltda.</span><a href="/">Voltar ao início</a></footer>
</main>
</body>
</html>
`;

const fixa = `public/termos/${versao}/index.html`;
// a versão publicada é a do git, não só a do disco: apagar o arquivo não libera reescrever
const noGit = (() => { try { return execFileSync("git", ["show", `HEAD:${fixa}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return null; } })();
const publicada = noGit ?? (existsSync(fixa) ? readFileSync(fixa, "utf8") : null);
// só o texto conta: quem aceitou leu aquele contrato, não aquele CSS
if (publicada !== null && !publicada.includes(contrato)) {
  falha(`A versão ${versao} já foi publicada com outro texto. Quem aceitou leu aquela: suba a versão.`);
}
mkdirSync(`public/termos/${versao}`, { recursive: true });
writeFileSync(fixa, html);
writeFileSync("public/termos/index.html", html);
console.log(`${fixa} e public/termos/index.html gerados`);
