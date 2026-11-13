"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { useRef, useState } from "react";
import { cents } from "@/lib/dinheiro";
import { formatBRL, formatPhone, linkWhatsApp, phoneError } from "@/lib/datetime";
import type { ClienteSaude } from "@/lib/saude.server";
import { ROTULO_SAUDE } from "@/lib/saude";
import { celular } from "@/lib/painel-consulta";
import { chaveDoModelo, preencherTexto, TEXTOS_PADRAO, type TextosCrm } from "@/lib/crm-textos";
import { linksPermitidos, OBJECOES, preencher, problemasDaResposta, type Variante } from "@/lib/prospeccao-variantes";
import { barradoPeloPareDoAgente, CADENCIA, DIAS_PROPOSTA, diaCurto, hojeISO, MOTIVOS_PERDA, TOQUES_MAX, ORIGENS, PRECO_PADRAO, ROTULO, type Crm, type Estagio, type Evento, type MotivoPerda, type Origem } from "@/lib/crm-tipos";

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

/** "dd/mm" do instante, no fuso de quem olha */
const diaDe = (iso: string) => new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });

/** Pediu para parar e não é cliente: nenhum botão abre conversa de prospecção */
const bloqueado = (crm: Crm) => !!crm.naoContatarEm && crm.estagio !== "fechado";

type Negocio = { slug: string; nome: string; telefone: string | null; nota?: number | null; avaliacoes?: number | null };

/** O número para onde o botão abre a conversa. Máscara e regra ao digitar (só dígitos, DDD que existe,
 *  celular com 9); só número válido é gravado, ao sair do campo. Vazio volta ao telefone do site. */
function EnviarPara({ numero, onNumero }: { numero: string | null; onNumero: (digitos: string | null) => void }) {
  const base = numero ? formatPhone(numero) : "";
  const [valor, setValor] = useState(base);
  const campo = useRef<HTMLInputElement>(null);
  // o número também muda em "Contato do dono": este acompanha
  const [visto, setVisto] = useState(base);
  if (visto !== base) {
    setVisto(base);
    setValor(base);
  }
  const digitos = valor.replace(/\D/g, "");
  const erro = digitos ? phoneError(valor) : "";
  return (
    <label className="flex flex-wrap items-center gap-2 text-xs text-[#6F6A5E]">
      Enviar para
      <span className="relative">
      <input
        ref={campo}
        type="tel"
        inputMode="tel"
        autoComplete="off"
        maxLength={16}
        value={valor}
        placeholder="(92) 99999-9999"
        aria-invalid={!!erro}
        onChange={(e) => setValor(formatPhone(e.target.value))}
        onBlur={() => !erro && valor !== base && onNumero(digitos || null)}
        className={`h-9 w-[11rem] rounded-[8px] border bg-white pr-9 pl-2.5 text-[13px] tabular-nums text-[#17150F] outline-none focus:border-[#17150F] ${erro ? "border-[#8A2F2F]" : "border-[#D8D2C6]"}`}
      />
      {/* só limpa o texto e devolve o foco: o número novo é gravado ao sair do campo */}
      {valor && (
        <button
          type="button"
          aria-label="Limpar o número"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => (setValor(""), campo.current?.focus())}
          className="absolute top-0 right-0 flex size-9 items-center justify-center rounded-[8px] text-[15px] text-[#6F6A5E] hover:text-[#17150F]"
        >
          ×
        </button>
      )}
      </span>
      {erro && <span role="alert" className="text-[#8A2F2F]">{erro}</span>}
    </label>
  );
}

/** Quem decide. O telefone do site é o da recepção: proposta e cobrança vão para o dono. */
export function ContatoDono({ negocio, crm, salvar }: { negocio: Negocio; crm: Crm; salvar: (dados: Partial<Crm>) => void }) {
  const [zap, setZap] = useState(crm.donoWhatsapp ? formatPhone(crm.donoWhatsapp) : "");
  // o número também muda no campo "Enviar para" da mensagem: este acompanha
  const [visto, setVisto] = useState(crm.donoWhatsapp);
  if (visto !== crm.donoWhatsapp) {
    setVisto(crm.donoWhatsapp);
    setZap(crm.donoWhatsapp ? formatPhone(crm.donoWhatsapp) : "");
  }
  const [email, setEmail] = useState(crm.donoEmail ?? "");
  const erroEmail = email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? "E-mail incompleto" : "";
  const digitos = zap.replace(/\D/g, "");
  const erroZap = digitos ? phoneError(zap) : "";
  const link = !bloqueado(crm) && crm.donoWhatsapp && linkWhatsApp(crm.donoWhatsapp, `Olá${crm.donoNome ? `, ${crm.donoNome.split(" ")[0]}` : ""}!`);

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
      <OutrosContatos crm={crm} salvar={salvar} />
      {negocio.telefone && (
        <p className="rounded-[10px] bg-[#FBFAF8] px-3 py-2.5 text-xs text-[#6F6A5E]">Telefone do site (recepção): {formatPhone(negocio.telefone)}</p>
      )}
    </section>
  );
}

/** Mais gente para falar no negócio (sócio, gerente…). Proposta e cobrança seguem com o dono. */
function OutrosContatos({ crm, salvar }: { crm: Crm; salvar: (dados: Partial<Crm>) => void }) {
  const [lista, setLista] = useState(crm.outrosContatos.map((c) => ({ nome: c.nome, zap: formatPhone(c.whatsapp) })));
  const digitos = (zap: string) => zap.replace(/\D/g, "");
  const invalido = (zap: string) => digitos(zap).length < 10 || digitos(zap).length > 11;
  // Linha vazia é rascunho e não vai; com número pela metade, nada é gravado até corrigir
  function gravar(nova = lista) {
    const cheias = nova.filter((c) => c.zap);
    if (cheias.some((c) => invalido(c.zap))) return;
    salvar({ outrosContatos: cheias.map((c) => ({ nome: c.nome.trim(), whatsapp: digitos(c.zap) })) });
  }
  const mudar = (i: number, campo: "nome" | "zap", v: string) =>
    setLista(lista.map((c, j) => (j === i ? { ...c, [campo]: campo === "zap" ? formatPhone(v) : v } : c)));

  return (
    <div className="flex flex-col gap-2">
      {lista.map((c, i) => {
        const erro = c.zap && invalido(c.zap);
        const link = c.zap && !erro && linkWhatsApp(digitos(c.zap), `Olá${c.nome.trim() ? `, ${c.nome.trim().split(" ")[0]}` : ""}!`);
        return (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_9.5rem_auto] items-end gap-2">
            <label className={ROTULO_CAMPO}>
              Outro contato
              <input value={c.nome} maxLength={60} placeholder="Nome ou papel" onChange={(e) => mudar(i, "nome", e.target.value)} onBlur={() => gravar()} className={CAMPO} />
            </label>
            <label className={ROTULO_CAMPO}>
              <span className={erro ? "text-[#8A2F2F]" : ""}>{erro ? "10 ou 11 dígitos" : "WhatsApp"}</span>
              <input
                type="tel"
                inputMode="tel"
                value={c.zap}
                placeholder="(92) 99999-9999"
                aria-invalid={!!erro}
                onChange={(e) => mudar(i, "zap", e.target.value)}
                onBlur={() => gravar()}
                className={`${CAMPO} tabular-nums ${erro ? "border-[#8A2F2F]" : ""}`}
              />
            </label>
            <div className="flex gap-1">
              {link && (
                <a href={link} target="_blank" rel="noreferrer" aria-label={`WhatsApp de ${c.nome || "contato"}`} className={`${BOTAO_VERDE} w-11 px-0`}>
                  <Zap />
                </a>
              )}
              <button
                type="button"
                aria-label={`Remover ${c.nome || "contato"}`}
                onClick={() => {
                  const nova = lista.filter((_, j) => j !== i);
                  setLista(nova);
                  gravar(nova);
                }}
                className={`${BOTAO_CLARO} w-11 px-0`}
              >
                ×
              </button>
            </div>
          </div>
        );
      })}
      {lista.length < 10 && (
        <button type="button" onClick={() => setLista([...lista, { nome: "", zap: "" }])} className={`${BOTAO_CLARO} self-start`}>
          + Adicionar outro WhatsApp
        </button>
      )}
    </div>
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

/** O que a gaveta manda ao clicar no WhatsApp: o texto como estava e se foi editado (a variante A/B
 *  o servidor deriva do tenant; texto editado não conta para ela). */
export type Envio = { texto: string; editado: boolean };
/** O que MensagensProntas deixa pronto para a barra fixa, com o slug de quem gerou */
export type Pronto = { slug: string; modelo: Modelo; texto: string; link: string | null; para: string; envio: Envio };
/** H-1 (terceira rodada): a barra só leva o link do negócio aberto; o pronto de outro lead não sai. */
export const linkDaBarra = (pronto: Pronto | null, slugAberto: string) => (pronto && pronto.slug === slugAberto ? pronto.link : null);

/** O modelo da vez: boas-vindas no fechado, proposta depois da resposta, senão o próximo toque da cadência */
export function modeloDaVez(crm: Crm): Modelo {
  const proximoToque: Modelo = !crm.ultimoContatoEm ? "Primeiro contato" : crm.toques >= 2 ? "Última tentativa" : "Lembrete";
  return crm.estagio === "fechado" ? "Boas-vindas" : crm.estagio === "novo" ? (crm.respondeuEm ? "Proposta" : proximoToque) : "Proposta";
}

/** A mensagem e o link de um negócio: a regra única da gaveta (MensagensProntas) e da barra fixa.
 *  carregando/erroDetalhe: o detalhe (variante e PARE do número de prospecção) não chegou; o que o
 *  PARE do agente barra (cadência e, M-7, proposta de quem não é cliente) não abre o WhatsApp. */
export function montarPronto(
  modelo: Modelo,
  editado: string | null,
  c: { negocio: Negocio; crm: Crm; assinatura: string; linkProposta?: string | null; variante?: Variante | null; textos?: TextosCrm | null; carregando?: boolean; erroDetalhe?: string | null; paradoNaProspeccao?: boolean },
) {
  const atual = editado ?? mensagem(modelo, c.negocio, c.crm, c.assinatura, c.linkProposta, c.variante, c.textos);
  // F1-12: o PARE do cliente fechado vale para a prospecção (a cadência), não para as mensagens de cliente
  const cadencia = !!CADENCIA[modelo];
  const barrado = barradoPeloPareDoAgente(modelo, c.crm.estagio);
  // sem o detalhe, carregando ou com erro, nada que o PARE do agente barra abre o WhatsApp
  // (falhar aberto mandaria lembrete a quem pediu PARE)
  const esperando = barrado && (!!c.carregando || !!c.erroDetalhe);
  const numero = c.crm.donoWhatsapp ?? c.negocio.telefone;
  // Mandar "[SEU NOME]" para o cliente é pior do que não mandar nada
  const faltaNome = atual.includes(MARCA_NOME);
  const pareCliente = !!c.crm.naoContatarEm && c.crm.estagio === "fechado";
  // M-7: o PARE do número de prospecção barra a cadência e a proposta de quem não é cliente (como o servidor)
  const pareAgente = barrado && !!c.paradoNaProspeccao;
  const parou = bloqueado(c.crm) || (pareCliente && cadencia) || pareAgente;
  // endereço direto: o redirecionamento do wa.me troca emoji por "�" no computador
  const link = (numero && !faltaNome && !parou && !esperando ? linkWhatsApp(numero, atual) : null)
    ?.replace("https://wa.me/", "https://api.whatsapp.com/send?phone=").replace("?text=", "&text=") ?? null;
  const para = c.crm.donoNome ?? (c.crm.donoWhatsapp ? "o dono" : "a recepção");
  // primeiro contato com texto personalizado vai como editado: o servidor não conta esse envio para a
  // variante do A/B (o texto que saiu não é o dela)
  const personalizado = modelo === "Primeiro contato" && !!c.textos?.primeiro;
  const pronto: Pronto = { slug: c.negocio.slug, modelo, texto: atual, link, para, envio: { texto: atual, editado: editado !== null || personalizado } };
  return { pronto, numero, faltaNome, pareCliente, pareAgente, parou, esperando };
}

/** O texto do modelo para este negócio: o personalizado (config/crm.textos) ou o padrão, com os
 *  marcadores trocados. No primeiro contato sem texto personalizado, o salão leva a variante do A/B. */
export function mensagem(modelo: Modelo, negocio: Negocio, crm: Crm, vendedor?: string, linkProposta?: string | null, variante?: Variante | null, textos?: TextosCrm | null) {
  const quem = vendedor?.trim() || MARCA_NOME;
  const oi = `Oi${crm.donoNome ? `, ${crm.donoNome.split(" ")[0]}` : ""}! Aqui é ${quem}, da Ruphus.`;
  const site = `${negocio.slug}.ruphus.site`;
  // Cita um dado real do Google quando há; indicação vale mais do que a nota
  const prova = crm.origem === "indicacao" && crm.indicadoPor
    ? `${crm.indicadoPor} me passou seu contato.`
    : negocio.nota && negocio.avaliacoes
      ? `Vi o ${negocio.nome} no Google, com ${negocio.nota.toFixed(1).replace(".", ",")} ★ e ${negocio.avaliacoes} avaliações.`
      : `Vi o perfil do ${negocio.nome}.`;
  const chave = chaveDoModelo(modelo)!;
  // o piloto A/B (F1): no salão, o texto é o da variante do lead (o personalizado vale mais)
  if (chave === "primeiro" && variante && !textos?.primeiro) return preencher(variante, { oi, prova, nome: negocio.nome });
  return preencherTexto(textos?.[chave] ?? TEXTOS_PADRAO[chave], {
    oi,
    vendedor: quem,
    nome: negocio.nome,
    prova,
    // o link das mensagens da cadência leva ?c=1: só por ele o beacon conta visita (landing e vitrine não levam)
    site: CADENCIA[modelo] ? `${site}/?c=1` : site,
    entrada: formatBRL(crm.entradaCents ?? PRECO_PADRAO.entradaCents),
    mensal: formatBRL(crm.mensalCents ?? PRECO_PADRAO.mensalCents),
    proposta: linkProposta ? `Proposta completa, válida por ${DIAS_PROPOSTA} dias: ${linkProposta}` : "",
  });
}

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

/** O que o copiloto devolve: a sugestão e os links que o rascunho pode levar. */
export type SugestaoIA = { resposta: string; etapaSugerida: Estagio; motivo: string; permitidos: string[] };

/** Copiloto de IA (F2): cola o que o lead escreveu, recebe uma sugestão e revisa antes de abrir o
 *  WhatsApp. A sugestão é rascunho: o vendedor edita e envia; nada sai sozinho. O rascunho passa
 *  pela mesma regra do servidor a cada digitação (preço, telefone, link fora da lista). */
export function Copiloto({
  slug,
  numero,
  parou,
  linkProposta,
  sugerir,
}: {
  slug: string;
  numero: string | null;
  parou: boolean;
  linkProposta?: string | null;
  sugerir: (mensagem: string) => Promise<{ ok: true; dados: SugestaoIA } | { ok: false; error: string }>;
}) {
  const [colado, setColado] = useState("");
  const [rascunho, setRascunho] = useState<string | null>(null);
  const [info, setInfo] = useState<{ etapa: Estagio; motivo: string } | null>(null);
  const [permitidos, setPermitidos] = useState(() => linksPermitidos(slug, linkProposta));
  const [erro, setErro] = useState("");
  const [busy, setBusy] = useState(false);
  // a regra é barata (regex): roda a cada digitação, sem debounce
  const problemas = rascunho === null ? [] : problemasDaResposta(rascunho, permitidos);
  const link = rascunho !== null && !problemas.length && !parou && numero ? linkWhatsApp(numero, rascunho) : null;

  async function pedir() {
    setBusy(true);
    setErro("");
    const r = await sugerir(colado).catch(() => ({ ok: false as const, error: "Não foi possível falar com o servidor. Tente de novo." }));
    setBusy(false);
    if (!r.ok) return setErro(r.error);
    setRascunho(r.dados.resposta);
    setPermitidos(r.dados.permitidos);
    setInfo({ etapa: r.dados.etapaSugerida, motivo: r.dados.motivo });
  }

  return (
    <section aria-labelledby="copiloto-t" className="flex flex-col gap-3 rounded-2xl border border-[#E2DDD3] p-4">
      <h3 id="copiloto-t" className="text-[15px] font-semibold">Copiloto de IA</h3>
      <p className="text-xs text-[#6F6A5E]">Cole o que o lead respondeu. A IA sugere a resposta; você revisa, edita e envia. Nada sai sozinho.</p>
      <label className={ROTULO_CAMPO}>
        O que o lead escreveu
        <textarea
          value={colado}
          onChange={(e) => setColado(e.target.value)}
          rows={3}
          maxLength={2000}
          className="w-full resize-y rounded-xl border border-[#E2DDD3] bg-[#FBFAF8] p-3 text-[12.5px] leading-relaxed text-[#17150F] outline-none focus:border-[#17150F]"
        />
      </label>
      <button type="button" disabled={busy || !colado.trim()} onClick={pedir} className={`${BOTAO_CLARO} disabled:cursor-not-allowed disabled:opacity-50`}>
        {busy ? "Pensando…" : rascunho === null ? "Sugerir resposta" : "Sugerir de novo"}
      </button>
      {erro && <p role="alert" className="text-xs text-[#8A2F2F]">{erro}</p>}
      {rascunho !== null && (
        <>
          {info && (
            <p className="text-xs text-[#6F6A5E]">
              Etapa sugerida: <strong className="font-semibold text-[#17150F]">{ROTULO[info.etapa]}</strong>
              {info.motivo && ` · ${info.motivo}`}
            </p>
          )}
          <label className={ROTULO_CAMPO}>
            Resposta (revise antes de enviar)
            <textarea
              value={rascunho}
              onChange={(e) => setRascunho(e.target.value)}
              rows={4}
              aria-invalid={problemas.length > 0}
              aria-describedby="copiloto-problemas"
              className="w-full resize-y rounded-xl border border-[#E2DDD3] bg-white p-3 text-[12.5px] leading-relaxed text-[#17150F] outline-none focus:border-[#17150F] aria-[invalid=true]:border-[#8A2F2F]"
            />
          </label>
          <ul id="copiloto-problemas" aria-live="polite" className="flex flex-col gap-1 text-xs text-[#8A2F2F]">
            {problemas.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
          {link ? (
            <a href={link} target="_blank" rel="noreferrer" className={BOTAO_VERDE}>
              <Zap /> Abrir no WhatsApp
            </a>
          ) : (
            <span className={`${BOTAO} border border-dashed border-[#D8D2C6] text-[#8B8578]`}>
              {parou ? "Pediu para parar" : !numero ? "Cadastre o WhatsApp do dono" : "Corrija a resposta para enviar"}
            </span>
          )}
        </>
      )}
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
  linkProposta,
  onGerarLink,
  onNumero,
  onMarcar,
  onEncerrar,
  onEnviarEProximo,
  variante,
  textos,
  carregando,
  erroDetalhe,
  onTentarDeNovo,
  paradoNaProspeccao,
}: {
  negocio: Negocio;
  crm: Crm;
  assinatura: string;
  /** O clique abre o WhatsApp e deixa o envio pendente: quem confirma é o "Enviou?" da volta */
  onEnviar: (modelo: Modelo, para: string, envio: Envio) => void;
  /** Nos toques da cadência: como onEnviar e, depois do "Sim", abre o próximo da fila */
  onEnviarEProximo?: (modelo: Modelo, para: string, envio: Envio) => void;
  /** A variante A/B do primeiro contato (só no piloto do salão) */
  variante?: Variante | null;
  /** Os textos personalizados (aba Prospecção); sem eles, o padrão */
  textos?: TextosCrm | null;
  /** O detalhe do negócio (que traz a variante e o PARE do agente) ainda não chegou: a cadência não sai */
  carregando?: boolean;
  /** O detalhe não carregou: a cadência segue travada (falhar fechado), com "Tentar de novo" */
  erroDetalhe?: string | null;
  onTentarDeNovo?: () => void;
  /** Um telefone do negócio pediu PARE no número de prospecção (agente, F3): a cadência não sai */
  paradoNaProspeccao?: boolean;
  /** O lead pediu para parar e voltou atrás ("Desfazer"); Respondeu e Parou ficam no topo da gaveta */
  onMarcar: (oque: "respondeu" | "parar" | "liberar") => void;
  /** Fim da cadência: perdido por não responder */
  onEncerrar: () => void;
  onCopiar: (texto: string) => void;
  /** Link da proposta já gerado para este negócio; sem ele, o modelo Proposta não leva link */
  linkProposta?: string | null;
  /** Gera (ou reaproveita) o link da proposta sem sair da mensagem */
  onGerarLink?: () => void;
  /** Troca o número de destino (grava o WhatsApp do dono); vazio volta ao telefone do site */
  onNumero?: (digitos: string | null) => void;
}) {
  // "Primeiro contato" é mensagem fria: só para quem nunca recebeu contato
  const jaContatado = !!crm.ultimoContatoEm;
  const modelos = MODELOS.filter((m) => m !== "Primeiro contato" || !jaContatado);
  // na prospecção, o modelo sugerido é o próximo toque da cadência
  const prospectando = crm.estagio === "novo" && !crm.respondeuEm;
  const esgotou = prospectando && crm.toques >= TOQUES_MAX;
  const [modelo, setModelo] = useState<Modelo>(() => modeloDaVez(crm));
  const [texto, setTexto] = useState<{ para: Modelo; valor: string } | null>(null);
  const editado = texto?.para === modelo;
  const { pronto, numero, faltaNome, pareCliente, pareAgente, parou, esperando } = montarPronto(modelo, editado ? texto.valor : null, {
    negocio, crm, assinatura, linkProposta, variante, textos, carregando, erroDetalhe, paradoNaProspeccao,
  });
  const { texto: atual, link, para, envio } = pronto;
  // não é celular (a mesma regra da fila Primeiro contato): pode ter WhatsApp Business, mas costuma não ter
  const fixo = !!numero && !celular(numero);

  return (
    <section aria-labelledby="msg-t" className="flex flex-col gap-3 rounded-2xl border border-[#E2DDD3] p-4">
      {/* Uma linha: a mensagem da vez (modeloDaVez), para quem vai e em que toque está */}
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="msg-t" title={`Quando mandar: ${QUANDO[modelo]}`} className="text-[15px] font-semibold">{modelo}</h3>
        <span className="truncate text-xs text-[#6F6A5E]">
          {crm.donoWhatsapp ? `para ${crm.donoNome?.split(" ")[0] ?? "o dono"}` : numero ? "para a recepção" : "sem telefone"}
          {prospectando && crm.toques > 0 && ` · ${crm.toques} de ${TOQUES_MAX} toques`}
        </span>
      </div>
      {/* o número para onde o botão abre a conversa: trocar aqui grava o WhatsApp do dono */}
      {onNumero && <EnviarPara numero={numero} onNumero={onNumero} />}
      <details className="text-xs">
        <summary className="w-fit cursor-pointer text-[#6F6A5E] underline underline-offset-2 hover:text-[#17150F]">Outras mensagens</summary>
        <div role="group" aria-label="Modelo" className="mt-2 flex flex-wrap gap-2">
          {modelos.map((m) => (
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
      </details>
      {fixo && !parou && <p className="text-xs text-[#7A5A2E]">Número fixo: pode não ter WhatsApp. Se a conversa não abrir, ligue.</p>}
      {esgotou && !parou && (
        <div className="flex flex-wrap items-center gap-2 rounded-[10px] bg-[#FBF3DC] px-3 py-2.5 text-xs text-[#7A5A2E]">
          <span className="grow">{TOQUES_MAX} toques sem resposta: insistir vira spam.</span>
          <button type="button" onClick={onEncerrar} className="h-9 rounded-[8px] border border-[#D8D2C6] bg-white px-2.5 font-semibold text-[#8A2F2F] hover:border-[#8A2F2F]">
            Encerrar · não respondeu
          </button>
        </div>
      )}
      {pareCliente && (
        <p className="rounded-[10px] bg-[#FBF3DC] px-3 py-2.5 text-xs text-[#7A5A2E]">
          Cliente pediu PARE{crm.naoContatarEm ? ` em ${diaDe(crm.naoContatarEm)}` : ""}: a cadência de prospecção não sai. Proposta, boas-vindas, implantação e cobrança seguem.
        </p>
      )}
      {pareAgente && !bloqueado(crm) && !pareCliente && (
        <p className="rounded-[10px] bg-[#F7EFEF] px-3 py-2.5 text-xs text-[#8A2F2F]">
          Pediu PARE no número de prospecção (conversa com o agente). Os toques da cadência e a proposta não abrem o WhatsApp.
        </p>
      )}
      {bloqueado(crm) && (
        <div className="flex flex-wrap items-center gap-2 rounded-[10px] bg-[#F7EFEF] px-3 py-2.5 text-xs text-[#8A2F2F]">
          <span className="grow">Pediu para não receber mensagens{crm.naoContatarEm ? ` em ${diaDe(crm.naoContatarEm)}` : ""}. As mensagens prontas não abrem o WhatsApp.</span>
          <button type="button" onClick={() => onMarcar("liberar")} className="h-9 rounded-[8px] border border-[#D8D2C6] bg-white px-2.5 text-[#17150F] hover:border-[#17150F]">
            Desfazer
          </button>
        </div>
      )}
      {erroDetalhe && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-[10px] bg-[#F7EFEF] px-3 py-2.5 text-xs text-[#8A2F2F]">
          <span className="grow">Os dados do negócio não carregaram ({erroDetalhe}): a cadência e a proposta ficam travadas até carregar.</span>
          {onTentarDeNovo && (
            <button type="button" onClick={onTentarDeNovo} className="h-9 rounded-[8px] border border-[#D8D2C6] bg-white px-2.5 font-semibold text-[#17150F] hover:border-[#17150F]">
              Tentar de novo
            </button>
          )}
        </div>
      )}
      {modelo === "Proposta" && !linkProposta && (
        <p className="flex flex-wrap items-center gap-2 text-xs text-[#8A2F2F]">
          A mensagem está sem o link da proposta.
          {onGerarLink && (
            <button type="button" onClick={onGerarLink} className="h-9 rounded-[8px] border border-[#D8D2C6] bg-white px-2.5 font-semibold text-[#17150F] hover:border-[#17150F]">
              Gerar link
            </button>
          )}
        </p>
      )}
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
        rows={4}
        className="w-full resize-y rounded-xl border border-[#E2DDD3] bg-[#FBFAF8] p-3 text-[12.5px] leading-relaxed text-[#17150F] outline-none focus:border-[#17150F]"
      />
      {/* Um botão só. Na prospecção (toque da cadência), depois do "Sim" a gaveta segue para o próximo
          da fila; proposta e boas-vindas são conversa em andamento, e a gaveta fica no lead */}
      <div className="flex gap-2">
        {link ? (
          <a href={link} target="_blank" rel="noreferrer" onClick={() => (CADENCIA[modelo] && onEnviarEProximo ? onEnviarEProximo : onEnviar)(modelo, para, envio)} className={`${BOTAO_VERDE} grow`}>
            <Zap /> Abrir no WhatsApp
          </a>
        ) : (
          <span className={`${BOTAO} grow border border-dashed border-[#D8D2C6] text-[#8B8578]`}>
            {parou ? "Pediu para parar" : esperando ? (erroDetalhe ? "Não carregou: tente de novo" : "Carregando a mensagem…") : faltaNome ? "Defina quem assina, no topo" : "Cadastre o WhatsApp do dono"}
          </span>
        )}
      </div>
      {/* Copiar não registra envio: fica discreto, para quem cola a mensagem à mão */}
      <button type="button" disabled={faltaNome || parou || esperando} onClick={() => onCopiar(atual)} className="w-fit text-xs text-[#6F6A5E] underline underline-offset-2 hover:text-[#17150F] disabled:cursor-not-allowed disabled:opacity-50">
        Copiar a mensagem
      </button>
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
  const [detalhe, setDetalhe] = useState("");
  const [volta, setVolta] = useState("");
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
          <label className={ROTULO_CAMPO}>
            Detalhe (opcional)
            <input value={detalhe} maxLength={300} onChange={(e) => setDetalhe(e.target.value)} placeholder="o que foi dito" className={CAMPO} />
          </label>
          <label className={ROTULO_CAMPO}>
            Voltar a procurar em (opcional)
            <input type="date" value={volta} min={hojeISO()} onChange={(e) => setVolta(e.target.value)} className={CAMPO} />
            <span>Vira a próxima ação: o negócio reaparece em “Para hoje” nessa data.</span>
          </label>
          {/* o motivo grava: um toque (antes era marcar o motivo e depois confirmar) */}
          <fieldset disabled={busy} className="grid gap-2">
            <legend className="mb-1 text-xs font-semibold text-[#17150F]">Toque no motivo para marcar como perdido</legend>
            {(Object.keys(MOTIVOS_PERDA) as MotivoPerda[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={async () => {
                  setBusy(true);
                  try {
                    await onConfirmar({ motivoPerda: m, detalhePerda: detalhe.trim() || null, proximaData: volta || null, proximaAcao: volta ? "voltar a procurar" : null });
                  } finally {
                    setBusy(false);
                  }
                }}
                className="flex min-h-11 items-center rounded-[10px] border border-[#D8D2C6] px-3 text-left text-[13px] hover:border-[#8A2F2F] hover:text-[#8A2F2F] disabled:opacity-60"
              >
                {MOTIVOS_PERDA[m]}
              </button>
            ))}
          </fieldset>
          <button type="button" disabled={busy} onClick={onCancelar} className={BOTAO_CLARO}>
            {busy ? "Salvando…" : "Voltar"}
          </button>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}

/** A resposta "Sim" indo ao servidor sem perder o envio em silêncio: só com `ok` o pendente
 *  some. Recusa do servidor ou rejeição (rede, sessão) devolvem o MESMO pendente (mesmo envioId: o
 *  create() do servidor não grava duas vezes) e o aviso, e a tela reabre o "Enviou?". */
export async function confirmarEnvio<P extends { envio: { envioId: string } }, T>(
  p: P,
  registrar: () => Promise<{ ok: true; dados: T } | { ok: false; error: string }>,
): Promise<{ ok: true; dados: T } | { ok: false; pendente: P; aviso: string }> {
  try {
    const r = await registrar();
    return r.ok ? r : { ok: false, pendente: p, aviso: `O envio não foi registrado: ${r.error}` };
  } catch (e) {
    console.error("[enviou] não registrei o envio", e);
    return { ok: false, pendente: p, aviso: "O envio não foi registrado (sem resposta do servidor). Responda de novo." };
  }
}

/** A volta do WhatsApp: o clique não prova que a mensagem saiu. Só "Sim" conta o envio. Quem mudou o
 *  texto na caixa da gaveta antes de abrir já vai como editado. Um clique só: depois dele, os botões
 *  desligam. */
export function EnviouModal({ nome, modelo, erro, responder }: { nome: string; modelo: string; erro?: string; responder: (r: "sim" | "nao") => void }) {
  const [feito, setFeito] = useState(false);
  const uma = (r: "sim" | "nao") => {
    if (feito) return;
    setFeito(true);
    responder(r);
  };
  return (
    // Esc (ou qualquer fechamento sem botão) não responde: "Não" é um clique, nunca o padrão de quem fecha
    <AlertDialog.Root open>
      <AlertDialog.Portal container={typeof document === "undefined" ? undefined : document.getElementById("admin-raiz")}>
        <AlertDialog.Backdrop className="fixed inset-0 z-[60] bg-[#17150F]/35" />
        <AlertDialog.Popup className="fixed top-1/2 left-1/2 z-[70] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 flex-col gap-4 rounded-2xl bg-white p-6 font-[family-name:var(--fonte-mono)] text-[#17150F] shadow-2xl outline-none">
          <div className="flex flex-col gap-1">
            <AlertDialog.Title className="font-[family-name:var(--fonte-serifa)] text-[26px] leading-tight">Enviou?</AlertDialog.Title>
            <AlertDialog.Description className="text-[12.5px] leading-relaxed text-[#6F6A5E]">
              {modelo} para {nome}. Só o que foi enviado entra na linha do tempo e nos números.
            </AlertDialog.Description>
          </div>
          {erro && <p role="alert" className="rounded-[10px] bg-[#F7EFEF] px-3 py-2.5 text-xs text-[#8A2F2F]">{erro}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" disabled={feito} onClick={() => uma("sim")} className={`${BOTAO_VERDE} disabled:opacity-50`}>Sim</button>
            <button type="button" disabled={feito} onClick={() => uma("nao")} className={BOTAO_CLARO}>Não</button>
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
    { id: "cobrar", rotulo: "Gerar a cobrança da taxa de ativação", detalhe: "Pix com link", on: cobrarEntrada, set: setCobrarEntrada, mostrar: entradaCents > 0 },
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
                ["Taxa de ativação", entrada, setEntrada],
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
          {invalido && <p role="alert" className="text-xs text-[#8A2F2F]">Informe a mensalidade (e a taxa de ativação, se houver).</p>}
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
