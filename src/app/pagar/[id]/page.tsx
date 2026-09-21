import type { Metadata } from "next";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { adminDb } from "@/lib/admin";
import { abrirCobranca, pixCadastrado } from "@/lib/cobranca";
import { hojeISO, diaCurto } from "@/lib/crm-tipos";
import { formatBRL, linkWhatsApp } from "@/lib/datetime";
import { Copiar } from "./copiar";

// A cobrança que o negócio abre pelo link que recebeu no WhatsApp. Não há login:
// o token do link é a credencial, como no convite. Link errado e cobrança que
// não existe respondem a mesma coisa — 404 — para o link não virar sonda.
export const metadata: Metadata = { title: "Pagar · Ruphus", robots: { index: false, follow: false } };

const MES = (competencia: string) =>
  new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${competencia}-01T00:00:00Z`));

const ROTULO = "font-[family-name:var(--font-geist-mono)] text-[9px] font-medium tracking-[0.14em] text-[#6B6555] uppercase";
const MONO = "font-[family-name:var(--font-geist-mono)]";

export default async function Pagar({ params, searchParams }: PageProps<"/pagar/[id]">) {
  const { id } = await params;
  const { t } = await searchParams;
  const cobranca = await abrirCobranca(adminDb, id, typeof t === "string" ? t : "");
  if (!cobranca) notFound();

  const pix = await pixCadastrado(adminDb);
  const svg = cobranca.brCode
    ? await QRCode.toString(cobranca.brCode, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#17150F", light: "#FFFFFF" } })
    : null;
  const oque = cobranca.tipo === "entrada" ? "Entrada" : `Mensalidade · ${MES(cobranca.competencia!)}`;
  const vencida = cobranca.status === "aberta" && cobranca.vencimento < hojeISO();
  const comprovante = linkWhatsApp(
    pix?.whatsapp ?? null,
    `Olá! Segue o comprovante do Pix do ${cobranca.nome} — ${oque}, ${formatBRL(cobranca.valorCents)} (${cobranca.txid}).`,
  );

  return (
    <main className="mx-auto flex w-full max-w-[420px] flex-1 flex-col gap-4 bg-[#F2F0E7] p-4 py-6 text-[#17150F]">
      <div className="flex flex-col gap-4 rounded-[14px] border border-[#E0DCCE] bg-[#FAF9F5] p-5 shadow-[0_28px_50px_-34px_rgba(22,21,15,0.28)]">
        <div className="flex flex-col gap-1">
          <p className={ROTULO}>{oque}</p>
          <h1 className="text-xl leading-tight font-semibold tracking-[-0.02em]">{cobranca.nome}</h1>
        </div>
        <div className="flex items-baseline gap-2.5">
          <span className={`${MONO} text-[32px] leading-none font-medium`}>{formatBRL(cobranca.valorCents)}</span>
          <span className="text-[13px] text-[#5C5747]">
            {vencida || cobranca.status !== "aberta" ? "venceu" : "vence"} em {diaCurto(cobranca.vencimento)}
          </span>
        </div>

        {cobranca.status === "paga" ? (
          <p role="status" className="rounded-[10px] border border-[#CFE0D6] bg-[#F2F7F4] p-3 text-[13px] leading-relaxed text-[#245743]">
            Pagamento recebido. Obrigado — não é preciso pagar de novo.
          </p>
        ) : cobranca.status === "cancelada" ? (
          <p role="status" className="rounded-[10px] border border-[#E0DCCE] bg-[#F1EFE4] p-3 text-[13px] leading-relaxed text-[#5C5747]">
            Esta cobrança foi cancelada. Se você recebeu um link novo, use aquele.
          </p>
        ) : !svg ? (
          <p role="alert" className="rounded-[10px] border border-[#E7C9BF] bg-[#FBF1EE] p-3 text-[13px] leading-relaxed text-[#B4472F]">
            O Pix desta cobrança ainda não está pronto. Fale com a Ruphus pelo WhatsApp.
          </p>
        ) : (
          <>
            {vencida && (
              <p className={`${MONO} text-[10px] tracking-[0.1em] text-[#B4472F] uppercase`}>em atraso — pode pagar por aqui mesmo</p>
            )}
            <div className="flex flex-col items-center gap-3 rounded-[10px] border border-[#E4E1D5] bg-white p-4">
              {/* O QR sai montado aqui: uma string no HTML em vez de outra ida ao servidor */}
              <div className="w-[190px]" aria-label="QR code do Pix" dangerouslySetInnerHTML={{ __html: svg }} />
              <p className={`${MONO} text-[10px] tracking-[0.08em] text-[#6B6555] uppercase`}>aponte a câmera do seu banco</p>
            </div>
            <Copiar codigo={cobranca.brCode!} />
          </>
        )}

        {comprovante && cobranca.status === "aberta" && (
          <a
            href={comprovante}
            target="_blank"
            rel="noreferrer"
            className="flex h-12 items-center justify-center gap-2.5 rounded-[10px] border border-[#D5D0C1] bg-white text-sm font-semibold text-[#17150F]"
          >
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#2C6A53" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.9-.9L3 20.5l1.6-4.9A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z" />
            </svg>
            Enviar comprovante
          </a>
        )}

        <div className="flex flex-col gap-1.5 border-t border-[#EDEAE0] pt-3.5">
          <p className={ROTULO}>identificador</p>
          <p className={`${MONO} text-xs text-[#5C5747]`}>{cobranca.txid}</p>
        </div>
      </div>

      <p className="text-center text-xs leading-relaxed text-[#5C5747]">
        O Pix cai direto na conta da Ruphus. A confirmação não é automática: mande o comprovante que a gente dá baixa.
      </p>
      <div className="flex-1" />
      <p className={`${MONO} flex items-center justify-center gap-2 text-[9px] tracking-[0.12em] text-[#6B6555] uppercase`}>
        ruphus · sites e agenda
      </p>
    </main>
  );
}
