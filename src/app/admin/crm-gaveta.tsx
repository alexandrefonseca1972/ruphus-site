"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useState } from "react";
import { cents } from "@/lib/dinheiro";
import { formatBRL, formatPhone, linkWhatsApp } from "@/lib/datetime";
import type { ClienteSaude } from "@/lib/saude.server";
import { ROTULO_SAUDE } from "@/lib/saude";
import { diaCurto, MOTIVOS_PERDA, ORIGENS, PRECO_PADRAO, type Crm, type Evento, type MotivoPerda, type Origem } from "@/lib/crm-tipos";

// Partes da gaveta do negócio que formam o CRM: quem decide, o que dizer a ele,
// o que já aconteceu e por que se perdeu. Fora de page.tsx, que já passa de mil linhas.

const BOTAO = "inline-flex h-11 items-center justify-center gap-2 rounded-[10px] px-4 text-[13px] font-semibold transition-colors";
const BOTAO_CLARO = `${BOTAO} border border-[#D8D2C6] bg-white text-[#17150F] hover:border-[#17150F]`;
const BOTAO_VERDE = `${BOTAO} bg-[#2C6A53] text-white hover:bg-[#245743]`;
const CAMPO = "h-11 w-full min-w-0 rounded-[10px] border border-[#D8D2C6] bg-white px-3 text-sm text-[#17150F] outline-none focus:border-[#17150F]";
const ROTULO_CAMPO = "flex flex-col gap-1 text-xs text-[#6F6A5E]";

const Zap = () => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.9-.9L3 20.5l1.6-4.9A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z" />
  </svg>
);

type Negocio = { slug: string; nome: string; telefone: string | null };

/** Quem decide. O telefone do site é o da recepção: proposta e cobrança vão para o dono. */
export function ContatoDono({ negocio, crm, salvar }: { negocio: Negocio; crm: Crm; salvar: (dados: Partial<Crm>) => void }) {
  const [zap, setZap] = useState(crm.donoWhatsapp ? formatPhone(crm.donoWhatsapp) : "");
  const [email, setEmail] = useState(crm.donoEmail ?? "");
  const erroEmail = email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "E-mail incompleto" : "";
  const digitos = zap.replace(/\D/g, "");
  const erroZap = digitos && (digitos.length < 10 || digitos.length > 11) ? "Número com DDD: 10 ou 11 dígitos" : "";
  const link = crm.donoWhatsapp && linkWhatsApp(crm.donoWhatsapp, `Olá${crm.donoNome ? `, ${crm.donoNome.split(" ")[0]}` : ""}!`);

  return (
    <section aria-labelledby="contato-t" className="flex flex-col gap-3.5 rounded-2xl border border-[#E2DDD3] p-4">
      <div className="flex items-center justify-between gap-3">
        <h3 id="contato-t" className="text-[15px] font-semibold">Contato do dono</h3>
        {link && (
          <a href={link} target="_blank" rel="noreferrer" className={BOTAO_VERDE}>
            <Zap /> WhatsApp
          </a>
        )}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_9rem] gap-3">
        <label className={ROTULO_CAMPO}>
          Nome do dono
          <input
            defaultValue={crm.donoNome ?? ""}
            maxLength={80}
            placeholder="Quem decide"
            onBlur={(e) => salvar({ donoNome: e.target.value.trim() || null })}
            className={CAMPO}
          />
        </label>
        <label className={ROTULO_CAMPO}>
          Quem é
          <input
            defaultValue={crm.donoPapel ?? ""}
            maxLength={40}
            placeholder="dona, sócio…"
            onBlur={(e) => salvar({ donoPapel: e.target.value.trim() || null })}
            className={CAMPO}
          />
        </label>
      </div>
      <label className={ROTULO_CAMPO}>
        WhatsApp do dono
        <input
          type="tel"
          inputMode="tel"
          value={zap}
          placeholder="(92) 99999-9999"
          aria-invalid={!!erroZap}
          onChange={(e) => setZap(formatPhone(e.target.value))}
          onBlur={() => !erroZap && salvar({ donoWhatsapp: digitos || null })}
          className={`${CAMPO} tabular-nums ${erroZap ? "border-[#8A2F2F]" : ""}`}
        />
        <span className={erroZap ? "text-[#8A2F2F]" : ""}>{erroZap || "Proposta e cobrança vão para este número, não para o da recepção."}</span>
      </label>
      <label className={ROTULO_CAMPO}>
        E-mail
        <input
          type="email"
          value={email}
          placeholder="nome@exemplo.com"
          aria-invalid={!!erroEmail}
          onChange={(e) => setEmail(e.target.value.trim())}
          onBlur={() => !erroEmail && salvar({ donoEmail: email || null })}
          className={`${CAMPO} ${erroEmail ? "border-[#8A2F2F]" : ""}`}
        />
        {erroEmail && <span className="text-[#8A2F2F]">{erroEmail}</span>}
      </label>
      {negocio.telefone && (
        <p className="rounded-[10px] bg-[#FBFAF8] px-3 py-2.5 text-xs text-[#6F6A5E]">Telefone do site (recepção): {formatPhone(negocio.telefone)}</p>
      )}
    </section>
  );
}

/** Como o contato chegou: alimenta o quadro "De onde vêm os clientes" do funil. */
export function OrigemDoContato({ crm, salvar }: { crm: Crm; salvar: (dados: Partial<Crm>) => void }) {
  const atual = crm.origem ?? "importado";
  return (
    <section aria-labelledby="origem-t" className="flex flex-col gap-3 rounded-2xl border border-[#E2DDD3] p-4">
      <h3 id="origem-t" className="text-[15px] font-semibold">Como chegou</h3>
      <div role="group" aria-labelledby="origem-t" className="flex flex-wrap gap-2">
        {(Object.keys(ORIGENS) as Origem[]).map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={atual === o}
            onClick={() => salvar({ origem: o, ...(o !== "indicacao" && { indicadoPor: null }) })}
            className={`h-9 rounded-full border px-3 text-xs font-semibold ${atual === o ? "border-[#17150F] bg-[#17150F] text-white" : "border-[#D8D2C6] bg-white hover:border-[#17150F]"}`}
          >
            {ORIGENS[o]}
          </button>
        ))}
      </div>
      {atual === "indicacao" && (
        <label className={ROTULO_CAMPO}>
          Quem indicou (opcional)
          <input
            defaultValue={crm.indicadoPor ?? ""}
            maxLength={80}
            placeholder="nome do cliente ou parceiro"
            onBlur={(e) => salvar({ indicadoPor: e.target.value.trim() || null })}
            className={CAMPO}
          />
        </label>
      )}
    </section>
  );
}

/** Manter no topo da lista por alguns dias: o que foi prometido para esta semana. */
const PRAZOS = [
  { rotulo: "Hoje", dias: 0 },
  { rotulo: "3 dias", dias: 3 },
  { rotulo: "7 dias", dias: 7 },
] as const;

// meio-dia para o fuso não empurrar a data um dia para trás
const maisDias = (hoje: string, dias: number) => {
  const d = new Date(`${hoje}T12:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toLocaleDateString("sv-SE");
};

export function Destaque({ crm, hoje, salvar }: { crm: Crm; hoje: string; salvar: (dados: Partial<Crm>) => void }) {
  const ate = crm.fixadoAte && crm.fixadoAte >= hoje ? crm.fixadoAte : null;
  return (
    <section aria-labelledby="destaque-t" className="flex flex-col gap-2.5 rounded-2xl border border-[#E2DDD3] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="destaque-t" className="text-[15px] font-semibold">Manter em destaque</h3>
        <span className="truncate text-xs text-[#6F6A5E]">
          {ate ? (ate === hoje ? "até o fim do dia" : `até ${diaCurto(ate)}`) : "fora do destaque"}
        </span>
      </div>
      <div role="group" aria-labelledby="destaque-t" className="flex flex-wrap gap-2">
        {PRAZOS.map((p) => {
          const data = maisDias(hoje, p.dias);
          const ativo = ate === data;
          return (
            <button
              key={p.rotulo}
              type="button"
              aria-pressed={ativo}
              onClick={() => salvar({ fixadoAte: ativo ? null : data })}
              className={`h-11 rounded-full border px-3.5 text-xs font-semibold ${ativo ? "border-[#17150F] bg-[#17150F] text-white" : "border-[#D8D2C6] bg-white hover:border-[#17150F]"}`}
            >
              {p.rotulo}
            </button>
          );
        })}
        {ate && (
          <button type="button" onClick={() => salvar({ fixadoAte: null })} className="h-11 rounded-full border border-[#D8D2C6] bg-white px-3.5 text-xs text-[#6F6A5E] hover:border-[#17150F] hover:text-[#17150F]">
            Tirar
          </button>
        )}
      </div>
      <p className="text-xs text-[#6F6A5E]">Enquanto durar, o negócio fica no topo da lista e aparece na visão &quot;Em destaque&quot;.</p>
    </section>
  );
}

const MODELOS = ["Primeiro contato", "Lembrete", "Última tentativa", "Proposta", "Boas-vindas"] as const;
type Modelo = (typeof MODELOS)[number];

/** Quem assina as mensagens: definido uma vez pelo admin da plataforma (config/crm). */
export const MARCA_NOME = "[SEU NOME]";

/** Quando enviar cada toque, do jeito que o playbook manda: poucos, e com saída. */
const QUANDO: Record<Modelo, string> = {
  "Primeiro contato": "dia 0 · em horário comercial",
  Lembrete: "2 a 3 dias depois, com ângulo novo",
  "Última tentativa": "10 dias depois; sem resposta, pare por aqui",
  Proposta: "só depois do sim",
  "Boas-vindas": "ao fechar",
};

export function mensagem(modelo: Modelo, negocio: Negocio, crm: Crm, vendedor?: string) {
  const quem = vendedor?.trim() || MARCA_NOME;
  const oi = `Oi${crm.donoNome ? `, ${crm.donoNome.split(" ")[0]}` : ""}! Aqui é o ${quem}, da Ruphus.`;
  const site = `${negocio.slug}.ruphus.site`;
  const entrada = formatBRL(crm.entradaCents ?? PRECO_PADRAO.entradaCents);
  const mensal = formatBRL(crm.mensalCents ?? PRECO_PADRAO.mensalCents);
  const comoChegou = crm.origem === "indicacao" && crm.indicadoPor ? `${crm.indicadoPor} me passou seu contato.` : "Achei o seu perfil procurando negócios da região.";
  switch (modelo) {
    // Curta, sem link e sem preço, com saída no fim: é o que responde e é o que a
    // Meta exige de quem manda mensagem não pedida. O link vai depois do sim.
    case "Primeiro contato":
      return `${oi} ${comoChegou}\n\nMontei a agenda online do ${negocio.nome} e queria te mostrar: o cliente escolhe um horário livre e marca sozinho, sem tirar você do atendimento.\n\nPosso te mandar a prévia? Se não fizer sentido, me avisa que eu tiro.`;
    case "Lembrete":
      return `${oi}\n\nUma coisa que costuma pesar: cliente que manda mensagem de noite e fica sem resposta até o dia seguinte. Com a agenda no ar ele marca na hora, sozinho.\n\nQuer ver como ficaria com os seus serviços?`;
    case "Última tentativa":
      return `${oi}\n\nImagino que a correria esteja grande, então não vou insistir.\n\nDeixo a agenda do ${negocio.nome} guardada aqui por enquanto. Se quiser ver depois, é só me chamar que eu abro para você.`;
    case "Proposta":
      return `${oi}\n\nComo combinamos, a agenda do ${negocio.nome} está no ar: ${site}\n\nCada profissional com o horário dele, os serviços com preço e duração, a ficha de cada cliente e o link para a bio do Instagram.\n\n${entrada} para publicar e ${mensal} por mês, com implantação e manutenção. Sem instalar nada e sem taxa por agendamento.\n\nLibero seu acesso hoje para você testar com um cliente de verdade?`;
    case "Boas-vindas":
      return `${oi}\n\nQue bom ter você com a gente! A agenda do ${negocio.nome} já está recebendo marcação em ${site}.\n\nEm 10 minutos deixamos tudo pronto:\n1) seus serviços, com preço e duração\n2) quem atende e o horário de cada um\n3) o link na bio do Instagram e no WhatsApp\n\nMe chama aqui que eu faço junto com você.`;
  }
}

/** As objeções que mais aparecem, com a resposta que não promete o que o produto não faz. */
const OBJECOES = [
  {
    q: "Já tenho Instagram.",
    a: "A agenda não substitui o Instagram. O Instagram faz o cliente te descobrir; a agenda transforma isso em horário marcado, sem você parar para responder cada mensagem.",
  },
  {
    q: "Está caro.",
    a: "Faz sentido olhar o retorno. Qual é o seu ticket médio? Com poucos atendimentos no mês a mensalidade já se paga — e o horário que deixa de ser perdido no WhatsApp entra nessa conta.",
  },
  {
    q: "Vou pensar.",
    a: "Claro. Só para eu te ajudar melhor: o que você quer avaliar — o valor, como fica na prática ou se a sua equipe vai usar?",
  },
  {
    q: "Manda os valores.",
    a: "Mando agora. Só me diz antes quantos profissionais atendem aí, para eu te passar já do jeito certo.",
  },
  {
    q: "Quem fez essa página?",
    a: "Fui eu. Montei com o que está público no seu perfil, justamente para você ver funcionando antes de decidir. Nada vai ao ar no seu nome sem a sua autorização.",
  },
] as const;

/** Respostas prontas para o que o dono pergunta de volta. */
export function Objecoes({ onCopiar }: { onCopiar: (texto: string) => void }) {
  return (
    <section aria-labelledby="obj-t" className="flex flex-col gap-2 rounded-2xl border border-[#E2DDD3] p-4">
      <h3 id="obj-t" className="text-[15px] font-semibold">Se ele responder isso</h3>
      {OBJECOES.map((o) => (
        <details key={o.q} className="group border-t border-[#EDEAE0] pt-2 first:border-0 first:pt-0">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 text-[13px] font-semibold">
            {o.q}
            <span aria-hidden="true" className="text-[#6F6A5E] group-open:rotate-180">⌄</span>
          </summary>
          <p className="pt-1 text-[12.5px] leading-relaxed text-[#4A4639]">{o.a}</p>
          <button type="button" onClick={() => onCopiar(o.a)} className="mt-2 h-9 rounded-[8px] border border-[#D8D2C6] bg-white px-2.5 text-xs hover:border-[#17150F]">
            Copiar resposta
          </button>
        </details>
      ))}
    </section>
  );
}

/** Mensagens prontas por etapa, com nome, site e valores do cadastro. */
export function MensagensProntas({
  negocio,
  crm,
  assinatura,
  onEnviar,
  onCopiar,
}: {
  negocio: Negocio;
  crm: Crm;
  assinatura: string;
  onEnviar: (modelo: Modelo, para: string) => void;
  onCopiar: (texto: string) => void;
}) {
  const [modelo, setModelo] = useState<Modelo>(crm.estagio === "fechado" ? "Boas-vindas" : crm.estagio === "novo" ? "Primeiro contato" : "Proposta");
  const [texto, setTexto] = useState<{ para: Modelo; valor: string } | null>(null);
  const atual = texto?.para === modelo ? texto.valor : mensagem(modelo, negocio, crm, assinatura);
  const numero = crm.donoWhatsapp ?? negocio.telefone;
  // Mandar "[SEU NOME]" para o cliente é pior do que não mandar nada
  const faltaNome = atual.includes(MARCA_NOME);
  const link = numero && !faltaNome ? linkWhatsApp(numero, atual) : null;

  return (
    <section aria-labelledby="msg-t" className="flex flex-col gap-3 rounded-2xl border border-[#E2DDD3] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="msg-t" className="text-[15px] font-semibold">Mensagens prontas</h3>
        <span className="truncate text-xs text-[#6F6A5E]">
          {crm.donoWhatsapp ? `para ${crm.donoNome?.split(" ")[0] ?? "o dono"}` : numero ? "para a recepção" : "sem telefone"}
        </span>
      </div>
      <div role="group" aria-label="Modelo" className="flex flex-wrap gap-2">
        {MODELOS.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={modelo === m}
            onClick={() => setModelo(m)}
            className={`h-9 rounded-full border px-3 text-xs font-semibold ${modelo === m ? "border-[#17150F] bg-[#17150F] text-white" : "border-[#D8D2C6] bg-white hover:border-[#17150F]"}`}
          >
            {m}
          </button>
        ))}
      </div>
      <p className="text-xs text-[#6F6A5E]">Quando mandar: {QUANDO[modelo]}.</p>
      {faltaNome && (
        <p className="rounded-[10px] bg-[#F7EFEF] px-3 py-2.5 text-xs text-[#8A2F2F]">
          Ninguém assina as mensagens ainda: defina o nome em &quot;Quem assina&quot;, no topo do painel.
        </p>
      )}
      <label className="sr-only" htmlFor="msg-texto">Texto da mensagem</label>
      <textarea
        id="msg-texto"
        value={atual}
        onChange={(e) => setTexto({ para: modelo, valor: e.target.value })}
        rows={7}
        className="w-full resize-y rounded-xl border border-[#E2DDD3] bg-[#FBFAF8] p-3 text-[12.5px] leading-relaxed text-[#17150F] outline-none focus:border-[#17150F]"
      />
      <div className="flex gap-2">
        {link ? (
          <a href={link} target="_blank" rel="noreferrer" onClick={() => onEnviar(modelo, crm.donoNome ?? (crm.donoWhatsapp ? "o dono" : "a recepção"))} className={`${BOTAO_VERDE} grow`}>
            <Zap /> Abrir no WhatsApp
          </a>
        ) : (
          <span className={`${BOTAO} grow border border-dashed border-[#D8D2C6] text-[#8B8578]`}>
            {faltaNome ? "Defina quem assina, no topo" : "Cadastre o WhatsApp do dono"}
          </span>
        )}
        <button type="button" disabled={faltaNome} onClick={() => onCopiar(atual)} className={`${BOTAO_CLARO} disabled:cursor-not-allowed disabled:opacity-50`}>
          Copiar
        </button>
      </div>
    </section>
  );
}

const FILTROS = {
  tudo: "Tudo",
  nota: "Notas",
  estagio: "Estágio",
  mensagem: "Mensagens",
  cobranca: "Cobrança",
} as const;
type Filtro = keyof typeof FILTROS;
const DO_FILTRO: Record<Filtro, Evento["tipo"][]> = {
  tudo: [],
  nota: ["nota"],
  estagio: ["estagio"],
  mensagem: ["mensagem"],
  cobranca: ["cobranca", "pagamento"],
};

const ESTILO: Record<Evento["tipo"], { cor: string; icone: React.ReactNode }> = {
  nota: { cor: "bg-[#EFEBE2] text-[#17150F]", icone: <path d="M4 20h4L19 9l-4-4L4 16z" /> },
  estagio: { cor: "bg-[#FBF3DC] text-[#7A5A2E]", icone: <path d="M5 12h14M13 6l6 6-6 6" /> },
  mensagem: { cor: "bg-[#E7EEE9] text-[#2C6A53]", icone: <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 8.5 8.5 0 0 1-3.9-.9L3 20.5l1.6-4.9A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5z" /> },
  convite: { cor: "bg-[#E7EEE9] text-[#2C6A53]", icone: <><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M17 6l3 3" /></> },
  agendamento: { cor: "bg-[#E7EEE9] text-[#2C6A53]", icone: <><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></> },
  cobranca: { cor: "bg-[#EFEBE2] text-[#17150F]", icone: <path d="M12 3l9 9-9 9-9-9z" /> },
  pagamento: { cor: "bg-[#E7EEE9] text-[#2C6A53]", icone: <path d="M5 12l5 5 9-10" /> },
};

const quando = (iso: string) => {
  const d = new Date(iso);
  const hoje = new Date();
  const ontem = new Date(hoje.getTime() - 86_400_000);
  const hora = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === hoje.toDateString()) return `hoje, ${hora}`;
  if (d.toDateString() === ontem.toDateString()) return `ontem, ${hora}`;
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", ...(d.getFullYear() !== hoje.getFullYear() && { year: "2-digit" }), hour: "2-digit", minute: "2-digit" });
};

/** Tudo o que aconteceu com o negócio, com o campo de nota no topo. */
export function LinhaDoTempo({
  eventos,
  anotar,
  limite,
  onVerTudo,
}: {
  eventos: Evento[] | null;
  anotar: (texto: string) => void;
  /** Resumo na aba Venda: só os últimos, sem filtros, com "ver tudo" */
  limite?: number;
  onVerTudo?: () => void;
}) {
  const [filtro, setFiltro] = useState<Filtro>("tudo");
  const filtrada = eventos?.filter((e) => filtro === "tudo" || DO_FILTRO[filtro].includes(e.tipo)) ?? null;
  const lista = limite ? (filtrada?.slice(0, limite) ?? null) : filtrada;

  return (
    <section aria-labelledby={limite ? "linha-resumo-t" : "linha-t"} className="flex flex-col gap-3.5 rounded-2xl border border-[#E2DDD3] p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id={limite ? "linha-resumo-t" : "linha-t"} className="text-[15px] font-semibold">{limite ? "Últimos acontecimentos" : "Linha do tempo"}</h3>
        {limite && onVerTudo && eventos && eventos.length > limite ? (
          <button type="button" onClick={onVerTudo} className="min-h-9 text-xs font-semibold underline underline-offset-4">
            Ver os {eventos.length}
          </button>
        ) : (
          <span className="text-xs text-[#6F6A5E]">{eventos ? `${eventos.length} evento(s)` : "carregando…"}</span>
        )}
      </div>
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          const campo = ev.currentTarget.elements.namedItem("nota") as HTMLInputElement;
          if (!campo.value.trim()) return;
          anotar(campo.value.trim());
          campo.value = "";
        }}
        className="flex gap-2"
      >
        <label htmlFor={limite ? "nota-resumo" : "nota"} className="sr-only">Escrever nota</label>
        <input id={limite ? "nota-resumo" : "nota"} name="nota" maxLength={600} placeholder="O que foi dito hoje" className={`${CAMPO} grow`} />
        <button type="submit" className={`${BOTAO} bg-[#17150F] text-white hover:bg-[#2C2920]`}>Anotar</button>
      </form>
      {!limite && (
      <div role="group" aria-label="Filtrar a linha do tempo" className="flex flex-wrap gap-1.5">
        {(Object.keys(FILTROS) as Filtro[]).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filtro === f}
            onClick={() => setFiltro(f)}
            className={`h-8 rounded-full border px-2.5 text-[11px] font-semibold ${filtro === f ? "border-[#17150F] bg-[#17150F] text-white" : "border-[#D8D2C6] bg-white hover:border-[#17150F]"}`}
          >
            {FILTROS[f]}
          </button>
        ))}
      </div>
      )}
      {lista && lista.length === 0 && <p className="text-[13px] text-[#6F6A5E]">Nada por aqui ainda.</p>}
      {lista && lista.length > 0 && (
        <ol className="flex flex-col">
          {lista.map((e, i) => (
            <li key={e.id} className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-3 pb-4">
              {i < lista.length - 1 && <span aria-hidden="true" className="absolute top-9 bottom-0 left-4 w-px bg-[#E2DDD3]" />}
              <span className={`grid size-8 place-items-center rounded-full ${ESTILO[e.tipo].cor}`}>
                <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  {ESTILO[e.tipo].icone}
                </svg>
              </span>
              <div className="flex min-w-0 flex-col gap-0.5 pt-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[13px] font-semibold">{e.titulo}</span>
                  <time dateTime={e.quando} className="shrink-0 text-[11px] text-[#6F6A5E] tabular-nums">{quando(e.quando)}</time>
                </div>
                {e.detalhe && <p className="text-[12.5px] leading-relaxed whitespace-pre-line text-[#2D2A22]">{e.detalhe}</p>}
                {e.autor && <span className="truncate text-[11px] text-[#6F6A5E]">{e.autor}</span>}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Marcar como perdido pede o motivo: sem ele, a perda não ensina nada. */
export function MotivoDaPerda({
  nome,
  onConfirmar,
  onCancelar,
}: {
  nome: string;
  onConfirmar: (dados: { motivoPerda: MotivoPerda; detalhePerda: string | null; proximaData: string | null; proximaAcao: string | null }) => Promise<unknown> | void;
  onCancelar: () => void;
}) {
  const [motivo, setMotivo] = useState<MotivoPerda | null>(null);
  const [detalhe, setDetalhe] = useState("");
  const [volta, setVolta] = useState("");
  const [tentou, setTentou] = useState(false);
  const [busy, setBusy] = useState(false);

  return (
    <AlertDialog.Root open onOpenChange={(open) => !open && !busy && onCancelar()}>
      {/* dentro do #admin-raiz: é lá que moram as variáveis das fontes do painel */}
      <AlertDialog.Portal container={typeof document === "undefined" ? undefined : document.getElementById("admin-raiz")}>
        <AlertDialog.Backdrop className="fixed inset-0 z-[60] bg-[#17150F]/35" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-[70] flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-2xl bg-white p-6 font-[family-name:var(--fonte-mono)] text-[#17150F] shadow-2xl outline-none">
          <div className="flex flex-col gap-1">
            <AlertDialog.Title className="font-[family-name:var(--fonte-serifa)] text-[26px] leading-tight">Por que não fechou?</AlertDialog.Title>
            <AlertDialog.Description className="text-[12.5px] leading-relaxed text-[#6F6A5E]">
              {nome} sai do funil. O motivo entra na linha do tempo.
            </AlertDialog.Description>
          </div>
          <fieldset className="grid gap-2">
            <legend className="sr-only">Motivo</legend>
            {(Object.keys(MOTIVOS_PERDA) as MotivoPerda[]).map((m) => (
              <label
                key={m}
                className={`flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[10px] border px-3 text-[13px] ${motivo === m ? "border-[#17150F] bg-[#FBFAF8]" : "border-[#D8D2C6]"}`}
              >
                <input type="radio" name="motivo" checked={motivo === m} onChange={() => setMotivo(m)} className="size-4 accent-[#17150F]" />
                {MOTIVOS_PERDA[m]}
              </label>
            ))}
            {tentou && !motivo && <p role="alert" className="text-xs text-[#8A2F2F]">Escolha um motivo.</p>}
          </fieldset>
          <label className={ROTULO_CAMPO}>
            Detalhe (opcional)
            <input value={detalhe} maxLength={300} onChange={(e) => setDetalhe(e.target.value)} placeholder="o que foi dito" className={CAMPO} />
          </label>
          <label className={ROTULO_CAMPO}>
            Voltar a procurar em (opcional)
            <input type="date" value={volta} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setVolta(e.target.value)} className={CAMPO} />
            <span>Vira a próxima ação: o negócio reaparece em “Para hoje” nessa data.</span>
          </label>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" disabled={busy} onClick={onCancelar} className={BOTAO_CLARO}>
              Voltar
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setTentou(true);
                if (!motivo) return;
                setBusy(true);
                try {
                  await onConfirmar({
                    motivoPerda: motivo,
                    detalhePerda: detalhe.trim() || null,
                    proximaData: volta || null,
                    proximaAcao: volta ? "voltar a procurar" : null,
                  });
                } finally {
                  setBusy(false);
                }
              }}
              className={`${BOTAO} bg-[#8A2F2F] text-white hover:bg-[#742626] disabled:opacity-60`}
            >
              {busy ? "Salvando…" : "Marcar como perdido"}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

const PASSOS = [
  { id: "convite", titulo: "Convite aceito" },
  { id: "servicos", titulo: "Serviços cadastrados" },
  { id: "profissionais", titulo: "Profissionais cadastrados" },
  { id: "agendamento", titulo: "Primeiro agendamento" },
] as const;
export type Passo = (typeof PASSOS)[number]["id"];

const COR_SAUDE = { ok: "bg-[#E7EEE9] text-[#2C6A53]", atencao: "bg-[#FBF3DC] text-[#7A5A2E]", risco: "bg-[#F1E7E7] text-[#8A2F2F]" } as const;
export const SeloSaude = ({ saude }: { saude: ClienteSaude["saude"] }) => (
  <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap ${COR_SAUDE[saude]}`}>{ROTULO_SAUDE[saude]}</span>
);
const dataCurta = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : null);
const haQuanto = (iso: string | null) => {
  if (!iso) return "nunca";
  const d = Math.floor((Date.now() - Date.parse(iso)) / 86_400_000);
  return d <= 0 ? "hoje" : d === 1 ? "ontem" : `há ${d} dias`;
};

/** O cliente depois da venda: se terminou de implantar e se está usando. */
export function ImplantacaoESaude({ saude, lembrar }: { saude: ClienteSaude | null; lembrar: (passo: Passo) => void }) {
  if (!saude) return <p className="rounded-2xl border border-[#E2DDD3] p-4 text-[13px] text-[#6F6A5E]">Carregando implantação e saúde…</p>;
  const feitos = PASSOS.filter((p) => saude.passos[p.id]).length;
  const detalhe: Record<Passo, string> = {
    convite: saude.detalhes.convite ? `${saude.detalhes.convite} entrou no painel` : "o dono ainda não entrou",
    servicos: saude.detalhes.servicos ? `${saude.detalhes.servicos} serviço(s)` : "nenhum ainda",
    profissionais: saude.detalhes.profissionais ? `${saude.detalhes.profissionais} profissional(is)` : "nenhum ainda",
    agendamento: saude.detalhes.primeiro ? `em ${dataCurta(saude.detalhes.primeiro)}` : "ainda não recebeu",
  };
  const maior = Math.max(1, ...saude.semanas);
  const cobranca = { sem: "sem cobrança aberta", em_dia: "em dia", vence: `vence em ${saude.diasParaVencer} dia(s)`, atrasada: "atrasada" }[saude.cobranca];
  return (
    <>
      <section aria-labelledby="impl-t" className="flex flex-col gap-3 rounded-2xl border border-[#E2DDD3] p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 id="impl-t" className="text-[15px] font-semibold">Implantação</h3>
          <span className="text-xs text-[#6F6A5E]">{feitos} de 4</span>
        </div>
        <div role="progressbar" aria-label="Implantação" aria-valuenow={feitos} aria-valuemin={0} aria-valuemax={4} className="h-1.5 rounded-full bg-[#EFEBE2]">
          <div className="h-full rounded-full bg-[#2C6A53]" style={{ width: `${(feitos / 4) * 100}%` }} />
        </div>
        <ol className="flex flex-col">
          {PASSOS.map((p, i) => {
            const ok = saude.passos[p.id];
            return (
              <li key={p.id} className={`grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-3 py-2.5 ${i ? "border-t border-[#EFEBE3]" : ""}`}>
                <span className={`grid size-7 place-items-center rounded-full ${ok ? "bg-[#E7EEE9] text-[#2C6A53]" : "border-[1.5px] border-dashed border-[#D8D2C6]"}`}>
                  {ok && (
                    <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <path d="m5 12 5 5 9-10" />
                    </svg>
                  )}
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-[13px] font-semibold">
                    {p.titulo}
                    <span className="sr-only">{ok ? ": feito" : ": falta"}</span>
                  </span>
                  <span className="truncate text-[11px] text-[#6F6A5E]">{detalhe[p.id]}</span>
                </span>
                {!ok && (
                  <button type="button" onClick={() => lembrar(p.id)} className={`${BOTAO_VERDE} h-9 px-3 text-xs`}>
                    <Zap /> Lembrar
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      <section aria-labelledby="saude-t" className="flex flex-col gap-3 rounded-2xl border border-[#E2DDD3] p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 id="saude-t" className="text-[15px] font-semibold">Saúde</h3>
          <SeloSaude saude={saude.saude} />
        </div>
        <p className="text-[12.5px] leading-relaxed">{saude.motivo}</p>
        <div aria-label={`Agendamentos por semana: ${saude.semanas.join(", ")}`} role="img" className="flex h-16 items-end gap-2">
          {saude.semanas.map((q, i) => (
            <span key={i} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[10px] tabular-nums text-[#6F6A5E]">{q}</span>
              <span className={`w-full rounded-md ${q ? "bg-[#2C6A53]" : "bg-[#E2DDD3]"}`} style={{ height: `${Math.max(4, (q / maior) * 40)}px` }} />
            </span>
          ))}
        </div>
        <p className="text-center text-[10px] text-[#6F6A5E]">agendamentos por semana · últimas 4</p>
        <dl className="grid grid-cols-3 gap-2">
          {[
            ["Último agendamento", haQuanto(saude.ultimoAgendamento)],
            ["Cliente desde", dataCurta(saude.clienteDesde) ?? "—"],
            ["Cobrança", cobranca],
          ].map(([a, b]) => (
            <div key={a} className="rounded-[10px] bg-[#FBFAF8] p-2.5">
              <dt className="text-[10px] tracking-[0.04em] text-[#6F6A5E] uppercase">{a}</dt>
              <dd className="mt-1 text-[13px] font-semibold">{b}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}

/** Marcar "fechado" confirma os valores e já faz o que vem depois da venda. */
export function VendaFechada({
  nome,
  crm,
  precisaConvite,
  onConfirmar,
  onCancelar,
}: {
  nome: string;
  crm: Crm;
  precisaConvite: boolean;
  onConfirmar: (dados: { entradaCents: number; mensalCents: number; cobrarEntrada: boolean; boasVindas: boolean; convite: boolean }) => Promise<unknown> | void;
  onCancelar: () => void;
}) {
  const [entrada, setEntrada] = useState(((crm.entradaCents ?? PRECO_PADRAO.entradaCents) / 100).toFixed(2).replace(".", ","));
  const [mensal, setMensal] = useState(((crm.mensalCents ?? PRECO_PADRAO.mensalCents) / 100).toFixed(2).replace(".", ","));
  const [cobrarEntrada, setCobrarEntrada] = useState(true);
  const [boasVindas, setBoasVindas] = useState(true);
  const [convite, setConvite] = useState(precisaConvite);
  const [busy, setBusy] = useState(false);
  // Entrada em branco é venda sem entrada, não erro: só texto inválido barra
  const entradaCents = entrada.trim() ? cents(entrada) : 0;
  const invalido = !(cents(mensal) > 0) || Number.isNaN(entradaCents) || entradaCents < 0;

  const opcoes = [
    { id: "cobrar", rotulo: "Gerar a cobrança da entrada", detalhe: "Pix com link", on: cobrarEntrada, set: setCobrarEntrada, mostrar: entradaCents > 0 },
    { id: "boas", rotulo: "Enviar boas-vindas no WhatsApp", detalhe: crm.donoNome ? `para ${crm.donoNome.split(" ")[0]}` : "para o dono", on: boasVindas, set: setBoasVindas, mostrar: true },
    { id: "convite", rotulo: "Incluir o convite do painel", detalhe: "o dono ainda não entrou", on: convite, set: setConvite, mostrar: precisaConvite },
  ];

  return (
    <AlertDialog.Root open onOpenChange={(open) => !open && !busy && onCancelar()}>
      <AlertDialog.Portal container={typeof document === "undefined" ? undefined : document.getElementById("admin-raiz")}>
        <AlertDialog.Backdrop className="fixed inset-0 z-[60] bg-[#17150F]/35" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-[70] flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 overflow-y-auto rounded-2xl bg-white p-6 font-[family-name:var(--fonte-mono)] text-[#17150F] shadow-2xl outline-none">
          <div className="flex flex-col gap-1">
            <AlertDialog.Title className="font-[family-name:var(--fonte-serifa)] text-[28px] leading-tight">Venda fechada</AlertDialog.Title>
            <AlertDialog.Description className="text-[12.5px] leading-relaxed text-[#6F6A5E]">{nome} vira cliente. Confirme o que já sai daqui:</AlertDialog.Description>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ["Entrada", entrada, setEntrada],
                ["Mensalidade", mensal, setMensal],
              ] as const
            ).map(([rotulo, valor, set]) => (
              <label key={rotulo} className={ROTULO_CAMPO}>
                {rotulo}
                <span className="flex h-11 items-center rounded-[10px] border border-[#D8D2C6] focus-within:border-[#17150F]">
                  <span className="pl-3 text-sm text-[#8B8578]">R$</span>
                  <input
                    inputMode="decimal"
                    value={valor}
                    onChange={(e) => set(e.target.value.replace(/[^\d,.]/g, ""))}
                    className="h-full min-w-0 grow bg-transparent px-2 text-sm tabular-nums text-[#17150F] outline-none"
                  />
                </span>
              </label>
            ))}
          </div>
          {invalido && <p role="alert" className="text-xs text-[#8A2F2F]">Informe a mensalidade (e a entrada, se houver).</p>}
          <fieldset className="grid gap-2">
            <legend className="mb-2 text-xs text-[#6F6A5E]">Já fazer agora</legend>
            {opcoes
              .filter((o) => o.mostrar)
              .map((o) => (
                <label key={o.id} className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-[10px] border border-[#D8D2C6] px-3 text-[13px]">
                  <input type="checkbox" checked={o.on} onChange={(e) => o.set(e.target.checked)} className="size-4 accent-[#17150F]" />
                  <span className="grow">{o.rotulo}</span>
                  <span className="text-[11px] text-[#6F6A5E]">{o.detalhe}</span>
                </label>
              ))}
          </fieldset>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" disabled={busy} onClick={onCancelar} className={BOTAO_CLARO}>
              Voltar
            </button>
            <button
              type="button"
              disabled={busy || invalido}
              onClick={async () => {
                setBusy(true);
                try {
                  await onConfirmar({
                    entradaCents: entradaCents || 0,
                    mensalCents: cents(mensal),
                    cobrarEntrada: cobrarEntrada && entradaCents > 0,
                    boasVindas,
                    convite: convite && precisaConvite,
                  });
                } finally {
                  setBusy(false);
                }
              }}
              className={`${BOTAO_VERDE} disabled:opacity-60`}
            >
              {busy ? "Salvando…" : "Confirmar venda"}
            </button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
