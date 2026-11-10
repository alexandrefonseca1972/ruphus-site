// Rode: npm run test:consumo  (consumo de mensagens: tipo, status, preço, máscara e agregado; sem rede)
import assert from "node:assert/strict";
import { agendamentoDoEnvio, avanca, cobra, deltaDoConsumo, mascararDestino, PRECOS_PADRAO, precoDe, quandoFoi, statusDoAtendys, tipoDoTemplate } from "@/lib/consumo";

// tipo pelo nome do template, com ou sem _v2 e _botoes
assert.equal(tipoDoTemplate("agendamento_recebido"), "recebido");
assert.equal(tipoDoTemplate("agendamento_confirmado_cliente_v2"), "confirmado");
assert.equal(tipoDoTemplate("agendamento_cancelado"), "cancelado");
assert.equal(tipoDoTemplate("agendamento_lembrete_botoes_v2"), "lembrete");
assert.equal(tipoDoTemplate("agendamento_pedido_dono_botoes"), "pedido_dono");
assert.equal(tipoDoTemplate("outro_template"), "outro");

// agendamento: do aceite (eventId) ou do id dos botões, só do mesmo negócio
assert.equal(agendamentoDoEnvio("loja", "ruphus-agendamento:loja:AB12cd"), "AB12cd");
assert.equal(agendamentoDoEnvio("loja", "ruphus-agendamento:outra:AB12cd"), undefined, "aceite de outro negócio");
assert.equal(agendamentoDoEnvio("loja", undefined, ["rph:cp:loja:XY9:2026-11-14T15:00"]), "XY9");
assert.equal(agendamentoDoEnvio("loja", undefined, ["rph:cp:outra:XY9"]), undefined);
assert.equal(agendamentoDoEnvio("loja"), undefined);

// máscara: DDD e os 4 últimos, nunca o número inteiro
assert.equal(mascararDestino("5591988776389"), "(91) •••••-6389");
assert.equal(mascararDestino("91988776389"), "(91) •••••-6389", "SMS vem sem o 55");
assert.equal(mascararDestino("(11) 3222-4444"), "(11) •••••-4444", "fixo");
assert.equal(mascararDestino("123"), "•••••-•123");
assert.ok(!mascararDestino("5591988776389").includes("98877"));

// status do atendys
assert.equal(statusDoAtendys("queued"), "aceito");
assert.equal(statusDoAtendys("sent"), "enviado");
assert.equal(statusDoAtendys("delivered"), "entregue");
assert.equal(statusDoAtendys("read"), "lido");
assert.equal(statusDoAtendys("failed"), "falhou");
assert.equal(statusDoAtendys("awaiting_manual"), "parado");
assert.equal(statusDoAtendys("qualquer"), null);

// webhook atrasado não volta o status; falhou volta a enviado (reconciliação); entregue não vira falhou
assert.equal(avanca("aceito", "enviado"), true);
assert.equal(avanca("lido", "entregue"), false);
assert.equal(avanca("entregue", "enviado"), false);
assert.equal(avanca("enviado", "falhou"), true);
assert.equal(avanca("entregue", "falhou"), false);
assert.equal(avanca("falhou", "enviado"), true);
assert.equal(avanca("parado", "aceito"), true);
assert.equal(avanca("enviado", "parado"), false);
assert.equal(avanca("lido", "lido"), false);

// cobrança: WhatsApp cobra o que saiu; SMS cobra no envio
for (const s of ["aceito", "enviado", "entregue", "lido"] as const) assert.equal(cobra("whatsapp", s), true, s);
assert.equal(cobra("whatsapp", "falhou"), false);
assert.equal(cobra("whatsapp", "parado"), false);
assert.equal(cobra("sms", "enviado"), true);
assert.equal(cobra("sms", "falhou"), false);

// preço: padrão documentado; resposta na janela é "service"
assert.deepEqual(PRECOS_PADRAO, { whatsappUtilityCents: 5, whatsappServiceCents: 0, smsCents: 12 });
assert.equal(precoDe(PRECOS_PADRAO, "whatsapp", false), 5);
assert.equal(precoDe(PRECOS_PADRAO, "whatsapp", true), 0);
assert.equal(precoDe({ ...PRECOS_PADRAO, smsCents: 15 }, "sms", true), 15, "SMS não tem service");

// mês e dia no horário de Brasília: 02:00 UTC do dia 1º ainda é o mês anterior
assert.deepEqual(quandoFoi(new Date("2026-12-01T02:00:00Z")), { mes: "2026-11", dia: "30" });
assert.deepEqual(quandoFoi(new Date("2026-11-10T15:00:00Z")), { mes: "2026-11", dia: "10" });

// agregado: envio novo soma tudo; troca de status move a contagem e acerta o custo
const e = { canal: "whatsapp" as const, via: "oficial" as const, tipo: "lembrete" as const, precoCents: 5, dia: "10" };
assert.deepEqual(deltaDoConsumo(e, null, "aceito"), {
  total: 1, custoCents: 5, status: { aceito: 1 },
  canais: { whatsapp: { total: 1, custoCents: 5, status: { aceito: 1 } } },
  tipos: { lembrete: { total: 1, custoCents: 5, status: { aceito: 1 } } },
  vias: { oficial: 1 }, dias: { "10": { whatsapp: 1 } },
});
const falhou = deltaDoConsumo(e, "aceito", "falhou");
assert.deepEqual(falhou, {
  custoCents: -5, status: { falhou: 1, aceito: -1 },
  canais: { whatsapp: { custoCents: -5, status: { falhou: 1, aceito: -1 } } },
  tipos: { lembrete: { custoCents: -5, status: { falhou: 1, aceito: -1 } } },
}, "falhou devolve o custo e não conta envio novo");
assert.equal(deltaDoConsumo(e, "enviado", "entregue").custoCents, undefined, "já cobrado: entregue não cobra de novo");
assert.equal(deltaDoConsumo(e, null, "parado").custoCents, undefined, "parado na cota não cobra");
assert.equal(deltaDoConsumo(e, "parado", "aceito").custoCents, 5, "voltou à fila: cobra");
assert.deepEqual(deltaDoConsumo({ ...e, canal: "sms", precoCents: 12 }, null, "enviado").canais, { sms: { total: 1, custoCents: 12, status: { enviado: 1 } } });

console.log("consumo ok");
