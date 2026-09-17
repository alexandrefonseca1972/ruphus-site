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
  return { uid: payload.sub, email: typeof payload.email === "string" ? payload.email : undefined };
}
