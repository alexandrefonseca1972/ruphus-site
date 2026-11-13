// A biblioteca de variantes no Firestore (F4): prospeccaoVariantes/{id} guarda o texto e os números no
// mesmo doc. Aqui fica a parte pura (o editor do admin valida com ela ao vivo, o servidor revalida):
// o schema do doc, a trava das 2 do A/B da F1 e a regra de versão (editar variante com envios cria
// outra, para as métricas não se misturarem). Sem "server-only".
import { z } from "zod";
import { ErroPrevisto } from "@/lib/erro-previsto";
import { ANGULOS, ETAPAS_VARIANTE, linksPermitidos, NICHOS, preencher, problemasDaResposta, VARIANTES, VARIANTES_F1, VarianteValida, type Variante } from "@/lib/prospeccao-variantes";
import { paraVarianteId, type VarianteId } from "@/lib/tipos-marca";

export const STATUS_VARIANTE = ["ativa", "pausada"] as const;
export type StatusVariante = (typeof STATUS_VARIANTE)[number];

/** As 2 do A/B da F1 (salão, `varianteAB`): o A/B lê o texto do código, então editar ou pausar no
 *  Firestore criaria uma diferença entre o que se mede e o que sai. Ficam travadas por id; duplicar pode. */
export const VARIANTES_TRAVADAS: readonly string[] = VARIANTES_F1.map((v) => v.id);
export const travada = (id: string) => VARIANTES_TRAVADAS.includes(id);

export class VarianteTravada extends ErroPrevisto {
  readonly codigo = "VarianteTravada";
}
export class VarianteInvalida extends ErroPrevisto {
  readonly codigo = "VarianteInvalida";
}
export class VarianteNaoEncontrada extends ErroPrevisto {
  readonly codigo = "VarianteNaoEncontrada";
}
export class VarianteMudou extends ErroPrevisto {
  readonly codigo = "VarianteMudou";
}

/** As travadas valem sempre com o texto do código (o A/B mede esse): um doc com texto antigo, de um
 *  seed anterior, não chega ao produtor nem ao editor com outro texto. */
export function comTextoDoCodigo(d: VarianteDoc): VarianteDoc {
  const c = VARIANTES_F1.find((v) => v.id === d.id);
  return c ? { ...d, nicho: c.nicho, etapa: c.etapa, angulo: c.angulo, texto: c.texto } : d;
}

const contagem = z.number().int().min(0).catch(0).default(0);

/** O doc como o leitor aceita. Docs só com números (os que o CRM criou antes do seed) não têm texto e
 *  não entram na biblioteca; os números deles valem do mesmo jeito. `ultimoEnvioEm` chega em ms. */
export const VarianteDoc = z.object({
  id: z.string().refine((s) => paraVarianteId(s) === s, "id fora da forma de slug"),
  nicho: z.enum(NICHOS),
  etapa: z.enum(ETAPAS_VARIANTE),
  angulo: z.enum(ANGULOS),
  texto: z.string().min(1),
  status: z.enum(STATUS_VARIANTE).default("ativa"),
  versao: z.number().int().min(1).default(1),
  versaoDe: z.string().nullable().default(null),
  /** ms; preenchido = mexida pelo admin: o seed nunca sobrescreve */
  editadaEm: z.number().nullable().default(null),
  enviados: contagem,
  respostas: contagem,
  automaticas: contagem,
  optouts: contagem,
  ultimoEnvioEm: z.number().optional(),
});
export type VarianteDoc = z.infer<typeof VarianteDoc>;

const zerado = { enviados: 0, respostas: 0, automaticas: 0, optouts: 0 } as const;

/** O doc que o seed grava para uma variante do código (sem números: os que já existirem ficam). */
export const docDoCodigo = (v: Variante) => ({ id: v.id, nicho: v.nicho, etapa: v.etapa, angulo: v.angulo, texto: v.texto, status: "ativa" as const, versao: 1, versaoDe: null, editadaEm: null });

/** A biblioteca do código no formato do doc (o fallback quando a coleção não tem texto). */
export const bibliotecaDoCodigo = (): VarianteDoc[] => VARIANTES.map((v) => ({ ...docDoCodigo(v), ...zerado }));

/** Um lead de mentira para conferir o texto preenchido com a regra do produtor (problemasDaResposta). */
export const MARCADORES_EXEMPLO = {
  oi: "Oi, Ana! Aqui é a assistente virtual da Ruphus.",
  prova: "Vi o Studio Exemplo no Google, com 4,8 ★ e 120 avaliações.",
  nome: "Studio Exemplo",
  site: "exemplo.ruphus.site/?c=1",
};

/** As mensagens da regra, para a tela e para o erro do servidor: a da biblioteca (VarianteValida) e a do
 *  produtor (problemasDaResposta no texto preenchido: grátis, @, endereço soletrado, link fora da lista).
 *  Uma regra só para editor, rascunho da IA, ativasDe e produtor. */
export const problemasDaVariante = (v: { id: string; nicho: string; etapa: string; angulo: string; texto: string }) => {
  const r = VarianteValida.safeParse(v);
  const p = r.success ? [] : r.error.issues.map((i) => i.message);
  return [...p, ...problemasDaResposta(preencher(v as Variante, MARCADORES_EXEMPLO), linksPermitidos("exemplo"))];
};

/** O que o produtor pode sortear: as ativas que ainda passam na regra (um doc torto não sai). */
export const ativasDe = (docs: readonly VarianteDoc[]): Variante[] =>
  docs
    .map(comTextoDoCodigo)
    .filter((d) => d.status === "ativa" && !problemasDaVariante(d).length)
    .map((d) => ({ id: d.id as VarianteId, nicho: d.nicho, etapa: d.etapa, angulo: d.angulo, texto: d.texto }));

/** Recusa (VarianteInvalida) o texto fora da regra: salvar, aprovar, duplicar e ativar passam por aqui. */
export function validar(v: Parameters<typeof problemasDaVariante>[0]) {
  const p = problemasDaVariante(v);
  if (p.length) throw new VarianteInvalida(`A variante não pode ser salva: ${p.join("; ")}.`);
}

/** "Salvar" do editor desligado: nada mudou em relação ao que o admin ABRIU (a base congelada ao abrir),
 *  não ao doc de agora (a tabela recarrega por baixo do editor). */
export const semMudanca = (base: { texto: string; angulo: string }, editado: { texto: string; angulo: string }) => editado.texto.trim() === base.texto && editado.angulo === base.angulo;

/** O primeiro id livre com o sufixo (`-v2`, `-v3`… ou `-copia`, `-copia-2`…). */
function idLivre(base: string, sufixo: (n: number) => string, inicio: number, existentes: ReadonlySet<string>): VarianteId {
  for (let n = inicio; n < inicio + 1000; n++) {
    const id = paraVarianteId(`${base}${sufixo(n)}`);
    if (!id) break;
    if (!existentes.has(id)) return id;
  }
  throw new VarianteInvalida("Não há id livre para esta variante: o nome ficou longo demais.");
}
const raiz = (id: string) => id.replace(/-v\d+$/, "");

/** 4.2: o que gravar ao editar. Sem envios (nem item na fila), o mesmo doc muda (texto, ângulo,
 *  editadaEm). Com envios ou item aberto na fila, nasce outra versão (novo id, `versaoDe` = a anterior,
 *  números zerados, mesmo status) e a anterior vai a pausada: os números de cada texto ficam no doc dele.
 *  `base`: o que o admin abriu (mudou desde então: recusa). `sucessor`: a versão que já saiu desta
 *  (recusa: editar a antiga criaria outra "v2"). */
export function planejarEdicao(
  atual: VarianteDoc,
  mudanca: { texto: string; angulo: (typeof ANGULOS)[number] },
  existentes: ReadonlySet<string>,
  agora: number,
  extra: { base?: { editadaEm: number | null; texto: string }; naFila?: boolean; sucessor?: string | null } = {},
): { tipo: "atualizar"; doc: VarianteDoc } | { tipo: "nova_versao"; nova: VarianteDoc; pausar: string } {
  if (travada(atual.id)) throw new VarianteTravada("Esta variante é do A/B da F1 e não muda pelo editor: duplique e edite a cópia.");
  if (extra.base && (extra.base.editadaEm !== atual.editadaEm || extra.base.texto !== atual.texto)) throw new VarianteMudou("A variante mudou desde que você abriu; recarregue.");
  if (extra.sucessor) throw new VarianteInvalida(`Esta variante já tem a versão ${extra.sucessor}: edite a mais nova.`);
  const texto = mudanca.texto.trim();
  validar({ id: atual.id as VarianteId, nicho: atual.nicho, etapa: atual.etapa, angulo: mudanca.angulo, texto });
  if (atual.enviados <= 0 && !extra.naFila) return { tipo: "atualizar", doc: { ...atual, texto, angulo: mudanca.angulo, editadaEm: agora } };
  const id = idLivre(raiz(atual.id), (n) => `-v${n}`, Math.max(2, atual.versao + 1), existentes);
  const { ultimoEnvioEm: _, ...semUltimo } = atual;
  void _;
  return {
    tipo: "nova_versao",
    nova: { ...semUltimo, ...zerado, id, texto, angulo: mudanca.angulo, versao: atual.versao + 1, versaoDe: atual.id, editadaEm: agora },
    pausar: atual.id,
  };
}

/** Duplicar: outro id, pausada (alguém ativa depois de revisar), versão 1, números zerados. O texto
 *  passa pela regra de hoje: um doc antigo fora dela não se multiplica. */
export function planejarCopia(atual: VarianteDoc, existentes: ReadonlySet<string>, agora: number): VarianteDoc {
  validar(atual);
  const id = idLivre(raiz(atual.id), (n) => (n === 1 ? "-copia" : `-copia-${n}`), 1, existentes);
  const { ultimoEnvioEm: _, ...semUltimo } = atual;
  void _;
  return { ...semUltimo, ...zerado, id, status: "pausada", versao: 1, versaoDe: null, editadaEm: agora };
}

/** Rascunho aprovado (da IA ou escrito à mão): variante nova, pausada, com id `nicho-etapa-angulo-N`. */
export function planejarNova(v: { nicho: (typeof NICHOS)[number]; etapa: (typeof ETAPAS_VARIANTE)[number]; angulo: (typeof ANGULOS)[number]; texto: string }, existentes: ReadonlySet<string>, agora: number): VarianteDoc {
  const id = idLivre(`${v.nicho}-${v.etapa}-${v.angulo.replace(/_/g, "-")}`, (n) => `-${n}`, 2, existentes);
  const texto = v.texto.trim();
  validar({ id, nicho: v.nicho, etapa: v.etapa, angulo: v.angulo, texto });
  return { id, nicho: v.nicho, etapa: v.etapa, angulo: v.angulo, texto, status: "pausada", versao: 1, versaoDe: null, editadaEm: agora, ...zerado };
}

/** Ativar ou pausar: as travadas não mudam. */
export function conferirStatus(id: string) {
  if (travada(id)) throw new VarianteTravada("Esta variante é do A/B da F1: o status não muda pelo editor.");
}

/** O que a IA devolve na tarefa gerar_variacoes (o RESPOSTAS_MOCK do roteador já tem este formato). */
export const SaidaVariacoes = z.object({ variacoes: z.array(z.string().max(1000)).min(1).max(5) });
