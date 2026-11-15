import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { UserError } from "@/lib/booking.server";
import { agendamentoLigado, esperaLigada } from "@/lib/modulos";
import { alertarAdmin } from "@/lib/alerta-admin.server";
import { SITE_BASE } from "@/lib/dominio";
import { esperaNoWhatsApp } from "@/lib/canal-oficial.server";

// Fila de espera: o dono pede e a Ruphus liga no /admin. O pedido fica em tenants/{slug}.solicitacoes.espera.

export type EstadoEspera = {
  ligado: boolean;
  pedido: { status: "pendente" | "cancelada" | "atendida"; em: number } | null;
};

type Pedido = { status: "pendente" | "cancelada" | "atendida"; em: number; por?: string; canceladaEm?: number; atendidaEm?: number };

export const lerEstado = (t: FirebaseFirestore.DocumentSnapshot): EstadoEspera => {
  const p = t.get("solicitacoes.espera") as Pedido | undefined;
  return {
    ligado: esperaLigada(t.get("modulos")),
    pedido: p && typeof p.em === "number" ? { status: p.status, em: p.em } : null,
  };
};

const tenantDe = (db: Firestore, slug: string) => db.doc(`tenants/${slug}`);

// a fila vive da agenda: negócio "só site" não pede nem liga
const SEM_AGENDA = "Sem agendamento online não há fila de espera.";

export async function estadoEspera(db: Firestore, slug: string): Promise<EstadoEspera> {
  const t = await tenantDe(db, slug).get();
  return lerEstado(t);
}

export async function solicitarEspera(
  db: Firestore,
  slug: string,
  uid: string,
  opts: { alertar?: (db: Firestore, chave: string, assunto: string, conteudo: { resumo: string; acao: { texto: string; url: string } }) => Promise<unknown>; agora?: number } = {},
): Promise<EstadoEspera> {
  const { alertar = alertarAdmin, agora = Date.now() } = opts;
  const ref = tenantDe(db, slug);
  const novo = await db.runTransaction(async (tx) => {
    const t = await tx.get(ref);
    if (!t.exists) throw new UserError("Negócio não encontrado.");
    if (!agendamentoLigado(t.get("modulos"))) throw new UserError(SEM_AGENDA);
    if (esperaLigada(t.get("modulos"))) throw new UserError("A fila de espera já está ativa.");
    const p = t.get("solicitacoes.espera") as Pedido | undefined;
    if (p?.status === "pendente") return false;
    tx.update(ref, { "solicitacoes.espera": { status: "pendente", em: agora, por: uid } });
    return true;
  });
  if (novo) {
    // chave por pedido: o alertarAdmin segura 6 h por chave, e um pedido refeito depois de cancelar
    // ficaria sem e-mail
    await alertar(db, `espera:${slug}:${agora}`, "Pedido de fila de espera", {
      resumo: `O negócio ${slug} pediu a fila de espera.`,
      acao: { texto: "Abrir o admin", url: `${SITE_BASE}/admin` },
    });
  }
  return estadoEspera(db, slug);
}

export async function cancelarSolicitacaoEspera(db: Firestore, slug: string, agora = Date.now()): Promise<EstadoEspera> {
  const ref = tenantDe(db, slug);
  await db.runTransaction(async (tx) => {
    const p = (await tx.get(ref)).get("solicitacoes.espera") as Pedido | undefined;
    if (p?.status !== "pendente") return;
    tx.update(ref, { "solicitacoes.espera.status": "cancelada", "solicitacoes.espera.canceladaEm": agora });
  });
  return estadoEspera(db, slug);
}

export async function definirEspera(db: Firestore, slug: string, ligar: boolean, agora = Date.now()): Promise<EstadoEspera> {
  const ref = tenantDe(db, slug);
  await db.runTransaction(async (tx) => {
    const t = await tx.get(ref);
    if (!t.exists) throw new UserError("Negócio não encontrado.");
    if (!ligar) {
      tx.update(ref, { "modulos.espera": FieldValue.delete() });
      return;
    }
    if (!agendamentoLigado(t.get("modulos"))) throw new UserError(SEM_AGENDA);
    // sem os templates aprovados nenhum aviso sai: a fila ligada só juntaria esperas
    if (!esperaNoWhatsApp()) throw new UserError("Os avisos da fila ainda não foram liberados (templates da Meta). Ligue ATENDYS_TEMPLATE_ESPERA antes.");
    const pendente = (t.get("solicitacoes.espera") as Pedido | undefined)?.status === "pendente";
    tx.update(ref, {
      "modulos.espera": true,
      ...(pendente && { "solicitacoes.espera.status": "atendida", "solicitacoes.espera.atendidaEm": agora }),
    });
  });
  return estadoEspera(db, slug);
}
