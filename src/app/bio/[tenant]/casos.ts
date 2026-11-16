// Casos de teste da prévia no Estúdio (tipos.ts `Caso`): o mesmo negócio, apertado num canto.
// Puro: transforma os dados lidos, nada é gravado.
import type { Caso } from "@/lib/modelos/tipos";
import type { Bio } from "./carregar";

export function aplicarCaso(bio: Bio, caso: Caso = "normal"): Bio {
  switch (caso) {
    case "longo":
      return { ...bio, nome: `${bio.nome} Estúdio de Beleza e Bem-Estar Integral` };
    case "semnota":
      return { ...bio, nota: null, avaliacoes: null };
    case "poucas":
      return { ...bio, fotos: bio.fotos.slice(0, 1) };
    case "umserv":
      return { ...bio, servicos: bio.servicos.slice(0, 1) };
    case "semprec":
      return { ...bio, servicos: bio.servicos.map((s) => ({ ...s, preco: 0 })) };
    default:
      return bio;
  }
}
