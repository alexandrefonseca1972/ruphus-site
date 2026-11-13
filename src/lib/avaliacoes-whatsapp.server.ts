import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { adminDb } from "@/lib/admin";
import { emParalelo } from "@/lib/paralelo";
import { formatTime, fusoDe } from "@/lib/datetime";
import { DEMO } from "@/lib/demo";
import { SITE_BASE, urlDoSite, type Dominio } from "@/lib/dominio";
import { optInAvaliacaoDoDoc } from "@/lib/consentimento-whatsapp";
import { chaveDeEnvio, enviarTemplateSemOperador, motivoLegivel, saiuDepoisDoAceite, type ConexaoAtendys } from "@/lib/atendys";
import { conexaoOficial, templateAvaliacao } from "@/lib/canal-oficial.server";
import { SemSaldo } from "@/lib/consumo.server";
import { soDigitosComDDI } from "@/lib/telefone";
import { registrarErroNotificacao } from "@/lib/whatsapp.server";
import { alertarAdmin } from "@/lib/alerta-admin.server";
import { hashTokenAvaliacao, refAvaliacao, tokenAvaliacao } from "@/lib/avaliacoes.server";

const DIA = 24 * 60 * 60_000;
const SILENCIO = { inicioMin: 22 * 60, fimMin: 8 * 60 };

type Dependencias = {
  conexao: (db: Firestore, slug: string) => Promise<ConexaoAtendys | null>;
  enviar: typeof enviarTemplateSemOperador;
};

const valorMs = (v: unknown): number | null => {
  if (v instanceof Date) return v.getTime();
  const data = v as { toMillis?: () => number } | undefined;
  return typeof data?.toMillis === "function" ? data.toMillis() : null;
};

export async function enviarAvaliacoesDoDia(db: Firestore = adminDb, agora = new Date(), deps: Dependencias = { conexao: conexaoOficial, enviar: enviarTemplateSemOperador }): Promise<number> {
  const tenants = await db.collection("tenants").where("avaliacoes.enabled", "==", true).get();
  let enviados = 0;
  await emParalelo(tenants.docs, 5, async (t) => {
    if (t.id === DEMO || t.get("modulos.agendamento") === false || t.get("whatsapp.canalOficial") !== true) return;
    const tz = fusoDe(t.get("site"));
    const [h, m] = formatTime(agora, tz).split(":").map(Number);
    const minutosDoDia = h * 60 + m;
    if (minutosDoDia >= SILENCIO.inicioMin || minutosDoDia < SILENCIO.fimMin) return;
    const enabledAt = valorMs(t.get("avaliacoes.enabledAt"));
    const delayMin = Number(t.get("avaliacoes.delayMin")) || 30;
    if (enabledAt === null) return;

    const limite = new Date(agora.getTime() - delayMin * 60_000);
    const concluidos = await t.ref.collection("appointments")
      .where("completedAt", ">=", new Date(enabledAt))
      .where("completedAt", "<=", limite)
      .limit(100)
      .get();
    for (const a of concluidos.docs) {
      if (a.get("status") !== "confirmed" || a.get("reviewRequestCreatedAt")) continue;
      await criarSolicitacao(db, t.id, a.id, agora);
    }

    const pendentes = await t.ref.collection("avaliacoes").where("proximaTentativaEm", "<=", agora).limit(100).get();
    const devidas = pendentes.docs.filter((r) => ["pendente", "falhou"].includes(r.get("status")));
    if (!devidas.length) return;
    let oficial: ConexaoAtendys | null;
    try {
      oficial = await deps.conexao(db, t.id);
    } catch (e) {
      await falhou(db, t.id, `O canal oficial para avaliações está indisponível: ${motivoLegivel(e)}.`);
      return;
    }
    if (!oficial) return;

    for (const review of devidas) {
      const reservado = await reservarEnvio(db, t.id, review.id, agora);
      if (!reservado) continue;
      const a = await t.ref.collection("appointments").doc(review.id).get();
      const cliente = soDigitosComDDI(String(a.get("customerPhone") ?? ""));
      const optIn = optInAvaliacaoDoDoc(t.id, a);
      if (!a.exists || a.get("status") !== "confirmed" || !a.get("completedAt") || !cliente || !optIn) {
        await review.ref.update({ status: "ignorada", ultimoErro: "Sem conclusão, telefone ou consentimento atualizado.", enviandoEm: FieldValue.delete(), proximaTentativaEm: FieldValue.delete() });
        continue;
      }
      const link = `${SITE_BASE}/avaliar/${encodeURIComponent(t.id)}/${encodeURIComponent(review.id)}?t=${tokenAvaliacao(t.id, review.id)}`;
      try {
        const e = await deps.enviar(oficial, cliente, templateAvaliacao({
          nome: String(review.get("customerName") ?? "").trim().split(/\s+/)[0] || "",
          negocio: String(review.get("businessName") ?? t.get("name") ?? ""),
          servico: String(review.get("serviceName") ?? ""),
          profissional: String(review.get("staffName") ?? ""),
          link,
        }), optIn, undefined, { chave: chaveDeEnvio("avaliacao", t.id, review.id) });
        if (e.messageId) await review.ref.update({ messageId: e.messageId });
        if (e.destino === "falhou") throw new Error(e.errorCode ?? "O envio foi recusado depois do aceite.");
        if (e.destino === "enviada" || e.destino === "agendada") {
          await review.ref.update({ status: "enviada", enviadaEm: FieldValue.serverTimestamp(), enviandoEm: FieldValue.delete(), proximaTentativaEm: FieldValue.delete(), ultimoErro: FieldValue.delete() });
          enviados += 1;
        } else {
          await review.ref.update({ enviandoEm: FieldValue.delete(), proximaTentativaEm: new Date(agora.getTime() + 60 * 60_000) });
        }
      } catch (e) {
        if (saiuDepoisDoAceite(e)) {
          await review.ref.update({ status: "ignorada", ultimoErro: "O cliente pediu para não receber mais mensagens.", enviandoEm: FieldValue.delete(), proximaTentativaEm: FieldValue.delete() });
          continue;
        }
        const tentativas = Number(review.get("tentativas") ?? 0) + 1;
        const esgotou = tentativas >= 5 && !(e instanceof SemSaldo);
        await review.ref.update({
          status: esgotou ? "falhou" : "pendente",
          tentativas,
          ultimoErro: motivoLegivel(e),
          enviandoEm: FieldValue.delete(),
          proximaTentativaEm: esgotou ? FieldValue.delete() : new Date(agora.getTime() + Math.min(6 * 60 * 60_000, 10 * 60_000 * 2 ** Math.min(tentativas - 1, 5))),
        });
        if (esgotou) await falhou(db, t.id, `O pedido de avaliação de ${String(review.get("customerName") ?? "um cliente")} não saiu após 5 tentativas: ${motivoLegivel(e)}.`);
      }
    }
  });
  return enviados;
}

async function criarSolicitacao(db: Firestore, tenantId: string, appointmentId: string, agora: Date) {
  const appointment = db.doc(`tenants/${tenantId}/appointments/${appointmentId}`);
  const review = refAvaliacao(db, tenantId, appointmentId);
  const tenant = db.doc(`tenants/${tenantId}`);
  await db.runTransaction(async (tx) => {
    const [a, r, t] = await Promise.all([tx.get(appointment), tx.get(review), tx.get(tenant)]);
    if (!a.exists || a.get("status") !== "confirmed" || a.get("reviewRequestCreatedAt")) return;
    if (t.get("avaliacoes.enabled") !== true || t.id === DEMO || t.get("modulos.agendamento") === false) return;
    const completedAt = valorMs(a.get("completedAt"));
    const enabledAt = valorMs(t.get("avaliacoes.enabledAt"));
    const delayMin = Number(t.get("avaliacoes.delayMin")) || 30;
    if (completedAt === null || enabledAt === null || completedAt < enabledAt || completedAt + delayMin * 60_000 > agora.getTime()) return;
    if (!r.exists) {
      tx.create(review, {
        status: "pendente",
        tokenHash: hashTokenAvaliacao(tokenAvaliacao(tenantId, appointmentId)),
        criadaEm: FieldValue.serverTimestamp(),
        expiraEm: new Date(agora.getTime() + 7 * DIA),
        tentativas: 0,
        proximaTentativaEm: agora,
        appointmentId,
        customerKey: a.get("customerKey") ?? null,
        customerName: String(a.get("customerName") ?? ""),
        serviceIds: Array.isArray(a.get("serviceIds")) ? a.get("serviceIds") : [],
        serviceName: String(a.get("serviceName") ?? ""),
        staffId: String(a.get("staffId") ?? ""),
        staffName: String(a.get("staffName") ?? ""),
        businessName: String(t.get("name") ?? tenantId),
        siteUrl: urlDoSite(tenantId, t.get("dominio") as Dominio | undefined),
      });
    }
    tx.update(appointment, { reviewRequestCreatedAt: FieldValue.serverTimestamp() });
  });
}

async function reservarEnvio(db: Firestore, tenantId: string, appointmentId: string, agora: Date) {
  const ref = refAvaliacao(db, tenantId, appointmentId);
  return db.runTransaction(async (tx) => {
    const r = await tx.get(ref);
    if (!r.exists || !["pendente", "falhou"].includes(r.get("status"))) return false;
    const proxima = valorMs(r.get("proximaTentativaEm"));
    if (proxima !== null && proxima > agora.getTime()) return false;
    const enviando = valorMs(r.get("enviandoEm"));
    if (enviando !== null && enviando + 2 * 60_000 > agora.getTime()) return false;
    tx.update(ref, { enviandoEm: agora });
    return true;
  });
}

async function falhou(db: Firestore, slug: string, mensagem: string) {
  await registrarErroNotificacao(db, slug, { message: mensagem, at: Date.now() }).catch(() => {});
  await alertarAdmin(db, `whatsapp-avaliacao-${slug}`, `Pedido de avaliação falhou em ${slug}`, {
    resumo: mensagem,
    blocos: [{ dados: [["Negócio", slug]] }, { p: "O cron tenta novamente com a mesma chave de envio; após 5 tentativas, confira o canal oficial e o saldo do negócio." }],
  }).catch(() => {});
}
