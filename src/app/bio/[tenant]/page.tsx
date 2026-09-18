import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { adminDb } from "@/lib/admin";

const SLUG = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;

type Bio = {
  nome: string;
  cidade: string | null;
  uf: string | null;
  telefone: string | null;
  instagram: string | null;
  endereco: string | null;
  nota: number | null;
  avaliacoes: number | null;
  cor: string;
  foto: string | null;
  servicos: string[];
};

/** O que o minisite mostra: tudo já vem do tenant, nada de novo para cadastrar. */
const carregar = cache(async (slug: string): Promise<Bio | null> => {
  if (!SLUG.test(slug)) return null;
  const t = adminDb.collection("tenants").doc(slug);
  const [tenant, servicos] = await Promise.all([t.get(), t.collection("services").where("active", "==", true).get()]);
  if (!tenant.exists) return null;
  return {
    nome: String(tenant.get("name")),
    cidade: tenant.get("site.city") ?? null,
    uf: tenant.get("site.uf") ?? null,
    telefone: tenant.get("site.phone") ?? null,
    instagram: tenant.get("site.instagram") ?? null,
    endereco: tenant.get("site.address") ?? null,
    nota: tenant.get("site.rating") ?? null,
    avaliacoes: tenant.get("site.reviews") ?? null,
    cor: tenant.get("site.color") ?? "#17150F",
    foto: tenant.get("site.photo") ?? null,
    servicos: servicos.docs.map((d) => String(d.get("name"))).slice(0, 6),
  };
});

export async function generateMetadata({ params }: PageProps<"/bio/[tenant]">): Promise<Metadata> {
  const { tenant } = await params;
  const bio = await carregar(tenant);
  if (!bio) return { title: "Minisite" };
  const local = bio.cidade ? ` · ${bio.cidade}${bio.uf ? `/${bio.uf}` : ""}` : "";
  return {
    title: `${bio.nome}${local}`,
    description: `Agende online, fale no WhatsApp e veja onde fica ${bio.nome}.`,
    robots: { index: false, follow: false },
    // o ícone é gerado em /bio/<slug>/icon; no subdomínio do site o caminho precisa ser absoluto
    icons: { icon: `https://www.ruphus.site/bio/${tenant}/icon` },
    openGraph: {
      title: bio.nome,
      description: `Agende online, fale no WhatsApp e veja onde fica ${bio.nome}.`,
      images: [`https://${tenant}.ruphus.site/og.jpg`],
      type: "website",
      locale: "pt_BR",
    },
  };
}

// contraste: sobre cor escura o texto é claro, sobre clara é escuro
function claro(hex: string) {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) || 0);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

function Link({
  href,
  titulo,
  detalhe,
  destaque,
  cor,
  externo,
}: {
  href: string;
  titulo: string;
  detalhe: string;
  destaque?: boolean;
  cor: string;
  externo?: boolean;
}) {
  const texto = claro(cor) ? "#17150F" : "#FFFFFF";
  return (
    <a
      href={href}
      {...(externo ? { target: "_blank", rel: "noreferrer" } : {})}
      className="flex min-h-14 items-center gap-3 rounded-2xl border px-5 py-3.5 transition-transform active:scale-[0.99]"
      style={
        destaque
          ? { background: cor, borderColor: cor, color: texto }
          : { background: "#FFFFFF", borderColor: "#E2DDD3", color: "#17150F" }
      }
    >
      <span className="grow">
        <span className="block text-[15px] font-semibold leading-tight">{titulo}</span>
        <span className="block text-[13px] leading-tight opacity-70">{detalhe}</span>
      </span>
      <span aria-hidden="true" className="text-lg opacity-60">
        ›
      </span>
    </a>
  );
}

export default async function BioPage({ params }: PageProps<"/bio/[tenant]">) {
  const { tenant } = await params;
  const bio = await carregar(tenant);
  if (!bio) notFound();

  const local = [bio.cidade, bio.uf].filter(Boolean).join("/");
  const mapa = bio.endereco
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${bio.nome} ${bio.endereco}`)}`
    : null;
  const zap = bio.telefone
    ? `https://wa.me/${bio.telefone}?text=${encodeURIComponent(`Olá! Vim pelo Instagram do ${bio.nome}.`)}`
    : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[520px] flex-col gap-5 px-5 pb-12 pt-0">
      <div className="relative -mx-5 h-52 overflow-hidden" style={{ background: bio.cor }}>
        {bio.foto && (
          /* eslint-disable-next-line @next/next/no-img-element -- foto do próprio site do cliente, fora do otimizador */
          <img src={`https://${tenant}.ruphus.site${bio.foto}`} alt="" className="size-full object-cover" />
        )}
        <div
          className="absolute inset-x-0 bottom-0 h-16"
          style={{ background: "linear-gradient(to top, #F7F5F1 6%, rgba(247,245,241,0))" }}
        />
      </div>

      <header className="flex flex-col items-center gap-2 text-center">
        <h1 className="text-balance text-2xl font-semibold leading-tight">{bio.nome}</h1>
        <p className="text-sm text-[#6F6A5E]">
          {local || "Atendimento local"}
          {bio.nota ? ` · ★ ${bio.nota.toFixed(1).replace(".", ",")}` : ""}
          {bio.avaliacoes ? ` (${bio.avaliacoes.toLocaleString("pt-BR")} avaliações no Google)` : ""}
        </p>
        {bio.servicos.length > 0 && (
          <ul className="mt-1 flex flex-wrap justify-center gap-1.5">
            {bio.servicos.map((s) => (
              <li key={s} className="rounded-full border border-[#E2DDD3] bg-white px-3 py-1 text-xs text-[#4A4639]">
                {s}
              </li>
            ))}
          </ul>
        )}
      </header>

      <nav aria-label="Atalhos" className="flex flex-col gap-2.5">
        <Link
          href={`https://${tenant}.ruphus.site/agendar`}
          titulo="Agendar online"
          detalhe="escolha o serviço e o horário livre"
          destaque
          cor={bio.cor}
        />
        {zap && <Link href={zap} titulo="Falar no WhatsApp" detalhe="tirar dúvida ou combinar detalhes" cor={bio.cor} externo />}
        {bio.instagram && (
          <Link
            href={`https://instagram.com/${bio.instagram}`}
            titulo="Instagram"
            detalhe={`@${bio.instagram}`}
            cor={bio.cor}
            externo
          />
        )}
        {mapa && <Link href={mapa} titulo="Como chegar" detalhe={bio.endereco ?? "ver no mapa"} cor={bio.cor} externo />}
        <Link href={`https://${tenant}.ruphus.site/`} titulo="Ver o site completo" detalhe="serviços, fotos e avaliações" cor={bio.cor} />
      </nav>

      <footer className="mt-auto pt-6 text-center text-xs text-[#8B8578]">
        {bio.nome} · feito com <a href="https://www.ruphus.site/sobre" className="underline underline-offset-2">Ruphus</a>
      </footer>
    </main>
  );
}
