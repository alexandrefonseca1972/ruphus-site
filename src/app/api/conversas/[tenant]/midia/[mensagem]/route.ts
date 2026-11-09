import { adminDb } from "@/lib/admin";
import { midiaParaNavegador } from "@/lib/conversas.server";
import { verifyFirebaseToken } from "@/lib/verify-token";

// Mídia recebida na Central de conversas. Rota, não server action: são bytes. O painel busca com
// o token no Authorization (fetch → blob), e daqui o atendys é chamado com a apikey do negócio,
// que nunca vai ao navegador. Mesmas checagens das ações: sessão, membro, negócio e equipe.
export async function GET(req: Request, { params }: { params: Promise<{ tenant: string; mensagem: string }> }) {
  const { tenant, mensagem } = await params;
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return midiaParaNavegador(verifyFirebaseToken, adminDb, token, tenant, mensagem);
}
