// Cria um tenant por pasta de site em ../sites. Idempotente.
// Uso: OWNER_UID=... npm run import:sites -- [--dry-run] [caminho]
//      npx tsx scripts/import-sites.mts --self-check
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const SLUG = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
// Reservado no app + páginas do próprio ysis.app, que não são sites de cliente
const RESERVED = ["login", "agendar", "api", "catalogo", "privacidade"];

type Site = { slug: string; name: string; phone?: string; address?: string; category?: string };

function jsonLd(html: string) {
  const out: Record<string, unknown>[] = [];
  for (const [, raw] of html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      continue; // alguns sites têm JSON-LD quebrado; o fallback resolve
    }
    const graph = Array.isArray(data) ? data : ((data as Record<string, unknown>)?.["@graph"] ?? [data]);
    for (const node of Array.isArray(graph) ? graph : [graph]) {
      if (node && typeof node === "object") out.push(node as Record<string, unknown>);
    }
  }
  return out;
}

export function extract(html: string): Omit<Site, "slug"> {
  let name: string | undefined;
  let phone: string | undefined;
  let address: string | undefined;
  let category: string | undefined;

  for (const node of jsonLd(html)) {
    const type = String(node["@type"] ?? "");
    if (type === "FAQPage" || type === "BreadcrumbList") continue;
    name ??= typeof node.name === "string" ? node.name : undefined;
    phone ??= typeof node.telephone === "string" ? node.telephone : undefined;
    category ??= type || undefined;
    const addr = node.address as Record<string, string> | undefined;
    if (!address && addr && typeof addr === "object") {
      address = [addr.streetAddress, addr.addressLocality, addr.addressRegion].filter(Boolean).join(", ") || undefined;
    }
  }

  if (!name) {
    const title = /<title>([\s\S]*?)<\/title>/.exec(html)?.[1];
    if (title) name = decodeEntities(title).split(/[—–|]/)[0].replace(/[\s-]+$/, "").trim();
  }
  phone ??= /wa\.me\/(\d{10,15})/.exec(html)?.[1];

  return { name: (name ?? "").slice(0, 80), phone: phone && digits(phone), address, category };
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " ", mdash: "—", ndash: "–",
};
const decodeEntities = (s: string) => s.replace(/&(#?\w+);/g, (m, e) => ENTITIES[e] ?? m);

// Mesmo formato dos clientes: só dígitos, com DDI (tenants/{t}/customers usa 5511912345678)
const digits = (phone: string) => {
  const d = phone.replace(/\D/g, "");
  return d.startsWith("55") ? d : `55${d}`;
};

function readSites(dir: string) {
  const sites: Site[] = [];
  const skipped: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.startsWith("_")) continue;
    const index = join(dir, entry.name, "index.html");
    if (!existsSync(index)) continue;
    if (!SLUG.test(entry.name) || RESERVED.includes(entry.name)) {
      skipped.push(entry.name);
      continue;
    }
    const meta = extract(readFileSync(index, "utf8"));
    if (!meta.name) {
      skipped.push(entry.name);
      continue;
    }
    sites.push({ slug: entry.name, ...meta });
  }
  return { sites: sites.sort((a, b) => a.slug.localeCompare(b.slug)), skipped };
}

function selfCheck() {
  const withLd = extract(
    `<title>Ignorado</title><script type="application/ld+json">{"@context":"https://schema.org","@type":"Barbershop","name":"Barbearia Soul","telephone":"+55 92 98473-9695","address":{"@type":"PostalAddress","streetAddress":"Av. Mário Ypiranga, 1300","addressLocality":"Manaus","addressRegion":"AM"}}</script>`,
  );
  assert.equal(withLd.name, "Barbearia Soul");
  assert.equal(withLd.phone, "5592984739695");
  assert.equal(withLd.category, "Barbershop");
  assert.equal(withLd.address, "Av. Mário Ypiranga, 1300, Manaus, AM");

  const fallback = extract(
    `<title>Shop das Unhas &amp; Nail &mdash; São Luís | Ysis</title><a href="https://wa.me/5598991831425?text=Oi">zap</a>`,
  );
  assert.equal(fallback.name, "Shop das Unhas & Nail");
  assert.equal(fallback.phone, "5598991831425");

  // FAQPage não deve virar nome/categoria do negócio
  const faqFirst = extract(
    `<script type="application/ld+json">{"@type":"FAQPage","name":"Perguntas"}</script><script type="application/ld+json">{"@type":"PetStore","name":"Snoopy Pet Shop"}</script>`,
  );
  assert.equal(faqFirst.name, "Snoopy Pet Shop");
  assert.equal(faqFirst.category, "PetStore");

  // JSON-LD quebrado cai no título
  assert.equal(extract(`<script type="application/ld+json">{oops</script><title>Plano B</title>`).name, "Plano B");

  console.log("self-check ok");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-check")) return selfCheck();

  const dryRun = args.includes("--dry-run");
  const dir = resolve(args.find((a) => !a.startsWith("--")) ?? "../sites");
  const ownerId = process.env.OWNER_UID;
  if (!ownerId) throw new Error("Defina OWNER_UID com o uid da conta dona dos tenants");

  const { sites, skipped } = readSites(dir);
  console.log(`${dir}: ${sites.length} sites, ${skipped.length} ignorados${skipped.length ? ` (${skipped.join(", ")})` : ""}`);
  console.log(`sem telefone: ${sites.filter((s) => !s.phone).map((s) => s.slug).join(", ") || "nenhum"}`);

  const app = initializeApp({
    credential: process.env.FIREBASE_SERVICE_ACCOUNT
      ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
      : applicationDefault(),
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
  const db = getFirestore(app);
  const existing = new Set((await db.collection("tenants").select().get()).docs.map((d) => d.id));

  if (dryRun) {
    for (const s of sites.slice(0, 5)) console.log(" ", JSON.stringify(s));
    console.log(`dry-run: ${sites.filter((s) => !existing.has(s.slug)).length} a criar, ${sites.filter((s) => existing.has(s.slug)).length} a atualizar`);
    return;
  }

  const writer = db.bulkWriter();
  let created = 0;
  for (const { slug, name, phone, address, category } of sites) {
    const isNew = !existing.has(slug);
    if (isNew) created++;
    const tenant = db.collection("tenants").doc(slug);
    void writer.set(
      tenant,
      {
        name,
        ownerId,
        site: { url: `https://${slug}.ruphus.site`, phone: phone ?? null, address: address ?? null, category: category ?? null },
        ...(isNew ? { createdAt: FieldValue.serverTimestamp() } : {}),
      },
      { merge: true },
    );
    void writer.set(
      tenant.collection("members").doc(ownerId),
      { uid: ownerId, role: "owner", ...(isNew ? { createdAt: FieldValue.serverTimestamp() } : {}) },
      { merge: true },
    );
  }
  await writer.close();
  console.log(`${created} criados, ${sites.length - created} atualizados`);
}

await main();
