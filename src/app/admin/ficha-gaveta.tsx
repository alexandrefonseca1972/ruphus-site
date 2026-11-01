"use client";

import { useEffect, useState } from "react";
import { formatBRL, formatPhone, linkWhatsApp } from "@/lib/datetime";
import { SUBS, type Sub } from "@/lib/gerador";
import { fichaDoNegocio } from "./actions";

// Aba "Ficha" da gaveta: tudo o que se sabe do negócio num lugar só, só para ler.
// Na dúvida, o vendedor confere a ficha do Maps, o Instagram e o que o site promete
// antes de mandar a primeira mensagem. Editar continua na aba "Site".

const LINK = "inline-flex h-11 items-center justify-center gap-2 rounded-[10px] border border-[#D8D2C6] bg-white px-4 text-[13px] font-semibold text-[#17150F] transition-colors hover:border-[#17150F]";

const ORIGEM = { "sem-site": "Conta sem site", cadastro: "Cadastrou sozinho", prospeccao: "Prospecção (planilha ou coleta)", fabrica: "Site feito à mão" } as const;

const dia = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : "");
const busca = (q: string) => `https://www.google.com/search?q=${encodeURIComponent(q)}`;

type Ficha = Extract<Awaited<ReturnType<typeof fichaDoNegocio>>, { ok: true }>["dados"];

export function FichaDoNegocio({ slug, token }: { slug: string; token: () => Promise<string> }) {
  const [ficha, setFicha] = useState<Ficha | null>(null);
  const [erro, setErro] = useState("");

  useEffect(() => {
    let atual = true;
    (async () => {
      const r = await fichaDoNegocio(await token(), slug).catch(() => null);
      if (!atual) return;
      if (!r?.ok) return setErro(r ? r.error : "Sem conexão.");
      setFicha(r.dados);
    })();
    return () => {
      atual = false;
    };
    // um negócio por montagem: a gaveta remonta com key={slug}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  if (erro) return <p role="alert" className="text-sm text-[#8A2F2F]">Não foi possível carregar a ficha: {erro}</p>;
  if (!ficha) return <p className="text-sm text-[#6F6A5E]">Carregando…</p>;

  const onde = [ficha.cidade, ficha.uf].filter(Boolean).join(" - ");
  const quem = `${ficha.name} ${onde}`.trim();
  // sem o link da coleta (sites antigos, planilhas sem a coluna), a busca pelo nome e endereço quase sempre cai na ficha certa
  const maps = ficha.maps || `https://www.google.com/maps/search/${encodeURIComponent(`${ficha.name} ${ficha.endereco || onde}`)}`;
  const zap = ficha.telefone && linkWhatsApp(ficha.telefone, "Olá!");
  const nota = ficha.google.nota != null ? `${String(ficha.google.nota).replace(".", ",")} ★` : "";

  const dados: [string, string][] = [
    ["Ramo", ficha.sub ? SUBS[ficha.sub as Sub]?.rotulo ?? ficha.sub : ""],
    ["Categoria no Maps", ficha.categoria],
    ["Nota no Google", nota && `${nota}${ficha.google.avaliacoes != null ? ` · ${ficha.google.avaliacoes} avaliações` : ""}`],
    ["Telefone (recepção)", ficha.telefone ? formatPhone(ficha.telefone) : ""],
    ["Endereço", ficha.endereco],
    ["Bairro", ficha.bairro],
    ["Cidade", onde],
    ["Horário", ficha.horario],
    ["Instagram", ficha.instagram && `@${ficha.instagram}`],
    ["Origem", ORIGEM[ficha.tipo]],
    ["Entrou em", dia(ficha.criadoEm)],
    ["Dados do site de", dia(ficha.atualizadoEm)],
    ["Site", ficha.publicado ? "Publicado (entrada paga)" : "Com faixa de proposta"],
    ["WhatsApp conectado", ficha.whatsapp ? `${ficha.whatsapp.status}${ficha.whatsapp.phone ? ` · ${formatPhone(ficha.whatsapp.phone)}` : ""}` : "Não"],
  ];

  return (
    <>
      <section aria-labelledby="ficha-links-t" className="flex flex-col gap-3 rounded-2xl border border-[#E2DDD3] p-4">
        <h3 id="ficha-links-t" className="text-[15px] font-semibold">Conferir antes do contato</h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <a href={maps} target="_blank" rel="noreferrer" className={LINK}>{ficha.maps ? "Ficha no Google Maps" : "Procurar no Google Maps"}</a>
          {ficha.instagram ? (
            <a href={`https://www.instagram.com/${ficha.instagram}/`} target="_blank" rel="noreferrer" className={LINK}>Instagram @{ficha.instagram}</a>
          ) : (
            <a href={busca(`${quem} site:instagram.com`)} target="_blank" rel="noreferrer" className={LINK}>Procurar Instagram</a>
          )}
          <a href={busca(`${quem} site:facebook.com`)} target="_blank" rel="noreferrer" className={LINK}>Procurar Facebook</a>
          <a href={busca(quem)} target="_blank" rel="noreferrer" className={LINK}>Buscar no Google</a>
          {ficha.url && <a href={ficha.url} target="_blank" rel="noreferrer" className={LINK}>Site na Ruphus</a>}
          {zap && <a href={zap} target="_blank" rel="noreferrer" className={LINK}>WhatsApp da recepção</a>}
        </div>
        {!ficha.maps && <p className="text-xs text-[#6F6A5E]">Sem o link da coleta: o Maps abre numa busca pelo nome. Confira se é o mesmo endereço.</p>}
      </section>

      <section aria-labelledby="ficha-dados-t" className="flex flex-col gap-3 rounded-2xl border border-[#E2DDD3] p-4">
        <h3 id="ficha-dados-t" className="text-[15px] font-semibold">Dados do negócio</h3>
        <dl className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
          {dados.map(([rotulo, valor]) => (
            <div key={rotulo} className="contents">
              <dt className="text-[#6F6A5E]">{rotulo}</dt>
              <dd className={`break-words ${valor ? "text-[#17150F]" : "text-[#A39E92]"}`}>{valor || "não informado"}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="ficha-servicos-t" className="flex flex-col gap-3 rounded-2xl border border-[#E2DDD3] p-4">
        <h3 id="ficha-servicos-t" className="text-[15px] font-semibold">Serviços no site · {ficha.servicos.length}</h3>
        {ficha.servicos.length ? (
          <ul className="flex flex-col divide-y divide-[#EFEBE3] text-sm">
            {ficha.servicos.map((s, i) => (
              <li key={i} className="flex justify-between gap-3 py-2">
                <span>{s.nome}</span>
                <span className="shrink-0 text-[#6F6A5E] tabular-nums">
                  {[s.precoCents ? formatBRL(s.precoCents) : "a combinar", s.minutos ? `${s.minutos} min` : ""].filter(Boolean).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-[#6F6A5E]">Nenhum serviço cadastrado.</p>
        )}
      </section>
    </>
  );
}
