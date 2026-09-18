"use client";

import { onAuthStateChanged, signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { auth } from "@/lib/firebase";
import {
  detalhesEspaco,
  gerarConvite,
  listarAcessos,
  listarEspacos,
  resumoDoDia,
  revogarAcesso,
  type Acesso,
  type Detalhe,
  type Espaco,
} from "./actions";

const PAGINA = 40;
const CIDADES_VISIVEIS = 5;

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// relevância: a nota pesa, mas um 5,0 de três pessoas não passa na frente de um 4,7 de quinhentas
const relevancia = (e: Espaco) => (e.nota ?? 0) * Math.log10((e.avaliacoes ?? 0) + 1);
const local = (e: Espaco) => (e.cidade ? `${e.cidade}${e.uf ? `/${e.uf}` : ""}` : "");

function contar(espacos: Espaco[], campo: (e: Espaco) => string) {
  const m = new Map<string, number>();
  for (const e of espacos) {
    const v = campo(e);
    if (v) m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

async function token() {
  const user = auth.currentUser;
  if (!user) throw new Error("sem sessão");
  return user.getIdToken();
}

const CHIP = "h-9 rounded-full border px-3.5 text-[13px] transition-colors";
const CHIP_ON = `${CHIP} border-[#17150F] bg-[#17150F] font-semibold text-white`;
const CHIP_OFF = `${CHIP} border-[#D8D2C6] bg-white text-[#17150F] hover:border-[#17150F]`;
const CARTAO = "rounded-2xl border border-[#E2DDD3] bg-white";
const BOTAO = "inline-flex h-11 items-center justify-center rounded-[10px] px-4 text-sm font-semibold transition-colors";
const BOTAO_ESCURO = `${BOTAO} bg-[#17150F] text-white hover:bg-[#2C2920]`;
const BOTAO_CLARO = `${BOTAO} border border-[#D8D2C6] bg-white text-[#17150F] hover:border-[#17150F]`;

const CORES_NICHO: Record<string, string> = {
  "Pet shop": "bg-[#F0E6DE] text-[#8A4520]",
  Veterinária: "bg-[#EEF2F0] text-[#2C6A53]",
  "Estética e beleza": "bg-[#F5EBF0] text-[#8A3A63]",
  Cabeleireiro: "bg-[#F5EBF0] text-[#8A3A63]",
  Barbearia: "bg-[#F3EFE7] text-[#4A4639]",
};

function Chip({ ativo, children, ...props }: React.ComponentProps<"button"> & { ativo: boolean }) {
  return (
    <button type="button" className={ativo ? CHIP_ON : CHIP_OFF} {...props}>
      {children}
    </button>
  );
}

function Indicador({ rotulo, valor, nota, cor }: { rotulo: string; valor: string; nota: string; cor?: string }) {
  return (
    <div className={`${CARTAO} p-5`}>
      <div className="text-xs font-semibold uppercase tracking-[0.04em] text-[#6F6A5E]">{rotulo}</div>
      <div className="mt-1.5 font-[family-name:var(--fonte-serifa)] text-[40px] leading-none" style={{ color: cor }}>
        {valor}
      </div>
      <div className="mt-1 text-[13px] text-[#6F6A5E]">{nota}</div>
    </div>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const campoBusca = useRef<HTMLInputElement>(null);
  const [estado, setEstado] = useState<"carregando" | "negado" | "pronto">("carregando");
  const [email, setEmail] = useState("");
  const [espacos, setEspacos] = useState<Espaco[]>([]);
  const [hoje, setHoje] = useState<{ agendamentosHoje: number; espacosComAgenda: number } | null>(null);
  const [busca, setBusca] = useState("");
  const [cidade, setCidade] = useState("");
  const [nicho, setNicho] = useState("");
  const [situacao, setSituacao] = useState("");
  const [ordem, setOrdem] = useState("relevancia");
  const [todasCidades, setTodasCidades] = useState(false);
  const [pagina, setPagina] = useState({ chave: "", n: PAGINA });
  const [aberto, setAberto] = useState<Espaco | null>(null);
  const [acessos, setAcessos] = useState<Acesso[] | null>(null);
  const [detalhe, setDetalhe] = useState<Detalhe | null>(null);
  const [convite, setConvite] = useState<{ slug: string; url: string; copiado: boolean } | null>(null);
  const [idToken, setIdToken] = useState("");
  const [copiado, setCopiado] = useState("");
  const [aviso, setAviso] = useState("");

  useEffect(
    () =>
      onAuthStateChanged(auth, async (user) => {
        if (!user) return router.replace(`/login?next=${encodeURIComponent("/admin")}`);
        setEmail(user.email ?? "");
        const idToken = await user.getIdToken();
        setIdToken(idToken);
        const [lista, dia] = await Promise.all([listarEspacos(idToken), resumoDoDia(idToken)]);
        if (!lista.ok) return setEstado("negado");
        setEspacos(lista.dados);
        if (dia.ok) setHoje(dia.dados);
        setEstado("pronto");
      }),
    [router],
  );

  // "/" põe o cursor na busca, como em toda lista que se usa o dia inteiro
  useEffect(() => {
    const atalho = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (e.key !== "/" || alvo?.tagName === "INPUT" || alvo?.tagName === "TEXTAREA") return;
      e.preventDefault();
      campoBusca.current?.focus();
    };
    addEventListener("keydown", atalho);
    return () => removeEventListener("keydown", atalho);
  }, []);

  const cidades = useMemo(() => contar(espacos, local), [espacos]);
  const nichos = useMemo(() => contar(espacos, (e) => e.nicho), [espacos]);

  const lista = useMemo(() => {
    const termo = semAcento(busca.trim());
    const filtrada = espacos.filter((e) => {
      if (cidade && local(e) !== cidade) return false;
      if (nicho && e.nicho !== nicho) return false;
      if (situacao === "ativo" && e.acessos <= 1) return false;
      if (situacao === "pendente" && e.acessos > 1) return false;
      if (!termo) return true;
      return semAcento(`${e.nome} ${e.slug} ${e.cidade ?? ""} ${e.telefone ?? ""}`).includes(termo);
    });
    const por: Record<string, (a: Espaco, b: Espaco) => number> = {
      relevancia: (a, b) => relevancia(b) - relevancia(a) || a.nome.localeCompare(b.nome, "pt-BR"),
      nota: (a, b) => (b.nota ?? 0) - (a.nota ?? 0) || (b.avaliacoes ?? 0) - (a.avaliacoes ?? 0),
      avaliacoes: (a, b) => (b.avaliacoes ?? 0) - (a.avaliacoes ?? 0),
      nome: (a, b) => a.nome.localeCompare(b.nome, "pt-BR"),
    };
    return [...filtrada].sort(por[ordem]);
  }, [espacos, busca, cidade, nicho, situacao, ordem]);

  async function abrir(e: Espaco) {
    setAberto(e);
    setAcessos(null);
    setDetalhe(null);
    setAviso("");
    const t = await token();
    const [a, d] = await Promise.all([listarAcessos(t, e.slug), detalhesEspaco(t, e.slug)]);
    if (a.ok) setAcessos(a.dados);
    if (d.ok) setDetalhe(d.dados);
  }

  async function convidar(slug: string) {
    setAviso("");
    const r = await gerarConvite(await token(), slug);
    if (!r.ok) return setAviso(r.error);
    const copiado = await navigator.clipboard.writeText(r.dados).then(
      () => true,
      () => false,
    );
    setConvite({ slug, url: r.dados, copiado });
  }

  async function revogar(slug: string, uid: string) {
    const r = await revogarAcesso(await token(), slug, uid);
    setAviso(r.ok ? r.dados : r.error);
    if (!r.ok) return;
    setAcessos((a) => a?.filter((x) => x.uid !== uid) ?? null);
    setEspacos((e) => e.map((x) => (x.slug === slug ? { ...x, acessos: x.acessos - 1 } : x)));
    setAberto((x) => (x && x.slug === slug ? { ...x, acessos: x.acessos - 1 } : x));
  }

  async function copiar(texto: string, marca: string) {
    const ok = await navigator.clipboard.writeText(texto).then(() => true, () => false);
    setCopiado(ok ? marca : "");
    setAviso(ok ? "" : "O navegador não deixou copiar. Selecione o texto e copie à mão.");
  }

  function exportarCSV() {
    const linhas = [
      ["nome", "endereco", "cidade", "uf", "nicho", "nota", "avaliacoes", "situacao", "telefone"],
      ...lista.map((e) => [
        e.nome, e.slug, e.cidade ?? "", e.uf ?? "", e.nicho,
        e.nota ?? "", e.avaliacoes ?? "",
        e.acessos > 1 ? "cliente ativo" : "convite pendente", e.telefone ?? "",
      ]),
    ];
    const csv = linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `espacos-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (estado === "carregando") return <main className="p-10 text-sm text-[#6F6A5E]">Carregando…</main>;
  if (estado === "negado")
    return (
      <main className="mx-auto max-w-md p-10">
        <div className={`${CARTAO} p-6`}>
          <h1 className="font-[family-name:var(--fonte-serifa)] text-2xl">Área restrita</h1>
          <p className="mt-2 text-sm text-[#6F6A5E]">
            {email ? `${email} não administra a plataforma.` : "Esta conta não administra a plataforma."}
          </p>
          <button className={`${BOTAO_CLARO} mt-5`} onClick={() => signOut(auth).then(() => router.replace("/login"))}>
            Entrar com outra conta
          </button>
        </div>
      </main>
    );

  const chave = [busca, cidade, nicho, situacao, ordem].join("|");
  const quantos = pagina.chave === chave ? pagina.n : PAGINA;
  const ativos = espacos.filter((e) => e.acessos > 1).length;
  const filtrando = busca || cidade || nicho || situacao;

  return (
    <>
      <header className="flex flex-wrap items-center gap-4 border-b border-[#E2DDD3] bg-white px-4 py-4 sm:px-10">
        <h1 className="font-[family-name:var(--fonte-serifa)] text-2xl tracking-tight">Administração</h1>
        <span className="text-[13px] text-[#6F6A5E]">ruphus.site</span>
        <div className="grow" />
        <span className="hidden text-sm text-[#6F6A5E] sm:inline">{email}</span>
        <button className={BOTAO_CLARO} onClick={() => signOut(auth).then(() => router.replace("/login"))}>
          Sair
        </button>
      </header>

      <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-5 p-4 sm:p-8">
        <section aria-label="Resumo" className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Indicador rotulo="Espaços" valor={String(espacos.length)} nota="com site no ar" />
          <Indicador rotulo="Cliente ativo" valor={String(ativos)} nota="entrou no painel" cor="#2C6A53" />
          <Indicador
            rotulo="Convite pendente"
            valor={String(espacos.length - ativos)}
            nota="ninguém do negócio entrou"
            cor="#A8502B"
          />
          <Indicador
            rotulo="Agendamentos hoje"
            valor={hoje ? String(hoje.agendamentosHoje) : "—"}
            nota={hoje ? `em ${hoje.espacosComAgenda} espaço(s)` : "carregando"}
          />
        </section>

        <section aria-label="Filtros" className={`${CARTAO} flex flex-col gap-3.5 p-4 sm:p-5`}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex h-12 grow items-center gap-2.5 rounded-[10px] border border-[#D8D2C6] bg-[#FBFAF8] px-3.5 focus-within:border-[#17150F]">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="#6F6A5E" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" />
                <path d="M20 20l-3.2-3.2" />
              </svg>
              <label htmlFor="busca" className="sr-only">Buscar espaço</label>
              <input
                id="busca"
                ref={campoBusca}
                type="search"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Nome, endereço, cidade ou telefone"
                className="grow bg-transparent text-[15px] outline-none placeholder:text-[#8B8578]"
              />
              <kbd className="hidden rounded-md border border-[#D8D2C6] bg-white px-1.5 py-0.5 text-xs text-[#6F6A5E] sm:block">/</kbd>
            </div>
            <label htmlFor="ordem" className="text-[13px] text-[#6F6A5E]">Ordenar</label>
            <select
              id="ordem"
              value={ordem}
              onChange={(e) => setOrdem(e.target.value)}
              className="h-12 rounded-[10px] border border-[#D8D2C6] bg-white px-3 text-sm"
            >
              <option value="relevancia">Mais relevantes</option>
              <option value="nota">Melhor nota</option>
              <option value="avaliacoes">Mais avaliações</option>
              <option value="nome">Nome (A–Z)</option>
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-semibold uppercase tracking-[0.04em] text-[#6F6A5E]">Cidade</span>
            <Chip ativo={!cidade} onClick={() => setCidade("")}>Todas</Chip>
            {(todasCidades ? cidades : cidades.slice(0, CIDADES_VISIVEIS)).map(([c, n]) => (
              <Chip key={c} ativo={cidade === c} onClick={() => setCidade(cidade === c ? "" : c)}>
                {c.split("/")[0]} <span className={cidade === c ? "text-white/70" : "text-[#6F6A5E]"}>{n}</span>
              </Chip>
            ))}
            {cidades.length > CIDADES_VISIVEIS && (
              <button
                type="button"
                onClick={() => setTodasCidades((v) => !v)}
                className={`${CHIP} border-dashed border-[#C8C1B3] bg-transparent text-[#4A4639]`}
              >
                {todasCidades ? "menos cidades" : `mais ${cidades.length - CIDADES_VISIVEIS} cidades`}
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-semibold uppercase tracking-[0.04em] text-[#6F6A5E]">Nicho</span>
            <Chip ativo={!nicho} onClick={() => setNicho("")}>Todos</Chip>
            {nichos.map(([v, n]) => (
              <Chip key={v} ativo={nicho === v} onClick={() => setNicho(nicho === v ? "" : v)}>
                {v} <span className={nicho === v ? "text-white/70" : "text-[#6F6A5E]"}>{n}</span>
              </Chip>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="mr-1 text-xs font-semibold uppercase tracking-[0.04em] text-[#6F6A5E]">Situação</span>
            <div className="flex overflow-hidden rounded-full border border-[#D8D2C6] bg-white">
              {([["", "Todas"], ["pendente", "Convite pendente"], ["ativo", "Cliente ativo"]] as const).map(([v, r]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setSituacao(v)}
                  className={`h-9 px-3.5 text-[13px] ${situacao === v ? "bg-[#17150F] font-semibold text-white" : "text-[#17150F] hover:bg-[#F4F2EE]"}`}
                >
                  {r}
                </button>
              ))}
            </div>
            {filtrando && (
              <button
                type="button"
                onClick={() => {
                  setBusca("");
                  setCidade("");
                  setNicho("");
                  setSituacao("");
                }}
                className="h-9 px-2 text-[13px] text-[#6F6A5E] underline underline-offset-4 hover:text-[#17150F]"
              >
                Limpar filtros
              </button>
            )}
          </div>
        </section>

        {aviso && <p className="text-sm text-[#6F6A5E]">{aviso}</p>}

        <section aria-label="Espaços" className={`${CARTAO} overflow-hidden`}>
          <div className="flex flex-wrap items-center gap-3 border-b border-[#EDE9E1] px-4 py-3.5 sm:px-5">
            <span className="text-sm font-semibold">{lista.length} espaço(s)</span>
            {ordem === "relevancia" && (
              <span className="hidden text-sm text-[#6F6A5E] lg:inline">
                ordenados por relevância — nota do Google ponderada pelas avaliações
              </span>
            )}
            <div className="grow" />
            <button
              type="button"
              onClick={exportarCSV}
              className="h-9 rounded-lg border border-[#D8D2C6] px-3.5 text-[13px] font-semibold hover:border-[#17150F]"
            >
              Exportar CSV
            </button>
          </div>

          <ul>
            {lista.slice(0, quantos).map((e) => {
              const ativo = e.acessos > 1;
              return (
                <li
                  key={e.slug}
                  className="flex flex-col gap-3 border-b border-[#F1EDE6] px-4 py-3.5 last:border-0 sm:px-5 lg:flex-row lg:items-center lg:gap-4"
                >
                  <div className="flex min-w-0 items-start gap-3 lg:w-[330px]">
                    <div
                      aria-hidden="true"
                      className={`flex size-11 shrink-0 items-center justify-center rounded-[10px] font-[family-name:var(--fonte-serifa)] text-xl ${ativo ? "bg-[#E7EEE9] text-[#2C6A53]" : "bg-[#F0E6DE] text-[#8A4520]"}`}
                    >
                      {e.nome.slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-[14px] font-semibold">{e.nome}</p>
                      <p className="truncate text-[13px] text-[#6F6A5E]">{e.slug}</p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-[13px] text-[#4A4639] lg:contents">
                    <span className="lg:w-[160px]">{local(e) || "cidade não identificada"}</span>
                    <span className="lg:w-[160px]">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${CORES_NICHO[e.nicho] ?? "bg-[#F3EFE7] text-[#4A4639]"}`}>
                        {e.nicho}
                      </span>
                    </span>
                    <span className="lg:w-[140px]">
                      {e.nota
                        ? `★ ${e.nota.toFixed(1).replace(".", ",")}${e.avaliacoes ? ` · ${e.avaliacoes.toLocaleString("pt-BR")}` : ""}`
                        : "sem nota"}
                    </span>
                    <span className="lg:w-[150px]">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${ativo ? "bg-[#E7EEE9] text-[#2C6A53]" : "bg-[#FBEDE6] text-[#A8502B]"}`}>
                        {ativo ? `Cliente ativo · ${e.acessos - 1}` : "Convite pendente"}
                      </span>
                    </span>
                  </div>

                  <div className="flex grow justify-end gap-2">
                    {!ativo && (
                      <button type="button" className={BOTAO_ESCURO} onClick={() => convidar(e.slug)}>
                        {convite?.slug === e.slug ? (convite.copiado ? "Copiado ✓" : "Link gerado") : "Convidar"}
                      </button>
                    )}
                    <button type="button" className={BOTAO_CLARO} onClick={() => abrir(e)}>
                      Abrir
                    </button>
                  </div>
                </li>
              );
            })}
            {!lista.length && (
              <li className="px-5 py-10 text-center text-sm text-[#6F6A5E]">Nenhum espaço com esses filtros.</li>
            )}
          </ul>

          {lista.length > quantos && (
            <div className="flex items-center gap-3 border-t border-[#EDE9E1] px-4 py-3.5 sm:px-5">
              <button type="button" className={BOTAO_CLARO} onClick={() => setPagina({ chave, n: quantos + PAGINA })}>
                Mostrar mais {Math.min(PAGINA, lista.length - quantos)}
              </button>
              <span className="text-[13px] text-[#6F6A5E]">
                mostrando {quantos} de {lista.length}
              </span>
            </div>
          )}
        </section>
      </main>

      {aberto && (
        <>
          <button type="button" aria-label="Fechar painel" onClick={() => setAberto(null)} className="fixed inset-0 z-40 bg-[#17150F]/25" />
          <aside
            aria-label={aberto.nome}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[520px] flex-col gap-5 overflow-y-auto border-l border-[#E2DDD3] bg-white p-6 sm:p-8"
          >
            <div className="flex items-start gap-3.5">
              <div
                aria-hidden="true"
                className={`flex size-12 shrink-0 items-center justify-center rounded-xl font-[family-name:var(--fonte-serifa)] text-2xl ${aberto.acessos > 1 ? "bg-[#E7EEE9] text-[#2C6A53]" : "bg-[#F0E6DE] text-[#8A4520]"}`}
              >
                {aberto.nome.slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 grow">
                <h2 className="font-[family-name:var(--fonte-serifa)] text-[28px] leading-tight tracking-tight">{aberto.nome}</h2>
                <p className="mt-1 truncate text-[13px] text-[#6F6A5E]">
                  {aberto.slug}.ruphus.site{local(aberto) ? ` · ${local(aberto)}` : ""} · {aberto.nicho}
                </p>
              </div>
              <button type="button" aria-label="Fechar" onClick={() => setAberto(null)} className={`${BOTAO_CLARO} size-11 shrink-0 px-0`}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-[#E2DDD3] p-3.5">
                <div className="text-xs text-[#6F6A5E]">Nota</div>
                <div className="mt-0.5 text-xl font-semibold">
                  {aberto.nota ? `★ ${aberto.nota.toFixed(1).replace(".", ",")}` : "—"}
                </div>
                <div className="text-xs text-[#6F6A5E]">
                  {aberto.avaliacoes ? `${aberto.avaliacoes.toLocaleString("pt-BR")} avaliações` : "sem avaliações"}
                </div>
              </div>
              <div className="rounded-xl border border-[#E2DDD3] p-3.5">
                <div className="text-xs text-[#6F6A5E]">Serviços</div>
                <div className="mt-0.5 text-xl font-semibold">{detalhe ? detalhe.servicos : "…"}</div>
                <div className="text-xs text-[#6F6A5E]">{detalhe ? `${detalhe.profissionais} profissional(is)` : ""}</div>
              </div>
              <div className="rounded-xl border border-[#E2DDD3] p-3.5">
                <div className="text-xs text-[#6F6A5E]">Agendamentos</div>
                <div className="mt-0.5 text-xl font-semibold">{detalhe ? detalhe.agendamentos30d : "…"}</div>
                <div className="text-xs text-[#6F6A5E]">nos últimos 30 dias</div>
              </div>
            </div>

            <section aria-label="Convite" className="flex flex-col gap-3 rounded-2xl border border-[#E2DDD3] bg-[#FBFAF8] p-5">
              <div className="flex items-center gap-2.5">
                <h3 className="text-[15px] font-semibold">Convite do dono</h3>
                <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${aberto.acessos > 1 ? "bg-[#E7EEE9] text-[#2C6A53]" : "bg-[#FBEDE6] text-[#A8502B]"}`}>
                  {aberto.acessos > 1 ? "aceito" : "pendente"}
                </span>
              </div>
              <p className="text-[13px] leading-relaxed text-[#4A4639]">
                Quem abrir o link entra com a conta dele e vira admin deste espaço. O link vale 30 dias.
              </p>
              {convite?.slug === aberto.slug ? (
                <div className="flex flex-col gap-2">
                  <code className="truncate rounded-lg border border-[#E2DDD3] bg-white px-3 py-2.5 text-xs text-[#4A4639]">
                    {convite.url}
                  </code>
                  <div className="flex gap-2">
                    <button type="button" className={BOTAO_ESCURO} onClick={() => convidar(aberto.slug)}>
                      {convite.copiado ? "Copiado ✓" : "Copiar de novo"}
                    </button>
                    {detalhe?.telefone && (
                      <a
                        className={`${BOTAO} border border-[#2C6A53] bg-white text-[#2C6A53] hover:bg-[#EEF2F0]`}
                        href={`https://wa.me/${detalhe.telefone}?text=${encodeURIComponent(
                          `Olá! Este é o acesso ao painel do ${aberto.nome}: ${convite.url}`,
                        )}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Enviar no WhatsApp
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <button type="button" className={`${BOTAO_ESCURO} self-start`} onClick={() => convidar(aberto.slug)}>
                  Gerar link de convite
                </button>
              )}
            </section>

            <section aria-label="Divulgação" className="flex flex-col gap-3 rounded-2xl border border-[#E2DDD3] p-4">
              <h3 className="text-[15px] font-semibold">Divulgar o site</h3>
              <div className="flex gap-3">
                <a
                  href={`https://${aberto.slug}.ruphus.site/`}
                  target="_blank"
                  rel="noreferrer"
                  className="w-1/2 overflow-hidden rounded-xl border border-[#E2DDD3] bg-[#F4F2EE]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- miniatura já gerada do site */}
                  <img src={`/s/_t/${aberto.slug}.webp`} alt={`Miniatura do site de ${aberto.nome}`} className="w-full" />
                </a>
                {/* eslint-disable-next-line @next/next/no-img-element -- QR em SVG gerado pela própria rota */}
                <img
                  src={`/admin/qr?url=${encodeURIComponent(`https://${aberto.slug}.ruphus.site/`)}&t=${encodeURIComponent(idToken)}`}
                  alt={`QR code do site de ${aberto.nome}`}
                  className="size-[132px] shrink-0 rounded-xl border border-[#E2DDD3] bg-white p-1.5"
                />
              </div>

              {([
                ["Site", `https://${aberto.slug}.ruphus.site/`],
                ["Minisite do Instagram", `https://${aberto.slug}.ruphus.site/bio`],
                ["Agendamento", `https://${aberto.slug}.ruphus.site/agendar`],
              ] as const).map(([rotulo, url]) => (
                <div key={rotulo} className="flex items-center gap-2">
                  <div className="min-w-0 grow">
                    <p className="text-xs text-[#6F6A5E]">{rotulo}</p>
                    <p className="truncate text-[13px]">{url}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => copiar(url, rotulo)}
                    className="h-11 shrink-0 rounded-[10px] border border-[#D8D2C6] px-3.5 text-[13px] font-semibold hover:border-[#17150F]"
                  >
                    {copiado === rotulo ? "Copiado ✓" : "Copiar"}
                  </button>
                </div>
              ))}

              {detalhe?.telefone && (
                <a
                  className={`${BOTAO} border border-[#2C6A53] bg-white text-[#2C6A53] hover:bg-[#EEF2F0]`}
                  href={`https://wa.me/${detalhe.telefone}?text=${encodeURIComponent(
                    `Olá! Fizemos o site do ${aberto.nome}: https://${aberto.slug}.ruphus.site/\n\n` +
                      `Para o link da bio no Instagram: https://${aberto.slug}.ruphus.site/bio\n` +
                      `E os clientes já podem agendar online: https://${aberto.slug}.ruphus.site/agendar`,
                  )}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Enviar tudo pelo WhatsApp
                </a>
              )}
            </section>

            <section aria-label="Quem tem acesso" className="flex flex-col gap-2.5">
              <div className="flex items-baseline gap-2">
                <h3 className="text-[15px] font-semibold">Quem tem acesso</h3>
                <span className="text-[13px] text-[#6F6A5E]">{acessos ? `${acessos.length} pessoa(s)` : "carregando…"}</span>
              </div>
              <ul className="flex flex-col gap-2">
                {acessos?.map((a) => (
                  <li key={a.uid} className="flex items-center gap-3 rounded-xl border border-[#E2DDD3] p-3.5">
                    <div className="min-w-0 grow">
                      <p className="text-sm font-medium">{a.papel === "owner" ? "Dono do espaço" : "Admin do negócio"}</p>
                      <p className="truncate text-xs text-[#6F6A5E]">
                        {a.uid}
                        {a.desde ? ` · desde ${new Date(a.desde).toLocaleDateString("pt-BR")}` : ""}
                      </p>
                    </div>
                    {a.papel === "owner" ? (
                      <span className="shrink-0 text-xs text-[#6F6A5E]">não removível</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => revogar(aberto.slug, a.uid)}
                        className="h-11 shrink-0 rounded-[10px] border border-[#D8D2C6] px-3.5 text-[13px] font-semibold text-[#8A2F2F] hover:border-[#8A2F2F]"
                      >
                        Remover
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <section aria-label="Atalhos" className="flex flex-col gap-2.5">
              <h3 className="text-[15px] font-semibold">Atalhos</h3>
              <div className="grid grid-cols-2 gap-2.5">
                <a className={`${BOTAO_CLARO} justify-start`} href={`/${aberto.slug}`}>
                  Painel do negócio
                </a>
                <a className={`${BOTAO_CLARO} justify-start`} href={`https://${aberto.slug}.ruphus.site/`} target="_blank" rel="noreferrer">
                  Ver o site ↗
                </a>
                <a className={`${BOTAO_CLARO} justify-start`} href={`https://${aberto.slug}.ruphus.site/agendar`} target="_blank" rel="noreferrer">
                  Agendamento ↗
                </a>
                {detalhe?.telefone && (
                  <a className={`${BOTAO_CLARO} justify-start`} href={`https://wa.me/${detalhe.telefone}`} target="_blank" rel="noreferrer">
                    Falar com o dono ↗
                  </a>
                )}
              </div>
            </section>
          </aside>
        </>
      )}
    </>
  );
}
