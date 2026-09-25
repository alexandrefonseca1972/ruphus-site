"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CamposNegocio, errosDe, VAZIO, type Valores } from "@/components/campos-negocio";
import { formatPhone } from "@/lib/datetime";
import type { Mudanca, TipoSite } from "@/lib/negocios.server";
import { montarSite, siteDoNegocio } from "./actions";

// Aba "Site" da gaveta: montar ou completar o site de um negócio, sobretudo o de quem
// se cadastrou sozinho — esse sai só com nome, ramo, WhatsApp e cidade. Os campos são
// os do cadastro e do "Meu negócio", mais a nota do Google, que só o admin informa.
// Nada é gravado sem passar pela prévia do que muda.

const BOTAO = "inline-flex h-11 items-center justify-center gap-2 rounded-[10px] px-4 text-[13px] font-semibold transition-colors disabled:opacity-60";
const BOTAO_CLARO = `${BOTAO} border border-[#D8D2C6] bg-white text-[#17150F] hover:border-[#17150F]`;
const BOTAO_ESCURO = `${BOTAO} bg-[#17150F] text-white hover:bg-[#2E2B22]`;
const CAMPO = "h-12 bg-card px-3.5 text-base sm:h-11 sm:text-[15px]";

const TIPO: Record<TipoSite, { rotulo: string; cor: string; texto: string; acao: string }> = {
  "sem-site": {
    rotulo: "Sem site",
    cor: "bg-[#F1E7E7] text-[#8A2F2F]",
    texto: "Conta criada antes do site automático: o endereço ainda não abre nada. Escolha o ramo e o site sai no modelo dele, como o do cadastro.",
    acao: "Montar site",
  },
  cadastro: {
    rotulo: "Site do cadastro",
    cor: "bg-[#FBF3DC] text-[#7A5A2E]",
    texto: "Montado com o que o dono digitou. Complete bairro, endereço, horário e a nota do Google para ele ficar como os da prospecção.",
    acao: "Publicar mudanças",
  },
  prospeccao: {
    rotulo: "Site de prospecção",
    cor: "bg-[#F3EFE7] text-[#4A4639]",
    texto: "Gerado pela planilha, com a faixa de proposta. Corrigir aqui vale até a próxima planilha com o mesmo telefone, que regrava os dados dela.",
    acao: "Publicar mudanças",
  },
  fabrica: {
    rotulo: "Site da fábrica",
    cor: "bg-[#E7EEE9] text-[#2C6A53]",
    texto: "Feito à mão: a página é um arquivo e não muda por aqui. Os dados abaixo valem para a bio e o agendamento.",
    acao: "Salvar dados",
  },
};

type Dados = { name: string; tipo: TipoSite; publicado: boolean; google: { nota: number | null; avaliacoes: number | null } } & Valores;

export function SiteDoNegocio({ slug, token }: { slug: string; token: () => Promise<string> }) {
  const [dados, setDados] = useState<Dados | null>(null);
  const [erroCarga, setErroCarga] = useState("");
  const [nome, setNome] = useState("");
  const [campos, setCampos] = useState<Valores>(VAZIO);
  const [nota, setNota] = useState("");
  const [avaliacoes, setAvaliacoes] = useState("");
  const [tentou, setTentou] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  // a prévia é o passo entre editar e gravar: o que o servidor diz que vai mudar
  const [previa, setPrevia] = useState<Mudanca[] | null>(null);
  const [versao, setVersao] = useState(0);

  async function ler() {
    return siteDoNegocio(await token(), slug).catch(() => null);
  }
  function mostrar(r: Awaited<ReturnType<typeof ler>>) {
    if (!r?.ok) return setErroCarga(r ? r.error : "Sem conexão.");
    const { name, tipo, google, fabrica: _f, publicado, ...resto } = r.dados;
    setDados({ ...VAZIO, ...resto, name, tipo, google, publicado });
    setNome(name);
    setCampos({ ...VAZIO, ...resto, telefone: resto.telefone ? formatPhone(resto.telefone) : "" });
    setNota(google.nota == null ? "" : String(google.nota).replace(".", ","));
    setAvaliacoes(google.avaliacoes == null ? "" : String(google.avaliacoes));
  }

  useEffect(() => {
    let atual = true;
    (async () => {
      const r = await ler();
      if (atual) mostrar(r);
    })();
    return () => {
      atual = false;
    };
    // um negócio por montagem: a gaveta remonta com key={slug}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  if (erroCarga) return <p role="alert" className="text-sm text-[#8A2F2F]">Não foi possível carregar o site: {erroCarga}</p>;
  if (!dados) return <p className="text-sm text-[#6F6A5E]">Carregando…</p>;

  const tipo = TIPO[dados.tipo];
  const fabrica = dados.tipo === "fabrica";
  const erros = errosDe(campos);
  const erroNome = nome.trim().length < 2 ? "Informe o nome do negócio" : "";
  const notaN = nota.trim() ? Number(nota.replace(",", ".")) : null;
  const avaliacoesN = avaliacoes.trim() ? Number(avaliacoes.replace(/\D/g, "")) : null;
  const erroNota = notaN != null && !(notaN >= 0 && notaN <= 5) ? "De 0 a 5" : "";
  const google = { nota: notaN, avaliacoes: avaliacoesN };
  const pedido = () => ({ name: nome, ...campos });

  async function revisar() {
    setTentou(true);
    setAviso(null);
    if (erroNome || erroNota || Object.keys(erros).length) return;
    setBusy(true);
    const r = await montarSite(await token(), slug, pedido(), google, false).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setAviso({ ok: false, texto: r ? r.error : "Sem conexão. Tente de novo." });
    if (!r.dados.mudancas.length) return setAviso({ ok: true, texto: "Nada mudou: o site já está com esses dados." });
    setPrevia(r.dados.mudancas);
  }

  async function publicar() {
    setBusy(true);
    const r = await montarSite(await token(), slug, pedido(), google, true).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setAviso({ ok: false, texto: r ? r.error : "Sem conexão. Tente de novo." });
    setPrevia(null);
    setAviso({ ok: true, texto: fabrica ? "Dados salvos. A bio e o agendamento já mostram." : "Publicado. O site, a bio e a imagem do WhatsApp já mostram as mudanças." });
    setVersao((v) => v + 1);
    mostrar(await ler());
  }

  const site = `https://${slug}.ruphus.site`;
  const temSite = dados.tipo !== "sem-site";

  return (
    <div className="flex flex-col gap-5">
      <section aria-label="Situação do site" className="flex flex-col gap-3 rounded-2xl border border-[#E2DDD3] p-4">
        <div className="flex items-center gap-2">
          <h3 className="text-[11px] font-semibold tracking-[0.07em] text-[#6F6A5E] uppercase">Site</h3>
          <div className="grow" />
          <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${tipo.cor}`}>{tipo.rotulo}</span>
        </div>
        <p className="text-[13px] leading-relaxed text-[#4A4639]">{tipo.texto}</p>
        {temSite && !fabrica && (
          <p className={`rounded-[10px] px-3 py-2.5 text-xs ${dados.publicado ? "bg-[#E7EEE9] text-[#2C6A53]" : "bg-[#FBFAF8] text-[#4A4639]"}`}>
            {dados.publicado
              ? "Publicado: a entrada foi paga, o site está sem faixa e aberto ao Google."
              : "Proposta: com faixa e fora do Google até a entrada ser paga. A baixa da entrada, na aba Cobrança, publica o site."}
          </p>
        )}
        {temSite && !fabrica && (
          // o que aparece no WhatsApp quando alguém recebe o link: resume o site numa imagem
          // eslint-disable-next-line @next/next/no-img-element -- imagem gerada pela própria rota, 1200×630
          <img src={`/s/${slug}/og.jpg?v=${versao}`} alt={`Prévia do link do site de ${dados.name}`} width={1200} height={630} className="aspect-[1200/630] w-full rounded-lg border border-[#E2DDD3] object-cover" />
        )}
        {temSite && (
          <div className="flex flex-wrap gap-2">
            <a className={BOTAO_CLARO} href={site} target="_blank" rel="noreferrer">Ver o site ↗</a>
            <a className={BOTAO_CLARO} href={`${site}/bio`} target="_blank" rel="noreferrer">Bio ↗</a>
          </div>
        )}
      </section>

      {previa ? (
        <section aria-labelledby="previa-t" className="flex flex-col gap-3 rounded-2xl border border-[#17150F] p-4">
          <h3 id="previa-t" className="text-[15px] font-semibold">
            {dados.tipo === "sem-site" ? "O site vai sair assim" : `${previa.length} ${previa.length === 1 ? "mudança" : "mudanças"} para publicar`}
          </h3>
          <ul className="flex flex-col divide-y divide-[#EDE9E1] text-[13px]">
            {previa.map((m) => ({ ...m, ...(m.campo === "WhatsApp" && { antes: m.antes && formatPhone(m.antes), depois: formatPhone(m.depois) }) })).map((m) => (
              <li key={m.campo} className="grid grid-cols-[8.5rem_minmax(0,1fr)] gap-2 py-2">
                <span className="text-[#6F6A5E]">{m.campo}</span>
                <span className="min-w-0 break-words">
                  {m.antes && <s className="text-[#A8A294]">{m.antes}</s>}
                  {m.antes && " → "}
                  <b className="font-semibold">{m.depois || <i className="font-normal text-[#8A2F2F]">apagar</i>}</b>
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-[#6F6A5E]">
            {fabrica ? "A página da fábrica não muda." : "Publica na hora. Serviços, equipe e agenda do negócio não mudam."}
            {dados.tipo === "cadastro" && !dados.publicado && " O site continua como prévia até a entrada ser paga."}
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className={BOTAO_CLARO} disabled={busy} onClick={() => setPrevia(null)}>Voltar e editar</button>
            <button type="button" className={BOTAO_ESCURO} disabled={busy} onClick={publicar}>{busy ? "Publicando…" : tipo.acao}</button>
          </div>
        </section>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-4 rounded-2xl border border-[#E2DDD3] p-4"
          onSubmit={(e) => {
            e.preventDefault();
            revisar();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="negocio-nome">Nome do negócio</Label>
            <Input id="negocio-nome" value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} aria-invalid={tentou && !!erroNome} className={CAMPO} />
            <p aria-live="polite" className="min-h-4 text-xs text-destructive">{tentou ? erroNome : ""}</p>
          </div>
          <CamposNegocio valores={campos} onChange={setCampos} erros={tentou ? erros : {}} completo />

          {!fabrica && (
            <fieldset className="grid gap-3 rounded-xl bg-[#FBFAF8] p-3.5">
              <legend className="sr-only">Google</legend>
              <p className="text-xs text-[#6F6A5E]">Do Google Maps. Só o admin informa: aparecem no topo do site e na imagem do WhatsApp.</p>
              <div className="grid grid-cols-2 items-start gap-3">
                <div className="grid gap-1.5">
                  <Label htmlFor="google-nota">Nota</Label>
                  <Input id="google-nota" inputMode="decimal" placeholder="4,8" value={nota} onChange={(e) => setNota(e.target.value)} aria-invalid={!!erroNota} className={CAMPO} />
                  <p aria-live="polite" className="min-h-4 text-xs text-destructive">{erroNota}</p>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="google-avaliacoes">Avaliações</Label>
                  <Input id="google-avaliacoes" inputMode="numeric" placeholder="120" value={avaliacoes} onChange={(e) => setAvaliacoes(e.target.value)} className={CAMPO} />
                </div>
              </div>
            </fieldset>
          )}

          {aviso && (
            <p role={aviso.ok ? "status" : "alert"} className={`text-sm ${aviso.ok ? "text-[#2C6A53]" : "text-[#8A2F2F]"}`}>{aviso.texto}</p>
          )}
          <div className="flex justify-end">
            <button type="submit" className={BOTAO_ESCURO} disabled={busy}>{busy ? "Conferindo…" : "Revisar mudanças"}</button>
          </div>
        </form>
      )}
    </div>
  );
}
