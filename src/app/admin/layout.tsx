import { Instrument_Serif, Public_Sans } from "next/font/google";

// O painel tem tipografia própria: serifa nos títulos e números, sans na interface
const serifa = Instrument_Serif({ weight: "400", subsets: ["latin"], variable: "--fonte-serifa" });
const sans = Public_Sans({ subsets: ["latin"], variable: "--fonte-sans" });

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${serifa.variable} ${sans.variable} min-h-dvh bg-[#F4F2EE] font-[family-name:var(--fonte-sans)] text-[#17150F]`}>
      {children}
    </div>
  );
}
