import { after, NextResponse } from "next/server";
import { avisar, quando } from "@/lib/avisos.server";
import { adminDb } from "@/lib/admin";
import { book } from "@/lib/booking.server";
import { MAX_DAYS_AHEAD, dentroDaJanela } from "@/lib/datetime";
import { BookingInput } from "@/lib/scheduling";

// A reserva da página pública. Rota, não server action: o Next manda um server action
// por vez, e com a rede travada a nova tentativa (e a agenda) ficava na fila atrás da
// primeira. Aqui a tela aborta o pedido com 20 s e o seguinte sai na hora.
// Chamável por qualquer pessoa: toda entrada é validada aqui.
export async function POST(req: Request) {
  // só JSON: outro site não consegue postar aqui sem a checagem de CORS do navegador
  if (!req.headers.get("content-type")?.startsWith("application/json")) return new NextResponse(null, { status: 415 });
  const b = BookingInput.safeParse(await req.json().catch(() => null));
  if (!b.success) return NextResponse.json({ ok: false, error: b.error.issues[0].message, field: true });
  if (!dentroDaJanela(b.data.date)) {
    return NextResponse.json({ ok: false, error: `Agende com até ${MAX_DAYS_AHEAD} dias de antecedência.`, field: true });
  }
  // IP só para contar tentativas por dispositivo; guardado apenas como hash
  // x-real-ip vem do proxy; no x-forwarded-for o primeiro valor é escolhido por
  // quem chama, então vale o último, que foi acrescentado por quem está na frente
  const encaminhado = req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  const ip = req.headers.get("x-real-ip")?.trim() || encaminhado;
  const r = await book(adminDb, b.data, ip);
  // Aviso no celular de quem atende, depois da resposta: push lento não atrasa a reserva.
  // Só a reserva nova: a repetição (resposta perdida, segundo toque) já foi avisada.
  if (r.ok && "novo" in r && r.novo) {
    const { tenantId, customerName } = b.data;
    after(() =>
      avisar(adminDb, tenantId, {
        title: "Novo agendamento",
        body: `${customerName.trim()} · ${r.serviceName} · ${quando(r.date, r.time)}${r.staffName ? ` · com ${r.staffName}` : ""}`,
        url: `/${tenantId}`,
        tag: `agendamento-${r.id}`,
      }).catch((e) => console.error("aviso de agendamento", e)),
    );
  }
  return NextResponse.json(r);
}
