"use client";

import QRCode from "qrcode";
import { useState } from "react";

/** O QR de um link, para imprimir no balcão, no espelho ou no cartão. Gerado no navegador:
 *  vale também para o domínio próprio, que a rota do /admin não aceita. */
export function QrDoLink({ url, rotulo, arquivo }: { url: string; rotulo: string; arquivo: string }) {
  // guardado com o link: trocar o endereço não mostra o QR do antigo
  const [qr, setQr] = useState<{ url: string; png: string | null } | null>(null);
  const png = qr?.url === url ? qr.png : undefined;
  const [copiou, setCopiou] = useState<boolean | null>(null);

  // A imagem vai como Promise dentro do ClipboardItem: o Safari só aceita a cópia
  // se ela começar no próprio clique, sem esperar o fetch antes.
  const copiar = (p: string) =>
    navigator.clipboard
      .write([new ClipboardItem({ "image/png": fetch(p).then((r) => r.blob()) })])
      .then(() => setCopiou(true), () => setCopiou(false))
      .finally(() => setTimeout(() => setCopiou(null), 2000));

  return (
    <details
      className="text-xs"
      onToggle={(e) => {
        if (!e.currentTarget.open || png !== undefined) return;
        QRCode.toDataURL(url, { width: 1024, margin: 2, errorCorrectionLevel: "M", color: { dark: "#17150F", light: "#FFFFFF" } })
          .then((p) => setQr({ url, png: p }))
          .catch(() => setQr({ url, png: null }));
      }}
    >
      <summary className="flex min-h-10 cursor-pointer items-center font-medium text-muted-foreground hover:text-foreground">QR code</summary>
      <div className="mt-2 grid justify-items-center gap-2 rounded-lg border bg-white p-3">
        {png ? (
          // eslint-disable-next-line @next/next/no-img-element -- PNG gerado aqui mesmo, em data URL
          <img src={png} alt={`QR code: ${rotulo}`} width={160} height={160} className="size-40" />
        ) : png === null ? (
          <p role="alert" className="text-destructive">Não deu para gerar o QR. Use o link.</p>
        ) : (
          <div className="size-40 animate-pulse rounded bg-muted" aria-hidden="true" />
        )}
        {png && (
          <div className="flex flex-wrap justify-center gap-2">
            {typeof ClipboardItem !== "undefined" && (
              <button type="button" onClick={() => copiar(png)} className="inline-flex h-11 items-center rounded-lg border px-3 sm:h-9 font-medium text-[#17150F] hover:bg-muted">
                {copiou === true ? "Copiado" : copiou === false ? "Não deu para copiar" : "Copiar imagem"}
              </button>
            )}
            <a href={png} download={`${arquivo}.png`} className="inline-flex h-11 items-center rounded-lg border px-3 sm:h-9 font-medium text-[#17150F] hover:bg-muted">
              Baixar para imprimir
            </a>
          </div>
        )}
      </div>
    </details>
  );
}
