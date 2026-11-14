import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { adminDb } from "@/lib/admin";
import { abrirAvaliacao } from "@/lib/avaliacoes.server";
import { primeiroNome } from "@/lib/avaliacoes";
import { AvaliacaoForm } from "./form";
import { Agradecimento } from "./agradecimento";

export const metadata: Metadata = { title: "Avaliar atendimento · Ruphus", robots: { index: false, follow: false } };

export default async function AvaliarPage({ params, searchParams }: PageProps<"/avaliar/[tenant]/[appointment]">) {
  const [{ tenant, appointment }, query] = await Promise.all([params, searchParams]);
  const token = typeof query.t === "string" ? query.t : "";
  let avaliacao: Awaited<ReturnType<typeof abrirAvaliacao>> = null;
  let indisponivel = false;
  try {
    avaliacao = await abrirAvaliacao(adminDb, tenant, appointment, token);
  } catch (e) {
    console.error("[avaliacao] falha ao abrir link", e);
    indisponivel = true;
  }
  if (!indisponivel && !avaliacao) notFound();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-1 flex-col gap-5 bg-[#F2F0E7] px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] text-[#17150F]">
      <header className="flex items-center gap-3">
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-[#17150F] font-serifa text-xl text-[#FAF9F5]">{avaliacao?.businessName.charAt(0).toUpperCase() || "R"}</span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{avaliacao?.businessName ?? "Avaliação"}</p>
          <p className="text-xs text-[#6B6555]">Sua experiência importa</p>
        </div>
      </header>

      {indisponivel ? (
        <section role="alert" className="grid gap-3 rounded-2xl border border-[#E0DCCE] bg-[#FAF9F5] p-5">
          <h1 className="font-serifa text-2xl">Não foi possível abrir agora</h1>
          <p className="text-sm leading-relaxed text-[#6B6555]">Confira sua internet e recarregue o link recebido no WhatsApp.</p>
          <a href="" className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[#D5D0C1] bg-white px-4 text-sm font-semibold">Tentar novamente</a>
        </section>
      ) : avaliacao?.status === "respondida" ? (
        <Agradecimento nome={primeiroNome(avaliacao.customerName)} negocio={avaliacao.businessName} siteUrl={avaliacao.siteUrl} />
      ) : avaliacao?.status === "expirada" ? (
        <section className="grid gap-3 rounded-2xl border border-[#E0DCCE] bg-[#FAF9F5] p-5">
          <h1 className="font-serifa text-2xl">Este link venceu</h1>
          <p className="text-sm leading-relaxed text-[#6B6555]">O prazo desta avaliação terminou. Se ainda quiser contar como foi, fale diretamente com {avaliacao.businessName}.</p>
          <a href={avaliacao.siteUrl} className="inline-flex min-h-12 items-center justify-center rounded-lg border border-[#D5D0C1] bg-white px-4 text-sm font-semibold">Ir ao site do negócio</a>
        </section>
      ) : avaliacao ? (
        <>
          <section className="grid gap-2">
            <p className="font-mono text-[10px] font-medium tracking-[0.14em] text-[#6B6555] uppercase">Avaliação do atendimento</p>
            <h1 className="font-serifa text-3xl leading-tight text-balance">Como foi sua experiência?</h1>
            <p className="text-[15px] leading-relaxed text-[#5C5747]"><strong>{avaliacao.serviceName}</strong>{avaliacao.staffName ? ` com ${avaliacao.staffName}` : ""}. Leva menos de 1 minuto.</p>
          </section>
          <AvaliacaoForm
            tenantId={tenant}
            appointmentId={appointment}
            token={token}
            nome={primeiroNome(avaliacao.customerName)}
            negocio={avaliacao.businessName}
            servico={avaliacao.serviceName}
            profissional={avaliacao.staffName}
            siteUrl={avaliacao.siteUrl}
          />
        </>
      ) : null}
      <p className="mt-auto pt-2 text-center font-mono text-[9px] tracking-[0.12em] text-[#6B6555] uppercase">Ruphus · avaliação segura e privada</p>
    </main>
  );
}
