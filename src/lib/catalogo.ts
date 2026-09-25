// Catálogo de agendamento e telefone: o que o seed-agenda lia do HTML e o gerador
// de sites lê da planilha. Um lugar só, para a agenda de um site importado e a de
// um site gerado darem o mesmo preço ao mesmo serviço. Sem "server-only": a prévia
// do gerador roda no navegador.

// duração (min) e preço (R$) típicos por tipo de serviço; a primeira regra que casar vence
export const TABELA: [RegExp, number, number][] = [
  [/or[çc]amento/i, 30, 0], // conversa com o artista: não se cobra
  [/fine ?line|blackwork|cobertura de tatu|reforma de tatu|tatuagem autoral/i, 120, 250],
  [/banho de gel|banho em gel/i, 60, 70], // unha, não pet
  [/banho\s*(e|\+)\s*tosa|tosa\s*(e|\+)\s*banho/i, 120, 100],
  [/tosa|grooming/i, 90, 80],
  [/banho/i, 60, 60],
  [/vacina/i, 20, 90],
  [/consulta|clínic|clinic|veterin|check-?up|avalia/i, 40, 120],
  [/exame|laborat|ultrassom|raio-?x/i, 30, 150],
  [/castra|cirurg/i, 60, 400],
  [/corte\s*(e|\+)\s*barba|combo/i, 75, 70],
  [/barba|navalha/i, 30, 35],
  [/corte|cabelo|degrad|máquina/i, 45, 45],
  [/progressiva|alisa|selage|botox|relaxa/i, 180, 250],
  [/colora|mecha|luzes|tintura|loiro|platina/i, 150, 220],
  [/escova|finaliza|penteado|chapinha/i, 45, 50],
  [/hidrata|cronograma|tratamento capilar|cauteriza/i, 60, 90],
  [/tranç|dread|nagô|box braid/i, 180, 200],
  [/alongamento|fibra|gel|postiç/i, 120, 150],
  [/manicure|esmalta|unha|nail/i, 45, 35],
  [/pedicure|spa dos pés|podolog/i, 60, 50],
  // micropigmentação ANTES de sobrancelha: a regra de sobrancelha capturava "micropigmentação"
  // e anunciava 30min/R$40 num procedimento de horas e centenas de reais — erro de 10x no
  // preço que aparece na bio do cliente. Valores de mercado; confirme com cada profissional.
  [/micropigment|microblading|nanoblading|fio a fio|dermopigment/i, 120, 450],
  [/sobrancelha|henna|design/i, 30, 40],
  [/cíli|cili|lash|extens/i, 120, 150],
  [/depila|cera|laser/i, 45, 70],
  [/limpeza de pele|peeling|facial|skin/i, 60, 120],
  [/massagem|massot|relaxa|drenagem|spa/i, 60, 120],
  [/maquiagem|make/i, 60, 100],
  [/tatua|tattoo|piercing/i, 120, 250],
  [/microagulha|preenchi|toxina|harmoniza|estétic/i, 60, 200],
];

// quando não há serviço agendável listado, o catálogo sai do ramo do negócio
export const PADRAO: [RegExp, string[]][] = [
  [/veterin|clínica animal|clinica veterin|hospital veterin/i, ["Consulta veterinária", "Vacinação", "Banho e tosa"]],
  [/pet ?shop|petshop|agropet|banho e tosa|ração|racao|animal/i, ["Banho", "Tosa", "Banho e tosa"]],
  [/barbearia|barber|barbeiro/i, ["Corte", "Barba", "Corte + barba"]],
  [/tattoo|tatuagem|piercing/i, ["Tatuagem autoral", "Fine line", "Blackwork", "Cobertura de tatuagem", "Orçamento"]],
  [/nail|esmalteria|manicure|unhas/i, ["Manicure", "Pedicure", "Alongamento em gel"]],
  [/podolog/i, ["Podologia"]],
  [/depila|laser/i, ["Depilação a laser", "Avaliação"]],
  [/massag|massot|spa|terapi/i, ["Massagem relaxante", "Drenagem linfática"]],
  [/sobrancelha|cíli|cili|lash|micropigment/i, ["Design de sobrancelha", "Extensão de cílios"]],
  [/cabelei|cabelo|hair|mechas|cachos|tranç|escova|salão|salao/i, ["Corte", "Escova", "Coloração", "Hidratação"]],
  [/estétic|estetic|beleza|pele|dermat|clínic|clinic/i, ["Limpeza de pele", "Avaliação estética"]],
];

/** Serviços pelo ramo, lido de um texto livre (título, categoria, nome do negócio). */
export function porRamo(texto: string) {
  const achado = PADRAO.find(([re]) => re.test(texto));
  return (achado ? achado[1] : ["Atendimento"]).map(montar);
}

export function montar(name: string) {
  const regra = TABELA.find(([re]) => re.test(name));
  return {
    id: idDe(name),
    name,
    durationMin: regra ? regra[1] : 60,
    priceCents: (regra ? regra[2] : 80) * 100,
    active: true,
  };
}

export const idDe = (nome: string) =>
  nome.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "servico";

// um profissional por tenant: a casa atende de segunda a sábado
export const EQUIPE = {
  name: "Equipe",
  hours: { "1": h(), "2": h(), "3": h(), "4": h(), "5": h(), "6": { start: "09:00", end: "17:00" } },
  active: true,
};
function h() {
  return { start: "09:00", end: "19:00" };
}

export const RUPHUS = "5511948680554";

/** Só dígitos com DDI, pelo tamanho — 55 também é DDD, então prefixo não decide. */
export function normalizar(bruto: string) {
  const d = bruto.replace(/\D/g, "");
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d;
  // 15 dígitos = DDI dobrado na importação (55 + 5592…)
  if (d.length === 15 && d.startsWith("5555")) return d.slice(2);
  return "";
}
