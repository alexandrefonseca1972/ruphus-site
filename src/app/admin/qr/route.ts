import { NextResponse, type NextRequest } from "next/server";
import QRCode from "qrcode";

// QR do site para mostrar no painel: gerado aqui, sem serviço de terceiro. O endereço
// é público (só *.ruphus.site), então não pede login: o token de admin ia na query
// string e ficava nos logs e no cache.
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const url = searchParams.get("url") ?? "";
  if (!/^https:\/\/[a-z0-9.-]+\.ruphus\.site(\/.*)?$/i.test(url)) {
    return new NextResponse("endereço inválido", { status: 400 });
  }
  const svg = await QRCode.toString(url, {
    type: "svg",
    margin: 1,
    color: { dark: "#17150F", light: "#FFFFFF" },
    errorCorrectionLevel: "M",
  });
  return new NextResponse(svg, {
    headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400" },
  });
}
