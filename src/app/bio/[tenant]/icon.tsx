import { ImageResponse } from "next/og";
import { adminDb } from "@/lib/admin";

// Ícone da aba: a inicial do negócio na cor da marca dele, não o ícone do app
export const size = { width: 64, height: 64 };
export const contentType = "image/png";
export const revalidate = 86400;

export default async function Icone({ params }: { params: Promise<{ tenant: string }> }) {
  const tenant = await adminDb.collection("tenants").doc((await params).tenant).get();
  const nome = String(tenant.get("name") ?? "?");
  const cor = String(tenant.get("site.color") ?? "#17150F");
  // contraste: sobre cor clara a letra é escura
  const h = cor.replace("#", "").padEnd(6, "0");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) || 0);
  const letra = (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6 ? "#17150F" : "#FFFFFF";
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: cor,
          color: letra,
          fontSize: 42,
          fontWeight: 700,
          fontFamily: "serif",
        }}
      >
        {nome.slice(0, 1).toUpperCase()}
      </div>
    ),
    size,
  );
}
