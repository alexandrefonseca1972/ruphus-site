"use client";

import { useEffect, useState } from "react";
import { confirmar } from "@/components/confirmar";
import { idToken as tokenAtual } from "@/lib/firebase";
import type { Aviso } from "@/lib/modelos/checagem";
import { type DefModelo, LAYOUTS_BIO } from "@/lib/modelos/tipos";
import { NOMES_FONTE } from "@/lib/site-editorial";
import { historico, restaurar, type Uso as ContagemUso, usoDoModelo } from "../modelos-actions";
import { BIO_PRONTOS, BOTAO_CLARO, BOTAO_ESCURO, CAMPO, FOCO, fotoDoKit, type Item, n, type Negocios, Numero, ramoDe, ROTULO_GRUPO, ROTULO_LAYOUT, SERIFA } from "./util";

// A coluna da direita: Ajustes, Checar, Números, Uso e Histórico. Ajustes editam a cópia local
// (rascunho); ligar e padrão valem na hora, como no servidor.

export type Aba = "aj" | "chk" | "met" | "uso" | "his";
type Hist = Extract<Awaited<ReturnType<typeof historico>>, { ok: true }>["dados"];
export type Opcoes = { kits: string[]; paletas: DefModelo["paleta"][] };

const GRP = "grid gap-2.5 border-b border-[#E2DDD3] p-3.5";
const NOTA = "m-0 text-[12px] text-[#6F6A5E]";

function Chave({ ligado, rotulo, aoMudar, ocupado }: { ligado: boolean; rotulo: string; aoMudar: () => void; ocupado: boolean }) {
  return (
    <div className="flex min-h-11 items-center justify-between gap-2.5">
      <span className="font-semibold">{rotulo}</span>
      <button
        type="button"
        role="switch"
        aria-checked={ligado}
        aria-label={rotulo}
        disabled={ocupado}
        onClick={aoMudar}
        className={`relative h-[22px] w-[38px] flex-none rounded-full disabled:opacity-60 ${FOCO} ${ligado ? "bg-[#2C6A53]" : "bg-[#CFC9BD]"} after:absolute after:top-[3px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-[left] motion-reduce:after:transition-none ${ligado ? "after:left-[19px]" : "after:left-[3px]"}`}
      />
    </div>
  );
}

type Props = {
  item: Item;
  def: DefModelo;
  padrao: boolean;
  opcoes: Opcoes;
  avisos: Aviso[] | null;
  negocios: Negocios | null;
  editar: (mudanca: Partial<DefModelo>) => void;
  ligar: (ativo: boolean) => Promise<void>;
  definirPadrao: (on: boolean) => Promise<void>;
  aoDuplicar: () => void;
  aoLote: () => void;
  aoRestaurar: () => void;
  /** Antes de restaurar: o ajuste ainda por salvar deste modelo não pode cair por cima. */
  cancelarPendente: () => void;
  /** A aba aberta (a checagem só conta as fotos do ramo com a aba Checar aberta). */
  aoMudarAba: (aba: Aba) => void;
};

export function Inspetor({ item, def, padrao, opcoes, avisos, negocios, editar, ligar, definirPadrao, aoDuplicar, aoLote, aoRestaurar, cancelarPendente, aoMudarAba }: Props) {
  const [aba, setAba] = useState<Aba>("aj");
  const [ocupado, setOcupado] = useState(false);
  const alertas = avisos?.filter((a) => a.nivel !== "ok").length ?? 0;
  const ABAS: [Aba, string][] = [["aj", "Ajustes"], ["chk", alertas ? `Checar · ${alertas}` : "Checar"], ["met", "Números"], ["uso", "Uso"], ["his", "Histórico"]];
  const ocupar = (f: () => Promise<void>) => async () => {
    setOcupado(true);
    await f();
    setOcupado(false);
  };

  return (
    <>
      <div role="group" aria-label="Inspetor" className="sticky top-0 z-[1] flex border-b border-[#E2DDD3] bg-white">
        {ABAS.map(([k, r]) => (
          <button
            key={k}
            type="button"
            aria-pressed={aba === k}
            onClick={() => {
              setAba(k);
              aoMudarAba(k);
            }}
            className={`min-h-11 flex-1 border-b-2 px-1 py-3 text-[12.5px] font-semibold ${FOCO} ${aba === k ? "border-[#17150F] text-[#17150F]" : "border-transparent text-[#6F6A5E]"}`}
          >
            {r}
          </button>
        ))}
      </div>

      {aba === "aj" && (
        <>
          <div className={GRP}>
            {padrao && <span className="justify-self-start rounded-full bg-[#E7EEE9] px-2 py-0.5 text-[11px] font-semibold text-[#2C6A53]">★ Padrão de {ramoDe(def.sub)}</span>}
            <label className="grid gap-1.5 text-[12.5px] font-semibold">
              Nome
              <input type="text" value={def.nome} maxLength={60} onChange={(e) => editar({ nome: e.target.value })} className={CAMPO} aria-invalid={!def.nome.trim()} />
              {!def.nome.trim() && <span className="font-normal text-[#8A2F2F]">Dê um nome para salvar o rascunho.</span>}
            </label>
            <Chave rotulo="Ligado na gaveta dos negócios" ligado={item.ativo} ocupado={ocupado} aoMudar={ocupar(() => ligar(!item.ativo))} />
            <Chave rotulo="Padrão do ramo" ligado={padrao} ocupado={ocupado} aoMudar={ocupar(() => definirPadrao(!padrao))} />
            <p className={NOTA}>Ligar e padrão valem na hora. O padrão vale para prospecção sem escolha manual; clientes ativos não mudam.</p>
          </div>
          <div className={GRP}>
            <h4 className={`${ROTULO_GRUPO} m-0`}>Layout</h4>
            {def.tipo === "site" ? (
              <>
                <select aria-label="Layout" value={def.layout} disabled className={CAMPO}>
                  <option value={def.layout}>{ROTULO_LAYOUT[def.layout]}</option>
                </select>
                <p className={NOTA}>O ramo define a família do layout do site.</p>
              </>
            ) : (
              <select aria-label="Layout" value={def.layout} onChange={(e) => editar({ layout: e.target.value as DefModelo["layout"] })} className={CAMPO}>
                {LAYOUTS_BIO.map((l) => (
                  <option key={l} value={l} disabled={!BIO_PRONTOS.includes(l)}>
                    {ROTULO_LAYOUT[l]}
                    {BIO_PRONTOS.includes(l) ? "" : " (em breve)"}
                  </option>
                ))}
              </select>
            )}
            <label className="grid gap-1.5 text-[12.5px] font-semibold">
              Fonte
              <select value={def.fonte ?? ""} onChange={(e) => editar({ fonte: (e.target.value || undefined) as DefModelo["fonte"] })} className={CAMPO}>
                <option value="">Do modelo</option>
                {NOMES_FONTE.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className={GRP}>
            <h4 className={`${ROTULO_GRUPO} m-0`}>Fotos</h4>
            <p className={NOTA}>{def.tipo === "bio" ? "A foto do próprio negócio vale primeiro; o kit cobre quem não tem." : "Capa e galeria do site."}</p>
            <div className="grid max-h-[340px] grid-cols-3 gap-1.5 overflow-y-auto">
              {opcoes.kits.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={def.kit === k}
                  aria-label={`Kit ${k.split("/").pop()}`}
                  onClick={() => editar({ kit: k })}
                  className={`overflow-hidden rounded-[10px] border-2 p-0 ${FOCO} ${def.kit === k ? "border-[#17150F]" : "border-transparent"}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- foto estática do kit */}
                  <img src={fotoDoKit({ layout: def.layout, kit: k })} alt="" loading="lazy" className="block aspect-[3/4] w-full object-cover" />
                </button>
              ))}
            </div>
          </div>
          <div className={GRP}>
            <h4 className={`${ROTULO_GRUPO} m-0`}>Cor de destaque</h4>
            <div className="flex flex-wrap gap-1.5">
              {opcoes.paletas.map((p) => {
                const igual = JSON.stringify(p) === JSON.stringify(def.paleta);
                return (
                  <button
                    key={JSON.stringify(p)}
                    type="button"
                    aria-pressed={igual}
                    aria-label={`Cor ${p.acc}`}
                    onClick={() => editar({ paleta: p })}
                    className={`h-11 w-11 rounded-full border-[3px] border-white ${FOCO} ${igual ? "shadow-[0_0_0_2px_#17150F]" : "shadow-[0_0_0_1px_#E2DDD3]"}`}
                    style={{ background: def.layout === "claro" ? p.ink : p.acc }}
                  />
                );
              })}
            </div>
            {def.tipo === "bio" && <p className={NOTA}>Na bio, a cor vem do site de cada negócio; esta é a amostra do modelo.</p>}
          </div>
          <div className={GRP}>
            <button type="button" onClick={aoDuplicar} className={BOTAO_CLARO}>
              Duplicar modelo
            </button>
          </div>
        </>
      )}

      {aba === "chk" && (
        <div className={GRP}>
          <h4 className={`${ROTULO_GRUPO} m-0`}>Checagem automática</h4>
          <p className={NOTA}>Roda a cada alteração e antes de publicar.</p>
          {!avisos ? (
            <p className={NOTA}>Conferindo…</p>
          ) : (
            avisos.map((a, i) => (
              <div key={i} className="grid grid-cols-[22px_1fr] gap-2 border-t border-[#E2DDD3] py-2 text-[12.5px]">
                <i
                  aria-hidden="true"
                  className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold not-italic ${a.nivel === "ok" ? "bg-[#E7EEE9] text-[#2C6A53]" : a.nivel === "aviso" ? "bg-[#FFF1D6] text-[#8A5A12]" : "bg-[#F8E1DC] text-[#9B2C1C]"}`}
                >
                  {a.nivel === "ok" ? "✓" : a.nivel === "aviso" ? "!" : "×"}
                </i>
                <span>
                  <b>
                    <span className="sr-only">{a.nivel === "ok" ? "Ok: " : a.nivel === "aviso" ? "Aviso: " : "Erro: "}</span>
                    {a.titulo}
                  </b>
                  <small className="block text-[#6F6A5E]">{a.texto}</small>
                </span>
              </div>
            ))
          )}
        </div>
      )}

      {aba === "met" && (
        <div className={GRP}>
          <h4 className={`${ROTULO_GRUPO} m-0`}>Números</h4>
          <div className="rounded-xl border border-dashed border-[#E2DDD3] p-4 text-[13px] text-[#6F6A5E]">
            A medição começa na fase 9. Até lá, visitas e toques em Agendar e WhatsApp não são contados.
          </div>
        </div>
      )}

      {aba === "uso" && <Uso item={item} negocios={negocios} aoLote={aoLote} />}

      {aba === "his" && <Historico id={def.id} chave={`${item.versao}:${JSON.stringify(item.rascunho)}`} versao={item.versao} aoRestaurar={aoRestaurar} cancelarPendente={cancelarPendente} />}
    </>
  );
}

function Uso({ item, negocios, aoLote }: { item: Item; negocios: Negocios | null; aoLote: () => void }) {
  // contado ao abrir a aba (a lista do Estúdio não conta, para não ler o uso de todos os modelos)
  const [uso, setUso] = useState<{ chave: string; dados: ContagemUso } | null>(null);
  const [erro, setErro] = useState("");
  const chave = `${item.def.id}:${item.versao}`;
  useEffect(() => {
    let atual = true;
    tokenAtual()
      .then((tk) => usoDoModelo(tk, item.def.id))
      .then(
        (r) => atual && (r.ok ? (setUso({ chave, dados: r.dados }), setErro("")) : setErro(r.error)),
        () => atual && setErro("Não foi possível contar quem usa."),
      );
    return () => {
      atual = false;
    };
  }, [chave, item.def.id]);
  const u = uso?.chave === chave ? uso.dados : null;
  const prospeccao = u?.prospeccao ?? 0, clientes = u?.clientes ?? 0, legado = u?.legado ?? 0;
  const site = item.def.tipo === "site";
  return (
    <>
      <div className={GRP}>
        {erro && <p role="alert" className="m-0 text-[12.5px] text-[#8A2F2F]">{erro}</p>}
        <div className={`${SERIFA} text-[40px] leading-none`}>{u ? n(prospeccao + clientes) : "…"}</div>
        <span className="text-[#6F6A5E]">negócios apontam para este modelo</span>
        <div className="grid grid-cols-2 gap-2">
          <Numero valor={prospeccao} texto="em prospecção · seguem a versão no ar" />
          <Numero valor={clientes} texto="clientes ativos · versão congelada" />
        </div>
        {legado > 0 && <p className={NOTA}>Mais {n(legado)} pela escolha antiga da gaveta (a F7 converte).</p>}
        <button type="button" onClick={aoLote} disabled={!item.ativo} className={BOTAO_ESCURO}>
          Aplicar a mais negócios
        </button>
        {!item.ativo && <p className={NOTA}>Ligue o modelo para aplicar em lote.</p>}
      </div>
      <div className={GRP}>
        <h4 className={`${ROTULO_GRUPO} m-0`}>Quem usa</h4>
        {!negocios ? (
          <p className={NOTA}>Carregando…</p>
        ) : !negocios.usam.length ? (
          <p className={NOTA}>Ninguém aponta para este modelo ainda.</p>
        ) : (
          negocios.usam.map((u) => (
            <div key={u.slug} className="flex justify-between gap-2 border-t border-[#E2DDD3] py-2 text-[12.5px]">
              <span className="min-w-0">
                {u.nome}
                {u.cidade && ` · ${u.cidade}`}
                <small className="block text-[#6F6A5E]">{u.versao === null ? "prospecção · segue a versão no ar" : `cliente · congelado na versão ${u.versao}`}</small>
              </span>
              <a href={site ? `https://${u.slug}.ruphus.site/` : `/bio/${u.slug}`} target="_blank" rel="noreferrer" className={`self-center font-semibold whitespace-nowrap text-[#2F5BD3] ${FOCO}`}>
                Abrir
              </a>
            </div>
          ))
        )}
        {negocios?.usam.length === 20 && <p className={NOTA}>Mostrando os 20 primeiros.</p>}
      </div>
    </>
  );
}

function Historico({ id, chave, versao, aoRestaurar, cancelarPendente }: { id: string; chave: string; versao: number; aoRestaurar: () => void; cancelarPendente: () => void }) {
  const [hist, setHist] = useState<Hist | null>(null);
  const [erro, setErro] = useState("");
  useEffect(() => {
    let atual = true;
    tokenAtual()
      .then((tk) => historico(tk, id))
      .then(
        (r) => atual && (r.ok ? (setHist(r.dados), setErro("")) : setErro(r.error)),
        () => atual && setErro("Não foi possível ler o histórico."),
      );
    return () => {
      atual = false;
    };
  }, [id, chave]);

  async function voltar(v: number) {
    if (!(await confirmar({ titulo: `Restaurar a versão ${v}?`, texto: "Ela vira o rascunho deste modelo (o que estiver no rascunho agora se perde). Nada muda no ar até publicar.", acao: "Restaurar" }))) return;
    cancelarPendente();
    const r = await restaurar(await tokenAtual(), id, v).catch(() => null);
    if (!r?.ok) return setErro(r?.error ?? "Não foi possível restaurar.");
    aoRestaurar();
  }

  return (
    <div className={GRP}>
      <h4 className={`${ROTULO_GRUPO} m-0`}>Versões e alterações</h4>
      {erro && <p role="alert" className="m-0 text-[12.5px] text-[#8A2F2F]">{erro}</p>}
      {!hist && !erro && <p className={NOTA}>Carregando…</p>}
      {hist?.rascunho && <div className="border-t border-[#E2DDD3] py-2 text-[12.5px]">Rascunho aberto<small className="block text-[#6F6A5E]">ainda não publicado</small></div>}
      {hist?.versoes.map((v) => (
        <div key={v.n} className="border-t border-[#E2DDD3] py-2 text-[12.5px]">
          Versão {v.n}
          {v.n === versao && " · no ar"}
          {v.nota && ` · ${v.nota}`}
          <small className="block text-[#6F6A5E]">
            {v.publicadoEm ? new Date(v.publicadoEm).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "do código"}
            {v.por && ` · ${v.por}`}
            {v.n !== versao && (
              <>
                {" · "}
                <button type="button" onClick={() => voltar(v.n)} className={`cursor-pointer border-0 bg-transparent p-0 text-[12px] font-semibold text-[#2F5BD3] ${FOCO}`}>
                  Restaurar esta versão
                </button>
              </>
            )}
          </small>
        </div>
      ))}
    </div>
  );
}
