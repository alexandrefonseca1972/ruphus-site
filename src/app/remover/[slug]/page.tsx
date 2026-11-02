import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { adminDb } from "@/lib/admin";
import { RUPHUS } from "@/lib/catalogo";
import { pedirRemocao, propostaRemovivel } from "@/lib/crm";
import { indiceDoPainel } from "@/lib/painel-indice.server";

// "Pedir remoção", na faixa de cada página de proposta. A remoção pede um clique de confirmação:
// o WhatsApp e os buscadores abrem os links para montar a prévia, e um GET que removesse tiraria
// páginas do ar sem ninguém pedir. Slug inexistente, site pago ou de cliente: a mesma resposta,
// com o caminho para falar com a gente, para a página não virar sonda de quem é cliente.
export const metadata: Metadata = { title: "Remover página · Ruphus", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const SLUG = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

async function remover(slug: string) {
  "use server";
  if (!SLUG.test(slug)) redirect("/");
  if (await pedirRemocao(adminDb, slug)) await indiceDoPainel(adminDb).atualizar([slug]);
  redirect(`/remover/${slug}?feito=1`);
}

export default async function Remover({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ feito?: string }> }) {
  const [{ slug }, { feito }] = await Promise.all([params, searchParams]);
  const proposta = SLUG.test(slug) ? await propostaRemovivel(adminDb, slug) : null;
  const falar = `https://wa.me/${RUPHUS}?text=${encodeURIComponent(`Sobre a página ${slug}.ruphus.site`)}`;
  const CAIXA = "mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 px-6 text-[#17150F]";
  const BOTAO = "inline-flex h-12 items-center justify-center rounded-xl px-5 text-[15px] font-semibold";

  if (!proposta)
    return (
      <main className={CAIXA}>
        <h1 className="text-2xl font-semibold">Não dá para remover por aqui</h1>
        <p className="text-[15px] leading-relaxed text-[#4A4639]">Esta página não pode ser removida pelo link. Fale com a gente que resolvemos.</p>
        <a href={falar} className={`${BOTAO} border border-[#17150F]`}>Falar com a Ruphus</a>
      </main>
    );

  if (proposta.removida || feito)
    return (
      <main className={CAIXA}>
        <h1 className="text-2xl font-semibold">Página removida</h1>
        <p className="text-[15px] leading-relaxed text-[#4A4639]">
          A página de proposta de <b>{proposta.nome}</b> saiu do ar. Pode levar até um minuto para sumir em todo lugar. Se mudar de ideia, é só
          falar com a gente.
        </p>
        <a href={falar} className={`${BOTAO} border border-[#D8D2C6] text-[#4A4639]`}>Falar com a Ruphus</a>
      </main>
    );

  return (
    <main className={CAIXA}>
      <h1 className="text-2xl font-semibold">Remover a página de {proposta.nome}?</h1>
      <p className="text-[15px] leading-relaxed text-[#4A4639]">
        Esta página foi feita pela Ruphus como proposta, a partir das informações públicas do negócio. Ao confirmar, ela sai do ar e não
        voltamos a usá-la.
      </p>
      <form action={remover.bind(null, slug)}>
        <button type="submit" className={`${BOTAO} w-full bg-[#17150F] text-white`}>
          Tirar esta página do ar
        </button>
      </form>
      <a href={`https://${slug}.ruphus.site/`} className="text-center text-sm text-[#6F6A5E] underline underline-offset-4">
        Voltar para a página
      </a>
    </main>
  );
}
