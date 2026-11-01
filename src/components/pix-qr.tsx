"use client";

import QRCode from "qrcode";
import { useEffect, useMemo, useState } from "react";
import { formatBRL } from "@/lib/datetime";
import { brCode, type Recebedor } from "@/lib/pix";

/** O Pix do salão na tela: o cliente lê o QR no balcão, ou recebe o copia e cola pelo
 *  WhatsApp. O dinheiro cai na conta do salão, e ninguém avisa: confere-se no banco. */
export function PixQr({ recebedor, valorCents, txid, mensagem }: { recebedor: Recebedor; valorCents: number; txid: string; mensagem?: string }) {
  const codigo = useMemo(() => brCode({ ...recebedor, valorCents, txid }), [recebedor, valorCents, txid]);
  const [svg, setSvg] = useState("");
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    let atual = true;
    QRCode.toString(codigo, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).then((s) => atual && setSvg(s));
    return () => {
      atual = false;
    };
  }, [codigo]);

  const texto = `${mensagem ?? `Pix de ${formatBRL(valorCents)} para ${recebedor.nome}`}. Copie o código abaixo e cole no app do banco, em "Pix copia e cola":\n\n${codigo}`;
  return (
    <div className="grid gap-3 rounded-xl border bg-white p-4 text-[#17150F]">
      <div className="mx-auto aspect-square w-full max-w-60 [&_svg]:h-full [&_svg]:w-full" role="img" aria-label={`QR do Pix de ${formatBRL(valorCents)}`} dangerouslySetInnerHTML={{ __html: svg }} />
      <p className="text-center text-sm">
        <strong className="tabular-nums">{formatBRL(valorCents)}</strong> para {recebedor.nome}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <button
          type="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(codigo);
              setCopiado(true);
              setTimeout(() => setCopiado(false), 2500);
            } catch {
              // sem permissão de área de transferência: o WhatsApp leva o código
            }
          }}
          className="h-11 rounded-lg border border-[#D8D2C6] text-sm font-semibold hover:border-[#17150F]"
        >
          {copiado ? "Código copiado" : "Copiar código"}
        </button>
        <a href={`https://wa.me/?text=${encodeURIComponent(texto)}`} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center rounded-lg border border-[#D8D2C6] text-sm font-semibold hover:border-[#17150F]">
          Enviar por WhatsApp
        </a>
      </div>
    </div>
  );
}
