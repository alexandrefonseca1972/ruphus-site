import { NextResponse } from "next/server";

// O gateway antigo (protótipo wtsfy) foi desativado — a integração agora é a
// plataforma atendys, com webhook em /api/webhooks/atendys. Rota mantida só
// para responder eventuais deliveries pendentes com um fim claro (410).

export async function POST() {
  return NextResponse.json({ error: "Gateway desativado. Use /api/webhooks/atendys." }, { status: 410 });
}

export async function GET() {
  return NextResponse.json({ error: "Método não permitido." }, { status: 405 });
}
