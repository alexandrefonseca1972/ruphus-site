"use client";

import { useEffect, useState } from "react";
import { ESTAGIOS, ROTULO } from "@/lib/crm-tipos";
import { idToken as tokenAtual } from "@/lib/firebase";
import type { DefModelo } from "@/lib/modelos/tipos";
import { aplicarLote, contarLote, desfazerLote } from "../modelos-actions";
import { BOTAO_CLARO, BOTAO_ESCURO, CAMPO, Dialogo, n, Numero, pl, ramoDe } from "./util";

// Aplicar um modelo em lote: filtros, contagem antes de trocar, segunda confirmação para incluir
// clientes e "Desfazer" no resultado (vale por 7 dias).

type Filtros = Parameters<typeof contarLote>[1];
type Contagem = Extract<Awaited<ReturnType<typeof contarLote>>, { ok: true }>["dados"];
type Feito = Extract<Awaited<ReturnType<typeof aplicarLote>>, { ok: true }>["dados"];

const CAIXA = "grid gap-1.5 text-[12.5px] font-semibold";
const MARCA = "flex min-h-11 items-center gap-2 font-medium";

/** `ramos`: os ramos que aceitam o modelo (no site, os da mesma família de layout). */
export function LoteDialogo({ def, ramos, aoFechar, aoMudar }: { def: DefModelo; ramos: string[]; aoFechar: () => void; aoMudar: () => void }) {
  const [sub, setSub] = useState(def.sub === "todos" ? "" : def.sub);
  const [uf, setUf] = useState("");
  const [cidade, setCidade] = useState("");
  const [estagio, setEstagio] = useState("");
  const [soSem, setSoSem] = useState(true);
  const [comCli, setComCli] = useState(false);
  const [conf2, setConf2] = useState(false);
  const [contagem, setContagem] = useState<{ chave: string; dados: Contagem } | null>(null);
  const [erro, setErro] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [feito, setFeito] = useState<Feito | null>(null);
  const [desfeito, setDesfeito] = useState<string>("");

  const filtros = JSON.stringify({
    tipo: def.tipo, modeloId: def.id,
    ...(sub && { sub }), ...(/^[A-Z]{2}$/.test(uf) && { uf }), ...(cidade.trim() && { cidade: cidade.trim() }), ...(estagio && { estagio }),
    soSemEscolhaManual: soSem,
  });

  // conta de novo 400 ms depois do último filtro mexido
  useEffect(() => {
    let atual = true;
    const t = setTimeout(async () => {
      const r = await contarLote(await tokenAtual(), JSON.parse(filtros) as Filtros).catch(() => null);
      if (!atual) return;
      if (r?.ok) {
        setContagem({ chave: filtros, dados: r.dados });
        setErro("");
      } else setErro(r?.error ?? "Não foi possível contar agora.");
    }, 400);
    return () => {
      atual = false;
      clearTimeout(t);
    };
  }, [filtros]);
  // a contagem só vale para os filtros com que foi feita: mexeu, "Trocar N" fica desligado até contar de novo
  const conta = contagem?.chave === filtros ? contagem.dados : null;

  async function fazer() {
    setOcupado(true);
    const r = await aplicarLote(await tokenAtual(), JSON.parse(filtros) as Filtros, comCli ? { incluirClientes: true, confirmouClientes: true } : {}).catch(() => null);
    setOcupado(false);
    if (!r?.ok) return setErro(r?.error ?? "Não foi possível aplicar agora.");
    setFeito(r.dados);
    aoMudar();
  }

  async function desfazer() {
    if (!feito?.id) return;
    setOcupado(true);
    const r = await desfazerLote(await tokenAtual(), feito.id).catch(() => null);
    setOcupado(false);
    if (!r?.ok) return setErro(r?.error ?? "Não foi possível desfazer agora.");
    const d = r.dados;
    setDesfeito(d.jaDesfeito ? "Este lote já tinha sido desfeito." : `${pl(d.restaurados, "negócio voltou", "negócios voltaram")} ao modelo de antes${d.mudaram ? `; ${pl(d.mudaram, "já tinha trocado de modelo e ficou como está", "já tinham trocado de modelo e ficaram como estão")}` : ""}${d.viraramClientes ? `; ${pl(d.viraramClientes, "virou cliente depois do lote e ficou como está", "viraram clientes depois do lote e ficaram como estão")} (cliente não muda sozinho)` : ""}${d.semModelo ? `; ${pl(d.semModelo, "tinha um modelo que foi apagado e ficou como está", "tinham um modelo que foi apagado e ficaram como estão")}` : ""}.`);
    aoMudar();
  }

  const coisa: [string, string] = def.tipo === "bio" ? ["bio", "bios"] : ["site", "sites"];
  if (feito)
    return (
      <Dialogo titulo={desfeito ? "Desfeito" : "Pronto"} aoFechar={aoFechar}>
        <div className="rounded-[10px] bg-[#E7EEE9] px-3 py-2.5 font-semibold text-[#2C6A53]">
          {desfeito || (feito.total ? `${pl(feito.total, "negócio trocado", "negócios trocados")} para ${def.nome}${feito.clientes ? ` (${pl(feito.clientes, "cliente, congelado", "clientes, congelados")} na versão de agora)` : ""}. Dá para desfazer por 7 dias.` : "Nada a trocar: nenhum negócio entrou nos filtros.")}
        </div>
        {erro && <p role="alert" className="m-0 text-[#8A2F2F]">{erro}</p>}
        <div className="flex justify-end gap-2">
          {!desfeito && feito.id && (
            <button type="button" onClick={desfazer} disabled={ocupado} className={BOTAO_CLARO}>
              {ocupado ? "Desfazendo…" : "Desfazer"}
            </button>
          )}
          <button type="button" onClick={aoFechar} className={BOTAO_ESCURO}>
            Fechar
          </button>
        </div>
      </Dialogo>
    );

  const total = conta ? conta.prospeccao + (comCli ? conta.clientes : 0) : 0;
  return (
    <Dialogo titulo={`Aplicar ${def.nome}`} aoFechar={aoFechar}>
      <div className="grid grid-cols-2 gap-2.5">
        <label className={CAIXA}>
          Ramo
          <select value={sub} onChange={(e) => setSub(e.target.value)} className={CAMPO}>
            <option value="">Todos{def.tipo === "site" ? " da mesma família" : ""}</option>
            {ramos.map((r) => (
              <option key={r} value={r}>
                {ramoDe(r)}
              </option>
            ))}
          </select>
        </label>
        <label className={CAIXA}>
          Etapa do CRM
          <select value={estagio} onChange={(e) => setEstagio(e.target.value)} className={CAMPO}>
            <option value="">Todas</option>
            {ESTAGIOS.map((e) => (
              <option key={e} value={e}>
                {ROTULO[e]}
              </option>
            ))}
          </select>
        </label>
        <label className={CAIXA}>
          Cidade
          <input type="text" value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Todas" className={CAMPO} />
        </label>
        <label className={CAIXA}>
          UF
          <input type="text" value={uf} maxLength={2} onChange={(e) => setUf(e.target.value.toUpperCase())} placeholder="Todas" className={CAMPO} />
        </label>
      </div>
      <label className={MARCA}>
        <input type="checkbox" checked={soSem} onChange={(e) => setSoSem(e.target.checked)} className="h-[18px] w-[18px]" /> Só quem está sem escolha manual
        {conta && !soSem && conta.comEscolhaManual > 0 && <span className="text-[#6F6A5E]">({n(conta.comEscolhaManual)} com escolha)</span>}
      </label>
      <label className={MARCA}>
        <input
          type="checkbox"
          checked={comCli}
          onChange={(e) => {
            setComCli(e.target.checked);
            setConf2(false);
          }}
          className="h-[18px] w-[18px]"
        />{" "}
        Incluir clientes ativos{conta ? ` (${n(conta.clientes)})` : ""}
      </label>
      <div className="grid grid-cols-2 gap-2" aria-live="polite">
        <Numero valor={conta?.prospeccao ?? 0} texto={conta ? "em prospecção vão mudar" : "contando…"} />
        <Numero valor={conta?.clientes ?? 0} texto={comCli ? "clientes ativos também vão mudar" : "clientes ativos ficam como estão"} destaque={comCli} />
      </div>
      {erro && <p role="alert" className="m-0 text-[#8A2F2F]">{erro}</p>}
      {conf2 && conta ? (
        <div className="grid gap-2 rounded-[14px] border-2 border-[#E8A33D] bg-[#FFF7E6] p-3">
          <b>Trocar o {def.tipo === "bio" ? "bio" : "site"} de {pl(conta.clientes, "cliente que já paga", "clientes que já pagam")}?</b>
          <span className="text-[#6F6A5E]">Muda na hora, sem aviso ao dono, e fica congelado na versão de agora. Recomendado só depois de combinar com cada um.</span>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConf2(false)} className={BOTAO_CLARO}>
              Voltar
            </button>
            <button type="button" onClick={fazer} disabled={ocupado} className={BOTAO_ESCURO}>
              {ocupado ? "Trocando…" : conta.clientes === 1 ? "Sim, incluir o cliente" : `Sim, incluir os ${n(conta.clientes)} clientes`}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex justify-end gap-2">
          <button type="button" onClick={aoFechar} className={BOTAO_CLARO}>
            Cancelar
          </button>
          <button
            type="button"
            disabled={!conta || !total || ocupado}
            onClick={() => (comCli && conta?.clientes ? setConf2(true) : fazer())}
            className={BOTAO_ESCURO}
          >
            {ocupado ? "Trocando…" : conta && !total ? "Nada a trocar" : `Trocar ${pl(total, ...coisa)}`}
          </button>
        </div>
      )}
    </Dialogo>
  );
}
