// Domínio do Estúdio de modelos (docs/plano-estudio-modelos.md, D2–D4): o que um modelo de
// site ou de bio guarda, como o negócio aponta para ele e a configuração de padrões. Sem
// Firestore: estes esquemas validam o que vem do banco e o que o admin manda salvar.
import { z } from "zod";
import { type Sub, SUBS } from "@/lib/gerador";
import { NOMES_FONTE } from "@/lib/site-editorial";

/** Layouts de bio (código, F4). Os quatro primeiros entram primeiro; os outros, depois. */
export const LAYOUTS_BIO = ["atual", "clara", "galeria", "agenda", "cartaz", "vidro", "painel", "noturno", "stories"] as const;
export type LayoutBio = (typeof LAYOUTS_BIO)[number];
export const LAYOUTS_SITE = ["editorial", "claro"] as const;

const SUB_IDS = Object.keys(SUBS) as [Sub, ...Sub[]];

/** Nichos em que a Ruphus opera hoje: o Estúdio só lista modelos destes (e a bio "todos").
 *  Desde 15/11/2026 o código só tem beleza e saúde (SUBS), então o filtro só barra sub desconhecido. */
export const NICHOS_ATIVOS: readonly string[] = ["beleza", "saude"];
export const doNichoAtivo = (sub: string) => sub === "todos" || NICHOS_ATIVOS.includes(SUBS[sub as Sub]?.nicho ?? "");
const HEX = z.string().regex(/^#[0-9a-f]{6}$/i, "cor em hex de 6 dígitos");

/** Um modelo, com kit e paleta por valor: reordenar as listas do código não muda ninguém.
 *  - kit editorial: a pasta do kit ("/assets/beleza/salao-1"), com hero.jpg e ga1..3.jpg;
 *  - kit claro: a foto do topo sem extensão ("/assets/saude/odonto-consulta"), a mesma
 *    referência que `visualClaro` devolve em `fotos.hero` (o HTML põe -800/1400);
 *  - paleta editorial: [--ink, --acc, --deep, --tint];
 *  - paleta claro (tema claro): ink = --accent, acc = --gold (o mesmo mapa de `personal.cores`
 *    no claro), deep = --text, tint = --bg. O tema escuro e o resto das variáveis ficam na
 *    paleta do código que tiver esse --accent e --gold. */
const CAMPOS = {
  id: z.string().regex(/^[a-z0-9-]+$/, "id em minúsculas, números e hífen"),
  tipo: z.enum(["site", "bio"]),
  sub: z.union([z.enum(SUB_IDS), z.literal("todos")]),
  layout: z.enum([...LAYOUTS_SITE, ...LAYOUTS_BIO]),
  // só pastas de /assets, sem "..": o kit entra em caminho de foto e em HTML
  kit: z.string().regex(/^\/assets\/[a-z0-9][a-z0-9/_-]*$/, "kit fora de /assets").refine((k) => !k.includes(".."), "kit fora de /assets"),
  paleta: z.object({ ink: HEX, acc: HEX, deep: HEX, tint: HEX }),
  fonte: z.enum(NOMES_FONTE).optional(),
  nome: z.string().trim().min(1).max(60),
  ativo: z.boolean(),
};
export const DefModelo = z.object(CAMPOS).strict()
  // layout de site só em modelo de site, de bio só em bio; "todos" só faz sentido na bio
  .refine((m) => (m.tipo === "site") === (LAYOUTS_SITE as readonly string[]).includes(m.layout), { message: "layout não combina com o tipo", path: ["layout"] })
  .refine((m) => m.tipo === "bio" || m.sub !== "todos", { message: "modelo de site precisa de um ramo", path: ["sub"] });
export type DefModelo = z.infer<typeof DefModelo>;

/** Leitura tolerante do banco: se SUBS ou NOMES_FONTE mudarem no código, o modelo gravado não some
 *  do catálogo (nem tira do ar quem o usa). Fonte que saiu da lista vira "a do modelo"; ramo que
 *  saiu de SUBS fica como texto (vale para achar o modelo, não aparece em lista de ramo nenhum). */
export const DefModeloLida = z.object({ ...CAMPOS, sub: z.string().min(1), fonte: CAMPOS.fonte.catch(undefined) });

/** O que o negócio grava em gerado.modelo / gerado.bio. versao null segue a publicada
 *  (prospecção); número fixo é a versão congelada (cliente). */
export const RefModelo = z.object({ id: z.string().min(1), versao: z.number().int().nonnegative().nullable() }).strict();
export type RefModelo = z.infer<typeof RefModelo>;

/** config/modelos: padrão por ramo (a bio aceita "todos" como padrão geral). */
export const ConfigModelos = z.object({
  padroes: z.object({
    site: z.record(z.string(), z.string()).default({}),
    bio: z.record(z.string(), z.string()).default({}),
  }).default({ site: {}, bio: {} }),
  testes: z.array(z.unknown()).default([]),
});
export type ConfigModelos = z.infer<typeof ConfigModelos>;

/** Sem padrão gravado, todo ramo segue o caminho atual (escolha/hash e a bio de hoje). */
export const CONFIG_VAZIA: ConfigModelos = { padroes: { site: {}, bio: {} }, testes: [] };

/** Tamanhos da prévia no Estúdio. */
export const Formato = z.enum(["cel", "tab", "note", "mon"]);
export type Formato = z.infer<typeof Formato>;

/** Casos de teste da prévia: negócio comum, nome longo, sem nota, poucas fotos, um serviço, sem preço. */
export const Caso = z.enum(["normal", "longo", "semnota", "poucas", "umserv", "semprec"]);
export type Caso = z.infer<typeof Caso>;
