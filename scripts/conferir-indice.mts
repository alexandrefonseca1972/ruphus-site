// Teste 7 do docs/plano-paginacao-admin.md (6.5): monta o índice do painel contra a produção,
// só lendo, e confere com a leitura que o /admin faz hoje. Mede a montagem (tempo e memória).
// Custa ~60 mil leituras (índice + leitura atual): rodar uma vez por fase, não em loop.
//
//   npm run conferir:indice
import { adminDb } from "@/lib/admin";
import { lerCrm } from "@/lib/crm";
import { ESTAGIOS } from "@/lib/crm-tipos";
import { limiteStaffDe } from "@/lib/limites";
import { consultar } from "@/lib/painel-consulta";
import { criarIndice } from "@/lib/painel-indice.server";
import { responderPainel } from "@/lib/painel-rota.server";
import { ALERTAS, nichoDe, ORDENS, PRAZOS, SEM_FILTROS, SITUACOES, type Espaco, type Filtros, type RespostaPainel } from "@/lib/painel-tipos";

const mb = (n: number) => `${Math.round(n / 2 ** 20)} MB`;
const memoria = () => process.memoryUsage();

// ---- índice
const m0 = memoria();
const t0 = Date.now();
const indice = criarIndice(adminDb);
const pronto = await indice.pronto();
const lista = pronto.lista();
globalThis.gc?.();
const m1 = memoria();
console.log(`montagem: ${((Date.now() - t0) / 1000).toFixed(1)} s, RSS +${mb(m1.rss - m0.rss)}, heap +${mb(m1.heapUsed - m0.heapUsed)} (RSS ${mb(m1.rss)})`);

// ---- leitura de hoje (cópia de espacosComAcessos e acessosPorEspaco, em src/app/admin/actions.ts)
const CAMPOS = ["name", "site.phone", "site.category", "site.city", "site.uf", "site.rating", "site.reviews", "limiteStaff", "modulos.financeiro"];
const admins = ((await adminDb.doc("config/admin").get()).get("uids") as string[] | undefined) ?? [];
const filtrado = admins.length > 0 && admins.length <= 10;
const membros = await (filtrado ? adminDb.collectionGroup("members").where("uid", "not-in", admins) : adminDb.collectionGroup("members")).select("role").get();
const porEspaco = new Map<string, number>();
const somar = (m: FirebaseFirestore.DocumentSnapshot) => {
  if (!m.exists || m.get("role") === "member") return;
  const espaco = m.ref.parent.parent;
  if (espaco?.parent.id === "tenants") porEspaco.set(espaco.id, (porEspaco.get(espaco.id) ?? 0) + 1);
};
membros.docs.forEach(somar);
const comCliente = [...porEspaco.keys()];
if (filtrado && comCliente.length) (await adminDb.getAll(...comCliente.flatMap((s) => admins.map((uid) => adminDb.doc(`tenants/${s}/members/${uid}`))), { fieldMask: ["role"] })).forEach(somar);
const acessos = (slug: string) => porEspaco.get(slug) ?? (filtrado ? 1 : 0);
const [tenants, crmAntigo] = await Promise.all([adminDb.collection("tenants").select(...CAMPOS).get(), lerCrm(adminDb)]);
const antigos: Espaco[] = tenants.docs
  .map((d) => ({
    slug: d.id,
    nome: String(d.get("name") ?? d.id),
    telefone: d.get("site.phone") ?? null,
    nicho: nichoDe(d.get("site.category")),
    cidade: d.get("site.city") ?? null,
    uf: d.get("site.uf") ?? null,
    nota: d.get("site.rating") ?? null,
    avaliacoes: d.get("site.reviews") ?? null,
    acessos: acessos(d.id),
    limiteStaff: limiteStaffDe(d.get("limiteStaff") as number | undefined),
    caixa: d.get("modulos.financeiro") === true,
  }))
  .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));

// ---- dados: campo a campo
let falhas = 0;
const falhou = (msg: string) => (falhas++, console.log(`DIFERENTE: ${msg}`));
if (lista.length !== antigos.length) falhou(`${lista.length} negócios no índice, ${antigos.length} na leitura de hoje`);
const doIndice = new Map(lista.map((e) => [e.slug, e]));
const porCampo = new Map<string, string[]>();
for (const a of antigos) {
  const n = doIndice.get(a.slug);
  if (!n) {
    falhou(`${a.slug} falta no índice`);
    continue;
  }
  for (const k of Object.keys(a) as (keyof Espaco)[]) {
    if (a[k] !== n[k]) porCampo.set(k, [...(porCampo.get(k) ?? []), a.slug]);
  }
}
// limpeza do índice (6.3): nome, telefone, cidade, UF, nota e avaliações fora do padrão viram o neutro
for (const [campo, slugs] of porCampo) console.log(`campo ${campo}: ${slugs.length} diferem (limpeza), ex.: ${slugs.slice(0, 5).join(", ")}`);
const crmIndice = pronto.crm;
const slugsCrm = new Set([...Object.keys(crmAntigo), ...Object.keys(crmIndice)]);
let crmDiferente = 0;
for (const s of slugsCrm) if (JSON.stringify(crmAntigo[s]) !== JSON.stringify(crmIndice[s])) crmDiferente++;
if (crmDiferente) falhou(`${crmDiferente} documentos do CRM diferentes`);
console.log(`dados: ${lista.length} negócios, ${slugsCrm.size} no CRM; ${porCampo.size ? "diferenças só de limpeza acima" : "iguais"}`);

// ---- 50 consultas pelo endpoint contra o cálculo de hoje sobre a leitura de hoje
let semente = 7;
const sorteio = () => ((semente = (semente * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const um = <T,>(xs: readonly T[]) => xs[Math.floor(sorteio() * xs.length)];
const talvez = <T,>(x: T, vazio: T) => (sorteio() < 0.3 ? x : vazio);
const hoje = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const ufs = [...new Set(antigos.map((e) => e.uf).filter((u): u is string => !!u))];
const verificar = async () => ({ uid: admins[0], authTimeMs: Date.now() });
let consultasDiferentes = 0;
for (let i = 0; i < 50; i++) {
  const nome = um(antigos).nome;
  const f: Filtros = {
    ...SEM_FILTROS,
    busca: talvez(nome.slice(0, 4), ""),
    uf: talvez(um(ufs), ""),
    situacao: talvez(um(SITUACOES), ""),
    estagio: talvez(um(ESTAGIOS), ""),
    prazo: talvez(um(PRAZOS), ""),
    alerta: sorteio() < 0.1 ? um(ALERTAS) : "",
    fora: sorteio() < 0.1,
    caixa: sorteio() < 0.1,
    contato: sorteio() < 0.1,
    fixados: sorteio() < 0.1,
    ordem: um(ORDENS),
  };
  const params = new URLSearchParams({ hoje, tz: "America/Sao_Paulo", n: "40" });
  for (const [k, v] of Object.entries(f)) if (v !== "" && v !== false) params.set(k, String(v));
  const res = await responderPainel(new Request(`http://x/api/admin/painel?${params}`, { headers: { authorization: "Bearer x" } }), { db: adminDb, indice, verificar });
  const r = (await res.json()) as RespostaPainel;
  const esperado = consultar(antigos, f, { crm: crmAntigo, hoje, fuso: "America/Sao_Paulo" });
  const iguais =
    r.ok &&
    r.total === esperado.lista.length &&
    JSON.stringify(r.itens.map((e) => e.slug)) === JSON.stringify(esperado.lista.slice(0, 40).map((e) => e.slug)) &&
    JSON.stringify([r.contagens.ufs, r.contagens.estagios, r.contagens.prazos, r.contagens.visoes, r.contagens.totais, r.contagens.caixa]) ===
      JSON.stringify([esperado.ufs, esperado.estagios, esperado.prazos, esperado.visoes, esperado.totais, esperado.caixa]);
  if (!iguais) {
    consultasDiferentes++;
    console.log(`consulta ${i} diferente: ${params.toString().replace(/busca=[^&]*/, "busca=…")}`, r.ok ? `total ${r.total} × ${esperado.lista.length}` : r);
  }
}
if (consultasDiferentes) falhou(`${consultasDiferentes} de 50 consultas`);
console.log(`consultas: ${50 - consultasDiferentes} de 50 iguais`);

indice.soltar();
console.log(falhas ? `${falhas} diferença(s)` : "conferido: ok");
process.exit(falhas ? 1 : 0);
