import type { Metadata } from "next";
import Link from "next/link";
import { Instrument_Serif } from "next/font/google";

// A fonte direto daqui: fonte-serifa.ts exporta também um hook de cliente, e
// este layout é componente de servidor.
const serifa = Instrument_Serif({ weight: "400", subsets: ["latin"], variable: "--fonte-serifa" });

// O manual mora dentro do produto: quem precisa dele está com o painel aberto,
// não procurando um PDF no e-mail. Fora do índice do Google, como o painel.
export const metadata: Metadata = {
  title: "Ajuda · Ruphus",
  robots: { index: false, follow: false },
};

export default function AjudaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${serifa.variable} min-h-dvh bg-[#F4F2EE] text-[#17150F]`}>
      <header className="border-b border-[#E2DDD3] bg-white">
        <div className="mx-auto flex max-w-[860px] flex-wrap items-center gap-3 px-5 py-3.5">
          <Link href="/painel" className="font-[family-name:var(--fonte-serifa)] text-[22px] leading-none hover:text-[#2C6A53]">
            Ruphus
          </Link>
          <span aria-hidden="true" className="h-5 w-px bg-[#E2DDD3]" />
          <span className="text-[13px] text-[#6F6A5E]">Ajuda</span>
          <div className="grow" />
          <Link href="/painel" className="flex h-10 items-center rounded-[10px] border border-[#D8D2C6] bg-white px-3.5 text-[13px] hover:border-[#17150F]">
            Voltar ao painel
          </Link>
        </div>
      </header>

      <main className="mx-auto flex max-w-[860px] flex-col gap-8 px-5 pt-8 pb-[calc(4rem+env(safe-area-inset-bottom))]">
        {children}
      </main>
    </div>
  );
}
