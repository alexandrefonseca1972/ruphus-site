#!/usr/bin/env -S npx tsx
/** F7 do Estúdio de modelos (docs/plano-estudio-modelos.md): congela os clientes de hoje e
 *  converte a escolha de modelo da gaveta antiga em gerado.modelo.
 *
 * Regras (refsCongeladas em src/lib/modelos/congelar.server.ts):
 *  - cliente = CRM "fechado" ou gerado.origem "cadastro";
 *  - cliente com gerado.modelo/gerado.bio seguindo a publicada (versao null) fixa a versão de agora;
 *  - gerado.escolha.modelo sem gerado.modelo vira { id, versao: cliente ? 1 : null } (a versão 1 é
 *    o embutido: o mesmo visual que a escolha dá hoje); gerado.escolha fica, para os leitores antigos;
 *  - o resto fica como está: o cliente nunca viu o padrão do ramo (o resolver só o aplica à
 *    prospecção) e o sorteio pelo slug não muda.
 * Lê o catálogo e a config direto do banco (fora de requisição não há cache).
 *
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/migrar-modelos.mts            # simula (só lê)
 *   npx tsx --conditions=react-server --env-file=.env.local scripts/migrar-modelos.mts --aplicar  # backup + aplica
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { adminDb as db } from "@/lib/admin";
import { aplicarMigracao, planoMigracao } from "@/lib/modelos/congelar.server";
import { lerCatalogoDireto, lerConfig } from "@/lib/modelos/repo.server";

const aplicar = process.argv.includes("--aplicar");
const [{ catalogo }, config] = await Promise.all([lerCatalogoDireto(), lerConfig()]);
const { itens, comGerado, clientes } = await planoMigracao(db, catalogo, config);

const conta = (f: (i: (typeof itens)[number]) => boolean) => itens.filter(f).length;
const temRef = (v: unknown) => !!v && typeof v === "object" && "id" in v;
console.log(`${comGerado} sites do gerador, ${clientes} clientes; ${itens.length} mudam${aplicar ? "" : " (simulação)"}:`);
console.log(`  clientes com ref seguindo a publicada, congelados: site ${conta((i) => i.cliente && temRef(i.antes.modelo) && !!i.depois.modelo)}, bio ${conta((i) => i.cliente && !!i.depois.bio)}`);
console.log(`  escolha.modelo → gerado.modelo: clientes (versão 1) ${conta((i) => i.cliente && !temRef(i.antes.modelo) && !!i.depois.modelo)}, prospecção (publicada) ${conta((i) => !i.cliente && !!i.depois.modelo)}`);
console.log(`  clientes sem mudança no site (já congelados, ou no caminho de hoje: escolha por kit/cor ou sorteio): ${clientes - conta((i) => i.cliente && !!i.depois.modelo)}`);
const porModelo = new Map<string, number>();
for (const i of itens) if (i.depois.modelo) porModelo.set(i.depois.modelo.id, (porModelo.get(i.depois.modelo.id) ?? 0) + 1);
if (porModelo.size) console.log(`  por modelo: ${[...porModelo].sort((a, b) => b[1] - a[1]).map(([id, n]) => `${id} ${n}`).join(", ")}`);
if (!aplicar) process.exit(0);

const pasta = resolve(import.meta.dirname, "../dblocal");
mkdirSync(pasta, { recursive: true });
const backup = resolve(pasta, `backup-modelos-${Date.now()}.json`);
writeFileSync(backup, JSON.stringify(itens.map((i) => ({ slug: i.slug, cliente: i.cliente, antes: i.antes, depois: i.depois }))));
console.log(`backup: ${backup}`);
console.log(`${await aplicarMigracao(db, itens)} sites atualizados`);
process.exit(0);
