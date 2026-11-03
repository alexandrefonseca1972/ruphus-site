import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { ErroPrevisto } from "@/lib/erro-previsto";
import { integracao } from "@/lib/integracoes.server";
import { NOMES_FONTE, type Personal } from "@/lib/site-editorial";

// O assistente da seção "Visual" da gaveta: recebe o pedido do admin em linguagem corrente
// ("deixa mais escuro", "reescreve o Sobre", "sugere uma paleta pelas fotos") e devolve uma
// resposta curta mais as mudanças no mesmo formato de gerado.personal. Uma chamada por
// turno, resposta estruturada (sem laço de ferramentas): a gaveta mostra as mudanças, o
// admin marca o que aplica e vê a prévia. A IA nunca mexe em fotos: só o admin sobe foto.

export const MODELO = "claude-opus-5-5";

// cada campo é obrigatório e null quer dizer "não mexer": o esquema fica fechado, o que a
// saída estruturada exige, e a conversão para Personal descarta os nulos
// sem transform: o esquema vira JSON Schema para a saída estruturada; a minúscula é feita em lerResposta
const HEX = z.string().regex(/^#[0-9a-f]{6}$/i);
export const RespostaIA = z.object({
  resposta: z.string().max(600),
  mudancas: z.object({
    cores: z.object({ ink: HEX.nullable(), acc: HEX.nullable() }),
    fonte: z.enum(NOMES_FONTE).nullable(),
    textos: z.object({ frase: z.string().max(160).nullable(), sobre: z.string().max(600).nullable(), galeria: z.string().max(60).nullable() }),
  }),
});
export type RespostaIA = z.infer<typeof RespostaIA>;

export type Mensagem = { papel: "user" | "assistant"; texto: string };
export type PedidoIA = {
  negocio: { nome: string; ramo: string; cidade: string; uf: string; bairro: string; servicos: string[]; horario: string };
  /** o visual em uso (com o rascunho por cima), para a IA partir dele */
  atual: { cores: { ink: string; acc: string }; fonte: string; textos: Personal["textos"]; fotosProprias: string[] };
  /** miniaturas das fotos próprias (JPEG ≤ 512 px), na ordem de `atual.fotosProprias` */
  fotos: string[];
  historico: Mensagem[];
  pedido: string;
};

const SISTEMA = `Você é o assistente visual da Ruphus, que monta sites e agenda online para salões, barbearias, estética, unhas, tatuagem, podologia, academias e oficinas no Brasil. Quem fala com você é o admin da Ruphus, ajustando o site de um negócio.

O site tem um modelo fixo; o que dá para mudar é: cores (tinta = fundo do topo e dos botões; destaque = detalhes, itálico e a cor da bio), a fonte dos títulos (só entre: ${NOMES_FONTE.join(", ")}), e três textos (frase do topo até 160 caracteres, Sobre até 600, título da galeria até 60). Fotos só o admin envia: nunca sugira nem altere fotos; se pedirem, diga que a foto é enviada pelos botões da seção.

Regras:
- Responda em português do Brasil, em até três frases, sem emoji e sem listas. Diga o que mudou e por quê.
- Em "mudancas", preencha só o que o pedido pede; o resto fica null (não mexer). Nunca invente mudanças.
- Cores em hex de 6 dígitos. Tinta escura (legível com texto branco), destaque saturado e com contraste sobre branco. Ao sugerir uma paleta a partir das fotos, tire as cores das fotos e explique em uma frase.
- Textos na voz do produto: direto, segunda pessoa, concreto, sem preço, sem promessa médica ou de resultado, sem superlativo ("o melhor da cidade"), sem ponto de exclamação em série. Use o nome, o ramo, o bairro e os serviços do negócio.
- Se o pedido não couber no que dá para mudar, diga isso e deixe tudo null.`;

/** Os parâmetros da chamada, montados à parte para o teste conferir sem rede. */
export function montarPedido(p: PedidoIA) {
  const contexto = JSON.stringify({ negocio: p.negocio, visualAtual: p.atual });
  const fotos: Anthropic.Beta.BetaContentBlockParam[] = p.fotos.map((data) => ({ type: "image", source: { type: "base64", media_type: "image/jpeg", data } }));
  return {
    model: MODELO,
    max_tokens: 4000,
    // o bloco estável vai primeiro e em cache: o que muda é o negócio e o pedido
    system: [{ type: "text", text: SISTEMA, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: `Negócio e visual em uso:\n${contexto}` },
          ...fotos,
          { type: "text", text: fotos.length ? `As imagens acima são as fotos próprias do negócio, na ordem: ${p.atual.fotosProprias.join(", ")}.` : "O negócio ainda não enviou fotos próprias." },
        ],
      },
      ...p.historico.map((m): Anthropic.Beta.BetaMessageParam => ({ role: m.papel, content: m.texto })),
      { role: "user", content: p.pedido },
    ],
    output_config: { effort: "medium", format: zodOutputFormat(RespostaIA) },
    // recusa do classificador cai noutro modelo no próprio pedido, em vez de voltar vazia
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  } satisfies Anthropic.Beta.MessageCreateParamsNonStreaming;
}

/** O que a IA devolveu, já no formato de gerado.personal (nulos descartados). */
export function lerResposta(msg: Pick<Anthropic.Beta.BetaMessage, "stop_reason"> & { parsed_output?: unknown }): { resposta: string; mudancas: Personal } {
  if (msg.stop_reason === "refusal") throw new ErroPrevisto("A IA não aceitou esse pedido. Reformule.");
  if (msg.stop_reason === "max_tokens") throw new ErroPrevisto("A resposta ficou longa demais. Peça algo mais curto.");
  const lida = msg.parsed_output ? RespostaIA.safeParse(msg.parsed_output) : null;
  if (!lida?.success) throw new ErroPrevisto("A IA respondeu fora do formato. Tente de novo.");
  const { cores, fonte, textos } = lida.data.mudancas;
  const semNulos = (o: Record<string, string | null>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v != null).map(([k, v]) => [k, v!.startsWith("#") ? v!.toLowerCase() : v]));
  const mudancas: Personal = {
    ...(Object.values(cores).some((v) => v) && { cores: semNulos(cores) }),
    ...(fonte && { fonte }),
    ...(Object.values(textos).some((v) => v) && { textos: semNulos(textos) }),
  };
  return { resposta: lida.data.resposta, mudancas };
}

export const iaDisponivel = async () => !!(await integracao("ANTHROPIC_API_KEY"));

export async function sugerirVisual(p: PedidoIA) {
  const chave = await integracao("ANTHROPIC_API_KEY");
  if (!chave) throw new ErroPrevisto("Cadastre a chave da Anthropic em Ajustes.");
  const cliente = new Anthropic({ apiKey: chave });
  try {
    return lerResposta(await cliente.beta.messages.parse(montarPedido(p)));
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new ErroPrevisto("A chave da Anthropic não vale. Confira em Ajustes.");
    if (err instanceof Anthropic.RateLimitError) throw new ErroPrevisto("Muitos pedidos à IA agora. Espere um minuto.");
    if (err instanceof Anthropic.APIConnectionError) throw new ErroPrevisto("Sem resposta da Anthropic. Tente de novo.");
    throw err;
  }
}
