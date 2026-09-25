import { adminDb } from "@/lib/admin";
import type { DadosSite, Sub } from "@/lib/gerador";
import { renderBeleza } from "@/lib/site-beleza";
import { renderPet } from "@/lib/site-pet";

// Sites do gerador. O proxy reescreve {slug}.ruphus.site/ para /s/{slug}/index.html:
// quando a pasta existe em public/s (os sites da fábrica), o arquivo responde antes
// desta rota; sem pasta, a página é montada aqui com os dados do tenant.

const SLUG = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

// cache de um minuto, como a /bio; o gerador chama revalidatePath ao gravar,
// então um site novo ou editado aparece na hora
export const revalidate = 60;
export function generateStaticParams() {
  return [];
}

const naoAchado = () => new Response("Página não encontrada", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });

export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!SLUG.test(slug)) return naoAchado();
  const t = adminDb.collection("tenants").doc(slug);
  const [tenant, servicos] = await Promise.all([t.get(), t.collection("services").where("active", "==", true).get()]);
  const gerado = tenant.get("gerado") as { sub?: Sub; bairro?: string; horario?: string; atualizadoEm?: { toDate(): Date } } | undefined;
  if (!tenant.exists || !gerado?.sub) return naoAchado();

  const quando = gerado.atualizadoEm?.toDate() ?? new Date();
  const s = (campo: string) => String(tenant.get(`site.${campo}`) ?? "");
  const n = (campo: string) => (typeof tenant.get(`site.${campo}`) === "number" ? (tenant.get(`site.${campo}`) as number) : null);
  const dados: DadosSite = {
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
  const html = gerado.sub === "petshop" || gerado.sub === "vet" ? renderPet(dados) : renderBeleza(dados);
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}
