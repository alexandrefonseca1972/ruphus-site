import { NextResponse } from "next/server";
import { z } from "zod";
import { adminDb } from "@/lib/admin";
import { dentroDaJanela, MAX_DAYS_AHEAD } from "@/lib/datetime";
import { ErroPrevisto } from "@/lib/erro-previsto";
import { EntradaEsperaInput } from "@/lib/fila-espera";
import { entrarNaFila, sairDaFila } from "@/lib/fila-espera.server";

// Fila de espera da página pública: entrar (acao "entrar") e sair (acao "sair", com o token que entrar devolveu).
// Chamável por qualquer pessoa: toda entrada é validada aqui.

const SairInput = z.object({
  acao: z.literal("sair"),
  tenantId: z.string().min(1).max(128).regex(/^[^/]+$/),
  id: z.string().min(1).max(128).regex(/^[^/]+$/),
  token: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, "Espera inválida"),
});

export async function POST(req: Request) {
  // só JSON: outro site não consegue postar aqui sem a checagem de CORS do navegador
  if (!req.headers.get("content-type")?.startsWith("application/json")) return new NextResponse(null, { status: 415 });
  const corpo = await req.json().catch(() => ({}));
  // mesmo critério da reserva: o último x-forwarded-for é o que o proxy acrescentou
  const encaminhado = req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  const ip = req.headers.get("x-real-ip")?.trim() || encaminhado;
  try {
    if (corpo?.acao === "sair") {
      const s = SairInput.safeParse(corpo);
      if (!s.success) return NextResponse.json({ ok: false, error: s.error.issues[0].message });
      return NextResponse.json(await sairDaFila(adminDb, s.data.tenantId, s.data.id, s.data.token));
    }
    if (corpo?.acao === "entrar") {
      const e = EntradaEsperaInput.safeParse(corpo);
      if (!e.success) return NextResponse.json({ ok: false, error: e.error.issues[0].message });
      if (!dentroDaJanela(e.data.date)) return NextResponse.json({ ok: false, error: `Escolha um dia com até ${MAX_DAYS_AHEAD} dias de antecedência.` });
      return NextResponse.json(await entrarNaFila(adminDb, e.data, ip));
    }
    return NextResponse.json({ ok: false, error: "Pedido inválido." });
  } catch (e) {
    if (e instanceof ErroPrevisto) return NextResponse.json({ ok: false, error: e.message });
    console.error("[espera] entrar/sair", e);
    return NextResponse.json({ ok: false, error: "Não foi possível concluir agora. Tente de novo." });
  }
}
