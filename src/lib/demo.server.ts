import "server-only";
import { randomBytes } from "node:crypto";
import { getApps } from "firebase-admin/app";
import { FieldValue, Timestamp, type Firestore } from "firebase-admin/firestore";
import { createPlan } from "@/lib/booking.server";
import { addDays, customerKey, todayIn, weekday, zonedTime } from "@/lib/datetime";
import { DEMO, DEMO_EMAIL } from "@/lib/demo";
import { salvarNegocio } from "@/lib/negocios.server";
import type { Service, Staff } from "@/lib/scheduling";

// A conta de demonstração: o vendedor entrega o acesso de dono ao cliente, o cliente
// mexe à vontade, e "Restaurar" devolve tudo a este padrão — com senha nova, para quem
// testou antes não entrar mais. Os agendamentos são montados a partir de hoje.

const NEGOCIO = {
  name: "Barbearia Force",
  sub: "barbearia",
  telefone: "(96) 99999-0000", // número de teste: o botão de WhatsApp não chama ninguém de verdade
  cidade: "Macapá",
  uf: "AP",
  bairro: "Trem",
  endereco: "",
  instagram: "",
  horario: "Seg a sáb, 9h às 19h",
};

const SERVICOS: (Service & { id: string })[] = [
  { id: "corte", name: "Corte masculino", durationMin: 30, priceCents: 3500, tipoPreco: "fixo", active: true },
  { id: "barba", name: "Barba", durationMin: 30, priceCents: 2500, tipoPreco: "fixo", active: true },
  { id: "corte-barba", name: "Corte + barba", durationMin: 60, priceCents: 5500, tipoPreco: "fixo", active: true },
  { id: "infantil", name: "Corte infantil", durationMin: 30, priceCents: 3000, tipoPreco: "aPartir", active: true },
  { id: "sobrancelha", name: "Sobrancelha", durationMin: 15, priceCents: 1500, tipoPreco: "fixo", active: true },
  { id: "pigmentacao", name: "Pigmentação de barba", durationMin: 45, priceCents: 0, tipoPreco: "naoInformado", active: true },
];

const dias = (de: number, ate: number, start: string, end: string) =>
  Object.fromEntries(Array.from({ length: ate - de + 1 }, (_, i) => [String(de + i), { start, end }]));
const EQUIPE: (Staff & { id: string })[] = [
  { id: "paulo", name: "Paulo", serviceIds: ["corte", "barba", "corte-barba", "infantil", "sobrancelha", "pigmentacao"], hours: { ...dias(1, 5, "09:00", "19:00"), "6": { start: "09:00", end: "14:00" } }, active: true },
  { id: "pablo", name: "Pablo", serviceIds: ["corte", "barba", "corte-barba", "pigmentacao"], hours: dias(2, 6, "10:00", "19:00"), active: true },
  { id: "mario", name: "Mário", serviceIds: ["corte", "infantil", "sobrancelha"], hours: dias(1, 5, "09:00", "18:00"), active: true },
];

// Telefones da faixa de teste (96) 99999-01xx; e-mails no example.com, que não entrega nada
type Cliente = { nome: string; fone: string; etiquetas?: string[]; semCampanha?: boolean; nascimento?: string; email?: string };
const CLIENTES: Cliente[] = [
  { nome: "Carlos Almeida", fone: "(96) 99999-0101", etiquetas: ["VIP", "Plano mensal"], nascimento: "1988-03-14", email: "carlos@example.com" },
  { nome: "João Pedro Santos", fone: "(96) 99999-0102", etiquetas: ["Prefere o Pablo"] },
  { nome: "Marcos Oliveira", fone: "(96) 99999-0103", nascimento: "1995-11-02" },
  { nome: "Rafael Souza", fone: "(96) 99999-0104", etiquetas: ["Traz o filho"], email: "rafael@example.com" },
  { nome: "Bruno Costa", fone: "(96) 99999-0105" },
  { nome: "Lucas Ferreira", fone: "(96) 99999-0106", semCampanha: true },
  { nome: "Diego Martins", fone: "(96) 99999-0107", etiquetas: ["Pigmentação"] },
  { nome: "Thiago Ribeiro", fone: "(96) 99999-0108" },
  { nome: "André Lima", fone: "(96) 99999-0109", nascimento: "1979-07-21" },
  { nome: "Felipe Rocha", fone: "(96) 99999-0110" },
];

type Status = "booked" | "confirmed" | "cancelled" | "no_show";
// [cliente, serviços, profissional, dias a partir de hoje, hora, situação]. Dia em que o
// profissional não atende (ou hora ocupada) anda até o próximo encaixe possível.
const AGENDA: [number, string[], string, number, string, Status][] = [
  // quem sumiu: última visita há mais de 60 dias, para o filtro "Sem vir há" ter gente
  [7, ["corte"], "mario", -95, "10:00", "confirmed"],
  [8, ["corte-barba"], "paulo", -78, "15:00", "confirmed"],
  [9, ["barba"], "pablo", -64, "11:00", "confirmed"],
  // o último mês
  [1, ["corte"], "pablo", -28, "10:00", "confirmed"],
  [2, ["corte-barba"], "paulo", -26, "14:00", "confirmed"],
  [3, ["corte", "infantil"], "mario", -24, "09:00", "confirmed"],
  [4, ["barba"], "paulo", -21, "11:00", "no_show"],
  [6, ["pigmentacao"], "pablo", -19, "16:00", "confirmed"],
  [5, ["corte"], "mario", -17, "15:00", "cancelled"],
  [1, ["barba"], "pablo", -14, "10:30", "confirmed"],
  [2, ["corte"], "paulo", -12, "09:30", "confirmed"],
  [4, ["corte-barba"], "paulo", -10, "16:00", "confirmed"],
  [5, ["corte", "sobrancelha"], "mario", -7, "10:00", "confirmed"],
  [3, ["infantil"], "mario", -5, "14:00", "confirmed"],
  [6, ["corte"], "pablo", -3, "17:00", "confirmed"],
  [2, ["barba"], "paulo", -1, "10:00", "confirmed"],
  // os próximos dias
  [1, ["corte"], "pablo", 1, "10:00", "confirmed"],
  [4, ["corte"], "paulo", 1, "11:00", "booked"],
  [3, ["corte-barba"], "paulo", 2, "15:00", "booked"],
  [5, ["barba"], "pablo", 3, "16:00", "confirmed"],
  [6, ["pigmentacao"], "pablo", 4, "11:00", "booked"],
  [2, ["corte", "sobrancelha"], "mario", 5, "09:00", "booked"],
  [3, ["infantil"], "mario", 7, "14:30", "booked"],
];

const minutos = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
const hora = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

/** Monta os agendamentos a partir de hoje: cada um cai num dia em que o profissional
 *  atende, dentro do expediente e sem encavalar com outro dele. */
export function montarAgenda(hoje: string) {
  const ocupado = new Map<string, [number, number][]>();
  return AGENDA.map(([c, servicos, staffId, offset, horaDesejada, status]) => {
    const p = EQUIPE.find((e) => e.id === staffId)!;
    const duracao = servicos.reduce((t, id) => t + SERVICOS.find((s) => s.id === id)!.durationMin, 0);
    // passado anda para trás e futuro para frente: nunca vira o outro
    const passo = offset < 0 ? -1 : 1;
    for (let d = offset; Math.abs(d - offset) < 14; d += passo) {
      const data = addDays(hoje, d);
      const faixa = p.hours[String(weekday(data)) as keyof typeof p.hours];
      if (!faixa) continue;
      const chave = `${staffId}:${data}`;
      const dia = ocupado.get(chave) ?? [];
      for (let ini = Math.max(minutos(horaDesejada), minutos(faixa.start)); ini + duracao <= minutos(faixa.end); ini += 30) {
        if (dia.some(([a, b]) => ini < b && a < ini + duracao)) continue;
        ocupado.set(chave, [...dia, [ini, ini + duracao]]);
        return { cliente: CLIENTES[c], servicos, staffId, data, hora: hora(ini), status, duracao };
      }
    }
    throw new Error(`Sem encaixe para ${CLIENTES[c].nome} em ${addDays(hoje, offset)}`);
  });
}

/** Chama a API de contas do Firebase Auth pelo REST: o firebase-admin/auth não carrega nas
 *  funções da Vercel (ver verify-token.ts). No emulador, o token "owner" basta. */
async function contas(acao: string, corpo: object) {
  const projeto = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const emulador = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const base = emulador ? `http://${emulador}/identitytoolkit.googleapis.com` : "https://identitytoolkit.googleapis.com";
  const token = emulador ? "owner" : (await getApps()[0]!.options.credential!.getAccessToken()).access_token;
  const r = await fetch(`${base}/v1/projects/${projeto}/accounts${acao}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
  const json = (await r.json()) as { localId?: string; users?: { localId: string }[]; error?: { message: string } };
  if (!r.ok) throw new Error(`Firebase Auth ${acao || "create"}: ${json.error?.message ?? r.status}`);
  return json;
}

/** A conta de dono da demonstração, com a senha dada. Sessões anteriores deixam de valer. */
async function donoDaDemo(db: Firestore, senha: string) {
  const achado = (await contas(":lookup", { email: [DEMO_EMAIL] })).users?.[0]?.localId;
  const uid = achado
    ? (await contas(":update", { localId: achado, password: senha, disableUser: false, validSince: String(Math.floor(Date.now() / 1000)) })).localId!
    : (await contas("", { email: DEMO_EMAIL, password: senha, emailVerified: true, displayName: "Dono da demonstração" })).localId!;
  // o token de quem testou antes ainda valeria até uma hora: a marca em config/admin o
  // recusa já (é o mesmo mecanismo de "encerrar sessão" do admin)
  if (achado) await db.doc("config/admin").set({ revogados: { [uid]: Date.now() } }, { merge: true });
  return uid;
}

/** Apaga o que o cliente fez e grava o padrão. Devolve o acesso do dono (senha nova). */
export async function restaurarDemo(db: Firestore, opts: { slug?: string; adminUid: string }) {
  const slug = opts.slug ?? DEMO;
  const t = db.collection("tenants").doc(slug);
  const tenant = await t.get();
  if (!tenant.exists) throw new Error(`Negócio ${slug} não existe.`);

  // dono da demonstração: a mesma conta sempre, senha nova a cada restauração
  const senha = `force-${randomBytes(4).toString("hex")}`;
  const dono = { uid: await donoDaDemo(db, senha) };

  // tudo o que o cliente pode ter criado some; ficam o dono original e o da demonstração
  const manter = new Set([String(tenant.get("ownerId")), dono.uid]);
  for (const col of await t.listCollections()) {
    if (col.id !== "members") {
      await db.recursiveDelete(col);
      continue;
    }
    for (const m of (await col.get()).docs) if (!manter.has(m.id)) await m.ref.delete();
  }
  await t.collection("members").doc(dono.uid).set({ uid: dono.uid, role: "owner", email: DEMO_EMAIL, createdAt: FieldValue.serverTimestamp() });

  // os dados do negócio pelo mesmo caminho do "Meu negócio"; o resto do documento fica
  await salvarNegocio(db, slug, NEGOCIO);
  await t.update({ limiteStaff: FieldValue.delete() });

  const agora = Timestamp.now();
  const escrita = db.bulkWriter();
  SERVICOS.forEach(({ id, ...s }, ordem) => void escrita.set(t.collection("services").doc(id), { ...s, ordem }));
  for (const { id, ...p } of EQUIPE) void escrita.set(t.collection("staff").doc(id), { ...p, createdAt: agora });

  const hoje = todayIn();
  const agenda = montarAgenda(hoje);
  const usos = new Map<string, number>();
  const ultimo = new Map<string, Timestamp>();
  for (const a of agenda) {
    const start = zonedTime(a.data, a.hora);
    // criado uns dias antes do horário (ou agora, para o que já é futuro)
    const criado = Timestamp.fromMillis(Math.min(agora.toMillis(), start.getTime() - 3 * 86_400_000));
    const key = customerKey(a.cliente.fone);
    const svc = a.servicos.map((id) => SERVICOS.find((s) => s.id === id)!);
    const appt = t.collection("appointments").doc();
    const criadoH = t.collection("history").doc();
    let lastHistoryId = criadoH.id;
    void escrita.set(criadoH, { appointmentId: appt.id, type: "created", by: "cliente", byName: a.cliente.nome, at: criado });
    if (a.status !== "booked") {
      const h = t.collection("history").doc();
      lastHistoryId = h.id;
      const quando = Timestamp.fromMillis(Math.min(agora.toMillis(), start.getTime() - 86_400_000));
      void escrita.set(h, { appointmentId: appt.id, type: a.status, by: dono.uid, byName: DEMO_EMAIL, at: a.status === "no_show" ? Timestamp.fromDate(start) : quando });
    }
    void escrita.set(appt, {
      lastHistoryId,
      serviceIds: a.servicos,
      serviceName: svc.map((s) => s.name).join(" + "),
      durationMin: a.duracao,
      priceCents: svc.reduce((t, s) => t + s.priceCents, 0),
      precoAberto: svc.some((s) => s.tipoPreco !== "fixo"),
      staffId: a.staffId,
      staffName: EQUIPE.find((e) => e.id === a.staffId)!.name,
      start: Timestamp.fromDate(start),
      end: Timestamp.fromMillis(start.getTime() + a.duracao * 60_000),
      customerKey: key,
      customerName: a.cliente.nome,
      customerPhone: a.cliente.fone,
      status: a.status,
      createdAt: criado,
    });
    for (const id of a.servicos) usos.set(id, (usos.get(id) ?? 0) + 1);
    if (!ultimo.has(key) || ultimo.get(key)!.toMillis() < criado.toMillis()) ultimo.set(key, criado);
  }
  for (const c of CLIENTES) {
    const key = customerKey(c.fone);
    void escrita.set(t.collection("customers").doc(key), {
      name: c.nome,
      phone: c.fone,
      updatedAt: ultimo.get(key) ?? agora,
      ...(c.etiquetas && { etiquetas: c.etiquetas }),
      ...(c.semCampanha && { semCampanha: true }),
      ...(c.nascimento && { nascimento: c.nascimento }),
      ...(c.email && { email: c.email }),
    });
  }
  for (const [id, n] of usos) void escrita.set(t.collection("services").doc(id), { usos: n }, { merge: true });
  await escrita.close();

  // um plano recorrente de verdade, pela mesma função da tela (pula o que já estiver ocupado)
  const sexta = [...Array(7).keys()].map((i) => addDays(hoje, i + 1)).find((d) => weekday(d) === 5)!;
  const plano = await createPlan(
    db,
    { tenantId: slug, customerName: CLIENTES[0].nome, customerPhone: CLIENTES[0].fone, serviceIds: ["corte"], staffId: "paulo", weekday: 5, time: "18:00", startDate: sexta, weeks: 8 },
    { uid: dono.uid, email: DEMO_EMAIL },
  );
  if (!plano.ok) throw new Error(`Plano da demonstração: ${plano.error}`);

  const acesso = { email: DEMO_EMAIL, senha, restauradoEm: FieldValue.serverTimestamp(), por: opts.adminUid };
  // config/ não tem regra que abra para o navegador: só o servidor lê a senha
  await db.doc("config/demo").set(acesso);
  return { email: DEMO_EMAIL, senha, agendamentos: agenda.length };
}

/** O acesso de dono em vigor, para o vendedor passar ao cliente. */
export async function acessoDemo(db: Firestore) {
  const d = await db.doc("config/demo").get();
  if (!d.exists) return null;
  return { email: String(d.get("email")), senha: String(d.get("senha")), restauradoEm: (d.get("restauradoEm") as Timestamp | undefined)?.toDate().toISOString() ?? null };
}
