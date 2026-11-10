import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/admin";
import { avanca, deltaDoConsumo, mascararDestino, PRECOS_PADRAO, precoDe, quandoFoi, statusDoAtendys, type Canal, type Destinatario, type Precos, type StatusEnvio, type TipoEnvio, type Via } from "@/lib/consumo";

// Registro de cada mensagem que sai (tenants/{slug}/envios/{id}) e o agregado do mês
// (tenants/{slug}/consumo/{YYYY-MM}), gravados juntos pelo servidor. Regras em consumo.ts.
// Nunca lança: registrar é para o painel e a cobrança; o envio já foi decidido.

const DOC_PRECOS = "config/precos";
const VALIDADE_MS = 60_000;
let cache: { em: number; leitura: Promise<Precos> } | null = null;

const inteiro = (v: unknown, padrao: number) => (Number.isInteger(v) && (v as number) >= 0 ? (v as number) : padrao);

/** Preço vigente (config/precos, editado no /admin); sem ele, PRECOS_PADRAO. Cache de 60 s. */
export function lerPrecos(): Promise<Precos> {
  if (!cache || Date.now() - cache.em > VALIDADE_MS) {
    const leitura = adminDb.doc(DOC_PRECOS).get().then(
      (d) => ({
        whatsappUtilityCents: inteiro(d.get("whatsappUtilityCents"), PRECOS_PADRAO.whatsappUtilityCents),
        whatsappServiceCents: inteiro(d.get("whatsappServiceCents"), PRECOS_PADRAO.whatsappServiceCents),
        smsCents: inteiro(d.get("smsCents"), PRECOS_PADRAO.smsCents),
      }),
      (e) => {
        console.error("[consumo] não li config/precos", e);
        cache = null;
        return PRECOS_PADRAO;
      },
    );
    cache = { em: Date.now(), leitura };
  }
  return cache.leitura;
}

export async function salvarPrecos(p: Precos, por: string) {
  await adminDb.doc(DOC_PRECOS).set({ ...p, atualizadoEm: FieldValue.serverTimestamp(), por });
  cache = null;
}

// as folhas do delta viram increment (set com merge soma em mapas aninhados)
type Arvore = { [k: string]: number | Arvore };
const incrementos = (a: Arvore): Record<string, unknown> =>
  Object.fromEntries(Object.entries(a).map(([k, v]) => [k, typeof v === "number" ? FieldValue.increment(v) : incrementos(v)]));

const envioRef = (slug: string, id: string) => adminDb.doc(`tenants/${slug}/envios/${id}`);
const consumoRef = (slug: string, mes: string) => adminDb.doc(`tenants/${slug}/consumo/${mes}`);

export type NovoEnvio = {
  id: string;
  canal: Canal;
  via: Via;
  tipo: TipoEnvio;
  template?: string;
  /** telefone do destino: só a máscara é gravada */
  fone: string;
  destinatario: Destinatario;
  agendamentoId?: string;
  /** status do atendys (queued, awaiting_manual…) ou o nosso */
  status: StatusEnvio;
  erro?: string;
  /** resposta dentro da janela de 24 h: preço "service" */
  servico?: boolean;
};

/** Grava o envio e soma no mês. O mesmo id outra vez (idempotency-key devolve a mensagem já aceita)
 *  não soma de novo: create falha e o lote inteiro não vai. */
export async function registrarEnvio(slug: string, n: NovoEnvio, agora = new Date()): Promise<void> {
  try {
    const precoCents = precoDe(await lerPrecos(), n.canal, !!n.servico);
    const { mes, dia } = quandoFoi(agora);
    const delta = deltaDoConsumo({ canal: n.canal, via: n.via, tipo: n.tipo, precoCents, dia }, null, n.status);
    const b = adminDb.batch();
    b.create(envioRef(slug, n.id), {
      canal: n.canal,
      via: n.via,
      tipo: n.tipo,
      ...(n.template && { template: n.template }),
      destino: mascararDestino(n.fone),
      destinatario: n.destinatario,
      ...(n.agendamentoId && { agendamentoId: n.agendamentoId }),
      status: n.status,
      ...(n.erro && { erro: n.erro }),
      precoCents,
      custoCents: Number((delta as { custoCents?: number }).custoCents ?? 0),
      moeda: "BRL",
      em: agora,
      mes,
      atualizadoEm: FieldValue.serverTimestamp(),
    });
    b.set(consumoRef(slug, mes), { mes, ...incrementos(delta), atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
    await b.commit();
  } catch (e) {
    if ((e as { code?: number }).code === 6) return; // ALREADY_EXISTS: o mesmo envio repetido
    console.error(`[consumo] não registrou o envio ${n.id} de ${slug}`, e);
  }
}

/** Status novo (webhook message.status, conferência logo depois do aceite): atualiza o envio e
 *  acerta o mês dele (falhou devolve o custo). Status que não avança (webhook atrasado) não mexe. */
/** at: quando o fato aconteceu (o "at" do webhook); um mais velho que o último aplicado não mexe. */
export async function atualizarEnvio(slug: string, id: string, statusAtendys: string, erro?: string | null, at = Date.now()): Promise<void> {
  const para = statusDoAtendys(statusAtendys);
  if (!para) return;
  try {
    await adminDb.runTransaction(async (tx) => {
      const d = await tx.get(envioRef(slug, id));
      if (!d.exists) return;
      const de = d.get("status") as StatusEnvio;
      if (!avanca(de, para) || Number(d.get("statusEm") ?? 0) > at) return;
      const e = { canal: d.get("canal"), via: d.get("via"), tipo: d.get("tipo"), precoCents: Number(d.get("precoCents") ?? 0), dia: "" };
      const delta = deltaDoConsumo(e, de, para);
      const dCusto = Number((delta as { custoCents?: number }).custoCents ?? 0);
      tx.update(d.ref, {
        status: para,
        statusEm: at,
        ...(para === "falhou" ? (erro ? { erro } : {}) : { erro: FieldValue.delete() }),
        ...(dCusto && { custoCents: FieldValue.increment(dCusto) }),
        atualizadoEm: FieldValue.serverTimestamp(),
      });
      tx.set(consumoRef(slug, String(d.get("mes"))), { ...incrementos(delta), atualizadoEm: FieldValue.serverTimestamp() }, { merge: true });
    });
  } catch (e) {
    console.error(`[consumo] não atualizou o envio ${id} de ${slug}`, e);
  }
}
