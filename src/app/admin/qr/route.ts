import { NextResponse, type NextRequest } from "next/server";
import QRCode from "qrcode";
import { requireAdmin, SemAcesso } from "@/lib/admin-guard";

// QR do site para mostrar no painel: gerado aqui, sem serviço de terceiro
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const url = searchParams.get("url") ?? "";
  const idToken = searchParams.get("t") ?? "";
  if (!/^https:\/\/[a-z0-9.-]+\.ruphus\.site(\/.*)?$/i.test(url)) {
    return new NextResponse("endereço inválido", { status: 400 });
  }
  try {
    await requireAdmin(idToken);
  } catch (err) {
    return new NextResponse(err instanceof SemAcesso ? err.message : "erro", { status: 403 });
  }
  const svg = await QRCode.toString(url, {
    type: "svg",
    margin: 1,
    color: { dark: "#17150F", light: "#FFFFFF" },
    errorCorrectionLevel: "M",
  });
  return new NextResponse(svg, {
    headers: { "content-type": "image/svg+xml", "cache-control": "private, max-age=3600" },
  });
}
