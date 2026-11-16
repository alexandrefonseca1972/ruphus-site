"use client";

import { useEffect, useRef, useState } from "react";
import { confirmar } from "@/components/confirmar";
import { idToken as tokenAtual } from "@/lib/firebase";
import { SUBS } from "@/lib/gerador";
import type { Aviso } from "@/lib/modelos/checagem";
import { type Caso, type DefModelo, doNichoAtivo } from "@/lib/modelos/tipos";
import { apagarModelo, checar, definirPadrao, descartar, ligar, listarModelos, salvarRascunho } from "../modelos-actions";
import { Arvore, SeletorCelular } from "./arvore";
import { Grade } from "./grade";
import { type Aba, Inspetor, type Opcoes } from "./inspetor";
import { LoteDialogo } from "./lote-dialogo";
import { negociosDoModelo } from "./negocios-actions";
import { NovoDialogo } from "./novo-dialogo";
import { PublicarDialogo } from "./publicar-dialogo";
import { type FormatoTela, Tela } from "./tela";
import { BOTAO_CLARO, BOTAO_ESCURO, defDe, ehPadrao, familiaDe, FOCO, type Item, type Lista, type Negocios, ramoDe, SERIFA, type Tipo } from "./util";

// Estúdio de modelos (docs/plano-estudio-modelos.md, F6): árvore | tela | inspetor, com a barra de
// Grade/Editor, caminho, rascunho, Aplicar em lote, Descartar e Publicar.
//
// Rascunho: cada ajuste edita uma cópia local da def (edicoes) e a prévia já sai dela; 600 ms depois
// do último ajuste, salvarRascunho grava no servidor e a árvore marca "rascunho". Publicar grava
// antes o que estiver pendente e manda só os ids com rascunho salvo; Descartar e Restaurar cancelam
// o ajuste pendente (não faz sentido salvar o que vai ser jogado fora). Salvar que falhou trava o
// Publicar até o modelo salvar de novo.

const ESPERA_RASCUNHO = 600;
type Dialogo = { qual: "publicar" } | { qual: "novo"; duplicando: boolean } | { qual: "lote" } | null;

/** Opções de fotos e cor: as dos modelos do mesmo ramo e família de layout (na bio, os kits
 *  editoriais do ramo), mais a atual. */
function opcoesDe(def: DefModelo, site: Item[]): Opcoes {
  const base = def.tipo === "site"
    ? site.filter((i) => i.def.layout === def.layout && i.def.sub === def.sub)
    : site.filter((i) => i.def.layout === "editorial" && (def.sub === "todos" || i.def.sub === def.sub));
  // a atual por último: a ordem não pula a cada escolha
  const defs = [...base.map((i) => i.def), def];
  const paletas = new Map(defs.map((d) => [JSON.stringify(d.paleta), d.paleta]));
  return { kits: [...new Set(defs.map((d) => d.kit))], paletas: [...paletas.values()] };
}

export function Estudio({ idToken }: { idToken: string }) {
  const [tipo, setTipo] = useState<Tipo>("site");
  const [listas, setListas] = useState<Partial<Record<Tipo, Lista>>>({});
  const [recarga, setRecarga] = useState({ site: 0, bio: 0 });
  const [erro, setErro] = useState<Partial<Record<Tipo, string>>>({});
  const [aviso, setAviso] = useState("");
  // ids cujo último salvarRascunho falhou: o Publicar espera
  const [falhas, setFalhas] = useState<Record<string, true>>({});
  const [abaChecar, setAbaChecar] = useState(false);
  const [selId, setSelId] = useState("");
  const [vista, setVista] = useState<"editor" | "grade">("editor");
  const [busca, setBusca] = useState("");
  const [edicoes, setEdicoes] = useState<Record<string, DefModelo>>({});
  // site abre em "Todos", bio no celular (mudarTipo troca junto)
  const [formato, setFormato] = useState<FormatoTela>("todos");
  const [slugEscolhido, setSlug] = useState("");
  const [caso, setCaso] = useState<Caso>("normal");
  const [comp, setComp] = useState("");
  const [negocios, setNegocios] = useState<{ chave: string; dados: Negocios } | null>(null);
  const [avisos, setAvisos] = useState<{ chave: string; dados: Aviso[] } | null>(null);
  const [dialogo, setDialogo] = useState<Dialogo>(null);
  const pendentes = useRef(new Map<string, { timer: number; def: DefModelo }>());

  // a lista do tipo aberto; o site carrega sempre (a bio tira dele as opções de fotos)
  useEffect(() => {
    if (!idToken) return;
    let atual = true;
    for (const t of new Set<Tipo>(["site", tipo]))
      tokenAtual()
        .then((tk) => listarModelos(tk, t))
        .then(
          (r) => {
            if (!atual) return;
            if (r.ok) setListas((l) => ({ ...l, [t]: r.dados }));
            setErro((e) => ({ ...e, [t]: r.ok ? "" : r.error }));
          },
          () => atual && setErro((e) => ({ ...e, [t]: "Não foi possível carregar os modelos." })),
        );
    return () => {
      atual = false;
    };
  }, [idToken, tipo, recarga]);
  const recarregar = (t: Tipo) => setRecarga((r) => ({ ...r, [t]: r[t] + 1 }));

  const lista = listas[tipo];
  const itens = lista?.modelos ?? [];
  const padroes = lista?.padroes ?? {};
  const item = itens.find((i) => i.def.id === selId) ?? itens.find((i) => ehPadrao(padroes, i.def)) ?? itens[0];
  const def = item ? defDe(item, edicoes) : null;
  const todos = [...(listas.site?.modelos ?? []), ...(listas.bio?.modelos ?? [])];
  const alterados = todos.filter((i) => i.rascunho || edicoes[i.def.id]);
  // vão ao ar só os com rascunho salvo no servidor e sem edição local diferente dele
  const publicaveis = alterados.filter((i) => i.rascunho && (!edicoes[i.def.id] || edicoes[i.def.id] === i.rascunho));
  const fora = alterados.filter((i) => !publicaveis.includes(i)).map((i) => defDe(i, edicoes).nome.trim() || i.def.nome);
  // falha de um modelo que saiu da lista (apagado) não trava
  const travado = Object.keys(falhas).some((id) => todos.some((i) => i.def.id === id));

  // negócios do ramo (prévia) e quem usa o modelo (aba Uso)
  const chaveNeg = item ? `${item.def.tipo}:${item.def.sub}:${item.def.id}` : "";
  useEffect(() => {
    if (!chaveNeg) return;
    const [t, sub, id] = chaveNeg.split(":");
    let atual = true;
    tokenAtual()
      .then((tk) => negociosDoModelo(tk, t as Tipo, sub, id))
      .then((r) => atual && (r.ok ? setNegocios({ chave: chaveNeg, dados: r.dados }) : setAviso(r.error)), () => undefined);
    return () => {
      atual = false;
    };
  }, [chaveNeg, recarga]);
  const neg = negocios?.chave === chaveNeg ? negocios.dados : null;
  const slug = neg?.doRamo.some((x) => x.slug === slugEscolhido) ? slugEscolhido : (neg?.doRamo[0]?.slug ?? "");

  // checagem: 600 ms depois do último ajuste, com o mesmo def da prévia; as fotos do ramo (lê os
  // negócios) só com a aba Checar aberta
  const chaveChk = def ? JSON.stringify(def) : "";
  useEffect(() => {
    if (!chaveChk) return;
    let atual = true;
    const t = setTimeout(async () => {
      const r = await checar(await tokenAtual(), JSON.parse(chaveChk) as DefModelo, {}, abaChecar).catch(() => null);
      if (atual && r?.ok) setAvisos({ chave: chaveChk, dados: r.dados.avisos });
    }, ESPERA_RASCUNHO);
    return () => {
      atual = false;
      clearTimeout(t);
    };
  }, [chaveChk, abaChecar]);

  // ao sair do Estúdio, o rascunho pendente não se perde
  useEffect(() => {
    const p = pendentes.current;
    return () => {
      for (const { timer, def: d } of p.values()) {
        clearTimeout(timer);
        if (d.nome.trim()) void tokenAtual().then((tk) => salvarRascunho(tk, d.id, d));
      }
    };
  }, []);

  async function salvar(d: DefModelo) {
    if (pendentes.current.get(d.id)?.def === d) pendentes.current.delete(d.id);
    if (!d.nome.trim()) {
      setAviso(`"${d.id}": o nome não pode ficar vazio; a edição não foi salva.`);
      return "nome" as const;
    }
    const r = await salvarRascunho(await tokenAtual(), d.id, d).catch(() => null);
    if (!r?.ok) {
      setFalhas((f) => ({ ...f, [d.id]: true }));
      setAviso(`${r?.error ?? "Não foi possível salvar o rascunho."} Publicar fica travado até salvar.`);
      return "falha" as const;
    }
    setFalhas(({ [d.id]: _f, ...f }) => f);
    setListas((l) => {
      const x = l[d.tipo];
      return x ? { ...l, [d.tipo]: { ...x, modelos: x.modelos.map((i) => (i.def.id === d.id ? { ...i, rascunho: d } : i)) } } : l;
    });
    return "ok" as const;
  }

  /** Junta a mudança à edição mais recente do modelo aberto (a pendente, se houver: dois ajustes no
   *  mesmo instante não se apagam). */
  function editar(mudanca: Partial<DefModelo>) {
    if (!item) return;
    const d = { ...(pendentes.current.get(item.def.id)?.def ?? defDe(item, edicoes)), ...mudanca };
    setEdicoes((e) => ({ ...e, [d.id]: d }));
    const antes = pendentes.current.get(d.id);
    if (antes) clearTimeout(antes.timer);
    pendentes.current.set(d.id, { def: d, timer: window.setTimeout(() => void salvar(d), ESPERA_RASCUNHO) });
  }

  async function gravarPendentes() {
    const ps = [...pendentes.current.values()];
    ps.forEach((p) => clearTimeout(p.timer));
    pendentes.current.clear();
    // nome vazio não trava: o modelo só fica de fora do Publicar, com aviso
    return !(await Promise.all(ps.map((p) => salvar(p.def)))).includes("falha");
  }

  /** Cancela o salvar pendente dos ids, sem gravar. */
  function cancelarPendentes(ids: string[]) {
    for (const id of ids) {
      clearTimeout(pendentes.current.get(id)?.timer);
      pendentes.current.delete(id);
    }
  }

  /** Tira a edição local (e a falha de salvar) dos ids, porque o servidor passou a valer, e recarrega as listas. */
  function esquecer(ids: string[]) {
    setEdicoes((e) => Object.fromEntries(Object.entries(e).filter(([id]) => !ids.includes(id))));
    setFalhas((f) => Object.fromEntries(Object.entries(f).filter(([id]) => !ids.includes(id))) as Record<string, true>);
    recarregar("site");
    recarregar("bio");
  }

  async function abrirPublicar() {
    // salvar que falhou agora trava o Publicar (o aviso diz o porquê)
    if (!(await gravarPendentes())) return;
    setDialogo({ qual: "publicar" });
  }

  async function descartarTudo() {
    const ids = alterados.map((i) => i.def.id);
    if (!ids.length) return;
    const ok = await confirmar({ titulo: "Descartar o rascunho?", texto: `As alterações não publicadas de ${ids.length} ${ids.length === 1 ? "modelo" : "modelos"} voltam ao que está no ar.`, acao: "Descartar" });
    if (!ok) return;
    cancelarPendentes([...pendentes.current.keys()]);
    const r = await descartar(await tokenAtual(), ids).catch(() => null);
    if (!r?.ok) return setAviso(r?.error ?? "Não foi possível descartar.");
    esquecer(ids);
  }

  function mudarTipo(t: Tipo) {
    setTipo(t);
    setFormato(t === "site" ? "todos" : "cel");
    setSelId("");
    setComp("");
  }

  function selecionar(id: string) {
    setSelId(id);
    setComp("");
    setVista("editor");
  }

  const erroLista = erro[tipo] || (tipo !== "site" ? erro.site : "");
  const tentarDeNovo = (
    <button type="button" onClick={() => (recarregar("site"), recarregar(tipo))} className={`ml-2 font-semibold underline ${FOCO}`}>
      Tentar de novo
    </button>
  );
  if (!lista || !item || !def)
    return erroLista ? (
      <p role="alert" className="p-10 text-sm text-[#8A2F2F]">
        {erroLista}
        {tentarDeNovo}
      </p>
    ) : (
      <p className="p-10 text-sm text-[#6F6A5E]">Carregando os modelos…</p>
    );

  const site = listas.site?.modelos ?? [];
  const busq = busca.trim().toLowerCase();
  const naGrade = itens.filter((i) => !busq || defDe(i, edicoes).nome.toLowerCase().includes(busq));
  const padrao = ehPadrao(padroes, def);
  const ramosLote = def.tipo === "site" ? [...new Set(site.filter((i) => i.def.layout === def.layout).map((i) => i.def.sub))] : Object.keys(SUBS).filter(doNichoAtivo);

  return (
    <section aria-label="Estúdio de modelos" className="flex flex-col overflow-hidden rounded-2xl border border-[#E2DDD3] bg-[#F4F2EE] text-[13.5px] text-[#17150F] min-[980px]:h-[calc(100dvh-150px)] min-[980px]:min-h-[620px]">
      <div className="flex flex-none flex-wrap items-center gap-2.5 border-b border-[#E2DDD3] bg-[#FAF8F4] px-4 py-2.5">
        <div role="group" aria-label="Vista" className="flex rounded-[10px] border border-[#E2DDD3] bg-white p-[3px]">
          {(["grade", "editor"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={vista === v}
              onClick={() => setVista(v)}
              className={`h-10 rounded-lg px-3 font-semibold ${FOCO} ${vista === v ? "bg-[#17150F] text-white" : "text-[#6F6A5E]"}`}
            >
              {v === "grade" ? "Grade" : "Editor"}
            </button>
          ))}
        </div>
        {/* no celular o caminho fica numa linha só dele, em cima, e só o nome do modelo é cortado */}
        <h2 className={`${SERIFA} order-first m-0 flex w-full min-w-0 items-baseline gap-[.3em] text-[22px] leading-tight font-normal whitespace-nowrap min-[980px]:order-none min-[980px]:w-auto min-[980px]:flex-1`}>
          <span className="max-w-[75%] flex-none truncate text-[#6F6A5E]">
            {def.tipo === "bio" ? "Bio" : "Site"} › {familiaDe(def.sub)} › {ramoDe(def.sub)} ›
          </span>
          <span className="min-w-0 truncate">{def.nome}</span>
        </h2>
        {alterados.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-[#8A4520]" aria-live="polite">
            <i className="h-2 w-2 rounded-full bg-[#E8A33D]" />
            {alterados.length} {alterados.length === 1 ? "modelo alterado" : "modelos alterados"} · rascunho
          </span>
        )}
        <button type="button" onClick={() => setDialogo({ qual: "lote" })} disabled={!item.ativo} title={item.ativo ? undefined : "Ligue o modelo para aplicar em lote"} className={BOTAO_CLARO}>
          Aplicar em lote
        </button>
        <button type="button" onClick={descartarTudo} disabled={!alterados.length} className={BOTAO_CLARO}>
          Descartar
        </button>
        <button type="button" onClick={abrirPublicar} disabled={!alterados.length || travado} title={travado ? "Um rascunho não salvou; ajuste o modelo até salvar" : undefined} className={BOTAO_ESCURO}>
          Publicar
        </button>
      </div>
      {erroLista && (
        <p role="alert" className="m-0 border-b border-[#E2DDD3] bg-[#F1E7E7] px-4 py-2 text-[12.5px] text-[#8A2F2F]">
          {erroLista}
          {tentarDeNovo}
        </p>
      )}
      {aviso && (
        <p role="alert" className="m-0 flex items-center gap-2 border-b border-[#E2DDD3] bg-[#F1E7E7] px-4 py-2 text-[12.5px] text-[#8A2F2F]">
          {aviso}
          <button type="button" onClick={() => setAviso("")} className={`ml-auto font-semibold ${FOCO}`}>
            Fechar
          </button>
        </p>
      )}

      <SeletorCelular tipo={tipo} setTipo={mudarTipo} itens={itens} edicoes={edicoes} selId={item.def.id} selecionar={selecionar} />

      <div className="min-h-0 flex-1 min-[980px]:grid min-[980px]:grid-cols-[250px_minmax(0,1fr)_310px]">
        <aside aria-label="Modelos" className="hidden min-h-0 overflow-y-auto border-r border-[#E2DDD3] bg-white p-3 min-[980px]:block">
          <Arvore tipo={tipo} setTipo={mudarTipo} itens={itens} edicoes={edicoes} padroes={padroes} selId={item.def.id} selecionar={selecionar} busca={busca} setBusca={setBusca} aoNovo={() => setDialogo({ qual: "novo", duplicando: false })} />
        </aside>
        <section aria-label="Prévia" className="flex min-h-0 flex-col overflow-auto bg-[#E7E3DB]">
          {vista === "grade" ? (
            <Grade itens={naGrade} edicoes={edicoes} padroes={padroes} selId={item.def.id} abrir={selecionar} />
          ) : (
            <Tela
              def={def}
              outros={itens}
              edicoes={edicoes}
              formato={formato}
              setFormato={setFormato}
              negocios={neg}
              slug={slug}
              setSlug={setSlug}
              caso={caso}
              setCaso={setCaso}
              comp={comp}
              setComp={setComp}
              selecionar={selecionar}
            />
          )}
        </section>
        <div className="min-h-0 overflow-y-auto border-t border-[#E2DDD3] bg-white min-[980px]:border-t-0 min-[980px]:border-l">
          <Inspetor
            item={item}
            def={def}
            padrao={padrao}
            padroes={padroes}
            outros={itens}
            opcoes={opcoesDe(def, site)}
            avisos={avisos?.chave === chaveChk ? avisos.dados : null}
            negocios={neg}
            editar={editar}
            ligar={async (ativo) => {
              const r = await ligar(await tokenAtual(), def.id, ativo).catch(() => null);
              if (!r?.ok) return setAviso(r?.error ?? "Não foi possível ligar ou desligar.");
              if (edicoes[def.id]) editar({ ativo });
              recarregar(def.tipo);
            }}
            definirPadrao={async (sub, id) => {
              const r = await definirPadrao(await tokenAtual(), def.tipo, sub, id).catch(() => null);
              if (!r?.ok) return setAviso(r?.error ?? "Não foi possível trocar o padrão.");
              recarregar(def.tipo);
            }}
            aoDuplicar={() => setDialogo({ qual: "novo", duplicando: true })}
            aoApagar={async () => {
              if (!(await confirmar({ titulo: "Apagar o modelo?", texto: `Apagar o modelo ${def.nome}? Não dá para desfazer.`, acao: "Apagar" }))) return;
              cancelarPendentes([def.id]);
              const r = await apagarModelo(await tokenAtual(), def.id).catch(() => null);
              if (!r?.ok) return setAviso(r?.error ?? "Não foi possível apagar o modelo.");
              selecionar(itens.find((i) => i.def.id !== def.id)?.def.id ?? "");
              esquecer([def.id]);
            }}
            aoLote={() => setDialogo({ qual: "lote" })}
            aoRestaurar={() => esquecer([def.id])}
            cancelarPendente={() => cancelarPendentes([def.id])}
            aoMudarAba={(a: Aba) => setAbaChecar(a === "chk")}
          />
        </div>
      </div>

      {dialogo?.qual === "publicar" && <PublicarDialogo itens={publicaveis} fora={fora} edicoes={edicoes} aoFechar={() => setDialogo(null)} aoPublicar={esquecer} />}
      {dialogo?.qual === "novo" && (
        <NovoDialogo
          duplicando={dialogo.duplicando}
          atual={def}
          site={site}
          bio={listas.bio?.modelos ?? []}
          aoFechar={() => setDialogo(null)}
          aoCriar={(id, t) => {
            setDialogo(null);
            recarregar(t);
            if (t !== tipo) mudarTipo(t);
            selecionar(id);
          }}
        />
      )}
      {dialogo?.qual === "lote" && <LoteDialogo def={def} ramos={ramosLote} aoFechar={() => setDialogo(null)} aoMudar={() => esquecer([])} />}
    </section>
  );
}
