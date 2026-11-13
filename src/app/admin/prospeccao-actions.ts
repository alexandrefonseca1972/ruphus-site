"use server";

import { z } from "zod";
import { adminDb } from "@/lib/admin";
import { adminAction } from "@/lib/admin-guard";
import { TEXTOS_PADRAO, TextosCrmEstrito, type ChaveTexto } from "@/lib/crm-textos";
import { ErroPrevisto } from "@/lib/erro-previsto";
import { STATUS_VARIANTE } from "@/lib/prospeccao-biblioteca";
import { aprovarRascunho, duplicarVariante, editarVariante, gerarVariacoes, leadParaPrevia, lerBiblioteca, mudarStatusVariante, semear } from "@/lib/prospeccao-biblioteca.server";
import { limparEscalada, listarEscalados } from "@/lib/prospeccao-escalada.server";
import { ANGULOS, ETAPAS_VARIANTE, NICHOS } from "@/lib/prospeccao-variantes";

// Aba Prospecção (F4): a mesma checagem das outras ações do admin (adminAction: token + config/admin).
// O servidor revalida tudo com a regra da biblioteca (problemasDaVariante), a mesma da tela.

const Id = z.string().min(2).max(63);
const Angulo = z.enum(ANGULOS);
const Texto = z.string().max(2000);

export const lerVariantesAction = adminAction(async () => {
  const { fonte, docs } = await lerBiblioteca(adminDb);
  return { fonte, docs };
});

/** "Copiar a biblioteca do código": o mesmo seed do script, idempotente. */
export const semearVariantesAction = adminAction(async () => semear(adminDb));

/** `base`: o editadaEm e o texto que o admin abriu; mudou desde então, o servidor recusa. */
export const editarVarianteAction = adminAction(async (_user, id: unknown, mudanca: unknown, base: unknown) =>
  editarVariante(adminDb, Id.parse(id), z.object({ texto: Texto, angulo: Angulo }).parse(mudanca), z.object({ editadaEm: z.number().nullable(), texto: Texto }).parse(base)),
);

export const statusVarianteAction = adminAction(async (_user, id: unknown, status: unknown) => mudarStatusVariante(adminDb, Id.parse(id), z.enum(STATUS_VARIANTE).parse(status)));

export const duplicarVarianteAction = adminAction(async (_user, id: unknown) => duplicarVariante(adminDb, Id.parse(id)));

const Base = z.object({ nicho: z.enum(NICHOS), etapa: z.enum(ETAPAS_VARIANTE), angulo: Angulo, texto: Texto });

/** Rascunhos da IA: voltam para a tela e só viram variante com aprovarRascunhoAction. */
export const gerarVariacoesAction = adminAction(async (_user, base: unknown) => gerarVariacoes(Base.parse(base)));

export const aprovarRascunhoAction = adminAction(async (_user, rascunho: unknown) => aprovarRascunho(adminDb, Base.parse(rascunho)));

/** Escaladas abertas do agente (M-4): telefone mascarado na tela, motivo, data e as 3 últimas falas. */
export const listarEscaladosAction = adminAction(async () => listarEscalados(adminDb));

export const limparEscaladaAction = adminAction(async (user, telefone: unknown) => limparEscalada(adminDb, z.string().max(30).parse(telefone), user.email ?? user.uid));

export const leadDaPreviaAction = adminAction(async (_user, nicho: unknown, slug: unknown) =>
  leadParaPrevia(adminDb, z.enum(NICHOS).parse(nicho), z.string().max(63).optional().parse(slug || undefined)),
);

/** Os textos das mensagens prontas da gaveta (config/crm.textos). Igual ao padrão não é gravado: a
 *  chave ausente segue o padrão do código. mergeFields troca o mapa inteiro (o merge comum não apagaria
 *  a chave que voltou ao padrão). */
export const salvarTextosCrmAction = adminAction(async (_user, textos: unknown) => {
  const lido = TextosCrmEstrito.safeParse(textos);
  if (!lido.success) throw new ErroPrevisto("Texto fora da regra: confira o tamanho e os marcadores entre chaves.");
  const novos = Object.fromEntries(Object.entries(lido.data).filter(([k, v]) => v !== TEXTOS_PADRAO[k as ChaveTexto]));
  await adminDb.doc("config/crm").set({ textos: novos }, { mergeFields: ["textos"] });
  return novos as Partial<Record<ChaveTexto, string>>;
});
