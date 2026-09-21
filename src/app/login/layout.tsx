import { Bebas_Neue } from "next/font/google";

// A condensada do wordmark, como na /sobre. A mono dos rótulos é a Geist Mono
// que o layout raiz já carrega: uma fonte nova só onde ela é a marca.
const titulo = Bebas_Neue({ weight: "400", subsets: ["latin"], variable: "--fonte-titulo" });

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <div className={`${titulo.variable} flex flex-1 flex-col`}>{children}</div>;
}
