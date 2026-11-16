import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { telefoneFixo } from "@/lib/contato";
import { carregar, proximosHorarios } from "./carregar";
import LayoutDaBio from "./layouts";

// A página vai para o cache e é refeita no máximo a cada minuto: "aberto agora" e
// "livre hoje às…" continuam atuais, sem ir ao banco a cada visita vinda do Instagram.
export const revalidate = 60;
// Nenhum negócio pré-gerado no build: cada um entra no cache na primeira visita
export function generateStaticParams() {
  return [];
}

export async function generateMetadata({ params }: PageProps<"/bio/[tenant]">): Promise<Metadata> {
  const { tenant } = await params;
  const bio = await carregar(tenant);
  if (!bio) return { title: "Minisite" };
  const local = bio.cidade ? ` · ${bio.cidade}${bio.uf ? `/${bio.uf}` : ""}` : "";
  const acao = bio.agendaOnline && bio.servicos.length ? "Agende online" : "Veja os serviços";
  const contato = telefoneFixo(bio.telefone) ? "ligue para o negócio" : "fale no WhatsApp";
  const descricao = `${acao}, ${contato} e veja onde fica ${bio.nome}.`;
  return {
    title: `${bio.nome}${local}`,
    description: descricao,
    robots: { index: false, follow: false },
    // o ícone é gerado em /bio/<slug>/icon; no subdomínio do site o caminho precisa ser absoluto
    icons: { icon: `https://www.ruphus.site/bio/${tenant}/icon` },
    openGraph: {
      title: bio.nome,
      description: descricao,
      images: [`${bio.site}og.jpg`],
      type: "website",
      locale: "pt_BR",
    },
  };
}

export default async function BioPage({ params }: PageProps<"/bio/[tenant]">) {
  const { tenant } = await params;
  const bio = await carregar(tenant);
  if (!bio) notFound();
  const livres = await proximosHorarios(tenant, bio);
  return <LayoutDaBio tenant={tenant} bio={bio} livres={livres} />;
}
