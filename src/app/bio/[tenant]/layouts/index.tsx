import type { PropsBio } from "../partes";
import Agenda from "./agenda";
import Atual from "./atual";
import Cartaz from "./cartaz";
import Clara from "./clara";
import Galeria from "./galeria";
import Noturno from "./noturno";
import Painel from "./painel";
import Stories from "./stories";
import Vidro from "./vidro";

const LAYOUTS = { agenda: Agenda, cartaz: Cartaz, clara: Clara, galeria: Galeria, noturno: Noturno, painel: Painel, stories: Stories, vidro: Vidro };

/** O layout que a bio usa. Galeria e Stories sem 3 fotos viram Clara; o resto (e "atual") fica
 *  na bio de sempre. */
export default function LayoutDaBio(props: PropsBio) {
  const { layout, fotos } = props.bio;
  if ((layout === "galeria" || layout === "stories") && fotos.length < 3) return <Clara {...props} />;
  const Layout = Object.hasOwn(LAYOUTS, layout) ? LAYOUTS[layout as keyof typeof LAYOUTS] : Atual;
  return <Layout {...props} />;
}
