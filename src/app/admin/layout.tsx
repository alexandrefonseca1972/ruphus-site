import { Instrument_Serif, JetBrains_Mono } from "next/font/google";

// O painel tem tipografia própria: serifa nos títulos e números, mono na interface
const serifa = Instrument_Serif({ weight: "400", subsets: ["latin"], variable: "--fonte-serifa" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--fonte-mono" });

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${serifa.variable} ${mono.variable} min-h-dvh bg-[#F4F2EE] font-[family-name:var(--fonte-mono)] text-[#17150F]`}>
      {children}
    </div>
  );
}
