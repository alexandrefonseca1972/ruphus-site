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
import { EQUIPE, idDe, montar, porRamo as ramo } from "@/lib/catalogo";

// o que a página lista mas não se agenda: produto, loja, entrega
const NAO_AGENDA =
  /raç|racao|acessóri|acessori|petisc|farmác|farmac|produto|loja|pet shop|petshop|aquari|roedor|aves|delivery|entrega|leva-e-traz|estacionamento|wi-?fi|brinquedo|coleira|medicament|vestuári|banho self|autosservi|tabela de pre|tabela de prec/i;

const TETO = 8; // catálogo curto escolhe melhor que catálogo longo

// sem nada agendável na página, o catálogo sai do ramo lido do título e da descrição
function porRamo(html: string) {
  return ramo([/<title>([\s\S]*?)<\/title>/i, /name="description" content="([^"]*)"/i]
    .map((re) => re.exec(html)?.[1] ?? "").join(" "));
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

const ENTIDADES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", nbsp: " ", mdash: "—", ndash: "–" };
const desmarcar = (s: string) =>
  s.replace(/<[^>]*>/g, "").replace(/&(#?\w+);/g, (m, e) => ENTIDADES[e] ?? m).replace(/\s+/g, " ").trim();

// Dia da semana como o app guarda: 0 = domingo … 6 = sábado (igual a Date#getDay)
const DIA: Record<string, number> = { su: 0, mo: 1, tu: 2, we: 3, th: 4, fr: 5, sa: 6 };
type Faixa = { start: string; end: string };

/** Horário de funcionamento do próprio site (JSON-LD `openingHours`).
 *
 *  Sem isso a agenda nascia 09–19 fixo e a bio anunciava horário errado — dado que o
 *  site já tem estruturado, vindo do Google. Aceita "Mo-Sa 09:00-20:00" e "Su 14:00-21:00".
 *  Devolve null quando a página não diz nada, e aí vale o padrão do EQUIPE. */
export function horariosDoSite(html: string): Record<string, Faixa> | null {
  const horas: Record<string, Faixa> = {};
  for (const [, bruto] of html.matchAll(/"openingHours"\s*:\s*(\[[^\]]*\]|"[^"]*")/g)) {
    let itens: string[];
    try {
      const lido = JSON.parse(bruto);
      itens = Array.isArray(lido) ? lido.map(String) : [String(lido)];
    } catch {
      continue; // JSON-LD quebrado não derruba o seed
    }
    for (const item of itens) {
      const m = /^([A-Za-z]{2})[a-z]*(?:\s*[-–]\s*([A-Za-z]{2})[a-z]*)?\s+(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})$/
        .exec(item.trim());
      if (!m) continue;
      const de = DIA[m[1].toLowerCase()];
      if (de === undefined) continue;
      const ate = m[2] ? DIA[m[2].toLowerCase()] : de;
      if (ate === undefined) continue;
      const faixa = { start: m[3].padStart(5, "0"), end: m[4].padStart(5, "0") };
      for (let i = de, guarda = 0; guarda <= 7; i = (i + 1) % 7, guarda++) {
        horas[String(i)] = faixa;
        if (i === ate) break;
      }
    }
  }
  return Object.keys(horas).length ? horas : null;
}

function lerSites(dir: string, slugs: string[]) {
  const nomes = slugs.length
    ? slugs
    : readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("_"))
        .map((e) => e.name);
  // mesmos critérios do import de tenants: só pasta de cliente vira catálogo
  const SLUG = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;
  const RESERVADOS = ["login", "agendar", "api", "catalogo", "privacidade", "assets"];
  return nomes.flatMap((slug) => {
    const index = join(dir, slug, "index.html");
    if (!existsSync(index) || !SLUG.test(slug) || RESERVADOS.includes(slug)) return [];
    const html = readFileSync(index, "utf8");
    const extraidos = extrairServicos(html);
    // sem nada agendável na página, o catálogo vem do ramo
    return [{
      slug,
      services: extraidos.length ? extraidos : porRamo(html),
      doRamo: !extraidos.length,
      hours: horariosDoSite(html),
    }];
  });
}

function selfCheck() {
  // horário vindo do JSON-LD: é o que a bio anuncia e o agendamento respeita
  const seg_sab = horariosDoSite('{"openingHours":["Mo-Sa 09:00-20:00"]}');
  assert.deepEqual(seg_sab, {
    "1": { start: "09:00", end: "20:00" }, "2": { start: "09:00", end: "20:00" },
    "3": { start: "09:00", end: "20:00" }, "4": { start: "09:00", end: "20:00" },
    "5": { start: "09:00", end: "20:00" }, "6": { start: "09:00", end: "20:00" },
  });
  // domingo com faixa própria não apaga o resto, e a semana dá a volta corretamente
  const comDomingo = horariosDoSite('{"openingHours":["Mo-Sa 10:00-22:00","Su 14:00-21:00"]}');
  assert.equal(comDomingo?.["0"].end, "21:00");
  assert.equal(comDomingo?.["3"].start, "10:00");
  // faixa que atravessa o domingo (sáb a seg)
  assert.deepEqual(Object.keys(horariosDoSite('{"openingHours":["Sa-Mo 08:00-12:00"]}') ?? {}).sort(),
    ["0", "1", "6"]);
  // um dia só, e hora sem zero à esquerda
  assert.deepEqual(horariosDoSite('{"openingHours":"Fr 9:00-18:30"}'), { "5": { start: "09:00", end: "18:30" } });
  // micropigmentação não pode cair na linha de sobrancelha (30min/R$40)
  {
    const micro = extrairServicos('<section id="servicos"><div><h3>Micropigmentação de sobrancelhas</h3></div>' +
      '<div><h3>Design de sobrancelhas</h3></div></section>');
    const porNome = Object.fromEntries(micro.map((s) => [s.name, s]));
    assert.deepEqual(
      [porNome["Micropigmentação de sobrancelhas"].durationMin, porNome["Micropigmentação de sobrancelhas"].priceCents],
      [120, 45000],
    );
    assert.deepEqual(
      [porNome["Design de sobrancelhas"].durationMin, porNome["Design de sobrancelhas"].priceCents],
      [30, 4000],
    );
  }

  // página sem horário, formato estranho e JSON quebrado caem no padrão
  assert.equal(horariosDoSite("<p>nada aqui</p>"), null);
  assert.equal(horariosDoSite('{"openingHours":["sempre aberto"]}'), null);
  assert.equal(horariosDoSite('{"openingHours":[quebrado}'), null);

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
  for (const { slug, services, hours } of sites) {
    if (!services.length) continue;
    comCatalogo++;
    const t = db.collection("tenants").doc(slug);
    // ordem: a posição em que o site do negócio lista o serviço, usada como
    // desempate enquanto ninguém agendou nada
    services.forEach(({ id, ...s }, ordem) => void writer.set(t.collection("services").doc(id), { ...s, ordem }, { merge: true }));
    void writer.set(
      t.collection("staff").doc("equipe"),
      { ...EQUIPE, hours: hours ?? EQUIPE.hours, serviceIds: services.map((s) => s.id), createdAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
  }
  await writer.close();
  console.log(`${comCatalogo} tenants com catálogo de agendamento`);
}

await main();
