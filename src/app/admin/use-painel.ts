import { useEffect, useRef, useState } from "react";
import { auth } from "@/lib/firebase";
import type { Filtros, RespostaPainel } from "@/lib/painel-tipos";

// A página da lista vinda de GET /api/admin/painel (docs/plano-paginacao-admin.md, 3.4 e 6.2).
// fetch, não server action: o Next despacha uma action por vez, e a busca digitada viraria fila.

export type PaginaDoServidor = Extract<RespostaPainel, { ok: true }>;
export type SituacaoDaPagina = "carregando" | "preparando" | "pronto" | "erro";

const ESPERA_BUSCA_MS = 300;
const NOVA_TENTATIVA_MS = 2000;

const token = (renovar = false) => (auth.currentUser?.getIdToken(renovar) ?? Promise.resolve("")).catch(() => "");

/** Pede a página dos filtros. Busca digitada espera 300 ms; pedido velho é cancelado e resposta
 *  fora de ordem, descartada; 503 tenta de novo sozinho; 401 renova o token uma vez; queda de rede
 *  mantém a página que já está na tela, com o erro ao lado. `recarga` muda depois de uma escrita. */
export function usePainel({ ativo, filtros, n, hoje, recarga }: { ativo: boolean; filtros: Filtros; n: number; hoje: string; recarga: number }) {
  const [pagina, setPagina] = useState<PaginaDoServidor | null>(null);
  const [situacao, setSituacao] = useState<SituacaoDaPagina>("carregando");
  const [erro, setErro] = useState("");
  const [tentativa, setTentativa] = useState(0);
  const seq = useRef(0);
  const ultimaBusca = useRef(filtros.busca);

  const params = new URLSearchParams({ hoje, n: String(n), tz: Intl.DateTimeFormat().resolvedOptions().timeZone });
  for (const [k, v] of Object.entries(filtros)) if (v !== "" && v !== false) params.set(k, String(v));
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
        if (meu !== seq.current) return;
        if (corpo?.ok) {
          setPagina(corpo);
          setSituacao("pronto");
          setErro("");
          return;
        }
        if (corpo?.codigo === "preparando") {
          setSituacao("preparando");
          nova = setTimeout(() => setTentativa((x) => x + 1), NOVA_TENTATIVA_MS);
          return;
        }
        setSituacao("erro");
        setErro(corpo?.erro ?? "Não foi possível agora.");
      } catch (err) {
        if (controle.signal.aborted || meu !== seq.current) return;
        console.error("[painel] falha ao pedir a página", err);
        setSituacao("erro");
        setErro("Sem conexão com o servidor.");
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

  return { pagina, situacao, erro, tentarDeNovo: () => setTentativa((x) => x + 1) };
}
