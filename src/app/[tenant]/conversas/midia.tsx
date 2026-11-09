"use client";

import { useEffect, useState } from "react";
import type { MensagemInbox } from "@/lib/atendys";
import { idToken } from "@/lib/firebase";

// Mídia recebida: a rota exige o token no cabeçalho, então o navegador busca em bytes e mostra
// por um object URL. Só imagem, áudio e vídeo abrem aqui (a rota já força o resto a download);
// documento vira link de download, nunca uma janela com o conteúdo.

type Anexo = NonNullable<MensagemInbox["attachment"]>;

const ROTULO: Record<Anexo["kind"], string> = { image: "Foto", video: "Vídeo", audio: "Áudio", document: "Documento" };

export function Midia({ tenantId, conversaId, mensagemId, anexo }: { tenantId: string; conversaId: string; mensagemId: string; anexo: Anexo }) {
  const [estado, setEstado] = useState<{ url: string; tipo: string } | "carregando" | "erro" | "parado">(anexo.kind === "document" ? "parado" : "carregando");
  const indisponivel = anexo.available === "expired" || anexo.available === "unavailable";

  const baixar = async () => {
    const res = await fetch(`/api/conversas/${encodeURIComponent(tenantId)}/midia/${encodeURIComponent(mensagemId)}?c=${encodeURIComponent(conversaId)}`, {
      headers: { authorization: `Bearer ${await idToken()}` },
    });
    if (!res.ok) throw new Error(String(res.status));
    const blob = await res.blob();
    return { url: URL.createObjectURL(blob), tipo: blob.type };
  };

  useEffect(() => {
    if (anexo.kind === "document" || indisponivel) return;
    let vivo = true;
    let url = "";
    baixar()
      .then((r) => {
        url = r.url;
        if (vivo) setEstado(r);
        else URL.revokeObjectURL(r.url);
      })
      .catch(() => vivo && setEstado("erro"));
    return () => {
      vivo = false;
      if (url) URL.revokeObjectURL(url);
    };
    // baixar só lê props estáveis desta mensagem
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, conversaId, mensagemId, anexo.kind, indisponivel]);

  if (indisponivel) return <p className="text-xs italic opacity-80">{ROTULO[anexo.kind]} não está mais disponível no WhatsApp.</p>;
  if (estado === "erro") return <p className="text-xs italic opacity-80">Não foi possível abrir {ROTULO[anexo.kind].toLowerCase()}.</p>;
  if (estado === "carregando") return <div className="grid h-32 w-48 max-w-full place-items-center rounded-lg bg-black/5 text-xs opacity-70">Carregando…</div>;

  if (anexo.kind === "document" || estado === "parado") {
    return (
      <button
        type="button"
        className="text-left text-sm font-medium underline underline-offset-4"
        onClick={async () => {
          try {
            const r = await baixar();
            const a = Object.assign(document.createElement("a"), { href: r.url, download: anexo.fileName || "arquivo" });
            a.click();
            setTimeout(() => URL.revokeObjectURL(r.url), 10_000);
          } catch {
            setEstado("erro");
          }
        }}
      >
        Baixar {anexo.fileName || "documento"}
      </button>
    );
  }
  // o tipo vem da rota, que só deixa imagem (sem SVG), áudio e vídeo como estão
  if (estado.tipo.startsWith("image/")) {
    // eslint-disable-next-line @next/next/no-img-element -- blob local, sem otimização do Next
    return <img src={estado.url} alt="Foto recebida" className="max-h-72 max-w-full rounded-lg" />;
  }
  if (estado.tipo.startsWith("audio/")) return <audio controls src={estado.url} className="max-w-full" />;
  if (estado.tipo.startsWith("video/")) return <video controls src={estado.url} className="max-h-72 max-w-full rounded-lg" />;
  // tipo que a rota forçou a download (ex.: SVG): baixa em vez de exibir
  return (
    <a href={estado.url} download={anexo.fileName || "arquivo"} className="text-sm font-medium underline underline-offset-4">
      Baixar {ROTULO[anexo.kind].toLowerCase()}
    </a>
  );
}
