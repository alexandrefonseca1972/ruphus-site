// Monta o catálogo de agendamento de cada tenant a partir do site: os serviços
// vêm da própria seção "Serviços" da página; duração e preço, de uma tabela por
// tipo de serviço. Idempotente: roda de novo só completa o que falta.
//
//   OWNER_UID=... npm run seed:agenda -- [--dry-run] [slug ...]
//   npx tsx scripts/seed-agenda.mts --self-check
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { applicationDefault, cert, initializeApp } from "firebase-admin/app";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

// duração (min) e preço (R$) típicos por tipo de serviço; a primeira regra que casar vence
const TABELA: [RegExp, number, number][] = [
  [/banho de gel|banho em gel/i, 60, 70], // unha, não pet
  [/banho\s*(e|\+)\s*tosa|tosa\s*(e|\+)\s*banho/i, 120, 100],
  [/tosa|grooming/i, 90, 80],
  [/banho/i, 60, 60],
  [/vacina/i, 20, 90],
  [/consulta|clínic|clinic|veterin|check-?up|avalia/i, 40, 120],
  [/exame|laborat|ultrassom|raio-?x/i, 30, 150],
  [/castra|cirurg/i, 60, 400],
  [/corte\s*(e|\+)\s*barba|combo/i, 75, 70],
  [/barba|navalha/i, 30, 35],
  [/corte|cabelo|degrad|máquina/i, 45, 45],
  [/progressiva|alisa|selage|botox|relaxa/i, 180, 250],
  [/colora|mecha|luzes|tintura|loiro|platina/i, 150, 220],
  [/escova|finaliza|penteado|chapinha/i, 45, 50],
  [/hidrata|cronograma|tratamento capilar|cauteriza/i, 60, 90],
  [/tranç|dread|nagô|box braid/i, 180, 200],
  [/alongamento|fibra|gel|postiç/i, 120, 150],
  [/manicure|esmalta|unha|nail/i, 45, 35],
  [/pedicure|spa dos pés|podolog/i, 60, 50],
  [/sobrancelha|henna|micropigment|design/i, 30, 40],
  [/cíli|cili|lash|extens/i, 120, 150],
  [/depila|cera|laser/i, 45, 70],
  [/limpeza de pele|peeling|facial|skin/i, 60, 120],
  [/massagem|massot|relaxa|drenagem|spa/i, 60, 120],
  [/maquiagem|make/i, 60, 100],
  [/tatua|tattoo|piercing/i, 120, 250],
  [/microagulha|preenchi|toxina|harmoniza|estétic/i, 60, 200],
];

// o que a página lista mas não se agenda: produto, loja, entrega
const NAO_AGENDA =
  /raç|racao|acessóri|acessori|petisc|farmác|farmac|produto|loja|pet shop|petshop|aquari|roedor|aves|delivery|entrega|leva-e-traz|estacionamento|wi-?fi|brinquedo|coleira|medicament|vestuári|banho self|autosservi/i;

const TETO = 8; // catálogo curto escolhe melhor que catálogo longo

// quando a página não lista nada agendável (só produtos, ou sem seção de serviços),
// o catálogo sai do ramo do negócio, lido do título e da descrição
const PADRAO: [RegExp, string[]][] = [
  [/veterin|clínica animal|clinica veterin|hospital veterin/i, ["Consulta veterinária", "Vacinação", "Banho e tosa"]],
  [/pet ?shop|petshop|agropet|banho e tosa|ração|racao|animal/i, ["Banho", "Tosa", "Banho e tosa"]],
  [/barbearia|barber|barbeiro/i, ["Corte", "Barba", "Corte + barba"]],
  [/tattoo|tatuagem|piercing/i, ["Sessão de tatuagem", "Orçamento"]],
  [/nail|esmalteria|manicure|unhas/i, ["Manicure", "Pedicure", "Alongamento em gel"]],
  [/podolog/i, ["Podologia"]],
  [/depila|laser/i, ["Depilação a laser", "Avaliação"]],
  [/massag|massot|spa|terapi/i, ["Massagem relaxante", "Drenagem linfática"]],
  [/sobrancelha|cíli|cili|lash|micropigment/i, ["Design de sobrancelha", "Extensão de cílios"]],
  [/cabelei|cabelo|hair|mechas|cachos|tranç|escova|salão|salao/i, ["Corte", "Escova", "Coloração", "Hidratação"]],
  [/estétic|estetic|beleza|pele|dermat|clínic|clinic/i, ["Limpeza de pele", "Avaliação estética"]],
];

function porRamo(html: string) {
  const texto = [/<title>([\s\S]*?)<\/title>/i, /name="description" content="([^"]*)"/i]
    .map((re) => re.exec(html)?.[1] ?? "").join(" ");
  const achado = PADRAO.find(([re]) => re.test(texto));
  return (achado ? achado[1] : ["Atendimento"]).map(montar);
}

export function extrairServicos(html: string) {
  const alvo = /id="servi[cç]os"/i.exec(html) ?? /class="[^"]*servi[cç]os/i.exec(html);
  if (!alvo) return [];
  const inicio = Math.max(0, html.lastIndexOf("<section", alvo.index));
  const depois = html.indexOf("<section", alvo.index + 10);
  const bloco = html.slice(inicio, depois === -1 ? alvo.index + 12000 : depois);
  const nomes = [...bloco.matchAll(/<h3[^>]*>([\s\S]*?)<\/h3>/gi)]
    .map((m) => desmarcar(m[1]))
    .filter((n) => n.length >= 3 && n.length <= 60 && !NAO_AGENDA.test(n));
  return [...new Set(nomes)].slice(0, TETO).map(montar);
}

function montar(name: string) {
  const regra = TABELA.find(([re]) => re.test(name));
  return {
    id: idDe(name),
    name,
    durationMin: regra ? regra[1] : 60,
    priceCents: (regra ? regra[2] : 80) * 100,
    active: true,
  };
}

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " ", mdash: "—", ndash: "–" };
const desmarcar = (s: string) =>
  s.replace(/<[^>]*>/g, "").replace(/&(#?\w+);/g, (m, e) => ENTIDADES[e] ?? m).replace(/\s+/g, " ").trim();

export const idDe = (nome: string) =>
  nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "servico";

// um profissional por tenant: a casa atende de segunda a sábado
const EQUIPE = {
  name: "Equipe",
  hours: { "1": h(), "2": h(), "3": h(), "4": h(), "5": h(), "6": { start: "09:00", end: "17:00" } },
  active: true,
};
function h() {
  return { start: "09:00", end: "19:00" };
}

function lerSites(dir: string, slugs: string[]) {
  const nomes = slugs.length
    ? slugs
    : readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("_"))
        .map((e) => e.name);
  // mesmos critérios do import de tenants: só pasta de cliente vira catálogo
  const SLUG = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
  const RESERVADOS = ["login", "agendar", "api", "catalogo", "privacidade", "assets"];
  return nomes.flatMap((slug) => {
    const index = join(dir, slug, "index.html");
    if (!existsSync(index) || !SLUG.test(slug) || RESERVADOS.includes(slug)) return [];
    const html = readFileSync(index, "utf8");
    const extraidos = extrairServicos(html);
    // sem nada agendável na página, o catálogo vem do ramo
    return [{ slug, services: extraidos.length ? extraidos : porRamo(html), doRamo: !extraidos.length }];
  });
}

function selfCheck() {
  const html = `<section class="servicos" id="servicos"><h2>O que fazemos</h2>
    <div><h3>Banho e tosa</h3><p>x</p></div><div><h3>Consulta veterinária</h3></div>
    <div><h3>Rações e alimentação</h3></div><div><h3>Banho e tosa</h3></div></section>
    <section id="local"><h3>Como chegar</h3></section>`;
  const s = extrairServicos(html);
  assert.deepEqual(s.map((x) => x.name), ["Banho e tosa", "Consulta veterinária"]); // produto fora, repetido fora, outra seção fora
  assert.equal(s[0].durationMin, 120);
  assert.equal(s[0].priceCents, 10000);
  assert.equal(s[0].id, "banho-e-tosa");
  assert.equal(s[1].durationMin, 40);
  // serviço desconhecido cai no padrão
  const outro = extrairServicos('<section id="servicos"><h3>Ritual secreto</h3></section>');
  assert.deepEqual([outro[0].durationMin, outro[0].priceCents], [60, 8000]);
  // página sem seção de serviços
  assert.deepEqual(extrairServicos("<section id=x><h3>Nada</h3></section>"), []);
  assert.equal(idDe("Coloração & Mechas"), "coloracao-mechas");
  // sem nada agendável, o catálogo sai do ramo lido do título
  const pet = porRamo('<title>Agropet Bicho Bom — pet shop em Manaus</title>');
  assert.deepEqual(pet.map((s) => s.name), ["Banho", "Tosa", "Banho e tosa"]);
  assert.equal(pet[0].durationMin, 60);
  assert.deepEqual(porRamo("<title>Negócio</title>").map((s) => s.name), ["Atendimento"]);
  console.log("self-check ok");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--self-check")) return selfCheck();
  const dryRun = args.includes("--dry-run");
  const slugs = args.filter((a) => !a.startsWith("--"));
  const dir = resolve("../sites");

  const sites = lerSites(dir, slugs);
  const doRamo = sites.filter((s) => s.doRamo).map((s) => s.slug);
  console.log(`${sites.length} sites: ${sites.length - doRamo.length} com serviços da própria página, ${doRamo.length} pelo ramo`);
  if (doRamo.length) console.log(`  pelo ramo: ${doRamo.slice(0, 8).join(", ")}…`);
  if (dryRun) {
    for (const s of sites.filter((x) => x.services.length).slice(0, 5))
      console.log(" ", s.slug, s.services.map((x) => `${x.name} ${x.durationMin}min R$${x.priceCents / 100}`));
    return;
  }

  const app = initializeApp({
    credential: process.env.FIREBASE_SERVICE_ACCOUNT
      ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
      : applicationDefault(),
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });
  const db = getFirestore(app);
  const writer = db.bulkWriter();
  let comCatalogo = 0;
  for (const { slug, services } of sites) {
    if (!services.length) continue;
    comCatalogo++;
    const t = db.collection("tenants").doc(slug);
    for (const { id, ...s } of services) void writer.set(t.collection("services").doc(id), s, { merge: true });
    void writer.set(
      t.collection("staff").doc("equipe"),
      { ...EQUIPE, serviceIds: services.map((s) => s.id), createdAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  }
  await writer.close();
  console.log(`${comCatalogo} tenants com catálogo de agendamento`);
}

await main();
