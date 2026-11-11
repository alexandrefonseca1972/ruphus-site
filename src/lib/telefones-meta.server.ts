import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { erroContatoNegocio, NUMERO_META_ATUAL, soDigitosComDDI, telefoneDaMeta } from "@/lib/telefone";

const DOC = "config/atendys-plataforma";

/** Números que a Ruphus usa como remetentes na Meta. O atual fica como padrão para bancos
 *  anteriores à lista; os próximos entram pelo provisionamento ou por `registrarNumeroDaMeta`. */
export async function numerosReservadosMeta(db: Firestore): Promise<string[]> {
  const lido = (await db.doc(DOC).get()).get("numerosReservados");
  const lista = Array.isArray(lido) ? lido : [];
  return [...new Set([NUMERO_META_ATUAL, ...lista.map((v) => soDigitosComDDI(String(v))).filter((v): v is string => !!v)])];
}

export async function telefoneReservadoPelaMeta(db: Firestore, valor: string): Promise<boolean> {
  return telefoneDaMeta(valor, await numerosReservadosMeta(db));
}

export async function validarContatoDoNegocio(db: Firestore, valor: string): Promise<{ numero: string } | { erro: string }> {
  const erro = erroContatoNegocio(valor, await numerosReservadosMeta(db));
  return erro ? { erro } : { numero: soDigitosComDDI(valor)! };
}

export async function contatoDoNegocioValido(db: Firestore, valor: unknown): Promise<boolean> {
  return !("erro" in await validarContatoDoNegocio(db, String(valor ?? "")));
}

/** Registra um remetente da Meta para nunca ser cadastrado como contato de um negócio. */
export async function registrarNumeroDaMeta(db: Firestore, valor: string): Promise<string> {
  const numero = soDigitosComDDI(valor);
  if (!numero) throw new Error("Informe o número da Meta com DDI e DDD.");
  await db.doc(DOC).set({ numerosReservados: FieldValue.arrayUnion(numero) }, { merge: true });
  return numero;
}
