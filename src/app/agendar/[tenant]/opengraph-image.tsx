import { ImageResponse } from "next/og";
import { notFound } from "next/navigation";
import { adminDb } from "@/lib/admin";
import { loadCatalog } from "@/lib/booking.server";
import { formatBRL } from "@/lib/datetime";

export const size = { width: 1200, height: 630 };
export const contentType = "image/png";
export const alt = "Agendamento online";
// A prévia muda pouco e os apps buscam com pressa: serve do cache por 1 dia
export const revalidate = 86400;

export default async function OgImage({ params }: { params: Promise<{ tenant: string }> }) {
  const catalog = await loadCatalog(adminDb, (await params).tenant);
  if (!catalog) notFound();
  const services = catalog.services.slice(0, 3);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0a0a0a",
          color: "#fafafa",
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <span style={{ fontSize: 30, color: "#a1a1aa" }}>Agendamento online</span>
          <span style={{ fontSize: 76, fontWeight: 700, lineHeight: 1.1 }}>{catalog.name}</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {services.map((s) => (
            <span key={s.id} style={{ fontSize: 32, color: "#d4d4d8" }}>
              {s.name} · {formatBRL(s.priceCents)}
            </span>
          ))}
        </div>
        <span style={{ fontSize: 34, color: "#a1a1aa" }}>Escolha o horário em poucos toques →</span>
      </div>
    ),
    size,
  );
}
