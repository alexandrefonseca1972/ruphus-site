import "server-only";
import { createHash } from "node:crypto";
import { FieldValue, Timestamp, type DocumentSnapshot, type Firestore, type QueryDocumentSnapshot } from "firebase-admin/firestore";
import { agendaDias, deviceId, type DiaDaAgenda } from "@/lib/booking.server";
import { customerKey, dateIn, formatLongDate, formatTime, fusoDe, todayIn, zonedTime } from "@/lib/datetime";
import { esperaLigada, type Modulos } from "@/lib/modulos";
import {
  compativel,
  EntradaEspera,
  MAX_AVISOS_POR_VAGA,
  MAX_ESPERAS_ATIVAS_POR_TELEFONE,
  ordenar,
  paraMin,
  podeAvisar,
  prazoDoAviso,
  venceEm,
  type Espera,
  type TipoEspera,
} from "@/lib/fila-espera";
import { optInDaEspera, TERMO_ESPERA_VERSAO } from "@/lib/consentimento-whatsapp";
import { chaveDeEnvio, enviarTemplateSemOperador, saiuDepoisDoAceite, type OptIn, type Template } from "@/lib/atendys";
import { conexaoOficial, esperaNoWhatsApp, templateEspera } from "@/lib/canal-oficial.server";
import { SemSaldo } from "@/lib/consumo.server";
import { alertarAdmin } from "@/lib/alerta-admin.server";
import { avisar } from "@/lib/avisos.server";
import { DEMO } from "@/lib/demo";

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

// ---------------------------------------------------------------------------------------------
// Motor (F4): quando um horário fica livre, avisa por WhatsApp a espera certa. Quem não responde no
// prazo libera a vaga para a próxima. Roda pelo cron a cada minuto (/api/cron/fila-espera).

/** Envio do aviso. Nos testes é injetado; em produção sai pelo canal oficial do negócio. */
export type Enviar = (args: { slug: string; telefone: string; template: Template; optIn: OptIn; prazo: Date; chave: string }) => Promise<{ destino?: string } | void>;

const MAX_TENTATIVAS_PENDENTE = 5; // ponytail: 5 retentativas (uma por minuto); depois a pendência fica parada e o admin é avisado
const LOTE_EVENTOS = 200; // ponytail: 200 eventos por execução; mais de 200 no mesmo instante travam o cursor
const SEMANA_MS = 7 * 24 * 3_600_000;
const BRASILIA = "America/Sao_Paulo";
let desligadoAvisado = false;

/** Template da espera desligado: o motor anda (cursor, expiração) mas não manda nada. Loga uma vez. */
function ligado(): boolean {
  const on = esperaNoWhatsApp();
  if (!on && !desligadoAvisado) {
    desligadoAvisado = true;
    console.log("[fila] template desligado");
  }
  return on;
}

/** Canal oficial do negócio. Sem canal, não sai nada: destino "sem-canal" (a espera volta a aguardando). */
const enviarReal =
  (db: Firestore): Enviar =>
  async ({ slug, telefone, template, optIn, prazo, chave }) => {
    const conexao = await conexaoOficial(db, slug);
    if (!conexao) return { destino: "sem-canal" };
    return enviarTemplateSemOperador(conexao, telefone, template, optIn, prazo, { chave });
  };

type Servico = { name: string; durationMin: number };
/** ativo: a fila vale para o negócio (módulo ligado e não é a DEMO). Inativo ainda tem o fuso, para expirar. */
type Negocio = { id: string; nome: string; fuso: string; ativo: boolean; servicos: Map<string, Servico> };
/** Uma vaga: o horário que ficou livre, [inicio, ateMin) no dia. exato: só o início já oferecido (reoferta). */
type Vaga = { data: string; inicio: string; ateMin: number; staffId: string; eventoId: string; tentativa: number; exato: boolean };
export type AvisoAtual = { data: string; inicio: string; ateMin: number; staffId: string; eventoId: string; tentativa: number; prazo: number };
type Resultado = "avisada" | "pulou" | "saiu" | "nao-sai" | "ofertada" | "sem-saldo" | "sem-canal" | "falhou";
/** Uma execução do cron: relógio, envio e o que já foi lido (negócio por slug, grade por serviço/equipe/dia). */
type Execucao = { db: Firestore; enviar: Enviar; agora: Date; negocios: Map<string, Promise<Negocio | null>>; grades: Map<string, Promise<DiaDaAgenda | null>> };

const execucao = (db: Firestore, opts: { agora?: Date; enviar?: Enviar }): Execucao => ({
  db,
  enviar: opts.enviar ?? enviarReal(db),
  agora: opts.agora ?? new Date(),
  negocios: new Map(),
  grades: new Map(),
});

/** O negócio (null se não existe). Lido uma vez por execução. */
function lerNegocio(x: Execucao, slug: string): Promise<Negocio | null> {
  let p = x.negocios.get(slug);
  if (!p) {
    p = (async () => {
      const t = await x.db.doc(`tenants/${slug}`).get();
      if (!t.exists) return null;
      const ativo = slug !== DEMO && esperaLigada(t.get("modulos"));
      const servicos = ativo ? (await x.db.collection(`tenants/${slug}/services`).get()).docs : [];
      return {
        id: slug,
        nome: String(t.get("name") ?? "seu negócio"),
        fuso: fusoDe(t.get("site")),
        ativo,
        servicos: new Map<string, Servico>(servicos.map((d): [string, Servico] => [d.id, { name: String(d.get("name") ?? ""), durationMin: Number(d.get("durationMin") ?? 0) }])),
      };
    })();
    x.negocios.set(slug, p);
  }
  return p;
}

/** Inícios livres do dia para os serviços e a equipe: a mesma conta da página pública. Uma vez por execução. */
function gradeDo(x: Execucao, t: Negocio, serviceIds: string[], staffId: string, data: string): Promise<DiaDaAgenda | null> {
  const chave = [t.id, [...serviceIds].sort().join(","), staffId, data].join("|");
  let p = x.grades.get(chave);
  if (!p) {
    p = agendaDias(x.db, { tenantId: t.id, serviceIds, staffId, from: data }, [data]).then(([dia]) => (dia?.date === data ? dia : null));
    x.grades.set(chave, p);
  }
  return p;
}

/** O início que serve a esta espera, dentro da vaga [inicio, ateMin): a troca só o preferido exato; a espera,
 *  o mais perto do preferido. Na reoferta, só o início já oferecido. */
function horarioPara(e: Espera, dia: DiaDaAgenda, duracaoMin: number, t: Negocio, agora: Date, vaga: Vaga) {
  const alvo = paraMin(e.preferido);
  const dentro = dia.horarios.filter((h) => {
    const m = paraMin(h.hora);
    return m >= paraMin(vaga.inicio) && m < vaga.ateMin && (!vaga.exato || h.hora === vaga.inicio) && (!vaga.staffId || h.staffId === vaga.staffId);
  });
  const opcoes = e.tipo === "troca" ? dentro.filter((h) => h.hora === e.preferido) : dentro.sort((a, b) => Math.abs(paraMin(a.hora) - alvo) - Math.abs(paraMin(b.hora) - alvo));
  // "hoje" e a hora do fuso do negócio, pela data injetada (o teste anda no tempo que quiser)
  const ctx = { duracaoMin, hoje: dateIn(agora, t.fuso), agoraMin: paraMin(formatTime(agora, t.fuso)) };
  // ponytail: livreAteMin = início + duração; agendaDias já garante que o serviço cabe na folga
  return opcoes.find((h) => compativel(e, { data: dia.date, inicio: h.hora, staffId: h.staffId, livreAteMin: paraMin(h.hora) + duracaoMin }, ctx)) ?? null;
}

/** A espera ainda está no aviso desta vaga? Toda mudança de estado do motor confere isto antes. */
const doAviso = (snap: DocumentSnapshot, aviso: { eventoId: string; tentativa: number }) =>
  snap.get("status") === "avisada" && snap.get("avisoAtual.eventoId") === aviso.eventoId && snap.get("avisoAtual.tentativa") === aviso.tentativa;

/** Anota a vaga para a retentativa (id: evento-tentativa). Na 5ª falha avisa o admin e para. */
async function anotarPendente(x: Execucao, slug: string, p: Partial<Vaga> & { eventoId: string; tentativa: number; evento?: string }) {
  const ref = x.db.doc(`tenants/${slug}/esperaPendentes/${p.eventoId}-${p.tentativa}`);
  const tentativas = (((await ref.get()).get("tentativas") as number | undefined) ?? 0) + 1;
  await ref.set({ ...p, tentativas, em: x.agora.getTime() }, { merge: true });
  if (tentativas >= MAX_TENTATIVAS_PENDENTE) {
    await alertarAdmin(x.db, `espera-pendente-${slug}`, "Aviso da fila de espera parado", `Uma vaga de ${slug} falhou ${tentativas} vezes e não será mais oferecida (${ref.path}). Veja o log [fila] na VPS.`);
  }
}

/** Reserva o aviso numa transação (espera avisada, marca da espera, marca da vaga, registro do telefone) e
 *  envia. Se o envio não sai, desfaz a reserva só se a espera ainda está neste aviso. */
async function notificar(x: Execucao, t: Negocio, e: Espera, vaga: Vaga, h: { hora: string; staffId: string }): Promise<Resultado> {
  const { db, agora } = x;
  const ref = db.doc(`tenants/${t.id}/espera/${e.id}`);
  // marca da espera: nunca avisar duas vezes a mesma espera pelo mesmo evento
  const marca = ref.collection("envios").doc(vaga.eventoId);
  // marca da vaga: uma oferta por evento e tentativa; reprocessar o evento não avisa ninguém de novo
  const ofertada = db.doc(`tenants/${t.id}/esperaVagas/${vaga.eventoId}-${vaga.tentativa}`);
  // avisos por telefone, em todos os negócios e esperas (inclusive as que já saíram)
  const fone = db.doc(`esperaFones/${e.customerKey}`);
  const em = agora.getTime();
  const aviso = { inicio: h.hora, staffId: h.staffId, em };
  const reserva = await db.runTransaction(async (tx) => {
    const [atual, ja, vagaJa, f] = await Promise.all([tx.get(ref), tx.get(marca), tx.get(ofertada), tx.get(fone)]);
    if (vagaJa.exists) return "ofertada" as const;
    const quando = (atual.get("consentimento.em") as Timestamp | undefined)?.toDate?.();
    if (!atual.exists || atual.get("status") !== "aguardando" || ja.exists || !quando) return "pulou" as const;
    const avisos = ((f.get("avisos") as number[] | undefined) ?? []).filter((a) => em - a < SEMANA_MS);
    if (!podeAvisar(avisos, em)) return "pulou" as const;
    const avisoAtual: AvisoAtual = { data: vaga.data, inicio: h.hora, ateMin: vaga.ateMin, staffId: h.staffId, prazo: prazoDoAviso(em), eventoId: vaga.eventoId, tentativa: vaga.tentativa };
    tx.update(ref, { status: "avisada", avisos: FieldValue.arrayUnion(aviso), avisoAtual });
    tx.create(marca, { em, tentativa: vaga.tentativa });
    tx.create(ofertada, { esperaId: e.id, em });
    tx.set(fone, { avisos: [...avisos, em] });
    return quando;
  });
  if (typeof reserva === "string") return reserva;

  /** Desfaz a reserva (nada saiu): libera a vaga e o limite do telefone. "aguardando" também apaga a marca da
   *  espera (a retentativa a avisa de novo); "nao-sai" e "saiu" a mantêm (a espera não recebe esta vaga). */
  const desfazer = (fim: "aguardando" | "nao-sai" | "saiu") =>
    db.runTransaction(async (tx) => {
      const [atual, f] = await Promise.all([tx.get(ref), tx.get(fone)]);
      if (!doAviso(atual, vaga)) return;
      const avisos = (f.get("avisos") as number[] | undefined) ?? [];
      const i = avisos.lastIndexOf(em);
      tx.update(ref, {
        status: fim === "saiu" ? "saiu" : "aguardando",
        avisoAtual: FieldValue.delete(),
        avisos: FieldValue.arrayRemove(aviso),
        ...(fim === "saiu" && { saiuEm: em }),
      });
      tx.delete(ofertada);
      if (fim === "aguardando") tx.delete(marca);
      if (i >= 0) tx.set(fone, { avisos: avisos.filter((_, j) => j !== i) });
    });
  try {
    const agendamento = e.tipo === "troca" && e.agendamentoId ? await db.doc(`tenants/${t.id}/appointments/${e.agendamentoId}`).get() : null;
    const horaAtual = agendamento?.exists ? formatTime((agendamento.get("start") as Timestamp).toDate()) : undefined;
    const quando = `${formatLongDate(zonedTime(vaga.data, h.hora))} às ${h.hora}`;
    const servico = e.serviceIds.map((id) => t.servicos.get(id)?.name).filter(Boolean).join(" + ");
    const envio = await x.enviar({
      slug: t.id,
      telefone: e.telefone,
      template: templateEspera(
        e.tipo,
        { nome: e.nome.trim().split(/\s+/)[0] ?? "", negocio: t.nome, servico, quando, ...(horaAtual ? { atual: horaAtual } : {}) },
        { slug: t.id, espera: e.id, horario: `${vaga.data}T${h.hora}` },
      ),
      optIn: optInDaEspera({ tenantId: t.id, esperaId: e.id, em: reserva }),
      prazo: new Date(prazoDoAviso(em)),
      chave: chaveDeEnvio("espera", t.id, e.id, `${vaga.data}T${h.hora}`, vaga.eventoId),
    });
    const destino = (envio as { destino?: string } | undefined)?.destino;
    if (destino === "sem-canal") {
      await desfazer("aguardando");
      return "sem-canal";
    }
    // o atendys não vai entregar a este número (opt-out, número inválido): passa para a próxima espera
    if (destino === "nao_sai") {
      await desfazer("nao-sai");
      return "nao-sai";
    }
    if (destino === "falhou") throw new Error(`aviso da espera ${e.id}: ${destino}`);
    // o negócio vê que o aviso saiu (a cliente já recebeu o WhatsApp)
    avisar(db, t.id, { title: "Fila de espera", body: `Avisamos ${e.nome.trim().split(/\s+/)[0] ?? ""} do horário ${quando}.`, url: `/${t.id}`, tag: `espera-vaga-${vaga.eventoId}` }, { soGestores: true })
      .catch((erro) => console.error(`[fila] aviso ao negócio ${t.id}`, erro));
    return "avisada";
  } catch (erro) {
    // o cliente pediu SAIR antes deste aviso: não é falha, e a espera fica fora da fila
    if (saiuDepoisDoAceite(erro)) {
      await desfazer("saiu");
      return "saiu";
    }
    await desfazer("aguardando");
    if (erro instanceof SemSaldo) {
      await alertarAdmin(db, `espera-saldo-${t.id}`, "Aviso da fila de espera não saiu: sem saldo", `${t.nome} está sem saldo de mensagens: o aviso de ${e.nome} não saiu. Recarregue o saldo no painel.`);
      return "sem-saldo";
    }
    console.error(`[fila] aviso ${t.id}/${e.id} não saiu`, erro);
    await anotarPendente(x, t.id, vaga);
    return "falhou";
  }
}

/** Oferece a vaga à primeira espera que serve. Uma vaga, uma espera por vez; vaga já ofertada para tudo. */
async function ofertar(x: Execucao, t: Negocio, vaga: Vaga): Promise<Resultado | "vazio"> {
  const fila = await x.db.collection(`tenants/${t.id}/espera`).where("data", "==", vaga.data).where("status", "==", "aguardando").get();
  const candidatas = ordenar(fila.docs.map((d) => ({ ...d.data(), id: d.id }) as Espera), vaga.inicio);
  for (const e of candidatas) {
    const servicos = e.serviceIds.map((id) => t.servicos.get(id));
    if (servicos.some((s) => !s)) continue; // serviço apagado do catálogo: não há como garantir o horário
    if (e.staffId && vaga.staffId && e.staffId !== vaga.staffId) continue; // vagou com outra pessoa da equipe
    // a troca remarca com o profissional do agendamento: vaga de outra pessoa da equipe não serve
    if (e.tipo === "troca" && String((await x.db.doc(`tenants/${t.id}/appointments/${e.agendamentoId ?? "sem-agendamento"}`).get()).get("staffId") ?? "") !== vaga.staffId) continue;
    if ((await x.db.doc(`tenants/${t.id}/espera/${e.id}/envios/${vaga.eventoId}`).get()).exists) continue; // já avisada por este evento
    const duracaoMin = servicos.reduce((soma, s) => soma + s!.durationMin, 0);
    // a grade de quem vagou: "qualquer profissional" vê a agenda de quem liberou o horário
    const dia = await gradeDo(x, t, e.serviceIds, e.staffId ?? vaga.staffId, vaga.data);
    const h = dia && horarioPara(e, dia, duracaoMin, t, x.agora, vaga);
    if (!h) continue;
    const r = await notificar(x, t, e, vaga, h);
    if (r !== "saiu" && r !== "pulou" && r !== "nao-sai") return r;
  }
  return "vazio";
}

/** A vaga de um cancelamento ou de uma remarcação (o horário de antes, from), de início a fim. */
async function vagaDoEvento(x: Execucao, t: Negocio, ev: DocumentSnapshot): Promise<Vaga | null> {
  const ag = await x.db.doc(`tenants/${t.id}/appointments/${ev.get("appointmentId")}`).get();
  const de = (ev.get("type") === "rescheduled" ? ev.get("from") : { start: ag.get("start"), end: ag.get("end") }) as { start?: Timestamp; end?: Timestamp } | undefined;
  if (!ag.exists || !de?.start) return null;
  const inicio = de.start.toDate();
  const fim = de.end?.toDate() ?? new Date(inicio.getTime() + Number(ag.get("durationMin") ?? 0) * 60_000);
  const data = dateIn(inicio);
  return {
    data,
    inicio: formatTime(inicio),
    ateMin: dateIn(fim) === data ? paraMin(formatTime(fim)) : 24 * 60,
    staffId: String(ag.get("staffId") ?? ""),
    eventoId: ev.id,
    tentativa: 1,
    exato: false,
  };
}

/** Pendências (falha de envio que não é saldo, erro no evento): oferece a vaga de novo. A grade de cada
 *  espera é conferida de novo; vaga ocupada no meio tempo não acha ninguém. */
async function reenviarPendentes(x: Execucao): Promise<number> {
  const pendentes = await x.db.collectionGroup("esperaPendentes").where("tentativas", "<", MAX_TENTATIVAS_PENDENTE).get();
  let avisos = 0;
  for (const p of pendentes.docs) {
    const slug = p.ref.parent.parent!.id;
    try {
      const t = await lerNegocio(x, slug);
      const { data, inicio, ateMin, staffId, eventoId, tentativa, exato, evento } = p.data();
      const vaga: Vaga | null = !t?.ativo ? null : data ? { data, inicio, ateMin, staffId, eventoId, tentativa, exato: !!exato } : await vagaDoEvento(x, t, await x.db.doc(evento).get());
      const r = vaga && t ? await ofertar(x, t, vaga) : "vazio";
      if (r === "avisada") avisos++;
      // "falhou" já somou a tentativa (notificar); o resto acabou de vez
      if (r !== "falhou") await p.ref.delete();
    } catch (erro) {
      console.error(`[fila] retentativa ${p.ref.path}`, erro);
      await anotarPendente(x, slug, { eventoId: p.get("eventoId"), tentativa: p.get("tentativa") }).catch((e) => console.error(`[fila] pendência ${p.ref.path}`, e));
    }
  }
  return avisos;
}

/** Libera as vagas dos cancelamentos e remarcações novos. Cursor em config/cron: esperaCursor (instante do
 *  último evento) e esperaCursorIds (os já feitos naquele instante, que pode se repetir). Cada evento avisa,
 *  no máximo, uma espera. Com o template desligado só anda o cursor. */
export async function processarLiberacoes(db: Firestore, opts: { agora?: Date; enviar?: Enviar } = {}): Promise<{ eventos: number; avisos: number }> {
  const x = execucao(db, opts);
  const com = ligado();
  const cron = db.doc("config/cron");
  const c = await cron.get();
  // primeira execução: começa 10 min atrás, para não avisar de uma vez tudo o que já passou
  const cursor = (c.get("esperaCursor") as Timestamp | undefined) ?? Timestamp.fromMillis(x.agora.getTime() - 10 * 60_000);
  const feitosAntes = (c.get("esperaCursorIds") as string[] | undefined) ?? [];
  const lote = await db.collectionGroup("history").where("type", "in", ["cancelled", "rescheduled"]).where("at", ">=", cursor).orderBy("at").limit(LOTE_EVENTOS).get();
  const novos = lote.docs.filter((ev) => !((ev.get("at") as Timestamp).isEqual(cursor) && feitosAntes.includes(ev.id)));
  let avisos = com ? await reenviarPendentes(x) : 0;
  const feitos: QueryDocumentSnapshot[] = [];
  for (const ev of novos) {
    if (com) {
      const slug = ev.ref.parent.parent!.id;
      let vaga: Vaga | null = null;
      try {
        const t = await lerNegocio(x, slug);
        vaga = t?.ativo ? await vagaDoEvento(x, t, ev) : null;
        if (t && vaga && (await ofertar(x, t, vaga)) === "avisada") avisos++;
      } catch (erro) {
        console.error(`[fila] liberação ${ev.ref.path}`, erro);
        // o evento não se perde: vira pendência; se nem isso grava, o cursor para antes dele
        const anotou = await anotarPendente(x, slug, { evento: ev.ref.path, eventoId: ev.id, tentativa: 1, ...vaga }).then(
          () => true,
          (e) => (console.error(`[fila] pendência ${ev.ref.path}`, e), false),
        );
        if (!anotou) break;
      }
    }
    feitos.push(ev);
  }
  // com o template desligado o cursor também anda, para a ligação não mandar o passado
  const ultimo = feitos.at(-1)?.get("at") as Timestamp | undefined;
  if (ultimo) {
    const mesmos = feitos.filter((ev) => (ev.get("at") as Timestamp).isEqual(ultimo)).map((ev) => ev.id);
    await cron.set({ esperaCursor: ultimo, esperaCursorIds: ultimo.isEqual(cursor) ? [...feitosAntes, ...mesmos] : mesmos }, { merge: true });
  }
  return { eventos: feitos.length, avisos };
}

/** A vaga de um aviso que acabou sem reserva, para a próxima espera: o mesmo início, a tentativa seguinte. */
const vagaDaReoferta = (a: AvisoAtual): Vaga => ({ data: a.data, inicio: a.inicio, ateMin: a.ateMin, staffId: a.staffId, eventoId: a.eventoId, tentativa: a.tentativa + 1, exato: true });

/** A espera largou o aviso antes do prazo (botão do WhatsApp): a vaga vai já à próxima espera, com a mesma
 *  marca e o mesmo teto de avisos por vaga do expirarAvisos. Quem chama já tirou a espera do aviso. */
export async function reofertar(db: Firestore, slug: string, aviso: AvisoAtual, opts: { agora?: Date; enviar?: Enviar } = {}): Promise<Resultado | "vazio" | "parou"> {
  if (!ligado() || aviso.tentativa >= MAX_AVISOS_POR_VAGA) return "parou";
  const x = execucao(db, opts);
  const t = await lerNegocio(x, slug);
  return t?.ativo ? ofertar(x, t, vagaDaReoferta(aviso)) : "parou";
}

/** Avisos sem resposta no prazo voltam a aguardando e a vaga vai à próxima espera (no mesmo início); esperas
 *  cujo dia (ou a hora da troca) já passou expiram, com o módulo ligado ou não. */
export async function expirarAvisos(db: Firestore, opts: { agora?: Date; enviar?: Enviar } = {}): Promise<{ expiradas: number; avisos: number }> {
  const x = execucao(db, opts);
  const { agora } = x;
  const com = ligado();
  let expiradas = 0;
  let avisos = 0;
  const avisadas = await db.collectionGroup("espera").where("status", "==", "avisada").get();
  for (const d of avisadas.docs) {
    try {
      const aviso = d.get("avisoAtual") as AvisoAtual | undefined;
      if (!aviso || aviso.prazo >= agora.getTime()) continue;
      const t = await lerNegocio(x, d.ref.parent.parent!.id);
      // fila desligada (ou negócio apagado) com aviso vencido: a espera acaba aqui
      const fim = t?.ativo ? { status: "aguardando" } : { status: "expirada", expiradaEm: agora.getTime() };
      const mudou = await db.runTransaction(async (tx) => {
        if (!doAviso(await tx.get(d.ref), aviso)) return false;
        tx.update(d.ref, { ...fim, avisoAtual: FieldValue.delete() });
        return true;
      });
      if (mudou && !t?.ativo) expiradas++;
      if (!mudou || !t?.ativo || !com || aviso.tentativa >= MAX_AVISOS_POR_VAGA) continue;
      const r = await ofertar(x, t, vagaDaReoferta(aviso));
      if (r === "avisada") avisos++;
    } catch (erro) {
      console.error(`[fila] expirar aviso ${d.ref.path}`, erro);
    }
  }
  // dia já passou (ou a hora da troca): a espera sai da fila. A consulta usa o dia de Noronha (o mais
  // adiantado do país, UTC−2): superconjunto; cada espera confere no fuso do negócio (sem negócio, Brasília)
  const vencidas = await db.collectionGroup("espera").where("status", "==", "aguardando").where("data", "<=", dateIn(agora, "America/Noronha")).get();
  for (const d of vencidas.docs) {
    try {
      const t = await lerNegocio(x, d.ref.parent.parent!.id);
      const fuso = t?.fuso ?? BRASILIA;
      const v = venceEm({ ...d.data(), id: d.id } as Espera);
      const hoje = dateIn(agora, fuso);
      if (v.data < hoje || (v.data === hoje && v.ateMin <= paraMin(formatTime(agora, fuso)))) {
        await d.ref.update({ status: "expirada", expiradaEm: agora.getTime() });
        expiradas++;
      }
    } catch (erro) {
      console.error(`[fila] expirar espera ${d.ref.path}`, erro);
    }
  }
  return { expiradas, avisos };
}
