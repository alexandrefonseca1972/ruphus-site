import "server-only";
import { createRemoteJWKSet, jwtVerify } from "jose";

// Verificação documentada para tokens do Firebase Auth sem o firebase-admin/auth
// (que não carrega nas funções da Vercel: jwks-rsa faz require() do jose ESM).
const JWKS = createRemoteJWKSet(
  new URL("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com"),
);

export async function verifyFirebaseToken(token: string, projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!) {
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `https://securetoken.google.com/${projectId}`,
    audience: projectId,
    algorithms: ["RS256"],
  });
  if (!payload.sub || typeof payload.auth_time !== "number" || payload.auth_time * 1000 > Date.now()) {
    throw new Error("Token inválido");
  }
  return {
    uid: payload.sub,
    /** Quando a pessoa entrou, em ms: é o que a revogação de sessão compara */
    authTimeMs: payload.auth_time * 1000,
    // e-mail só conta quando o Firebase o verificou: qualquer pessoa cria conta
    // com o e-mail alheio, e ele vira o autor nas trilhas de auditoria
    email: typeof payload.email === "string" && payload.email_verified === true ? payload.email : undefined,
    /** O e-mail da conta ainda sem confirmar. Serve para DIZER à pessoa o que
     *  falta ("confirme joao@x.com"), nunca para decidir acesso: é justamente o
     *  campo que qualquer um preenche com o endereço alheio. */
    emailPendente: typeof payload.email === "string" && payload.email_verified !== true ? payload.email : undefined,
    // do Google, ou do nome pedido no cadastro por e-mail (updateProfile)
    name: typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : undefined,
  };
}
