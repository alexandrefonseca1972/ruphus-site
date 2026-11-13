import { soDigitosComDDI, telefoneFalso } from "@/lib/telefone";
import { mascaraSlug } from "@/lib/tenant-input";

// Tipos de marca: um string comum não passa por TelefoneNorm, Slug etc. Só nascem pelos
// construtores abaixo, que devolvem null para entrada inválida (o chamador decide o erro).
declare const marca: unique symbol;
type Marca<T, M extends string> = T & { readonly [marca]: M };

export type TelefoneNorm = Marca<string, "TelefoneNorm">;
export type Slug = Marca<string, "Slug">;
export type VarianteId = Marca<string, "VarianteId">;
export type ModeloId = Marca<string, "ModeloId">;

/** Telefone BR canônico (DDI+DDD+número, celular com o 9), sem número inventado. */
export function paraTelefoneNorm(valor: string): TelefoneNorm | null {
  const n = soDigitosComDDI(valor); // já canoniza com canonicalBrMobile
  return n && !telefoneFalso(n) ? (n as TelefoneNorm) : null;
}

// válido = já está na forma que a máscara produz, sem hífen no fim e com 2+ caracteres
const formaDeSlug = (s: string) => s.length >= 2 && mascaraSlug(s) === s && !s.endsWith("-");

export const paraSlug = (s: string): Slug | null => (formaDeSlug(s) ? (s as Slug) : null);
/** Id de variante segue a forma do slug (ex.: salao-primeiro-elogio-google). */
export const paraVarianteId = (s: string): VarianteId | null => (formaDeSlug(s) ? (s as VarianteId) : null);

/** Id de modelo: o da Anthropic (claude-haiku-5-5) ou o do servidor local (llama3.1:8b, org/modelo). */
export const paraModeloId = (s: string): ModeloId | null => (/^[a-z0-9][a-z0-9._:/-]{0,99}$/i.test(s) ? (s as ModeloId) : null);
