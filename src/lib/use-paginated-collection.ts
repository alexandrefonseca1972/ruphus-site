"use client";

import { collection, documentId, getDocs, limit, onSnapshot, orderBy, query, startAfter, type DocumentSnapshot, type QueryConstraint } from "firebase/firestore";
import { useCallback, useEffect, useRef, useState } from "react";
import type { z } from "zod";
import { errorMessage } from "@/lib/auth-errors";
import { db } from "@/lib/firebase-db";

const PAGINA = 30;

export function usePaginatedCollection<S extends z.ZodType>(tenantId: string, name: string, schema: S, constraints: QueryConstraint[] = [], key = "") {
  type Item = z.infer<S> & { id: string };
  type Extra = { items: Item[]; descartados: string[]; hasMore: boolean; cursor?: DocumentSnapshot };
  type Result = { for: string; items: Item[]; error?: string; descartados: string[]; hasMore: boolean };
  const current = `${tenantId}/${name}/${key}`;
  const [result, setResult] = useState<Result | null>(null);
  const [busy, setBusy] = useState(false);
  const state = useRef<{ for: string; busy: boolean; extra: Extra }>({ for: "", busy: false, extra: { items: [], descartados: [], hasMore: false } });

  useEffect(() => {
    if (!tenantId) return;
    let ativo = true;
    state.current = { for: current, busy: false, extra: { items: [], descartados: [], hasMore: false } };
    setBusy(false);
    const base = query(collection(db, "tenants", tenantId, name), ...constraints, orderBy(documentId()), limit(PAGINA + 1));
    const parar = onSnapshot(base, (snap) => {
      if (!ativo) return;
      const docs = snap.docs.slice(0, PAGINA);
      const descartados: string[] = [];
      const primeira = docs.flatMap((d) => {
        const r = schema.safeParse(d.data({ serverTimestamps: "estimate" }));
        if (!r.success) {
          descartados.push(d.id);
          console.warn(`[${name}] ${d.id} fora do formato:`, r.error.issues[0]);
        }
        return r.success ? [{ ...(r.data as object), id: d.id } as Item] : [];
      });
      const anterior = state.current.for === current ? state.current.extra : { items: [], descartados: [], hasMore: false };
      const extra = {
        ...anterior,
        items: [...new Map([...primeira, ...anterior.items].map((item) => [item.id, item])).values()],
        cursor: anterior.cursor ?? docs.at(-1),
        hasMore: anterior.cursor ? anterior.hasMore : snap.docs.length > PAGINA,
      };
      state.current = { for: current, busy: state.current.busy, extra };
      setResult({
        for: current,
        items: extra.items,
        descartados: [...new Set([...descartados, ...extra.descartados])],
        hasMore: extra.hasMore,
      });
    }, (err) => {
      if (!ativo) return;
      console.error(`[${name}] leitura paginada falhou`, err);
      setResult((old) => old?.for === current ? { ...old, error: errorMessage(err) } : { for: current, items: [], error: errorMessage(err), descartados: [], hasMore: false });
    });
    return () => {
      ativo = false;
      parar();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const loadMore = useCallback(async () => {
    const anterior = state.current;
    if (!tenantId || anterior.for !== current || anterior.busy || !anterior.extra.cursor || !anterior.extra.hasMore) return;
    state.current = { ...anterior, busy: true };
    setBusy(true);
    try {
      const snap = await getDocs(query(collection(db, "tenants", tenantId, name), ...constraints, orderBy(documentId()), startAfter(anterior.extra.cursor), limit(PAGINA + 1)));
      if (state.current.for !== current) return;
      const docs = snap.docs.slice(0, PAGINA);
      const descartados: string[] = [];
      const items = docs.flatMap((d) => {
        const r = schema.safeParse(d.data({ serverTimestamps: "estimate" }));
        if (!r.success) descartados.push(d.id);
        return r.success ? [{ ...(r.data as object), id: d.id } as Item] : [];
      });
      const extra = {
        items: [...new Map([...state.current.extra.items, ...items].map((item) => [item.id, item])).values()],
        descartados: [...new Set([...state.current.extra.descartados, ...descartados])],
        hasMore: snap.docs.length > PAGINA,
        cursor: docs.at(-1) ?? anterior.extra.cursor,
      };
      state.current = { for: current, busy: false, extra };
      setResult((old) => old?.for === current ? {
        ...old,
        items: extra.items,
        descartados: [...new Set([...old.descartados, ...descartados])],
        hasMore: extra.hasMore,
        error: undefined,
      } : old);
    } catch (err) {
      if (state.current.for !== current) return;
      state.current = { ...anterior, busy: false };
      setResult((old) => old?.for === current ? { ...old, error: errorMessage(err) } : old);
    } finally {
      if (state.current.for === current) setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, tenantId, name]);

  const mine = result?.for === current ? result : null;
  return { items: mine?.items ?? null, error: mine?.error ?? "", descartados: mine?.descartados ?? [], hasMore: mine?.hasMore ?? false, loadMore, busy };
}
