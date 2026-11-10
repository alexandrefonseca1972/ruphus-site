const canal = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const lum = (rgb: number[]) => 0.2126 * canal(rgb[0] / 255) + 0.7152 * canal(rgb[1] / 255) + 0.0722 * canal(rgb[2] / 255);

/** Luminância relativa (WCAG) de "#RRGGBB". */
export const luminancia = (hex: string) => lum([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)));

/** O destaque do topo sobre a foto escurecida (--gold no modelo claro, a segunda linha do nome
 *  no editorial): paletas de azul, verde-petróleo, marrom e vinho escuros sumiam ali ("no seu
 *  ritmo" no idiomas-3, "Estrelas" no Barbeiro das Estrelas). Clareia a mesma cor, só no topo, até dar
 *  3,5:1 (3:1 é o mínimo para título; a margem cobre foto clara atrás do nome)
 *  contra o fundo do título (#3f4441, a foto sob o escurecido). Cor que já passa volta igual. */
export function destaqueNoTopo(hex: string): string {
  const fundo = lum([0x3f, 0x44, 0x41]);
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  for (let t = 0; t <= 1; t += 0.05) {
    const m = rgb.map((c) => Math.round(c + (255 - c) * t));
    if ((lum(m) + 0.05) / (fundo + 0.05) >= 3.5) return "#" + m.map((c) => c.toString(16).padStart(2, "0")).join("").toUpperCase();
  }
  return "#FFFFFF";
}
