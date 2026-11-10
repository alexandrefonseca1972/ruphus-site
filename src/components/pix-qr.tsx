"use client";

import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { formatBRL } from "@/lib/datetime";
import { brCode, PixInvalido, type Recebedor } from "@/lib/pix";
import { relogio, tempoRestante } from "@/lib/sinal";
import { textoPix } from "@/lib/mensagens";

/** O Pix do salão na tela: o cliente lê o QR no balcão, ou recebe o copia e cola pelo
 *  WhatsApp. O dinheiro cai na conta do salão, e ninguém avisa: confere-se no banco.
 *  ate: prazo do sinal (ISO); com ele, a contagem aparece e o QR some quando vence. */
export function PixQr({
  recebedor,
  valorCents,
  txid,
  mensagem,
  ate,
  ajuda = "Confira a chave em Meu negócio.",
  children,
}: {
  recebedor: Recebedor;
  valorCents: number;
  txid: string;
  mensagem?: string;
  ate?: string;
  /** o que fazer se o Pix não montar: o dono confere a chave; o cliente fala com o salão */
  ajuda?: string;
  /** o que só vale enquanto dá para pagar (ex.: "enviar comprovante"): some quando o prazo vence */
  children?: React.ReactNode;
}) {
  const montado = useMemo(() => {
    try {
      return { codigo: brCode({ ...recebedor, valorCents, txid }) };
    } catch (e) {
      if (e instanceof PixInvalido) return { erro: e.message };
      throw e;
    }
  }, [recebedor, valorCents, txid]);
  // o desenho guardado junto com o código: valor trocado não mostra o QR do valor antigo
  const [qr, setQr] = useState<{ codigo: string; svg: string | null } | null>(null);
  const [copiado, setCopiado] = useState<"sim" | "falhou" | null>(null);
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    if (!montado.codigo) return;
    let atual = true;
    // sem o desenho do QR, o copia e cola continua valendo
    const codigo = montado.codigo;
    QRCode.toString(codigo, { type: "svg", margin: 1, errorCorrectionLevel: "M" })
      .then((svg) => atual && setQr({ codigo, svg }))
      .catch(() => atual && setQr({ codigo, svg: null }));
    return () => {
      atual = false;
    };
  }, [montado.codigo]);

  useEffect(() => {
    if (!ate) return;
    // de segundo em segundo: o relógio é pequeno, e re-renderiza só este quadro
    const id = setInterval(() => setAgora(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ate]);

  if (!montado.codigo) {
    return (
      <p role="alert" className="rounded-xl border border-[#E7C9BF] bg-[#FBF1EE] p-3.5 text-sm text-[#B4472F]">
        Não foi possível montar o Pix ({montado.erro}). {ajuda}
      </p>
    );
  }
  const falta = ate ? tempoRestante(ate, agora) : undefined;
  const tempo = ate ? relogio(ate, agora) : null;
  // nos últimos 5 min o relógio fica âmbar; antes, cinza, sem pressa
  const apertado = !!ate && Date.parse(ate) - agora < 5 * 60_000;
  if (falta === null) {
    return (
      <p role="alert" className="rounded-xl border border-[#E7C9BF] bg-[#FBF1EE] p-3.5 text-sm text-[#B4472F]">
        O prazo para pagar este Pix acabou. Fale com {recebedor.nome} antes de pagar.
      </p>
    );
  }

  const codigo = montado.codigo;
  const texto = textoPix({ valorCents, nome: recebedor.nome, codigo, mensagem });
  async function copiar() {
    setCopiado(null);
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado("sim");
      setTimeout(() => setCopiado(null), 2500);
    } catch {
      // sem permissão de área de transferência: o código fica à vista para copiar na mão
      setCopiado("falhou");
    }
  }

  const svg = qr?.codigo === codigo ? qr.svg : "";
  return (
    <div className="grid gap-3 rounded-xl border bg-white p-4 text-[#17150F]">
      {svg ? (
        <div className="mx-auto aspect-square w-full max-w-60 [&_svg]:h-full [&_svg]:w-full" role="img" aria-label={`QR do Pix de ${formatBRL(valorCents)}`} dangerouslySetInnerHTML={{ __html: svg }} />
      ) : svg === "" ? (
        <div className="mx-auto aspect-square w-full max-w-60 animate-pulse rounded-lg bg-[#F2F0E7]" aria-hidden="true" />
      ) : null}
      <p className="text-center text-sm">
        <strong className="tabular-nums">{formatBRL(valorCents)}</strong> para {recebedor.nome}
      </p>
      {tempo && (
        <p className="-mt-1 flex justify-center">
          {/* role="timer" não é lido a cada segundo; o rótulo diz os minutos */}
          <span
            role="timer"
            aria-label={`Tempo para pagar: ${falta}`}
            className={`inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 font-[family-name:var(--font-geist-mono)] text-xs tabular-nums ${apertado ? "bg-[#F6EBD3] text-[#4F3A10]" : "bg-[#F2F0E7] text-[#5C5747]"}`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="13" r="8" />
              <path d="M12 9v4l2.5 1.5M9.5 2.5h5" />
            </svg>
            {tempo}
          </span>
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={copiar} className="h-11 rounded-lg bg-[#17150F] text-sm font-semibold text-[#FAF9F5]">
          {copiado === "sim" ? "Código copiado" : "Copiar código Pix"}
        </button>
        <a href={`https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center rounded-lg border border-[#D8D2C6] text-sm font-semibold hover:border-[#17150F]">
          Enviar por WhatsApp
        </a>
      </div>
      <p aria-live="polite" className="sr-only">{copiado === "sim" ? "Código Pix copiado." : copiado === "falhou" ? "Não deu para copiar. O código está logo abaixo, para selecionar e copiar." : ""}</p>
      {/* o código à vista: quem não consegue copiar pelo botão seleciona e copia */}
      <details open={copiado === "falhou"} className="text-xs text-[#5C5747]">
        <summary className="cursor-pointer py-1">{copiado === "falhou" ? "Copie o código abaixo" : "Ver o código"}</summary>
        <code className="mt-1 block max-h-24 overflow-auto rounded-lg border border-[#E4E1D5] bg-[#FAF9F5] p-2.5 font-[family-name:var(--font-geist-mono)] text-[10px] break-all select-all">{codigo}</code>
      </details>
      {children}
    </div>
  );
}
