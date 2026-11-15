import "server-only";
import { createHash } from "node:crypto";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { agendaDias, deviceId } from "@/lib/booking.server";
import { customerKey, dateIn, formatTime, todayIn } from "@/lib/datetime";
import { esperaLigada, type Modulos } from "@/lib/modulos";
import { EntradaEspera, MAX_ESPERAS_ATIVAS_POR_TELEFONE, type TipoEspera } from "@/lib/fila-espera";
import { TERMO_ESPERA_VERSAO } from "@/lib/consentimento-whatsapp";

// Entrada e saída da fila de espera pela página pública. Quem entra recebe um token (só o hash é gravado):
// é ele que autoriza sair depois, sem conta.

export type ResultadoEntrada =
  | { ok: true; id: string; tipo: TipoEspera; data: string; preferido: string }
  | { ok: false; error: string; vagou?: true };

const ATIVAS = ["aguardando", "avisada"];
const APARELHO_POR_DIA = 10; // ponytail: 10 pedidos por aparelho e dia; sobe se um caso real travar
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const SEM_HORARIO = "Esse horário não está disponível para aviso. Escolha outro.";
const LIMITE_APARELHO = "Muitos pedidos deste aparelho hoje. Tente amanhã.";
const idDaEspera = (key: string, input: EntradaEspera, tipo: TipoEspera) =>
  sha256(`${key}|${input.date}|${[...input.serviceIds].sort().join(",")}|${input.staffId ?? "*"}|${tipo}`).slice(0, 40);

export async function entrarNaFila(db: Firestore, input: EntradaEspera, ip?: string, agora = new Date()): Promise<ResultadoEntrada> {
  const t = db.doc(`tenants/${input.tenantId}`);
  const tenant = await t.get();
  if (!tenant.exists || !esperaLigada(tenant.get("modulos") as Modulos)) return { ok: false, error: "Este negócio não usa fila de espera." };

  const { date, preferido } = input;
  const key = customerKey(input.customerPhone);
  const hoje = todayIn();
  // sem IP (proxy fora do padrão) todos dividem o mesmo balde: o limite nunca some
  const aparelho = t.collection("limits").doc(`espera-device-${deviceId(ip ?? "sem-ip")}-${hoje}`);
  // o limite antes da grade: a leitura da agenda custa, e este endereço é público
  if (((await aparelho.get()).get("count") ?? 0) >= APARELHO_POR_DIA) return { ok: false, error: LIMITE_APARELHO };
  // a grade sai do mesmo cálculo da página: o horário ou está livre (vagou) ou ocupado (aceita o aviso).
  // Fora da transação: a grade muda sozinha, e quem garante a vaga é o aviso, não este pedido.
  const [dia] = await agendaDias(db, { tenantId: input.tenantId, serviceIds: input.serviceIds, staffId: input.staffId ?? "", from: date }, [date]);
  // data passada: agendaDias troca a faixa por hoje em diante; nesse caso não é o dia pedido
  if (dia?.date !== date) return { ok: false, error: SEM_HORARIO };
  if (dia.horarios.some((h) => h.hora === preferido)) return { ok: false, vagou: true, error: "Boa notícia: esse horário vagou. Agende agora." };
  if (!dia.ocupados?.includes(preferido)) return { ok: false, error: SEM_HORARIO };

  const tipo: TipoEspera = input.agendamentoId ? "troca" : "esperar";
  if (input.agendamentoId) {
    const ag = await t.collection("appointments").doc(input.agendamentoId).get();
    const inicio: Date | undefined = ag.get("start")?.toDate?.();
    const confere =
      ag.exists && ["booked", "confirmed"].includes(ag.get("status")) && ag.get("customerKey") === key && !!inicio && dateIn(inicio) === date && formatTime(inicio) !== preferido;
    if (!confere) return { ok: false, error: "Não encontramos o seu agendamento deste dia." };
  }

  // mesmo cliente, mesmo pedido: a repetição acha o mesmo documento (não cria outra espera)
  const id = idDaEspera(key, input, tipo);
  const ref = t.collection("espera").doc(id);
  const tokenHash = sha256(input.token);
  const agendamento = input.agendamentoId ? { agendamentoId: input.agendamentoId } : {};

  return db.runTransaction(async (tx): Promise<ResultadoEntrada> => {
    // a troca substitui a espera simples do mesmo dia: avisar duas vezes o mesmo cliente não faz sentido
    const simples = tipo === "troca" ? t.collection("espera").doc(idDaEspera(key, input, "esperar")) : null;
    // toda leitura antes de qualquer escrita (regra da transação do Firestore)
    const [atual, contador, anterior, doCliente] = await Promise.all([
      tx.get(ref),
      tx.get(aparelho),
      simples ? tx.get(simples) : null,
      tx.get(t.collection("espera").where("customerKey", "==", key)),
    ]);
    if ((contador.get("count") ?? 0) >= APARELHO_POR_DIA) return { ok: false, error: LIMITE_APARELHO };
    tx.set(aparelho, { count: FieldValue.increment(1), day: hoje }, { merge: true });
    if (atual.exists && ATIVAS.includes(atual.get("status"))) {
      // só quem tem o token muda a espera: o id sai de dados públicos (telefone, dia, serviço), e sem
      // isso qualquer um trocava o horário e o token de outra pessoa
      if (atual.get("tokenHash") !== tokenHash) return { ok: false, error: "Este aviso já foi pedido em outro aparelho. Para mudar, saia por lá ou responda SAIR no WhatsApp." };
      tx.update(ref, { preferido, nome: input.customerName.trim(), ...agendamento });
      return { ok: true, id, tipo, data: date, preferido };
    }
    // ponytail: a contagem por consulta não trava inserções paralelas; dois pedidos no mesmo instante
    // podem passar de 3. O aparelho já limita a 10 por dia; travar por documento se virar abuso
    const ativas = doCliente.docs.filter((d) => ATIVAS.includes(d.get("status")) && d.id !== simples?.id).length;
    if (ativas >= MAX_ESPERAS_ATIVAS_POR_TELEFONE) return { ok: false, error: "Limite de avisos deste número neste negócio. Saia de uma espera para pedir outra." };
    if (anterior?.exists && ATIVAS.includes(anterior.get("status"))) tx.update(simples!, { status: "saiu", saiuEm: agora.getTime(), motivo: "virou-troca" });
    tx.set(ref, {
      tipo,
      customerKey: key,
      nome: input.customerName.trim(),
      telefone: key,
      serviceIds: input.serviceIds,
      staffId: input.staffId,
      data: date,
      preferido,
      ...agendamento,
      status: "aguardando",
      criadaEm: agora.getTime(),
      avisos: [],
      tokenHash,
      consentimento: { aceito: true, versao: TERMO_ESPERA_VERSAO, em: agora, ...(ip && { ipHash: deviceId(ip) }) },
      origem: "site",
    });
    return { ok: true, id, tipo, data: date, preferido };
  });
}

export async function sairDaFila(db: Firestore, tenantId: string, id: string, token: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const ref = db.doc(`tenants/${tenantId}/espera/${id}`);
  return db.runTransaction(async (tx): Promise<{ ok: true } | { ok: false; error: string }> => {
    const e = await tx.get(ref);
    if (!e.exists || e.get("tokenHash") !== sha256(token)) return { ok: false, error: "Não encontramos esta espera." };
    if (e.get("status") === "saiu") return { ok: true };
    if (!ATIVAS.includes(e.get("status"))) return { ok: false, error: "Esta espera já não está ativa." };
    tx.update(ref, { status: "saiu", saiuEm: Date.now() });
    return { ok: true };
  });
}
