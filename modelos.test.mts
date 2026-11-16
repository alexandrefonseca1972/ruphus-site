// Estúdio de modelos, domínio puro (F1): embutidos, resolver, checagem. Sem banco.
//   npm run test:modelos
import assert from "node:assert/strict";
import { type DadosSite, type Escolha, SUBS, type Sub } from "@/lib/gerador";
import { ehClaro, modelosClaro, renderClaro, visualClaro } from "@/lib/site-claro";
import { MODELOS, renderEditorial } from "@/lib/site-editorial";
import { checar, contraste } from "@/lib/modelos/checagem";
import { EMBUTIDOS } from "@/lib/modelos/embutidos";
import { type Catalogo, ehClienteAtivo, resolverModelo } from "@/lib/modelos/resolver";
import { CONFIG_VAZIA, ConfigModelos, DefModelo, DefModeloLida, doNichoAtivo } from "@/lib/modelos/tipos";

// embutidos: todos validam, ids únicos, contagem igual à do código
{
  for (const m of EMBUTIDOS) assert.doesNotThrow(() => DefModelo.parse(m), m.id);
  assert.equal(new Set(EMBUTIDOS.map((m) => m.id)).size, EMBUTIDOS.length);
  const claros = (Object.keys(SUBS) as Sub[]).filter(ehClaro).reduce((s, sub) => s + modelosClaro(sub).length, 0);
  assert.equal(EMBUTIDOS.filter((m) => m.layout === "editorial").length, MODELOS.length);
  assert.equal(EMBUTIDOS.filter((m) => m.layout === "claro").length, claros);
  // por valor: o kit e a paleta do modelo são os mesmos do código de hoje
  const c1 = EMBUTIDOS.find((m) => m.id === "cabeleireira-1")!;
  assert.equal(c1.kit, MODELOS.find((m) => m.id === "cabeleireira-1")!.pasta);
  assert.equal(c1.paleta.acc, "#E58F9C");
  const o2 = EMBUTIDOS.find((m) => m.id === "odonto-2")!;
  assert.match(o2.kit, /^\/assets\/saude\/odonto-/);
  assert.ok(EMBUTIDOS.some((m) => m.id === "bio-atual" && m.sub === "todos"));
  console.log("embutidos: ok");
}

// esquemas: site não aceita "todos" nem layout de bio
{
  const base = EMBUTIDOS[0];
  assert.equal(DefModelo.safeParse({ ...base, sub: "todos" }).success, false);
  assert.equal(DefModelo.safeParse({ ...base, layout: "galeria" }).success, false);
  assert.equal(DefModelo.safeParse({ ...base, paleta: { ...base.paleta, acc: "rosa" } }).success, false);
  // kit: só pasta de /assets, sem "..", sem maiúscula nem aspas (vai para caminho e HTML)
  assert.ok(EMBUTIDOS.every((m) => DefModelo.safeParse(m).success), "todos os embutidos passam no esquema");
  for (const kit of ["/assets/../x", "/assets/beleza/../../y", "/assets/Beleza/x", "/assets/x\"><b>", "/x/assets/y", "/assets/", "/assets/a b"])
    assert.equal(DefModelo.safeParse({ ...base, kit }).success, false, kit);
  assert.ok(DefModelo.safeParse({ ...base, kit: "/assets/saude/odonto-consulta" }).success);
  // leitura tolerante: fonte e ramo que saíram do código não derrubam o modelo
  const lido = DefModeloLida.safeParse({ ...base, fonte: "Sumiu", sub: "ramo-velho" });
  assert.ok(lido.success && lido.data.fonte === undefined && lido.data.sub === "ramo-velho");
  // nichos ativos: beleza e saúde (e a bio "todos"); pet fica fora das listas
  assert.deepEqual([doNichoAtivo("salao"), doNichoAtivo("odonto"), doNichoAtivo("todos"), doNichoAtivo("petshop"), doNichoAtivo("x")], [true, true, true, false, false]);
  assert.deepEqual(ConfigModelos.parse({}), CONFIG_VAZIA);
  console.log("esquemas: ok");
}

// resolver: negócio > padrão > legado; cliente congelado; prospecção segue a publicada
{
  const v1 = EMBUTIDOS.find((m) => m.id === "cabeleireira-1")!;
  const v2 = { ...v1, paleta: { ...v1.paleta, acc: "#0E6E68" } };
  const outro = EMBUTIDOS.find((m) => m.id === "cabeleireira-2")!;
  const catalogo: Catalogo = new Map([
    ["cabeleireira-1", { publicado: v2, versao: 2, versoes: { 1: v1, 2: v2 } }],
    ["cabeleireira-2", { publicado: outro, versao: 1 }],
  ]);
  const config = { ...CONFIG_VAZIA, padroes: { site: { salao: "cabeleireira-2" }, bio: {} } };
  const prospect = { sub: "salao" };

  // sem nada: caminho de hoje
  assert.equal(resolverModelo({ gerado: prospect }, catalogo, CONFIG_VAZIA, "site").origem, "legado");
  // padrão do ramo
  const p = resolverModelo({ gerado: prospect }, catalogo, config, "site");
  assert.equal(p.origem, "padrao");
  assert.equal(p.def?.id, "cabeleireira-2");
  // o negócio vence o padrão; versao null segue a publicada
  const n = resolverModelo({ gerado: { ...prospect, modelo: { id: "cabeleireira-1", versao: null } } }, catalogo, config, "site");
  assert.deepEqual([n.origem, n.versao, n.def?.paleta.acc], ["negocio", 2, "#0E6E68"]);
  // cliente com versão 1 fica na 1 mesmo com a 2 publicada
  const c = resolverModelo({ gerado: { ...prospect, modelo: { id: "cabeleireira-1", versao: 1 } }, crmEstagio: "fechado" }, catalogo, config, "site");
  assert.deepEqual([c.origem, c.versao, c.def?.paleta.acc], ["negocio", 1, "#E58F9C"]);
  // cliente sem modelo não segue o padrão do ramo
  assert.equal(resolverModelo({ gerado: { ...prospect, origem: "cadastro" } }, catalogo, config, "site").origem, "legado");
  // modelo que sumiu do catálogo cai no padrão; desligado continua valendo para quem usa
  assert.equal(resolverModelo({ gerado: { ...prospect, modelo: { id: "apagado", versao: null } } }, catalogo, config, "site").origem, "padrao");
  catalogo.set("cabeleireira-2", { publicado: { ...outro, ativo: false }, versao: 1 });
  assert.equal(resolverModelo({ gerado: { ...prospect, modelo: { id: "cabeleireira-2", versao: 1 } } }, catalogo, config, "site").def?.id, "cabeleireira-2");
  // versão congelada sem foto: a publicada
  assert.equal(resolverModelo({ gerado: { ...prospect, modelo: { id: "cabeleireira-2", versao: 7 } } }, catalogo, config, "site").versao, 1);
  // escolha manual da gaveta antiga: vence o padrão do ramo e segue a publicada
  const e = resolverModelo({ gerado: { ...prospect, escolha: { modelo: "cabeleireira-1" } } }, catalogo, config, "site");
  assert.deepEqual([e.origem, e.versao, e.def?.id, e.def?.paleta.acc], ["negocio", 2, "cabeleireira-1", "#0E6E68"]);
  // escolha que não está no catálogo: caminho de hoje, nunca o padrão
  assert.equal(resolverModelo({ gerado: { ...prospect, escolha: { modelo: "sumiu" } } }, catalogo, config, "site").origem, "legado");
  // gerado.modelo vence a escolha
  assert.equal(resolverModelo({ gerado: { ...prospect, modelo: { id: "cabeleireira-2", versao: 1 }, escolha: { modelo: "cabeleireira-1" } } }, catalogo, config, "site").def?.id, "cabeleireira-2");
  // bio: a escolha é de site (outro tipo), então a bio de sempre, e não o padrão "todos"
  catalogo.set("bio-clara", { publicado: EMBUTIDOS.find((m) => m.id === "bio-clara")!, versao: 1 });
  const cfgBio = { ...config, padroes: { site: {}, bio: { todos: "bio-clara" } } };
  assert.equal(resolverModelo({ gerado: { ...prospect, escolha: { modelo: "cabeleireira-1" } } }, catalogo, cfgBio, "bio").origem, "legado");
  assert.equal(resolverModelo({ gerado: prospect }, catalogo, cfgBio, "bio").def?.id, "bio-clara");
  // bio: padrão "todos" vale para qualquer ramo
  catalogo.set("bio-atual", { publicado: EMBUTIDOS.find((m) => m.id === "bio-atual")!, versao: 0 });
  const b = resolverModelo({ gerado: prospect }, catalogo, { ...config, padroes: { site: {}, bio: { todos: "bio-atual" } } }, "bio");
  assert.equal(b.def?.id, "bio-atual");

  assert.equal(ehClienteAtivo({}, "fechado"), true);
  assert.equal(ehClienteAtivo({ origem: "cadastro" }, "novo"), true);
  assert.equal(ehClienteAtivo({ origem: "prospeccao" }, "negociando"), false);
  assert.equal(ehClienteAtivo({ origem: "prospeccao" }, "negociando", true), true, "convite aceito");
  assert.equal(ehClienteAtivo({ origem: "prospeccao", publicadoEm: new Date() }, "negociando"), true, "site publicado");
  console.log("resolver: ok");
}

// checagem: contraste WCAG, mínimo de fotos, peso, nome longo, sem avaliações
{
  assert.ok(contraste("#E58F9C", "#FFFFFF") < 3);
  assert.ok(contraste("#0E6E68", "#FFFFFF") >= 4.5);
  assert.equal(contraste("#000000", "#FFFFFF").toFixed(0), "21");

  const rosa = EMBUTIDOS.find((m) => m.id === "cabeleireira-1")!;
  assert.equal(checar(rosa).find((a) => a.titulo === "Contraste do botão")?.nivel, "erro");
  const petroleo = { ...rosa, paleta: { ...rosa.paleta, acc: "#0E6E68" } };
  assert.equal(checar(petroleo).find((a) => a.titulo === "Contraste do botão")?.nivel, "ok");

  const galeria = { ...rosa, id: "bio-galeria-x", tipo: "bio" as const, layout: "galeria" as const };
  assert.ok(checar(galeria, { fotos: 2 }).some((a) => a.titulo === "Poucas fotos"));
  assert.ok(!checar(galeria, { fotos: 4 }).some((a) => a.titulo === "Poucas fotos"));
  assert.ok(checar(galeria).some((a) => a.titulo === "Página pesada"));

  const cartaz = { ...galeria, layout: "cartaz" as const };
  assert.ok(checar(cartaz, { nome: "Studio de Beleza Maria Aparecida dos Santos" }).some((a) => a.titulo === "Nome longo"));
  assert.ok(!checar(cartaz, { nome: "Studio Maria" }).some((a) => a.titulo === "Nome longo"));
  const stories = { ...galeria, layout: "stories" as const };
  assert.ok(checar(stories, { avaliacoes: 0 }).some((a) => a.titulo === "Sem avaliações"));
  assert.ok(checar({ ...galeria, layout: "vidro" }).some((a) => a.titulo === "Celular simples"));
  console.log("checagem: ok");
}

// render por valor (def) = render por índice (escolha), para todo embutido de site: é o que deixa
// trocar gerado.escolha por gerado.modelo sem mudar nenhum site
{
  const escolhaDe = (id: string, sub: Sub): Escolha =>
    MODELOS.find((m) => m.id === id)?.escolha ?? modelosClaro(sub).find((m) => m.id === id)!.escolha;
  const dados = (sub: Sub, extra: Partial<DadosSite>): DadosSite => ({
    slug: "casa-exemplo", nome: "Casa Exemplo", telefone: "5585999990000", sub, tipo: SUBS[sub].tipo, variantes: true,
    endereco: "Rua Exemplo, 100", bairro: "Centro", cidade: "Fortaleza", uf: "CE", nota: 4.8, avaliacoes: 127, instagram: "",
    horario: "Seg a Sex 8h–19h", servicos: [], consultado: "novembro de 2026", origem: "prospeccao", publicado: false, dominio: null, ...extra,
  });
  const render = (d: DadosSite) => (ehClaro(d.sub) ? renderClaro(d) : renderEditorial(d));
  const personal = { cores: { acc: "#7a2244" }, fonte: "Italiana" as const, fotos: { ga1: "fotos/ga1.jpg" as const }, versao: 7 };
  const diferentes: string[] = [];
  const site = EMBUTIDOS.filter((m) => m.tipo === "site");
  for (const def of site) {
    const sub = def.sub as Sub;
    const escolha = escolhaDe(def.id, sub);
    // def vence uma escolha qualquer gravada; personal continua por cima
    if (render(dados(sub, { escolha })) !== render(dados(sub, { def, escolha: { kit: 0, cor: 0 } }))) diferentes.push(def.id);
    if (render(dados(sub, { escolha, personal })) !== render(dados(sub, { def, personal }))) diferentes.push(`${def.id}+personal`);
  }
  assert.deepEqual(diferentes, [], "render por def difere do render por escolha");
  // claro com paleta fora do código: ink/acc entram como cor própria; fonte por valor
  const odonto = site.find((m) => m.id === "odonto-1")!;
  const nova = visualClaro("x", "odonto", undefined, null, { ...odonto, paleta: { ...odonto.paleta, ink: "#112233", acc: "#ffcc00" }, fonte: "Italiana" });
  assert.deepEqual([nova.cor, nova.gold, nova.fonte?.[0]], ["#112233", "#ffcc00", "Italiana"]);
  assert.ok(nova.paleta[1].includes("--accent:#112233"), "vale também no tema escuro");
  console.log(`def = escolha: ok (${site.length} modelos de site, com e sem personal)`);
}
