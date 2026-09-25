// Gera os sites de uma planilha de leads pela linha de comando — o mesmo que a aba
// Gerador do /admin faz, para lotes grandes ou sem abrir o navegador. Simula por padrão.
//
//   npm run gerar:sites -- planilha.xlsx             # só a prévia
//   npm run gerar:sites -- planilha.xlsx --aplicar   # grava
//   npm run gerar:sites -- planilha.xlsx --uf=AP     # UF para as linhas que vierem sem ela
//
// Dono dos negócios: OWNER_UID; sem ele, o mesmo dono dos sites importados.
import lerAbas from "read-excel-file/node";
import { adminDb } from "@/lib/admin";
import { lerPlanilha } from "@/lib/gerador";
import { gerarNoBanco } from "@/lib/gerador.server";

const arquivo = process.argv.slice(2).find((a) => !a.startsWith("--"));
const aplicar = process.argv.includes("--aplicar");
// planilha de levantamento de uma região só costuma não ter coluna de UF
const uf = process.argv.find((a) => a.startsWith("--uf="))?.slice(5).toUpperCase();
if (uf !== undefined && !/^[A-Z]{2}$/.test(uf)) throw new Error("--uf precisa de duas letras, ex.: --uf=AP");
if (!arquivo) throw new Error("Informe a planilha: npm run gerar:sites -- planilha.xlsx [--aplicar]");

const abas = (await lerAbas(arquivo)).map(({ sheet, data }) => ({ aba: sheet, linhas: data as unknown[][] }));
const { leads, erros } = lerPlanilha(abas);
if (uf) for (const l of leads) l.lead.uf ||= uf;
for (const e of erros) console.log(`  ✗ ${e.aba}, linha ${e.linha}: ${e.motivo}`);

let dono = process.env.OWNER_UID;
if (!dono) {
  const importado = await adminDb.collection("tenants").where("site.url", "!=", null).limit(20).get();
  dono = importado.docs.find((d) => !d.get("gerado"))?.get("ownerId");
  if (!dono) throw new Error("Defina OWNER_UID: não achei um site importado para copiar o dono.");
}

const inicio = performance.now();
const linhas = await gerarNoBanco(adminDb, leads, aplicar, dono);
for (const l of linhas.filter((x) => x.acao === "pular" || x.aviso)) console.log(`  ! ${l.nome}: ${l.motivo ?? l.aviso}`);
const conta = (a: string) => linhas.filter((l) => l.acao === a).length;
console.log(`\n${aplicar ? "gravado" : "simulado"} em ${((performance.now() - inicio) / 1000).toFixed(1)} s — ` +
  `${conta("criar")} novo(s), ${conta("atualizar")} atualização(ões), ${conta("pular")} pulada(s), ${erros.length} fora na leitura`);
if (!aplicar) console.log("nada foi gravado: rode de novo com --aplicar");
process.exit(0);
