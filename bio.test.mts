import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { situacaoExpediente } from "@/lib/bio";
import { telefoneDoNegocio, telefoneFixo, whatsappDoNegocio } from "@/lib/contato";

const expediente = [
  { dia: 4, inicio: "09:00", fim: "18:00" },
  { dia: 5, inicio: "09:00", fim: "12:00" },
];

// Às 12:30Z de 13/11, São Paulo está sexta às 9:30 e Manaus, quinta às 8:30.
const virada = new Date("2026-11-13T12:30:00Z");
assert.equal(situacaoExpediente(expediente, "America/Manaus", virada).aberto, false);
assert.deepEqual(situacaoExpediente(expediente, "America/Sao_Paulo", virada), { aberto: true, ate: "12:00" });

// A abertura e o fechamento seguem o relógio do negócio, não o do servidor.
assert.deepEqual(situacaoExpediente(expediente, "America/Manaus", new Date("2026-11-12T13:00:00Z")), { aberto: true, ate: "18:00" });
assert.equal(situacaoExpediente(expediente, "America/Manaus", new Date("2026-11-12T12:59:00Z")).aberto, false);
assert.deepEqual(situacaoExpediente(expediente, "America/Manaus", new Date("2026-11-12T21:59:00Z")), { aberto: true, ate: "18:00" });
assert.equal(situacaoExpediente(expediente, "America/Manaus", new Date("2026-11-12T22:00:00Z")).aberto, false);
assert.equal(situacaoExpediente(expediente, "America/Rio_Branco", new Date("2026-11-12T14:00:00Z")).aberto, true);

assert.equal(telefoneFixo("559132364727"), true);
assert.equal(telefoneFixo("5591993721156"), false);
assert.equal(whatsappDoNegocio("559132364727", "Olá"), null);
assert.equal(whatsappDoNegocio("5591993721156", "Olá"), "https://wa.me/5591993721156?text=Ol%C3%A1");
assert.equal(telefoneDoNegocio("(91) 3236-4727"), "tel:+559132364727");
assert.equal(telefoneDoNegocio("(92) 99372-1156"), "tel:+5592993721156");
assert.equal(telefoneDoNegocio(""), null);

console.log("bio e contato: ok");

// ─── Layouts da bio (F4) ─────────────────────────────────────────────────────
// next/font só existe no build do Next: aqui cada fonte vira uma classe fixa
const require = createRequire(import.meta.url);
const fonte = () => ({ className: "fonte", variable: "fonte", style: { fontFamily: "fonte" } });
const caminhoFonte = require.resolve("next/font/google");
require.cache[caminhoFonte] = { id: caminhoFonte, filename: caminhoFonte, loaded: true, exports: { Fraunces: fonte, Figtree: fonte, Instrument_Sans: fonte, Instrument_Serif: fonte, IBM_Plex_Sans: fonte, IBM_Plex_Mono: fonte } } as unknown as NodeJS.Module;

// relógio fixo: quinta 12/11/2026, 10h30 em São Paulo (o mesmo da captura do snapshot)
const snap = JSON.parse(readFileSync(new URL("./bio-atual.snap.json", import.meta.url), "utf8"));
const FIXO = new Date(snap.relogio).getTime();
const DataReal = Date;
globalThis.Date = class extends DataReal {
  constructor(...a: unknown[]) {
    if (a.length) super(...(a as [number]));
    else super(FIXO);
  }
  static now() {
    return FIXO;
  }
} as DateConstructor;

const { default: Atual } = await import("@/app/bio/[tenant]/layouts/atual");
const { default: LayoutDaBio } = await import("@/app/bio/[tenant]/layouts/index");
const { resumoSemana } = await import("@/app/bio/[tenant]/partes");
const { aplicarCaso } = await import("@/app/bio/[tenant]/casos");
type Bio = import("@/app/bio/[tenant]/carregar").Bio;
type Livres = import("@/app/bio/[tenant]/carregar").Livres;
const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);

// a bio atual sai idêntica à de antes da divisão em layouts (capturada do page.tsx antigo)
for (const c of snap.casos) {
  const bio = { ...c.bio, categoria: null, fotos: [], layout: "atual" } as Bio;
  assert.equal(html(createElement(Atual, { tenant: snap.tenant, bio, livres: c.livres })), c.html, `atual mudou: ${c.nome}`);
  // e o seletor manda a "atual" (e layout sem código ainda) para ela
  for (const layout of ["atual", "cartaz"] as const) assert.equal(html(createElement(LayoutDaBio, { tenant: snap.tenant, bio: { ...bio, layout }, livres: c.livres })), c.html);
}

const [completo, minimo] = snap.casos as { bio: Bio; livres: Livres }[];
const fotos = ["/s/assets/beleza/sobrancelha-1/ga1.jpg", "/s/assets/beleza/sobrancelha-1/ga2.jpg", "/s/slug-teste/fotos/ga3.jpg?v=1"];
const base = { ...completo.bio, categoria: "Design de sobrancelha", fotos } as Bio;
const raiz = { clara: 'class="fonte fonte bc"', galeria: 'class="fonte fonte bg"', agenda: 'class="fonte fonte ba"' };
for (const layout of ["clara", "galeria", "agenda"] as const) {
  const r = (bio: Bio, livres: Livres | null = completo.livres) => html(createElement(LayoutDaBio, { tenant: "slug-teste", bio: { ...bio, layout }, livres }));
  const cheio = r(base);
  assert.ok(cheio.includes(raiz[layout]), `${layout}: layout errado`);
  // serviço com preço, "a partir de" e sem preço (saúde): este mostra "na avaliação"
  assert.ok(cheio.includes("R$\u00a040,00") && cheio.includes("a partir de R$\u00a055,00") && cheio.includes("na avaliação"), `${layout}: preços`);
  // horário livre abre a agenda no serviço, dia e hora; o primeiro vem destacado
  assert.ok(cheio.includes('href="https://sobrancelhas.ruphus.site/agendar?servico=s5&amp;data=2026-11-12&amp;hora=14:30"'), `${layout}: horário`);
  const p = raiz[layout].slice(-3, -1);
  assert.ok(cheio.includes(`class="${p}-d-h ${p}-d-h1"`), `${layout}: destaque`);
  assert.ok(cheio.includes("Ver os 5 serviços") && cheio.includes('href="https://sobrancelhas.ruphus.site/"'), `${layout}: ver todos e site`);
  assert.ok(cheio.includes("4,9") && cheio.includes("1.234"), `${layout}: nota`);
  assert.ok(cheio.includes("--a:#B5566B"), `${layout}: cor do negócio`);
  // sem nota: nada de estrela nem "Google"
  const semNota = r({ ...base, nota: null, avaliacoes: null });
  assert.ok(!semNota.includes("★") && !semNota.includes("Google") && !semNota.includes("4,9"), `${layout}: sem nota`);
  // sem agenda: nenhum link para /agendar; serviço e barra vão para o WhatsApp
  const semAgenda = r({ ...base, agendaOnline: false }, null);
  assert.ok(!semAgenda.includes("/agendar") && semAgenda.includes("Falar no WhatsApp") && semAgenda.includes("Quero%20saber%20do%20servi%C3%A7o"), `${layout}: sem agenda`);
  // o mínimo (sem foto, nota, endereço, horário e preço; telefone fixo) não quebra
  const vazio = r({ ...minimo.bio, telefone: "559132364727", categoria: null, fotos: [] } as Bio, null);
  assert.ok(vazio.includes("Ligar para o negócio") && vazio.includes("tel:+559132364727") && !vazio.includes("<img"), `${layout}: mínimo`);
}
// Galeria com menos de 3 fotos cai na Clara
assert.ok(html(createElement(LayoutDaBio, { tenant: "t", bio: { ...base, layout: "galeria", fotos: fotos.slice(0, 2) }, livres: null })).includes("fonte fonte bc"));
// a galeria usa as fotos do site, a 3ª é a própria do negócio
assert.ok(html(createElement(LayoutDaBio, { tenant: "t", bio: { ...base, layout: "galeria" }, livres: null })).includes('src="/s/slug-teste/fotos/ga3.jpg?v=1"'));

assert.equal(resumoSemana(completo.bio.expediente), "Seg a sex 9h–19h · Sáb 8h–13h");
assert.equal(resumoSemana([{ dia: 6, inicio: "08:00", fim: "12:00" }, { dia: 0, inicio: "08:00", fim: "12:00" }, { dia: 2, inicio: "09:30", fim: "18:00" }]), "Ter 9h30–18h · Sáb a dom 8h–12h");

// casos da prévia: puros, sem mexer no original
assert.equal(aplicarCaso(base, "semnota").nota, null);
assert.equal(aplicarCaso(base, "umserv").servicos.length, 1);
assert.ok(aplicarCaso(base, "semprec").servicos.every((s) => s.preco === 0));
assert.equal(aplicarCaso(base, "poucas").fotos.length, 1);
assert.ok(aplicarCaso(base, "longo").nome.length > 50);
assert.equal(aplicarCaso(base, "normal"), base);
assert.equal(base.servicos[0].preco, 4000);

globalThis.Date = DataReal;
console.log("layouts da bio: ok");
