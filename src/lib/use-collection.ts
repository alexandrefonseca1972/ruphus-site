"use client";

import { collection, onSnapshot, query, type QueryConstraint } from "firebase/firestore";
import { useEffect, useState } from "react";
import type { z } from "zod";
import { errorMessage } from "@/lib/auth-errors";
import { db } from "@/lib/firebase-db";

/** Coleção do tenant em tempo real; documentos fora do schema são ignorados e contados (terceiro item).
 *  tenantId vazio não consulta: fica em "carregando" (null). */
export function useCollection<S extends z.ZodType>(
  tenantId: string,
  name: string,
  schema: S,
  constraints: QueryConstraint[] = [],
  key = "", // muda quando `constraints` muda
) {
  type Item = z.infer<S> & { id: string };
  const current = `${tenantId}/${name}/${key}`;
  // Resultado guardado com a chave da consulta: chave diferente = ainda carregando
  const [result, setResult] = useState<{ for: string; items: Item[]; error?: string; descartados: number } | null>(null);

  useEffect(() => {
    if (!tenantId) return; // sem tenant, sem consulta (ex.: módulo desligado)
    // Escuta que falha morre (o Firestore não retoma): a tela ficava congelada sem aviso — um
    // "Recebi" não aparecia até recarregar. Tenta de novo algumas vezes (erro passageiro, como a
    // troca de token logo depois do login) e deixa o erro no console para achar a causa.
    let parar = () => {};
    let espera: ReturnType<typeof setTimeout> | undefined;
    let tentativa = 0;
    const assinar = () => (parar = onSnapshot(
      query(collection(db, "tenants", tenantId, name), ...constraints),
      (snap) => {
        // documento fora do formato some da lista: fica no console e na contagem, para a tela avisar
        let descartados = 0;
        const items = snap.docs.flatMap((d) => {
          const r = schema.safeParse(d.data({ serverTimestamps: "estimate" }));
          if (!r.success) {
            descartados++;
            console.warn(`[${name}] ${d.id} fora do formato:`, r.error.issues[0]);
          }
          return r.success ? [{ ...(r.data as object), id: d.id } as Item] : [];
        });
        setResult({ for: current, items, descartados });
      },
      (err) => {
        console.error(`[${name}] escuta caiu (tentativa ${tentativa + 1})`, err);
        setResult({ for: current, items: [], error: errorMessage(err), descartados: 0 });
        if (tentativa < 3) espera = setTimeout(assinar, 1500 * 2 ** tentativa++);
      },
    ));
    assinar();
    return () => {
      clearTimeout(espera);
      parar();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const mine = result?.for === current ? result : null;
  // terceiro: quantos documentos ficaram fora por não passarem no schema
  return [mine ? mine.items : null, mine?.error ?? "", mine?.descartados ?? 0] as const;
}
