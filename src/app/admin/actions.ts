"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { adminDb } from "@/lib/admin";
import { adminAction, ErroPrevisto } from "@/lib/admin-guard";
import { cotaDe, definirLimite, Google, lerSiteDoNegocio, previaDoSite, salvarNegocio as salvarSite } from "@/lib/negocios.server";
import { DIAS_CONVITE, LIMITE_STAFF_MAX, limiteStaffDe, MINUTOS_MAX } from "@/lib/limites";
import { dadosDoEnvio, destinatarioDoEnvio, gerarProposta } from "@/lib/proposta.server";
import { enviarEmail } from "@/lib/email.server";
import { emailDaProposta } from "@/lib/proposta-email";
import { emailDoConvite } from "@/lib/convite-email";
import { saudeDe } from "@/lib/saude.server";
import { criarConvite } from "@/lib/convite";
import {
  atrasadas,
  baixar,
  cancelar,
  type Cobranca,
  gerarCobranca,
  listarCobrancas,
  pixCadastrado,
  salvarPix,
} from "@/lib/cobranca";
import { anotar, CrmInput, lerCrm, linhaDoTempo, listarNotas, registrarMensagem, salvarCrm } from "@/lib/crm";
import { diaCurto, hojeISO, mensalidadeDe } from "@/lib/crm-tipos";
import { formatBRL, linkWhatsApp } from "@/lib/datetime";
import { competenciaAtual } from "@/lib/pix";
import { gerarNoBanco, lerSite, publicarSite } from "@/lib/gerador.server";
import { PAGINAS_DEMO } from "@/lib/demo";
import { acessoDemo, contas, restaurarDemo } from "@/lib/demo.server";
import { createInstance, getQr, getStatus, logout, type QrWhatsApp } from "@/lib/wtsfy";
import { apagarConexao, gravarConexao, gravarGestaoDono, gravarOwnerPhone, lerConexao, type ConexaoWhatsapp } from "@/lib/whatsapp.server";
import { soDigitosComDDI } from "@/lib/telefone";
import { MODELOS, modeloDoId, renderEditorial, visualEditorial } from "@/lib/site-editorial";
import { ehClaro, renderClaro } from "@/lib/site-claro";
import type { Escolha, Sub } from "@/lib/gerador";
import { FieldValue } from "firebase-admin/firestore";

export type { ConexaoWhatsapp, QrWhatsApp };

export type Espaco = {
  slug: string;
  nome: string;
  telefone: string | null;
  nicho: string;          // rótulo em português, já agrupado
  cidade: string | null;
  uf: string | null;
  nota: number | null;    // estrelas no Google
  avaliacoes: number | null;
  acessos: number;        // quantas pessoas entram no painel deste espaço
  limiteStaff: number;    // profissionais que o negócio pode cadastrar
  caixa: boolean;         // módulo Caixa (financeiro) ligado para este cliente
};

// os tipos do schema.org viram nichos que a gente reconhece (e junta variações)
const NICHOS: Record<string, string> = {
  petstore: "Pet shop",
  veterinarycare: "Veterinária",
  beautysalon: "Estética e beleza",
  healthandbeautybusiness: "Estética e beleza",
  hairsalon: "Cabeleireiro",
  barbershop: "Barbearia",
  nailsalon: "Unhas",
  dayspa: "Spa e massagem",
  tattooparlor: "Tatuagem",
  medicalclinic: "Saúde",
  dentist: "Odontologia",
  physician: "Saúde",
  healthclub: "Fitness",
  podiatric: "Podologia",
  // os do gerador de sites
  physiotherapy: "Fisioterapia",
  medicalbusiness: "Saúde",
  educationalorganization: "Aulas e cursos",
  drivingschool: "Autoescola",
  exercisegym: "Fitness",
  sportsactivitylocation: "Fitness",
  autorepair: "Automotivo",
  autowash: "Automotivo",
  tireshop: "Automotivo",
};
const nicho = (tipo: unknown) => NICHOS[String(tipo ?? "").toLowerCase()] ?? "Outros";

/** Se quem entrou administra a plataforma.
 *
 * config/admin não é legível pelo cliente — nenhuma regra abre essa coleção —,
 * então quem responde é o servidor. O login usa isto para mandar o admin ao
 * painel da plataforma em vez da casa de um negócio.
 */
export const ehAdminDaPlataforma = adminAction(async () => true);

// Só o que a lista mostra. O documento inteiro do tenant traz endereço, foto,
// cor e url: 271 KB para 677 negócios, quando o painel usa dez campos curtos.
const CAMPOS_DA_LISTA = ["name", "site.phone", "site.category", "site.city", "site.uf", "site.rating", "site.reviews", "limiteStaff", "modulos.financeiro"] as const;

/** Lista os espaços com quantas pessoas têm acesso a cada um. */
async function espacosComAcessos() {
  const [tenants, membros] = await Promise.all([
    adminDb.collection("tenants").select(...CAMPOS_DA_LISTA).get(),
    adminDb.collectionGroup("members").select("role").get(),
  ]);
  // conta só quem gere (Ruphus e cliente): a equipe do cliente não diz que ele entrou
  const porEspaco = new Map<string, number>();
  for (const m of membros.docs) {
    if (m.get("role") === "member") continue;
    const espaco = m.ref.parent.parent;
    if (espaco?.parent.id === "tenants") porEspaco.set(espaco.id, (porEspaco.get(espaco.id) ?? 0) + 1);
  }
  return tenants.docs
    .map((d): Espaco => ({
      slug: d.id,
      nome: String(d.get("name") ?? d.id),
      telefone: d.get("site.phone") ?? null,
      nicho: nicho(d.get("site.category")),
      cidade: d.get("site.city") ?? null,
      uf: d.get("site.uf") ?? null,
      nota: d.get("site.rating") ?? null,
      avaliacoes: d.get("site.reviews") ?? null,
      acessos: porEspaco.get(d.id) ?? 0,
      limiteStaff: limiteStaffDe(d.get("limiteStaff") as number | undefined),
      caixa: d.get("modulos.financeiro") === true,
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

// O slug vem da tela e vira caminho de documento: sem conferir, um "a/b/c"
// escreveria fora do lugar previsto.
const SLUG = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
// uid do Firebase Auth: vira caminho de documento, então nada de "/" nem ".."
const UID = /^[A-Za-z0-9_-]{1,128}$/;
/** O slug vem do navegador e vira caminho no banco: "a/b/c" escreveria em outra coleção */
function slugValido(slug: string) {
  if (!SLUG.test(slug)) throw new ErroPrevisto("Negócio inválido.");
}
// Teto do lote: acima disso a espera fica longa e a planilha, grande demais
// para alguém trabalhar numa sentada.
const TETO = 300;

const limpar = (slugs: string[]) => [...new Set(slugs)].filter((s) => SLUG.test(s)).slice(0, TETO);

export type ConviteEmLote = {
  slug: string;
  nome: string;
  telefone: string | null;
  url: string;
  whatsapp: string | null;
  /** a conta a que este link está preso: sem ela o convite não existe */
  email: string;
};

// Um só lugar monta o convite. O botão da linha e o lote são a mesma coisa com
// cardinalidade diferente: antes cada um construía a URL e o fallback de SITE_URL
// por conta, e dava para um mudar sem o outro.
async function convitesPara(slugs: string[]): Promise<{ convites: ConviteEmLote[]; semEmail: string[] }> {
  const alvos = limpar(slugs);
  if (!alvos.length) return { convites: [], semEmail: [] };
  const base = process.env.SITE_URL ?? "https://www.ruphus.site";
  // O e-mail do dono mora no CRM, não no tenant: é ele que prende o convite a
  // uma conta. Sem ele não há link — o negócio volta em semEmail.
  const [docs, crms] = await Promise.all([
    adminDb.getAll(...alvos.map((s) => adminDb.collection("tenants").doc(s))),
    adminDb.getAll(...alvos.map((s) => adminDb.collection("crm").doc(s))),
  ]);
  const donoEmail = new Map(crms.map((d) => [d.id, ((d.get("donoEmail") as string | null) || null)]));
  const donoWhatsapp = new Map(crms.map((d) => [d.id, ((d.get("donoWhatsapp") as string | null) || null)]));
  const fora: ConviteEmLote[] = [];
  // sem e-mail não sai convite: o destinatário é parte do link, não um extra
  const semEmail: string[] = [];
  for (const d of docs) {
    if (!d.exists) continue;
    const nome = String(d.get("name") ?? d.id);
    const email = donoEmail.get(d.id) ?? null;
    if (!email) {
      semEmail.push(nome);
      continue;
    }
    const url = `${base}/convite?c=${await criarConvite(adminDb, d.id, email)}`;
    // o convite é do dono: a recepção só recebe quando o WhatsApp dele não foi cadastrado
    const telefone = donoWhatsapp.get(d.id) ?? (d.get("site.phone") as string | null) ?? null;
    const texto = `Olá! Aqui é da Ruphus. O site do ${nome} já está no ar em https://${d.id}.ruphus.site — e a agenda online também.\n\nEste link dá acesso ao painel para você cadastrar serviços, equipe e horários: ${url}\n\nO acesso abre com o e-mail ${email} — é só entrar ou criar a conta com ele.\n\nO link vale ${DIAS_CONVITE} dias.`;
    fora.push({ slug: d.id, nome, telefone, url, whatsapp: linkWhatsApp(telefone, texto), email });
  }
  return { convites: fora, semEmail };
}

/** Um convite para cada negócio marcado, com a mensagem pronta para enviar. */
export const gerarConvites = adminAction(async (_user, slugs: string[]) => convitesPara(slugs));

/** Move vários negócios de estágio de uma vez, sem abrir um a um. */
export const marcarEstagio = adminAction(async (user, slugs: string[], estagio: string) => {
  // fechado e perdido são desfechos: o lote não os desfaz (sair de "fechado" tira o
  // negócio da cobrança do mês). Mudar um desfecho é pela gaveta, um a um.
  const pedidos = limpar(slugs);
  if (!pedidos.length) return 0;
  const crms = await adminDb.getAll(...pedidos.map((s) => adminDb.collection("crm").doc(s)));
  const alvos = crms.filter((d) => !["fechado", "perdido"].includes(d.get("estagio"))).map((d) => d.id);
  for (const slug of alvos) await salvarCrm(adminDb, slug, { estagio: estagio as CrmInput["estagio"] }, user.email ?? user.uid);
  return alvos.length;
});

/** Link de convite: só a conta do dono abre, e entrar por ele torna essa conta
 *  admin do espaço. Sem e-mail cadastrado não sai link nenhum. */
export const gerarConvite = adminAction(async (_user, slug: string) => {
  const { convites, semEmail } = await convitesPara([slug]);
  if (semEmail.length) throw new ErroPrevisto("Cadastre o e-mail do dono na aba Venda antes de convidar: é ele que tranca o link nessa conta.");
  const [convite] = convites;
  if (!convite) throw new Error(`espaço ${slug} não existe`);
  return { url: convite.url, email: convite.email };
});

// plataforma: a conta da Ruphus; viaConvite: o cliente que entrou pelo convite (pode ser dono)
export type Acesso = { uid: string; papel: string; plataforma: boolean; viaConvite: boolean; desde: string | null; nome: string | null; email: string | null; limite: number | null; usados: number };

export const listarAcessos = adminAction(async (_user, slug: string) => {
  slugValido(slug);
  const [snap, config] = await Promise.all([adminDb.collection(`tenants/${slug}/members`).get(), adminDb.doc("config/admin").get()]);
  const daPlataforma = new Set((config.get("uids") as string[] | undefined) ?? []);
  // A cota de cada pessoa: é por aqui que o admin libera mais negócios para um cliente
  const cotas = await Promise.all(snap.docs.map((d) => cotaDe(adminDb, d.id)));
  return snap.docs.map((d, i): Acesso => ({
    uid: d.id,
    papel: String(d.get("role") ?? "member"),
    plataforma: daPlataforma.has(d.id),
    viaConvite: d.get("viaConvite") === true,
    desde: d.get("createdAt")?.toDate?.().toISOString() ?? null,
    nome: (d.get("nome") as string | undefined) ?? null,
    email: (d.get("email") as string | undefined) ?? null,
    ...cotas[i],
  }));
});

/** Libera (ou reduz) quantos negócios a conta pode ter. */
export const liberarNegocios = adminAction(async (_user, uid: string, negocios: number) => {
  if (!UID.test(uid)) throw new ErroPrevisto("Conta inválida.");
  return definirLimite(adminDb, uid, negocios);
});

/** Quantos profissionais este negócio pode cadastrar. Só o admin da plataforma muda. */
export const definirLimiteStaff = adminAction(async (_user, slug: string, profissionais: number) => {
  slugValido(slug);
  if (!Number.isInteger(profissionais) || profissionais < 1 || profissionais > LIMITE_STAFF_MAX) {
    throw new ErroPrevisto(`O limite vai de 1 a ${LIMITE_STAFF_MAX} profissionais.`);
  }
  await adminDb.doc(`tenants/${slug}`).set({ limiteStaff: profissionais }, { merge: true });
  return profissionais;
});

/** Liga ou desliga o Caixa (financeiro) de um negócio. Desligar só esconde: os lançamentos ficam. */
export const definirCaixa = adminAction(async (_user, slug: string, ligado: boolean) => {
  slugValido(slug);
  const t = adminDb.doc(`tenants/${slug}`);
  if (!(await t.get()).exists) throw new ErroPrevisto("Negócio não encontrado.");
  await t.update({ "modulos.financeiro": ligado === true });
  return ligado === true;
});

/** Encerra as sessões abertas de uma conta: o token continua válido até expirar,
 *  mas para de ser aceito aqui. Use quando um acesso vazar. */
export const encerrarSessoes = adminAction(async (_user, uid: string) => {
  if (!UID.test(uid)) throw new ErroPrevisto("Conta inválida.");
  await adminDb.doc("config/admin").set({ revogados: { [uid]: Date.now() } }, { merge: true });
  // a marca acima só vale nas Server Actions; validSince derruba também o refresh token,
  // e o SDK do navegador (que fala direto com o Firestore) perde a sessão quando renovar
  await contas(":update", { localId: uid, validSince: String(Math.floor(Date.now() / 1000)) });
});

/** Tira o acesso de alguém. O dono do espaço não pode ser removido. */
export const revogarAcesso = adminAction(async (_user, slug: string, uid: string) => {
  slugValido(slug);
  if (!UID.test(uid)) throw new ErroPrevisto("Conta inválida.");
  const ref = adminDb.doc(`tenants/${slug}/members/${uid}`);
  const membro = await ref.get();
  if (!membro.exists) return "já não tinha acesso";
  // quem criou o negócio fica; o cliente que virou dono pelo convite sai, se a Ruphus precisar
  if (membro.get("role") === "owner" && membro.get("viaConvite") !== true) throw new ErroPrevisto("O dono não pode ser removido.");
  if (membro.get("role") === "owner") {
    // o negócio volta para a Ruphus: senão fica sem dono, e o próximo convite aceito
    // não acharia a Ruphus no ownerId para passar o negócio adiante
    await devolverParaRuphus(slug, uid);
    return "acesso removido; o negócio voltou para a Ruphus";
  }
  await ref.delete();
  return "acesso removido";
});

async function devolverParaRuphus(slug: string, uid: string) {
  const tenant = adminDb.doc(`tenants/${slug}`);
  const [config, membros] = await Promise.all([adminDb.doc("config/admin").get(), tenant.collection("members").get()]);
  const daPlataforma = new Set((config.get("uids") as string[] | undefined) ?? []);
  const ruphus = membros.docs.find((d) => daPlataforma.has(d.id));
  if (!ruphus) throw new ErroPrevisto("A conta da Ruphus não está neste negócio: não há para quem devolver.");
  const lote = adminDb.batch();
  lote.delete(tenant.collection("members").doc(uid));
  lote.update(ruphus.ref, { role: "owner" });
  lote.update(tenant, { ownerId: ruphus.id });
  await lote.commit();
}

export type Resumo = { agendamentosHoje: number; espacosComAgenda: number };

/** Agendamentos de hoje em toda a plataforma, para o topo do painel. */
async function resumoDoDia(): Promise<Resumo> {
  const inicio = new Date();
  inicio.setHours(0, 0, 0, 0);
  const fim = new Date(inicio);
  fim.setDate(fim.getDate() + 1);
  const snap = await adminDb
    .collectionGroup("appointments")
    .where("start", ">=", inicio)
    .where("start", "<", fim)
    .get();
  const espacos = new Set(snap.docs.map((d) => d.ref.parent.parent?.id).filter(Boolean));
  return { agendamentosHoje: snap.size, espacosComAgenda: espacos.size };
}

export type Painel = {
  espacos: Espaco[];
  hoje: Resumo;
  crm: Awaited<ReturnType<typeof lerCrm>>;
  /** quem assina as mensagens do CRM */
  assinatura: string;
  /** minutos parado até o logout automático; 0 desliga */
  minutosInativo: number;
  /** ID do Pixel da Meta; vazio = desligado */
  metaPixel: string;
};

/** Tudo o que o painel precisa para abrir, numa viagem só.
 *
 * O cliente despacha Server Actions uma de cada vez — é o Next que enfileira —,
 * então quatro chamadas dentro de um Promise.all viravam quatro idas ao
 * servidor em fila, cada uma pagando o requireAdmin (JWT + config/admin) de
 * novo antes de consultar qualquer coisa. Aqui o paralelo é de verdade: ele
 * acontece deste lado, depois de uma conferência só. */
export const abrirPainel = adminAction(async (): Promise<Painel> => {
  const [espacos, hoje, crm, assina, sessao, marketing] = await Promise.all([
    espacosComAcessos(),
    resumoDoDia(),
    lerCrm(adminDb),
    adminDb.doc("config/crm").get(),
    adminDb.doc("config/sessao").get(),
    adminDb.doc("config/marketing").get(),
  ]);
  return {
    espacos,
    hoje,
    crm,
    assinatura: String(assina.get("assinatura") ?? ""),
    minutosInativo: Number(sessao.get("minutos")) || 0,
    metaPixel: String(marketing.get("metaPixel") ?? ""),
  };
});

export type Detalhe = {
  servicos: number;
  profissionais: number;
  agendamentos30d: number;
  telefone: string | null;
};

/** O que o painel lateral de um espaço mostra além dos acessos. */
export const detalhesEspaco = adminAction(async (_user, slug: string): Promise<Detalhe> => {
  slugValido(slug);
  const t = adminDb.collection("tenants").doc(slug);
  const desde = new Date();
  desde.setDate(desde.getDate() - 30);
  const [tenant, servicos, staff, agendamentos] = await Promise.all([
    t.get(),
    t.collection("services").where("active", "==", true).count().get(),
    t.collection("staff").where("active", "==", true).count().get(),
    t.collection("appointments").where("start", ">=", desde).count().get(),
  ]);
  return {
    servicos: servicos.data().count,
    profissionais: staff.data().count,
    agendamentos30d: agendamentos.data().count,
    telefone: tenant.get("site.phone") ?? null,
  };
});

// ————— CRM: oferta, venda e publicação —————

/** Implantação, uso e cobrança de um cliente. */
export const saudeDoNegocio = adminAction(async (_user, slug: string, hoje: string) => {
  if (!SLUG.test(slug)) throw new Error("negócio inválido");
  return saudeDe(adminDb, slug, z.iso.date().parse(hoje));
});

/** A carteira: todos os negócios fechados, do mais em risco ao mais saudável. */
export const carteira = adminAction(async (_user, hoje: string) => {
  const dia = z.iso.date().parse(hoje);
  const fechados = Object.entries(await lerCrm(adminDb)).filter(([, c]) => c.estagio === "fechado").map(([slug]) => slug);
  const peso = { risco: 0, atencao: 1, ok: 2 } as const;
  return (await Promise.all(fechados.map((slug) => saudeDe(adminDb, slug, dia)))).sort((a, b) => peso[a.saude] - peso[b.saude]);
});

export const salvarNegocio = adminAction(async (user, slug: string, dados: unknown) => {
  slugValido(slug);
  await salvarCrm(adminDb, slug, dados as CrmInput, user.email ?? user.uid);
  return "salvo";
});

export const listarNotasDo = adminAction(async (_user, slug: string) => {
  slugValido(slug);
  return listarNotas(adminDb, slug);
});

/** Notas, estágio, mensagens, convite, agendamento e cobranças, numa lista só. */
export const linhaDoTempoDo = adminAction(async (_user, slug: string) => {
  if (!SLUG.test(slug)) throw new Error("negócio inválido");
  return linhaDoTempo(adminDb, slug);
});

/** A mensagem pronta foi aberta no WhatsApp: vira contato feito na linha do tempo. */
export const registrarEnvio = adminAction(async (user, slug: string, modelo: string, para: string) => {
  if (!SLUG.test(slug)) throw new Error("negócio inválido");
  await registrarMensagem(adminDb, slug, modelo, para, user.email ?? user.uid);
  return linhaDoTempo(adminDb, slug);
});

export const anotarNegocio = adminAction(async (user, slug: string, texto: string) => {
  slugValido(slug);
  await anotar(adminDb, slug, texto, user.email ?? user.uid);
  return linhaDoTempo(adminDb, slug);
});

export type CobrancaEnviavel = {
  id: string;
  slug: string;
  nome: string;
  telefone: string | null;
  tipo: "entrada" | "mensal";
  competencia: string | null;
  valorCents: number;
  vencimento: string;
  status: "aberta" | "paga" | "cancelada";
  pagoEm: string | null;
  recebidoCents: number | null;
  url: string;
  whatsapp: string | null;
};

// Mesmo motivo de convitesPara: um só lugar monta o link e a mensagem, senão o
// botão da linha e o lote do mês divergem no fallback de SITE_URL.
async function enviaveis(cobrancas: Cobranca[]): Promise<CobrancaEnviavel[]> {
  if (!cobrancas.length) return [];
  const base = process.env.SITE_URL ?? "https://www.ruphus.site";
  const slugs = [...new Set(cobrancas.map((c) => c.slug))];
  const [docs, crms] = await Promise.all([
    adminDb.getAll(...slugs.map((s) => adminDb.collection("tenants").doc(s))),
    adminDb.getAll(...slugs.map((s) => adminDb.collection("crm").doc(s))),
  ]);
  const dono = new Map(crms.map((d) => [d.id, { whatsapp: (d.get("donoWhatsapp") as string | null) ?? null, nome: (d.get("donoNome") as string | null) ?? null }]));
  // Cobrança vai para quem paga: o WhatsApp do dono, quando cadastrado; senão o do site
  const nomes = new Map(
    docs.map((d) => [d.id, { nome: String(d.get("name") ?? d.id), telefone: dono.get(d.id)?.whatsapp ?? (d.get("site.phone") as string | null) ?? null }]),
  );
  return cobrancas.map((c) => {
    const { nome, telefone } = nomes.get(c.slug) ?? { nome: c.slug, telefone: null };
    const primeiro = dono.get(c.slug)?.nome?.split(" ")[0];
    const url = `${base}/pagar/${c.id}?t=${c.token}`;
    const oque = c.tipo === "entrada" ? "a entrada" : `a mensalidade de ${mesLongo(c.competencia)}`;
    const texto = `Olá${primeiro ? `, ${primeiro}` : ""}! Aqui é da Ruphus. Segue o Pix ${oque} do ${nome}: ${formatBRL(c.valorCents)}, com vencimento em ${diaCurto(c.vencimento)}.\n\nO QR e o copia e cola estão aqui: ${url}\n\nDepois de pagar, me manda o comprovante por aqui que eu confirmo.`;
    return { ...c, nome, telefone, url, whatsapp: linkWhatsApp(telefone, texto) };
  });
}

const mesLongo = (competencia: string | null) =>
  competencia
    ? new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${competencia}-01T00:00:00Z`))
    : "";

/** O link da proposta daquele negócio. O mesmo link vai por WhatsApp e por
 *  e-mail; "refazer" gera outro e invalida o anterior. */
export const linkDaProposta = adminAction(async (_user, slug: string, refazer?: boolean) => {
  slugValido(slug);
  const { token, valeAte, nova } = await gerarProposta(adminDb, slug, refazer === true);
  const base = process.env.SITE_URL ?? "https://www.ruphus.site";
  return { url: `${base}/proposta/${slug}?t=${token}`, valeAte, nova };
});

/** Manda a proposta por e-mail, da conta da Ruphus, para o dono cadastrado no CRM.
 *  O registro na linha do tempo só acontece depois do envio dar certo: envio que
 *  falhou não pode parecer contato feito. */
export const enviarPropostaPorEmail = adminAction(async (user, slug: string, digitado?: string) => {
  slugValido(slug);
  const { cadastrado, ...dados } = await dadosDoEnvio(adminDb, slug);
  const para = destinatarioDoEnvio(digitado, cadastrado);
  const { token, valeAte } = await gerarProposta(adminDb, slug);
  const base = process.env.SITE_URL ?? "https://www.ruphus.site";
  const { assunto, texto, html } = emailDaProposta({ ...dados, url: `${base}/proposta/${slug}?t=${token}`, valeAte });
  await enviarEmail({ para, assunto, texto, html });
  await registrarMensagem(adminDb, slug, "Proposta por e-mail", para, user.email ?? user.uid);
  return { para, eventos: await linhaDoTempo(adminDb, slug) };
});

/** Manda o convite de acesso por e-mail, da conta da Ruphus, para o dono do CRM. O
 *  link já vem preso a esse endereço, então o e-mail é o canal que combina com ele.
 *  Mesma regra de gerarConvite: sem e-mail cadastrado, não sai convite. */
export const enviarConvitePorEmail = adminAction(async (user, slug: string) => {
  slugValido(slug);
  const { convites, semEmail } = await convitesPara([slug]);
  if (semEmail.length) throw new ErroPrevisto("Cadastre o e-mail do dono na aba Venda antes de convidar: é ele que tranca o link nessa conta.");
  const [convite] = convites;
  if (!convite) throw new ErroPrevisto("Negócio não encontrado.");
  const [crm, config] = await Promise.all([adminDb.collection("crm").doc(slug).get(), adminDb.doc("config/crm").get()]);
  const { assunto, texto } = emailDoConvite({
    nome: convite.nome,
    slug,
    donoNome: (crm.get("donoNome") as string | null) ?? null,
    url: convite.url,
    email: convite.email,
    dias: DIAS_CONVITE,
    assinatura: (config.get("assinatura") as string | null) ?? null,
  });
  await enviarEmail({ para: convite.email, assunto, texto });
  await registrarMensagem(adminDb, slug, "Convite por e-mail", convite.email, user.email ?? user.uid);
  return { url: convite.url, email: convite.email, eventos: await linhaDoTempo(adminDb, slug) };
});

export const definirAssinatura = adminAction(async (_user, nome: unknown) => {
  const limpo = String(nome ?? "").trim().slice(0, 40);
  if (!limpo) throw new ErroPrevisto("Informe o nome que assina as mensagens.");
  await adminDb.doc("config/crm").set({ assinatura: limpo }, { merge: true });
  return limpo;
});

/** Minutos parado até o logout automático. 0 desliga. */
export const definirMinutosInativo = adminAction(async (_user, minutos: unknown) => {
  const n = Number(minutos);
  if (!Number.isInteger(n) || n < 0 || n > MINUTOS_MAX) throw new ErroPrevisto(`Use de 0 (desligado) a ${MINUTOS_MAX} minutos.`);
  await adminDb.doc("config/sessao").set({ minutos: n }, { merge: true });
  return n;
});

/** ID do Pixel da Meta, que a landing e o cadastro carregam. Vazio desliga. */
export const definirPixel = adminAction(async (_user, id: unknown) => {
  const limpo = String(id ?? "").replace(/\D/g, "");
  if (limpo && !/^\d{10,20}$/.test(limpo)) throw new ErroPrevisto("O ID do Pixel tem só números (de 10 a 20).");
  await adminDb.doc("config/marketing").set({ metaPixel: limpo }, { merge: true });
  revalidatePath("/api/marketing");
  return limpo;
});

export const lerPixConfig = adminAction(async () => pixCadastrado(adminDb));

export const salvarPixConfig = adminAction(async (_user, dados: unknown) => {
  await salvarPix(adminDb, dados);
});

export const listarCobrancasDo = adminAction(async (_user, slug: string) =>
  enviaveis(await listarCobrancas(adminDb, slug)),
);

/** Negócios com o Caixa ligado: o valor do módulo entra na mensalidade deles. */
async function comCaixa() {
  const snap = await adminDb.collection("tenants").where("modulos.financeiro", "==", true).select().get();
  return new Set(snap.docs.map((d) => d.id));
}

/** Uma cobrança avulsa: entrada ou mensalidade de uma competência. */
export const cobrar = adminAction(async (_user, slug: string, tipo: "entrada" | "mensal", competencia: string | null) => {
  if (!SLUG.test(slug)) throw new Error("negócio inválido");
  const [negocios, caixa] = await Promise.all([lerCrm(adminDb), comCaixa()]);
  const valorCents = tipo === "entrada" ? negocios[slug]?.entradaCents : mensalidadeDe(negocios[slug], caixa.has(slug));
  if (!valorCents) throw new Error("cadastre o valor no bloco Negócio antes de cobrar");
  const mes = tipo === "entrada" ? null : (competencia ?? competenciaAtual());
  await gerarCobranca(adminDb, { slug, tipo, competencia: mes, valorCents });
  return enviaveis(await listarCobrancas(adminDb, slug));
});

/** A mensalidade do mês para todos os negócios fechados, de uma vez. */
export const cobrarMes = adminAction(async (_user, competencia?: string) => {
  const mes = competencia ?? competenciaAtual();
  const [negocios, caixa] = await Promise.all([lerCrm(adminDb), comCaixa()]);
  const alvos = Object.entries(negocios).filter(([slug, n]) => n.estagio === "fechado" && mensalidadeDe(n, caixa.has(slug)) > 0);
  const geradas: Cobranca[] = [];
  for (const [slug, n] of alvos) {
    const { id } = await gerarCobranca(adminDb, { slug, tipo: "mensal", competencia: mes, valorCents: mensalidadeDe(n, caixa.has(slug)) });
    const c = (await listarCobrancas(adminDb, slug)).find((x) => x.id === id);
    // a do mês que já existia e foi paga não volta para a lista de envio
    if (c?.status === "aberta") geradas.push(c);
  }
  // Volta a lista pronta para enviar: gerar sem enviar era o que fazia o botão ficar desligado
  return { mes: mesLongo(mes), geradas: geradas.length, negocios: alvos.length, lista: await enviaveis(geradas) };
});

export const marcarPaga = adminAction(async (user, id: string, recebidoCents: number, pagoEm: string) => {
  const paga = await baixar(adminDb, id, { recebidoCents, pagoEm, por: user.email ?? user.uid });
  // a entrada é o "publicar": a faixa de proposta sai e o site abre para o Google
  if (paga.tipo === "entrada" && paga.slug && (await publicarSite(adminDb, paga.slug))) {
    for (const p of ["index.html", "og.jpg"]) revalidatePath(`/s/${paga.slug}/${p}`);
  }
});

export const cancelarCobranca = adminAction(async (user, id: string) => {
  await cancelar(adminDb, id, user.email ?? user.uid);
});

/** Abertas com vencimento no passado. Cortar o site continua sendo clique humano. */
export const listarAtrasadas = adminAction(async () => enviaveis(await atrasadas(adminDb, hojeISO())));

// ─── Gerador de sites ────────────────────────────────────────────────────────

/** A aba "Site" da gaveta: o que o negócio tem hoje. */
export const siteDoNegocio = adminAction(async (_user, slug: string) => {
  slugValido(slug);
  const { escolha, ...site } = await lerSiteDoNegocio(adminDb, slug);
  const e = escolha as (Escolha & { modelo?: string }) | undefined;
  // site de ramo claro (pet, saúde, aulas) não usa modelo editorial
  const modelos = ehClaro(site.sub as Sub) ? [] : MODELOS;
  // escolha gravada que não é de nenhum modelo da lista: "personalizado", só para mostrar
  const casa = e?.modelo ? modelos.find((m) => m.id === e.modelo)?.id : modelos.find((m) => m.escolha.kit === e?.kit && m.escolha.cor === e?.cor)?.id;
  const modeloAtual = casa ?? (e ? "personalizado" : null);
  return { ...site, modelos: modelos.map(({ id, rotulo }) => ({ id, rotulo })), modeloAtual };
});

/** Pré-visualização do modelo com os dados reais do negócio, sem gravar nada. O HTML
 *  sai com <base> no domínio do site, para as fotos carregarem dentro do admin. */
export const previewModelo = adminAction(async (_user, slug: string, id: string | null): Promise<string> => {
  slugValido(slug);
  const dados = await lerSite(adminDb, slug);
  if (!dados || ehClaro(dados.sub)) throw new ErroPrevisto("Este site não usa modelo.");
  let escolha: Escolha | undefined;
  if (id !== null) {
    const modelo = modeloDoId(id);
    if (!modelo) throw new ErroPrevisto("Este modelo não existe.");
    escolha = modelo.escolha;
  }
  const html = renderEditorial({ ...dados, escolha });
  const comBase = html.replace("<head>", `<head><base href="https://${slug}.ruphus.site/">`);
  if (comBase === html) throw new Error("Modelo sem <head>: não dá para montar a pré-visualização.");
  return comBase;
});

/** Troca o modelo editorial do site: grava a escolha de kit e cor do modelo, ou volta ao
 *  padrão do sistema (id null, que sorteia pelo slug). O site da fábrica não usa modelo. */
export const definirModelo = adminAction(async (_user, slug: string, id: string | null) => {
  slugValido(slug);
  const t = adminDb.collection("tenants").doc(slug);
  const tenant = await t.get();
  const { tipo } = await lerSiteDoNegocio(adminDb, slug);
  const sub = tenant.get("gerado.sub");
  if (!tenant.exists || !sub || tipo === "fabrica" || ehClaro(sub)) throw new ErroPrevisto("Este site não usa modelo.");
  const escolha = id === null ? undefined : modeloDoId(id)?.escolha;
  if (id !== null && !escolha) throw new ErroPrevisto("Este modelo não existe.");
  // a /bio lê a cor e a foto gravadas no tenant: elas trocam junto com o modelo
  const visual = visualEditorial(slug, sub, escolha);
  await t.update({
    "gerado.escolha": escolha ?? FieldValue.delete(),
    "site.color": visual.cor,
    "site.photo": visual.foto,
  });
  for (const p of ["index.html", "og.jpg"]) revalidatePath(`/s/${slug}/${p}`);
  revalidatePath(`/bio/${slug}`);
  return true;
});

/** Monta ou completa o site de um negócio pela gaveta — o do cadastro, sobretudo, que
 *  sai só com o que o dono digitou. Com aplicar=false só diz o que mudaria; o site do
 *  cadastro continua do dono (sem faixa de proposta) e serviços e equipe não mudam. */
export const montarSite = adminAction(async (_user, slug: string, dados: unknown, google: unknown, aplicar: boolean) => {
  slugValido(slug);
  const g = Google.safeParse(google);
  if (!g.success) throw new ErroPrevisto("Nota de 0 a 5 e avaliações em número inteiro.");
  const previa = await previaDoSite(adminDb, slug, dados, g.data);
  if (!aplicar) return previa;
  await salvarSite(adminDb, slug, dados, previa.tipo === "fabrica" ? undefined : g.data);
  for (const p of ["index.html", "og.jpg"]) revalidatePath(`/s/${slug}/${p}`);
  revalidatePath(`/bio/${slug}`);
  return previa;
});

/** Da planilha lida no navegador aos sites no ar. Com aplicar=false só diz o que faria. */
export const gerarSites = adminAction(async (user, entrada: unknown, aplicar: boolean) => {
  const linhas = await gerarNoBanco(adminDb, entrada, aplicar, process.env.OWNER_UID || user.uid);
  // o site e a bio saem do cache agora, não em até um minuto
  if (aplicar) for (const { slug } of linhas.filter((l) => l.acao !== "pular")) {
    revalidatePath(`/s/${slug}/index.html`);
    revalidatePath(`/s/${slug}/og.jpg`);
    revalidatePath(`/bio/${slug}`);
  }
  return linhas;
});

// ─── Demonstração ────────────────────────────────────────────────────────────

/** O acesso de dono da conta de demonstração, para o vendedor passar ao cliente. */
export const acessoDaDemo = adminAction(async () => acessoDemo(adminDb));

/** Volta a demonstração ao padrão depois que o cliente testou: dados de exemplo e senha nova. */
export const restaurarADemo = adminAction(async (user) => {
  const r = await restaurarDemo(adminDb, { adminUid: user.uid });
  for (const p of PAGINAS_DEMO) revalidatePath(p);
  return r;
});

// ─── WhatsApp do negócio (gateway próprio, wtsfy) ────────────────────────────

/** O WhatsApp que o dono conectou: o que está gravado no tenants/{slug}. */
export const whatsappDoNegocio = adminAction(async (_user, slug: string): Promise<ConexaoWhatsapp | null> => {
  slugValido(slug);
  return lerConexao(adminDb, slug);
});

/** Cria a instância no gateway e prende o vínculo ao negócio. Um número por negócio.
 *  Quem conecta pela plataforma assume a gestão: ownerManaged false trava a
 *  edição no painel do dono (a plataforma tem prioridade). */
export const conectarWhatsApp = adminAction(async (_user, slug: string): Promise<ConexaoWhatsapp> => {
  slugValido(slug);
  if (await lerConexao(adminDb, slug)) throw new ErroPrevisto("Este negócio já tem um WhatsApp conectado. Desconecte antes de trocar de número.");
  const { id } = await createInstance(`ruphus-${slug}`);
  const conexao: ConexaoWhatsapp = { instanceId: id, phone: null, status: "created", updatedAt: Date.now(), ownerManaged: false };
  await gravarConexao(adminDb, slug, conexao);
  return conexao;
});

/** Delegar (ou retomar) a gestão do WhatsApp ao painel do dono. Só a plataforma decide. */
export const definirGestaoDonoWhatsApp = adminAction(async (_user, slug: string, permitir: unknown): Promise<boolean> => {
  slugValido(slug);
  const valor = permitir === true;
  await gravarGestaoDono(adminDb, slug, valor);
  return valor;
});

/** Pergunta ao gateway o estado de verdade e espelha no banco. É o que o polling usa. */
export const refreshWhatsAppStatus = adminAction(async (_user, slug: string): Promise<ConexaoWhatsapp | null> => {
  slugValido(slug);
  const salva = await lerConexao(adminDb, slug);
  if (!salva) return null;
  const vivo = await getStatus(salva.instanceId);
  const conexao: ConexaoWhatsapp = { ...salva, phone: vivo.phone ?? salva.phone, status: vivo.status, updatedAt: Date.now() };
  await gravarConexao(adminDb, slug, conexao);
  return conexao;
});

/** O QR de pareamento (PNG em base64), ou o estado da conexão enquanto o QR não sai. */
export const qrWhatsApp = adminAction(async (_user, slug: string): Promise<QrWhatsApp> => {
  slugValido(slug);
  const salva = await lerConexao(adminDb, slug);
  if (!salva) throw new ErroPrevisto("Conecte o WhatsApp antes de pedir o QR.");
  return getQr(salva.instanceId);
});

/** Despareia o número do gateway e solta o vínculo com o negócio. */
export const desconectarWhatsApp = adminAction(async (_user, slug: string) => {
  slugValido(slug);
  const salva = await lerConexao(adminDb, slug);
  if (salva) await logout(salva.instanceId).catch(() => {});
  await apagarConexao(adminDb, slug);
  return "desconectado";
});

/** O número pessoal do dono: recebe os avisos de novo agendamento e confirma
 *  respondendo CONFIRMADO. Precisa ser um aparelho separado do número conectado
 *  (self-chat do dono não chega ao gateway de forma confiável). Vazio desliga. */
export const definirOwnerPhoneWhatsApp = adminAction(async (_user, slug: string, telefone: unknown) => {
  slugValido(slug);
  if (!(await lerConexao(adminDb, slug))) throw new ErroPrevisto("Conecte o WhatsApp do negócio antes de cadastrar o número do dono.");
  const limpo = String(telefone ?? "").trim();
  const dono = limpo ? soDigitosComDDI(limpo) : null;
  if (limpo && !dono) {
    throw new ErroPrevisto("Número incompleto. Use DDD + número (ex.: 11 98877-7777) ou com DDI (ex.: +55 11 98877-7777).");
  }
  await gravarOwnerPhone(adminDb, slug, dono);
  return dono;
});
