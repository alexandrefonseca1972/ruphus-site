"use client";

import { useState } from "react";
import { SUBS } from "@/lib/gerador";
import { doNichoAtivo } from "@/lib/modelos/tipos";
import { idToken as tokenAtual } from "@/lib/firebase";
import type { DefModelo } from "@/lib/modelos/tipos";
import { criar, duplicar } from "../modelos-actions";
import { BIO_PRONTOS, BOTAO_CLARO, BOTAO_ESCURO, CAMPO, Dialogo, type Item, ramoDe, ROTULO_LAYOUT, type Tipo } from "./util";

// Novo modelo (combinação nova) ou Duplicar. Nasce publicado e desligado (versão 1): só entra nas
// listas quando o admin ligar.

const CAIXA = "grid gap-1.5 text-[12.5px] font-semibold";
const idDe = (nome: string) =>
  `${nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "modelo"}-${Date.now().toString(36)}`;

type Props = {
  /** com base: duplicar; sem: novo a partir do modelo aberto */
  duplicando: boolean;
  atual: DefModelo | null;
  site: Item[];
  bio: Item[];
  aoFechar: () => void;
  aoCriar: (id: string, tipo: Tipo) => void;
};

export function NovoDialogo({ duplicando, atual, site, bio, aoFechar, aoCriar }: Props) {
  const [nome, setNome] = useState(duplicando && atual ? `${atual.nome} (cópia)`.slice(0, 60) : "Modelo novo");
  const [tipo, setTipo] = useState<Tipo>(atual?.tipo ?? "site");
  const ramosSite = [...new Set(site.map((i) => i.def.sub))];
  const ramos = tipo === "site" ? ramosSite : ["todos", ...Object.keys(SUBS).filter(doNichoAtivo)];
  const [sub, setSub] = useState<string>(atual?.sub ?? "");
  const ramo = ramos.includes(sub) ? sub : (ramos[0] ?? "");
  const [layout, setLayout] = useState(atual?.tipo === "bio" ? atual.layout : "clara");
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");

  /** O ponto de partida: o modelo aberto se for do mesmo tipo e ramo; senão, o primeiro do ramo. */
  function base(): DefModelo | null {
    if (tipo === "site") {
      if (atual?.tipo === "site" && atual.sub === ramo) return atual;
      return site.find((i) => i.def.sub === ramo)?.def ?? null;
    }
    const b = atual?.tipo === "bio" ? atual : bio[0]?.def;
    return b ? { ...b, sub: ramo as DefModelo["sub"], layout: layout as DefModelo["layout"] } : null;
  }

  async function sim() {
    if (!nome.trim()) return setErro("Dê um nome ao modelo.");
    setOcupado(true);
    const tk = await tokenAtual();
    const b = base();
    const r = duplicando && atual ? await duplicar(tk, atual.id, nome.trim()).catch(() => null) : b ? await criar(tk, { ...b, id: idDe(nome), nome: nome.trim(), ativo: false }).catch(() => null) : null;
    setOcupado(false);
    if (!r?.ok) return setErro(r?.error ?? (b ? "Não foi possível criar agora." : "Esse ramo ainda não tem modelo para servir de base."));
    aoCriar(r.dados, duplicando && atual ? atual.tipo : tipo);
  }

  return (
    <Dialogo titulo={duplicando ? "Duplicar modelo" : "Novo modelo"} aoFechar={aoFechar}>
      <label className={CAIXA}>
        Nome
        <input type="text" value={nome} maxLength={60} onChange={(e) => setNome(e.target.value)} className={CAMPO} />
      </label>
      {!duplicando && (
        <>
          <label className={CAIXA}>
            Tipo
            <select value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)} className={CAMPO}>
              <option value="bio">Bio</option>
              <option value="site">Site</option>
            </select>
          </label>
          <label className={CAIXA}>
            Ramo
            <select value={ramo} onChange={(e) => setSub(e.target.value)} className={CAMPO}>
              {ramos.map((r) => (
                <option key={r} value={r}>
                  {ramoDe(r)}
                </option>
              ))}
            </select>
          </label>
          {tipo === "bio" && (
            <label className={CAIXA}>
              Layout
              <select value={layout} onChange={(e) => setLayout(e.target.value as DefModelo["layout"])} className={CAMPO}>
                {BIO_PRONTOS.map((l) => (
                  <option key={l} value={l}>
                    {ROTULO_LAYOUT[l]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </>
      )}
      <p className="m-0 text-[#6F6A5E]">
        Começa {duplicando ? "igual ao original" : "com as fotos e a cor do modelo aberto (ou do primeiro do ramo)"}; layout, fotos e cor se ajustam no inspetor. Entra desligado até você ligar.
      </p>
      {erro && <p role="alert" className="m-0 text-[#8A2F2F]">{erro}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={aoFechar} className={BOTAO_CLARO}>
          Cancelar
        </button>
        <button type="button" onClick={sim} disabled={ocupado} className={BOTAO_ESCURO}>
          {ocupado ? "Criando…" : duplicando ? "Duplicar" : "Criar"}
        </button>
      </div>
    </Dialogo>
  );
}
