"use client";

import { useEffect, useState } from "react";
import { idToken as tokenAtual } from "@/lib/firebase";
import type { DefModelo } from "@/lib/modelos/tipos";
import { publicar, type Uso, usoDoModelo } from "../modelos-actions";
import { BOTAO_CLARO, BOTAO_ESCURO, Dialogo, type Item, mudancas, Numero, pl } from "./util";

// Publicar os rascunhos: quantos de prospecção mudam e quantos clientes ficam na versão atual,
// e o que muda em cada modelo. Regra fixa: cliente ativo nunca muda sozinho.

const REGRA = "Cliente ativo nunca muda sozinho: fica congelado na versão que tinha até você atualizar pela gaveta dele. A versão anterior fica no histórico para restaurar.";

type Feito = Record<string, { versao: number; prospeccao: number; clientes: number }>;

/** `itens`: só os modelos com o rascunho salvo no servidor (o que vai ao ar é o que está lá);
 *  `fora`: nomes dos que têm edição local que não salvou (nome vazio, falha), avisados e deixados de fora. */
export function PublicarDialogo({ itens, fora, edicoes, aoFechar, aoPublicar }: { itens: Item[]; fora: string[]; edicoes: Record<string, DefModelo>; aoFechar: () => void; aoPublicar: (ids: string[]) => void }) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [feito, setFeito] = useState<Feito | null>(null);
  const [usos, setUsos] = useState<Record<string, Uso>>({});
  const [ids] = useState(() => itens.map((i) => i.def.id));
  // quantos usam cada modelo: lido ao abrir (a lista do Estúdio não conta)
  useEffect(() => {
    let atual = true;
    for (const id of ids)
      tokenAtual()
        .then((tk) => usoDoModelo(tk, id))
        .then((r) => atual && r.ok && setUsos((u) => ({ ...u, [id]: r.dados })), () => undefined);
    return () => {
      atual = false;
    };
  }, [ids]);
  const contado = ids.every((id) => usos[id]);
  const pros = ids.reduce((s, id) => s + (usos[id]?.prospeccao ?? 0), 0);
  const cli = ids.reduce((s, id) => s + (usos[id]?.clientes ?? 0), 0);

  async function sim() {
    setOcupado(true);
    const r = await publicar(await tokenAtual(), ids).catch(() => null);
    setOcupado(false);
    // deu certo ou não, o servidor passou a valer: recarrega as listas e solta as edições locais
    // destes ids (eram iguais ao rascunho salvo), para a tela não mostrar um estado que não existe
    aoPublicar(ids);
    if (!r?.ok) return setErro(r?.error ?? "Não foi possível publicar agora.");
    setFeito(r.dados);
  }

  if (feito) {
    const v = Object.values(feito);
    return (
      <Dialogo titulo="Publicado" aoFechar={aoFechar}>
        <div className="rounded-[10px] bg-[#E7EEE9] px-3 py-2.5 font-semibold text-[#2C6A53]">
          No ar. {pl(v.reduce((s, x) => s + x.prospeccao, 0), "em prospecção já mostra", "em prospecção já mostram")} a versão nova; {pl(v.reduce((s, x) => s + x.clientes, 0), "cliente ficou", "clientes ficaram")} na versão de antes.
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={aoFechar} className={BOTAO_ESCURO}>
            Fechar
          </button>
        </div>
      </Dialogo>
    );
  }

  return (
    <Dialogo titulo={`Publicar ${itens.length} ${itens.length === 1 ? "modelo" : "modelos"}?`} aoFechar={aoFechar}>
      <p className="m-0 font-semibold">
        {contado ? `${pl(pros, "em prospecção muda", "em prospecção mudam")} · ${pl(cli, "cliente fica", "clientes ficam")} na versão atual` : "Contando quem usa…"}
      </p>
      <div className="grid grid-cols-2 gap-2">
        <Numero valor={pros} texto={pros === 1 ? "em prospecção muda na hora" : "em prospecção mudam na hora"} />
        <Numero valor={cli} texto={cli === 1 ? "cliente ativo fica na versão atual" : "clientes ativos ficam na versão atual"} />
      </div>
      <p className="m-0 text-[#6F6A5E]">{REGRA}</p>
      <div>
        {itens.map((i) => {
          const m = mudancas(i.def, edicoes[i.def.id] ?? i.rascunho ?? i.def);
          return (
            <div key={i.def.id} className="flex gap-2 border-t border-[#E2DDD3] py-2 text-[13px]">
              <span className="min-w-0">
                <b>{(edicoes[i.def.id] ?? i.rascunho ?? i.def).nome}</b>
                <span className="block text-[#6F6A5E]">{m.length ? m.join(" · ") : "sem diferença visível da versão no ar"}</span>
              </span>
              <span className="ml-auto text-right whitespace-nowrap tabular-nums">
                {usos[i.def.id] ? (
                  <>
                    {pl(usos[i.def.id].prospeccao, "muda", "mudam")}
                    <br />
                    {pl(usos[i.def.id].clientes, "congelado", "congelados")}
                  </>
                ) : (
                  "…"
                )}
              </span>
            </div>
          );
        })}
      </div>
      {fora.length > 0 && (
        <p role="alert" className="m-0 rounded-[10px] bg-[#FFF7E6] px-3 py-2 text-[#8A4520]">
          Ficam de fora (a edição não foi salva; confira o nome): {fora.join(", ")}.
        </p>
      )}
      {erro && <p role="alert" className="m-0 text-[#8A2F2F]">{erro}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={aoFechar} className={BOTAO_CLARO}>
          Voltar
        </button>
        <button type="button" onClick={sim} disabled={ocupado || !ids.length} className={BOTAO_ESCURO}>
          {ocupado ? "Publicando…" : "Publicar"}
        </button>
      </div>
    </Dialogo>
  );
}
