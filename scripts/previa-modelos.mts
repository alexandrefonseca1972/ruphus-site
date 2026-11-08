// Gera a página de cada modelo da gaveta com dados de exemplo e abre no navegador, para aprovar
// modelo novo sem publicar nada. As fotos vêm de public/s/assets (base file://).
//
//   npx tsx --conditions=react-server scripts/previa-modelos.mts idiomas-3 academia-1 …
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type DadosSite, type Escolha, SUBS, type Sub } from "@/lib/gerador";
import { ehClaro, modelosClaro, renderClaro } from "@/lib/site-claro";
import { MODELOS, renderEditorial } from "@/lib/site-editorial";

const base = pathToFileURL(resolve(import.meta.dirname, "../public/s/previa/")).href + "/";
const pasta = join(process.env.PREVIA_DIR ?? tmpdir(), "previa-modelos");
mkdirSync(pasta, { recursive: true });

for (const id of process.argv.slice(2)) {
  const editorial = MODELOS.find((m) => m.id === id);
  const claroSub = (Object.keys(SUBS) as Sub[]).find((s) => ehClaro(s) && modelosClaro(s).some((m) => m.id === id));
  const sub = editorial?.sub ?? claroSub;
  if (!sub) throw new Error(`${id}: modelo desconhecido`);
  const escolha: Escolha = editorial?.escolha ?? modelosClaro(sub).find((m) => m.id === id)!.escolha;
  const d: DadosSite = {
    slug: `previa-${id}`, nome: `${SUBS[sub].rotulo} Exemplo`, telefone: "5585999990000", sub, tipo: SUBS[sub].tipo, escolha, variantes: true,
    endereco: "Rua Exemplo, 100", bairro: "Centro", cidade: "Fortaleza", uf: "CE", nota: 4.8, avaliacoes: 127, instagram: "",
    horario: "Seg a Sex 8h–19h · Sáb 8h–13h", servicos: [], consultado: "novembro de 2026", origem: "prospeccao", publicado: false, dominio: null,
  };
  const arquivo = join(pasta, `${id}.html`);
  writeFileSync(arquivo, (ehClaro(sub) ? renderClaro(d) : renderEditorial(d)).replace("<head>", `<head><base href="${base}">`));
  execFileSync("open", [arquivo]);
  console.log(`${id} → ${arquivo}`);
}
