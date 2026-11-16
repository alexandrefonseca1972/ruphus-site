// Qual modelo um negócio usa (D5). Puro: o catálogo e a config chegam prontos (F2 lê do banco).
// `gerado.personal` entra depois, no render, por cima do que sair daqui.
import type { ConfigModelos, DefModelo, RefModelo } from "@/lib/modelos/tipos";

export type EntradaCatalogo = { publicado: DefModelo; versao: number; versoes?: Record<number, DefModelo> };
export type Catalogo = Map<string, EntradaCatalogo>;
/** `escolha.modelo`: a escolha manual da gaveta antiga (site), ainda sem `modelo`. */
export type GeradoModelo = { sub: string; origem?: "prospeccao" | "cadastro"; publicadoEm?: unknown; modelo?: RefModelo | null; bio?: RefModelo | null; escolha?: { modelo?: string } | null };
export type Resolvido =
  | { def: DefModelo; versao: number; origem: "negocio" | "padrao" }
  | { def: null; versao: null; origem: "legado" };

/** Cliente: fechou no CRM, se cadastrou sozinho, aceitou o convite (membro com viaConvite) ou teve
 *  o site publicado (entrada paga, gerado.publicadoEm): os mesmos sinais de "negócio assumido pelo
 *  dono" do gerador (gerarNoBanco). É quem nunca muda sem o admin mandar. */
export const ehClienteAtivo = (gerado: { origem?: unknown; publicadoEm?: unknown }, crmEstagio?: string | null, conviteAceito = false) =>
  crmEstagio === "fechado" || gerado.origem === "cadastro" || !!gerado.publicadoEm || conviteAceito;

const LEGADO: Resolvido = { def: null, versao: null, origem: "legado" };

export function resolverModelo(
  { gerado, crmEstagio, conviteAceito }: { gerado: GeradoModelo; crmEstagio?: string | null; conviteAceito?: boolean },
  catalogo: Catalogo,
  config: ConfigModelos,
  tipo: "site" | "bio",
): Resolvido {
  // 1. o modelo do próprio negócio, ligado ou não: desligar só tira o modelo das listas
  const ref = tipo === "site" ? gerado.modelo : gerado.bio;
  const doNegocio = ref ? catalogo.get(ref.id) : undefined;
  if (ref && doNegocio) {
    // versão congelada; sem a foto dela (dado quebrado), a publicada é o melhor que há
    const congelada = ref.versao == null ? undefined : ref.versao === doNegocio.versao ? doNegocio.publicado : doNegocio.versoes?.[ref.versao];
    if (ref.versao != null && !congelada) console.error(`[modelos] ${ref.id}@${ref.versao} sem foto da versão; sigo com a publicada (v${doNegocio.versao})`);
    return congelada
      ? { def: congelada, versao: ref.versao!, origem: "negocio" }
      : { def: doNegocio.publicado, versao: doNegocio.versao, origem: "negocio" };
  }
  // 2. a escolha manual da gaveta antiga (só existe no site) também é do negócio: segue a publicada
  // e nunca recebe o padrão do ramo; na bio (id de outro tipo) fica a de sempre. O cliente que só
  // tem a escolha é congelado antes de qualquer publicação (repo.publicar), então a publicada é a dele
  const escolhido = gerado.escolha?.modelo;
  if (escolhido) {
    const e = catalogo.get(escolhido);
    return e?.publicado.tipo === tipo ? { def: e.publicado, versao: e.versao, origem: "negocio" } : LEGADO;
  }
  // 3. padrão do ramo: só para prospecção, porque trocar o padrão não pode mexer em cliente
  if (ehClienteAtivo(gerado, crmEstagio, conviteAceito)) return LEGADO;
  const padroes = config.padroes[tipo];
  const id = padroes[gerado.sub] ?? (tipo === "bio" ? padroes.todos : undefined);
  const padrao = id ? catalogo.get(id) : undefined;
  if (padrao) return { def: padrao.publicado, versao: padrao.versao, origem: "padrao" };
  // 4. o caminho de hoje: gerado.escolha ou o sorteio pelo slug (e a bio atual)
  return LEGADO;
}
