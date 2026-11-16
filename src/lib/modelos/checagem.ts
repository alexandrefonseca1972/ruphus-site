// Checagem automática do Estúdio: o que o admin precisa saber antes de publicar um modelo.
// Puro: recebe o modelo e, opcionalmente, o negócio do caso de teste da prévia.
import { luminancia } from "@/lib/contraste";
import type { DefModelo } from "@/lib/modelos/tipos";

export type Aviso = { nivel: "ok" | "aviso" | "erro"; titulo: string; texto: string };
/** O negócio da prévia: quantas fotos ele tem, o nome e quantas avaliações. */
export type Negocio = { fotos?: number; nome?: string; avaliacoes?: number };

/** Razão de contraste WCAG entre duas cores "#RRGGBB" (1 a 21). */
export const contraste = (a: string, b: string) => {
  const [claro, escuro] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (claro + 0.05) / (escuro + 0.05);
};

// ponytail: pesos estimados a mão (HTML + CSS + fotos no celular); medir de verdade na F4
const PESO_KB: Record<DefModelo["layout"], number> = {
  editorial: 280, claro: 240,
  atual: 180, clara: 200, galeria: 340, agenda: 160, cartaz: 220, vidro: 320, painel: 260, noturno: 200, stories: 380,
};
// fotos do kit sem foto própria: o editorial e a bio têm hero + ga1..3; o claro, só a do topo
const fotosDoKit = (m: DefModelo) => (m.layout === "claro" ? 1 : 4);

export function checar(m: DefModelo, n: Negocio = {}): Aviso[] {
  const avisos: Aviso[] = [];
  // o botão principal tem texto branco: no editorial e na bio é o --acc; no claro, o --accent (ink)
  const botao = m.layout === "claro" ? m.paleta.ink : m.paleta.acc;
  const r = contraste(botao, "#FFFFFF");
  const razao = r.toFixed(1).replace(".", ",");
  if (r >= 4.5) avisos.push({ nivel: "ok", titulo: "Contraste do botão", texto: `Texto branco sobre ${botao}: ${razao}:1.` });
  else if (r >= 3) avisos.push({ nivel: "aviso", titulo: "Contraste do botão", texto: `Texto branco sobre ${botao} dá ${razao}:1, abaixo de 4,5:1. Escureça um pouco a cor de destaque.` });
  else avisos.push({ nivel: "erro", titulo: "Contraste do botão", texto: `Texto branco sobre ${botao} dá ${razao}:1 e fica difícil de ler. Escureça bem a cor de destaque (ou use a cor "deep").` });

  const fotos = n.fotos ?? fotosDoKit(m);
  if ((m.layout === "galeria" || m.layout === "stories") && fotos < 3)
    avisos.push({ nivel: "aviso", titulo: "Poucas fotos", texto: `O layout ${m.layout} precisa de pelo menos 3 fotos e o negócio tem ${fotos}. Sem elas, a bio volta para a Clara.` });

  if (PESO_KB[m.layout] > 300)
    avisos.push({ nivel: "aviso", titulo: "Página pesada", texto: `Cerca de ${PESO_KB[m.layout]} KB no celular. Em rede 3G demora para abrir: prefira fotos menores.` });

  if (m.layout === "vidro")
    avisos.push({ nivel: "aviso", titulo: "Celular simples", texto: "O efeito de vidro (desfoque) trava em celular mais fraco. Confira a prévia num aparelho simples." });

  // o claro carrega Bricolage e Figtree; com fonte própria vira a terceira família
  if (m.layout === "claro" && m.fonte)
    avisos.push({ nivel: "aviso", titulo: "Muitas fontes", texto: `${m.fonte} entra como terceira fonte da página. Duas bastam: tire a fonte do modelo se não fizer falta.` });

  if ((m.layout === "cartaz" || m.layout === "painel") && (n.nome?.length ?? 0) > 24)
    avisos.push({ nivel: "aviso", titulo: "Nome longo", texto: `"${n.nome}" tem ${n.nome!.length} letras e quebra em várias linhas no ${m.layout}. Confira a prévia com o caso "nome longo".` });

  if ((m.layout === "stories" || m.layout === "vidro") && !n.avaliacoes)
    avisos.push({ nivel: "aviso", titulo: "Sem avaliações", texto: `O ${m.layout} mostra a nota do Google em destaque; sem avaliações, o espaço fica vazio.` });

  return avisos;
}
