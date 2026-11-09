// Sites da fábrica (HTML estático no Storage) para o modelo do gerador, que permite trocar o
// layout pelo admin. Sem --aplicar, só lê: conta quem tem o que o modelo precisa.
//
//   npm run converter:fabrica -- [--csv arquivo.csv]          # levantamento
//   npm run converter:fabrica -- previa <slug> arquivo.html    # o site no modelo, sem gravar nada
//   npm run converter:fabrica -- converter <slug> [--aplicar]  # um site; sem --aplicar, só diz o que faria
//   npm run converter:fabrica -- desfazer <slug> [--aplicar]   # volta o HTML da fábrica
//   npm run converter:fabrica -- converter-todos [--aplicar]   # todos os que podem; a lista do que
//                                                              # converteu fica em fabrica-backup/_lotes/
//   npm run converter:fabrica -- desfazer-lote <arquivo> [--aplicar]
//
// Converter guarda o index.html em fabrica-backup/{slug}/ (fora de sites/, que a rota lê), grava
// `gerado` no tenant e tira o index.html de sites/: a rota passa a montar o site pelo modelo.
// Recusa cliente (fechado ou com dono de fora). Site que já tem `gerado` e ainda tem index.html
// (a fábrica publicou por cima) também converte: tira o arquivo e mantém o `gerado` que estava. Número fixo vai também: o modelo
// troca o WhatsApp por ligação (paraTelefone, em src/lib/gerador.ts).
import { writeFileSync } from "node:fs";
import type { DocumentSnapshot } from "firebase-admin/firestore";
import { FieldValue } from "firebase-admin/firestore";
import { adminBucket, adminDb } from "@/lib/admin";
import { normalizar } from "@/lib/catalogo";
import { nichoDe, SUBS, type DadosSite, type Sub } from "@/lib/gerador";
import { PREFIXO } from "@/lib/site-arquivo";
import { ehClaro, renderClaro } from "@/lib/site-claro";
import { renderEditorial } from "@/lib/site-editorial";

const arg = (nome: string) => (process.argv.includes(nome) ? process.argv[process.argv.indexOf(nome) + 1] : null);

// o tipo schema.org do JSON-LD, quando aponta um ramo só
const POR_TIPO: Record<string, Sub> = {
  ...Object.fromEntries(
    (Object.entries(SUBS) as [Sub, (typeof SUBS)[Sub]][])
      .filter(([, s], _, todos) => todos.filter(([, o]) => o.tipo === s.tipo).length === 1)
      .map(([sub, s]) => [s.tipo.toLowerCase(), sub]),
  ),
  dayspa: "estetica",
};

function jsonLd(html: string) {
  const nos: Record<string, unknown>[] = [];
  for (const [, bruto] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try {
      const d = JSON.parse(bruto);
      const g = Array.isArray(d) ? d : (d?.["@graph"] ?? [d]);
      for (const n of Array.isArray(g) ? g : [g]) if (n && typeof n === "object") nos.push(n);
    } catch {
      // JSON-LD quebrado: segue sem ele
    }
  }
  return nos;
}

const DIAS: Record<string, string> = { mo: "Seg", tu: "Ter", we: "Qua", th: "Qui", fr: "Sex", sa: "Sáb", su: "Dom" };
const ORDEM = Object.keys(DIAS);
const dia = (v: unknown) => String(v ?? "").replace(/^https?:\/\/schema\.org\//, "").slice(0, 2).toLowerCase();
const hora = (h: unknown) => String(h ?? "").slice(0, 5).replace(/^0/, "").replace(":00", "h").replace(":", "h");
const faixaDeDias = (ds: string[]) => {
  const i = ds.map((d) => ORDEM.indexOf(d)).filter((x) => x >= 0).sort((a, b) => a - b);
  if (!i.length) return "";
  const seguidos = i.every((x, k) => !k || x === i[k - 1] + 1);
  return i.length > 2 && seguidos ? `${DIAS[ORDEM[i[0]]]} a ${DIAS[ORDEM[i.at(-1)!]]}` : i.map((x) => DIAS[ORDEM[x]]).join(", ");
};

/** "Seg a Sáb 10h–22h · Dom 14h–21h", do JSON-LD (openingHoursSpecification ou openingHours). */
export function horarioDe(horas: unknown): string {
  if (typeof horas === "string") horas = [horas];
  if (!Array.isArray(horas)) return "";
  const partes = horas.flatMap((h) => {
    if (typeof h === "string") {
      // "Mo-Sa 10:00-22:00"
      const m = /^([A-Za-z,\s-]+)\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/.exec(h.trim());
      if (!m) return [];
      const ds = m[1].split(",").flatMap((p) => {
        const [a, b] = p.trim().split("-").map((x) => x.slice(0, 2).toLowerCase());
        return b ? ORDEM.slice(ORDEM.indexOf(a), ORDEM.indexOf(b) + 1) : [a];
      });
      return [`${faixaDeDias(ds)} ${hora(m[2])}–${hora(m[3])}`];
    }
    if (!h || typeof h !== "object") return [];
    const o = h as Record<string, unknown>;
    const ds = (Array.isArray(o.dayOfWeek) ? o.dayOfWeek : [o.dayOfWeek]).map(dia);
    const f = faixaDeDias(ds);
    return f && o.opens && o.closes ? [`${f} ${hora(o.opens)}–${hora(o.closes)}`] : [];
  });
  return [...new Set(partes)].join(" · ").slice(0, 120);
}

/** O que o modelo precisa e o tenant da fábrica não tem: ramo e horário. */
function doHtml(html: string, nome: string) {
  const nos = jsonLd(html);
  const negocio = nos.find((n) => n.address || n.telephone) ?? {};
  const tipo = String(negocio["@type"] ?? "");
  const titulo = /<title>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? "";
  // o nome diz mais que o título ("Barbearia Don Luiz"), e o título mais que o tipo schema.org,
  // que junta salão, estética e spa em "BeautySalon"
  const sub =
    nichoDe({ categoria: "", nome })?.sub ??
    nichoDe({ categoria: titulo.split(/[·|—–]/).slice(1).join(" "), nome: "" })?.sub ??
    POR_TIPO[tipo.toLowerCase()] ??
    null;
  return { sub, tipo, horario: horarioDe(negocio.openingHoursSpecification ?? negocio.openingHours) };
}

/** Os dados do site como o lerSite os montaria depois da conversão. */
async function dadosConvertidos(t: DocumentSnapshot, html: string): Promise<DadosSite | null> {
  const { sub, horario } = doHtml(html, String(t.get("name") ?? ""));
  if (!sub) return null;
  const servicos = await adminDb.collection(`tenants/${t.id}/services`).where("active", "==", true).get();
  const s = (c: string) => String(t.get(`site.${c}`) ?? "");
  const n = (c: string) => (typeof t.get(`site.${c}`) === "number" ? (t.get(`site.${c}`) as number) : null);
  return {
    slug: t.id, nome: String(t.get("name")), telefone: s("phone").replace(/\D/g, ""), sub, tipo: SUBS[sub].tipo,
    endereco: s("address"), bairro: "", cidade: s("city"), uf: s("uf"), nota: n("rating"), avaliacoes: n("reviews"),
    instagram: s("instagram"), horario,
    servicos: servicos.docs.sort((a, b) => Number(a.get("ordem") ?? 99) - Number(b.get("ordem") ?? 99)).map((d) => String(d.get("name"))).slice(0, 8),
    consultado: "", origem: "prospeccao", publicado: false, dominio: null,
  };
}

const BACKUP = "fabrica-backup";
const aplicar = process.argv.includes("--aplicar");
const plataforma = new Set(((await adminDb.doc("config/admin").get()).get("uids") as string[] | undefined) ?? []);
/** Por que este site não pode ser convertido, ou "" se pode. */
const recusa = (t: DocumentSnapshot, crm: DocumentSnapshot, sub: Sub | null) =>
  !t.exists ? "sem tenant"
  : crm.get("estagio") === "fechado" ? "cliente (fechado)"
  : t.get("ownerId") && !plataforma.has(t.get("ownerId")) ? "cliente (dono)"
  : !sub ? "sem ramo"
  : !normalizar(String(t.get("site.phone") ?? "")) ? "sem telefone"
  : "";

const html = async (slug: string) => (await adminBucket().file(`${PREFIXO}/${slug}/index.html`).download())[0].toString("utf8");

if (process.argv[2] === "previa") {
  const [, , , slug, saida] = process.argv;
  const t = await adminDb.doc(`tenants/${slug}`).get();
  const d = t.exists ? await dadosConvertidos(t, await html(slug)) : null;
  if (!d) throw new Error(`${slug}: sem tenant ou sem ramo reconhecível`);
  const pagina = (ehClaro(d.sub) ? renderClaro(d) : renderEditorial(d)).replace("<head>", `<head><base href="https://${slug}.ruphus.site/">`);
  writeFileSync(saida, pagina);
  console.log(`${slug}: ramo ${d.sub}, horário "${d.horario || "—"}", ${d.servicos.length} serviços → ${saida}`);
  process.exit(0);
}

/** Converte um site; sem `aplicar`, só confere. Lança com o motivo quando não pode. */
async function converter(slug: string) {
  const original = adminBucket().file(`${PREFIXO}/${slug}/index.html`);
  const copia = adminBucket().file(`${BACKUP}/${slug}/index.html`);
  const [t, crm] = await Promise.all([adminDb.doc(`tenants/${slug}`).get(), adminDb.doc(`crm/${slug}`).get()]);
  const { sub, horario } = doHtml(await html(slug), String(t.get("name") ?? ""));
  const motivo = recusa(t, crm, sub);
  if (motivo) throw new Recusa(motivo);
  if (aplicar) {
    await original.copy(copia);
    if (!(await copia.exists())[0]) throw new Error("backup não confirmado: nada foi alterado");
    // Já tinha `gerado` (o HTML da fábrica foi publicado por cima): fica o que o gerador gravou, só
    // marca a conversão e completa o horário. atualizadoEm diferente de convertidoEm é como o
    // desfazer reconhece esse caso.
    await t.ref.update(
      t.get("gerado")
        ? { "gerado.convertidoEm": FieldValue.serverTimestamp(), ...(!t.get("gerado.horario") && horario && { "gerado.horario": horario }) }
        : { gerado: { nicho: SUBS[sub!].nicho, sub: sub!, bairro: "", horario, origem: "prospeccao", atualizadoEm: FieldValue.serverTimestamp(), convertidoEm: FieldValue.serverTimestamp() } },
    );
    await original.delete();
  }
  return { sub: sub!, horario };
}

async function desfazer(slug: string) {
  const original = adminBucket().file(`${PREFIXO}/${slug}/index.html`);
  const copia = adminBucket().file(`${BACKUP}/${slug}/index.html`);
  const t = await adminDb.doc(`tenants/${slug}`).get();
  if (!(await copia.exists())[0]) throw new Error(`${slug}: sem backup em ${BACKUP}/`);
  if (!t.get("gerado.convertidoEm")) throw new Error(`${slug}: não foi convertido por este script`);
  if (aplicar) {
    await copia.copy(original);
    // gerado criado pela conversão: some inteiro; gerado anterior à conversão: só a marca sai
    const criadoAqui = t.get("gerado.atualizadoEm")?.isEqual?.(t.get("gerado.convertidoEm")) ?? true;
    await t.ref.update(criadoAqui ? { gerado: FieldValue.delete() } : { "gerado.convertidoEm": FieldValue.delete() });
  }
}

class Recusa extends Error {}
const SLUG_OK = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

if (process.argv[2] === "converter" || process.argv[2] === "desfazer") {
  const slug = process.argv[3];
  if (!SLUG_OK.test(slug ?? "")) throw new Error("uso: converter|desfazer <slug> [--aplicar]");
  if (process.argv[2] === "desfazer") {
    await desfazer(slug);
    console.log(`${slug}: ${aplicar ? "HTML da fábrica de volta (em até 1 minuto)" : "devolveria o HTML da fábrica e apagaria gerado"}`);
  } else {
    const { sub, horario } = await converter(slug);
    console.log(`${slug}: ramo ${sub}, horário "${horario || "—"}"${aplicar ? " — convertido (em até 1 minuto)" : " — só conferido"}`);
  }
  process.exit(0);
}

if (process.argv[2] === "converter-todos") {
  const [arquivos] = await adminBucket().getFiles({ prefix: `${PREFIXO}/`, matchGlob: `${PREFIXO}/*/index.html` });
  const slugs = arquivos.map((f) => f.name.split("/")[1]).filter((x) => SLUG_OK.test(x));
  const feitos: string[] = [];
  const recusados: Record<string, number> = {};
  const lote = `${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const salvar = async () => {
    if (!aplicar || !feitos.length) return;
    const corpo = JSON.stringify(feitos);
    await adminBucket().file(`${BACKUP}/_lotes/${lote}.json`).save(corpo, { contentType: "application/json" });
    writeFileSync(`converter-fabrica-${lote}.json`, corpo);
  };
  try {
    for (let i = 0; i < slugs.length; i += 5) {
      await Promise.all(
        slugs.slice(i, i + 5).map(async (slug) => {
          try {
            await converter(slug);
            feitos.push(slug);
          } catch (err) {
            if (!(err instanceof Recusa)) throw new Error(`${slug}: ${err instanceof Error ? err.message : err}`);
            recusados[err.message] = (recusados[err.message] ?? 0) + 1;
          }
        }),
      );
      process.stdout.write(`\r${Math.min(i + 5, slugs.length)}/${slugs.length} · ${aplicar ? "convertidos" : "converteria"} ${feitos.length}`);
    }
  } finally {
    // mesmo parando no meio: a lista do que já mudou é o que o desfazer-lote precisa
    await salvar();
  }
  console.log(`\n${aplicar ? "convertidos" : "converteria"}: ${feitos.length}; de fora: ${JSON.stringify(recusados)}`);
  if (aplicar) console.log(`lista: ${BACKUP}/_lotes/${lote}.json (e converter-fabrica-${lote}.json aqui)`);
  process.exit(0);
}

if (process.argv[2] === "desfazer-lote") {
  const lista = JSON.parse((await import("node:fs")).readFileSync(process.argv[3], "utf8")) as string[];
  let n = 0;
  for (const slug of lista) {
    await desfazer(slug);
    process.stdout.write(`\r${++n}/${lista.length}`);
  }
  console.log(`\n${aplicar ? "desfeitos" : "desfaria"}: ${n}`);
  process.exit(0);
}

// ---- levantamento
const [arquivos] = await adminBucket().getFiles({ prefix: `${PREFIXO}/`, matchGlob: `${PREFIXO}/*/index.html` });
const slugs = arquivos.map((f) => f.name.split("/")[1]);
console.log(`${slugs.length} sites da fábrica no Storage`);
type Linha = { slug: string; nome: string; tipo: string; sub: string; horario: string; endereco: boolean; motivo: string };
const linhas: Linha[] = [];
for (let i = 0; i < slugs.length; i += 10) {
  const lote = slugs.slice(i, i + 10);
  const [tenants, crms] = await Promise.all([
    adminDb.getAll(...lote.map((s) => adminDb.doc(`tenants/${s}`))),
    adminDb.getAll(...lote.map((s) => adminDb.doc(`crm/${s}`))),
  ]);
  await Promise.all(
    lote.map(async (slug, j) => {
      const t = tenants[j];
      const { sub, tipo, horario } = doHtml(await html(slug), String(t.get("name") ?? ""));
      // dono que não é conta da plataforma = o cliente já entrou (convite aceito ou cadastro)
      const motivo = recusa(t, crms[j], sub);
      linhas.push({ slug, nome: String(t.get("name") ?? ""), tipo, sub: sub ?? "", horario, endereco: !!t.get("site.address"), motivo });
    }),
  );
  process.stdout.write(`\r${Math.min(i + 10, slugs.length)}/${slugs.length}`);
}
console.log();
const prontos = linhas.filter((l) => !l.motivo);
console.log(Object.entries(Object.groupBy(linhas, (l) => l.motivo || "pronto")).map(([m, ls]) => `${m}: ${ls!.length}`).join("\n"));
console.log(`prontos com horário: ${prontos.filter((l) => l.horario).length}; com endereço: ${prontos.filter((l) => l.endereco).length}`);
console.log("ramos:", JSON.stringify(Object.fromEntries(Object.entries(Object.groupBy(prontos, (l) => l.sub)).map(([k, v]) => [k, v!.length]))));
const csv = arg("--csv");
if (csv) {
  const cab = Object.keys(linhas[0]) as (keyof Linha)[];
  writeFileSync(csv, [cab.join(","), ...linhas.map((l) => cab.map((k) => JSON.stringify(String(l[k]))).join(","))].join("\n"));
  console.log(`detalhe em ${csv}`);
}
process.exit(0);
