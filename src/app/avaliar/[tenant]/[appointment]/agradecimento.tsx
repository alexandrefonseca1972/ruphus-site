import { CheckCircle2 } from "lucide-react";

export function Agradecimento({ nome, negocio, siteUrl }: { nome: string; negocio: string; siteUrl: string }) {
  return (
    <section role="status" className="grid justify-items-center gap-5 rounded-2xl border border-[#D8E4DA] bg-[#F4F8F4] px-5 py-9 text-center shadow-[0_24px_50px_-38px_rgba(22,21,15,0.35)]">
      <span className="grid size-14 place-items-center rounded-full bg-[#DFEDE3] text-[#245743]">
        <CheckCircle2 className="size-8" strokeWidth={1.8} aria-hidden="true" />
      </span>
      <div className="grid gap-2">
        <h1 className="font-serifa text-3xl leading-tight text-balance">Obrigado{nome ? `, ${nome}` : ""}!</h1>
        <p className="text-[15px] leading-relaxed text-[#4C574F]">
          Sua avaliação foi registrada e ajuda o {negocio} a melhorar. Não é preciso enviar novamente.
        </p>
      </div>
      <a href={siteUrl} className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[#BFCFC2] bg-white px-5 text-sm font-semibold text-[#245743] hover:bg-[#EDF4EE] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#245743]">
        Voltar ao site do negócio
      </a>
    </section>
  );
}
