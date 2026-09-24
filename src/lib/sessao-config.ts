"use client";

import { doc, onSnapshot } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db } from "@/lib/firebase-db";

/** Os minutos de inatividade configurados, acompanhados ao vivo.
 *
 * Separado de sessao.ts porque é a única parte que fala com o Firestore: junto,
 * ele obrigava /admin, /login e /painel — que só precisam de `loginComMotivo` e
 * do relógio — a baixar 1 MB do SDK. Use com useAutoLogout(useMinutosInativo()).
 * Quem já recebe o valor por outro caminho (o /admin recebe junto do painel)
 * passa o número direto e não importa isto. */
export function useMinutosInativo() {
  const [minutos, setMinutos] = useState(0);
  useEffect(
    () =>
      onSnapshot(
        doc(db, "config", "sessao"),
        (d) => setMinutos(Number(d.get("minutos")) || 0),
        () => setMinutos(0), // sem permissão ou offline: não tranca ninguém fora
      ),
    [],
  );
  return minutos;
}
