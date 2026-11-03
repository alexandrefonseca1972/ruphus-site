import Link from "next/link";

// Endereço que não existe (negócio inexistente em /agendar/x, slug errado no painel, link velho):
// em português e com caminho de volta, no lugar do 404 em inglês do Next.
export default function NaoEncontrado() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-4 bg-white px-6 text-[#17150F]">
      <p className="text-sm font-medium text-[#6F6A5E]">Erro 404</p>
      <h1 className="text-2xl font-semibold">Página não encontrada</h1>
      <p className="text-[15px] leading-relaxed text-[#4A4639]">
        O endereço pode ter mudado ou o link veio incompleto. Se você ia agendar, peça o link de novo para o negócio.
      </p>
      <Link href="/" className="inline-flex h-12 items-center justify-center rounded-xl bg-[#17150F] px-5 text-[15px] font-semibold text-white">
        Ir para a página inicial
      </Link>
    </main>
  );
}
