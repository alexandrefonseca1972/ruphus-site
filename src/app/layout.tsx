import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Ruphus",
  description: "Site e agendamento online para pequenos negócios de bairro.",
  // O app (login, painel, admin, agenda de cada negócio) não é página de busca, e /{slug}
  // responde qualquer endereço. Quem aparece no Google é a landing e a privacidade,
  // HTML estático em public/, e os sites publicados, cada um com o seu robots.
  robots: { index: false, follow: false },
  // painel instalado no iPhone: abre sem a barra do Safari, com o ícone e o nome certos
  appleWebApp: { capable: true, title: "Ruphus", statusBarStyle: "default" },
  icons: { apple: "/app/apple-touch-icon.png" },
};

// viewportFit cover: as áreas seguras do iPhone passam a valer (barra de gestos)
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  // uma cor só: fora do painel tudo é claro, e a barra preta ficava sobre página branca
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Tema do sistema antes da primeira pintura: sem piscar branco no celular à noite */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "try{if(matchMedia('(prefers-color-scheme: dark)').matches)document.documentElement.classList.add('dark')}catch(e){}",
          }}
        />
        {/* O Chrome avisa que dá para instalar uma vez por carregamento, em geral ainda no /login.
            Login → /painel → /{slug} é navegação do router: sem guardar aqui, o painel nunca via o convite */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__conviteInstalar=e;dispatchEvent(new Event('ruphus:instalar'))})",
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
