import { NextResponse } from "next/server";
import { adminDb } from "@/lib/admin";
import { ErroAtendys, midiaDaMensagem } from "@/lib/atendys";
import { requireMember } from "@/lib/booking.server";
import { conexaoParaAtender } from "@/lib/conversas.server";
import { ErroPrevisto } from "@/lib/erro-previsto";
import { verifyFirebaseToken } from "@/lib/verify-token";

// Mídia recebida na Central de conversas. Rota, não server action: são bytes. O painel busca com
// o token no Authorization (fetch → blob), e daqui o atendys é chamado com a apikey do negócio,
// que nunca vai ao navegador. Mesmas checagens das ações: membro, negócio e permissão da equipe.

const ID = /^[^/]{1,512}$/;
const falha = (error: string, status: number) => NextResponse.json({ ok: false, error }, { status, headers: { "cache-control": "no-store" } });

export async function GET(req: Request, { params }: { params: Promise<{ tenant: string; mensagem: string }> }) {
  const { tenant, mensagem } = await params;
  if (!ID.test(tenant) || tenant.length > 128 || !ID.test(mensagem)) return falha("Pedido inválido.", 400);
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  try {
    const user = await requireMember(verifyFirebaseToken, adminDb, token, tenant);
    const res = await midiaDaMensagem(await conexaoParaAtender(adminDb, tenant, user.uid), mensagem);
    // repassa só o que o navegador precisa: tipo, nome do anexo e nada em cache compartilhado
    const headers = new Headers({
      "content-type": res.headers.get("content-type") ?? "application/octet-stream",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy": "sandbox",
    });
    const disposicao = res.headers.get("content-disposition");
    if (disposicao) headers.set("content-disposition", disposicao);
    return new Response(res.body, { status: 200, headers });
  } catch (e) {
    if (e instanceof ErroAtendys) {
      const r = falha(e.message, [404, 410, 429].includes(e.status) ? e.status : 502);
      if (e.retryAfter) r.headers.set("retry-after", String(e.retryAfter));
      return r;
    }
    if (e instanceof ErroPrevisto) return falha(e.message, 403);
    console.error("[conversas] falha ao buscar mídia", e);
    return falha("Não foi possível abrir o arquivo agora.", 500);
  }
}
