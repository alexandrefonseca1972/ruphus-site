import { Instrument_Serif, Public_Sans } from "next/font/google";

// O minisite é a vitrine do negócio no Instagram: tipografia calma, fundo claro
const serifa = Instrument_Serif({ weight: "400", subsets: ["latin"], variable: "--fonte-serifa" });
const sans = Public_Sans({ subsets: ["latin"], variable: "--fonte-sans" });

export default function BioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${serifa.variable} ${sans.variable} min-h-dvh bg-[#F7F5F1] font-[family-name:var(--fonte-sans)] text-[#17150F]`}>
      {children}
    </div>
  );
}
