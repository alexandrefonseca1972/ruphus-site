// Cria um tenant por pasta de site em ../sites. Idempotente.
// Uso: OWNER_UID=... npm run import:sites -- [--dry-run] [caminho]
//      npx tsx scripts/import-sites.mts --self-check
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

const SLUG = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;
// Reservado no app + páginas do próprio ysis.app, que não são sites de cliente
const RESERVED = ["login", "agendar", "api", "catalogo", "privacidade"];

type Site = {
  slug: string; name: string; phone?: string; address?: string; category?: string;
  city?: string; uf?: string; rating?: number; reviews?: number;
  color?: string; instagram?: string;
};

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
  let city: string | undefined;
  let uf: string | undefined;
  let rating: number | undefined;
  let reviews: number | undefined;

  for (const node of jsonLd(html)) {
    const type = String(node["@type"] ?? "");
    if (type === "FAQPage" || type === "BreadcrumbList") continue;
    name ??= typeof node.name === "string" ? node.name : undefined;
    phone ??= typeof node.telephone === "string" ? node.telephone : undefined;
    category ??= type || undefined;
    const addr = node.address as Record<string, string> | undefined;
    if (!address && addr && typeof addr === "object") {
      address = [addr.streetAddress, addr.addressLocality, addr.addressRegion].filter(Boolean).join(", ") || undefined;
      city ??= addr.addressLocality?.trim() || undefined;
      uf ??= addr.addressRegion?.trim().toUpperCase() || undefined;
    }
    // nota do Google: serve de relevância na hora de escolher quem procurar
    const nota = node.aggregateRating as Record<string, unknown> | undefined;
    if (nota && typeof nota === "object") {
      rating ??= numero(nota.ratingValue);
      reviews ??= numero(nota.reviewCount ?? nota.ratingCount);
    }
  }

  // "Barbearia em Parintins" e "Aparecida em Santarém" guardam a cidade no fim
  if (city) city = city.split(/\s+em\s+/i).pop()!.trim();

  // a maioria só diz a cidade no título: "… — Barbearia em São Luís (Itaqui-Bacanga)"
  if (!city || !CIDADES[semAcento(city)]) {
    const texto = [/<title>([\s\S]*?)<\/title>/i, /name="description" content="([^"]*)"/i]
      .map((re) => re.exec(html)?.[1] ?? "").join(" ");
    const achada = cidadeConhecida(texto);
    if (achada) [city, uf] = achada;
  }
  if (city && CIDADES[semAcento(city)]) uf ??= CIDADES[semAcento(city)];

  if (!name) {
    const title = /<title>([\s\S]*?)<\/title>/.exec(html)?.[1];
    if (title) name = decodeEntities(title).split(/[—–|]/)[0].replace(/[\s-]+$/, "").trim();
  }
  phone ??= /wa\.me\/(\d{10,15})/.exec(html)?.[1];

  // cor do tema e Instagram: o que o minisite precisa para parecer do negócio
  const color = /name="theme-color"[^>]*content="(#[0-9a-fA-F]{3,8})/i.exec(html)?.[1]
    ?? /--(?:acc|ink|brand)\s*:\s*(#[0-9a-fA-F]{3,8})/i.exec(html)?.[1];
  // instagram.com/explore, /p/… e afins não são perfil de ninguém
  const RESERVADO = ["explore", "p", "reel", "reels", "stories", "accounts", "direct", "tv", "about", "developer"];
  const perfil = [...html.matchAll(/instagram\.com\/([A-Za-z0-9._]{2,40})/g)]
    .map((m) => m[1].replace(/\.$/, ""))
    .find((u) => !RESERVADO.includes(u.toLowerCase()));

  return {
    name: (name ?? "").slice(0, 80), phone: phone && digits(phone), address, category,
    city, uf, rating, reviews, color, instagram: perfil,
  };
}

// As praças atendidas. Serve para reconhecer a cidade no texto e para dizer a UF
// quando a página cita só o nome. Distrito conhecido vira a cidade de que faz parte.
const CIDADES: Record<string, string> = {
  manaus: "AM", parintins: "AM", itacoatiara: "AM", manacapuru: "AM", "presidente figueiredo": "AM",
  belem: "PA", ananindeua: "PA", marituba: "PA", benevides: "PA", "santa izabel do para": "PA",
  castanhal: "PA", santarem: "PA", parauapebas: "PA", barcarena: "PA", abaetetuba: "PA",
  maraba: "PA", altamira: "PA", braganca: "PA", tucurui: "PA", icoaraci: "PA", outeiro: "PA",
  "sao luis": "MA", "paco do lumiar": "MA", "sao jose de ribamar": "MA", raposa: "MA", imperatriz: "MA",
};
// Icoaraci e Outeiro são distritos de Belém: quem procura por cidade espera Belém
const DISTRITOS: Record<string, string> = { icoaraci: "Belém", outeiro: "Belém" };

const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Acha no texto a primeira cidade conhecida; devolve [cidade, uf]. */
function cidadeConhecida(texto: string): [string, string] | null {
  const alvo = semAcento(texto);
  // nomes maiores primeiro: "são josé de ribamar" antes de "são luís"
  const nomes = Object.keys(CIDADES).sort((a, b) => b.length - a.length);
  const achado = nomes.find((n) => new RegExp(`\\b${n}\\b`).test(alvo));
  if (!achado) return null;
  const nome = DISTRITOS[achado] ?? achado.replace(/\b\w/g, (c) => c.toUpperCase());
  return [CAPITALIZADAS[achado] ?? nome, CIDADES[achado]];
}

// grafia correta (com acento) das cidades cujo nome não sai certo do capitalize
const CAPITALIZADAS: Record<string, string> = {
  belem: "Belém", santarem: "Santarém", maraba: "Marabá", tucurui: "Tucuruí", braganca: "Bragança",
  "sao luis": "São Luís", "paco do lumiar": "Paço do Lumiar", "sao jose de ribamar": "São José de Ribamar",
  "santa izabel do para": "Santa Izabel do Pará", "presidente figueiredo": "Presidente Figueiredo",
  icoaraci: "Belém", outeiro: "Belém",
};

const numero = (v: unknown) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : undefined;
};

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
  assert.equal(withLd.city, "Manaus");
  assert.equal(withLd.uf, "AM");

  // nota do Google e cidade tirada do título quando não há endereço estruturado
  const nota = extract(
    `<title>Alê Ferreira — Esmalteria em Cidade Nova, Ananindeua-PA</title>` +
      `<script type="application/ld+json">{"@type":"NailSalon","name":"Alê","aggregateRating":{"ratingValue":"5.0","reviewCount":89}}</script>`,
  );
  assert.equal(nota.rating, 5);
  assert.equal(nota.reviews, 89);
  assert.equal(nota.uf, "PA");
  assert.equal(nota.city, "Ananindeua");

  // cidade citada só no título, sem UF
  const slz = extract("<title>Barbearia Diniz — Barbearia em São Luís (Itaqui-Bacanga)</title>");
  assert.deepEqual([slz.city, slz.uf], ["São Luís", "MA"]);
  // o nome maior ganha do menor
  const ribamar = extract("<title>Barbearia Do Irmão — Barbearia em São José de Ribamar</title>");
  assert.equal(ribamar.city, "São José de Ribamar");
  // "X em Cidade" no endereço estruturado não vira cidade
  const suja = extract(
    `<script type="application/ld+json">{"@type":"HairSalon","name":"X","address":{"addressLocality":"Salão de Beleza em Parintins","addressRegion":"AM"}}</script>`,
  );
  assert.deepEqual([suja.city, suja.uf], ["Parintins", "AM"]);
  // distrito vira a cidade de que faz parte
  assert.equal(extract("<title>Pet Shop em Icoaraci</title>").city, "Belém");

  // cor da marca e Instagram alimentam o minisite
  const marca = extract(
    '<meta name="theme-color" content="#171521"><a href="https://instagram.com/barbearia.soul/">insta</a><title>X</title>',
  );
  assert.equal(marca.color, "#171521");
  assert.equal(marca.instagram, "barbearia.soul");
  // link genérico do Instagram não vira perfil do negócio
  const generico = extract('<a href="https://instagram.com/explore/tags/pet/">tags</a><a href="https://instagram.com/petshop.real/">perfil</a><title>X</title>');
  assert.equal(generico.instagram, "petshop.real");
  assert.equal(extract('<a href="https://instagram.com/explore/">x</a><title>X</title>').instagram, undefined);

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
  for (const { slug, name, phone, address, category, city, uf, rating, reviews, color, instagram } of sites) {
    const isNew = !existing.has(slug);
    if (isNew) created++;
    const tenant = db.collection("tenants").doc(slug);
    void writer.set(
      tenant,
      {
        name,
        ownerId,
        site: {
          url: `https://${slug}.ruphus.site`, phone: phone ?? null, address: address ?? null,
          category: category ?? null, city: city ?? null, uf: uf ?? null,
          rating: rating ?? null, reviews: reviews ?? null,
          color: color ?? null, instagram: instagram ?? null,
        },
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
