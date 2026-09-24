"use client";

import { onAuthStateChanged, signOut } from "firebase/auth";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { auth } from "@/lib/firebase";
import { formatBRL, linkWhatsApp } from "@/lib/datetime";
import {
  abrirPainel,
  anotarNegocio,
  detalhesEspaco,
  gerarConvite,
  listarAcessos,
  gerarConvites,
  linhaDoTempoDo,
  registrarEnvio,
  marcarEstagio,
  salvarNegocio,
  revogarAcesso,
  definirAssinatura,
  encerrarSessoes,
  definirMinutosInativo,
  definirLimiteStaff,
  linkDaProposta,
  liberarNegocios,
  saudeDoNegocio,
  cobrar,
  type Acesso,
  type Detalhe,
  type Espaco,
} from "./actions";
import { Atrasadas, Cobrancas } from "./cobranca";
import { alertas as calcularAlertas } from "@/lib/alertas";
import { cents, emReais } from "@/lib/dinheiro";
import { loginComMotivo, MINUTOS_MAX, useAutoLogout } from "@/lib/sessao";
import { COMMIT, VERSAO } from "@/lib/versao";
import { DIAS_CONVITE, LIMITE_STAFF_MAX } from "@/lib/limites";
import { ContatoDono, Destaque, ImplantacaoESaude, LinhaDoTempo, mensagem, MensagensProntas, MotivoDaPerda, Objecoes, OrigemDoContato, VendaFechada, type Passo } from "./crm-gaveta";
import { Carteira } from "./carteira";
import type { ClienteSaude } from "@/lib/saude.server";
import { Funil } from "./funil";
import { COR, DESFECHOS, diaCurto, ESTAGIOS, ETAPAS, hojeISO, ORIGENS, prazoDe, PRECO_PADRAO, ROTULO, type Crm, type Estagio, type Evento, type Prazo } from "@/lib/crm-tipos";

const PAGINA = 40;
const VAZIO: Crm = {
  estagio: "novo", entradaCents: null, mensalCents: null, fechadoEm: null, proximaAcao: null, proximaData: null, publicado: true, notas: 0,
  donoNome: null, donoPapel: null, donoWhatsapp: null, donoEmail: null, motivoPerda: null, detalhePerda: null,
  origem: null, indicadoPor: null, entrouEm: null, perdidoEm: null, ultimoContatoEm: null, fixadoAte: null,
};
const CIDADES_VISIVEIS = 5;
const ITEM_MENU = "flex h-11 items-center rounded-lg px-2.5 text-left text-[13px] text-[#17150F] hover:bg-[#F4F2EE]";

// "sv-SE" formata como AAAA-MM-DD, e no fuso de quem está olhando
const diaLocal = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("sv-SE") : "");
const emDestaque = (c: Crm | undefined, hoje: string) => !!c?.fixadoAte && c.fixadoAte >= hoje;

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
// relevância: a nota pesa, mas um 5,0 de três pessoas não passa na frente de um 4,7 de quinhentas
const relevancia = (e: Espaco) => (e.nota ?? 0) * Math.log10((e.avaliacoes ?? 0) + 1);
const local = (e: Espaco) => (e.cidade ? `${e.cidade}${e.uf ? `/${e.uf}` : ""}` : "");

// As visões são combinações de filtro que se repetem todo dia. Viram aba para
// ninguém ter de remontá-las de manhã — e cada uma é só um preset dos mesmos
// filtros, não um caminho paralelo.
type Visao = { id: string; rotulo: string; urgente?: boolean; separa?: boolean; prazo: "" | Prazo; situacao: string; estagio: string; fora: boolean; contato?: "" | "hoje"; fixados?: boolean };
const VISOES: Visao[] = [
  { id: "atrasados", rotulo: "Atrasados", urgente: true, prazo: "atrasada", situacao: "", estagio: "", fora: false },
  { id: "hoje", rotulo: "Para hoje", prazo: "hoje", situacao: "", estagio: "", fora: false },
  { id: "falei", rotulo: "Falei hoje", prazo: "", situacao: "", estagio: "", fora: false, contato: "hoje" },
  { id: "fixados", rotulo: "Em destaque", prazo: "", situacao: "", estagio: "", fora: false, fixados: true },
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
const BOTAO_VERDE = `${BOTAO} bg-[#2C6A53] text-white hover:bg-[#245743]`;
const MENOR = "inline-flex h-9 items-center rounded-[8px] border border-[#D8D2C6] bg-white px-2.5 text-xs text-[#17150F] hover:border-[#17150F]";
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
  // vem junto do painel, na mesma viagem; o próprio admin também sai sozinho
  const [minutosInativo, setMinutosInativo] = useState(0);
  useAutoLogout(minutosInativo);
  const [estado, setEstado] = useState<"carregando" | "negado" | "pronto">("carregando");
  const [email, setEmail] = useState("");
  const [espacos, setEspacos] = useState<Espaco[]>([]);
  const [assinatura, setAssinatura] = useState("");   // quem assina as mensagens do CRM
  const [atrasadas, setAtrasadas] = useState(0);      // cobranças vencidas, no rótulo da aba
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
  const [convite, setConvite] = useState<{ slug: string; url: string; email: string | null; copiado: boolean } | null>(null);
  const [idToken, setIdToken] = useState("");
  const [copiado, setCopiado] = useState("");
  const [aviso, setAviso] = useState("");
  const [crm, setCrm] = useState<Record<string, Crm>>({});
  const [eventos, setEventos] = useState<Evento[] | null>(null);
  // qual negócio está sendo marcado como perdido (pela gaveta ou soltando no funil)
  const [perdendo, setPerdendo] = useState<string | null>(null);
  const [tela, setTela] = useState<"lista" | "funil" | "clientes" | "cobranca">("lista");
  // qual negócio está sendo marcado como fechado (confirma valores e já faz o pós-venda)
  const [fechando, setFechando] = useState<string | null>(null);
  const [saude, setSaude] = useState<ClienteSaude | null>(null);
  // A aba escolhida vale para o próximo negócio aberto: quem está cobrando segue cobrando
  const [aba, setAba] = useState<"venda" | "historico" | "cliente" | "cobranca">("venda");
  const [estagio, setEstagio] = useState("");
  const [prazo, setPrazo] = useState<"" | Prazo>("");
  const [contato, setContato] = useState<"" | "hoje">("");   // "falei hoje"
  const [alerta, setAlerta] = useState("");                  // id do alerta em foco
  const [menuAjustes, setMenuAjustes] = useState(false);     // engrenagem: o que é da plataforma
  const [menuNegocio, setMenuNegocio] = useState(false);     // "…" da gaveta: atalhos e tirar do ar
  // a mensagem escolhida no bloco, para a barra fixa do rodapé da gaveta
  const [pronto, setPronto] = useState<{ modelo: string; texto: string; link: string | null; para: string } | null>(null);
  // o link da proposta do negócio aberto: o mesmo vai por WhatsApp e por e-mail
  const [proposta, setProposta] = useState<{ slug: string; url: string; valeAte: string } | null>(null);
  const [fixados, setFixados] = useState(false);
  const [foraDoAr, setForaDoAr] = useState(false);
  const [menuFiltros, setMenuFiltros] = useState(false);
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  // fixo por render: se viesse de Date.now() a cada chamada, um espaço podia cair
  // em "hoje" na contagem e em "atrasada" na lista, na virada da meia-noite
  const dataDeHoje = hojeISO();

  useEffect(
    () =>
      onAuthStateChanged(auth, async (user) => {
        if (!user) return router.replace(loginComMotivo(`/login?next=${encodeURIComponent("/admin")}`));
        setEmail(user.email ?? "");
        const idToken = await user.getIdToken();
        setIdToken(idToken);
        // Uma viagem só: o Next despacha Server Action por vez, então pedir as
        // partes em paralelo daqui era pedir em fila. O paralelo mora no servidor.
        const r = await abrirPainel(idToken);
        if (!r.ok) return setEstado("negado");
        setEspacos(r.dados.espacos);
        setHoje(r.dados.hoje);
        setCrm(r.dados.crm);
        setAssinatura(r.dados.assinatura);
        setMinutosInativo(r.dados.minutosInativo);
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

  const avisos = useMemo(() => calcularAlertas(espacos, crm, dataDeHoje), [espacos, crm, dataDeHoje]);
  const emFoco = useMemo(() => {
    const a = avisos.find((x) => x.id === alerta);
    return a ? new Set(a.slugs) : null;
  }, [avisos, alerta]);

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
      contato: (e) => !contato || diaLocal(crm[e.slug]?.ultimoContatoEm ?? null) === dataDeHoje,
      fixados: (e) => !fixados || emDestaque(crm[e.slug], dataDeHoje),
      alerta: (e) => !emFoco || emFoco.has(e.slug),
    };
    return (e: Espaco, ...exceto: string[]) =>
      Object.entries(testes).every(([nome, teste]) => exceto.includes(nome) || teste(e));
  }, [busca, cidade, nicho, situacao, estagio, prazo, foraDoAr, contato, fixados, emFoco, dataDeHoje, crm]);

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
      // a ordem em que se falou: o mais recente primeiro; quem nunca foi contatado fica no fim
      contato: (a, b) =>
        (crm[b.slug]?.ultimoContatoEm ?? "").localeCompare(crm[a.slug]?.ultimoContatoEm ?? "") ||
        a.nome.localeCompare(b.nome, "pt-BR"),
    };
    // Fixado fica no topo de qualquer ordenação: é para isso que serve o destaque
    const destaque = (e: Espaco) => (emDestaque(crm[e.slug], dataDeHoje) ? 0 : 1);
    return [...filtrada].sort((a, b) => destaque(a) - destaque(b) || por[ordem](a, b));
  }, [espacos, passa, ordem, crm, dataDeHoje]);

  // o último negócio aberto: resposta lenta de um anterior não pode pintar a gaveta do atual
  const abertoRef = useRef("");
  async function abrir(e: Espaco) {
    abertoRef.current = e.slug;
    setAberto(e);
    setMenuNegocio(false);
    setProposta(null);
    setAcessos(null);
    setDetalhe(null);
    setAviso("");
    const t = await token();
    setEventos(null);
    const [a, d, n] = await Promise.all([listarAcessos(t, e.slug), detalhesEspaco(t, e.slug), linhaDoTempoDo(t, e.slug)]);
    if (abertoRef.current !== e.slug) return;
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
    const copiado = await navigator.clipboard.writeText(r.dados.url).then(
      () => true,
      () => false,
    );
    setConvite({ slug, url: r.dados.url, email: r.dados.email, copiado });
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

  async function gerarLinkProposta(slug: string, refazer = false) {
    const r = await linkDaProposta(await token(), slug, refazer);
    if (!r.ok) return setAviso(r.error);
    setProposta({ slug, url: r.dados.url, valeAte: r.dados.valeAte });
    setAviso(r.dados.nova ? `Proposta válida até ${diaCurto(r.dados.valeAte)}.` : "");
  }

  async function mudarLimiteStaff(slug: string, profissionais: number) {
    const r = await definirLimiteStaff(await token(), slug, profissionais);
    if (!r.ok) return setAviso(r.error);
    setAviso(`agora pode cadastrar ${r.dados} profissional(is)`);
    setEspacos((e) => e.map((x) => (x.slug === slug ? { ...x, limiteStaff: r.dados } : x)));
    setAberto((x) => (x && x.slug === slug ? { ...x, limiteStaff: r.dados } : x));
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

  const slugAberto = aberto?.slug;
  const clienteAberto = !!slugAberto && crm[slugAberto]?.estagio === "fechado";
  useEffect(() => {
    if (aba !== "cliente" || !slugAberto || !clienteAberto || !idToken) return;
    let atual = true;
    setSaude(null); // eslint-disable-line react-hooks/set-state-in-effect -- troca de negócio
    saudeDoNegocio(idToken, slugAberto, dataDeHoje).then((r) => atual && r.ok && setSaude(r.dados), () => {});
    return () => {
      atual = false;
    };
  }, [aba, slugAberto, clienteAberto, idToken, dataDeHoje]);

  /** WhatsApp aberto antes de qualquer espera: depois de um await o navegador bloqueia a aba nova. */
  function abrirAba() {
    return window.open("", "_blank");
  }

  async function lembrar(slug: string, passo: Passo) {
    const janela = abrirAba();
    const c = crm[slug] ?? VAZIO;
    const e = espacos.find((x) => x.slug === slug);
    const numero = c.donoWhatsapp ?? e?.telefone ?? null;
    const oi = `Oi${c.donoNome ? `, ${c.donoNome.split(" ")[0]}` : ""}! Aqui é da Ruphus.`;
    const painel = `https://www.ruphus.site/${slug}`;
    let texto = "";
    if (passo === "convite") {
      const r = await gerarConvite(await token(), slug);
      texto = `${oi}\n\nO acesso ao painel do ${e?.nome ?? slug} está pronto — é por ele que você cadastra serviços, quem atende e acompanha a agenda:\n${r.ok ? r.dados.url : painel}${r.ok && r.dados.email ? `\n\nO acesso abre com o e-mail ${r.dados.email}.` : ""}`;
    } else if (passo === "servicos") {
      texto = `${oi}\n\nFalta um passo para a agenda do ${e?.nome ?? slug} abrir: cadastrar os serviços, com duração e preço.\n${painel}/servicos`;
    } else if (passo === "profissionais") {
      texto = `${oi}\n\nFalta cadastrar quem atende no ${e?.nome ?? slug}, com os horários de cada um. Aí a agenda abre de verdade:\n${painel}/profissionais`;
    } else {
      texto = `${oi}\n\nA agenda do ${e?.nome ?? slug} está pronta. Coloca o link na bio do Instagram e no status do WhatsApp para os clientes marcarem:\nhttps://${slug}.ruphus.site/agendar`;
    }
    const link = numero && linkWhatsApp(numero, texto);
    if (!link) {
      janela?.close();
      return setAviso("Sem WhatsApp do dono nem telefone do site: cadastre o contato na aba Venda.");
    }
    if (janela) janela.location.href = link;
    else location.assign(link);
    enviouMensagem(slug, `Lembrete: ${passo === "convite" ? "convite" : passo === "servicos" ? "serviços" : passo === "profissionais" ? "profissionais" : "divulgar o link"}`, c.donoNome ?? "o dono");
  }

  async function fecharVenda(slug: string, d: { entradaCents: number; mensalCents: number; cobrarEntrada: boolean; boasVindas: boolean; convite: boolean }) {
    const janela = d.boasVindas ? abrirAba() : null;
    const ok = await mudarNegocio(slug, { estagio: "fechado", entradaCents: d.entradaCents, mensalCents: d.mensalCents });
    if (!ok) {
      janela?.close();
      return false;
    }
    const t = await token();
    const feito: string[] = ["venda registrada"];
    let urlConvite: string | null = null;
    if (d.convite) {
      const r = await gerarConvite(t, slug);
      // falhar calado aqui manda boas-vindas sem o acesso e ninguém percebe
      if (r.ok) urlConvite = r.dados.url;
      else feito.push(`convite não gerado: ${r.error}`);
    }
    if (d.cobrarEntrada) {
      const r = await cobrar(t, slug, "entrada", null);
      feito.push(r.ok ? "cobrança da entrada gerada (aba Cobrança)" : `entrada não gerada: ${r.error}`);
    }
    if (janela) {
      const c = { ...(crm[slug] ?? VAZIO), entradaCents: d.entradaCents, mensalCents: d.mensalCents, estagio: "fechado" as const };
      const e = espacos.find((x) => x.slug === slug);
      const numero = c.donoWhatsapp ?? e?.telefone ?? null;
      const texto = mensagem("Boas-vindas", { slug, nome: e?.nome ?? slug, telefone: e?.telefone ?? null }, c, assinatura) + (urlConvite ? `\n\nSeu acesso ao painel: ${urlConvite}` : "");
      const link = numero && linkWhatsApp(numero, texto);
      if (link) {
        janela.location.href = link;
        feito.push("boas-vindas aberta no WhatsApp");
        enviouMensagem(slug, "Boas-vindas", c.donoNome ?? "o dono");
      } else {
        janela.close();
        feito.push("sem telefone para as boas-vindas");
      }
    }
    setAviso(`Venda fechada: ${feito.join(" · ")}.`);
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
    const { convites, semEmail } = r.dados;
    // sem e-mail do dono não sai link: dizer quem ficou de fora é o que torna
    // isso resolvível, em vez de um lote que "veio menor" sem explicação
    const faltando = semEmail.length
      ? ` ${semEmail.length} sem e-mail do dono, e por isso sem link: ${semEmail.slice(0, 3).join(", ")}${semEmail.length > 3 ? "…" : ""}. Cadastre na aba Venda.`
      : "";
    if (!convites.length) return setAviso(`Nenhum convite gerado.${faltando || " Nenhum dos negócios marcados existe mais."}`);
    // uma planilha com o link pronto de cada um: é assim que 300 convites viram trabalho possível
    baixar(
      `convites-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        ["negocio", "site", "telefone", "abre_com_o_email", "link_do_convite", "abrir_whatsapp"],
        ...convites.map((c) => [c.nome, `https://${c.slug}.ruphus.site`, c.telefone ?? "", c.email, c.url, c.whatsapp ?? ""]),
      ],
    );
    const sem = convites.filter((c) => !c.whatsapp).length;
    setAviso(
      `${convites.length} convite(s) gerado(s), válidos por ${DIAS_CONVITE} dias.` +
        (sem ? ` ${sem} sem telefone: o link está na planilha para enviar por outro caminho.` : "") +
        faltando,
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

  /** A planilha dos convites em lote: é o único download que sobrou no painel. */
  function baixar(nome: string, linhas: (string | number)[][]) {
    const csv = linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = nome;
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

  const chave = [busca, cidade, nicho, situacao, ordem, estagio, prazo, String(foraDoAr), contato, String(fixados), alerta].join("|");
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
        (!v.fora || crm[e.slug]?.publicado === false) &&
        (!v.contato || diaLocal(crm[e.slug]?.ultimoContatoEm ?? null) === dataDeHoje) &&
        (!v.fixados || emDestaque(crm[e.slug], dataDeHoje)),
    ).length;
  const visaoAtiva = VISOES.find(
    (v) =>
      v.prazo === prazo &&
      v.situacao === situacao &&
      v.estagio === estagio &&
      v.fora === foraDoAr &&
      (v.contato ?? "") === contato &&
      (v.fixados ?? false) === fixados,
  );
  function verVisao(v: Visao) {
    setPrazo(v.prazo);
    setSituacao(v.situacao);
    setEstagio(v.estagio);
    setForaDoAr(v.fora);
    setContato(v.contato ?? "");
    setFixados(v.fixados ?? false);
    setAlerta("");
  }
  function limparTudo() {
    setBusca("");
    setCidade("");
    setNicho("");
    verVisao(VISOES.find((v) => v.id === "todos")!);   // por id: a ordem das visões muda
  }

  const ABA = "flex h-12 items-center gap-2 border-b-2 px-3 text-[13px] transition-colors";
  const CONTA = "rounded-full px-2 py-0.5 text-[11px] font-semibold";
  const ORDENAVEL = "flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] hover:text-[#17150F]";
  const seta = (chaveOrdem: string) => (ordem === chaveOrdem ? " ↓" : "");

  return (
    <>
      {/* Navegação, busca e ajustes. Filtro e ordem ficam com as visões, abaixo. */}
      <header aria-label="Painel" className="flex flex-wrap items-center gap-2 border-b border-[#E2DDD3] bg-white px-4 py-2.5 sm:px-5">
        <span className="mr-1 flex items-baseline gap-2 sm:border-r sm:border-[#EDE9E1] sm:pr-4">
          <h1 className="font-[family-name:var(--fonte-serifa)] text-[22px] leading-none tracking-tight">Administração</h1>
          <span className="hidden text-[11px] text-[#8B8578] sm:inline">ruphus.site</span>
        </span>

        <div role="group" aria-label="Visão" className="flex rounded-[10px] bg-[#EFEBE2] p-[3px]">
          {(["lista", "funil", "clientes", "cobranca"] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={tela === v}
              onClick={() => setTela(v)}
              className={`h-8 rounded-lg px-3 text-[12px] ${tela === v ? "bg-white font-semibold shadow-[0_1px_2px_rgba(23,21,15,.12)]" : "text-[#6F6A5E] hover:text-[#17150F]"}`}
            >
              {v === "lista" ? "Lista" : v === "funil" ? "Funil" : v === "clientes" ? "Clientes" : "Cobrança"}
              {v === "cobranca" && atrasadas > 0 && (
                <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${tela === v ? "bg-[#FBF0EE] text-[#8A2F2F]" : "bg-[#F1E7E7] text-[#8A2F2F]"}`}>
                  {atrasadas}
                </span>
              )}
            </button>
          ))}
        </div>


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

        {/* Ajuste é ajuste: o que se define uma vez mora aqui, não acima da lista */}
        <div className="relative">
          <button
            type="button"
            aria-haspopup="true"
            aria-expanded={menuAjustes}
            aria-label="Ajustes da plataforma"
            onClick={() => setMenuAjustes((v) => !v)}
            className={`relative flex size-9 items-center justify-center rounded-lg border ${menuAjustes ? "border-[#17150F] bg-[#17150F]" : "border-[#D8D2C6] bg-white hover:border-[#17150F]"}`}
          >
            <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke={menuAjustes ? "#FFFFFF" : "#17150F"} strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3.2" />
              <path d="M12 3v2.2M12 18.8V21M21 12h-2.2M5.2 12H3M18.4 5.6l-1.6 1.6M7.2 16.8l-1.6 1.6M18.4 18.4l-1.6-1.6M7.2 7.2L5.6 5.6" />
            </svg>
            {!assinatura && (
              <span aria-hidden="true" className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full border-2 border-white bg-[#B8791F]" />
            )}
          </button>

          {menuAjustes && (
            <>
              <button type="button" aria-label="Fechar ajustes" onClick={() => setMenuAjustes(false)} className="fixed inset-0 z-30 cursor-default" />
              <div
                role="dialog"
                aria-label="Ajustes da plataforma"
                className="absolute right-0 top-11 z-40 flex max-h-[80vh] w-[min(92vw,420px)] flex-col gap-4 overflow-y-auto rounded-xl border border-[#C8C1B3] bg-white p-4 shadow-[0_18px_48px_rgba(23,21,15,0.18)]"
              >
                <div className="flex items-baseline gap-2">
                  <h2 className="font-[family-name:var(--fonte-serifa)] text-[20px] leading-none">Ajustes</h2>
                  <span className="text-[11px] text-[#8B8578]">valem para toda a plataforma</span>
                </div>

                <form
                  className="flex flex-col gap-1.5"
                  onSubmit={async (ev) => {
                    ev.preventDefault();
                    const nome = new FormData(ev.currentTarget).get("assinatura");
                    const r = await definirAssinatura(await token(), nome);
                    setAviso(r.ok ? "" : r.error);
                    if (r.ok) setAssinatura(r.dados);
                  }}
                >
                  <span className="flex items-center gap-2 text-xs font-semibold text-[#4A4639]">
                    Quem assina as mensagens
                    {!assinatura && <span className="rounded-full bg-[#FBF3DC] px-2 py-0.5 text-[10px] font-semibold text-[#7A5A2E]">falta definir</span>}
                  </span>
                  <div className="flex gap-2">
                    <input
                      name="assinatura"
                      defaultValue={assinatura}
                      maxLength={40}
                      aria-label="Nome de quem fala com o cliente"
                      placeholder="seu primeiro nome"
                      className={`h-11 grow rounded-[10px] border bg-white px-3 text-sm text-[#17150F] outline-none focus:border-[#17150F] ${assinatura ? "border-[#D8D2C6]" : "border-[#B8791F]"}`}
                    />
                    <button type="submit" className={BOTAO_ESCURO}>Salvar</button>
                  </div>
                  <span className="text-[11.5px] leading-relaxed text-[#6F6A5E]">Entra em toda mensagem pronta. Sem isso, enviar e copiar ficam travados.</span>
                </form>

                <form
                  className="flex flex-col gap-1.5 border-t border-[#EDE9E1] pt-3.5"
                  onSubmit={async (ev) => {
                    ev.preventDefault();
                    const r = await definirMinutosInativo(await token(), new FormData(ev.currentTarget).get("minutos"));
                    setAviso(r.ok ? (r.dados ? `Sai sozinho depois de ${r.dados} minutos parado.` : "Logout automático desligado.") : r.error);
                    // o valor não chega mais por listener: quem salvou passa a contar pelo novo
                    if (r.ok) setMinutosInativo(r.dados);
                  }}
                >
                  <span className="text-xs font-semibold text-[#4A4639]">Sair sozinho depois de parado</span>
                  <div className="flex items-center gap-2">
                    <input
                      key={minutosInativo}
                      name="minutos"
                      type="number"
                      min={0}
                      max={MINUTOS_MAX}
                      defaultValue={minutosInativo}
                      aria-label="Minutos parado até sair"
                      className="h-11 w-24 rounded-[10px] border border-[#D8D2C6] bg-white px-3 text-sm tabular-nums text-[#17150F] outline-none focus:border-[#17150F]"
                    />
                    <span className="text-[13px] text-[#4A4639]">minutos</span>
                    <div className="grow" />
                    <button type="submit" className={BOTAO_CLARO}>Salvar</button>
                  </div>
                  <span className="text-[11.5px] leading-relaxed text-[#6F6A5E]">0 desliga. Vale para este painel e para o painel dos clientes.</span>
                </form>

                <Link href="/ajuda/vendas" className="flex h-11 items-center rounded-[10px] border border-[#D8D2C6] px-3.5 text-[13px] text-[#17150F] hover:border-[#17150F]">
                  Manual do vendedor
                </Link>

                <div className="flex items-center gap-3 border-t border-[#EDE9E1] pt-3.5">
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-[12px] text-[#4A4639]">{email}</span>
                    <span className="font-[family-name:var(--font-geist-mono)] text-[11px] text-[#8B8578]">{VERSAO} · {COMMIT}</span>
                  </span>
                  <div className="grow" />
                  <button
                    type="button"
                    className="h-11 rounded-[10px] border border-[#D8D2C6] px-3.5 text-[13px] font-semibold text-[#8A2F2F] hover:border-[#8A2F2F]"
                    onClick={() => signOut(auth).then(() => router.replace("/login"))}
                  >
                    Sair
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </header>

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

        {/* Filtro e ordem moram com as visões: são todos recortes da mesma lista */}
        <div className="flex items-center gap-2 py-1.5">
        <div className="relative">
          <button
            type="button"
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
                className="absolute right-0 top-11 z-40 flex max-h-[70vh] w-[min(92vw,420px)] flex-col gap-3.5 overflow-y-auto rounded-xl border border-[#C8C1B3] bg-white p-4 shadow-[0_18px_48px_rgba(23,21,15,0.18)]"
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

        <label htmlFor="ordem" className="text-[11px] uppercase tracking-[0.06em] text-[#6F6A5E]">Ordem</label>
        <select
          id="ordem"
          value={ordem}
          onChange={(e) => setOrdem(e.target.value)}
          className="h-9 rounded-lg border border-[#D8D2C6] bg-white px-2.5 text-[13px]"
        >
          <option value="relevancia">Mais relevantes</option>
          <option value="compromisso">Compromisso mais próximo</option>
          <option value="contato">Último contato</option>
          <option value="nota">Melhor nota</option>
          <option value="avaliacoes">Mais avaliações</option>
          <option value="nome">Nome (A–Z)</option>
        </select>
        </div>

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

      <main className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:p-5">
        {aviso && <p className="text-sm text-[#6F6A5E]">{aviso}</p>}

        {/* O que passou do ponto e ninguém viu: some da tela quando não há nada */}
        {!!avisos.length && (
          <section aria-label="Alertas" className="flex flex-col gap-2 rounded-2xl border border-[#E2DDD3] bg-white p-3.5">
            <div className="flex flex-wrap gap-2">
              {avisos.map((a) => {
                const ativo = alerta === a.id;
                return (
                  <button
                    key={a.id}
                    type="button"
                    aria-pressed={ativo}
                    onClick={() => {
                      setAlerta(ativo ? "" : a.id);
                      if (!ativo) {
                        const todos = VISOES.find((v) => v.id === "todos")!;
                        setPrazo(todos.prazo);
                        setSituacao(todos.situacao);
                        setEstagio(todos.estagio);
                        setForaDoAr(todos.fora);
                        setContato("");
                        setFixados(false);
                      }
                    }}
                    className={`flex h-11 items-center gap-2 rounded-full border px-3.5 text-[13px] font-semibold ${
                      ativo
                        ? "border-[#17150F] bg-[#17150F] text-white"
                        : `border-[#D8D2C6] bg-white hover:border-[#17150F] ${a.urgente ? "text-[#8A2F2F]" : "text-[#17150F]"}`
                    }`}
                  >
                    {a.rotulo}
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${ativo ? "bg-white/20" : a.urgente ? "bg-[#FBF0EE]" : "bg-[#F3EFE7] text-[#6F6A5E]"}`}>
                      {a.slugs.length}
                    </span>
                  </button>
                );
              })}
            </div>
            {alerta && <p className="text-xs text-[#6F6A5E]">{avisos.find((a) => a.id === alerta)?.detalhe}</p>}
          </section>
        )}

        {/* Configuração pendente vira uma linha que some ao ser resolvida, não uma caixa fixa */}
        {!assinatura && (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#E7D6B4] bg-[#FBF3DC] px-3.5 py-2.5">
            <span className="text-[13px] text-[#7A5A2E]">Ninguém assina as mensagens: elas não podem ser enviadas até alguém assinar.</span>
            <div className="grow" />
            <button
              type="button"
              onClick={() => setMenuAjustes(true)}
              className="h-9 rounded-lg bg-[#7A5A2E] px-3.5 text-[12.5px] font-semibold text-white hover:bg-[#654A26]"
            >
              Definir agora
            </button>
          </div>
        )}

        {/* Montado sempre, visível só na aba: é assim que a aba sabe quantas estão em atraso */}
        <div className={tela === "cobranca" ? "" : "hidden"}>
          <Atrasadas idToken={idToken} aviso={setAviso} cortar={(slug) => mudarNegocio(slug, { publicado: false })} aoContar={setAtrasadas} />
        </div>

        {tela === "cobranca" ? null : tela === "clientes" ? (
          <Carteira idToken={idToken} hoje={dataDeHoje} espacos={espacos} abrir={abrir} />
        ) : tela === "funil" ? (
          <Funil
            espacos={lista}
            crm={crm}
            hoje={dataDeHoje}
            abrir={abrir}
            mover={(slug, e) => (e === "perdido" ? setPerdendo(slug) : e === "fechado" ? setFechando(slug) : mudarNegocio(slug, { estagio: e }))}
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
                      <p className="flex items-center gap-1.5 truncate text-[14px] font-semibold">
                        {emDestaque(crm[e.slug], dataDeHoje) && (
                          <span title="Em destaque" aria-label="Em destaque" className="shrink-0 text-[#7A5A2E]">
                            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
                              <path d="M12 3l2.6 5.6 6.1.8-4.5 4.2 1.2 6L12 16.8 6.6 19.6l1.2-6L3.3 9.4l6.1-.8z" />
                            </svg>
                          </span>
                        )}
                        <span className="truncate">{e.nome}</span>
                      </p>
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

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-[#E2DDD3] pt-4 text-[11px] text-[#6F6A5E]">
          <span>© {new Date().getFullYear()} Ruphus. Todos os direitos reservados.</span>
          <span className="font-[family-name:var(--font-geist-mono)] tabular-nums">
            {VERSAO} · {COMMIT}
          </span>
        </footer>
      </main>

      {aberto && (
        <>
          <button type="button" aria-label="Fechar painel" onClick={() => setAberto(null)} className="fixed inset-0 z-40 bg-[#17150F]/25" />
          <aside
            aria-label={aberto.nome}
            className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[520px] flex-col gap-5 overflow-y-auto border-l border-[#E2DDD3] bg-white p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:p-8"
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
              <div className="relative shrink-0">
                <button
                  type="button"
                  aria-haspopup="true"
                  aria-expanded={menuNegocio}
                  aria-label="Mais ações deste negócio"
                  onClick={() => setMenuNegocio((v) => !v)}
                  className={`${BOTAO_CLARO} size-11 px-0`}
                >
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                    <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
                  </svg>
                </button>
                {menuNegocio && (
                  <>
                    <button type="button" aria-label="Fechar o menu" onClick={() => setMenuNegocio(false)} className="fixed inset-0 z-30 cursor-default" />
                    <div role="menu" aria-label="Ações do negócio" className="absolute right-0 top-12 z-40 flex w-[min(88vw,300px)] flex-col gap-1 rounded-xl border border-[#C8C1B3] bg-white p-2 shadow-[0_18px_48px_rgba(23,21,15,0.18)]">
                      <a role="menuitem" className={ITEM_MENU} href={`/${aberto.slug}`}>Painel do negócio</a>
                      <a role="menuitem" className={ITEM_MENU} href={`https://${aberto.slug}.ruphus.site/`} target="_blank" rel="noreferrer">Ver o site ↗</a>
                      <a role="menuitem" className={ITEM_MENU} href={`https://${aberto.slug}.ruphus.site/agendar`} target="_blank" rel="noreferrer">Agendamento ↗</a>
                      <span className="my-1 h-px bg-[#EDE9E1]" />
                      {/* Ação rara e perigosa: longe dos campos do dia */}
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          mudarNegocio(aberto.slug, { publicado: !(crm[aberto.slug]?.publicado !== false) });
                          setMenuNegocio(false);
                        }}
                        className={`${ITEM_MENU} ${crm[aberto.slug]?.publicado === false ? "text-[#2C6A53]" : "text-[#8A2F2F]"}`}
                      >
                        {crm[aberto.slug]?.publicado === false ? "Colocar o site no ar" : "Tirar o site do ar"}
                      </button>
                      <span className="px-2 pb-1 text-[11px] leading-snug text-[#6F6A5E]">
                        {crm[aberto.slug]?.publicado === false
                          ? "O endereço está fora do ar para os clientes."
                          : "Tirar do ar faz o endereço parar de responder. O negócio continua aqui."}
                      </span>
                    </div>
                  </>
                )}
              </div>
              <button type="button" aria-label="Fechar" onClick={() => setAberto(null)} className={`${BOTAO_CLARO} size-11 shrink-0 px-0`}>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            {/* A gaveta tem o que o vendedor usa todo dia em "Venda"; o resto fica a um toque */}
            <div role="tablist" aria-label="Seções do negócio" className="sticky top-0 z-10 -mx-6 -mt-2 flex gap-1 overflow-x-auto border-b border-[#E2DDD3] bg-white px-6 [scrollbar-width:none] sm:-mx-8 sm:px-8 [&::-webkit-scrollbar]:hidden">
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
            {/* Primeiro o combinado: é ele que governa "Atrasados", "Para hoje"
                e o alerta de negócio sem próximo passo. Era o último campo de
                um formulário longo. */}
            <section aria-label="O combinado" className="flex flex-col gap-2.5 rounded-2xl border border-[#C9DACF] bg-[#F4F8F6] p-4">
              <div className="flex items-center gap-2">
                <h3 className="text-[11px] font-semibold tracking-[0.07em] text-[#2C6A53] uppercase">O combinado</h3>
                <div className="grow" />
                {(() => {
                  const p = prazoDe(crm[aberto.slug], dataDeHoje);
                  const dia = crm[aberto.slug]?.proximaData;
                  if (!p || !dia) return <span className="text-[11.5px] text-[#6F6A5E]">nada combinado ainda</span>;
                  const estilo =
                    p === "atrasada" ? "bg-[#F1E7E7] text-[#8A2F2F]" : p === "hoje" ? "bg-[#FBF3DC] text-[#7A5A2E]" : "bg-[#E3EFE8] text-[#1F4C3B]";
                  return (
                    <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${estilo}`}>
                      {p === "atrasada" ? `atrasada desde ${diaCurto(dia)}` : p === "hoje" ? "para hoje" : `para ${diaCurto(dia)}`}
                    </span>
                  );
                })()}
              </div>
              {/* No celular a data desce: lado a lado sobram 140px para "o que fazer" */}
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  key={`acao-${aberto.slug}`}
                  type="text"
                  maxLength={120}
                  aria-label="O que fazer"
                  placeholder="ligar, mandar proposta, cobrar retorno…"
                  defaultValue={crm[aberto.slug]?.proximaAcao ?? ""}
                  onBlur={(ev) => mudarNegocio(aberto.slug, { proximaAcao: ev.target.value.trim() || null })}
                  className="h-11 min-w-0 grow rounded-[10px] border border-[#C9DACF] bg-white px-3 text-sm text-[#17150F] outline-none focus:border-[#2C6A53]"
                />
                <input
                  key={`quando-${aberto.slug}`}
                  type="date"
                  aria-label="Quando"
                  defaultValue={crm[aberto.slug]?.proximaData ?? ""}
                  onChange={(ev) => mudarNegocio(aberto.slug, { proximaData: ev.target.value || null })}
                  className="h-11 w-full shrink-0 rounded-[10px] border border-[#C9DACF] bg-white px-3 text-sm text-[#17150F] outline-none focus:border-[#2C6A53] sm:w-[150px]"
                />
              </div>
            </section>

            {/* Etapa numa linha: progresso à esquerda, desfecho à direita. São
                coisas diferentes — fechar e perder perguntam antes de gravar. */}
            <section aria-label="Etapa" className="flex flex-col gap-3 rounded-2xl border border-[#E2DDD3] p-4">
              <div className="flex items-center gap-2">
                <h3 className="text-[11px] font-semibold tracking-[0.07em] text-[#6F6A5E] uppercase">Etapa</h3>
                <div className="grow" />
                <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${COR[crm[aberto.slug]?.estagio ?? "novo"]}`}>
                  {ROTULO[crm[aberto.slug]?.estagio ?? "novo"]}
                </span>
              </div>

              <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center">
                <div className="flex grow overflow-hidden rounded-full border border-[#D8D2C6]">
                  {ETAPAS.map((e, i) => {
                    const ativa = (crm[aberto.slug]?.estagio ?? "novo") === e;
                    return (
                      <button
                        key={e}
                        type="button"
                        aria-pressed={ativa}
                        onClick={() => mudarNegocio(aberto.slug, { estagio: e })}
                        className={`h-11 grow px-3 text-[12.5px] transition-colors ${i ? "border-l border-[#D8D2C6]" : ""} ${
                          ativa ? "bg-[#17150F] font-semibold text-white" : "bg-white text-[#4A4639] hover:text-[#17150F]"
                        }`}
                      >
                        {ROTULO[e]}
                      </button>
                    );
                  })}
                </div>
                <span aria-hidden="true" className="hidden h-6 w-px bg-[#E2DDD3] sm:block" />
                <div className="flex gap-2">
                  {DESFECHOS.map((e) => {
                    const ativa = (crm[aberto.slug]?.estagio ?? "novo") === e;
                    const cor = e === "fechado" ? "border-[#2C6A53] text-[#2C6A53] hover:bg-[#EEF2F0]" : "border-[#D8D2C6] text-[#8A2F2F] hover:border-[#8A2F2F]";
                    return (
                      <button
                        key={e}
                        type="button"
                        aria-pressed={ativa}
                        onClick={() => (ativa ? undefined : e === "perdido" ? setPerdendo(aberto.slug) : setFechando(aberto.slug))}
                        className={`h-11 grow rounded-full border px-4 text-[12.5px] font-semibold sm:grow-0 ${ativa ? `border-transparent ${COR[e]}` : `bg-white ${cor}`}`}
                      >
                        {e === "fechado" ? "Fechou" : "Perdeu"}
                      </button>
                    );
                  })}
                </div>
              </div>
              <span className="text-[11.5px] text-[#6F6A5E]">Fechar ou perder abre uma pergunta antes de gravar.</span>
            </section>

            <ContatoDono
              key={`contato-${aberto.slug}`}
              negocio={aberto}
              crm={crm[aberto.slug] ?? VAZIO}
              salvar={(dados) => mudarNegocio(aberto.slug, dados)}
            />
            {/* Consulta, não trabalho do dia: ficam a um clique */}
            <details key={`atributos-${aberto.slug}`} className="rounded-2xl border border-[#E2DDD3] px-4 py-3">
              <summary className="cursor-pointer text-[12.5px] text-[#4A4639]">
                Como chegou · {ORIGENS[crm[aberto.slug]?.origem ?? "importado"]}
                {" · "}
                Destaque · {emDestaque(crm[aberto.slug], dataDeHoje) ? `até ${diaCurto(crm[aberto.slug]!.fixadoAte!)}` : "fora"}
              </summary>
              <div className="mt-3 flex flex-col gap-3">
                <OrigemDoContato key={`origem-${aberto.slug}`} crm={crm[aberto.slug] ?? VAZIO} salvar={(dados) => mudarNegocio(aberto.slug, dados)} />
                <Destaque key={`destaque-${aberto.slug}`} crm={crm[aberto.slug] ?? VAZIO} hoje={dataDeHoje} salvar={(dados) => mudarNegocio(aberto.slug, dados)} />
              </div>
            </details>

            <MensagensProntas
              key={`msg-${aberto.slug}`}
              negocio={aberto}
              crm={crm[aberto.slug] ?? VAZIO}
              assinatura={assinatura}
              onEnviar={(modelo, para) => enviouMensagem(aberto.slug, modelo, para)}
              onCopiar={(texto) => copiar(texto, "mensagem")}
              onPronto={setPronto}
            />

            {/* Preço só importa ao propor e ao fechar: fica a um clique */}
            <details key={`precos-${aberto.slug}`} className="rounded-2xl border border-[#E2DDD3] px-4 py-3">
              <summary className="cursor-pointer text-[12.5px] text-[#4A4639]">
                Proposta · {formatBRL(crm[aberto.slug]?.entradaCents ?? PRECO_PADRAO.entradaCents)} de entrada + {formatBRL(crm[aberto.slug]?.mensalCents ?? PRECO_PADRAO.mensalCents)}/mês
              </summary>
              <div className="mt-3 flex flex-col gap-3">
                {/* O link é a proposta: o dono abre no celular, lê e fecha pelo
                    botão. Vale 7 dias, e o mesmo link serve para os dois canais. */}
                <div className="flex flex-col gap-2 rounded-xl border border-[#E2DDD3] bg-[#FBFAF8] p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-[#4A4639]">Proposta para mandar</span>
                    <div className="grow" />
                    {proposta?.slug === aberto.slug && (
                      <span className="text-[11px] text-[#6F6A5E]">vale até {diaCurto(proposta.valeAte)}</span>
                    )}
                  </div>

                  {proposta?.slug === aberto.slug ? (
                    <>
                      <p className="truncate rounded-[10px] border border-[#E2DDD3] bg-white px-3 py-2 font-[family-name:var(--font-geist-mono)] text-[11.5px] text-[#4A4639]">
                        {proposta.url}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className={MENOR} onClick={() => copiar(proposta.url, "proposta")}>
                          {copiado === "proposta" ? "Copiado ✓" : "Copiar link"}
                        </button>
                        {(() => {
                          const c = crm[aberto.slug];
                          const numero = c?.donoWhatsapp ?? aberto.telefone;
                          const texto =
                            `Oi${c?.donoNome ? `, ${c.donoNome.split(" ")[0]}` : ""}! Aqui é o ${assinatura || "pessoal"}, da Ruphus.\n\n` +
                            `Montei a proposta do ${aberto.nome} numa página só, dá para ler no celular em um minuto: ${proposta.url}\n\n` +
                            `Qualquer dúvida me chama por aqui.`;
                          const zap = numero ? linkWhatsApp(numero, texto) : null;
                          return zap ? (
                            <a className={MENOR} href={zap} target="_blank" rel="noreferrer" onClick={() => enviouMensagem(aberto.slug, "Proposta", c?.donoNome ?? "o dono")}>
                              Enviar no WhatsApp
                            </a>
                          ) : (
                            <span className={`${MENOR} border-dashed text-[#8B8578]`}>Sem WhatsApp do dono</span>
                          );
                        })()}
                        {(() => {
                          const c = crm[aberto.slug];
                          const assunto = `Proposta da Ruphus para ${aberto.nome}`;
                          const corpo =
                            `Oi${c?.donoNome ? `, ${c.donoNome.split(" ")[0]}` : ""}!\n\n` +
                            `Montei a proposta do ${aberto.nome} numa página só, com o que está incluído e os valores:\n${proposta.url}\n\n` +
                            `Ela vale até ${diaCurto(proposta.valeAte)}. Qualquer dúvida, é só responder este e-mail.\n\n` +
                            `${assinatura || ""}\nRuphus`;
                          return (
                            <a
                              className={MENOR}
                              href={`mailto:${c?.donoEmail ?? ""}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`}
                              onClick={() => enviouMensagem(aberto.slug, "Proposta por e-mail", c?.donoEmail ?? "o dono")}
                            >
                              {crm[aberto.slug]?.donoEmail ? "Enviar por e-mail" : "Abrir e-mail"}
                            </a>
                          );
                        })()}
                        <a className={MENOR} href={proposta.url} target="_blank" rel="noreferrer">Ver como o dono vê</a>
                        {/* O PDF é a mesma proposta impressa: abre a caixa de
                            impressão para salvar o arquivo e anexar no e-mail
                            ou no WhatsApp de quem prefere anexo a link. */}
                        <a className={MENOR} href={`${proposta.url}&pdf=1`} target="_blank" rel="noreferrer">Baixar PDF</a>
                        <button type="button" className={MENOR} onClick={() => gerarLinkProposta(aberto.slug, true)}>
                          Refazer
                        </button>
                      </div>
                      <span className="text-[11px] leading-relaxed text-[#6F6A5E]">
                        Refazer invalida o link anterior. Os valores vêm daqui de cima: mude antes de mandar.
                      </span>
                    </>
                  ) : (
                    <button type="button" className={`${BOTAO_ESCURO} self-start`} onClick={() => gerarLinkProposta(aberto.slug)}>
                      Gerar link da proposta
                    </button>
                  )}
                </div>

              {/* Nasce no preco padrao: com 675 negocios, digitar o mesmo
                  numero 675 vezes e o que faz alguem parar de preencher. */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                        type="text"
                        inputMode="decimal"
                        defaultValue={emReais(crm[aberto.slug]?.[c.campo] ?? c.padrao)}
                        onBlur={(ev) => {
                          const valor = cents(ev.target.value);
                          // texto que não é número não apaga o preço: volta o que estava
                          if (ev.target.value.trim() && (Number.isNaN(valor) || valor < 0)) {
                            ev.target.value = emReais(crm[aberto.slug]?.[c.campo] ?? c.padrao);
                            return setAviso("Valor inválido. Use 59,90.");
                          }
                          const novo = ev.target.value.trim() ? valor : null;
                          ev.target.value = novo === null ? "" : emReais(novo);
                          mudarNegocio(aberto.slug, { [c.campo]: novo });
                        }}
                        className="h-full min-w-0 grow bg-transparent text-sm tabular-nums text-[#17150F] outline-none"
                      />
                      {c.sufixo && <span className="pr-3 text-xs text-[#8B8578]">{c.sufixo}</span>}
                    </span>
                  </label>
                ))}
              </div>
              </div>
            </details>

            <details key={`obj-${aberto.slug}`} className="rounded-2xl border border-[#E2DDD3] px-4 py-3">
              <summary className="cursor-pointer text-[12.5px] text-[#4A4639]">Se ele responder isso · 5 respostas prontas</summary>
              <div className="mt-3">
                <Objecoes onCopiar={(texto) => copiar(texto, "resposta")} />
              </div>
            </details>

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
            {clienteAberto && <ImplantacaoESaude saude={saude} lembrar={(p) => lembrar(aberto.slug, p)} />}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
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
                O link é de uma conta só: abre com o e-mail do dono e torna essa conta administradora do negócio. Vale {DIAS_CONVITE} dias.
              </p>
              {convite?.slug === aberto.slug ? (
                <div className="flex flex-col gap-2">
                  <code className="truncate rounded-lg border border-[#E2DDD3] bg-white px-3 py-2.5 text-xs text-[#4A4639]">
                    {convite.url}
                  </code>
                  <span className="text-[12px] text-[#2C6A53]">Só abre com o e-mail {convite.email}.</span>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" className={BOTAO_ESCURO} onClick={copiarConvite}>
                      {convite.copiado ? "Copiado ✓" : "Copiar link"}
                    </button>
                    {detalhe?.telefone && (
                      <a
                        className={`${BOTAO} border border-[#2C6A53] bg-white text-[#2C6A53] hover:bg-[#EEF2F0]`}
                        href={linkWhatsApp(detalhe.telefone, `Olá! Este é o acesso ao painel do ${aberto.nome}: ${convite.url}`) ?? "#"}
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
              ) : crm[aberto.slug]?.donoEmail ? (
                <button type="button" className={`${BOTAO_ESCURO} self-start`} onClick={() => convidar(aberto.slug)}>
                  Convidar {crm[aberto.slug]?.donoEmail}
                </button>
              ) : (
                // Barrar aqui, e não na mensagem de erro depois do clique: o que
                // falta é um dado de uma aba ao lado, e o vendedor resolve em 10s
                <span className="text-[13px] leading-relaxed text-[#B8791F]">
                  Cadastre o e-mail do dono na aba <b>Venda</b> para convidar. É ele que tranca o link nessa conta — sem isso, quem receber o link repassado entra no lugar dele.
                </span>
              )}
            </section>

            {/* O plano inclui 5 profissionais; daqui o admin libera mais para este negócio */}
            <section aria-label="Limite de profissionais" className="flex items-center justify-between gap-3 rounded-2xl border border-[#E2DDD3] p-4">
              <span className="text-xs text-[#6F6A5E]">
                Profissionais no plano: <b className="font-semibold text-[#17150F]">{aberto.limiteStaff}</b>
              </span>
              <span className="flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Diminuir o limite de profissionais"
                  disabled={aberto.limiteStaff <= 1}
                  onClick={() => mudarLimiteStaff(aberto.slug, aberto.limiteStaff - 1)}
                  className="size-11 rounded-[10px] border border-[#D8D2C6] text-base font-semibold hover:border-[#17150F] disabled:opacity-40"
                >
                  −
                </button>
                <button
                  type="button"
                  aria-label="Liberar mais um profissional"
                  disabled={aberto.limiteStaff >= LIMITE_STAFF_MAX}
                  onClick={() => mudarLimiteStaff(aberto.slug, aberto.limiteStaff + 1)}
                  className="size-11 rounded-[10px] border border-[#D8D2C6] text-base font-semibold hover:border-[#17150F] disabled:opacity-40"
                >
                  +
                </button>
              </span>
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
                          {/* Token roubado vale até expirar: isto o recusa antes disso */}
                          <button
                            type="button"
                            onClick={async () => {
                              const r = await encerrarSessoes(await token(), a.uid);
                              setAviso(r.ok ? "Sessões encerradas: a pessoa entra de novo na próxima ação." : r.error);
                            }}
                            aria-label={`Encerrar as sessões de ${a.nome ?? a.email ?? a.uid}`}
                            className="h-11 shrink-0 rounded-[10px] border border-[#D8D2C6] px-3.5 text-[13px] hover:border-[#17150F]"
                          >
                            Encerrar sessões
                          </button>
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
                            disabled={a.limite >= 50}
                            onClick={() => mudarLimite(a.uid, a.limite! + 1)}
                            className="size-11 rounded-[10px] border border-[#D8D2C6] text-base font-semibold hover:border-[#17150F] disabled:opacity-40"
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
                  href={
                    linkWhatsApp(
                      detalhe.telefone,
                      `Olá! Fizemos o site do ${aberto.nome}: https://${aberto.slug}.ruphus.site/\n\n` +
                        `Para o link da bio no Instagram: https://${aberto.slug}.ruphus.site/bio\n` +
                        `E os clientes já podem agendar online: https://${aberto.slug}.ruphus.site/agendar`,
                    ) ?? "#"
                  }
                  target="_blank"
                  rel="noreferrer"
                >
                  Enviar tudo pelo WhatsApp
                </a>
              )}
            </section>

            <section aria-label="Atalhos" className="flex flex-col gap-2.5">
              <h3 className="text-[15px] font-semibold">Atalhos</h3>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
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
                  <a className={`${BOTAO_CLARO} justify-start`} href={linkWhatsApp(detalhe.telefone, `Olá! Aqui é da Ruphus.`) ?? "#"} target="_blank" rel="noreferrer">
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

            {/* Fixa no rodapé: mandar e anotar são o dia inteiro, e estavam
                a uma rolagem de distância dentro de blocos diferentes. */}
            <div className="sticky bottom-0 -mx-6 -mb-6 flex gap-2 border-t border-[#E2DDD3] bg-white px-6 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:-mx-8 sm:-mb-8 sm:px-8">
              {pronto?.link ? (
                <a
                  href={pronto.link}
                  target="_blank"
                  rel="noreferrer"
                  onClick={() => enviouMensagem(aberto.slug, pronto.modelo, pronto.para)}
                  className={`${BOTAO_VERDE} grow`}
                >
                  Abrir no WhatsApp · {pronto.modelo}
                </a>
              ) : (
                <span className={`${BOTAO} grow border border-dashed border-[#D8D2C6] text-[#8B8578]`}>
                  {assinatura ? "Cadastre o WhatsApp do dono" : "Defina quem assina, nos ajustes"}
                </span>
              )}
              <button type="button" onClick={() => setAba("historico")} className={BOTAO_CLARO}>
                Anotar
              </button>
            </div>
          </aside>
        </>
      )}

      {fechando && (
        <VendaFechada
          nome={espacos.find((e) => e.slug === fechando)?.nome ?? fechando}
          crm={crm[fechando] ?? VAZIO}
          precisaConvite={(espacos.find((e) => e.slug === fechando)?.acessos ?? 0) <= 1}
          onCancelar={() => setFechando(null)}
          onConfirmar={async (d) => {
            if (await fecharVenda(fechando, d)) setFechando(null);
          }}
        />
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
