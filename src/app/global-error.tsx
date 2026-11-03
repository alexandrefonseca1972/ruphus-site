"use client";

// Erro no layout raiz: substitui a página inteira, então traz o próprio <html> e estilos inline
// (o CSS do app pode não ter carregado).
export default function ErroGeral({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="pt-BR">
      <body style={{ margin: 0, background: "#fff", color: "#17150F", fontFamily: "system-ui, sans-serif" }}>
        <main role="alert" style={{ maxWidth: 448, margin: "0 auto", minHeight: "100dvh", display: "flex", flexDirection: "column", justifyContent: "center", gap: 16, padding: "0 24px" }}>
          <h1 style={{ fontSize: 24, margin: 0 }}>Algo deu errado</h1>
          <p style={{ fontSize: 15, lineHeight: 1.6, margin: 0, color: "#4A4639" }}>Tente de novo; se continuar, recarregue a página.</p>
          <button type="button" onClick={retry} style={{ height: 48, borderRadius: 12, border: 0, background: "#17150F", color: "#fff", fontSize: 15, fontWeight: 600 }}>
            Tentar de novo
          </button>
        </main>
      </body>
    </html>
  );
}
