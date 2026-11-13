import assert from "node:assert/strict";
import { lerCrm, negocio } from "@/lib/crm";
import { diaCurto, hojeISO, mensalidadeDe, prazoDe } from "@/lib/crm-tipos";

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
    valor === null || tipo === "string" || tipo === "number" || tipo === "boolean" ||
      (Array.isArray(valor) && valor.every((v) => Object.getPrototypeOf(v) === Object.prototype)),
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
  caixaCents: null,
  fechadoEm: null,
  proximaAcao: null,
  proximaData: null,
  publicado: true,
  notas: 1,
  donoNome: null,
  donoPapel: null,
  donoWhatsapp: null,
  donoEmail: null,
  outrosContatos: [],
  motivoPerda: null,
  detalhePerda: null,
  origem: null,
  indicadoPor: null,
  entrouEm: null,
  perdidoEm: null,
  ultimoContatoEm: null,
  fixadoAte: null,
  utm: null,
  toques: 0,
  respondeuEm: null,
  naoContatarEm: null,
  propostaVistaEm: null,
  varianteId: null,
  siteVistoEm: null,
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
    "calado": { ...base, estagio: "novo" as const, ultimoContatoEm: dias(5) },
    "com-toque": { ...base, estagio: "novo" as const, ultimoContatoEm: dias(1), proximaData: "2026-09-25" },
    "parou": { ...base, estagio: "novo" as const, ultimoContatoEm: dias(5), naoContatarEm: dias(4) },
    "viu": { ...base, estagio: "oferta" as const, proximaData: "2026-09-25", ultimoContatoEm: dias(3), propostaVistaEm: dias(1) },
    "viu-antes": { ...base, estagio: "oferta" as const, proximaData: "2026-09-25", ultimoContatoEm: dias(1), propostaVistaEm: dias(3) },
  };
  const lista = [
    { slug: "sem-passo", acessos: 1 },
    { slug: "parado", acessos: 1 },
    { slug: "novo-em-folha", acessos: 1 },
    { slug: "nunca-entrou", acessos: 1 },
    { slug: "fechou-ontem", acessos: 1 },
    { slug: "no-topo", acessos: 1 },
    { slug: "cliente-ativo", acessos: 3 },
    { slug: "calado", acessos: 1 },
    { slug: "com-toque", acessos: 1 },
    { slug: "parou", acessos: 1 },
    { slug: "viu", acessos: 1 },
    { slug: "viu-antes", acessos: 1 },
  ];
  const por = Object.fromEntries(alertas(lista, crm, hoje).map((a) => [a.id, a.slugs]));
  assert.deepEqual(por.sem_proxima, ["sem-passo"], "só negociação sem data combinada");
  assert.deepEqual(por.parado, ["parado"], "9 dias sem contato entra, 2 dias não");
  assert.deepEqual(por.implantacao, ["nunca-entrou"], "fechado há 20 dias sem o dono entrar");
  assert.deepEqual(por.destaque, ["no-topo"], "destaque que vence hoje");
  assert.deepEqual(por.sem_toque, ["calado"], "contatado, sem resposta e sem toque agendado; quem pediu para parar fica fora");
  assert.deepEqual(por.viu_proposta, ["viu"], "abriu a proposta depois do último contato");
  assert.equal(alertas([], {}, hoje).length, 0, "sem negócio, sem alerta");
}
console.log("alertas: ok");

// Dinheiro digitado à mão: o campo de preço não pode apagar valor por causa de vírgula
{
  const { cents, emReais } = await import("@/lib/dinheiro");
  assert.equal(cents("59,90"), 5990, "vírgula é decimal");
  assert.equal(cents("59.90"), 5990, "ponto no fim também é decimal");
  assert.equal(cents("1.250,00"), 125000, "ponto é milhar quando há vírgula");
  assert.equal(cents("1.250"), 125000, "ponto sozinho com 3 dígitos é milhar");
  assert.equal(cents("250"), 25000);
  assert.ok(Number.isNaN(cents("")), "vazio não é zero");
  assert.ok(Number.isNaN(cents("abc")), "texto não vira preço");
  assert.equal(emReais(5990), "59,90", "mostra as duas casas");
  assert.equal(emReais(25000), "250,00");
}
console.log("dinheiro: ok");

// Sessão encerrada pelo admin: o token vale até expirar, o acesso não
{
  const { sessaoRevogada } = await import("@/lib/revogacao");
  const agora = Date.now();
  assert.equal(sessaoRevogada({ ana: agora }, "ana", agora - 1000), true, "login antes da revogação não vale");
  assert.equal(sessaoRevogada({ ana: agora }, "ana", agora + 1000), false, "quem entrou depois segue dentro");
  assert.equal(sessaoRevogada({ ana: agora }, "bia", agora - 1000), false, "revogação é por conta");
  assert.equal(sessaoRevogada(undefined, "ana", agora), false, "sem marca, ninguém é barrado");
  assert.equal(sessaoRevogada({ ana: "ontem" }, "ana", agora), false, "lixo no campo não tranca ninguém fora");
}
console.log("revogacao: ok");

// Outros WhatsApp do negócio: só número completo com DDD, e no máximo dez
{
  const { CrmInput } = await import("@/lib/crm");
  const ok = (outrosContatos: unknown) => CrmInput.safeParse({ outrosContatos }).success;
  // WhatsApp do dono: a regra da tela vale no servidor, que grava só os dígitos
  const zap = (donoWhatsapp: unknown) => { const r = CrmInput.safeParse({ donoWhatsapp }); return r.success ? r.data.donoWhatsapp : "recusado"; };
  assert.equal(zap("+55 (91) 99111-6359"), "91991116359", "máscara e DDI saem");
  assert.equal(zap(""), null, "vazio vira null");
  assert.equal(zap(null), null);
  for (const ruim of ["919911163", "00991116359", "91891116359", "919911163590", "5591991116359123"]) assert.equal(zap(ruim), "recusado", ruim);
  assert.equal(ok([{ nome: "Sócio", whatsapp: "92999998888" }]), true);
  assert.equal(ok([{ nome: "", whatsapp: "9299998888" }]), true, "fixo com DDD vale, nome é opcional");
  assert.equal(ok([{ nome: "Sócio", whatsapp: "99998888" }]), false, "sem DDD não passa");
  assert.equal(ok([{ nome: "Sócio", whatsapp: "(92) 99999-8888" }]), false, "chega só dígitos");
  assert.equal(ok(Array(11).fill({ nome: "x", whatsapp: "92999998888" })), false, "até dez");
  assert.deepEqual(negocio(doc({})).outrosContatos, [], "documento antigo lê lista vazia");
}
console.log("outros contatos: ok");

// Caixa incluído: o valor legado não entra em novas mensalidades
assert.equal(mensalidadeDe({ mensalCents: 8990, caixaCents: 1990 }), 8990);
assert.equal(mensalidadeDe({ mensalCents: 8990, caixaCents: null }), 8990);
assert.equal(mensalidadeDe(undefined), 0);
console.log("caixa na mensalidade ok");

// o importado que ninguém tocou não vai para a tela: ela já trata a falta como "novo" e "importado"
const salvo = (id: string, campos: Record<string, unknown>) => ({ id, exists: true, data: () => campos, get: (c: string) => campos[c] });
const banco = { collection: () => ({ get: async () => ({ docs: [
  salvo("so-origem", { origem: "importado" }),
  salvo("com-notas", { origem: "importado", notas: 2 }),
  salvo("cadastro", { origem: "cadastro" }),
  salvo("para-hoje", { origem: "cadastro", proximaData: "2026-11-01" }),
  salvo("tocado", { origem: "importado", estagio: "conversa" }),
] }) }) } as unknown as Parameters<typeof lerCrm>[0];
assert.deepEqual(Object.keys(await lerCrm(banco)), ["cadastro", "para-hoje", "tocado"]);
console.log("crm trivial fora da tela ok");

// LOW-3 (revisão do núcleo): negocio() lê toques, datas e outros contatos com Zod: dado torto vira 0,
// null ou some da lista, sem quebrar nem passar tipo mentiroso à tela
{
  const { negocio, telefonesDoNegocio } = await import("@/lib/crm");
  const doc = (d: Record<string, unknown>) => ({ get: (k: string) => d[k] });
  const quando = new Date("2026-11-12T12:00:00Z");
  const torto = negocio(doc({ toques: "3", respondeuEm: "ontem", naoContatarEm: 5, siteVistoEm: { toDate: "x" }, outrosContatos: [{ nome: "Bia", whatsapp: "11900000301" }, { whatsapp: 7 }, null, "x"] }));
  assert.deepEqual([torto.toques, torto.respondeuEm, torto.naoContatarEm, torto.siteVistoEm], [0, null, null, null]);
  assert.deepEqual(torto.outrosContatos, [{ nome: "Bia", whatsapp: "11900000301" }], "o item torto sai, o bom fica");
  assert.equal(negocio(doc({ toques: -1 })).toques, 0);
  assert.deepEqual(negocio(doc({ outrosContatos: "x" })).outrosContatos, []);
  const bom = negocio(doc({ toques: 2, respondeuEm: { toDate: () => quando }, siteVistoEm: { toDate: () => quando } }));
  assert.deepEqual([bom.toques, bom.respondeuEm, bom.siteVistoEm, bom.naoContatarEm], [2, quando.toISOString(), quando.toISOString(), null]);
  assert.deepEqual(telefonesDoNegocio(null, doc({ outrosContatos: [{ whatsapp: "11900000302" }, { whatsapp: 9 }] })), ["11900000302"], "telefone torto não entra; o bom continua no PARE");
}
console.log("negocio com Zod: ok");

// Envio confirmado (F1): o id do evento é slug__etapa__envioId e o evento nasce com create().
// Dois "Sim" do mesmo envio (clique duplo, rede lenta) gravam um evento e contam um toque só.
// O número do toque e a variante saem do servidor; passou de TOQUES_MAX, recusa com LimiteAtingido.
{
  const { registrarMensagem, marcarContato } = await import("@/lib/crm");
  const { LimiteAtingido } = await import("@/lib/erro-previsto");
  const { varianteAB } = await import("@/lib/prospeccao");
  type Ref = { path: string; id: string; collection: (c: string) => { doc: (id?: string) => Ref } };
  // transação mínima: lê na hora, escreve no fim, tudo ou nada; create() de doc que existe falha
  // com ALREADY_EXISTS, como no Firestore. `lerFantasma` faz a leitura não ver um doc (outro
  // processo o criou entre a leitura e o commit)
  const banco = (lerFantasma = new Set<string>()) => {
    const docs = new Map<string, Record<string, unknown>>();
    let seq = 0;
    const ref = (path: string): Ref => ({
      path,
      id: path.split("/").at(-1)!,
      collection: (c) => ({ doc: (id = `auto${++seq}`) => ref(`${path}/${c}/${id}`) }),
    });
    const db = {
      doc: (p: string) => ref(p),
      runTransaction: async <T,>(fn: (tx: unknown) => Promise<T>) => {
        const creates: Ref[] = [];
        const escritas: (() => void)[] = [];
        const tx = {
          get: async (r: Ref) => {
            const d = lerFantasma.has(r.path) ? undefined : docs.get(r.path);
            return { exists: !!d, get: (k: string) => k.split(".").reduce<unknown>((o, c) => (o as Record<string, unknown> | undefined)?.[c], d) };
          },
          create: (r: Ref, v: Record<string, unknown>) => {
            creates.push(r);
            escritas.push(() => docs.set(r.path, v));
          },
          set: (r: Ref, v: Record<string, unknown>) => escritas.push(() => docs.set(r.path, { ...docs.get(r.path), ...v })),
        };
        const r = await fn(tx);
        if (creates.some((c) => docs.has(c.path))) throw new Error("6 ALREADY_EXISTS: Document already exists");
        for (const e of escritas) e();
        return r;
      },
    } as unknown as Parameters<typeof registrarMensagem>[0];
    return { db, docs, eventos: (slug: string) => [...docs.entries()].filter(([k]) => k.startsWith(`crm/${slug}/eventos/`)) };
  };
  const ID1 = "11111111-1111-4111-8111-111111111111", ID2 = "22222222-2222-4222-8222-222222222222", ID3 = "33333333-3333-4333-8333-333333333333";
  const envio = { envioId: ID1, textoEnviado: "Oi! Responda PARE se não quiser.", editado: false };
  const { db, docs, eventos } = banco();
  docs.set("tenants/ana", { gerado: { sub: "salao" } });
  const variante = varianteAB("ana").id;

  // o cliente não manda toque nem variante: campos a mais são ignorados (Zod tira)
  assert.equal(await registrarMensagem(db, "ana", "Primeiro contato", "o dono", "admin", { ...envio, varianteId: "falsa", toque: 3 } as typeof envio), true);
  assert.equal(await registrarMensagem(db, "ana", "Primeiro contato", "o dono", "admin", envio), false, "a segunda confirmação não grava");
  assert.deepEqual(eventos("ana").map(([k]) => k), [`crm/ana/eventos/ana__primeiro__${ID1}`], "um evento só, com o id do envio");
  const [, ev] = eventos("ana")[0];
  assert.equal(ev.tipo, "envio_confirmado");
  assert.deepEqual([ev.varianteId, ev.textoEnviado, ev.etapa, ev.toque, ev.editado], [variante, envio.textoEnviado, "primeiro", 1, false], "toque e variante do servidor");
  assert.equal(docs.get("crm/ana")?.varianteId, variante, "a variante do primeiro contato fica no doc");
  // F2-12: o ultimoEnvio também guarda a etapa e o instante (a trava de outra aba no mesmo minuto)
  const { em: emAna, ...ultimoAna } = docs.get("crm/ana")?.ultimoEnvio as { em: number };
  assert.deepEqual(ultimoAna, { id: `ana__primeiro__${ID1}`, varianteId: variante, textoEnviado: envio.textoEnviado, etapa: "primeiro" });
  assert.equal(typeof emAna, "number");

  // o próximo toque é outro id; confirmação sem envio (e-mail, cobrança) segue com id automático
  assert.equal(await registrarMensagem(db, "ana", "Lembrete", "o dono", "admin", { ...envio, envioId: ID2, editado: true }), true);
  assert.equal(await registrarMensagem(db, "ana", "Proposta por e-mail", "o dono", "admin"), true);
  assert.equal(eventos("ana").length, 3);
  assert.equal(docs.get(`crm/ana/eventos/ana__lembrete__${ID2}`)?.varianteId, null, "fora do primeiro contato, sem variante");
  // entrada inválida não grava
  await assert.rejects(registrarMensagem(db, "ana", "Lembrete", "o dono", "admin", { ...envio, envioId: "1" }));
  await assert.rejects(registrarMensagem(db, "ana", "Lembrete", "o dono", "admin", { ...envio, textoEnviado: " " }));

  // resposta humana, automática e PARE ficam ligadas ao último envio (o Lembrete acima)
  await marcarContato(db, "ana", "automatica", "admin");
  await marcarContato(db, "ana", "respondeu", "admin");
  const antesDoPare = eventos("ana").length;
  await marcarContato(db, "ana", "parar", "admin");
  assert.equal(eventos("ana").length, antesDoPare + 1, "PARE grava um evento só");
  const ligados = eventos("ana").map(([, v]) => v).filter((v) => ["resposta_humana", "resposta_automatica", "optout"].includes(String(v.tipo)));
  assert.deepEqual(ligados.map((v) => v.tipo), ["resposta_automatica", "resposta_humana", "optout"]);
  for (const v of ligados) assert.equal(v.envioId, `ana__lembrete__${ID2}`);
  assert.match(String(ligados[2].detalhe), /→ Perdido/, "a mudança de estágio vai no detalhe do optout");
  assert.ok(docs.get("crm/ana")?.naoContatarEm, "PARE grava o pedido de parar");

  // ultimoEnvio torto no doc: a resposta fica sem ligação (Zod), sem quebrar nem inventar
  docs.set("crm/torto", { ultimoEnvio: { id: 7 } });
  await marcarContato(db, "torto", "respondeu", "admin");
  assert.deepEqual(eventos("torto").map(([, v]) => [v.envioId, v.varianteId]), [[null, null]]);

  // depois da resposta os toques não sobem, e mesmo assim dois envios não colidem (ids diferentes)
  // (F2-12: com 2 min entre eles; no mesmo minuto o segundo é outra aba e é recusado, abaixo)
  docs.set("crm/bia", { estagio: "novo", respondeuEm: { toDate: () => new Date() }, toques: 1 });
  const T0 = Date.UTC(2026, 10, 12, 12);
  assert.equal(await registrarMensagem(db, "bia", "Lembrete", "o dono", "admin", { ...envio, envioId: ID1 }, T0), true);
  assert.equal(await registrarMensagem(db, "bia", "Lembrete", "o dono", "admin", { ...envio, envioId: ID2 }, T0 + 120_000), true);
  assert.equal(eventos("bia").length, 2, "nenhum envio some");

  // F2-12: o mesmo lead aberto em duas abas (dois envioIds) confirmando a mesma etapa no mesmo minuto:
  // o segundo é recusado e nada é gravado; outra etapa no mesmo minuto passa
  await assert.rejects(registrarMensagem(db, "bia", "Lembrete", "o dono", "admin", { ...envio, envioId: ID3 }, T0 + 150_000), /menos de um minuto/);
  assert.equal(eventos("bia").length, 2, "a outra aba não grava");
  assert.equal(await registrarMensagem(db, "bia", "Última tentativa", "o dono", "admin", { ...envio, envioId: ID3 }, T0 + 150_000), true);

  // editado no primeiro contato: não grava variante (não mede o texto da variante)
  docs.set("tenants/cris", { gerado: { sub: "salao" } });
  assert.equal(await registrarMensagem(db, "cris", "Primeiro contato", "o dono", "admin", { ...envio, editado: true }), true);
  assert.equal(docs.get("crm/cris")?.varianteId, undefined);
  assert.equal(eventos("cris")[0][1].varianteId, null);
  // fora do salão: sem variante
  docs.set("tenants/duda", { gerado: { sub: "barbearia" } });
  await registrarMensagem(db, "duda", "Primeiro contato", "o dono", "admin", envio);
  assert.equal(eventos("duda")[0][1].varianteId, null);

  // TOQUES_MAX: o quarto toque é recusado com erro visível, e nada é gravado
  docs.set("crm/eva", { estagio: "novo", toques: 3 });
  await assert.rejects(registrarMensagem(db, "eva", "Última tentativa", "o dono", "admin", { ...envio, envioId: ID3 }), LimiteAtingido);
  assert.equal(eventos("eva").length, 0);
  // mensagem fora da cadência (proposta) segue
  assert.equal(await registrarMensagem(db, "eva", "Proposta por e-mail", "o dono", "admin"), true);

  // create() é a trava: outro processo gravou o mesmo envio depois da leitura. registrarMensagem
  // falha com ALREADY_EXISTS e não grava nada (nem o doc, nem o toque)
  {
    const corrida = banco(new Set([`crm/fia/eventos/fia__primeiro__${ID1}`]));
    corrida.docs.set(`crm/fia/eventos/fia__primeiro__${ID1}`, { tipo: "envio_confirmado" });
    await assert.rejects(registrarMensagem(corrida.db, "fia", "Primeiro contato", "o dono", "admin", envio), /ALREADY_EXISTS/);
    assert.equal(corrida.docs.has("crm/fia"), false, "o doc do negócio não foi tocado");
    assert.equal(corrida.eventos("fia").length, 1);
  }

  // F1-10/F1-13: proposta, boas-vindas e implantação também passam pelo "Enviou?": com envioId, o id
  // é slug__mensagem__envioId (dois "Sim" gravam um) e nenhum toque de cadência conta
  docs.set("crm/gil", { estagio: "negociando", toques: 1 });
  const ID4 = "44444444-4444-4444-8444-444444444444";
  const proposta = { envioId: ID4, textoEnviado: "Montei a proposta. Se não quiser mais mensagens, responda PARE.", editado: false };
  assert.equal(await registrarMensagem(db, "gil", "Proposta", "o dono", "admin", proposta), true);
  assert.equal(await registrarMensagem(db, "gil", "Proposta", "o dono", "admin", proposta), false, "duplo clique no Sim: uma gravação");
  assert.deepEqual(eventos("gil").map(([k]) => k), [`crm/gil/eventos/gil__mensagem__${ID4}`]);
  assert.equal(eventos("gil")[0][1].textoEnviado, proposta.textoEnviado);
  assert.equal(docs.get("crm/gil")?.toques, 1, "proposta não conta toque");
  assert.equal(docs.get("crm/gil")?.ultimoEnvio, undefined, "nem vira o envio a que a resposta se liga");
  assert.equal(docs.get("crm/gil")?.estagio, "negociando", "proposta não rebaixa quem já negocia");
  // proposta confirmada move o Novo para Oferta enviada (com evento de estágio); sem o "Sim", não move
  docs.set("crm/nov", { estagio: "novo", respondeuEm: 1 });
  assert.equal(await registrarMensagem(db, "nov", "Proposta", "o dono", "admin"), true);
  assert.equal(docs.get("crm/nov")?.estagio, "novo", "sem envio confirmado a etapa fica");
  assert.equal(await registrarMensagem(db, "nov", "Proposta", "o dono", "admin", { ...proposta, envioId: "55555555-5555-4555-8555-555555555555" }), true);
  assert.equal(docs.get("crm/nov")?.estagio, "oferta", "Novo → Oferta enviada");
  assert.equal(eventos("nov").filter(([, e]) => e.tipo === "estagio").length, 1, "um evento de estágio");
  // F1-14: "Editei" grava o texto colado no modal (o que saiu), não o rascunho
  const ID5 = "55555555-5555-4555-8555-555555555555";
  assert.equal(await registrarMensagem(db, "gil", "Boas-vindas", "o dono", "admin", { envioId: ID5, textoEnviado: "Texto que saiu de fato. PARE", editado: true }), true);
  assert.equal(docs.get(`crm/gil/eventos/gil__mensagem__${ID5}`)?.textoEnviado, "Texto que saiu de fato. PARE");

  // F1-12: PARE de cliente fechado grava o opt-out da prospecção, mas as mensagens de cliente seguem
  docs.set("crm/hel", { estagio: "fechado" });
  await marcarContato(db, "hel", "parar", "admin");
  assert.ok(docs.get("crm/hel")?.naoContatarEm, "o opt-out fica gravado");
  assert.equal(docs.get("crm/hel")?.estagio, "fechado", "segue cliente");
  for (const m of ["Boas-vindas", "Proposta", "Lembrete: convite", "Lembrete: serviços"]) assert.equal(await registrarMensagem(db, "hel", m, "o dono", "admin"), true, m);
  for (const m of ["Primeiro contato", "Lembrete", "Última tentativa"]) await assert.rejects(registrarMensagem(db, "hel", m, "o dono", "admin", { ...envio, envioId: ID2 }), /pediu para não receber/, m);
  // quem não é cliente e pediu PARE: a proposta também não sai
  docs.set("crm/ivo", { estagio: "negociando", naoContatarEm: { toDate: () => new Date() } });
  await assert.rejects(registrarMensagem(db, "ivo", "Proposta", "o dono", "admin"), /pediu para não receber/);

  // F3-L2: PARE dado no número de prospecção (prospeccaoConversas/{telefone}) sem slug confirmado:
  // a cadência não sai para nenhum telefone do negócio; a mensagem fora da cadência segue
  docs.set("crm/jo", { estagio: "novo", donoWhatsapp: "5511900000201" });
  docs.set("tenants/jo", { site: { phone: "(11) 90000-0202" } });
  docs.set("prospeccaoConversas/5511900000202", { naoContatarEm: 1 });
  await assert.rejects(registrarMensagem(db, "jo", "Primeiro contato", "o dono", "admin", envio), /número de prospecção/);
  await assert.rejects(registrarMensagem(db, "jo", "Lembrete", "o dono", "admin", { ...envio, envioId: ID5 }), /número de prospecção/);
  assert.equal(eventos("jo").length, 0);
  assert.equal(await registrarMensagem(db, "jo", "Proposta por e-mail", "o dono", "admin"), true);
  // M-7: a Proposta de quem não é cliente também não sai com o PARE do número de prospecção; cliente fechado recebe
  await assert.rejects(registrarMensagem(db, "jo", "Proposta", "o dono", "admin"), /número de prospecção: a proposta não sai/);
  docs.set("crm/jo", { estagio: "fechado", donoWhatsapp: "5511900000201" });
  assert.equal(await registrarMensagem(db, "jo", "Proposta", "o dono", "admin"), true, "fechado: a proposta sai");
  docs.set("crm/jo", { ...docs.get("crm/jo"), estagio: "novo" });
  docs.delete("prospeccaoConversas/5511900000202");
  assert.equal(await registrarMensagem(db, "jo", "Primeiro contato", "o dono", "admin", envio), true, "sem o PARE, sai");

  // MEDIUM-3 (revisão do núcleo): toque da cadência sem envio confirmado (sem Sim/Editei) é recusado e
  // nada é gravado; cobrança, proposta e boas-vindas sem confirmação seguem
  docs.set("crm/kai", { estagio: "novo", toques: 0 });
  for (const m of ["Primeiro contato", "Lembrete", "Última tentativa"]) await assert.rejects(registrarMensagem(db, "kai", m, "o dono", "admin"), /envio confirmado/, m);
  assert.equal(eventos("kai").length, 0);
  assert.equal(docs.get("crm/kai")?.toques, 0, "nenhum toque contado");
  for (const m of ["Cobrança de 2026-11", "Proposta", "Boas-vindas"]) assert.equal(await registrarMensagem(db, "kai", m, "o dono", "admin"), true, m);
  assert.equal(docs.get("crm/kai")?.toques, 0);
  // L-9 (terceira rodada): nome do protótipo não é cadência (antes, !!CADENCIA["constructor"] era true)
  for (const m of ["constructor", "toString"]) assert.equal(await registrarMensagem(db, "kai", m, "o dono", "admin"), true, m);
  assert.equal(docs.get("crm/kai")?.toques, 0, "constructor/toString não contam toque");

  // MEDIUM-2: resposta e opt-out levam a variante da RAIZ (primeiro contato), mesmo com um lembrete da
  // fila que tem variante própria no ultimoEnvio
  docs.set("tenants/lia", { gerado: { sub: "salao" } });
  assert.equal(await registrarMensagem(db, "lia", "Primeiro contato", "o dono", "admin", envio), true);
  assert.equal(await registrarMensagem(db, "lia", "Lembrete", "o dono", "fila", { ...envio, envioId: ID2 }, Date.now(), { varianteId: "salao-lembrete-faltas" as never }), true);
  assert.equal((docs.get("crm/lia")?.ultimoEnvio as { varianteId: string }).varianteId, "salao-lembrete-faltas");
  await marcarContato(db, "lia", "respondeu", "admin");
  const respLia = eventos("lia").map(([, v]) => v).find((v) => v.tipo === "resposta_humana");
  assert.equal(respLia?.varianteId, varianteAB("lia").id, "a da raiz, não a do lembrete");
  assert.equal(docs.get(`prospeccaoVariantes/${varianteAB("lia").id}`)?.respostas !== undefined, true, "a resposta conta na variante da raiz");
  assert.equal(docs.get("prospeccaoVariantes/salao-lembrete-faltas")?.respostas, undefined, "e não na do lembrete");

  // MEDIUM-4: evento de prospecção torto é recusado antes de gravar (EventoProspeccao.parse)
  const { EventoProspeccao } = await import("@/lib/crm-tipos");
  assert.equal(EventoProspeccao.safeParse({ tipo: "envio_confirmado", etapa: "segundo", toque: 1, varianteId: null, textoEnviado: "x", editado: false }).success, false);
  assert.equal(EventoProspeccao.safeParse({ tipo: "optout", envioId: null, varianteId: 7, textoEnviado: null }).success, false);
  assert.equal(EventoProspeccao.safeParse({ tipo: "ia_falha", origem: "outro", codigo: "X" }).success, false);
  const { registrarFalhaIA } = await import("@/lib/crm");
  let adicionados = 0;
  const comAdd = { collection: () => ({ add: async () => void adicionados++ }) } as unknown as Parameters<typeof registrarFalhaIA>[0];
  await assert.rejects(registrarFalhaIA(comAdd, "lia", "outro" as never, new Error("x")));
  assert.equal(adicionados, 0, "ia_falha torto não grava");
  await registrarFalhaIA(comAdd, "lia", "copiloto", new Error("x"));
  assert.equal(adicionados, 1);
}
console.log("envio confirmado idempotente: ok");
