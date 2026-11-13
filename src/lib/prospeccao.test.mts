import assert from "node:assert/strict";
import { chaveDoIp, comBeacon, CORPO_VISITA_MAX, ehPrevia, limitador, rotaVisita, varianteAB, varianteDoNegocio } from "@/lib/prospeccao";
import { preencher, VARIANTES_F1, varianteDoId } from "@/lib/prospeccao-variantes";
import { paraVarianteId } from "@/lib/tipos-marca";
import { desistirDaReconciliacao, proximaReconciliacao, RECONCILIAR } from "@/lib/prospeccao-fila";

// ————— 1.6: A/B estável por hash(slug) % 2 —————
assert.equal(VARIANTES_F1.length, 2, "duas variantes no piloto");
for (const v of VARIANTES_F1) {
  assert.equal(paraVarianteId(v.id), v.id, "id na forma de slug");
  assert.equal(v.nicho, "salao");
  assert.equal(v.etapa, "primeiro");
  assert.match(v.texto, /PARE/, "toda variante oferece a saída");
  assert.doesNotMatch(v.texto, /R\$|https?:|\.site/, "primeiro contato sem preço e sem link");
  assert.equal(varianteDoId(v.id), v);
}
assert.equal(varianteDoId("nao-existe"), null);

const slugs = Array.from({ length: 1000 }, (_, i) => `salao-${i}`);
// valores fixos: trocar o hash ou a ordem das variantes muda a atribuição dos leads já contatados
assert.deepEqual(["salao-da-ana", "studio-bela", "x"].map((s) => varianteAB(s).id), ["salao-primeiro-elogio-google", "salao-primeiro-agenda-online", "salao-primeiro-elogio-google"]);
const primeira = slugs.filter((s) => varianteAB(s).id === VARIANTES_F1[0].id).length;
assert.ok(primeira > 430 && primeira < 570, `divisão perto de meio a meio: ${primeira}/1000`);
assert.equal(varianteDoNegocio("salao-1", "barbearia"), null, "fora do salão, sem variante");
assert.equal(varianteDoNegocio("salao-1", "salao")?.id, varianteAB("salao-1").id);

const texto = preencher(VARIANTES_F1[0], { oi: "Oi! Aqui é Ana, da Ruphus.", prova: "Vi o Salão X no Google.", nome: "Salão X" });
assert.doesNotMatch(texto, /\{|\}/, "nenhum marcador sobra");
assert.match(texto, /^Oi! Aqui é Ana, da Ruphus\. Vi o Salão X no Google\./);
console.log("variantes e A/B: ok");

// ————— 1.8: o beacon não conta prévia de link e respeita o limite —————
for (const ua of [
  "WhatsApp/2.23.20.0 A",
  "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
  "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  "TelegramBot (like TwitterBot)",
  "curl/8.4.0",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0",
  "Mozilla/5.0 (compatible; MJ12bot/v1.4.8; http://mj12bot.com/)",
  "Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)",
  "Mozilla/5.0 (compatible; bot)",
  "",
  null,
]) assert.equal(ehPrevia(ua), true, `prévia: ${ua}`);
for (const ua of [
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; SM-A146M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
  // CUBOT é marca de celular: "bot" no meio da palavra não é robô
  "Mozilla/5.0 (Linux; Android 10; CUBOT X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
]) assert.equal(ehPrevia(ua), false, `navegador: ${ua}`);

{
  const pode = limitador({ porIp: 2, porSlug: 1, janelaMs: 1000 });
  assert.equal(pode("1.1.1.1", "a", 0), true);
  assert.equal(pode("1.1.1.1", "a", 10), false, "o mesmo slug, uma vez por janela");
  assert.equal(pode("1.1.1.1", "b", 20), false, "o IP já usou as 2 da janela");
  assert.equal(pode("2.2.2.2", "b", 30), true, "outro IP, outro slug");
  assert.equal(pode("1.1.1.1", "c", 1001), true, "a janela vence");
}
{
  // IPv6 por /64: trocar o sufixo não dá cota nova
  assert.equal(chaveDoIp("2001:db8:a:b:1:2:3:4"), "2001:db8:a:b::/64");
  assert.equal(chaveDoIp("2001:0db8:000a:000b::99"), "2001:db8:a:b::/64");
  assert.equal(chaveDoIp("2001:db8::1"), "2001:db8:0:0::/64");
  assert.equal(chaveDoIp("::ffff:10.0.0.1"), "10.0.0.1", "IPv4 mapeado vale como IPv4");
  assert.equal(chaveDoIp("10.0.0.1"), "10.0.0.1");
  const pode = limitador({ porIp: 1, porSlug: 9, janelaMs: 1000 });
  assert.equal(pode("2001:db8:a:b::1", "a", 0), true);
  assert.equal(pode("2001:db8:a:b::2", "b", 1), false, "mesmo /64, mesma cota");
  assert.equal(pode("2001:db8:a:c::1", "c", 2), true, "outro /64");
}
{
  // o Map de IP tem teto: passou, saem as chaves mais antigas (e a mais antiga volta a ter cota)
  const pode = limitador({ porIp: 1, porSlug: 1, janelaMs: 60_000 }, 10);
  for (let i = 0; i < 50; i++) pode.ip(`10.0.0.${i}`, i);
  assert.ok(pode.tamanho() <= 10, `teto do Map: ${pode.tamanho()}`);
  assert.equal(pode.ip("10.0.0.0", 60), true, "a chave mais antiga saiu");
  // o de slug, não: um slug ainda na janela nunca é despejado (seria uma segunda visita na hora)
  for (let i = 0; i < 30; i++) assert.equal(pode.slug(`s${i}`, 100 + i), true);
  assert.equal(pode.slug("s0", 200), false, "s0 segue na janela, mesmo com o Map de slug acima do teto");
  // vencida a janela, a chave nova limpa as vencidas
  assert.equal(pode.slug("depois", 100 + 60_000 + 30), true);
  assert.ok(pode.tamanho() <= 10 + 10, `vencidas saíram: ${pode.tamanho()}`);
}

{
  const html = comBeacon("<html><body><p>oi</p></body></html>", "salao-da-ana");
  assert.match(html, /<script>.*sendBeacon\("\/api\/visita",JSON\.stringify\(\{slug:"salao-da-ana"\}\)\).*<\/script><\/body><\/html>$/);
  assert.match(html, /setTimeout\(function\(\)\{t=1;v\(\)\},3000\)/, "3 s na página");
  assert.match(html, /addEventListener\("scroll"/, "e uma rolagem");
  assert.match(comBeacon("<p>sem body</p>", "x"), /^<p>sem body<\/p><script>/);
}
console.log("beacon: ok");

// ————— POST /api/visita (rotaVisita, com registrarVisita trocado por dublê) —————
{
  const NAVEGADOR = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
  const gravados: string[] = [];
  const existentes = new Set(["salao-da-ana", "studio-bela"]);
  const POST = rotaVisita(
    { registrar: async (slug) => void gravados.push(slug), conhecido: (slug) => existentes.has(slug) },
    limitador({ porIp: 20, porSlug: 1, janelaMs: 60_000 }),
  );
  const pedido = (corpo: string, h: Record<string, string> = {}) =>
    POST(new Request("http://localhost/api/visita", { method: "POST", body: corpo, headers: { "user-agent": NAVEGADOR, "content-length": String(Buffer.byteLength(corpo)), ...h } }));
  const corpo = (slug: string) => JSON.stringify({ slug });

  // prévia de link: 204 e nada gravado
  assert.equal((await pedido(corpo("salao-da-ana"), { "user-agent": "facebookexternalhit/1.1", "x-real-ip": "1.1.1.1" })).status, 204);
  assert.deepEqual(gravados, []);
  // corpo inválido: 400
  assert.equal((await pedido("isto não é json", { "x-real-ip": "1.1.1.2" })).status, 400);
  assert.equal((await pedido(corpo("Com Espaço"), { "x-real-ip": "1.1.1.2" })).status, 400);
  assert.equal((await pedido(JSON.stringify({ outro: 1 }), { "x-real-ip": "1.1.1.2" })).status, 400);
  // corpo grande demais, ou sem content-length: 413 sem ler
  assert.equal((await pedido(JSON.stringify({ slug: "x".repeat(CORPO_VISITA_MAX) }), { "x-real-ip": "1.1.1.2" })).status, 413);
  assert.equal((await POST(new Request("http://localhost/api/visita", { method: "POST", body: corpo("a"), headers: { "user-agent": NAVEGADOR } }))).status, 413);
  // a primeira visita grava; o segundo pedido do mesmo slug não grava e responde o mesmo 204 do slug
  // inexistente (um 429 aqui diria que o slug existe)
  assert.equal((await pedido(corpo("salao-da-ana"), { "x-real-ip": "1.1.1.3" })).status, 204);
  assert.deepEqual(gravados, ["salao-da-ana"]);
  assert.equal((await pedido(corpo("salao-da-ana"), { "x-real-ip": "1.1.1.3" })).status, 204);
  assert.deepEqual(gravados, ["salao-da-ana"], "uma visita por slug na hora");
  // o IP vem do x-real-ip (não do x-forwarded-for que quem chama escreve): trocar o XFF não dá cota nova
  const porIp = rotaVisita({ registrar: async () => undefined, conhecido: () => true }, limitador({ porIp: 1, porSlug: 9, janelaMs: 60_000 }));
  const doIp = (slug: string, xff: string) =>
    porIp(new Request("http://localhost/api/visita", { method: "POST", body: corpo(slug), headers: { "user-agent": NAVEGADOR, "content-length": String(corpo(slug).length), "x-real-ip": "9.9.9.9", "x-forwarded-for": xff } }));
  assert.equal((await doIp("salao-um", "5.5.5.5")).status, 204);
  assert.equal((await doIp("salao-dois", "6.6.6.6")).status, 429, "mesmo x-real-ip, mesma cota");
  // slug inexistente: o mesmo 204 da visita gravada (sem enumeração), e não vai ao banco
  const r = await pedido(corpo("nao-existe"), { "x-real-ip": "1.1.1.4" });
  assert.equal(r.status, 204);
  assert.equal(await r.text(), "");
  assert.deepEqual(gravados, ["salao-da-ana"]);
}
{
  // a chave do slug só nasce para slug conhecido: slugs inventados ocupam só a chave do IP
  const NAVEGADOR = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1";
  const lim = limitador({ porIp: 50, porSlug: 1, janelaMs: 60_000 });
  let registrar: (slug: string) => Promise<unknown> = async () => undefined;
  const POST = rotaVisita({ registrar: (s) => registrar(s), conhecido: (s) => s === "salao-da-ana" }, lim);
  const pedido = (slug: string) => {
    const c = JSON.stringify({ slug });
    return POST(new Request("http://localhost/api/visita", { method: "POST", body: c, headers: { "user-agent": NAVEGADOR, "content-length": String(c.length), "x-real-ip": "7.7.7.7" } }));
  };
  for (let i = 0; i < 10; i++) assert.equal((await pedido(`inventado-${i}`)).status, 204);
  assert.equal(lim.tamanho(), 1, "só a chave do IP");
  // a resposta sai antes da gravação: um registrar que nunca termina não segura o 204
  registrar = () => new Promise(() => undefined);
  const corrida = await Promise.race([pedido("salao-da-ana").then((r) => r.status), new Promise((ok) => setTimeout(() => ok("preso"), 500))]);
  assert.equal(corrida, 204, "204 sem esperar o registro");
  assert.equal(lim.tamanho(), 2, "o slug conhecido ganhou a chave");
  // a gravação que falha vai para o log, e a resposta é o mesmo 204
  const lim2 = limitador({ porIp: 50, porSlug: 1, janelaMs: 60_000 });
  const erros: unknown[] = [];
  const errorOriginal = console.error;
  console.error = (...a: unknown[]) => void erros.push(a.join(" "));
  const falha = rotaVisita({ registrar: async () => Promise.reject(new Error("firestore fora")), conhecido: () => true }, lim2);
  const c = JSON.stringify({ slug: "studio-bela" });
  const r = await falha(new Request("http://localhost/api/visita", { method: "POST", body: c, headers: { "user-agent": NAVEGADOR, "content-length": String(c.length), "x-real-ip": "8.8.8.8" } }));
  await new Promise((ok) => setTimeout(ok, 10));
  console.error = errorOriginal;
  assert.equal(r.status, 204);
  assert.ok(erros.some((e) => String(e).includes("firestore fora")), "a falha foi logada");
}
console.log("POST /api/visita: ok");

// ————— 2.1: a biblioteca inteira passa pela regra (Zod) —————
{
  const { ANGULOS, NICHOS, VARIANTES, VarianteValida } = await import("@/lib/prospeccao-variantes");
  for (const v of VARIANTES) {
    const r = VarianteValida.safeParse(v);
    assert.ok(r.success, `${v.id}: ${r.success ? "" : r.error.issues.map((i) => i.message).join(", ")}`);
  }
  assert.equal(new Set(VARIANTES.map((v) => v.id)).size, VARIANTES.length, "ids únicos");
  for (const n of NICHOS) {
    const da = (etapa: string) => VARIANTES.filter((v) => v.nicho === n && v.etapa === etapa).length;
    assert.ok(da("primeiro") >= 2 && da("primeiro") <= 4, `${n}: de 2 a 4 no primeiro (${da("primeiro")})`);
    assert.equal(da("lembrete"), 2, `${n}: 2 no lembrete`);
    assert.equal(da("ultima"), 2, `${n}: 2 na última`);
  }
  assert.deepEqual([...new Set(VARIANTES.map((v) => v.angulo))].sort(), [...ANGULOS].sort(), "todos os ângulos em uso");
  // as 2 do A/B da F1 seguem as primeiras, iguais
  assert.deepEqual(VARIANTES.slice(0, 2), [...VARIANTES_F1]);
  // a regra recusa o que deve
  const base = { id: "salao-primeiro-x", nicho: "salao", etapa: "primeiro", angulo: "faltas" };
  for (const [texto, motivo] of [
    ["Oi! Agenda online. Quer ver?", "sem PARE"],
    ["Oi! Só R$ 89,90 por mês. Responda PARE.", "com preço"],
    ["Oi! Veja salao.ruphus.site. Responda PARE.", "link no primeiro contato"],
    ["Oi! {site} Responda PARE.", "link no primeiro contato"],
    [`${"a".repeat(316)} PARE`, "longo"],
  ] as const) assert.equal(VarianteValida.safeParse({ ...base, texto }).success, false, motivo);
  assert.equal(VarianteValida.safeParse({ ...base, etapa: "lembrete", texto: "Oi! A prévia: {site}. Responda PARE." }).success, true, "link depois do primeiro pode");
}
console.log("biblioteca de variantes: ok");

// ————— 2.2: escolherVariante (os casos da seção Verificação do plano) —————
{
  const { escolherVariante } = await import("@/lib/prospeccao");
  const { prng } = await import("@/lib/teste-prng");
  const { VARIANTES } = await import("@/lib/prospeccao-variantes");
  const ids = (nicho: string, etapa = "primeiro") => VARIANTES.filter((v) => v.nicho === nicho && v.etapa === etapa).map((v) => v.id as string);
  const salao = ids("salao");
  const rnd = prng(42);
  // 1. nunca repete a variante para o lead
  for (let i = 0; i < 200; i++) {
    const r = escolherVariante({ nicho: "salao", recebidas: [salao[0], salao[1]] }, "primeiro", {}, rnd);
    assert.equal(r.variante?.id, salao[2], "só sobra a que o lead não recebeu");
  }
  assert.equal(escolherVariante({ nicho: "salao", recebidas: salao }, "primeiro", {}, rnd).variante, null, "recebeu todas: nenhuma");
  // 2. nunca repete a última enviada no nicho
  const ultima = { [salao[1]]: { enviados: 3, respostas: 0, optouts: 0, ultimoEnvioEm: 2000 }, [salao[0]]: { enviados: 3, respostas: 0, optouts: 0, ultimoEnvioEm: 1000 } };
  for (let i = 0; i < 200; i++) assert.notEqual(escolherVariante({ nicho: "salao", recebidas: [] }, "primeiro", ultima, rnd).variante?.id, salao[1]);
  // 3. cai em geral quando falta o nicho (ou quando todas do nicho estão pausadas)
  const geral = ids("geral");
  const lembreteGeral = ids("geral", "lembrete");
  for (let i = 0; i < 50; i++) assert.ok(lembreteGeral.includes(escolherVariante({ nicho: "geral", recebidas: [] }, "lembrete", {}, rnd).variante!.id));
  const pausaTudo = Object.fromEntries(ids("podologia").map((id) => [id, { enviados: 100, respostas: 0, optouts: 0 }]));
  const r3 = escolherVariante({ nicho: "podologia", recebidas: [] }, "primeiro", pausaTudo, rnd);
  assert.ok(geral.includes(r3.variante!.id), "todas do nicho pausadas: geral");
  assert.deepEqual(r3.pausadas.sort(), ids("podologia").sort());
  // 4. não pausa com amostra pequena (só alerta); pausa com amostra
  const pequena = { [salao[0]]: { enviados: 40, respostas: 0, optouts: 10 }, [salao[1]]: { enviados: 99, respostas: 0, optouts: 0 } };
  const r4 = escolherVariante({ nicho: "salao", recebidas: [] }, "primeiro", pequena, rnd);
  assert.deepEqual(r4.pausadas, [], "amostra pequena não pausa");
  assert.deepEqual(r4.alertas.map((a) => a.id).sort(), [salao[0], salao[1]].sort(), "mas alerta");
  const grande = { [salao[0]]: { enviados: 80, respostas: 5, optouts: 4 }, [salao[1]]: { enviados: 100, respostas: 0, optouts: 0 }, [salao[2]]: { enviados: 80, respostas: 5, optouts: 3 } };
  const r4b = escolherVariante({ nicho: "salao", recebidas: [] }, "primeiro", grande, rnd);
  assert.deepEqual(r4b.pausadas.sort(), [salao[0], salao[1]].sort(), "opt-out > 4% com 80 e 0 resposta com 100: pausa");
  assert.equal(r4b.variante?.id, salao[2], "3/80 = 3,75%: segue ativa");
  // 5. a vencedora sai mais vezes em 1.000 sorteios
  const placar = { [salao[0]]: { enviados: 60, respostas: 12, optouts: 0 }, [salao[1]]: { enviados: 60, respostas: 2, optouts: 0 }, [salao[2]]: { enviados: 60, respostas: 2, optouts: 0 } };
  const conta: Record<string, number> = {};
  const rnd5 = prng(7);
  for (let i = 0; i < 1000; i++) {
    const id = escolherVariante({ nicho: "salao", recebidas: [] }, "primeiro", placar, rnd5).variante!.id;
    conta[id] = (conta[id] ?? 0) + 1;
  }
  assert.ok(conta[salao[0]] > conta[salao[1]] && conta[salao[0]] > conta[salao[2]], `a vencedora sai mais: ${JSON.stringify(conta)}`);
  assert.ok(conta[salao[0]] > 550, `com folga: ${conta[salao[0]]}`);
  // determinístico: a mesma semente, a mesma sequência
  const seq = (s: number) => {
    const r = prng(s);
    return Array.from({ length: 20 }, () => escolherVariante({ nicho: "unhas", recebidas: [] }, "primeiro", {}, r).variante!.id);
  };
  assert.deepEqual(seq(1), seq(1));
  // 6. hash(slug) % 2 estável: coberto acima (valores fixos de varianteAB)

  // F2-7: amostra abaixo de AMOSTRA_ROTACAO, a variante é fixa (a primeira ativa que o lead não recebeu)
  const { AMOSTRA_ROTACAO } = await import("@/lib/prospeccao");
  const poucos = { [salao[0]]: { enviados: 30, respostas: 1, optouts: 0, ultimoEnvioEm: 3000 }, [salao[1]]: { enviados: 20, respostas: 5, optouts: 0, ultimoEnvioEm: 1000 } };
  assert.ok(50 < AMOSTRA_ROTACAO);
  for (let i = 0; i < 200; i++) assert.equal(escolherVariante({ nicho: "salao", recebidas: [] }, "primeiro", poucos, rnd).variante?.id, salao[0], "sem amostra: fixa, sem sorteio");
  assert.equal(escolherVariante({ nicho: "salao", recebidas: [salao[0]] }, "primeiro", poucos, rnd).variante?.id, salao[1], "fixa, mas nunca repete para o lead");
  const semSorteio = () => assert.fail("sem amostra não sorteia");
  assert.equal(escolherVariante({ nicho: "barbearia", recebidas: [] }, "primeiro", {}, semSorteio).variante?.id, ids("barbearia")[0]);
  // com amostra, a rotação volta: nunca repete a última enviada do nicho (caso 2 acima, agora com volume)
  const ultimaComVolume = { [salao[0]]: { enviados: 60, respostas: 3, optouts: 0, ultimoEnvioEm: 1000 }, [salao[1]]: { enviados: 60, respostas: 3, optouts: 0, ultimoEnvioEm: 2000 } };
  const vistas = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const id = escolherVariante({ nicho: "salao", recebidas: [] }, "primeiro", ultimaComVolume, rnd).variante!.id;
    assert.notEqual(id, salao[1], "com amostra, não repete a última");
    vistas.add(id);
  }
  assert.ok(vistas.size > 1, "com amostra, sorteia");
  // F2-19: nicho que não existe na biblioteca cai em geral (não o próprio geral)
  for (const etapa of ["primeiro", "lembrete", "ultima"] as const) {
    const r = escolherVariante({ nicho: "nicho-que-nao-existe" as never, recebidas: [] }, etapa, {}, rnd);
    assert.ok(ids("geral", etapa).includes(r.variante!.id), `nicho inexistente → geral (${etapa})`);
  }
  // HIGH-1 (revisão do núcleo): tirar a última só quando sobra outra não recebida; nunca null por isso
  const so = (n: number) => VARIANTES.filter((v) => v.nicho === "salao" && v.etapa === "primeiro").slice(0, n);
  const volume = (...idsComUltima: string[]) => Object.fromEntries(idsComUltima.map((id, i) => [id, { enviados: 120, respostas: 3, optouts: 0, ultimoEnvioEm: 1000 + i }]));
  // 1 ativa, amostra >= 100: ela é a última enviada e mesmo assim sai
  for (let i = 0; i < 50; i++) assert.equal(escolherVariante({ nicho: "salao", recebidas: [] }, "primeiro", volume(salao[0]), rnd, so(1)).variante?.id, salao[0], "uma ativa: sai a única");
  // 2 ativas: a outra foi recebida pelo lead e a única não recebida é a última: sai ela
  for (let i = 0; i < 50; i++) assert.equal(escolherVariante({ nicho: "salao", recebidas: [salao[0]] }, "primeiro", volume(salao[0], salao[1]), rnd, so(2)).variante?.id, salao[1], "duas ativas, uma recebida: não volta null");
  // 2 ativas, nenhuma recebida: a regra vale (sobra outra), nunca a última
  for (let i = 0; i < 50; i++) assert.equal(escolherVariante({ nicho: "salao", recebidas: [] }, "primeiro", volume(salao[0], salao[1]), rnd, so(2)).variante?.id, salao[0], "duas ativas: não repete a última");
  // 3+ candidatas com amostra: a de maior peso sai mais (caso 5 acima, com 3 candidatas e 180 envios)
}
console.log("escolherVariante: ok");

// ————— M-2 (terceira rodada): a reconciliação do CRM não fica presa —————
{
  const T0 = 1_800_000_000_000;
  assert.equal(desistirDaReconciliacao({ enviadoEm: T0 }, T0), false);
  assert.equal(desistirDaReconciliacao({ tentativasCrm: RECONCILIAR.tentativasMax - 1, enviadoEm: T0 }, T0 + 3_600_000), false);
  assert.equal(desistirDaReconciliacao({ tentativasCrm: RECONCILIAR.tentativasMax, enviadoEm: T0 }, T0), true, "N passagens");
  assert.equal(desistirDaReconciliacao({ tentativasCrm: 1, enviadoEm: T0 }, T0 + RECONCILIAR.prazoMs), true, "prazo desde o envio");
  assert.deepEqual([1, 2, 3, 10, 20].map((n) => proximaReconciliacao(n, 0)), [60_000, 120_000, 240_000, RECONCILIAR.esperaMaxMs, RECONCILIAR.esperaMaxMs]);
  // o laço de reconciliarCrm no modelo (orderBy reconciliarApos, 5 vagas): 5 presos (awaiting_manual,
  // manual_started, 404) e um bom atrás deles
  type I = { id: string; enviadoEm: number; reconciliarApos: number; tentativasCrm?: number; pendente: boolean; preso: boolean };
  const fila: I[] = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: `preso-${i}`, enviadoEm: T0, reconciliarApos: T0 + i, pendente: true, preso: true })),
    { id: "bom", enviadoEm: T0, reconciliarApos: T0 + 10, pendente: true, preso: false },
  ];
  const passar = (agora: number) => {
    const vez = fila.filter((i) => i.pendente && i.reconciliarApos <= agora).sort((a, b) => a.reconciliarApos - b.reconciliarApos).slice(0, 5);
    for (const it of vez) {
      if (desistirDaReconciliacao(it, agora)) {
        it.pendente = false;
        continue;
      }
      it.tentativasCrm = (it.tentativasCrm ?? 0) + 1;
      it.reconciliarApos = proximaReconciliacao(it.tentativasCrm, agora);
      if (!it.preso) it.pendente = false;
    }
  };
  passar(T0 + 10);
  assert.equal(fila.find((i) => i.id === "bom")!.pendente, true, "as 5 vagas foram dos presos");
  passar(T0 + 1_000);
  assert.equal(fila.find((i) => i.id === "bom")!.pendente, false, "na passagem seguinte o bom entra");
  let agora = T0 + 1_000;
  for (let i = 0; i < 100 && fila.some((x) => x.pendente); i++) passar((agora += RECONCILIAR.esperaMaxMs));
  assert.ok(fila.every((x) => !x.pendente), "os presos saem da reconciliação");
  assert.ok(fila.filter((x) => x.preso).every((x) => x.tentativasCrm === RECONCILIAR.tentativasMax), "depois de N passagens");
}
console.log("reconciliação do CRM sem preso: ok");
