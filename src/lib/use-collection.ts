"use client";

import { collection, onSnapshot, query, type QueryConstraint } from "firebase/firestore";
import { useEffect, useState } from "react";
import type { z } from "zod";
import { errorMessage } from "@/lib/auth-errors";
import { db } from "@/lib/firebase";

/** Coleção do tenant em tempo real; documentos fora do schema são ignorados. */
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
  const [result, setResult] = useState<{ for: string; items: Item[] } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    return onSnapshot(
      query(collection(db, "tenants", tenantId, name), ...constraints),
      (snap) =>
        setResult({
          for: current,
          items: snap.docs.flatMap((d) => {
            const r = schema.safeParse(d.data());
            return r.success ? [{ ...(r.data as object), id: d.id } as Item] : [];
          }),
        }),
      (err) => setError(errorMessage(err)),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  return [result?.for === current ? result.items : null, error] as const;
}
