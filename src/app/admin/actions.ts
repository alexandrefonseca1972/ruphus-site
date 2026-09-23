"use server";

import { z } from "zod";
import { adminDb } from "@/lib/admin";
import { adminAction, ErroPrevisto } from "@/lib/admin-guard";
import { cotaDe, definirLimite } from "@/lib/negocios.server";
import { DIAS_CONVITE, LIMITE_STAFF_MAX, limiteStaffDe, MINUTOS_MAX } from "@/lib/limites";
import { gerarProposta } from "@/lib/proposta.server";
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
import { diaCurto, hojeISO } from "@/lib/crm-tipos";
import { formatBRL, linkWhatsApp } from "@/lib/datetime";
import { competenciaAtual } from "@/lib/pix";

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
  healthclub: "Saúde",
  podiatric: "Podologia",
};
const nicho = (tipo: unknown) => NICHOS[String(tipo ?? "").toLowerCase()] ?? "Outros";

/** Se quem entrou administra a plataforma.
 *
 * config/admin não é legível pelo cliente — nenhuma regra abre essa coleção —,
 * então quem responde é o servidor. O login usa isto para mandar o admin ao
 * painel da plataforma em vez da casa de um negócio.
 */
export const ehAdminDaPlataforma = adminAction(async () => true);

/** Lista os espaços com quantas pessoas têm acesso a cada um. */
export const listarEspacos = adminAction(async () => {
  const [tenants, membros] = await Promise.all([
    adminDb.collection("tenants").get(),
    adminDb.collectionGroup("members").get(),
  ]);
  const porEspaco = new Map<string, number>();
  for (const m of membros.docs) {
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
    }))
    .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
});

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

export type ConviteEmLote = { slug: string; nome: string; telefone: string | null; url: string; whatsapp: string | null };

// Um só lugar monta o convite. O botão da linha e o lote são a mesma coisa com
// cardinalidade diferente: antes cada um construía a URL e o fallback de SITE_URL
// por conta, e dava para um mudar sem o outro.
async function convitesPara(slugs: string[]): Promise<ConviteEmLote[]> {
  const alvos = limpar(slugs);
  if (!alvos.length) return [];
  const base = process.env.SITE_URL ?? "https://www.ruphus.site";
  const docs = await adminDb.getAll(...alvos.map((s) => adminDb.collection("tenants").doc(s)));
  const fora: ConviteEmLote[] = [];
  for (const d of docs) {
    if (!d.exists) continue;
    const url = `${base}/convite?c=${await criarConvite(adminDb, d.id)}`;
    const nome = String(d.get("name") ?? d.id);
    const telefone = (d.get("site.phone") as string | null) ?? null;
    const texto = `Olá! Aqui é da Ruphus. O site do ${nome} já está no ar em https://${d.id}.ruphus.site — e a agenda online também.\n\nEste link dá acesso ao painel para você cadastrar serviços, equipe e horários: ${url}\n\nO link vale ${DIAS_CONVITE} dias.`;
    fora.push({ slug: d.id, nome, telefone, url, whatsapp: linkWhatsApp(telefone, texto) });
  }
  return fora;
}

/** Um convite para cada negócio marcado, com a mensagem pronta para enviar. */
export const gerarConvites = adminAction(async (_user, slugs: string[]) => convitesPara(slugs));

/** Move vários negócios de estágio de uma vez, sem abrir um a um. */
export const marcarEstagio = adminAction(async (user, slugs: string[], estagio: string) => {
  const alvos = limpar(slugs);
  for (const slug of alvos) await salvarCrm(adminDb, slug, { estagio: estagio as CrmInput["estagio"] }, user.email ?? user.uid);
  return alvos.length;
});

/** Link de convite: quem abrir e entrar vira admin do espaço. */
export const gerarConvite = adminAction(async (_user, slug: string) => {
  const [convite] = await convitesPara([slug]);
  if (!convite) throw new Error(`espaço ${slug} não existe`);
  return convite.url;
});

export type Acesso = { uid: string; papel: string; desde: string | null; nome: string | null; email: string | null; limite: number | null; usados: number };

export const listarAcessos = adminAction(async (_user, slug: string) => {
  slugValido(slug);
  const snap = await adminDb.collection(`tenants/${slug}/members`).get();
  // A cota de cada pessoa: é por aqui que o admin libera mais negócios para um cliente
  const cotas = await Promise.all(snap.docs.map((d) => cotaDe(adminDb, d.id)));
  return snap.docs.map((d, i): Acesso => ({
    uid: d.id,
    papel: String(d.get("role") ?? "member"),
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

/** Encerra as sessões abertas de uma conta: o token continua válido até expirar,
 *  mas para de ser aceito aqui. Use quando um acesso vazar. */
export const encerrarSessoes = adminAction(async (_user, uid: string) => {
  if (!UID.test(uid)) throw new ErroPrevisto("Conta inválida.");
  await adminDb.doc("config/admin").set({ revogados: { [uid]: Date.now() } }, { merge: true });
});

/** Tira o acesso de alguém. O dono do espaço não pode ser removido. */
export const revogarAcesso = adminAction(async (_user, slug: string, uid: string) => {
  slugValido(slug);
  if (!UID.test(uid)) throw new ErroPrevisto("Conta inválida.");
  const ref = adminDb.doc(`tenants/${slug}/members/${uid}`);
  const membro = await ref.get();
  if (!membro.exists) return "já não tinha acesso";
  if (membro.get("role") === "owner") throw new ErroPrevisto("O dono não pode ser removido.");
  await ref.delete();
  return "acesso removido";
});

export type Resumo = { agendamentosHoje: number; espacosComAgenda: number };

/** Agendamentos de hoje em toda a plataforma, para o topo do painel. */
export const resumoDoDia = adminAction(async (): Promise<Resumo> => {
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

/** Estágio, valor e próxima ação de cada espaço, em um mapa por slug. */
export const listarCrm = adminAction(async () => lerCrm(adminDb));

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

/** Quem assina as mensagens do CRM. Definido uma vez pelo admin da plataforma. */
export const lerAssinatura = adminAction(async () => String((await adminDb.doc("config/crm").get()).get("assinatura") ?? ""));

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

export const lerPixConfig = adminAction(async () => pixCadastrado(adminDb));

export const salvarPixConfig = adminAction(async (_user, dados: unknown) => {
  await salvarPix(adminDb, dados);
});

export const listarCobrancasDo = adminAction(async (_user, slug: string) =>
  enviaveis(await listarCobrancas(adminDb, slug)),
);

/** Uma cobrança avulsa: entrada ou mensalidade de uma competência. */
export const cobrar = adminAction(async (_user, slug: string, tipo: "entrada" | "mensal", competencia: string | null) => {
  if (!SLUG.test(slug)) throw new Error("negócio inválido");
  const negocios = await lerCrm(adminDb);
  const valorCents = tipo === "entrada" ? negocios[slug]?.entradaCents : negocios[slug]?.mensalCents;
  if (!valorCents) throw new Error("cadastre o valor no bloco Negócio antes de cobrar");
  const mes = tipo === "entrada" ? null : (competencia ?? competenciaAtual());
  await gerarCobranca(adminDb, { slug, tipo, competencia: mes, valorCents });
  return enviaveis(await listarCobrancas(adminDb, slug));
});

/** A mensalidade do mês para todos os negócios fechados, de uma vez. */
export const cobrarMes = adminAction(async (_user, competencia?: string) => {
  const mes = competencia ?? competenciaAtual();
  const negocios = await lerCrm(adminDb);
  const alvos = Object.entries(negocios).filter(([, n]) => n.estagio === "fechado" && (n.mensalCents ?? 0) > 0);
  const geradas: Cobranca[] = [];
  for (const [slug, n] of alvos) {
    const { id } = await gerarCobranca(adminDb, { slug, tipo: "mensal", competencia: mes, valorCents: n.mensalCents! });
    const c = (await listarCobrancas(adminDb, slug)).find((x) => x.id === id);
    // a do mês que já existia e foi paga não volta para a lista de envio
    if (c?.status === "aberta") geradas.push(c);
  }
  // Volta a lista pronta para enviar: gerar sem enviar era o que fazia o botão ficar desligado
  return { mes: mesLongo(mes), geradas: geradas.length, negocios: alvos.length, lista: await enviaveis(geradas) };
});

export const marcarPaga = adminAction(async (user, id: string, recebidoCents: number, pagoEm: string) => {
  await baixar(adminDb, id, { recebidoCents, pagoEm, por: user.email ?? user.uid });
});

export const cancelarCobranca = adminAction(async (user, id: string) => {
  await cancelar(adminDb, id, user.email ?? user.uid);
});

/** Abertas com vencimento no passado. Cortar o site continua sendo clique humano. */
export const listarAtrasadas = adminAction(async () => enviaveis(await atrasadas(adminDb, hojeISO())));
