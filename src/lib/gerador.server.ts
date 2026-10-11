import "server-only";
import { type DocumentData, type DocumentReference, FieldValue, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { EQUIPE, montar, porRamo } from "@/lib/catalogo";
import { ErroPrevisto } from "@/lib/erro-previsto";
import { AUTOR_LEVANTAMENTO } from "@/lib/crm-tipos";
import { candidatos, type DadosSite, type Escolha, fixo, Lead, type Nicho, nichoDe, type Sub, sortearVisual } from "@/lib/gerador";
import type { Utm } from "@/lib/crm-tipos";
import { dateIn } from "@/lib/datetime";
import { combinacoesEditorial, escolhaEditorial, visualEditorial } from "@/lib/site-editorial";
import { combinacoesClaro, ehClaro, escolhaClaro, visualClaro } from "@/lib/site-claro";

/** Kits e paletas do modelo do nicho, e o que o slug sorteia quando o site não tem escolha. */
const familiaVisual = (sub: Sub) =>
  ehClaro(sub)
    ? { dim: combinacoesClaro(sub), padrao: (slug: string) => escolhaClaro(sub, slug) }
    : { dim: combinacoesEditorial(sub), padrao: (slug: string) => escolhaEditorial(sub, slug) };

// Teto do lote, o mesmo dos convites: acima disso a espera fica longa demais
export const TETO_LOTE = 300;

export type LinhaGerada = {
  aba: string;
  linha: number;
  nome: string;
  /** o endereço do site; em "pular", o do site que o negócio já tem */
  slug: string;
  acao: "criar" | "atualizar" | "pular";
  /** o endereço que o nome pedia e já era de outro negócio */
  conflito: string | null;
  /** por que a linha fica de fora (só em "pular") */
  motivo: string | null;
  /** gera, mas vale conferir: mesmo nome e cidade de outro negócio, ou telefone fixo */
  aviso: string | null;
};

const semAcento = (s: unknown) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

// o ramo por extenso, para o catálogo sair certo quando a planilha não lista serviços
const RAMO: Record<Sub, string> = {
  petshop: "pet shop", vet: "veterinária", barbearia: "barbearia", salao: "salão cabelo", estetica: "estética", unhas: "unhas", tatuagem: "tatuagem",
  odonto: "odontologia", fisio: "fisioterapia", psico: "psicologia", nutri: "nutrição", clinica: "clínica médica",
  idiomas: "idiomas", reforco: "reforço escolar", musica: "música", autoescola: "autoescola",
  academia: "academia", pilates: "pilates", lutas: "lutas", danca: "dança",
  oficina: "oficina mecânica", lavagem: "estética automotiva", pneus: "pneus",
};

type Escrita = { ref: DocumentReference; dados: DocumentData };

/** O que um site gerado grava — o mesmo para a planilha do admin e o cadastro do dono.
 *
 *  O negócio (nome, dados do site e o `gerado` que a rota do site lê) sempre; dono,
 *  agenda, equipe e funil só na criação: depois disso quem mexe é o dono ou o funil,
 *  e reenviar a planilha não pode apagar o que fizeram. Tudo com merge. */
export function registrosDoSite(
  db: Firestore,
  slug: string,
  lead: Lead,
  n: Nicho,
  o: { novo: boolean; ownerId: string; origem: "prospeccao" | "cadastro"; equipe?: string; donoNome?: string; utm?: Utm | null; escolha?: Escolha },
): Escrita[] {
  const visual = ehClaro(n.sub) ? visualClaro(slug, n.sub, o.escolha) : visualEditorial(slug, n.sub, o.escolha);
  const t = db.collection("tenants").doc(slug);
  const agora = FieldValue.serverTimestamp();
  const escritas: Escrita[] = [{
    ref: t,
    dados: {
      name: lead.nome,
      ...(o.novo && { ownerId: o.ownerId, createdAt: agora }),
      site: {
        url: `https://${slug}.ruphus.site`,
        phone: lead.telefone,
        address: lead.endereco || null,
        category: n.tipo,
        city: lead.cidade || null,
        uf: lead.uf || null,
        rating: lead.nota,
        reviews: lead.avaliacoes,
        color: visual.cor,
        instagram: lead.instagram || null,
        photo: visual.foto,
      },
      gerado: { nicho: n.nicho, sub: n.sub, bairro: lead.bairro, horario: lead.horario, origem: o.origem, atualizadoEm: agora, ...(o.escolha && { escolha: o.escolha }) },
    },
  }];
  if (!o.novo) return escritas;

  escritas.push({ ref: t.collection("members").doc(o.ownerId), dados: { uid: o.ownerId, role: "owner", createdAt: agora } });
  const servicos = (lead.servicos.length ? lead.servicos.map(montar) : porRamo(`${RAMO[n.sub]} ${lead.categoria}`))
    // saúde não anuncia preço (regra dos conselhos): o valor fica "a combinar"
    .map((s) => (n.nicho === "saude" ? { ...s, priceCents: 0 } : s));
  servicos.forEach(({ id, ...s }, ordem) => escritas.push({ ref: t.collection("services").doc(id), dados: { ...s, ordem } }));
  escritas.push({
    ref: t.collection("staff").doc("equipe"),
    dados: { ...EQUIPE, ...(o.equipe && { name: o.equipe }), serviceIds: servicos.map((s) => s.id), createdAt: agora },
  });
  // o levantamento do lead (score e gancho) vira nota no funil: quem abre a ficha já tem a abordagem
  const nota = [lead.score && `Score do levantamento: ${lead.score}.`, lead.abordagem && `Abordagem sugerida: ${lead.abordagem}`].filter(Boolean).join(" ").slice(0, 600);
  if (nota) escritas.push({ ref: db.collection(`crm/${slug}/notas`).doc(), dados: { texto: nota, autor: AUTOR_LEVANTAMENTO, quando: agora } });
  escritas.push({
    ref: db.collection("crm").doc(slug),
    dados: {
      origem: o.origem === "cadastro" ? "cadastro" : "importado",
      // quem se cadastra sozinho não avisa ninguém: o passo combinado para hoje põe o
      // negócio em "Para hoje" no /admin e, se passar do dia, em "Atrasados"
      ...(o.origem === "cadastro" && { proximaAcao: "Dar boas-vindas: cadastrou sozinho no site", proximaData: dateIn(new Date()) }),
      // o anúncio que trouxe o cadastro: é o que o funil agrupa em "Anúncios"
      ...(o.utm && { utm: o.utm }),
      ...(lead.email && { donoEmail: lead.email }),
      ...(o.donoNome && { donoNome: o.donoNome }),
      ...(nota && { notas: FieldValue.increment(1) }),
    },
  });
  return escritas;
}

/** Grava os sites da planilha. Com aplicar=false só diz o que faria: a prévia e a
 *  gravação são a mesma conta, então o que o admin confirma é o que sai. */
export async function gerarNoBanco(db: Firestore, entrada: unknown, aplicar: boolean, ownerId: string): Promise<LinhaGerada[]> {
  const lida = z.array(z.object({ aba: z.string().max(100), linha: z.number().int().positive(), lead: Lead })).max(TETO_LOTE).safeParse(entrada);
  if (!lida.success) throw new ErroPrevisto(`Planilha inválida ou com mais de ${TETO_LOTE} linhas.`);

  const tenants = db.collection("tenants");

  // O telefone identifica o negócio. Já com site gerado: é o mesmo lead, atualiza
  // (mesmo que o nome tenha mudado na planilha). Com site da fábrica ou conta
  // real: o negócio já existe, a linha fica de fora.
  const telefones = [...new Set(lida.data.map(({ lead }) => lead.telefone))];
  const porTelefone = new Map<string, { slug: string; gerado: boolean; cadastro: boolean; escolha?: Escolha }>();
  for (let i = 0; i < telefones.length; i += 30) { // o "in" do Firestore aceita até 30
    const achados = await tenants.where("site.phone", "in", telefones.slice(i, i + 30)).select("site.phone", "gerado").get();
    for (const d of achados.docs) {
      const t = String(d.get("site.phone"));
      // entre um gerado e outro qualquer com o mesmo número, o que não é gerado decide: não duplicar
      if (!porTelefone.has(t) || !d.get("gerado")) {
        porTelefone.set(t, { slug: d.id, gerado: !!d.get("gerado"), cadastro: d.get("gerado.origem") === "cadastro", escolha: d.get("gerado.escolha") });
      }
    }
  }

  // Kits e paletas já usados na mesma cidade e nicho. Um site novo sorteia o menos repetido
  // ali; os sites que não têm escolha gravada contam pelo que o slug sorteia (o que já sai).
  const usosDaRegiao = new Map<string, Required<Escolha>[]>();
  const usosDe = async (cidade: string, sub: Sub) => {
    const chave = `${cidade}|${sub}`;
    if (!usosDaRegiao.has(chave)) {
      const { padrao } = familiaVisual(sub);
      const achados = await tenants.where("site.city", "==", cidade).select("gerado").get();
      usosDaRegiao.set(chave, achados.docs
        .filter((d) => d.get("gerado.sub") === sub)
        .map((d) => ({ ...padrao(d.id), ...(d.get("gerado.escolha") as Escolha | undefined) } as Required<Escolha>)));
    }
    return usosDaRegiao.get(chave)!;
  };
  const escolhas = new Map<string, Escolha | undefined>();

  // Um endereço está livre se não há tenant nele. Site da fábrica ou negócio real
  // nunca é sobrescrito: passa para o próximo candidato.
  const todos = [...new Set(lida.data.flatMap(({ lead }) => candidatos(lead)))];
  const docs = todos.length ? await db.getAll(...todos.map((s) => tenants.doc(s))) : [];
  const existentes = new Map(docs.filter((d) => d.exists).map((d) => [d.id, d]));
  const usados = new Set([...porTelefone.values()].filter((v) => v.gerado).map((v) => v.slug));

  const saida: (LinhaGerada & { lead: Lead })[] = [];
  for (const { aba, linha, lead } of lida.data) {
    const lista = candidatos(lead);
    const ja = porTelefone.get(lead.telefone);
    const semZap = fixo(lead.telefone) ? "telefone fixo: o botão de WhatsApp do site não vai funcionar" : null;
    const base = { aba, linha, nome: lead.nome, conflito: null, motivo: null, aviso: semZap, lead };
    if (ja && !ja.gerado) {
      saida.push({ ...base, slug: ja.slug, acao: "pular", motivo: `já tem site: ${ja.slug}.ruphus.site` });
      continue;
    }
    // o site do cadastro é do dono: regravar como prospecção traria de volta a faixa de
    // proposta e apagaria o que ele editou. Completar esse site é pela gaveta, aba "Site".
    if (ja?.cadastro) {
      saida.push({ ...base, slug: ja.slug, acao: "pular", motivo: `cliente do cadastro (${ja.slug}): complete o site pela gaveta, aba Site` });
      continue;
    }
    if (ja) {
      // o que já está no ar fica como está: a escolha dele não muda com a planilha
      escolhas.set(ja.slug, ja.escolha);
      saida.push({ ...base, slug: ja.slug, acao: "atualizar" });
      continue;
    }
    const slug = lista.find((s) => !usados.has(s) && !existentes.has(s));
    if (!slug) throw new ErroPrevisto(`Linha ${linha}: não achei endereço livre para “${lead.nome}”. Preencha a coluna slug.`);
    usados.add(slug);
    // nome (e nome + cidade) já tomados na mesma cidade, com outro telefone: pode ser
    // o mesmo negócio com outro número — ou outra unidade de uma rede
    const parecido = lista.slice(0, 2).map((s) => existentes.get(s))
      .find((d) => d && lead.cidade && semAcento(d.get("site.city")) === semAcento(lead.cidade));
    // sem cidade não há região para comparar: fica o que o slug sorteia, como antes
    const { dim, padrao } = familiaVisual(nichoDe(lead)!.sub);
    if (lead.cidade) {
      const regiao = await usosDe(lead.cidade, nichoDe(lead)!.sub);
      const escolha = sortearVisual(slug, regiao, dim);
      regiao.push(escolha);
      escolhas.set(slug, escolha);
    } else {
      escolhas.set(slug, padrao(slug));
    }
    saida.push({
      ...base,
      slug,
      acao: "criar",
      conflito: slug === lista[0] ? null : lista[0],
      aviso: [parecido && `possível duplicado de ${parecido.id}`, semZap].filter(Boolean).join("; ") || null,
    });
  }
  const resposta = saida.map(({ lead: _, ...r }) => r);
  if (!aplicar) return resposta;

  const writer = db.bulkWriter();
  for (const { slug, acao, lead } of saida) {
    if (acao === "pular") continue;
    for (const e of registrosDoSite(db, slug, lead, nichoDe(lead)!, { novo: acao === "criar", ownerId, origem: "prospeccao", escolha: escolhas.get(slug) })) {
      void writer.set(e.ref, e.dados, { merge: true });
    }
  }
  await writer.close();
  return resposta;
}

/** A entrada foi paga: o site deixa de ser proposta. Só vale para site gerado — o da
 *  fábrica é um arquivo, e gravar `gerado` nele o faria passar por gerado.
 *  Devolve se publicou, para quem chamou limpar o cache do site. */
export async function publicarSite(db: Firestore, slug: string) {
  const t = db.collection("tenants").doc(slug);
  if (!(await t.get()).get("gerado.sub")) return false;
  await t.update({ "gerado.publicadoEm": FieldValue.serverTimestamp() });
  return true;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** O que a página e a imagem de compartilhamento de um site gerado precisam.
 *  null = não é site do gerador (slug estranho, tenant inexistente ou da fábrica). */
export async function lerSite(db: Firestore, slug: string): Promise<DadosSite | null> {
  if (!SLUG.test(slug)) return null;
  const t = db.collection("tenants").doc(slug);
  const [tenant, servicos] = await Promise.all([t.get(), t.collection("services").where("active", "==", true).get()]);
  const gerado = tenant.get("gerado") as { sub?: Sub; bairro?: string; horario?: string; origem?: string; publicadoEm?: unknown; atualizadoEm?: { toDate(): Date }; escolha?: Escolha } | undefined;
  if (!tenant.exists || !gerado?.sub) return null;

  const quando = gerado.atualizadoEm?.toDate() ?? new Date();
  const s = (campo: string) => String(tenant.get(`site.${campo}`) ?? "");
  const n = (campo: string) => (typeof tenant.get(`site.${campo}`) === "number" ? (tenant.get(`site.${campo}`) as number) : null);
  return {
    slug,
    nome: String(tenant.get("name")),
    telefone: s("phone"),
    sub: gerado.sub,
    tipo: s("category"),
    endereco: s("address"),
    bairro: gerado.bairro ?? "",
    cidade: s("city"),
    uf: s("uf"),
    nota: n("rating"),
    avaliacoes: n("reviews"),
    instagram: s("instagram"),
    horario: gerado.horario ?? "",
    // a ordem em que o gerador gravou, a mesma que a agenda usa de desempate
    servicos: servicos.docs
      .sort((a, b) => Number(a.get("ordem") ?? 99) - Number(b.get("ordem") ?? 99))
      .map((d) => String(d.get("name")))
      .slice(0, 8),
    consultado: `${MESES[quando.getMonth()]} de ${quando.getFullYear()}`,
    origem: gerado.origem === "cadastro" ? "cadastro" : "prospeccao",
    publicado: !!gerado.publicadoEm,
    ...(gerado.escolha && { escolha: gerado.escolha }),
  };
}
