import { useSyncExternalStore } from "react";
import { formatBRL } from "@/lib/datetime";

// Privacidade dos valores no painel (agenda, caixa, clientes): o dono atende com o cliente do lado
// e não quer o faturamento à vista. Escolha deste aparelho (localStorage), como nos apps de banco.

const CHAVE = "ruphus:ocultar-valores";
export const OCULTO = "R$ ••••";
const ouvintes = new Set<() => void>();

function ler() {
  try {
    return localStorage.getItem(CHAVE) === "1";
  } catch {
    return false;
  }
}

function assinar(f: () => void) {
  ouvintes.add(f);
  // outra aba trocou: esta acompanha
  const daOutraAba = (e: StorageEvent) => e.key === CHAVE && f();
  window.addEventListener("storage", daOutraAba);
  return () => {
    ouvintes.delete(f);
    window.removeEventListener("storage", daOutraAba);
  };
}

export function alternarValores() {
  try {
    localStorage.setItem(CHAVE, ler() ? "0" : "1");
  } catch {
    // sem armazenamento (aba anônima bloqueada): fica como está
  }
  ouvintes.forEach((f) => f());
}

/** oculto: os valores estão escondidos; brl: o formatBRL da tela, que respeita a escolha. */
export function useValores() {
  const oculto = useSyncExternalStore(assinar, ler, () => false);
  return { oculto, brl: (cents: number) => (oculto ? OCULTO : formatBRL(cents)) };
}
