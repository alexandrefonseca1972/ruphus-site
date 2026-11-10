import { adminDb } from "@/lib/admin";
import { responderArquivoDoNavegador, TETO_ARQUIVO } from "@/lib/conversas.server";
import { verifyFirebaseToken } from "@/lib/verify-token";

// Resposta com foto, áudio, vídeo ou documento na Central de conversas. Multipart com o token no
// Authorization; a autorização vem antes de ler o corpo (ver responderArquivoDoNavegador).
export async function POST(req: Request, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params;
  // corpo acima do teto é recusado pelo cabeçalho, antes de ler o arquivo para a memória
  if (Number(req.headers.get("content-length") ?? 0) > TETO_ARQUIVO + 64 * 1024) {
    return Response.json({ ok: false, error: "Arquivo acima de 12 MB. Envie um menor." }, { status: 413 });
  }
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return responderArquivoDoNavegador(verifyFirebaseToken, adminDb, token, tenant, () => req.formData().catch(() => null));
}
