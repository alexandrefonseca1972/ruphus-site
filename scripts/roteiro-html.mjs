// Gera docs/roteiro-de-teste.html (checklist interativo) a partir de docs/roteiro-de-teste.md.
// Rode: node scripts/roteiro-html.mjs  — o cabeçalho, o estilo e o script do .html ficam como estão;
// o menu de seções e o conteúdo saem do .md.
import { readFileSync, writeFileSync } from "node:fs";

const MD = "docs/roteiro-de-teste.md";
const HTML = "docs/roteiro-de-teste.html";
const md = readFileSync(MD, "utf8");
const html = readFileSync(HTML, "utf8");

const ABRE = '<div class="wrap">\n';
const FECHA = "\n</div>\n<script>";
const inicio = html.indexOf(ABRE) + ABRE.length;
const fim = html.indexOf(FECHA);
if (inicio < ABRE.length || fim < 0) throw new Error("estrutura do .html mudou: confira ABRE/FECHA");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const TAGS = { "⚠": '<span class="tag risco" title="Efeito real">⚠</span>', "🔒": '<span class="tag demo" title="Demo bloqueia">🔒</span>', "📱": '<span class="tag cel" title="Testar no celular">📱</span>' };
function inline(s) {
  return s
    .split(/(`[^`]*`)/)
    .map((p) => (p.startsWith("`") && p.endsWith("`") && p.length > 1 ? `<code>${esc(p.slice(1, -1))}</code>` : esc(p).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/⚠️?|🔒|📱/g, (m) => TAGS[m[0] === "⚠" ? "⚠" : m])))
    .join("");
}
// id da seção: minúsculas, acentuadas e travessões somem, o resto vira hífen
const slug = (s) => s.toLowerCase().replace(/[^\x00-\x7f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
const flags = (s) => (s.includes("⚠") ? "r" : "") + (s.includes("🔒") ? "d" : "") + (s.includes("📱") ? "c" : "");

const nav = [];
const out = [];
let lista = null; // "ck" | "ul" | "ol"
let tabela = null;
let secaoAberta = false;
const fecharBloco = () => {
  if (lista) out.push(lista === "ol" ? "</ol>" : "</ul>");
  lista = null;
  if (tabela) out.push(`<div class="tw"><table><thead><tr>${tabela[0].map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${tabela.slice(1).map((l) => `<tr>${l.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`);
  tabela = null;
};
const abrirLista = (tipo) => {
  if (lista === tipo) return;
  fecharBloco();
  lista = tipo;
  out.push(tipo === "ck" ? '<ul class="ck">' : tipo === "ol" ? "<ol>" : "<ul>");
};
const celulas = (l) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

for (const linha of md.split("\n")) {
  let m;
  if (/^# /.test(linha) || /^---\s*$/.test(linha)) {
    fecharBloco();
  } else if ((m = /^## (.+)$/.exec(linha))) {
    fecharBloco();
    if (secaoAberta) out.push("</section>");
    const id = slug(m[1]);
    nav.push(`<a href="#${id}">${inline(m[1])}</a>`);
    out.push(`<section class="sec" id="${id}"><h2>${inline(m[1])} <span class="cnt" data-cnt></span></h2>`);
    secaoAberta = true;
  } else if ((m = /^### (.+)$/.exec(linha))) {
    fecharBloco();
    out.push(`<h3 id="${slug(m[1])}">${inline(m[1])}</h3>`);
  } else if ((m = /^- \[[ x]\] `([^`]+)` (.*)$/.exec(linha))) {
    abrirLista("ck");
    const [, id, txt] = m;
    out.push(`<li class="item" data-id="${id}" data-f="${flags(txt)}"><label><input type="checkbox"><span class="code">${esc(id)}</span><span class="txt">${inline(txt)}</span></label><button class="nf" title="Marcar como falha" aria-label="Marcar ${id} como falha">✗</button></li>`);
  } else if ((m = /^- (.*)$/.exec(linha))) {
    abrirLista("ul");
    out.push(`<li>${inline(m[1])}</li>`);
  } else if ((m = /^\d+\. (.*)$/.exec(linha))) {
    abrirLista("ol");
    out.push(`<li>${inline(m[1])}</li>`);
  } else if (/^\|/.test(linha)) {
    if (lista) fecharBloco();
    if (/^\|[\s|:-]+\|$/.test(linha.trim())) continue;
    (tabela ??= []).push(celulas(linha));
  } else if (!linha.trim()) {
    fecharBloco();
  } else {
    fecharBloco();
    out.push(`<p>${inline(linha.trim())}</p>`);
  }
}
fecharBloco();
if (secaoAberta) out.push("</section>");

const corpo = `  <nav aria-label="Seções">${nav.join("")}</nav>\n  <main>${out.join("\n")}</main>`;
writeFileSync(HTML, html.slice(0, inicio) + corpo + html.slice(fim));
console.log(`${HTML}: ${(corpo.match(/class="item"/g) ?? []).length} itens`);
