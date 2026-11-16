// Os modelos que já existem em código (60 editoriais e os do claro), mais um de bio por layout
// pronto, como DefModelo: kit e paleta por valor, ids iguais aos de hoje (gerado.escolha.modelo).
// O banco (F2) guarda só o que mudou neles.
import { type Sub, SUBS } from "@/lib/gerador";
import { ehClaro, modelosClaro, visualClaro } from "@/lib/site-claro";
import { MODELOS, modeloDoId } from "@/lib/site-editorial";
import type { DefModelo, LayoutBio } from "@/lib/modelos/tipos";

const editoriais: DefModelo[] = MODELOS.map((m) => ({
  id: m.id,
  tipo: "site",
  sub: m.sub,
  layout: "editorial",
  kit: m.pasta,
  paleta: { ink: m.paleta[0], acc: m.paleta[1], deep: m.paleta[2], tint: m.paleta[3] },
  nome: m.rotulo,
  ativo: true,
}));

// variável CSS do tema claro da paleta ("--accent:#1E5A8A;…")
const varCss = (tema: string, nome: string) => new RegExp(`--${nome}:(#[0-9A-F]{6})`, "i").exec(tema)![1];

// o mesmo caminho do render: visualClaro com a escolha do modelo (índices dentro do ramo, então
// o slug não pesa); sem `personal`, fotos.hero é a foto do topo do banco
const claros: DefModelo[] = (Object.keys(SUBS) as Sub[]).filter(ehClaro).flatMap((sub) =>
  modelosClaro(sub).map((m) => {
    const v = visualClaro(m.id, sub, m.escolha);
    const tema = v.paleta[0];
    return {
      id: m.id,
      tipo: "site" as const,
      sub,
      layout: "claro" as const,
      kit: v.fotos.hero,
      paleta: { ink: varCss(tema, "accent"), acc: varCss(tema, "gold"), deep: varCss(tema, "text"), tint: varCss(tema, "bg") },
      nome: m.rotulo,
      ativo: true,
    };
  }),
);

// Um modelo de bio por layout pronto (F4), com foto e cor de amostra de um modelo de site. Todos
// valem para qualquer ramo ("todos"): o layout da bio não é de um ramo, e a foto e a cor de cada
// negócio vêm do site dele. "atual" é a bio de hoje.
const BIOS: [LayoutBio, string, string][] = [
  ["atual", "cabeleireira-1", "Bio atual"],
  ["clara", "esteticista-1", "Bio clara"],
  ["galeria", "esmalteria-1", "Bio galeria"],
  ["agenda", "barbearia-1", "Bio agenda"],
  ["cartaz", "barbearia-2", "Bio cartaz"],
  ["vidro", "sobrancelha-1", "Bio vidro"],
  ["painel", "tatuador-1", "Bio painel"],
  ["noturno", "cabeleireira-2", "Bio noturno"],
  ["stories", "cilios-1", "Bio stories"],
];
const bios: DefModelo[] = BIOS.map(([layout, base, nome]) => {
  const m = modeloDoId(base)!;
  return {
    id: `bio-${layout}`,
    tipo: "bio",
    sub: "todos",
    layout,
    kit: m.pasta,
    paleta: { ink: m.paleta[0], acc: m.paleta[1], deep: m.paleta[2], tint: m.paleta[3] },
    nome,
    ativo: true,
  };
});

export const EMBUTIDOS: DefModelo[] = [...editoriais, ...claros, ...bios];
