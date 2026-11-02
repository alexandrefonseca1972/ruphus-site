import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { errors } from "jose";
import { invalido, semPermissao } from "@/lib/admin-guard";
import type { Crm } from "@/lib/crm-tipos";
import { resumoDoFunil } from "@/lib/funil-consulta";
import { consultar } from "@/lib/painel-consulta";
import type { criarIndice, Indice } from "@/lib/painel-indice.server";
import { ConsultaPainel, type CodigoDeErro, type RespostaPainel } from "@/lib/painel-tipos";
import { verifyFirebaseToken } from "@/lib/verify-token";

// GET /api/admin/painel (docs/plano-paginacao-admin.md, 3.3 e 6.2). Fora do route.ts para
// os testes chamarem com o emulador e um verificador de token de mentira.

export const ESPERA_MONTAGEM_MS = 20_000;
const LENTA_MS = 50;

export type Dependencias = {
  db: Firestore;
  indice: ReturnType<typeof criarIndice>;
  verificar?: (token: string) => Promise<{ uid: string; authTimeMs: number }>;
  esperaMs?: number;
};

// leva telefones e nomes: nada de cache em lugar nenhum
const CABECALHOS = { "cache-control": "no-store, private" };
const STATUS: Record<CodigoDeErro, number> = { sessao: 401, restrito: 403, invalido: 400, preparando: 503, falha: 500 };

function erro(codigo: CodigoDeErro, mensagem: string) {
  const corpo: RespostaPainel = { ok: false, codigo, erro: mensagem };
  const headers = codigo === "preparando" ? { ...CABECALHOS, "retry-after": "2" } : CABECALHOS;
  return Response.json(corpo, { status: STATUS[codigo], headers });
}

export async function responderPainel(req: Request, { db, indice, verificar = verifyFirebaseToken, esperaMs = ESPERA_MONTAGEM_MS }: Dependencias) {
  // o token só no cabeçalho: a URL vai para o log do Caddy
  const token = /^Bearer (\S{1,4096})$/.exec(req.headers.get("authorization") ?? "")?.[1];
  const user = token ? await verificar(token).catch((err) => (semRede(err) ? "rede" : null)) : null;
  if (user === "rede") return erro("falha", "Não foi possível agora.");
  if (!user) return erro("sessao", "Sessão expirada. Entre novamente.");

  // a cópia de config/admin do índice, quando montado: sem uma leitura por tecla digitada (R11)
  const montado = indice.montado();
  const config = montado ?? (await db.doc("config/admin").get().then((d) => ({ admins: d.get("uids"), revogados: d.get("revogados") })).catch(() => null));
  if (!config) return erro("falha", "Não foi possível agora.");
  const recusa = semPermissao(config.admins, config.revogados, user);
  if (recusa) return erro("restrito", recusa);

  const consulta = ConsultaPainel.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!consulta.success) return erro("invalido", invalido(consulta.error));
  const { n, hoje, tz, funil, periodo, novos, ...filtros } = consulta.data;

  // a montagem leva ~11 s; passou da espera, a tela tenta de novo e a montagem segue (R5)
  let prazo: ReturnType<typeof setTimeout> | undefined;
  const pronto: Indice | null = await Promise.race([
    indice.pronto(),
    new Promise<null>((r) => (prazo = setTimeout(r, esperaMs, null))),
  ])
    .catch(() => null)
    .finally(() => clearTimeout(prazo));
  if (!pronto) return erro("preparando", "Preparando o painel…");

  try {
    const inicio = performance.now();
    const r = consultar(pronto.lista(), filtros, { crm: pronto.crm, hoje, fuso: tz });
    const itens = r.lista.slice(0, n);
    const crm: Record<string, Crm> = {};
    const resumo = funil ? resumoDoFunil(r.lista, pronto.crm, { periodo, hoje, agora: Date.now(), fuso: tz, novos }) : undefined;
    const comCrm = resumo ? [...itens, ...Object.values(resumo.colunas).flatMap((c) => c.cartoes)] : itens;
    for (const e of comCrm) if (pronto.crm[e.slug]) crm[e.slug] = pronto.crm[e.slug];
    const { lista, avisos, ...contagens } = r;
    const corpo: RespostaPainel = {
      ok: true,
      itens,
      crm,
      total: lista.length,
      contagens: { ...contagens, avisos: avisos.map(({ slugs, ...a }) => ({ ...a, total: slugs.length })) },
      funil: resumo,
      versao: pronto.versao,
      montadoEm: new Date(pronto.montadoEm).toISOString(),
    };
    const ms = performance.now() - inicio;
    if (ms > LENTA_MS) console.warn(`[painel] consulta lenta: ${ms.toFixed(0)} ms`, semDadoPessoal(filtros));
    return Response.json(corpo, { headers: CABECALHOS });
  } catch (err) {
    console.error("[painel] falha na consulta", err instanceof Error ? err.name : typeof err, semDadoPessoal(filtros));
    return erro("falha", "Não foi possível agora.");
  }
}

// sem as chaves do Google o token não foi julgado: "sessão expirada" mandaria a tela renovar o
// token e tentar de novo em laço. fetch que falha é TypeError.
// O JOSEError puro (sem subclasse) é a resposta do Google fora do 200. Pelo código, não por
// instanceof: com duas cópias do jose carregadas (CJS e ESM), a classe não é a mesma.
const CODIGOS_DE_REDE: unknown[] = [errors.JWKSTimeout.code, errors.JWKSInvalid.code, errors.JOSEError.code];
const semRede = (err: unknown) => err instanceof TypeError || (err instanceof Error && CODIGOS_DE_REDE.includes((err as { code?: unknown }).code));

// a busca pode ser um telefone: no log vai só o tamanho dela
const semDadoPessoal = ({ busca, ...resto }: { busca: string }) => ({ ...resto, busca: busca.length });
