// Regressão do render (docs/plano-estudio-modelos.md, F3.3): renderiza todo modelo com dados
// fixos e compara o sha256 do HTML com a base gravada antes da F3. Qualquer diferença = um site
// existente mudaria de aparência.
//
//   tsx scripts/regressao-modelos.mts            compara (sai com 1 se algo mudou)
//   tsx scripts/regressao-modelos.mts --gravar   grava a base de novo
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type DadosSite, type Escolha, SUBS, type Sub } from "@/lib/gerador";
import { ehClaro, modelosClaro, renderClaro } from "@/lib/site-claro";
import { MODELOS, type Personal, renderEditorial } from "@/lib/site-editorial";

const BASE = join(import.meta.dirname, "regressao-modelos.base.json");
const SUBS_TODOS = Object.keys(SUBS) as Sub[];

const dados = (slug: string, sub: Sub, extra: Partial<DadosSite> = {}): DadosSite => ({
  slug, nome: "Casa Exemplo do Centro", telefone: "5585999990000", sub, tipo: SUBS[sub].tipo, variantes: true,
  endereco: "Rua Exemplo, 100", bairro: "Centro", cidade: "Fortaleza", uf: "CE", nota: 4.8, avaliacoes: 127, instagram: "casaexemplo",
  horario: "Seg a Sex 8h–19h · Sáb 8h–13h", servicos: ["Corte", "Escova", "Hidratação"], consultado: "novembro de 2026",
  origem: "prospeccao", publicado: false, dominio: null, remocao: "assinatura-fixa",
  ...extra,
});
const render = (d: DadosSite) => (ehClaro(d.sub) ? renderClaro(d) : renderEditorial(d));

const PERSONAL: Personal = {
  cores: { ink: "#112233", acc: "#cc5500" }, fonte: "Italiana",
  textos: { frase: "Frase própria do negócio.", sobre: "Sobre próprio do negócio.", galeria: "Nosso espaço" },
  fotos: { hero: "fotos/hero.jpg", ga2: "fotos/ga2.jpg", bio: "fotos/bio.jpg" }, versao: 1730000000000,
};

/** id → dados fixos. Mudar esta lista exige gravar a base de novo (antes de mexer no render). */
function casos(): [string, DadosSite][] {
  const lista: [string, DadosSite][] = [];
  // (a) editoriais pela escolha gravada
  for (const m of MODELOS) lista.push([`editorial:${m.id}`, dados(`regressao-${m.id}`, m.sub, { escolha: m.escolha })]);
  // (b) claros pela escolha da gaveta
  for (const sub of SUBS_TODOS.filter(ehClaro)) {
    for (const m of modelosClaro(sub)) lista.push([`claro:${m.id}`, dados(`regressao-${m.id}`, sub, { escolha: m.escolha as Escolha })]);
  }
  // (c) caminho legado: sem escolha, o slug sorteia (com e sem variantes)
  for (const sub of SUBS_TODOS) {
    for (const [i, slug] of ["ana-studio", "bela-vista", "casa-norte"].entries()) {
      lista.push([`hash:${sub}:${slug}`, dados(slug, sub, { variantes: i !== 1 })]);
    }
  }
  // (d) personalização por cima do modelo e do sorteio
  lista.push(["personal:barbearia-2", dados("navalha", "barbearia", { escolha: MODELOS.find((m) => m.id === "barbearia-2")!.escolha, personal: PERSONAL })]);
  lista.push(["personal:salao-hash", dados("tesoura", "salao", { personal: { cores: { acc: "#7a2244" }, textos: { frase: "Só a frase." } } })]);
  lista.push(["personal:petshop-1", dados("pet-feliz", "petshop", { escolha: modelosClaro("petshop")[0].escolha as Escolha, personal: PERSONAL })]);
  lista.push(["personal:odonto-hash", dados("sorriso", "odonto", { personal: { fonte: "Marcellus", fotos: { ga1: "fotos/ga1.jpg" }, versao: 7 } })]);
  return lista;
}

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const atual = Object.fromEntries(casos().map(([id, d]) => [id, sha(render(d))]));

if (process.argv.includes("--gravar")) {
  writeFileSync(BASE, JSON.stringify(atual, null, 1) + "\n");
  console.log(`regressão: base gravada com ${Object.keys(atual).length} casos`);
} else {
  if (!existsSync(BASE)) throw new Error("sem base: rode com --gravar antes de mexer no render");
  const base = JSON.parse(readFileSync(BASE, "utf8")) as Record<string, string>;
  const ids = [...new Set([...Object.keys(base), ...Object.keys(atual)])];
  const diferentes = ids.filter((id) => base[id] !== atual[id]);
  if (diferentes.length) {
    console.error(`regressão: ${diferentes.length} de ${ids.length} mudaram:\n  ${diferentes.join("\n  ")}`);
    process.exit(1);
  }
  console.log(`regressão: ${ids.length} casos, 0 diferenças`);
}
