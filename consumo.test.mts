// Rode: npm run test:consumo  (consumo de mensagens: tipo, status, preço, máscara e agregado; sem rede)
import assert from "node:assert/strict";
import { agendamentoDoEnvio, avanca, cobra, CONFIG_PADRAO, configDoNegocio, deltaDoConsumo, deveAvisar, diasNoMes, podeEnviar, previsaoDeSaldo, textoDoAvisoDeSaldo, mascararDestino, PRECOS_PADRAO, precoDe, quandoFoi, statusDoAtendys, tipoDoTemplate } from "@/lib/consumo";

// tipo pelo nome do template, com ou sem _v2 e _botoes
assert.equal(tipoDoTemplate("agendamento_recebido"), "recebido");
assert.equal(tipoDoTemplate("agendamento_confirmado_cliente_v2"), "confirmado");
assert.equal(tipoDoTemplate("agendamento_cancelado"), "cancelado");
assert.equal(tipoDoTemplate("agendamento_lembrete_botoes_v2"), "lembrete");
assert.equal(tipoDoTemplate("agendamento_pedido_dono_botoes"), "pedido_dono");
assert.equal(tipoDoTemplate("outro_template"), "outro");
assert.equal(tipoDoTemplate("ruphus_saldo_baixo"), "saldo");
assert.equal(tipoDoTemplate("ruphus_confirmar_whatsapp_dono"), "confirmar_dono");

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

// sem saldo: nada muda o status e não cobra
assert.equal(avanca("sem-saldo", "enviado"), false);
assert.equal(avanca("aceito", "sem-saldo"), false);
assert.equal(cobra("whatsapp", "sem-saldo"), false);
assert.equal(cobra("sms", "sem-saldo"), false);
assert.equal(deltaDoConsumo(e, null, "sem-saldo").custoCents, undefined);

// config do negócio: override de cobrar e de preço; o resto vem do geral
assert.deepEqual(CONFIG_PADRAO.pacotes.map((p) => [p.valorCents, p.bonusCents]), [[2000, 0], [5000, 500], [10000, 2000]]);
assert.deepEqual([CONFIG_PADRAO.cobrar, CONFIG_PADRAO.modelo, CONFIG_PADRAO.semSaldo, CONFIG_PADRAO.avisoSaldoCents, CONFIG_PADRAO.boasVindasCents], [true, "prepago", "pausar-clientes", 500, 1000]);
const proprio = configDoNegocio(CONFIG_PADRAO, { cobrar: false, precos: { smsCents: 3, whatsappUtilityCents: -1 } });
assert.deepEqual([proprio.cobrar, proprio.smsCents, proprio.whatsappUtilityCents], [false, 3, 5], "preço inválido no override fica o geral");
assert.equal(configDoNegocio(CONFIG_PADRAO, null).cobrar, true);

// podeEnviar: todos os ramos
const base = { cobrar: true, modelo: "prepago" as const, saldoCents: 3, custoCents: 5, semSaldo: "pausar-clientes" as const, limiteNegativoCents: 0, destinatario: "cliente" as const, tipo: "confirmado" as const };
assert.deepEqual(podeEnviar({ ...base, cobrar: false }), { envia: true }, "não cobra");
assert.deepEqual(podeEnviar({ ...base, modelo: "pospago" }), { envia: true }, "pós-pago");
assert.deepEqual(podeEnviar({ ...base, custoCents: 0 }), { envia: true }, "grátis");
assert.deepEqual(podeEnviar({ ...base, saldoCents: 5 }), { envia: true }, "saldo cobre (fica zero)");
assert.deepEqual(podeEnviar(base), { envia: false, motivo: "sem saldo de mensagens" }, "pausar-clientes: confirmação ao cliente para");
assert.equal(podeEnviar({ ...base, tipo: "lembrete" }).envia, true, "lembrete sai");
assert.equal(podeEnviar({ ...base, tipo: "resposta" }).envia, true, "resposta na janela sai");
assert.equal(podeEnviar({ ...base, destinatario: "dono", tipo: "outro" }).envia, true, "aviso ao dono sai");
assert.equal(podeEnviar({ ...base, semSaldo: "pausar-tudo", tipo: "lembrete" }).envia, false, "pausar-tudo: lembrete para");
assert.equal(podeEnviar({ ...base, semSaldo: "pausar-tudo", destinatario: "dono", tipo: "outro" }).envia, false, "pausar-tudo: aviso ao dono para");
assert.equal(podeEnviar({ ...base, semSaldo: "pausar-tudo", destinatario: "dono", tipo: "pedido_dono" }).envia, true, "pedido ao dono sempre sai");
assert.equal(podeEnviar({ ...base, semSaldo: "negativo", limiteNegativoCents: 2 }).envia, true, "negativo: 3 - 5 = -2 dentro do limite");
assert.deepEqual(podeEnviar({ ...base, semSaldo: "negativo", limiteNegativoCents: 1 }), { envia: false, motivo: "limite de saldo negativo atingido" });
assert.equal(podeEnviar({ ...base, semSaldo: "negativo", limiteNegativoCents: 0, tipo: "pedido_dono" }).envia, true);
assert.equal(podeEnviar({ ...base, semSaldo: "pausar-tudo", destinatario: "dono", tipo: "saldo" }).envia, true, "o aviso de saldo baixo sempre sai");
assert.equal(podeEnviar({ ...base, semSaldo: "pausar-tudo", destinatario: "dono", tipo: "confirmar_dono" }).envia, true, "a confirmação do WhatsApp do dono sempre sai");

// previsão do saldo
const pacotes = CONFIG_PADRAO.pacotes;
const prev = (saldoCents: number, consumoPorDia: { dia: string; cents: number }[], hoje = "2026-11-20") =>
  previsaoDeSaldo({ saldoCents, consumoPorDia, hoje, diasNoMes: diasNoMes(hoje), pacotes, avisoSaldoCents: 500 });
assert.equal(diasNoMes("2026-02-10"), 28);
assert.equal(diasNoMes("2026-11-20"), 30);
// sem histórico: sem média, sem fim previsto; o menor pacote
assert.deepEqual(prev(3000, []), { mediaDiariaCents: null, diasRestantesEstimados: null, acabaEm: null, faltaParaFecharMesCents: 0, pacoteIndicado: pacotes[0], nivel: "ok" });
// consumo zero no período (dias com 0): igual a sem histórico
assert.equal(prev(3000, [{ dia: "2026-11-19", cents: 0 }]).mediaDiariaCents, null);
// histórico curto (< 7 dias na janela): média do mês até hoje = 400 / 20 = 20 por dia
const curto = prev(1000, [{ dia: "2026-11-02", cents: 200 }, { dia: "2026-11-19", cents: 200 }]);
assert.deepEqual([curto.mediaDiariaCents, curto.diasRestantesEstimados, curto.acabaEm, curto.faltaParaFecharMesCents, curto.nivel], [20, 50, "2027-01-09", 0, "ok"]);
// 14 dias: 10 dias com 140 → 1400 / 14 = 100 por dia; saldo 600 → 6 dias (atenção); faltam 10 dias: 1000 − 600 = 400 → pacote de 20
const cheio = Array.from({ length: 10 }, (_, i) => ({ dia: `2026-11-${String(11 + i).padStart(2, "0")}`, cents: 140 }));
const p14 = prev(600, cheio);
assert.deepEqual([p14.mediaDiariaCents, p14.diasRestantesEstimados, p14.acabaEm, p14.faltaParaFecharMesCents, p14.pacoteIndicado?.id, p14.nivel], [100, 6, "2026-11-26", 400, "p20", "atencao"]);
// falta mais que um pacote pequeno cobre: o menor que cobre (valor + bônus)
assert.equal(prev(0, cheio.map((c) => ({ ...c, cents: 700 }))).pacoteIndicado?.id, "p50", "500/dia × 10 dias = 5000: p20 não cobre, p50 (5000 + 500) cobre");
// nenhum cobre: o maior
assert.equal(prev(0, cheio.map((c) => ({ ...c, cents: 14000 }))).pacoteIndicado?.id, "p100");
// saldo negativo: crítico, acaba hoje
const neg = prev(-50, cheio);
assert.deepEqual([neg.diasRestantesEstimados, neg.acabaEm, neg.faltaParaFecharMesCents, neg.nivel], [0, "2026-11-20", 1050, "critico"]);
// menos de 2 dias: crítico; saldo acima do aviso e muitos dias: ok
assert.equal(prev(150, cheio).nivel, "critico");
assert.equal(prev(5000, cheio).nivel, "ok");
// pacote inativo não é indicado
assert.equal(previsaoDeSaldo({ saldoCents: 0, consumoPorDia: [], hoje: "2026-11-20", diasNoMes: 30, pacotes: pacotes.map((p) => ({ ...p, ativo: p.id === "p50" })), avisoSaldoCents: 500 }).pacoteIndicado?.id, "p50");

// disparo do aviso: uma vez por recarga, quando o nível piora
assert.equal(deveAvisar("ok", "atencao", null, null), true, "primeiro aviso");
assert.equal(deveAvisar("atencao", "critico", 100, null), false, "já avisado e sem recarga depois");
assert.equal(deveAvisar("atencao", "critico", 100, 200), true, "recarregou depois do aviso");
assert.equal(deveAvisar("ok", "ok", null, null), false);
assert.equal(deveAvisar("critico", "atencao", null, null), false, "melhorou: não avisa");
assert.equal(deveAvisar("atencao", "atencao", null, null), false, "mesmo nível: não avisa");
assert.equal(
  textoDoAvisoDeSaldo(600, p14),
  "Seu saldo de mensagens está em R$ 6,00 e deve acabar em ~6 dias. Para garantir o mês, recarregue R$ 20,00 (pacote R$ 20,00).",
);
assert.equal(textoDoAvisoDeSaldo(-50, neg), "Seu saldo de mensagens está em R$ -0,50 e deve acabar hoje. Para garantir o mês, recarregue R$ 20,00 (pacote R$ 20,00).");

console.log("consumo ok");
