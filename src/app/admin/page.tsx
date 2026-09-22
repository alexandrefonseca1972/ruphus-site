"use client";

import { onAuthStateChanged, signOut } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { auth } from "@/lib/firebase";
import { formatBRL } from "@/lib/datetime";
import {
  anotarNegocio,
  detalhesEspaco,
  gerarConvite,
  listarAcessos,
  listarCrm,
  gerarConvites,
  listarEspacos,
  linhaDoTempoDo,
  registrarEnvio,
  marcarEstagio,
  resumoDoDia,
  salvarNegocio,
  revogarAcesso,
  liberarNegocios,
  type Acesso,
  type Detalhe,
  type Espaco,
} from "./actions";
import { Atrasadas, Cobrancas } from "./cobranca";
import { ContatoDono, LinhaDoTempo, MensagensProntas, MotivoDaPerda, OrigemDoContato } from "./crm-gaveta";
import { Funil } from "./funil";
import { COR, DESFECHOS, diaCurto, ESTAGIOS, ETAPAS, hojeISO, prazoDe, PRECO_PADRAO, ROTULO, type Crm, type Estagio, type Evento, type Prazo } from "@/lib/crm-tipos";

const PAGINA = 40;
const VAZIO: Crm = {
  estagio: "novo", entradaCents: null, mensalCents: null, fechadoEm: null, proximaAcao: null, proximaData: null, publicado: true, notas: 0,
  donoNome: null, donoPapel: null, donoWhatsapp: null, donoEmail: null, motivoPerda: null, detalhePerda: null,
  origem: null, indicadoPor: null, entrouEm: null, perdidoEm: null,
};
const CIDADES_VISIVEIS = 5;

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// relevância: a nota pesa, mas um 5,0 de três pessoas não passa na frente de um 4,7 de quinhentas
const relevancia = (e: Espaco) => (e.nota ?? 0) * Math.log10((e.avaliacoes ?? 0) + 1);
const local = (e: Espaco) => (e.cidade ? `${e.cidade}${e.uf ? `/${e.uf}` : ""}` : "");

// As visões são combinações de filtro que se repetem todo dia. Viram aba para
// ninguém ter de remontá-las de manhã — e cada uma é só um preset dos mesmos
// filtros, não um caminho paralelo.
type Visao = { id: string; rotulo: string; urgente?: boolean; separa?: boolean; prazo: "" | Prazo; situacao: string; estagio: string; fora: boolean };
const VISOES: Visao[] = [
  { id: "atrasados", rotulo: "Atrasados", urgente: true, prazo: "atrasada", situacao: "", estagio: "", fora: false },
  { id: "hoje", rotulo: "Para hoje", prazo: "hoje", situacao: "", estagio: "", fora: false },
  { id: "todos", rotulo: "Todos", separa: true, prazo: "", situacao: "", estagio: "", fora: false },
  { id: "pendentes", rotulo: "Sem cliente dentro", prazo: "", situacao: "pendente", estagio: "", fora: false },
  { id: "negociando", rotulo: "Em negociação", prazo: "", situacao: "", estagio: "negociando", fora: false },
  { id: "foradoar", rotulo: "Fora do ar", prazo: "", situacao: "", estagio: "", fora: true },
];

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
const CHIP_MORTO = `${CHIP} cursor-not-allowed border-dashed border-[#E2DDD3] bg-transparent text-[#A8A294]`;
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
    <button
      type="button"
      className={ativo ? CHIP_ON : props.disabled ? CHIP_MORTO : CHIP_OFF}
      {...props}
    >
      {children}
    </button>
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
  const [crm, setCrm] = useState<Record<string, Crm>>({});
  const [eventos, setEventos] = useState<Evento[] | null>(null);
  // qual negócio está sendo marcado como perdido (pela gaveta ou soltando no funil)
  const [perdendo, setPerdendo] = useState<string | null>(null);
  const [tela, setTela] = useState<"lista" | "funil">("lista");
  // A aba escolhida vale para o próximo negócio aberto: quem está cobrando segue cobrando
  const [aba, setAba] = useState<"venda" | "historico" | "cliente" | "cobranca">("venda");
  const [estagio, setEstagio] = useState("");
  const [prazo, setPrazo] = useState<"" | Prazo>("");
  const [foraDoAr, setForaDoAr] = useState(false);
  const [menuFiltros, setMenuFiltros] = useState(false);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  // fixo por render: se viesse de Date.now() a cada chamada, um espaço podia cair
  // em "hoje" na contagem e em "atrasada" na lista, na virada da meia-noite
  const dataDeHoje = hojeISO();

  useEffect(
    () =>
      onAuthStateChanged(auth, async (user) => {
        if (!user) return router.replace(`/login?next=${encodeURIComponent("/admin")}`);
        setEmail(user.email ?? "");
        const idToken = await user.getIdToken();
        setIdToken(idToken);
        const [lista, dia, negocios] = await Promise.all([
          listarEspacos(idToken),
          resumoDoDia(idToken),
          listarCrm(idToken),
        ]);
        if (!lista.ok) return setEstado("negado");
        setEspacos(lista.dados);
        if (dia.ok) setHoje(dia.dados);
        if (negocios.ok) setCrm(negocios.dados);
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

  // Cada filtro isolado, para a contagem de um chip poder ignorar a própria
  // dimensão: o número ao lado de "Barbearia" diz quantas barbearias sobram
  // com os OUTROS filtros ligados. Somando tudo, um chip prometia 115 e
  // entregava lista vazia, porque contava o banco inteiro.
  const passa = useMemo(() => {
    const termo = semAcento(busca.trim());
    const testes: Record<string, (e: Espaco) => boolean> = {
      busca: (e) => !termo || semAcento(`${e.nome} ${e.slug} ${e.cidade ?? ""} ${e.telefone ?? ""}`).includes(termo),
      cidade: (e) => !cidade || local(e) === cidade,
      nicho: (e) => !nicho || e.nicho === nicho,
      situacao: (e) => !situacao || (situacao === "ativo" ? e.acessos > 1 : e.acessos <= 1),
      estagio: (e) => !estagio || (crm[e.slug]?.estagio ?? "novo") === estagio,
      prazo: (e) => !prazo || prazoDe(crm[e.slug], dataDeHoje) === prazo,
      fora: (e) => !foraDoAr || crm[e.slug]?.publicado === false,
    };
    return (e: Espaco, ...exceto: string[]) =>
      Object.entries(testes).every(([nome, teste]) => exceto.includes(nome) || teste(e));
  }, [busca, cidade, nicho, situacao, estagio, prazo, foraDoAr, dataDeHoje, crm]);

  const cidades = useMemo(() => contar(espacos.filter((e) => passa(e, "cidade")), local), [espacos, passa]);
  const nichos = useMemo(() => contar(espacos.filter((e) => passa(e, "nicho")), (e) => e.nicho), [espacos, passa]);

  const lista = useMemo(() => {
    const filtrada = espacos.filter((e) => passa(e));
    const por: Record<string, (a: Espaco, b: Espaco) => number> = {
      relevancia: (a, b) => relevancia(b) - relevancia(a) || a.nome.localeCompare(b.nome, "pt-BR"),
      nota: (a, b) => (b.nota ?? 0) - (a.nota ?? 0) || (b.avaliacoes ?? 0) - (a.avaliacoes ?? 0),
      avaliacoes: (a, b) => (b.avaliacoes ?? 0) - (a.avaliacoes ?? 0),
      nome: (a, b) => a.nome.localeCompare(b.nome, "pt-BR"),
      // quem foi prometido primeiro aparece primeiro; sem data combinada, vai para o fim
      compromisso: (a, b) =>
        (crm[a.slug]?.proximaData ?? "9999").localeCompare(crm[b.slug]?.proximaData ?? "9999") ||
        a.nome.localeCompare(b.nome, "pt-BR"),
    };
    return [...filtrada].sort(por[ordem]);
  }, [espacos, passa, ordem, crm]);

  async function abrir(e: Espaco) {
    setAberto(e);
    setAcessos(null);
    setDetalhe(null);
    setAviso("");
    const t = await token();
    setEventos(null);
    const [a, d, n] = await Promise.all([listarAcessos(t, e.slug), detalhesEspaco(t, e.slug), linhaDoTempoDo(t, e.slug)]);
    if (a.ok) setAcessos(a.dados);
    if (d.ok) setDetalhe(d.dados);
    if (n.ok) setEventos(n.dados);
  }

  /* Copiar é copiar. Antes, "Copiar de novo" chamava convidar() e assinava um
     token novo a cada clique — com o convite de uso único, isso deixa vários
     links válidos do mesmo negócio circulando. */
  async function copiarConvite() {
    if (!convite) return;
    const copiado = await navigator.clipboard.writeText(convite.url).then(
      () => true,
      () => false,
    );
    setConvite({ ...convite, copiado });
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

  async function mudarLimite(uid: string, negocios: number) {
    const r = await liberarNegocios(await token(), uid, negocios);
    setAviso(r.ok ? `agora pode ter ${r.dados} negócio(s)` : r.error);
    if (r.ok) setAcessos((a) => a?.map((x) => (x.uid === uid ? { ...x, limite: r.dados } : x)) ?? null);
  }

  async function mudarNegocio(slug: string, dados: Partial<Crm>) {
    const atual = crm[slug] ?? VAZIO;
    setCrm((c) => ({ ...c, [slug]: { ...atual, ...dados } as Crm }));   // resposta imediata na tela
    const r = await salvarNegocio(await token(), slug, dados);
    // sem isto a tela segue mostrando a venda fechada, ou o site fora do ar,
    // que o servidor recusou — e o aviso some na primeira ação seguinte
    if (!r.ok) {
      setAviso(r.error);
      setCrm((c) => ({ ...c, [slug]: atual }));
      return false;
    }
    // mudança de estágio vira evento: a linha do tempo aberta acompanha
    if (dados.estagio && dados.estagio !== atual.estagio && aberto?.slug === slug) {
      const n = await linhaDoTempoDo(await token(), slug);
      if (n.ok) setEventos(n.dados);
    }
    return true;
  }

  async function enviouMensagem(slug: string, modelo: string, para: string) {
    const r = await registrarEnvio(await token(), slug, modelo, para);
    if (r.ok) setEventos(r.dados);
  }

  async function novaNota(slug: string, texto: string) {
    const r = await anotarNegocio(await token(), slug, texto);
    if (!r.ok) return setAviso(r.error);
    setEventos(r.dados);
    setCrm((c) => ({ ...c, [slug]: { ...(c[slug] ?? VAZIO), notas: (c[slug]?.notas ?? 0) + 1 } as Crm }));
  }

  async function copiar(texto: string, marca: string) {
    const ok = await navigator.clipboard.writeText(texto).then(() => true, () => false);
    setCopiado(ok ? marca : "");
    setAviso(ok ? "" : "O navegador não deixou copiar. Selecione o texto e copie à mão.");
  }

  function alternar(slug: string) {
    setMarcados((m) => {
      const novo = new Set(m);
      if (!novo.delete(slug)) novo.add(slug);
      return novo;
    });
  }

  async function convidarEmLote() {
    setAviso("");
    const r = await gerarConvites(await token(), [...marcados]);
    if (!r.ok) return setAviso(r.error);
    if (!r.dados.length) return setAviso("Nenhum dos negócios marcados existe mais.");
    // uma planilha com o link pronto de cada um: é assim que 300 convites viram trabalho possível
    baixar(
      `convites-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        ["negocio", "site", "telefone", "link_do_convite", "abrir_whatsapp"],
        ...r.dados.map((c) => [c.nome, `https://${c.slug}.ruphus.site`, c.telefone ?? "", c.url, c.whatsapp ?? ""]),
      ],
    );
    const sem = r.dados.filter((c) => !c.whatsapp).length;
    setAviso(
      `${r.dados.length} convite(s) gerado(s), válidos por 30 dias.` +
        (sem ? ` ${sem} sem telefone: o link está na planilha para enviar por outro caminho.` : ""),
    );
  }

  async function marcarEmLote(estagio: Estagio) {
    setAviso("");
    const lista = [...marcados];
    const antes = new Map(lista.map((s) => [s, crm[s]]));
    setCrm((c) => {
      const novo = { ...c };
      for (const s of lista) novo[s] = { ...(novo[s] ?? VAZIO), estagio };
      return novo;
    });
    const r = await marcarEstagio(await token(), lista, estagio);
    if (!r.ok) {
      setAviso(r.error);
      setCrm((c) => ({ ...c, ...Object.fromEntries([...antes].filter(([, v]) => v).map(([k, v]) => [k, v!])) }));
      return;
    }
    setAviso(`${r.dados} negócio(s) marcados como ${ROTULO[estagio].toLowerCase()}.`);
    setMarcados(new Set());
  }

  function baixar(nome: string, linhas: (string | number)[][]) {
    const csv = linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = nome;
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportarCSV() {
    baixar(`espacos-${new Date().toISOString().slice(0, 10)}.csv`, [
      ["nome", "site", "cidade", "uf", "nicho", "nota", "avaliacoes", "situacao", "telefone", "estagio", "entrada", "mensalidade", "proxima_acao", "proxima_data"],
      ...lista.map((e) => [
        e.nome, e.slug, e.cidade ?? "", e.uf ?? "", e.nicho,
        e.nota ?? "", e.avaliacoes ?? "",
        e.acessos > 1 ? "cliente ativo" : "convite pendente", e.telefone ?? "",
        ROTULO[(crm[e.slug]?.estagio ?? "novo") as Estagio],
        crm[e.slug]?.entradaCents ? (crm[e.slug]!.entradaCents! / 100).toFixed(2) : "",
        crm[e.slug]?.mensalCents ? (crm[e.slug]!.mensalCents! / 100).toFixed(2) : "",
        crm[e.slug]?.proximaAcao ?? "", crm[e.slug]?.proximaData ?? "",
      ]),
    ]);
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

  const chave = [busca, cidade, nicho, situacao, ordem, estagio, prazo, String(foraDoAr)].join("|");
  const contarPrazos = (base: Espaco[]) => {
    const n = { atrasada: 0, hoje: 0, futura: 0 };
    for (const e of base) {
      const p = prazoDe(crm[e.slug], dataDeHoje);
      if (p) n[p] += 1;
    }
    return n;
  };
  const compromissosNosChips = contarPrazos(espacos.filter((e) => passa(e, "prazo")));
  const noFunil = espacos.filter((e) => passa(e, "estagio"));
  // a cidade escolhida acompanha a lista recolhida: fora das cinco primeiras,
  // ela sumia da tela com o filtro ainda ligado e sem chip para desligar
  const topoCidades = cidades.slice(0, CIDADES_VISIVEIS);
  const cidadesVisiveis = todasCidades
    ? cidades
    : cidade && !topoCidades.some(([c]) => c === cidade)
      ? [...topoCidades, ...cidades.filter(([c]) => c === cidade)]
      : topoCidades;
  const quantos = pagina.chave === chave ? pagina.n : PAGINA;
  const visiveis = lista.slice(0, quantos);
  const filtrando = busca || cidade || nicho || situacao || estagio || prazo || foraDoAr;
  const nFiltros = [cidade, nicho, estagio, prazo, foraDoAr ? "x" : ""].filter(Boolean).length;

  // a contagem de cada aba respeita busca, cidade e nicho, e ignora as
  // dimensões que a própria aba controla — senão promete o que não entrega
  const contaVisao = (v: Visao) =>
    espacos.filter(
      (e) =>
        passa(e, "prazo", "situacao", "estagio", "fora") &&
        (!v.prazo || prazoDe(crm[e.slug], dataDeHoje) === v.prazo) &&
        (!v.situacao || (v.situacao === "ativo" ? e.acessos > 1 : e.acessos <= 1)) &&
        (!v.estagio || (crm[e.slug]?.estagio ?? "novo") === v.estagio) &&
        (!v.fora || crm[e.slug]?.publicado === false),
    ).length;
  const visaoAtiva = VISOES.find(
    (v) => v.prazo === prazo && v.situacao === situacao && v.estagio === estagio && v.fora === foraDoAr,
  );
  function verVisao(v: Visao) {
    setPrazo(v.prazo);
    setSituacao(v.situacao);
    setEstagio(v.estagio);
    setForaDoAr(v.fora);
  }
  function limparTudo() {
    setBusca("");
    setCidade("");
    setNicho("");
    verVisao(VISOES[2]);
  }

  const ABA = "flex h-12 items-center gap-2 border-b-2 px-3 text-[13px] transition-colors";
  const CONTA = "rounded-full px-2 py-0.5 text-[11px] font-semibold";
  const ORDENAVEL = "flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] hover:text-[#17150F]";
  const seta = (chaveOrdem: string) => (ordem === chaveOrdem ? " ↓" : "");

  return (
    <>
      {/* Barra de menu: os comandos do painel, sempre no mesmo lugar */}
      <div role="menubar" aria-label="Painel" className="flex flex-wrap items-center gap-2 border-b border-[#E2DDD3] bg-white px-4 py-2.5 sm:px-5">
        <span className="mr-1 flex items-baseline gap-2 sm:border-r sm:border-[#EDE9E1] sm:pr-4">
          <h1 className="font-[family-name:var(--fonte-serifa)] text-[22px] leading-none tracking-tight">Administração</h1>
          <span className="hidden text-[11px] text-[#8B8578] sm:inline">ruphus.site</span>
        </span>

        <div role="group" aria-label="Visão" className="flex rounded-[10px] bg-[#EFEBE2] p-[3px]">
          {(["lista", "funil"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={tela === v}
              onClick={() => setTela(v)}
              className={`h-8 rounded-lg px-3 text-[12px] ${tela === v ? "bg-white font-semibold shadow-[0_1px_2px_rgba(23,21,15,.12)]" : "text-[#6F6A5E] hover:text-[#17150F]"}`}
            >
              {v === "lista" ? "Lista" : "Funil"}
            </button>
          ))}
        </div>

        <div className="relative">
          <button
            type="button"
            role="menuitem"
            aria-haspopup="true"
            aria-expanded={menuFiltros}
            onClick={() => setMenuFiltros((v) => !v)}
            className={`flex h-9 items-center gap-2 rounded-lg px-3 text-[13px] ${menuFiltros ? "bg-[#17150F] font-semibold text-white" : "hover:bg-[#F4F2EE]"}`}
          >
            Filtros
            {nFiltros > 0 && (
              <span className={`${CONTA} ${menuFiltros ? "bg-white text-[#17150F]" : "bg-[#17150F] text-white"}`}>{nFiltros}</span>
            )}
            <span aria-hidden="true" className="text-[10px]">{menuFiltros ? "▲" : "▼"}</span>
          </button>

          {menuFiltros && (
            <>
              <button
                type="button"
                aria-label="Fechar filtros"
                onClick={() => setMenuFiltros(false)}
                className="fixed inset-0 z-30 cursor-default"
              />
              <div
                role="menu"
                aria-label="Filtros"
                className="absolute left-0 top-11 z-40 flex max-h-[70vh] w-[min(92vw,420px)] flex-col gap-3.5 overflow-y-auto rounded-xl border border-[#C8C1B3] bg-white p-4 shadow-[0_18px_48px_rgba(23,21,15,0.18)]"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mr-1 w-full text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6F6A5E]">Cidade</span>
                  <Chip ativo={!cidade} onClick={() => setCidade("")}>Todas</Chip>
                  {cidadesVisiveis.map(([c, n]) => (
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
                      {todasCidades ? "menos cidades" : `mais ${cidades.length - cidadesVisiveis.length} cidades`}
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-[#EDE9E1] pt-3.5">
                  <span className="mr-1 w-full text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6F6A5E]">Nicho</span>
                  <Chip ativo={!nicho} onClick={() => setNicho("")}>Todos</Chip>
                  {nichos.map(([v, n]) => (
                    <Chip key={v} ativo={nicho === v} onClick={() => setNicho(nicho === v ? "" : v)}>
                      {v} <span className={nicho === v ? "text-white/70" : "text-[#6F6A5E]"}>{n}</span>
                    </Chip>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-[#EDE9E1] pt-3.5">
                  <span className="mr-1 w-full text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6F6A5E]">Funil</span>
                  <Chip ativo={!estagio} onClick={() => setEstagio("")}>Todos</Chip>
                  {ESTAGIOS.map((e) => {
                    const n = noFunil.filter((x) => (crm[x.slug]?.estagio ?? "novo") === e).length;
                    // oferecer um chip que dá lista vazia é oferecer um beco sem saída
                    return (
                      <Chip key={e} ativo={estagio === e} disabled={!n && estagio !== e} onClick={() => setEstagio(estagio === e ? "" : e)}>
                        {ROTULO[e]} <span className={estagio === e ? "text-white/70" : "text-[#6F6A5E]"}>{n}</span>
                      </Chip>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-[#EDE9E1] pt-3.5">
                  <span className="mr-1 w-full text-[11px] font-semibold uppercase tracking-[0.06em] text-[#6F6A5E]">Compromisso</span>
                  <Chip ativo={!prazo} onClick={() => setPrazo("")}>Todos</Chip>
                  {([["atrasada", "Atrasados"], ["hoje", "Para hoje"], ["futura", "Agendados"]] as const).map(([v, r]) => (
                    <Chip
                      key={v}
                      ativo={prazo === v}
                      disabled={!compromissosNosChips[v] && prazo !== v}
                      onClick={() => setPrazo(prazo === v ? "" : v)}
                    >
                      {r} <span className={prazo === v ? "text-white/70" : "text-[#6F6A5E]"}>{compromissosNosChips[v]}</span>
                    </Chip>
                  ))}
                </div>

                <div className="flex items-center gap-3 border-t border-[#EDE9E1] pt-3.5">
                  <button type="button" className={BOTAO_CLARO} onClick={limparTudo}>Limpar</button>
                  <div className="grow" />
                  <span className="text-[13px] text-[#6F6A5E]">{lista.length} resultado(s)</span>
                  <button type="button" className={BOTAO_ESCURO} onClick={() => setMenuFiltros(false)}>Pronto</button>
                </div>
              </div>
            </>
          )}
        </div>

        <label htmlFor="ordem" className="sr-only">Ordenar</label>
        <select
          id="ordem"
          value={ordem}
          onChange={(e) => setOrdem(e.target.value)}
          className="h-9 rounded-lg border border-[#D8D2C6] bg-white px-2.5 text-[13px]"
        >
          <option value="relevancia">Mais relevantes</option>
          <option value="compromisso">Compromisso mais próximo</option>
          <option value="nota">Melhor nota</option>
          <option value="avaliacoes">Mais avaliações</option>
          <option value="nome">Nome (A–Z)</option>
        </select>

        <button type="button" onClick={exportarCSV} className="h-9 rounded-lg px-3 text-[13px] hover:bg-[#F4F2EE]">
          Exportar
        </button>

        <div className="grow" />

        <div className="flex h-9 w-full items-center gap-2 rounded-lg border border-[#D8D2C6] bg-[#FBFAF8] px-3 focus-within:border-[#17150F] sm:w-[320px]">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="#6F6A5E" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
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
            placeholder="Buscar negócio"
            className="grow bg-transparent text-[13px] outline-none placeholder:text-[#8B8578]"
          />
          <kbd className="hidden rounded border border-[#D8D2C6] bg-white px-1.5 text-[11px] text-[#6F6A5E] sm:block">/</kbd>
        </div>

        <span className="hidden text-[12px] text-[#6F6A5E] lg:inline">{email}</span>
        <button
          className="h-9 rounded-lg border border-[#D8D2C6] px-3 text-[12px] hover:border-[#17150F]"
          onClick={() => signOut(auth).then(() => router.replace("/login"))}
        >
          Sair
        </button>
      </div>

      {/* As visões viram abas: o que se repete todo dia vira lugar fixo */}
      <div className="flex flex-wrap items-center gap-1 border-b border-[#E2DDD3] bg-white px-4 sm:px-5">
        {VISOES.map((v) => {
          const n = contaVisao(v);
          const ativa = visaoAtiva?.id === v.id;
          return (
            <span key={v.id} className="flex items-center">
              {v.separa && <span aria-hidden="true" className="mx-2 h-5 w-px bg-[#EDE9E1]" />}
              <button
                type="button"
                aria-pressed={ativa}
                onClick={() => verVisao(v)}
                className={`${ABA} ${
                  ativa
                    ? "border-[#17150F] font-bold text-[#17150F]"
                    : `border-transparent ${v.urgente && n ? "font-semibold text-[#8A2F2F]" : "text-[#17150F]"} hover:border-[#D8D2C6]`
                }`}
              >
                {v.urgente && n > 0 && <span aria-hidden="true" className="size-1.5 rounded-full bg-[#8A2F2F]" />}
                {v.rotulo}
                <span
                  className={`${CONTA} ${
                    ativa ? "bg-[#17150F] text-white" : v.urgente && n ? "bg-[#FBF0EE] text-[#8A2F2F]" : "bg-[#F3EFE7] text-[#6F6A5E]"
                  }`}
                >
                  {n}
                </span>
              </button>
            </span>
          );
        })}

        <div className="grow" />

        {cidade && (
          <button
            type="button"
            onClick={() => setCidade("")}
            className="my-2 flex h-8 items-center gap-2 rounded-full bg-[#17150F] pl-3 pr-2 text-[12px] font-semibold text-white"
          >
            {cidade} <span aria-hidden="true">✕</span>
            <span className="sr-only">Tirar o filtro de cidade</span>
          </button>
        )}
        {nicho && (
          <button
            type="button"
            onClick={() => setNicho("")}
            className="my-2 ml-1.5 flex h-8 items-center gap-2 rounded-full bg-[#17150F] pl-3 pr-2 text-[12px] font-semibold text-white"
          >
            {nicho} <span aria-hidden="true">✕</span>
            <span className="sr-only">Tirar o filtro de nicho</span>
          </button>
        )}
        {filtrando && (
          <button
            type="button"
            onClick={limparTudo}
            className="my-2 ml-2 h-8 px-2 text-[12px] text-[#6F6A5E] underline underline-offset-4 hover:text-[#17150F]"
          >
            Limpar filtros
          </button>
        )}
      </div>

      <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 p-4 sm:p-5">
        {aviso && <p className="text-sm text-[#6F6A5E]">{aviso}</p>}

        {/* Quem já devia aparece antes da lista: é o que se olha de manhã */}
        <Atrasadas idToken={idToken} aviso={setAviso} cortar={(slug) => mudarNegocio(slug, { publicado: false })} />

        {tela === "funil" ? (
          <Funil
            espacos={lista}
            crm={crm}
            hoje={dataDeHoje}
            abrir={abrir}
            mover={(slug, e) => (e === "perdido" ? setPerdendo(slug) : mudarNegocio(slug, { estagio: e }))}
            verAtrasadas={() => {
              verVisao(VISOES[0]);
              setTela("lista");
            }}
            verPerdidos={() => {
              setEstagio("perdido");
              setPrazo("");
              setTela("lista");
            }}
          />
        ) : (
        <section aria-label="Espaços" className={`${CARTAO} overflow-hidden`}>
          {marcados.size > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b border-[#E2DDD3] bg-[#F2F5F3] px-4 py-2.5 sm:px-5">
              <span className="mr-1 text-[13px] font-semibold text-[#2C6A53]">{marcados.size} marcado(s)</span>
              <button type="button" onClick={convidarEmLote} className="h-8 rounded-lg border border-[#2C6A53] bg-white px-3 text-[12px] font-semibold text-[#2C6A53] hover:bg-[#EAF1EC]">
                Gerar convites
              </button>
              <button type="button" onClick={() => marcarEmLote("oferta")} className="h-8 rounded-lg border border-[#D8D2C6] bg-white px-3 text-[12px] hover:border-[#17150F]">
                Marcar oferta enviada
              </button>
              <button type="button" onClick={() => marcarEmLote("negociando")} className="h-8 rounded-lg border border-[#D8D2C6] bg-white px-3 text-[12px] hover:border-[#17150F]">
                Marcar negociando
              </button>
              <div className="grow" />
              <button type="button" onClick={() => setMarcados(new Set())} className="h-8 px-2 text-[12px] text-[#4A4639] underline underline-offset-4 hover:text-[#17150F]">
                Limpar seleção
              </button>
            </div>
          )}

          <div aria-live="polite" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[#EDE9E1] px-4 py-3 sm:px-5">
            <span className="text-sm font-semibold">{lista.length} espaço(s)</span>
            <span className="text-[13px] text-[#6F6A5E]">
              {visaoAtiva ? visaoAtiva.rotulo.toLowerCase() : "recorte próprio"}
              {cidade && ` · ${cidade}`}
              {nicho && ` · ${nicho}`}
            </span>
            <div className="grow" />
            {/* Dois números: o que já entrou e o que ainda está em jogo. Só
                "contratados" conta a vitória e esconde o trabalho em aberto. */}
            <span className="text-[13px] text-[#6F6A5E]">
              {hoje ? `${hoje.agendamentosHoje} agendamento(s) hoje` : "carregando agenda"} ·{" "}
              {formatBRL(espacos.reduce((t, e) => t + (crm[e.slug]?.estagio === "fechado" ? crm[e.slug]?.mensalCents ?? 0 : 0), 0))}/mês contratados
              {(() => {
                const aberto = espacos.reduce(
                  (t, e) =>
                    t + ((ETAPAS as readonly string[]).includes(crm[e.slug]?.estagio ?? "novo") ? crm[e.slug]?.mensalCents ?? 0 : 0),
                  0,
                );
                return aberto > 0 ? ` · ${formatBRL(aberto)}/mês em negociação` : "";
              })()}
            </span>
          </div>

          {/* Cabeçalho de coluna: sem ele, "★ 4,9 · 1.125" é um número a adivinhar */}
          <div className="hidden items-center gap-4 border-b border-[#E2DDD3] bg-[#FBFAF8] px-5 py-2.5 text-[#6F6A5E] lg:flex">
            <input
              type="checkbox"
              aria-label="Marcar os negócios desta tela"
              className="size-4 accent-[#17150F]"
              checked={visiveis.length > 0 && visiveis.every((e) => marcados.has(e.slug))}
              onChange={(ev) =>
                setMarcados((m) => {
                  const novo = new Set(m);
                  for (const e of visiveis) {
                    if (ev.target.checked) novo.add(e.slug);
                    else novo.delete(e.slug);
                  }
                  return novo;
                })
              }
            />
            <button type="button" onClick={() => setOrdem("nome")} className={`${ORDENAVEL} w-[296px]`}>
              Negócio{seta("nome")}
            </button>
            <span className="w-[150px] text-[11px] font-semibold uppercase tracking-[0.06em]">Cidade</span>
            <span className="w-[170px] text-[11px] font-semibold uppercase tracking-[0.06em]">Nicho</span>
            <button type="button" onClick={() => setOrdem("nota")} className={`${ORDENAVEL} w-[130px]`}>
              Google{seta("nota")}
            </button>
            <span className="w-[140px] text-[11px] font-semibold uppercase tracking-[0.06em]">Funil</span>
            <button type="button" onClick={() => setOrdem("compromisso")} className={`${ORDENAVEL} min-w-0 grow`}>
              Próxima ação{seta("compromisso")}
            </button>
            <span className="w-[180px]" />
          </div>

          <ul>
            {visiveis.map((e) => {
              const ativo = e.acessos > 1;
              const p = prazoDe(crm[e.slug], dataDeHoje);
              return (
                <li
                  key={e.slug}
                  className="flex flex-col gap-3 border-b border-[#F1EDE6] px-4 py-3.5 last:border-0 sm:px-5 lg:flex-row lg:items-center lg:gap-4"
                >
                  <div className="flex min-w-0 items-start gap-3 lg:w-[320px]">
                    <input
                      type="checkbox"
                      aria-label={`Marcar ${e.nome}`}
                      className="mt-3.5 size-4 shrink-0 accent-[#17150F]"
                      checked={marcados.has(e.slug)}
                      onChange={() => alternar(e.slug)}
                    />
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
                    <span className="lg:w-[150px]">{local(e) || "cidade não identificada"}</span>
                    <span className="lg:w-[170px]">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${CORES_NICHO[e.nicho] ?? "bg-[#F3EFE7] text-[#4A4639]"}`}>
                        {e.nicho}
                      </span>
                    </span>
                    <span className="lg:w-[130px]">
                      {e.nota
                        ? `★ ${e.nota.toFixed(1).replace(".", ",")}${e.avaliacoes ? ` · ${e.avaliacoes.toLocaleString("pt-BR")}` : ""}`
                        : "sem nota"}
                    </span>
                    <span className="lg:w-[140px]">
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${COR[(crm[e.slug]?.estagio ?? "novo") as Estagio]}`}>
                        {ROTULO[(crm[e.slug]?.estagio ?? "novo") as Estagio]}
                      </span>
                      {crm[e.slug]?.publicado === false && (
                        <span className="ml-1 rounded-full bg-[#F1E7E7] px-2 py-0.5 text-xs font-semibold text-[#8A2F2F]">fora do ar</span>
                      )}
                    </span>
                    <span className="min-w-0 lg:grow">
                      {p && p !== "futura" ? (
                        <span
                          className={`block truncate text-[12px] font-semibold ${p === "atrasada" ? "text-[#8A2F2F]" : "text-[#7A5A2E]"}`}
                          title={crm[e.slug]?.proximaAcao ?? undefined}
                        >
                          {p === "atrasada" ? `atrasado desde ${diaCurto(crm[e.slug]!.proximaData!)}` : "combinado para hoje"}
                          {crm[e.slug]?.proximaAcao ? ` · ${crm[e.slug]!.proximaAcao}` : ""}
                        </span>
                      ) : crm[e.slug]?.proximaData ? (
                        <span className="block truncate text-[12px] text-[#6F6A5E]" title={crm[e.slug]?.proximaAcao ?? undefined}>
                          {diaCurto(crm[e.slug]!.proximaData!)}
                          {crm[e.slug]?.proximaAcao ? ` · ${crm[e.slug]!.proximaAcao}` : ""}
                        </span>
                      ) : (
                        <span className="text-[12px] text-[#A8A294]">—</span>
                      )}
                    </span>
                  </div>

                  <div className="flex grow justify-end gap-2 lg:w-[180px] lg:grow-0">
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

            {/* Vazio com saída: qual filtro matou o resultado, e o que cada saída devolve */}
            {!lista.length && (
              <li className="flex flex-col items-center gap-4 px-5 py-12 text-center">
                <p className="max-w-sm text-sm text-[#4A4639]">
                  {/* Sem nenhum espaço cadastrado, culpar os filtros manda procurar o que não existe */}
                  {!espacos.length ? (
                    "Nenhum negócio cadastrado ainda."
                  ) : (
                    <>
                      Nenhum espaço com esses filtros
                      {cidade && ` em ${cidade}`}
                      {nicho && `, do nicho ${nicho}`}.
                    </>
                  )}
                </p>
                <div className={`flex-wrap justify-center gap-2 ${espacos.length ? "flex" : "hidden"}`}>
                  {cidade && (
                    <button type="button" className={BOTAO_CLARO} onClick={() => setCidade("")}>
                      Tirar {cidade} → {espacos.filter((x) => passa(x, "cidade")).length}
                    </button>
                  )}
                  {nicho && (
                    <button type="button" className={BOTAO_CLARO} onClick={() => setNicho("")}>
                      Tirar {nicho} → {espacos.filter((x) => passa(x, "nicho")).length}
                    </button>
                  )}
                  <button type="button" className={BOTAO_ESCURO} onClick={limparTudo}>
                    Limpar tudo → {espacos.length}
                  </button>
                </div>
              </li>
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
        )}
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
                {/* O que o vendedor precisa saber antes de rolar: em que pé está e o que ficou combinado */}
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${COR[crm[aberto.slug]?.estagio ?? "novo"]}`}>
                    {ROTULO[crm[aberto.slug]?.estagio ?? "novo"]}
                  </span>
                  {(() => {
                    const c = crm[aberto.slug];
                    const p = prazoDe(c, dataDeHoje);
                    if (!c?.proximaData || !p) return null;
                    const estilo = p === "atrasada" ? "bg-[#F1E7E7] text-[#8A2F2F]" : p === "hoje" ? "bg-[#FBF3DC] text-[#7A5A2E]" : "bg-[#F3EFE7] text-[#4A4639]";
                    const quando = p === "atrasada" ? `atrasada desde ${diaCurto(c.proximaData)}` : p === "hoje" ? "hoje" : diaCurto(c.proximaData);
                    return (
                      <span className={`max-w-full truncate rounded-full px-2.5 py-1 text-[11px] font-semibold ${estilo}`}>
                        {c.proximaAcao ? `${c.proximaAcao} · ${quando}` : quando}
                      </span>
                    );
                  })()}
                </div>
              </div>
              <button type="button" aria-label="Fechar" onClick={() => setAberto(null)} className={`${BOTAO_CLARO} size-11 shrink-0 px-0`}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            {/* A gaveta tem o que o vendedor usa todo dia em "Venda"; o resto fica a um toque */}
            <div role="tablist" aria-label="Seções do negócio" className="sticky -top-6 z-10 -mx-6 -mt-2 flex gap-1 overflow-x-auto border-b border-[#E2DDD3] bg-white px-6 sm:-top-8 sm:-mx-8 sm:px-8">
              {(
                [
                  // ícones em traço, do mesmo peso dos outros da gaveta
                  ["venda", "Venda", <path key="v" d="M3 17l6-6 4 4 8-8M15 7h6v6" />],
                  ["historico", `Histórico${eventos ? ` · ${eventos.length}` : ""}`, <><circle key="c" cx="12" cy="12" r="8.5" /><path key="p" d="M12 7.5V12l3 2" /></>],
                  ["cliente", "Cliente", <><circle key="c" cx="12" cy="8" r="3.5" /><path key="p" d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" /></>],
                  ["cobranca", "Cobrança", <><rect key="r" x="3" y="6" width="18" height="12" rx="2" /><path key="p" d="M3 10h18M7 15h3" /></>],
                ] as const
              ).map(([id, rotulo, icone]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`aba-${id}`}
                  aria-selected={aba === id}
                  aria-controls="aba-painel"
                  onClick={() => setAba(id)}
                  className={`flex h-12 items-center gap-1.5 px-3 text-[13px] whitespace-nowrap ${aba === id ? "font-semibold text-[#17150F] shadow-[inset_0_-2px_0_#17150F]" : "text-[#6F6A5E] hover:text-[#17150F]"}`}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">
                    {icone}
                  </svg>
                  {rotulo}
                </button>
              ))}
            </div>

            <div role="tabpanel" id="aba-painel" aria-labelledby={`aba-${aba}`} className="flex flex-col gap-5">
            {aba === "venda" && (
              <>
            <section aria-label="Negócio" className="flex flex-col gap-4 rounded-2xl border border-[#E2DDD3] p-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[15px] font-semibold">Negócio</h3>
                <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${COR[crm[aberto.slug]?.estagio ?? "novo"]}`}>
                  {ROTULO[crm[aberto.slug]?.estagio ?? "novo"]}
                </span>
              </div>

              <div className="flex flex-col gap-2">
                <span className="text-xs text-[#6F6A5E]">Em que pé está</span>
                <div className="flex overflow-hidden rounded-xl border border-[#D8D2C6]">
                  {ETAPAS.map((e, i) => {
                    const ativa = (crm[aberto.slug]?.estagio ?? "novo") === e;
                    return (
                      <button
                        key={e}
                        type="button"
                        aria-pressed={ativa}
                        onClick={() => mudarNegocio(aberto.slug, { estagio: e })}
                        className={`flex grow flex-col items-start gap-0.5 px-3 py-2.5 text-left transition-colors ${
                          i ? "border-l border-[#D8D2C6]" : ""
                        } ${ativa ? "bg-[#17150F] text-white" : "bg-white text-[#6F6A5E] hover:text-[#17150F]"}`}
                      >
                        <span className="text-[10px] tabular-nums opacity-75">{`0${i + 1}`}</span>
                        <span className="text-[13px] font-semibold">{ROTULO[e]}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-[#6F6A5E]">Fecha aqui:</span>
                  {DESFECHOS.map((e) => {
                    const ativa = (crm[aberto.slug]?.estagio ?? "novo") === e;
                    return (
                      <button
                        key={e}
                        type="button"
                        aria-pressed={ativa}
                        onClick={() => (e === "perdido" && !ativa ? setPerdendo(aberto.slug) : mudarNegocio(aberto.slug, { estagio: e }))}
                        className={`${CHIP} ${ativa ? `border-transparent font-semibold ${COR[e]}` : "border-[#D8D2C6] bg-white text-[#6F6A5E] hover:border-[#17150F] hover:text-[#17150F]"}`}
                      >
                        {ROTULO[e]}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Uma coluna: isto vive numa gaveta estreita, e os breakpoints do
                  Tailwind leem a janela, não o contêiner — em duas colunas o
                  campo "o que fazer" fica com 40px e some atrás do date picker. */}
              <div className="flex flex-col gap-3">
                {/* Nasce no preco padrao: com 675 negocios, digitar o mesmo
                    numero 675 vezes e o que faz alguem parar de preencher. */}
                <div className="grid grid-cols-2 gap-3">
                  {(
                    [
                      { id: "entrada", rotulo: "Entrada", campo: "entradaCents", padrao: PRECO_PADRAO.entradaCents, sufixo: "" },
                      { id: "mensal", rotulo: "Mensalidade", campo: "mensalCents", padrao: PRECO_PADRAO.mensalCents, sufixo: "/mês" },
                    ] as const
                  ).map((c) => (
                    <label key={c.id} htmlFor={c.id} className="flex flex-col gap-1 text-xs text-[#6F6A5E]">
                      {c.rotulo}
                      <span className="flex h-11 items-center rounded-[10px] border border-[#D8D2C6] bg-white focus-within:border-[#17150F]">
                        <span className="pl-3 pr-1.5 text-sm text-[#8B8578]">R$</span>
                        <input
                          id={c.id}
                          type="number"
                          min={0}
                          step={10}
                          defaultValue={((crm[aberto.slug]?.[c.campo] ?? c.padrao) / 100).toString()}
                          onBlur={(ev) =>
                            mudarNegocio(aberto.slug, {
                              [c.campo]: ev.target.value ? Math.round(Number(ev.target.value) * 100) : null,
                            })
                          }
                          className="h-full min-w-0 grow bg-transparent text-sm tabular-nums text-[#17150F] outline-none"
                        />
                        {c.sufixo && <span className="pr-3 text-xs text-[#8B8578]">{c.sufixo}</span>}
                      </span>
                    </label>
                  ))}
                </div>

                <div className="flex flex-col gap-1">
                  <span className="text-xs text-[#6F6A5E]">Próxima ação</span>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      maxLength={120}
                      aria-label="O que fazer"
                      placeholder="ligar, mandar proposta, cobrar retorno…"
                      defaultValue={crm[aberto.slug]?.proximaAcao ?? ""}
                      onBlur={(ev) => mudarNegocio(aberto.slug, { proximaAcao: ev.target.value.trim() || null })}
                      className="h-11 min-w-0 grow rounded-[10px] border border-[#D8D2C6] bg-white px-3 text-sm text-[#17150F]"
                    />
                    <input
                      type="date"
                      aria-label="Quando"
                      defaultValue={crm[aberto.slug]?.proximaData ?? ""}
                      onChange={(ev) => mudarNegocio(aberto.slug, { proximaData: ev.target.value || null })}
                      className="h-11 w-[150px] shrink-0 rounded-[10px] border border-[#D8D2C6] bg-white px-3 text-sm text-[#17150F]"
                    />
                  </div>
                  {(() => {
                    const p = prazoDe(crm[aberto.slug], dataDeHoje);
                    const dia = crm[aberto.slug]?.proximaData;
                    if (!p || !dia) return null;
                    const estilo =
                      p === "atrasada" ? "bg-[#F1E7E7] text-[#8A2F2F]" : p === "hoje" ? "bg-[#FBF3DC] text-[#7A5A2E]" : "bg-[#F3EFE7] text-[#4A4639]";
                    return (
                      <span className={`mt-0.5 self-start rounded-full px-2.5 py-1 text-[11px] font-semibold ${estilo}`}>
                        {p === "atrasada" ? `atrasada desde ${diaCurto(dia)}` : p === "hoje" ? "combinada para hoje" : `combinada para ${diaCurto(dia)}`}
                      </span>
                    );
                  })()}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-[#EDE9E1] pt-4">
                <button
                  type="button"
                  onClick={() => mudarNegocio(aberto.slug, { publicado: !(crm[aberto.slug]?.publicado !== false) })}
                  className={`h-9 rounded-full border px-3.5 text-[13px] font-semibold ${
                    crm[aberto.slug]?.publicado === false
                      ? "border-[#2C6A53] text-[#2C6A53] hover:bg-[#EEF2F0]"
                      : "border-[#E0D6D6] text-[#8A2F2F] hover:border-[#8A2F2F]"
                  }`}
                >
                  {crm[aberto.slug]?.publicado === false ? "Colocar o site no ar" : "Tirar o site do ar"}
                </button>
                <span className="text-xs text-[#6F6A5E]">
                  {crm[aberto.slug]?.publicado === false
                    ? "O endereço está fora do ar para os clientes."
                    : "O endereço para de responder para os clientes. O negócio continua aqui."}
                </span>
              </div>
            </section>

            <ContatoDono
              key={`contato-${aberto.slug}`}
              negocio={aberto}
              crm={crm[aberto.slug] ?? VAZIO}
              salvar={(dados) => mudarNegocio(aberto.slug, dados)}
            />
            <OrigemDoContato key={`origem-${aberto.slug}`} crm={crm[aberto.slug] ?? VAZIO} salvar={(dados) => mudarNegocio(aberto.slug, dados)} />

            <MensagensProntas
              key={`msg-${aberto.slug}`}
              negocio={aberto}
              crm={crm[aberto.slug] ?? VAZIO}
              onEnviar={(modelo, para) => enviouMensagem(aberto.slug, modelo, para)}
              onCopiar={(texto) => copiar(texto, "mensagem")}
            />

            <LinhaDoTempo key={`resumo-${aberto.slug}`} eventos={eventos} limite={3} onVerTudo={() => setAba("historico")} anotar={(texto) => novaNota(aberto.slug, texto)} />

              </>
            )}
            {aba === "historico" && (
              <>
            <LinhaDoTempo key={`linha-${aberto.slug}`} eventos={eventos} anotar={(texto) => novaNota(aberto.slug, texto)} />

              </>
            )}
            {aba === "cliente" && (
              <>
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
                Quem abrir o link entra com a conta dele e passa a administrar este negócio. O link vale 30 dias.
              </p>
              {convite?.slug === aberto.slug ? (
                <div className="flex flex-col gap-2">
                  <code className="truncate rounded-lg border border-[#E2DDD3] bg-white px-3 py-2.5 text-xs text-[#4A4639]">
                    {convite.url}
                  </code>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className={BOTAO_ESCURO} onClick={copiarConvite}>
                      {convite.copiado ? "Copiado ✓" : "Copiar link"}
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
                    <button
                      type="button"
                      onClick={() => convidar(aberto.slug)}
                      className="h-9 rounded-full px-2 text-[13px] text-[#6F6A5E] underline underline-offset-4 hover:text-[#17150F]"
                    >
                      Gerar outro
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className={`${BOTAO_ESCURO} self-start`} onClick={() => convidar(aberto.slug)}>
                  Convidar
                </button>
              )}
            </section>

            <section aria-label="Quem tem acesso" className="flex flex-col gap-2.5">
              <div className="flex items-baseline gap-2">
                <h3 className="text-[15px] font-semibold">Quem tem acesso</h3>
                <span className="text-[13px] text-[#6F6A5E]">{acessos ? `${acessos.length} pessoa(s)` : "carregando…"}</span>
              </div>
              <ul className="flex flex-col gap-2">
                {acessos?.map((a) => (
                  <li key={a.uid} className="flex flex-col gap-3 rounded-xl border border-[#E2DDD3] p-3.5">
                    <div className="flex items-center gap-3">
                      <span
                        aria-hidden="true"
                        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#EFEBE2] text-sm font-semibold uppercase"
                      >
                        {(a.nome ?? a.email ?? "?").charAt(0)}
                      </span>
                      <div className="min-w-0 grow">
                        {/* Nome quando o login traz (Google); senão o e-mail; o uid só se nada mais houver */}
                        <p className="truncate text-sm font-semibold">{a.nome ?? a.email ?? "Sem e-mail registrado"}</p>
                        <p className="truncate text-xs text-[#6F6A5E]">
                          {a.nome && a.email ? `${a.email} · ` : ""}
                          {!a.nome && !a.email ? `${a.uid} · ` : ""}
                          {a.desde ? `desde ${new Date(a.desde).toLocaleDateString("pt-BR")}` : "acesso antigo"}
                        </p>
                      </div>
                      {a.papel === "owner" ? (
                        <span className="shrink-0 rounded-full bg-[#EFEBE2] px-2.5 py-1 text-xs font-semibold" title="O dono não pode ser removido">
                          Dono
                        </span>
                      ) : (
                        <>
                          <span className="shrink-0 rounded-full bg-[#E7EEE9] px-2.5 py-1 text-xs font-semibold text-[#2C6A53]">
                            {a.papel === "admin" ? "Cliente" : "Equipe"}
                          </span>
                          <button
                            type="button"
                            onClick={() => revogar(aberto.slug, a.uid)}
                            aria-label={`Remover o acesso de ${a.nome ?? a.email ?? a.uid}`}
                            className="h-11 shrink-0 rounded-[10px] border border-[#D8D2C6] px-3.5 text-[13px] font-semibold text-[#8A2F2F] hover:border-[#8A2F2F]"
                          >
                            Remover
                          </button>
                        </>
                      )}
                    </div>
                    {/* Cada conta começa com 1 negócio; daqui o admin libera mais para este cliente */}
                    {a.limite !== null && (
                      <div className="flex items-center justify-between gap-3 border-t border-[#EFEBE3] pt-3 text-xs">
                        <span className="text-[#6F6A5E]">
                          Negócios nesta conta: <b className="font-semibold text-[#17150F]">{a.usados}</b> de {a.limite}
                        </span>
                        <span className="flex items-center gap-1.5">
                          <button
                            type="button"
                            aria-label={`Diminuir limite de negócios de ${a.nome ?? a.email ?? a.uid}`}
                            disabled={a.limite <= 1}
                            onClick={() => mudarLimite(a.uid, a.limite! - 1)}
                            className="size-11 rounded-[10px] border border-[#D8D2C6] text-base font-semibold hover:border-[#17150F] disabled:opacity-40"
                          >
                            −
                          </button>
                          <button
                            type="button"
                            aria-label={`Liberar mais um negócio para ${a.nome ?? a.email ?? a.uid}`}
                            onClick={() => mudarLimite(a.uid, a.limite! + 1)}
                            className="size-11 rounded-[10px] border border-[#D8D2C6] text-base font-semibold hover:border-[#17150F]"
                          >
                            +
                          </button>
                        </span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <section aria-label="Divulgação" className="flex flex-col gap-3 rounded-2xl border border-[#E2DDD3] p-4">
              <h3 className="text-[15px] font-semibold">Divulgar o site</h3>
              <div className="flex gap-3">
                <a
                  href={`https://${aberto.slug}.ruphus.site/`}
                  target="_blank"
                  rel="noreferrer"
                  className="h-[132px] w-1/2 overflow-hidden rounded-xl border border-[#E2DDD3] bg-[#F4F2EE]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- captura da página, já gerada */}
                  <img
                    src={`/s/_p/${aberto.slug}.webp`}
                    alt={`Página inicial do site de ${aberto.nome}`}
                    className="size-full object-cover object-top"
                  />
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
              </>
            )}
            {aba === "cobranca" && (
              <>
            <Cobrancas slug={aberto.slug} idToken={idToken} aviso={setAviso} />

              </>
            )}
            </div>
          </aside>
        </>
      )}

      {perdendo && (
        <MotivoDaPerda
          nome={espacos.find((e) => e.slug === perdendo)?.nome ?? perdendo}
          onCancelar={() => setPerdendo(null)}
          onConfirmar={async (dados) => {
            if (await mudarNegocio(perdendo, { estagio: "perdido", ...dados })) setPerdendo(null);
          }}
        />
      )}
    </>
  );
}
