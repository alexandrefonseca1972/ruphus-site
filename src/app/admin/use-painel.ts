import { useEffect, useRef, useState } from "react";
import { auth } from "@/lib/firebase";
import type { Periodo } from "@/lib/funil-consulta";
import type { Filtros, RespostaPainel } from "@/lib/painel-tipos";

// A página da lista vinda de GET /api/admin/painel (docs/plano-paginacao-admin.md, 3.4 e 6.2).
// fetch, não server action: o Next despacha uma action por vez, e a busca digitada viraria fila.

export type PaginaDoServidor = Extract<RespostaPainel, { ok: true }>;
type Guardada = PaginaDoServidor & { query: string };
export type SituacaoDaPagina = "carregando" | "preparando" | "pronto" | "erro";

const ESPERA_BUSCA_MS = 300;
const NOVA_TENTATIVA_MS = 2000;
/** ~30 s esperando a montagem; depois disso é erro, com "Tentar de novo" (e para de pedir) */
const TENTATIVAS_MAX = 15;

const token = (renovar = false) => (auth.currentUser?.getIdToken(renovar) ?? Promise.resolve("")).catch(() => "");

/** Pede a página dos filtros. Busca digitada espera 300 ms; pedido velho é cancelado e resposta
 *  fora de ordem, descartada; 503 tenta de novo sozinho; 401 renova o token uma vez; queda de rede
 *  mantém a página que já está na tela, com o erro ao lado. `recarga` muda depois de uma escrita.
 *  A página só é devolvida se for a dos filtros atuais: a de um filtro anterior, com outros negócios,
 *  levaria o "marcar todos" a marcar quem não está na tela pedida. */
export function usePainel({
  ativo,
  filtros,
  n,
  hoje,
  recarga,
  funil,
}: {
  ativo: boolean;
  filtros: Filtros;
  n: number;
  hoje: string;
  recarga: number;
  /** na aba Funil: o resumo do período, com `novos` cartões na coluna "Novo" */
  funil?: { periodo: Periodo; novos: number };
}) {
  const [pagina, setPagina] = useState<Guardada | null>(null);
  // a situação vale para a consulta que a produziu: erro de um filtro anterior não fica ao lado da lista nova
  const [status, setStatus] = useState<{ situacao: SituacaoDaPagina; erro: string; query: string }>({ situacao: "carregando", erro: "", query: "" });
  const [tentativa, setTentativa] = useState(0);
  const seq = useRef(0);
  const ultimaBusca = useRef(filtros.busca);
  const esperas = useRef(0);

  const params = new URLSearchParams({ hoje, n: String(n), tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
  for (const [k, v] of Object.entries(filtros)) if (v !== "" && v !== false) params.set(k, String(v));
  if (funil) {
    params.set("funil", "1");
    params.set("periodo", funil.periodo);
    params.set("novos", String(funil.novos));
  }
  const query = params.toString();

  useEffect(() => {
    if (!ativo) return;
    const meu = ++seq.current;
    const controle = new AbortController();
    let nova: ReturnType<typeof setTimeout> | undefined;
    // só a busca digitada espera; chip e "mostrar mais" vão na hora
    const esperar = filtros.busca !== ultimaBusca.current ? ESPERA_BUSCA_MS : 0;
    ultimaBusca.current = filtros.busca;

    const pedir = async (t: string) =>
      fetch(`/api/admin/painel?${query}`, { headers: { authorization: `Bearer ${t}` }, signal: controle.signal, cache: "no-store" });

    const inicio = setTimeout(async () => {
      try {
        let res = await pedir(await token());
        if (res.status === 401) res = await pedir(await token(true));
        const corpo = (await res.json().catch(() => null)) as RespostaPainel | null;
        if (controle.signal.aborted || meu !== seq.current) return;
        if (corpo?.ok) {
          esperas.current = 0;
          setPagina({ ...corpo, query });
          setStatus({ situacao: "pronto", erro: "", query });
          return;
        }
        if (corpo?.codigo === "preparando" && ++esperas.current <= TENTATIVAS_MAX) {
          setStatus({ situacao: "preparando", erro: "", query });
          nova = setTimeout(() => setTentativa((x) => x + 1), NOVA_TENTATIVA_MS);
          return;
        }
        esperas.current = 0;
        setStatus({ situacao: "erro", erro: corpo?.codigo === "preparando" ? "O painel não ficou pronto." : (corpo?.erro ?? "Não foi possível agora."), query });
      } catch (err) {
        if (controle.signal.aborted || meu !== seq.current) return;
        console.error("[painel] falha ao pedir a página", err);
        esperas.current = 0;
        setStatus({ situacao: "erro", erro: "Sem conexão com o servidor.", query });
      }
    }, esperar);

    return () => {
      clearTimeout(inicio);
      clearTimeout(nova);
      controle.abort();
    };
    // query já carrega filtros, n e hoje
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ativo, query, recarga, tentativa]);

  const atual = status.query === query;
  return {
    pagina: pagina?.query === query ? pagina : null,
    situacao: atual ? status.situacao : "carregando",
    erro: atual ? status.erro : "",
    tentarDeNovo: () => setTentativa((x) => x + 1),
  };
}
