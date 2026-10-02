import type { MetadataRoute } from "next";

// O painel instalado na tela inicial. Abre direto em /painel (a lista de negócios de
// quem entrou, que leva à agenda). Os sites dos clientes ficam em outro domínio
// ({slug}.ruphus.site), onde este manifesto não existe: quem agenda não instala nada.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/painel",
    name: "Ruphus — painel do negócio",
    short_name: "Ruphus",
    description: "Agenda, clientes e serviços do seu negócio.",
    lang: "pt-BR",
    start_url: "/painel",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#ffffff",
    categories: ["business", "productivity"],
    icons: [
      { src: "/app/icone-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/app/icone-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/app/icone-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
