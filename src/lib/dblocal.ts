// Como o banco local reconhece um negócio que já existe. Fica aqui, e não no
// scripts/dblocal.mts, porque outros scripts (consolidar-planilhas) comparam a
// mesma listagem sem disparar a sincronização com o Firestore.
import type { DatabaseSync } from "node:sqlite";

/** Sem acento, minúsculo, só letra e número: "Salão D'Paula" e "SALAO DPAULA" são o mesmo nome. */
export const norm = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

type Existente = { slug: string; site_url: string; estagio: string; no_ar: number };

/** Telefone é quem identifica o negócio (como no gerador); nome e cidade iguais com outro
 *  número pode ser o mesmo negócio ou outra unidade: fica para alguém olhar. */
export function classificar(db: DatabaseSync, lead: { nome: string; telefone: string; cidade: string }) {
  const campos = "slug, site_url, estagio, no_ar";
  const porTelefone = db.prepare(`SELECT ${campos} FROM negocios WHERE telefone = ?`).get(lead.telefone) as Existente | undefined;
  if (porTelefone) return { situacao: "duplicado: mesmo telefone", existente: porTelefone };
  // planilha sem coluna de cidade: vale o nome sozinho, senão nada bateria
  const porNome = db.prepare(`SELECT ${campos} FROM negocios WHERE nome_norm = ? AND (? = '' OR cidade_norm = ?)`).get(norm(lead.nome), norm(lead.cidade), norm(lead.cidade)) as Existente | undefined;
  if (porNome) return { situacao: `conferir: mesmo nome${lead.cidade ? " e cidade" : ""}, outro telefone`, existente: porNome };
  return { situacao: "novo", existente: null };
}
