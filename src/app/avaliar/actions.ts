"use server";

import { adminDb } from "@/lib/admin";
import { responderAvaliacao } from "@/lib/avaliacoes.server";

export async function responderAvaliacaoAction(input: unknown) {
  try {
    return await responderAvaliacao(adminDb, input);
  } catch (e) {
    console.error("[avaliacao] falha inesperada ao responder", e);
    return { ok: false as const, error: "Não foi possível registrar agora. Sua resposta continua na tela; tente de novo." };
  }
}
