import type { PropsBio } from "../partes";
import Agenda from "./agenda";
import Atual from "./atual";
import Clara from "./clara";
import Galeria from "./galeria";

/** O layout que a bio usa. Galeria sem 3 fotos vira Clara; layout ainda sem código (cartaz,
 *  vidro…, F4.5) fica na bio atual. */
export default function LayoutDaBio(props: PropsBio) {
  const { layout, fotos } = props.bio;
  if (layout === "galeria" && fotos.length >= 3) return <Galeria {...props} />;
  if (layout === "galeria" || layout === "clara") return <Clara {...props} />;
  if (layout === "agenda") return <Agenda {...props} />;
  return <Atual {...props} />;
}
