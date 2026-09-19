#!/usr/bin/env -S npx tsx
/** Tira do catálogo o que nunca foi serviço.
 *
 * O seed leu a seção "Serviços" de cada site; onde a página listava
 * diferenciais ("Ambiente climatizado", "Top 3 no TripAdvisor"), o
 * diferencial virou item agendável — e aparecia para o cliente escolher.
 *
 *   npx tsx --env-file=.env.local scripts/limpar-catalogo.mts            # simula
 *   npx tsx --env-file=.env.local scripts/limpar-catalogo.mts --aplicar
 *   npx tsx scripts/limpar-catalogo.mts --self-check    # só a regra, sem banco
 */
import { cert, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Seção da página: o seed leu o menu junto com os serviços, então "Tabela de
// preços" e "Contato" viraram horários que o cliente podia marcar.
const SECAO = /^(tabela de pre[çc]os?|pre[çc]os?|agendamento|contato|fale conosco|localiza[çc][ãa]o|endere[çc]o|como chegar|onde estamos|hor[áa]rios?( de atendimento)?|galeria|depoimentos|sobre( n[óo]s)?|redes sociais|formas de pagamento|parcelamento no cart[ãa]o)$/i;

// Guarda-chuva: a descrição no site diz que é um grupo de serviços, não um
// horário ("Serviços para o seu dia a dia").
const GUARDA_CHUVA = /^(beleza|est[ée]tica|bem-?estar|sa[úu]de|servi[çc]os?|tratamentos)$/i;

// Propaganda: fala do negócio, não do que se marca. "Avaliação" fica de fora
// da lista de propósito — avaliação é consulta, e se agenda.
const PROPAGANDA = /^(ambiente\b|experi[êe]ncia\b|higiene$|top \d|atendimento\s+(personalizado|especializado|pontual|pr[óo]ximo|r[áa]pido|atencioso|tradicional|unissex|vip|humanizado|individual( humanizado)?|aos domingos|por whatsapp|por empreendedoras))/i;

// a regra decide o que sai de 675 catálogos, então roda sozinha e sem banco
if (process.argv.includes("--self-check")) {
  for (const n of [
    "Ambiente climatizado", "Ambiente Acolhedor e Seguro", "Experiência VIP", "Higiene",
    "Top 3 no TripAdvisor", "Atendimento personalizado", "Atendimento por whatsapp",
    "Atendimento aos domingos", "Atendimento Individual Humanizado",
  ]) assert.ok(PROPAGANDA.test(n), `deveria sair: ${n}`);
  // avaliação é consulta e se agenda; e há serviço que por acaso começa parecido
  for (const n of [
    "Avaliação estética", "Avaliação podológica", "Consulta de avaliação", "Atendimento infantil",
    "Higiene & Bem-Estar Íntimo", "Ambientação capilar", "Banho e tosa", "Depilação com Cera — Rosto",
  ]) assert.ok(!PROPAGANDA.test(n), `deveria ficar: ${n}`);
  for (const n of ["Tabela de preços", "Contato", "Agendamento", "Horários de atendimento", "Sobre nós"])
    assert.ok(SECAO.test(n), `deveria sair: ${n}`);
  for (const n of ["Beleza", "Estética", "Bem-estar", "Tratamentos"]) assert.ok(GUARDA_CHUVA.test(n), `deveria sair: ${n}`);
  // nomes que contêm as palavras mas dizem o que se faz
  for (const n of ["Tratamento capilar", "Estética facial", "Agendamento de banho e tosa", "Preço fechado para noivas"])
    assert.ok(!SECAO.test(n) && !GUARDA_CHUVA.test(n), `deveria ficar: ${n}`);
  console.log("limpar-catalogo: ok");
  process.exit(0);
}

initializeApp({ credential: cert(JSON.parse(readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS!, "utf8"))) });
const db = getFirestore();
const aplicar = process.argv.includes("--aplicar");

const svc = await db.collectionGroup("services").get();
const porTenant = new Map<string, { id: string; nome: string; ativo: boolean; fora: boolean }[]>();
for (const d of svc.docs) {
  const t = d.ref.parent.parent?.id ?? "?";
  const nome = String(d.get("name") ?? "");
  const lista = porTenant.get(t) ?? porTenant.set(t, []).get(t)!;
  const t2 = nome.trim();
  const fora = PROPAGANDA.test(t2) || SECAO.test(t2) || GUARDA_CHUVA.test(t2);
  lista.push({ id: d.id, nome, ativo: d.get("active") !== false, fora });
}

let tirados = 0, poupados = 0;
for (const [t, itens] of porTenant) {
  const fora = itens.filter((i) => i.fora && i.ativo);
  if (!fora.length) continue;
  const sobram = itens.filter((i) => i.ativo && !i.fora).length;
  if (!sobram) {
    // catálogo que só tinha propaganda: tirar tudo deixaria a página de
    // agendamento sem nada para escolher — fica para tratar à mão
    console.log(`  ~ ${t}: ficaria sem serviço nenhum, não mexi  (${fora.map((f) => f.nome).join(", ")})`);
    poupados += fora.length;
    continue;
  }
  for (const f of fora) {
    console.log(`  - ${t}: "${f.nome}"  (sobram ${sobram})`);
    // uma escrita de cada vez, esperada e conferida: o BulkWriter engole a
    // falha de cada operação e fecha como se tivesse dado certo
    if (aplicar) await db.doc(`tenants/${t}/services/${f.id}`).update({ active: false });
    tirados += 1;
  }
}
console.log(`\n${aplicar ? "desativados" : "seriam desativados"}: ${tirados} | deixados de lado: ${poupados}`);
