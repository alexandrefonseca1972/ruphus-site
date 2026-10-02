import "server-only";
import { sessaoRevogada } from "@/lib/revogacao";
import { ErroPrevisto } from "@/lib/erro-previsto";
import { createHash } from "node:crypto";
import { FieldValue, type Firestore, type Timestamp, type Transaction } from "firebase-admin/firestore";
import { addDays, agoraNaParede, customerKey, dateIn, formatTime, freeSlots, fusoDaUF, planDates, todayIn, weekday, zonedTime } from "@/lib/datetime";
import type { DadosCliente } from "@/lib/cliente-dados";
import { Service, Staff, type AgendaQuery, type BookingInput, type PlanInput, type RescheduleInput, type SlotQuery } from "@/lib/scheduling";

const SLUG = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;

/** Dados públicos da página de agendamento. Nunca inclui dados de clientes. */
/** Tirado do ar pelo admin (cobrança): a agenda pública não abre nem reserva. O proxy
 *  só barra o subdomínio; o link que o painel divulga é www.ruphus.site/agendar/{slug}. */
async function foraDoAr(db: Firestore, tenantId: string) {
  return (await db.doc(`crm/${tenantId}`).get()).get("publicado") === false;
}
const FORA_DO_AR = "Este negócio não está recebendo agendamentos online agora.";

export async function loadCatalog(db: Firestore, tenantId: string) {
  if (!SLUG.test(tenantId)) return null;
  const t = db.collection("tenants").doc(tenantId);
  const [tenant, services, staff, fora] = await Promise.all([
    t.get(),
    t.collection("services").where("active", "==", true).get(),
    t.collection("staff").where("active", "==", true).get(),
    foraDoAr(db, tenantId),
  ]);
  if (!tenant.exists || fora) return null;
  return {
    name: String(tenant.get("name")),
    // o WhatsApp do negócio: é por ele que o agendamento chega a quem atende
    phone: (tenant.get("site.phone") as string | null) ?? null,
    // Nota e cidade saem do mesmo snapshot já lido: quem chega pelo link não
    // conhece a marca e vai digitar o telefone nesta página.
    rating: (tenant.get("site.rating") as number | null) ?? null,
    reviews: (tenant.get("site.reviews") as number | null) ?? null,
    city: (tenant.get("site.city") as string | null) ?? null,
    // o "Como chegar" depois de agendar: sem rua, bairro e cidade já apontam no mapa
    uf: (tenant.get("site.uf") as string | null) ?? null,
    address: (tenant.get("site.address") as string | null) ?? null,
    bairro: (tenant.get("gerado.bairro") as string | null) || null,
    // tem página própria (fábrica ou gerador): o nome no topo leva a ela no computador
    temSite: !!(tenant.get("gerado.sub") || tenant.get("site.url")),
    // o recado do dono na confirmação; sem ele, a tela usa o texto padrão
    recadoDono: String(tenant.get("agenda.recado") ?? "").trim() || null,
    // Ordem: o que mais se agenda primeiro. Enquanto ninguém agendou, vale a
    // ordem em que o site lista os serviços (ordem), que é a do próprio negócio.
    services: services.docs
      .flatMap((d) => {
        const s = Service.safeParse(d.data());
        const usos = typeof d.get("usos") === "number" ? (d.get("usos") as number) : 0;
        const ordem = typeof d.get("ordem") === "number" ? (d.get("ordem") as number) : 99;
        return s.success ? [{ id: d.id, name: s.data.name, durationMin: s.data.durationMin, priceCents: s.data.priceCents, tipoPreco: s.data.tipoPreco, usos, ordem }] : [];
      })
      .sort((a, b) => b.usos - a.usos || a.ordem - b.ordem || a.name.localeCompare(b.name, "pt-BR"))
      .map(({ usos, ordem, ...s }) => s),
    staff: staff.docs.flatMap((d) => {
      const s = Staff.safeParse(d.data());
      // workDays: dias da semana em que atende (para desabilitar datas na página pública)
      return s.success ? [{ id: d.id, name: s.data.name, serviceIds: s.data.serviceIds, workDays: Object.keys(s.data.hours).map(Number) }] : [];
    }),
  };
}

/** Garante que o token é válido e o usuário é membro do tenant. */
export type VerifyToken = (idToken: string) => Promise<{ uid: string; email?: string; authTimeMs: number }>;

/** Erro cuja mensagem pode ser mostrada para a pessoa */
export class UserError extends ErroPrevisto {}

/** Corrige o nome do cliente.
 *
 * O nome vem do que a propria pessoa digitou no celular ao agendar, e fica
 * copiado dentro de cada agendamento. Corrigir so o documento do cliente
 * deixaria a agenda — que e o que o dono le todo dia — mostrando o erro para
 * sempre, entao os agendamentos futuros vao junto. Os passados ficam como
 * estao: historico guarda o que foi dito na epoca.
 *
 * ponytail: um batch so; um cliente com mais de 499 horarios futuros estoura o
 * limite do Firestore. Paginar quando alguem chegar perto disso. */
export async function renameCustomer(
  db: Firestore,
  { tenantId, customerId, name }: { tenantId: string; customerId: string; name: string },
  user: { uid: string },
) {
  // renomear reescreve o nome em todos os horários futuros: mesma régua do excluir
  await exigeDono(db, tenantId, user.uid, "renomear clientes");
  const t = db.collection("tenants").doc(tenantId);
  const cliente = t.collection("customers").doc(customerId);
  if (!(await cliente.get()).exists) throw new UserError("Cliente nao encontrado.");

  const futuros = await t
    .collection("appointments")
    .where("customerKey", "==", customerId)
    .where("start", ">", new Date())
    .get();

  const batch = db.batch();
  batch.update(cliente, { name, updatedAt: FieldValue.serverTimestamp() });
  for (const d of futuros.docs) batch.update(d.ref, { customerName: name });
  await batch.commit();
  return { ok: true as const, name, agendamentos: futuros.size };
}

/** Data de nascimento e e-mail do cliente, que o dono registra. São dados pessoais: só
 *  dono ou admin do negócio grava, e só pelo servidor, que confere de novo (as regras
 *  do Firestore não deixam o navegador escrever esses campos). Vazio apaga. */
export async function salvarDadosCliente(
  db: Firestore,
  { tenantId, customerId, dados }: { tenantId: string; customerId: string; dados: DadosCliente },
  user: { uid: string },
) {
  await exigeDono(db, tenantId, user.uid, "registrar dados do cliente");
  const cliente = db.collection("tenants").doc(tenantId).collection("customers").doc(customerId);
  if (!(await cliente.get()).exists) throw new UserError("Cliente não encontrado.");
  await cliente.update({
    nascimento: dados.nascimento || FieldValue.delete(),
    email: dados.email || FieldValue.delete(),
    updatedAt: FieldValue.serverTimestamp(),
  });
  return { ok: true as const };
}

/** Exclui o cliente e as anotações dele. Só dono ou admin do negócio (ou da plataforma).
 *
 * Os agendamentos passados ficam: guardam uma cópia do nome e do telefone, e a
 * agenda e o faturamento de meses atrás não podem mudar porque alguém saiu da
 * lista. Com horário marcado ou plano ativo não exclui — cancelar primeiro, para
 * ninguém chegar ao salão sem estar na agenda de ninguém. */
export async function deleteCustomer(
  db: Firestore,
  { tenantId, customerId }: { tenantId: string; customerId: string },
  user: { uid: string },
) {
  const t = db.collection("tenants").doc(tenantId);
  await exigeDono(db, tenantId, user.uid, "excluir clientes");

  const cliente = t.collection("customers").doc(customerId);
  const [snap, futuros, planos] = await Promise.all([
    cliente.get(),
    t.collection("appointments").where("customerKey", "==", customerId).where("start", ">", new Date()).get(),
    t.collection("plans").where("customerKey", "==", customerId).where("status", "==", "active").limit(1).get(),
  ]);
  if (!snap.exists) throw new UserError("Cliente não encontrado.");
  if (!planos.empty) throw new UserError("Encerre o plano recorrente antes de excluir.");
  if (futuros.docs.some((d) => ["booked", "confirmed"].includes(d.get("status")))) {
    throw new UserError("Este cliente tem horário marcado. Cancele antes de excluir.");
  }
  await db.recursiveDelete(cliente); // leva junto customers/{id}/notas
  return { ok: true as const };
}

/** Papel de dono ou admin do negócio: as ações que reescrevem a base do cliente
 *  não são de recepção. O admin da plataforma passa, como nas regras. */
async function exigeDono(db: Firestore, tenantId: string, uid: string, oque: string) {
  const [member, admin] = await Promise.all([
    db.doc(`tenants/${tenantId}/members/${uid}`).get(),
    db.doc("config/admin").get(),
  ]);
  const daPlataforma = (admin.get("uids") as unknown[] | undefined)?.includes(uid) ?? false;
  if (!daPlataforma && !["owner", "admin"].includes(member.get("role"))) {
    throw new UserError(`Só o dono ou um administrador do negócio pode ${oque}.`);
  }
}

export async function requireMember(verify: VerifyToken, db: Firestore, idToken: string, tenantId: string) {
  const user = await verify(idToken).catch(() => {
    throw new UserError("Sessão expirada. Entre novamente.");
  });
  const [member, admin] = await Promise.all([
    db.doc(`tenants/${tenantId}/members/${user.uid}`).get(),
    db.doc("config/admin").get(),
  ]);
  // quem administra a plataforma atende em qualquer espaço, como nas regras do Firestore
  const daPlataforma = (admin.get("uids") as unknown[] | undefined)?.includes(user.uid) ?? false;
  if (!member.exists && !daPlataforma) throw new UserError("Você não tem acesso a este negócio.");
  // Token de quem teve a sessão encerrada não vale mais, mesmo sem ter expirado
  if (sessaoRevogada(admin.get("revogados"), user.uid, user.authTimeMs)) {
    throw new UserError("Sua sessão foi encerrada. Entre novamente.");
  }
  return user;
}

// excludeId: ao remarcar, o próprio agendamento não conta como ocupado
async function slotContext(tx: Transaction, db: Firestore, q: SlotQuery, excludeId?: string) {
  const t = db.collection("tenants").doc(q.tenantId);
  const [tenantSnap, staffSnap, ...svcSnaps] = await tx.getAll(
    t,
    t.collection("staff").doc(q.staffId),
    ...q.serviceIds.map((id) => t.collection("services").doc(id)),
  );
  const staff = Staff.safeParse(staffSnap.data());
  const services = svcSnaps.map((s) => Service.safeParse(s.data()));
  if (
    !staff.success ||
    !staff.data.active ||
    !q.serviceIds.every((id) => staff.data.serviceIds.includes(id)) ||
    services.some((s) => !s.success || !s.data.active)
  ) {
    return null;
  }
  const svc = services.map((s) => s.data!);
  const durationMin = svc.reduce((sum, s) => sum + s.durationMin, 0);
  // Lido dentro da transação: uma reserva concorrente no mesmo dia/profissional força retry
  const booked = await tx.get(
    t
      .collection("appointments")
      .where("staffId", "==", q.staffId)
      .where("start", ">=", zonedTime(q.date, "00:00"))
      .where("start", "<", zonedTime(addDays(q.date, 1), "00:00")),
  );
  const slots = freeSlots({
    date: q.date,
    window: staff.data.hours[String(weekday(q.date)) as keyof Staff["hours"]],
    durationMin,
    busy: booked.docs
      .filter((d) => d.get("status") !== "cancelled" && d.id !== excludeId)
      .map((d) => ({ start: (d.get("start") as Timestamp).toDate(), end: (d.get("end") as Timestamp).toDate() })),
    // o que já passou é pela hora local do negócio (Manaus está 1h atrás de Brasília)
    now: agoraNaParede(fusoDaUF(tenantSnap.get("site.uf") as string | undefined)),
  });
  return { t, svc, durationMin, staff: staff.data, slots };
}

export async function availableSlots(db: Firestore, q: SlotQuery) {
  if (await foraDoAr(db, q.tenantId)) return [];
  return db.runTransaction(async (tx) => (await slotContext(tx, db, q))?.slots ?? [], { readOnly: true });
}

/** Os dias e horários que a página pública mostra de uma vez.
 *
 * Com staffId vazio a agenda é a união da equipe que faz todos os serviços
 * escolhidos, e cada horário já sai com o profissional que vai atender — assim
 * escolher profissional deixa de ser um passo para quem não tem preferência.
 *
 * ponytail: uma transação por dia e por profissional (dias × equipe). Na escala
 * de hoje, com equipes pequenas, é barato; se uma equipe crescer, vale ler os
 * agendamentos da semana inteira de uma vez e montar os dias em memória.
 */
export async function agendaDias(db: Firestore, q: AgendaQuery, dias: string[]) {
  const catalog = await loadCatalog(db, q.tenantId);
  if (!catalog) return [];
  const equipe = catalog.staff.filter(
    (p) => (!q.staffId || p.id === q.staffId) && q.serviceIds.every((id) => p.serviceIds.includes(id)),
  );
  const grade = await Promise.all(
    dias.map(async (date) => {
      // Só quem atende neste dia da semana entra na conta
      const doDia = equipe.filter((p) => p.workDays.includes(weekday(date)));
      const porProfissional = await Promise.all(
        doDia.map(async (p) => [p.id, await availableSlots(db, { ...q, staffId: p.id, date })] as const),
      );
      // Ordem do catálogo decide quem fica com o horário que dois podem atender
      const horarios = new Map<string, string>();
      for (const [staffId, horas] of porProfissional) {
        for (const hora of horas) if (!horarios.has(hora)) horarios.set(hora, staffId);
      }
      return {
        date,
        horarios: [...horarios]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([hora, staffId]) => ({ hora, staffId })),
      };
    }),
  );
  return grade;
}

type Actor = { uid: string; email?: string };

// Trava simples contra reservas em massa pela página pública (sem captcha nem serviço externo)
export const LIMITS = { activePerPhone: 3, dailyPerPhone: 5, dailyPerDevice: 20 };
const deviceId = (ip: string) => createHash("sha256").update(`siteflow:${ip}`).digest("hex").slice(0, 16);

/** Conta e valida limites do dia. Devolve a mensagem quando estourou. */
async function limitError(
  tx: Transaction,
  t: FirebaseFirestore.DocumentReference,
  input: BookingInput,
  ip: string | undefined,
) {
  const key = customerKey(input.customerPhone);
  const day = todayIn();
  const phoneRef = t.collection("limits").doc(`phone-${key}-${day}`);
  const deviceRef = ip ? t.collection("limits").doc(`device-${deviceId(ip)}-${day}`) : null;
  const [phoneDoc, deviceDoc] = await tx.getAll(phoneRef, ...(deviceRef ? [deviceRef] : []));
  const future = await tx.get(
    t.collection("appointments").where("customerKey", "==", key).where("start", ">", new Date()),
  );
  const active = future.docs.filter((d) => ["booked", "confirmed"].includes(d.get("status"))).length;

  if (active >= LIMITS.activePerPhone) {
    return { error: `Você já tem ${LIMITS.activePerPhone} horários marcados. Cancele um deles com o negócio, pelo WhatsApp, para marcar outro.` };
  }
  if ((phoneDoc.get("count") ?? 0) >= LIMITS.dailyPerPhone) {
    return { error: "Muitos agendamentos com este WhatsApp hoje. Tente amanhã ou fale direto com o negócio." };
  }
  if (deviceDoc && (deviceDoc.get("count") ?? 0) >= LIMITS.dailyPerDevice) {
    return { error: "Muitos agendamentos deste dispositivo hoje. Tente amanhã ou fale direto com o negócio." };
  }
  // ponytail: contadores por dia ficam guardados; se incomodar, ligue TTL no campo day
  return { bump: () => {
    tx.set(phoneRef, { count: FieldValue.increment(1), day }, { merge: true });
    if (deviceRef) tx.set(deviceRef, { count: FieldValue.increment(1), day }, { merge: true });
  } };
}
// Reservas concorrentes no mesmo profissional/dia disputam a mesma transação: mais tentativas antes de desistir
const TX = { maxAttempts: 10 };
const BUSY_ERROR = "Muita gente agendando ao mesmo tempo. Tente de novo em instantes.";

/** Erro de disputa (ABORTED/lock timeout) vira mensagem para a pessoa, e não exceção. */
async function contended<T>(run: () => Promise<T>): Promise<T | { ok: false; error: string; field: true }> {
  try {
    return await run();
  } catch (err) {
    const { code, message = "" } = err as { code?: number | string; message?: string };
    // 10 = ABORTED; 4 = DEADLINE_EXCEEDED, que o Firestore usa para estouro de trava
    if (code === 10 || code === "aborted" || (code === 4 && /lock|contention/i.test(message))) {
      console.error("[booking] disputa na transação", err);
      // field: a pessoa fica na confirmação, com a escolha, e tenta de novo
      return { ok: false as const, error: BUSY_ERROR, field: true as const };
    }
    throw err;
  }
}
type SlotContext = NonNullable<Awaited<ReturnType<typeof slotContext>>>;
type WriteContext = Pick<SlotContext, "t" | "svc" | "durationMin" | "staff">;

/** Grava agendamento + registro "created" + cadastro do cliente. Só escritas: chame depois de todas as leituras. */
function writeAppointment(
  tx: Transaction,
  ctx: WriteContext,
  a: { serviceIds: string[]; staffId: string; date: string; time: string; customerName: string; customerPhone: string },
  by: { by: string; byName: string },
  opts: { planId?: string; renameCustomer: boolean },
) {
  const { planId } = opts;
  const start = zonedTime(a.date, a.time);
  const ref = ctx.t.collection("appointments").doc();
  const history = ctx.t.collection("history").doc();
  const key = customerKey(a.customerPhone);
  tx.create(history, { appointmentId: ref.id, type: "created", at: FieldValue.serverTimestamp(), ...by, ...(planId && { planId }) });
  const dados = {
    lastHistoryId: history.id,
    serviceIds: a.serviceIds,
    serviceName: ctx.svc.map((s) => s.name).join(" + "),
    durationMin: ctx.durationMin,
    priceCents: ctx.svc.reduce((sum, s) => sum + s.priceCents, 0),
    // algum serviço "a partir de" ou sem preço: o valor é o mínimo, não o final
    precoAberto: ctx.svc.some((s) => (s.tipoPreco ?? "fixo") !== "fixo"),
    staffId: a.staffId,
    staffName: ctx.staff.name,
    start,
    end: new Date(start.getTime() + ctx.durationMin * 60_000),
    customerKey: key,
    customerName: a.customerName,
    customerPhone: a.customerPhone,
    status: "booked",
    createdAt: FieldValue.serverTimestamp(),
    ...(planId && { planId }),
  };
  tx.create(ref, dados);
  // Reserva anônima não troca o nome de um cliente já cadastrado (qualquer um pode digitar o telefone de outro)
  tx.set(
    ctx.t.collection("customers").doc(key),
    { ...(opts.renameCustomer && { name: a.customerName }), phone: a.customerPhone, updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  return { id: ref.id, dados };
}

/** O que a tela de confirmado mostra: o que ficou gravado, não o que a tela pediu
 *  (a resposta pode chegar depois de o cliente mexer na grade, ou a equipe ter mudado). */
function reservaDe(id: string, a: FirebaseFirestore.DocumentData) {
  const start: Date = a.start instanceof Date ? a.start : (a.start as Timestamp).toDate();
  return {
    id,
    staffName: String(a.staffName),
    serviceName: String(a.serviceName),
    durationMin: Number(a.durationMin),
    priceCents: Number(a.priceCents),
    precoAberto: !!a.precoAberto,
    date: dateIn(start),
    time: formatTime(start),
  };
}

/** Confirmar de novo o que já foi reservado (resposta perdida na rede, toque depois do aviso
 *  de demora, página recarregada) acha a reserva pelo pedido da tela, mesmo que a escolha
 *  tenha mudado: a tela mostra o que ficou marcado, não um segundo horário. Pelo pedido, não
 *  por telefone e hora: a mãe que marca os dois filhos às 10:00 faz duas reservas. Uma marca
 *  por pedido, e não uma consulta: duas tentativas ao mesmo tempo leem o mesmo documento, e
 *  a transação faz a segunda esperar a primeira. */
async function reservaDoPedido(
  ler: (ref: FirebaseFirestore.DocumentReference) => Promise<FirebaseFirestore.DocumentSnapshot>,
  t: FirebaseFirestore.DocumentReference,
  input: BookingInput,
) {
  if (!input.pedido) return null;
  const marca = await ler(t.collection("pedidos").doc(input.pedido));
  if (!marca.exists) return null;
  const ja = await ler(t.collection("appointments").doc(String(marca.get("appointmentId"))));
  // cancelada: o pedido vale para uma reserva nova
  if (ja.get("status") === "cancelled" || ja.get("customerKey") !== customerKey(input.customerPhone)) return null;
  return ja.exists ? reservaDe(ja.id, ja.data()!) : null;
}

export async function book(db: Firestore, input: BookingInput, ip?: string) {
  const t = db.collection("tenants").doc(input.tenantId);
  // Fora do ar não aceita reserva nova, mas a repetição de uma já feita (a resposta se
  // perdeu e o negócio saiu do ar nesse meio-tempo) ainda devolve a reserva
  if (await foraDoAr(db, input.tenantId)) {
    const ja = await reservaDoPedido((ref) => ref.get(), t, input);
    return ja ? { ok: true as const, ...ja } : { ok: false as const, error: FORA_DO_AR, field: true as const };
  }
  const r = await contended(() => db.runTransaction(async (tx) => {
    // antes da equipe e da grade, que podem ter mudado depois de reservado
    const ja = await reservaDoPedido((ref) => tx.get(ref), t, input);
    if (ja) return { ok: true as const, ...ja, novo: false };
    // O oferecido na grade primeiro; só no "qualquer profissional", e só se ele foi tomado,
    // lê o resto da equipe (ler todos sempre travava o dia da equipe inteira na transação)
    let livre: { staffId: string; ctx: SlotContext } | undefined;
    let algum = false;
    const tenta = async (staffId: string) => {
      const ctx = await slotContext(tx, db, { ...input, staffId });
      algum ||= !!ctx;
      if (ctx?.slots.includes(input.time)) livre = { staffId, ctx };
    };
    await tenta(input.staffId);
    if (!livre && input.qualquer) {
      const equipe = await tx.get(t.collection("staff").where("active", "==", true));
      for (const d of equipe.docs) {
        const faz = (d.get("serviceIds") as string[] | undefined) ?? [];
        if (d.id !== input.staffId && input.serviceIds.every((id) => faz.includes(id))) await tenta(d.id);
        if (livre) break;
      }
    }
    if (!algum) return { ok: false as const, error: "Serviço ou profissional indisponível." };
    if (!livre) return { ok: false as const, error: "Esse horário acabou de ser ocupado. Escolha outro." };
    const limit = await limitError(tx, livre.ctx.t, input, ip);
    if (limit.error) return { ok: false as const, error: limit.error, field: true as const };
    const customer = await tx.get(t.collection("customers").doc(customerKey(input.customerPhone)));
    const { id, dados } = writeAppointment(tx, livre.ctx, { ...input, staffId: livre.staffId }, { by: "cliente", byName: input.customerName }, { renameCustomer: !customer.exists });
    if (input.pedido) tx.set(t.collection("pedidos").doc(input.pedido), { appointmentId: id, createdAt: FieldValue.serverTimestamp() });
    limit.bump!();
    return { ok: true as const, ...reservaDe(id, dados), novo: true };
  }, TX));
  if (!r.ok) return r;
  if (r.novo) await contarUso(db, input.tenantId, input.serviceIds);
  const { novo: _, ...reserva } = r;
  return reserva;
}

/** Popularidade (ordena a página pública). Fora da transação da reserva: dentro, toda
 *  reserva do mesmo serviço disputava o mesmo documento, mesmo com outra pessoa e outro
 *  dia, e um pico dava "Muita gente agendando" sem conflito de verdade. */
async function contarUso(db: Firestore, tenantId: string, serviceIds: string[], vezes = 1) {
  const t = db.collection("tenants").doc(tenantId);
  await Promise.all(serviceIds.map((id) => t.collection("services").doc(id).set({ usos: FieldValue.increment(vezes) }, { merge: true })))
    .catch((err) => console.error("[booking] contar uso", err)); // contador não derruba a reserva
}

/** Cria o plano e um agendamento por semana. Datas ocupadas (ou já passadas) são puladas e devolvidas. */
export async function createPlan(db: Firestore, input: PlanInput, actor: Actor) {
  const r = await criarPlano(db, input, actor);
  if (r.ok && r.created.length) await contarUso(db, input.tenantId, input.serviceIds, r.created.length);
  return r;
}

async function criarPlano(db: Firestore, input: PlanInput, actor: Actor) {
  return contended(() => db.runTransaction(async (tx) => {
    const dates = planDates(input.startDate, input.weekday, input.weeks);
    const t = db.collection("tenants").doc(input.tenantId);
    // Uma leitura só para o negócio, o profissional e os serviços, e uma consulta para toda a janela do plano
    const [tenantSnap, staffSnap, ...svcSnaps] = await tx.getAll(
      t,
      t.collection("staff").doc(input.staffId),
      ...input.serviceIds.map((id) => t.collection("services").doc(id)),
    );
    const staff = Staff.safeParse(staffSnap.data());
    const services = svcSnaps.map((s) => Service.safeParse(s.data()));
    if (
      !staff.success ||
      !staff.data.active ||
      !input.serviceIds.every((id) => staff.data.serviceIds.includes(id)) ||
      services.some((s) => !s.success || !s.data.active)
    ) {
      return { ok: false as const, error: "Serviço ou profissional indisponível." };
    }
    const svc = services.map((s) => s.data!);
    const durationMin = svc.reduce((sum, s) => sum + s.durationMin, 0);
    const ctx: WriteContext = { t, svc, durationMin, staff: staff.data };
    // ponytail: uma consulta para toda a janela trava o período inteiro do plano;
    // se planos longos começarem a falhar por disputa, quebre em blocos mensais
    const booked = await tx.get(
      t
        .collection("appointments")
        .where("staffId", "==", input.staffId)
        .where("start", ">=", zonedTime(dates[0], "00:00"))
        .where("start", "<", zonedTime(addDays(dates.at(-1)!, 1), "00:00")),
    );
    const busy = booked.docs
      .filter((d) => d.get("status") !== "cancelled")
      .map((d) => ({ start: (d.get("start") as Timestamp).toDate(), end: (d.get("end") as Timestamp).toDate() }));
    const now = agoraNaParede(fusoDaUF(tenantSnap.get("site.uf") as string | undefined));
    const free: string[] = [];
    const skipped: string[] = [];
    for (const date of dates) {
      const slots = freeSlots({
        date,
        window: staff.data.hours[String(weekday(date)) as keyof Staff["hours"]],
        durationMin,
        busy,
        now,
      });
      (slots.includes(input.time) ? free : skipped).push(date);
    }
    if (free.length === 0) {
      return { ok: false as const, error: "Nenhuma das datas tem esse horário livre com o profissional." };
    }
    const plan = t.collection("plans").doc();
    const by = { by: actor.uid, byName: actor.email ?? actor.uid };
    tx.create(plan, {
      customerKey: customerKey(input.customerPhone),
      customerName: input.customerName,
      serviceIds: input.serviceIds,
      serviceName: svc.map((s) => s.name).join(" + "),
      staffId: input.staffId,
      staffName: staff.data.name,
      weekday: input.weekday,
      time: input.time,
      firstDate: free[0],
      lastDate: free.at(-1)!,
      count: free.length,
      skipped,
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
      createdBy: by.byName,
    });
    for (const date of free) writeAppointment(tx, ctx, { ...input, date }, by, { planId: plan.id, renameCustomer: true });
    return { ok: true as const, planId: plan.id, created: free, skipped };
  }, TX));
}

/** Encerra o plano: cancela os agendamentos futuros dele, com registro no histórico. */
export async function endPlan(db: Firestore, input: { tenantId: string; planId: string }, actor: Actor) {
  return contended(() => db.runTransaction(async (tx) => {
    const t = db.collection("tenants").doc(input.tenantId);
    const plan = await tx.get(t.collection("plans").doc(input.planId));
    if (!plan.exists || plan.get("status") !== "active") return { ok: false as const, error: "Plano não encontrado ou já encerrado." };
    const future = await tx.get(
      t.collection("appointments").where("planId", "==", input.planId).where("start", ">", new Date()),
    );
    const toCancel = future.docs.filter((d) => ["booked", "confirmed"].includes(d.get("status")));
    const by = { by: actor.uid, byName: actor.email ?? actor.uid };
    for (const appt of toCancel) {
      const history = t.collection("history").doc();
      tx.create(history, { appointmentId: appt.id, type: "cancelled", reason: "plan_ended", at: FieldValue.serverTimestamp(), ...by });
      tx.update(appt.ref, { status: "cancelled", lastHistoryId: history.id });
    }
    tx.update(plan.ref, { status: "ended", endedAt: FieldValue.serverTimestamp(), endedBy: by.byName });
    return { ok: true as const, cancelled: toCancel.length };
  }, TX));
}

async function rescheduleContext(tx: Transaction, db: Firestore, q: Omit<RescheduleInput, "time">) {
  const ref = db.doc(`tenants/${q.tenantId}/appointments/${q.appointmentId}`);
  const appt = await tx.get(ref);
  if (!appt.exists || !["booked", "confirmed"].includes(appt.get("status"))) return null;
  const query = { tenantId: q.tenantId, serviceIds: appt.get("serviceIds") as string[], staffId: appt.get("staffId") as string, date: q.date };
  const ctx = await slotContext(tx, db, query, q.appointmentId);
  return ctx && { ...ctx, ref, appt };
}

export async function rescheduleSlots(db: Firestore, q: Omit<RescheduleInput, "time">) {
  return db.runTransaction(async (tx) => (await rescheduleContext(tx, db, q))?.slots ?? [], { readOnly: true });
}

export async function reschedule(db: Firestore, input: RescheduleInput, actor: Actor) {
  return contended(() => db.runTransaction(async (tx) => {
    const ctx = await rescheduleContext(tx, db, input);
    if (!ctx) return { ok: false as const, error: "Agendamento, serviço ou profissional indisponível." };
    if (!ctx.slots.includes(input.time)) return { ok: false as const, error: "Esse horário não está livre. Escolha outro." };
    const start = zonedTime(input.date, input.time);
    const end = new Date(start.getTime() + ctx.durationMin * 60_000);
    const history = ctx.t.collection("history").doc();
    tx.create(history, {
      appointmentId: ctx.ref.id,
      type: "rescheduled",
      at: FieldValue.serverTimestamp(),
      by: actor.uid,
      byName: actor.email ?? actor.uid,
      from: { start: ctx.appt.get("start"), end: ctx.appt.get("end") },
      to: { start, end },
    });
    tx.update(ctx.ref, {
      lastHistoryId: history.id,
      start,
      end,
      // Duração vem dos serviços atuais: mantém nome/duração/preço coerentes com o novo fim
      serviceName: ctx.svc.map((s) => s.name).join(" + "),
      durationMin: ctx.durationMin,
      priceCents: ctx.svc.reduce((sum, s) => sum + s.priceCents, 0),
      precoAberto: ctx.svc.some((s) => (s.tipoPreco ?? "fixo") !== "fixo"),
      status: "booked", // precisa de nova confirmação
      rescheduledAt: FieldValue.serverTimestamp(),
    });
    return { ok: true as const };
  }, TX));
}
