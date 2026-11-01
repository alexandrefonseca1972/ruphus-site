import { NextResponse, type NextRequest } from "next/server";
import { adminDb } from "@/lib/admin";
import { normalizarHost } from "@/lib/dominio";

// Na VPS, o Caddy pergunta aqui antes de emitir certificado para um host desconhecido:
// só domínio ligado a algum site (pendente ou ativo) leva certificado. No Caddyfile:
//
//   { on_demand_tls { ask http://localhost:3001/api/dominios/tls } }
//   https:// {
//     tls { on_demand }
//     reverse_proxy localhost:3001 { header_up X-Real-IP {remote_host} }
//   }
//
// Só responde a quem chama pelo próprio servidor: de fora, o Host é o domínio visitado.
export async function GET(request: NextRequest) {
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(request.headers.get("host") ?? "")) return new NextResponse(null, { status: 404 });
  const host = normalizarHost(request.nextUrl.searchParams.get("domain") ?? "");
  if (!host) return new NextResponse(null, { status: 404 });
  const tenants = adminDb.collection("tenants");
  const [principal, raiz] = await Promise.all([
    tenants.where("dominio.host", "==", host).limit(1).get(),
    tenants.where("dominio.raiz", "==", host).limit(1).get(),
  ]);
  return new NextResponse(null, { status: principal.empty && raiz.empty ? 404 : 200 });
}
