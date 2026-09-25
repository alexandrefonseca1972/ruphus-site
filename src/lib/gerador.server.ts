import "server-only";
import { FieldValue, type Firestore } from "firebase-admin/firestore";
import { z } from "zod";
import { EQUIPE, montar, porRamo } from "@/lib/catalogo";
import { ErroPrevisto } from "@/lib/erro-previsto";
import { candidatos, type DadosSite, fixo, Lead, nichoDe, type Sub } from "@/lib/gerador";
import { visualEditorial } from "@/lib/site-editorial";
import { ehClaro, visualClaro } from "@/lib/site-claro";

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
  const porTelefone = new Map<string, { slug: string; gerado: boolean }>();
  for (let i = 0; i < telefones.length; i += 30) { // o "in" do Firestore aceita até 30
    const achados = await tenants.where("site.phone", "in", telefones.slice(i, i + 30)).select("site.phone", "gerado").get();
    for (const d of achados.docs) {
      const t = String(d.get("site.phone"));
      // entre um gerado e outro qualquer com o mesmo número, o que não é gerado decide: não duplicar
      if (!porTelefone.has(t) || !d.get("gerado")) porTelefone.set(t, { slug: d.id, gerado: !!d.get("gerado") });
    }
  }

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
    if (ja) {
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
    const n = nichoDe(lead)!;
    const visual = ehClaro(n.sub) ? visualClaro(slug, n.sub) : visualEditorial(slug, n.sub);
    const t = tenants.doc(slug);
    const novo = acao === "criar";
    void writer.set(t, {
      name: lead.nome,
      ...(novo && { ownerId, createdAt: FieldValue.serverTimestamp() }),
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
      gerado: { nicho: n.nicho, sub: n.sub, bairro: lead.bairro, horario: lead.horario, atualizadoEm: FieldValue.serverTimestamp() },
    }, { merge: true });
    // Agenda, dono e CRM só na criação: depois disso quem mexe é o dono do
    // negócio ou o funil, e reenviar a planilha não pode apagar o que fizeram.
    if (novo) {
      void writer.set(t.collection("members").doc(ownerId), { uid: ownerId, role: "owner", createdAt: FieldValue.serverTimestamp() });
      const servicos = (lead.servicos.length ? lead.servicos.map(montar) : porRamo(`${RAMO[n.sub]} ${lead.categoria}`))
        // saúde não anuncia preço (regra dos conselhos): o valor fica "a combinar"
        .map((s) => (n.nicho === "saude" ? { ...s, priceCents: 0 } : s));
      servicos.forEach(({ id, ...s }, ordem) => void writer.set(t.collection("services").doc(id), { ...s, ordem }));
      void writer.set(t.collection("staff").doc("equipe"), { ...EQUIPE, serviceIds: servicos.map((s) => s.id), createdAt: FieldValue.serverTimestamp() });
      // o levantamento do lead (score e gancho) vira nota no funil: quem abre a ficha já tem a abordagem
      const nota = [lead.score && `Score do levantamento: ${lead.score}.`, lead.abordagem && `Abordagem sugerida: ${lead.abordagem}`].filter(Boolean).join(" ").slice(0, 600);
      if (nota) void writer.create(db.collection(`crm/${slug}/notas`).doc(), { texto: nota, autor: "Gerador de sites", quando: FieldValue.serverTimestamp() });
      void writer.set(db.collection("crm").doc(slug), {
        origem: "importado",
        ...(lead.email && { donoEmail: lead.email }),
        ...(nota && { notas: FieldValue.increment(1) }),
      }, { merge: true });
    }
  }
  await writer.close();
  return resposta;
}

const SLUG = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** O que a página e a imagem de compartilhamento de um site gerado precisam.
 *  null = não é site do gerador (slug estranho, tenant inexistente ou da fábrica). */
export async function lerSite(db: Firestore, slug: string): Promise<DadosSite | null> {
  if (!SLUG.test(slug)) return null;
  const t = db.collection("tenants").doc(slug);
  const [tenant, servicos] = await Promise.all([t.get(), t.collection("services").where("active", "==", true).get()]);
  const gerado = tenant.get("gerado") as { sub?: Sub; bairro?: string; horario?: string; atualizadoEm?: { toDate(): Date } } | undefined;
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
  };
}
