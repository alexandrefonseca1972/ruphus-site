// Rode: tsx src/app/admin/crm-gaveta.test.mts  (parte de npm run test:prospeccao-f1)
// A gaveta renderizada no servidor (sem DOM): a trava da cadência e o "Enviou?" que não perde o envio.
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { confirmarEnvio, linkDaBarra, MensagensProntas, modeloDaVez, montarPronto, type Pronto } from "@/app/admin/crm-gaveta";
import { barradoPeloPareDoAgente } from "@/lib/crm-tipos";
import type { Crm } from "@/lib/crm-tipos";

const crm = { estagio: "novo", toques: 1, ultimoContatoEm: "2026-11-01T12:00:00.000Z", respondeuEm: null, naoContatarEm: null, donoNome: "Ana", donoWhatsapp: "5511900000042" } as unknown as Crm;
const negocio = { slug: "salao-da-ana", nome: "Salão da Ana", telefone: "5511900000042" };
const nada = () => {};
const gaveta = (extra: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(MensagensProntas, { negocio, crm, assinatura: "Alexandre", onEnviar: nada, onCopiar: nada, onMarcar: nada, onEncerrar: nada, ...extra }));
const temLink = (html: string) => /href="https:\/\/api\.whatsapp\.com\/send\?phone=55\d+&amp;text=/.test(html);

// item 1 (revisão interface): o modelo sugerido é o Lembrete (já contatado, 1 toque)
assert.ok(/aria-pressed="true"[^>]*>Lembrete</.test(gaveta({})), "o modelo da vez é o Lembrete");
assert.ok(temLink(gaveta({})), "controle: com o detalhe carregado, o Lembrete abre o WhatsApp");
assert.ok(!temLink(gaveta({ carregando: true })), "detalhe null (carregando) e Lembrete: sem link de envio");
const comErro = gaveta({ erroDetalhe: "Sem conexão", onTentarDeNovo: nada });
assert.ok(!temLink(comErro), "detalhe com erro: sem link (falha fechada)");
assert.ok(/role="alert"[^]*Sem conexão[^]*Tentar de novo/.test(comErro), "erro com role=alert e Tentar de novo");
assert.ok(!temLink(gaveta({ paradoNaProspeccao: true })), "PARE no agente: sem link");
// M-7: a Proposta de quem não é cliente fica como a cadência: o PARE do agente e o detalhe que não chegou travam.
// Antes, a Proposta não dependia do detalhe (abria com carregando); cliente fechado segue sem depender
const respondeu = { ...crm, respondeuEm: "2026-11-02T12:00:00.000Z" } as Crm;
const fechado = { ...crm, estagio: "fechado" } as Crm;
const proposta = (c: Crm, extra: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(MensagensProntas, { negocio, crm: c, assinatura: "Alexandre", onEnviar: nada, onCopiar: nada, onMarcar: nada, onEncerrar: nada, ...extra }));
assert.ok(/aria-pressed="true"[^>]*>Proposta</.test(proposta(respondeu, {})), "quem respondeu: o modelo da vez é a Proposta");
assert.ok(temLink(proposta(respondeu, {})), "controle: Proposta sem PARE abre o WhatsApp");
assert.ok(!temLink(proposta(respondeu, { paradoNaProspeccao: true })), "M-7: Proposta de lead não fechado com PARE no agente: sem link");
assert.ok(!temLink(proposta(respondeu, { carregando: true })), "M-7: Proposta de lead não fechado sem detalhe: sem link");
assert.equal(barradoPeloPareDoAgente("Proposta", "fechado"), false, "cliente fechado: Proposta não é barrada");
assert.equal(barradoPeloPareDoAgente("Proposta", "negociando"), true);
assert.equal(barradoPeloPareDoAgente("Lembrete", "fechado"), true, "a cadência é barrada sempre");
assert.equal(barradoPeloPareDoAgente("constructor", "novo"), false, "nome do protótipo não é cadência");
assert.ok(montarPronto("Proposta", null, { negocio, crm: fechado, assinatura: "Alexandre", paradoNaProspeccao: true }).pronto.link, "fechado com PARE no agente: Proposta sai");
assert.ok(!montarPronto("Proposta", null, { negocio, crm: { ...crm, estagio: "negociando" } as Crm, assinatura: "Alexandre", paradoNaProspeccao: true }).pronto.link, "negociando com PARE no agente: Proposta não sai");
console.log("trava da cadência e da proposta sem detalhe: ok");

// item 6: o "Sim" não some com o envio; o erro devolve o mesmo envioId
{
  const p = { slug: "salao-da-ana", envio: { envioId: "0b9c3a52-2f0f-4c39-9a0f-1d1f6f0d7a11", textoEnviado: "Oi", editado: true } };
  const ok = await confirmarEnvio(p, async () => ({ ok: true as const, dados: 1 }));
  assert.deepEqual(ok, { ok: true, dados: 1 }, "ok: o pendente pode sair");
  const recusa = await confirmarEnvio(p, async () => ({ ok: false as const, error: "Envio inválido" }));
  assert.ok(!recusa.ok && recusa.pendente === p && /Envio inválido/.test(recusa.aviso), "recusa do servidor: mesmo pendente e aviso");
  const erroLog = console.error;
  console.error = () => {};
  const caiu = await confirmarEnvio(p, async () => {
    throw new Error("rede");
  }).finally(() => (console.error = erroLog));
  assert.ok(!caiu.ok && caiu.pendente.envio.envioId === p.envio.envioId && caiu.aviso.length > 0, "rejeição: mesmo envioId e aviso");
  console.log("Enviou? sem perder o envio: ok");
}

// H-1 (terceira rodada): a barra fixa só leva o link do negócio aberto
{
  const deA: Pronto = { slug: "salao-a", modelo: "Lembrete", texto: "Oi", link: "https://wa.me/5511900000001?text=Oi", para: "a recepção", envio: { texto: "Oi", editado: false } };
  assert.equal(linkDaBarra(deA, "salao-b"), null, "lead B com o pronto de A: sem link");
  assert.equal(linkDaBarra(null, "salao-b"), null, "sem pronto (desmontou ou acabou de abrir): sem link");
  assert.equal(linkDaBarra(deA, "salao-a"), deA.link, "controle: o próprio A leva o link");
  assert.equal(linkDaBarra({ ...deA, link: null }, "salao-a"), null, "A travado (PARE, carregando): sem link");
  // a barra monta a mensagem do lead aberto (montarPronto com o detalhe buscado): o link só com o slug dele
  const b = { slug: "salao-b", nome: "Salão B", telefone: "5511900000043" };
  const daB = montarPronto(modeloDaVez(crm), null, { negocio: b, crm, assinatura: "Alexandre" }).pronto;
  assert.equal(daB.slug, "salao-b");
  assert.equal(daB.modelo, "Lembrete", "o modelo da vez do CRM de B");
  assert.ok(daB.link && linkDaBarra(daB, "salao-b") === daB.link, "B aberto com a mensagem de B: link");
  assert.equal(linkDaBarra(daB, "salao-a"), null, "a mensagem de B não vale para A");
  assert.equal(montarPronto(modeloDaVez(crm), null, { negocio: b, crm, assinatura: "Alexandre", erroDetalhe: "sem detalhe" }).pronto.link, null, "sem o detalhe (busca falhou): sem link");
  assert.equal(montarPronto(modeloDaVez(crm), null, { negocio: b, crm, assinatura: "Alexandre", paradoNaProspeccao: true }).pronto.link, null, "PARE no agente: sem link");
  console.log("barra fixa só do negócio aberto: ok");
}

// textos das mensagens (config/crm.textos): o padrão sai como antes; o personalizado vale no lugar
{
  const { mensagem } = await import("@/app/admin/crm-gaveta");
  const { problemasDoTexto, semSaida, TextosCrm, TEXTOS_PADRAO } = await import("@/lib/crm-textos");
  const oi = "Oi, Ana! Aqui é Alexandre, da Ruphus.";
  assert.equal(
    mensagem("Lembrete", negocio, crm, "Alexandre"),
    `${oi} A prévia do Salão da Ana está pronta: salao-da-ana.ruphus.site/?c=1. Ela mostra serviços, preço e horários. Quer que eu ajuste algo? Se não quiser mais mensagens, responda PARE.`,
    "Lembrete padrão igual ao de antes (com ?c=1)",
  );
  const semLink = mensagem("Proposta", negocio, crm, "Alexandre");
  assert.ok(!/\n{3,}/.test(semLink) && !semLink.includes("{proposta}") && semLink.includes("em salao-da-ana.ruphus.site."), "Proposta sem link: sem linha vazia, sem ?c=1");
  assert.ok(mensagem("Proposta", negocio, crm, "Alexandre", "https://x.test/p").includes("sem taxa por agendamento.\n\nProposta completa, válida por"), "Proposta com link");
  const textos = { lembrete: "{oi} Sou {vendedor}. Vê o {nome} em {site}?", primeiro: "{oi} {prova} Posso te mostrar?" };
  assert.equal(mensagem("Lembrete", negocio, crm, "Alexandre", null, null, textos), `${oi} Sou Alexandre. Vê o Salão da Ana em salao-da-ana.ruphus.site/?c=1?`, "o personalizado vale no lugar do padrão");
  assert.equal(mensagem("Última tentativa", negocio, crm, "Alexandre", null, null, textos), mensagem("Última tentativa", negocio, crm, "Alexandre"), "sem personalizado, o padrão");
  // primeiro contato personalizado vai como editado: não conta para a variante do A/B
  const novo = { ...crm, toques: 0, ultimoContatoEm: null } as Crm;
  assert.equal(montarPronto("Primeiro contato", null, { negocio, crm: novo, assinatura: "Alexandre", textos }).pronto.envio.editado, true);
  assert.equal(montarPronto("Primeiro contato", null, { negocio, crm: novo, assinatura: "Alexandre" }).pronto.envio.editado, false);
  assert.equal(montarPronto("Lembrete", null, { negocio, crm, assinatura: "Alexandre", textos }).pronto.envio.editado, false);
  assert.equal(mensagem("Primeiro contato", negocio, crm, "Alexandre", null, null, { primeiro: "Falo com o responsável por *{cliente}*?" }), "Falo com o responsável por *Salão da Ana*?", "{cliente} vira o nome do negócio");
  assert.deepEqual(problemasDoTexto("Oi {cliente}"), [], "{cliente} é marcador conhecido");
  for (const t of Object.values(TEXTOS_PADRAO)) assert.deepEqual(problemasDoTexto(t), [], "o padrão passa na regra");
  assert.ok(problemasDoTexto("Oi {nome }").length && problemasDoTexto("Oi {cidade}").length && problemasDoTexto(" ").length && problemasDoTexto("a".repeat(801)).length, "marcador desconhecido, vazio e longo: recusa");
  assert.ok(semSaida("primeiro", "Oi, tudo bem?") && !semSaida("primeiro", "Se não fizer sentido, é só me avisar.") && !semSaida("lembrete", "Oi"), "sem saída: aviso só no primeiro contato");
  assert.deepEqual(TextosCrm.parse({ lembrete: "Oi {cidade}" }), {}, "doc torto: vale o padrão");
  console.log("textos das mensagens: ok");
}
