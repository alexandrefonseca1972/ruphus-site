import type { Metadata } from "next";
import { Instrument_Serif } from "next/font/google";
import { notFound } from "next/navigation";
import { adminDb } from "@/lib/admin";
import { diaCurto } from "@/lib/crm-tipos";
import { formatBRL, formatPhone, linkWhatsApp } from "@/lib/datetime";
import { abrirProposta } from "@/lib/proposta.server";
import { Imprimir } from "./imprimir";

// A proposta que o dono abre pelo link recebido no WhatsApp ou no e-mail. Sem
// login: o token do link é a credencial, como na cobrança e no convite. Link
// errado e negócio inexistente respondem a mesma coisa, para não virar sonda.
export const metadata: Metadata = { title: "Proposta · Ruphus", robots: { index: false, follow: false } };

const serifa = Instrument_Serif({ weight: "400", subsets: ["latin"], variable: "--fonte-serifa" });

const INCLUI = [
  ["Agenda aberta 24 horas", "O cliente vê os horários livres e marca sozinho, de madrugada ou no domingo, sem tirar você do atendimento."],
  ["Cada profissional com o horário dele", "Quem atende o quê, em que dia e em que hora. O sistema nunca oferece horário ocupado."],
  ["Serviços com preço e duração", "O encaixe é calculado na hora: serviço de uma hora reserva uma hora."],
  ["Ficha de cada cliente", "Histórico, etiquetas e anotações — alergias, preferências, o que foi combinado."],
  ["Seu endereço na internet", "Site com seus serviços e o link de agendamento pronto para a bio do Instagram."],
  ["Manutenção incluída", "Mudou horário, preço ou telefone? A gente atualiza. A mensalidade cobre isso."],
] as const;

const COMECA = [
  "Você entra no painel pelo convite que a gente manda.",
  "Cadastramos juntos os serviços e quem atende, com os horários.",
  "O link entra na sua bio, e os clientes começam a marcar.",
] as const;

export default async function Proposta({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>;
  searchParams: Promise<{ t?: string; pdf?: string }>;
}) {
  const [{ tenant }, { t, pdf }] = await Promise.all([params, searchParams]);
  const p = await abrirProposta(adminDb, tenant, t ?? "");
  if (!p) notFound();

  const fechar = linkWhatsApp(
    p.whatsapp,
    `Olá! Sou ${p.donoNome ?? "do"} ${p.nome}. Vi a proposta e quero começar.`,
  );

  return (
    <div className={`${serifa.variable} min-h-dvh bg-[#F4F2EE] text-[#17150F] print:bg-white`}>
      {/* A impressão é o PDF do anexo: margem de carta, sem cabeçalho do
          navegador dentro do conteúdo e sem bloco partido no meio. */}
      <style>{"@page { margin: 14mm; } @media print { html, body { background: #fff; } }"}</style>
      <main className="mx-auto flex max-w-[680px] flex-col gap-5 px-5 pt-8 pb-[calc(5rem+env(safe-area-inset-bottom))] print:max-w-none print:gap-4 print:px-0 print:pt-0 print:pb-0">

        <header className="flex flex-col gap-2">
          <span className="font-[family-name:var(--font-geist-mono)] text-[10px] tracking-[0.14em] text-[#6B6555] uppercase">
            Proposta da Ruphus
          </span>
          <h1 className="font-[family-name:var(--fonte-serifa)] text-[38px] leading-[1.05]">
            Agenda online para o {p.nome}
          </h1>
          <p className="max-w-[54ch] text-[15px] leading-relaxed text-[#4A4639]">
            {p.donoNome ? `${p.donoNome.split(" ")[0]}, ` : ""}o que está aqui é o que a gente combinou: o seu negócio
            recebendo marcação sozinho, todo dia, sem depender de alguém responder mensagem.
          </p>
          <Imprimir auto={pdf === "1"} />
        </header>

        <section aria-labelledby="inclui" className="flex flex-col gap-4 rounded-2xl border border-[#E2DDD3] bg-white p-5 sm:p-6 break-inside-avoid">
          <h2 id="inclui" className="font-[family-name:var(--fonte-serifa)] text-[24px] leading-none">O que está incluído</h2>
          <ul className="flex flex-col gap-3.5">
            {INCLUI.map(([titulo, detalhe]) => (
              <li key={titulo} className="flex gap-3">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#2C6A53" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-0.5 shrink-0">
                  <path d="M5 12.5l4.5 4.5L19 7" />
                </svg>
                <span className="min-w-0">
                  <b className="text-[15px] font-semibold">{titulo}</b>
                  <span className="block text-[14px] leading-relaxed text-[#4A4639]">{detalhe}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="preco" className="flex flex-col gap-4 rounded-2xl border border-[#17150F] bg-white p-5 sm:p-6 break-inside-avoid">
          <h2 id="preco" className="font-[family-name:var(--fonte-serifa)] text-[24px] leading-none">Quanto custa</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1 rounded-xl bg-[#F7F5EF] p-4">
              <span className="font-[family-name:var(--font-geist-mono)] text-[10px] tracking-[0.12em] text-[#6B6555] uppercase">Para publicar</span>
              <span className="font-[family-name:var(--fonte-serifa)] text-[30px] leading-none tabular-nums">{formatBRL(p.entradaCents)}</span>
              <span className="text-[13px] text-[#4A4639]">uma vez, com a implantação feita junto com você</span>
            </div>
            <div className="flex flex-col gap-1 rounded-xl bg-[#F7F5EF] p-4">
              <span className="font-[family-name:var(--font-geist-mono)] text-[10px] tracking-[0.12em] text-[#6B6555] uppercase">Por mês</span>
              <span className="font-[family-name:var(--fonte-serifa)] text-[30px] leading-none tabular-nums">{formatBRL(p.mensalCents)}</span>
              <span className="text-[13px] text-[#4A4639]">agenda no ar, atualizações e suporte</span>
            </div>
          </div>
          <p className="text-[14px] leading-relaxed text-[#4A4639]">
            Sem instalar programa, sem taxa por agendamento e sem fidelidade. Se um dia não servir mais, é só avisar.
          </p>
        </section>

        <section aria-labelledby="comeca" className="flex flex-col gap-4 rounded-2xl border border-[#E2DDD3] bg-white p-5 sm:p-6 break-inside-avoid">
          <h2 id="comeca" className="font-[family-name:var(--fonte-serifa)] text-[24px] leading-none">Como começa</h2>
          <ol className="flex flex-col gap-3">
            {COMECA.map((passo, i) => (
              <li key={passo} className="flex gap-3 text-[14.5px] leading-relaxed text-[#2E2B22]">
                <span aria-hidden="true" className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-[#EFEBE2] font-[family-name:var(--font-geist-mono)] text-[11px] font-semibold">
                  {i + 1}
                </span>
                <span className="min-w-0">{passo}</span>
              </li>
            ))}
          </ol>
          <p className="text-[13.5px] text-[#6F6A5E]">Leva menos de um dia entre o sim e a agenda recebendo marcação.</p>
        </section>

        <p className={`text-[13.5px] ${p.vencida ? "text-[#8A2F2F]" : "text-[#6F6A5E]"}`}>
          {p.vencida
            ? `Esta proposta era válida até ${diaCurto(p.valeAte)}. Fale com a gente para confirmar os valores.`
            : `Proposta válida até ${diaCurto(p.valeAte)}.`}
        </p>

        {/* No papel o botão "Quero começar" não existe: o PDF circula sozinho no
            e-mail e precisa dizer para onde responder. */}
        {p.whatsapp && (
          <p className="hidden text-[13.5px] text-[#2E2B22] print:block">
            Para fechar, é só chamar no WhatsApp {formatPhone(p.whatsapp)}.
          </p>
        )}

        <p className="text-[12px] leading-relaxed text-[#8B8578]">
          Ruphus · Fonseca Gestão e Tecnologia Ltda · CNPJ 59.500.429/0001-90 · Manaus/AM
          {p.cidade ? ` · proposta para ${p.nome}, ${p.cidade}` : ""}
        </p>
      </main>

      {fechar && (
        <div className="sticky bottom-0 border-t border-[#E2DDD3] bg-white/95 px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur print:hidden">
          <div className="mx-auto flex max-w-[680px] items-center gap-3">
            <a
              href={fechar}
              target="_blank"
              rel="noreferrer"
              className="flex h-13 grow items-center justify-center gap-2.5 rounded-[10px] bg-[#2C6A53] px-4 text-[15px] font-semibold text-white hover:bg-[#245743]"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.9-.9L3 20.5l1.6-4.9A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z" />
              </svg>
              Quero começar
            </a>
            <a
              href={`https://${p.slug}.ruphus.site/agendar`}
              target="_blank"
              rel="noreferrer"
              className="hidden h-13 items-center rounded-[10px] border border-[#D8D2C6] bg-white px-4 text-[14px] font-semibold hover:border-[#17150F] sm:flex"
            >
              Ver funcionando
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
