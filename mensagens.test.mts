import assert from "node:assert/strict";
import { textoAvisoCliente, textoConvite } from "@/lib/mensagens";

const a = { customerName: " Ana Maria ", serviceName: "Corte", staffName: "Bia", start: new Date("2026-11-10T13:00:00Z") };
const conf = textoAvisoCliente("confirmado", a, "Salão X", "https://x/agendar/s");
assert.match(conf, /^Olá, Ana! Seu horário na Salão X está confirmado: Corte com Bia, .* às 10:00\. Até lá!$/);
assert.match(textoAvisoCliente("cancelado", a, "Salão X", "https://x/agendar/s"), /foi cancelado\. Para marcar outro horário: https:\/\/x\/agendar\/s$/);
assert.match(textoAvisoCliente("remarcado", a, "Salão X", ""), /foi remarcado para .* às 10:00 \(Corte com Bia\)/);
assert.match(textoConvite({ nome: "", negocio: "N", url: "u", email: "e@x", dias: 7 }), /^Oi! [^]*\(e@x\)\. O link vale 7 dias/);
assert.match(textoConvite({ nome: "Bia Souza", negocio: "N", url: "u", email: "e@x", dias: 7 }), /^Oi, Bia!/);
// wa.me de reserva quando o template automático não chegou: recebido e lembrete têm texto próprio
assert.match(textoAvisoCliente("recebido", a, "Salão X", ""), /^Olá, Ana! Recebemos seu pedido de horário na Salão X: Corte com Bia, .* às 10:00\. Vamos confirmar com você por aqui\.$/);
assert.match(textoAvisoCliente("lembrete", a, "Salão X", ""), /^Olá, Ana! Lembrete do seu horário na Salão X: Corte com Bia, .* às 10:00\. Até lá!$/);
{
  const { avisaPelaApi, avisoPendente, efeitoNoAviso, faixaDoAviso } = await import("@/lib/aviso-cliente");
  // o que um envio faz com a marca do agendamento
  const base = { canal: "whatsapp" as const, destinatario: "cliente" as const, tipo: "confirmado" as const, agendamentoId: "A1" };
  assert.deepEqual(efeitoNoAviso({ ...base, status: "falhou", erro: "META_131026" }), { acao: "marca", tipo: "confirmado", motivo: "número sem WhatsApp" });
  assert.deepEqual(efeitoNoAviso({ ...base, status: "falhou" }), { acao: "marca", tipo: "confirmado", motivo: "o WhatsApp recusou a entrega" });
  assert.deepEqual(efeitoNoAviso({ ...base, status: "sem-saldo" }), { acao: "marca", tipo: "confirmado", motivo: "sem saldo de mensagens" });
  for (const st of ["enviado", "entregue", "lido"] as const) assert.deepEqual(efeitoNoAviso({ ...base, status: st }), { acao: "limpa", tipo: "confirmado" }, st);
  for (const st of ["aceito", "parado"] as const) assert.equal(efeitoNoAviso({ ...base, status: st }), null, st);
  assert.equal(efeitoNoAviso({ ...base, destinatario: "dono", status: "falhou" }), null, "mensagem ao dono não marca o agendamento");
  assert.equal(efeitoNoAviso({ ...base, agendamentoId: undefined, status: "falhou" }), null, "sem agendamento");
  assert.equal(efeitoNoAviso({ ...base, canal: "sms", status: "sem-saldo" }), null, "SMS não diz nada do WhatsApp");
  assert.equal(efeitoNoAviso({ ...base, tipo: "pix", status: "falhou" }), null, "Pix não é aviso de horário");
  // quando a agenda mostra o wa.me, e com qual texto
  const agora = Date.parse("2026-11-10T12:00:00Z");
  const depois = agora + 3_600_000;
  const f = (tipo: "recebido" | "confirmado" | "cancelado" | "reagendado" | "lembrete") => ({ tipo, em: agora });
  assert.equal(avisoPendente({ status: "confirmed", start: depois }, agora), null, "sem marca");
  assert.equal(avisoPendente({ avisoFalhou: f("confirmado"), status: "confirmed", start: depois }, agora), "confirmado");
  assert.equal(avisoPendente({ avisoFalhou: f("confirmado"), status: "confirmed", start: agora - 1 }, agora), null, "o horário já passou");
  assert.equal(avisoPendente({ avisoFalhou: f("confirmado"), status: "cancelled", start: depois }, agora), null, "cancelado depois: a confirmação não serve");
  assert.equal(avisoPendente({ avisoFalhou: f("cancelado"), status: "cancelled", start: agora - 1 }, agora), "cancelado", "cancelamento vale mesmo depois do horário");
  assert.equal(avisoPendente({ avisoFalhou: f("cancelado"), status: "booked", start: depois }, agora), null);
  assert.equal(avisoPendente({ avisoFalhou: f("recebido"), status: "booked", start: depois }, agora), "recebido");
  assert.equal(avisoPendente({ avisoFalhou: f("recebido"), status: "confirmed", start: depois }, agora), "confirmado", "recibo de horário já confirmado vira a confirmação");
  assert.equal(avisoPendente({ avisoFalhou: f("reagendado"), status: "confirmed", start: depois }, agora), "remarcado");
  assert.equal(avisoPendente({ avisoFalhou: f("lembrete"), status: "confirmed", start: depois }, agora), "lembrete");
  // pela API só no canal oficial e com o aceite
  assert.equal(avisaPelaApi(true, { aceito: true }), true);
  assert.equal(avisaPelaApi(true, undefined), false);
  assert.equal(avisaPelaApi(undefined, { aceito: true }), false);
  // a faixa depois do aviso pela API: wa.me só quando não saiu (parada tem o "Enviar agora" próprio)
  assert.deepEqual(faixaDoAviso({ situacao: "enviada" }, "Ana: horário confirmado"), { texto: "Ana: horário confirmado. Cliente avisado pelo WhatsApp.", waMe: false });
  assert.equal(faixaDoAviso({ situacao: "agendada" }, "x").waMe, false);
  assert.equal(faixaDoAviso({ situacao: "parada" }, "x").waMe, false);
  assert.deepEqual(faixaDoAviso({ situacao: "sem_saldo" }, "Ana: horário cancelado"), { texto: "Ana: horário cancelado. O aviso automático não saiu (sem saldo de mensagens): avise pelo WhatsApp.", waMe: true });
  assert.match(faixaDoAviso({ situacao: "falhou", motivo: "Este número não tem WhatsApp." }, "x").texto, /\(Este número não tem WhatsApp\): avise/);
  assert.equal(faixaDoAviso(null, "x").waMe, true, "sem resposta do servidor: wa.me");
  for (const s of ["sem_aceite", "sem_canal"] as const) assert.equal(faixaDoAviso({ situacao: s }, "x").waMe, true);
}
console.log("mensagens ok");

// limites da agenda pelo link
import { foraDoLimite, limitesDe } from "@/lib/scheduling";
assert.deepEqual(limitesDe(undefined), { maxServicos: 5, maxDuracaoMin: 240 });
assert.deepEqual(limitesDe({ maxServicos: 99, maxDuracaoMin: 5 }), { maxServicos: 5, maxDuracaoMin: 240 }); // fora do teto = padrão
assert.deepEqual(limitesDe({ maxServicos: 3, maxDuracaoMin: 120 }), { maxServicos: 3, maxDuracaoMin: 120 });
const lim = { maxServicos: 2, maxDuracaoMin: 120 };
const s = (m: number) => ({ durationMin: m });
assert.equal(foraDoLimite([s(300)], lim), null); // um serviço longo sozinho vale
assert.equal(foraDoLimite([s(60), s(60)], lim), null);
assert.match(foraDoLimite([s(60), s(90)], lim)!, /passam de 2 h/);
assert.match(foraDoLimite([s(10), s(10), s(10)], lim)!, /até 2 serviços/);
console.log("limites ok");

// fuso do negócio: o escolhido à mão vence; sem ele, o da UF; inválido cai na UF
import { FUSOS, fusoDaUF, fusoDe } from "@/lib/datetime";
import { UFS } from "@/lib/gerador";
for (const id of Object.keys(FUSOS)) new Intl.DateTimeFormat("pt-BR", { timeZone: id }); // IANA válido
for (const uf of UFS) assert.ok(fusoDaUF(uf) in FUSOS, uf); // toda UF cai num fuso da lista
assert.equal(fusoDe({ uf: "AM" }), "America/Manaus");
assert.equal(fusoDe({ uf: "PA" }), "America/Belem");
assert.equal(fusoDe({ uf: "AM", fuso: "America/Sao_Paulo" }), "America/Sao_Paulo");
assert.equal(fusoDe({ uf: "AC", fuso: "Europe/Lisbon" }), "America/Rio_Branco");
assert.equal(fusoDe(undefined), "America/Sao_Paulo");
console.log("fusos ok");
