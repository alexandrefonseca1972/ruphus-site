import assert from "node:assert/strict";
import { negocio } from "@/lib/crm";
import { diaCurto, hojeISO, prazoDe } from "@/lib/crm-tipos";

// Um Timestamp do Firestore é uma classe. Se ele escapar para a tela, o React
// derruba o painel inteiro com "Only plain objects... can be passed to Client
// Components" — e só quando existe negócio salvo, então passa despercebido.
class Timestamp {
  constructor(private readonly ms: number) {}
  toDate() {
    return new Date(this.ms);
  }
}

const doc = (campos: Record<string, unknown>) => ({ get: (c: string) => campos[c] });

const cheio = negocio(
  doc({
    estagio: "negociando",
    entradaCents: 25000,
    mensalCents: 5990,
    proximaAcao: "Cobrar retorno da proposta",
    proximaData: "2026-09-25",
    notas: 1,
    publicado: true,
    fechadoEm: new Timestamp(Date.UTC(2026, 8, 25)),
    atualizadoEm: new Timestamp(Date.now()), // o campo que não pode vazar
  }),
);

// nenhum valor de classe atravessa
for (const [campo, valor] of Object.entries(cheio)) {
  const tipo = typeof valor;
  assert.ok(
    valor === null || tipo === "string" || tipo === "number" || tipo === "boolean",
    `${campo} precisa ser simples, veio ${tipo}`,
  );
}
assert.equal(Object.hasOwn(cheio, "atualizadoEm"), false, "atualizadoEm não pode chegar na tela");
assert.equal(cheio.estagio, "negociando");
assert.deepEqual([cheio.entradaCents, cheio.mensalCents], [25000, 5990]);
assert.equal(cheio.fechadoEm, "2026-09-25T00:00:00.000Z");

// documento recém-criado por uma anotação: só tem contador, e ainda assim abre
const magro = negocio(doc({ notas: 1, atualizadoEm: new Timestamp(Date.now()) }));
assert.deepEqual(magro, {
  estagio: "novo",
  entradaCents: null,
  mensalCents: null,
  fechadoEm: null,
  proximaAcao: null,
  proximaData: null,
  publicado: true,
  notas: 1,
  donoNome: null,
  donoPapel: null,
  donoWhatsapp: null,
  donoEmail: null,
  motivoPerda: null,
  detalhePerda: null,
  origem: null,
  indicadoPor: null,
  entrouEm: null,
  perdidoEm: null,
  ultimoContatoEm: null,
  fixadoAte: null,
});

// estágio desconhecido não quebra a tela nem pinta chip inexistente
assert.equal(negocio(doc({ estagio: "atrasado" })).estagio, "novo");
// publicado só é falso quando dito explicitamente
assert.equal(negocio(doc({ publicado: false })).publicado, false);
assert.equal(negocio(doc({})).publicado, true);

// ————— compromissos: a próxima ação combinada —————

const hoje = hojeISO();
assert.match(hoje, /^\d{4}-\d{2}-\d{2}$/);
// a data é a de quem olha, não a de Londres: em Manaus (UTC-4) o UTC já virou
// o dia seguinte depois das 20h, e tudo de hoje apareceria como atrasado
assert.equal(hoje, new Date().toLocaleDateString("en-CA"));

const em = (d: string) => ({ proximaData: d });
assert.equal(prazoDe(em("2026-09-17"), "2026-09-18"), "atrasada");
assert.equal(prazoDe(em("2026-09-18"), "2026-09-18"), "hoje");
assert.equal(prazoDe(em("2026-09-19"), "2026-09-18"), "futura");
// a comparação é textual: precisa atravessar virada de mês e de ano
assert.equal(prazoDe(em("2026-08-31"), "2026-09-01"), "atrasada");
assert.equal(prazoDe(em("2027-01-01"), "2026-12-31"), "futura");
// sem data combinada não existe compromisso — não conta como atrasado
assert.equal(prazoDe({ proximaData: null }, hoje), null);
assert.equal(prazoDe(undefined, hoje), null);

assert.equal(diaCurto("2026-09-25"), "25/09");

console.log("crm: ok");

// Saúde do cliente: a regra que a carteira e a gaveta usam
{
  const { classificar } = await import("@/lib/saude");
  const agora = Date.UTC(2026, 8, 30);
  const dias = (n: number) => agora - n * 86_400_000;
  const tudo = { convite: true, servicos: true, profissionais: true, agendamento: true };
  const base = { passos: tudo, ultimoAgendamentoMs: dias(2), clienteDesdeMs: dias(60), cobranca: "em_dia" as const, diasParaVencer: 20, agora };
  assert.equal(classificar(base).saude, "ok");
  assert.equal(classificar({ ...base, cobranca: "atrasada", diasParaVencer: -3 }).saude, "risco", "cobrança atrasada é risco");
  assert.match(classificar({ ...base, ultimoAgendamentoMs: dias(25) }).motivo, /Sem agendamento há 25 dias/);
  assert.equal(classificar({ ...base, ultimoAgendamentoMs: null, clienteDesdeMs: dias(5), passos: { ...tudo, agendamento: false } }).saude, "atencao", "cliente novo sem agendar ainda não é risco");
  assert.equal(classificar({ ...base, ultimoAgendamentoMs: null, clienteDesdeMs: dias(30) }).saude, "risco", "30 dias sem nenhum agendamento é risco");
  assert.match(classificar({ ...base, passos: { ...tudo, profissionais: false } }).motivo, /falta cadastrar quem atende/);
  assert.equal(classificar({ ...base, cobranca: "vence", diasParaVencer: 2 }).saude, "atencao");
}
console.log("saude: ok");
{
  const { classificar } = await import("@/lib/saude");
  const agora = Date.UTC(2026, 8, 30);
  const tudo = { convite: true, servicos: true, profissionais: true, agendamento: true };
  assert.equal(
    classificar({ passos: tudo, ultimoAgendamentoMs: null, clienteDesdeMs: null, cobranca: "sem", diasParaVencer: null, agora }).saude,
    "ok",
    "sem data de fechamento, não acusa inatividade",
  );
}

// Alertas: o que passou do ponto e ninguém viu
{
  const { alertas } = await import("@/lib/alertas");
  const hoje = "2026-09-22";
  const dias = (n: number) => new Date(Date.parse(`${hoje}T12:00:00`) - n * 86_400_000).toISOString();
  const base = negocio(doc({}));
  const crm = {
    "sem-passo": { ...base, estagio: "negociando" as const, ultimoContatoEm: dias(1) },
    "parado": { ...base, estagio: "oferta" as const, proximaData: "2026-10-01", ultimoContatoEm: dias(9) },
    "novo-em-folha": { ...base, estagio: "oferta" as const, proximaData: "2026-09-25", ultimoContatoEm: dias(2) },
    "nunca-entrou": { ...base, estagio: "fechado" as const, fechadoEm: dias(20) },
    "fechou-ontem": { ...base, estagio: "fechado" as const, fechadoEm: dias(1) },
    "no-topo": { ...base, estagio: "novo" as const, fixadoAte: hoje },
  };
  const lista = [
    { slug: "sem-passo", acessos: 1 },
    { slug: "parado", acessos: 1 },
    { slug: "novo-em-folha", acessos: 1 },
    { slug: "nunca-entrou", acessos: 1 },
    { slug: "fechou-ontem", acessos: 1 },
    { slug: "no-topo", acessos: 1 },
    { slug: "cliente-ativo", acessos: 3 },
  ];
  const por = Object.fromEntries(alertas(lista, crm, hoje).map((a) => [a.id, a.slugs]));
  assert.deepEqual(por.sem_proxima, ["sem-passo"], "só negociação sem data combinada");
  assert.deepEqual(por.parado, ["parado"], "9 dias sem contato entra, 2 dias não");
  assert.deepEqual(por.implantacao, ["nunca-entrou"], "fechado há 20 dias sem o dono entrar");
  assert.deepEqual(por.destaque, ["no-topo"], "destaque que vence hoje");
  assert.equal(alertas([], {}, hoje).length, 0, "sem negócio, sem alerta");
}
console.log("alertas: ok");
