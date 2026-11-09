import "server-only";
import type { Firestore } from "firebase-admin/firestore";
import { UserError } from "@/lib/booking.server";
import { formatPhone } from "@/lib/datetime";
import { idDoEstorno, Lancamento } from "@/lib/financeiro";
import { linhasDoRecibo } from "@/lib/recibo";

/** O recibo montado no servidor, do banco: o e-mail não leva o que a tela mandou, só os ids.
 *  As mesmas regras da tela (recibo.tsx): o sinal e o restante do atendimento juntos, o estorno e o emissor. */
export async function reciboDoBanco(db: Firestore, tenantId: string, ids: string[]) {
  const t = db.doc(`tenants/${tenantId}`);
  const col = t.collection("lancamentos");
  // o sinal (sn-) e o restante (ag-) do mesmo atendimento podem estar em meses diferentes
  const pares = ids.filter((id) => /^(ag|sn)-/.test(id)).flatMap((id) => [`ag-${id.slice(3)}`, `sn-${id.slice(3)}`]);
  const todos = [...new Set([...ids, ...pares])];
  const [n, ...docs] = await Promise.all([t.get(), ...todos.map((id) => col.doc(id).get())]);
  const itens = docs.flatMap((d) => {
    const l = d.exists ? Lancamento.safeParse(d.data()) : null;
    return l?.success && l.data.tipo === "entrada" && !l.data.estornoDe ? [{ ...l.data, id: d.id }] : [];
  });
  // um id pedido que não é entrada deste negócio: não sai recibo pela metade
  if (!ids.every((id) => itens.some((i) => i.id === id))) throw new UserError("Recebimento não encontrado.");
  itens.sort((a, b) => a.id.localeCompare(b.id));
  const es = await Promise.all(itens.map((i) => col.doc(idDoEstorno(i.id)).get()));
  const estornos = Object.fromEntries(es.filter((e) => e.exists).map((e) => [String(e.get("estornoDe")), Number(e.get("valorCents")) || 0]));
  return linhasDoRecibo(itens.map((i) => ({ ...i, estornadoCents: estornos[i.id] ?? 0 })), {
    nome: String(n.get("name") ?? ""),
    telefone: n.get("site.phone") ? formatPhone(String(n.get("site.phone"))) : null,
    endereco: [n.get("site.address"), n.get("site.bairro")].filter(Boolean).join(", ") || null,
    cidade: n.get("site.city") ?? null,
    uf: n.get("site.uf") ?? null,
  });
}
