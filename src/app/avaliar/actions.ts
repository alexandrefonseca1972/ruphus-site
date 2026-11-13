"use server";

import { headers } from "next/headers";
import { adminDb } from "@/lib/admin";
import { responderAvaliacao } from "@/lib/avaliacoes.server";

export async function responderAvaliacaoAction(input: unknown) {
  try {
    const h = await headers();
    const ip = h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",").at(-1)?.trim();
    return await responderAvaliacao(adminDb, input, ip || undefined);
  } catch (e) {
    console.error("[avaliacao] falha inesperada ao responder", e);
    return { ok: false as const, error: "Não foi possível registrar agora. Sua resposta continua na tela; tente de novo." };
  }
}
