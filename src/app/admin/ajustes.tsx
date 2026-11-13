"use client";

import { useEffect, useState } from "react";
import { confirmar } from "@/components/confirmar";
import { numeroSms } from "@/lib/comtele";
import type { ConfigMensagens } from "@/lib/consumo";
import { formatPhone } from "@/lib/datetime";
import { cents, emReais } from "@/lib/dinheiro";
import { idToken as tokenAtual } from "@/lib/firebase";
import { SaldosDosNegocios } from "./mensagens-gaveta";
import { RemetenteWhatsApp } from "./remetente-whatsapp";
import type { IntegracaoNaTela } from "@/lib/integracoes.server";
import type { Situacao } from "@/lib/verificar-integracoes.server";
import { z } from "zod";
import { ConfigRoteamento, type CustoTarefa } from "@/lib/ia-roteamento";
import { lerIntegracoes, lerRoteamentoIA, salvarRoteamentoIA, lerConfigMensagensAction, salvarConfigMensagensAction, salvarIntegracao, testarEmail, testarSms, verificarAjustes } from "./actions";

const BOTAO = "inline-flex h-11 items-center justify-center rounded-[10px] px-4 text-sm font-semibold transition-colors";
const BOTAO_ESCURO = `${BOTAO} bg-[#17150F] text-white hover:bg-[#2C2920] disabled:opacity-50`;
const BOTAO_CLARO = `${BOTAO} border border-[#D8D2C6] bg-white text-[#17150F] hover:border-[#17150F] disabled:opacity-50`;

const ORIGEM = { painel: "Cadastrada aqui", env: "Vem do .env do servidor", nenhuma: "Não configurada" } as const;
const SELO = {
  ok: { texto: "✓ Válida", cor: "border-[#B9D7C5] bg-[#EEF6F0] text-[#1F5A3A]" },
  erro: { texto: "✗ Com problema", cor: "border-[#E3C2BC] bg-[#FBEFEC] text-[#8A2F2F]" },
  ausente: { texto: "Não configurada", cor: "border-[#E2DDD3] bg-[#F7F5F1] text-[#6F6A5E]" },
} as const;

/** Chaves dos serviços de fora (SMS, e-mail, WhatsApp). O segredo nunca volta inteiro ao navegador:
 *  a tela mostra os 4 últimos caracteres e só manda valor novo. */
export function Ajustes({ idToken }: { idToken: string }) {
  const [lista, setLista] = useState<IntegracaoNaTela[] | null>(null);
  const [erro, setErro] = useState("");
  // situação ao vivo de cada grupo (nada enviado nem cobrado); null = conferindo
  const [situacoes, setSituacoes] = useState<Record<string, Situacao> | null>(null);
  const [conferindo, setConferindo] = useState(false);

  async function conferir() {
    setConferindo(true);
    const r = await tokenAtual().then((tk) => verificarAjustes(tk)).catch(() => null);
    setConferindo(false);
    setSituacoes(r?.ok ? r.dados : {});
  }

  // primeira conferência ao abrir: estado só na resposta (null até lá mostra "Conferindo…")
  useEffect(() => {
    if (!idToken) return;
    let atual = true;
    tokenAtual().then((tk) => verificarAjustes(tk)).then(
      (r) => atual && setSituacoes(r.ok ? r.dados : {}),
      () => atual && setSituacoes({}),
    );
    return () => {
      atual = false;
    };
  }, [idToken]);

  useEffect(() => {
    if (!idToken) return;
    let atual = true;
    tokenAtual().then((tk) => lerIntegracoes(tk)).then(
      (r) => atual && (r.ok ? setLista(r.dados) : setErro(r.error)),
      () => atual && setErro("Não foi possível carregar os ajustes."),
    );
    return () => {
      atual = false;
    };
  }, [idToken]);

  const grupos = [...new Set(lista?.map((i) => i.grupo))];

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <h2 className="font-[family-name:var(--fonte-serifa)] text-[26px] leading-none">Ajustes</h2>
      <p className="text-sm text-[#6F6A5E]">
        Chaves dos serviços que a plataforma usa. O que for cadastrado aqui vale na hora e passa na frente do .env do servidor.
      </p>
      {erro && <p className="text-sm text-[#8A2F2F]">{erro}</p>}
      {!lista && !erro && <p className="text-sm text-[#6F6A5E]">Carregando…</p>}
      {grupos.map((g) => (
        <section key={g} aria-label={g} className="flex flex-col gap-4 rounded-2xl border border-[#E2DDD3] bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">{g}</h3>
            {situacoes?.[g] ? (
              <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${SELO[situacoes[g].situacao].cor}`}>{SELO[situacoes[g].situacao].texto}</span>
            ) : (
              <span className="text-xs text-[#8B8578]">{situacoes ? "" : "Conferindo…"}</span>
            )}
            <button type="button" onClick={conferir} disabled={conferindo} className="ml-auto text-xs font-medium text-[#17150F] underline underline-offset-2 disabled:opacity-50">
              {conferindo ? "Conferindo…" : "Verificar de novo"}
            </button>
          </div>
          {situacoes?.[g] && <p role="status" className={`-mt-2 text-xs ${situacoes[g].situacao === "erro" ? "text-[#8A2F2F]" : "text-[#6F6A5E]"}`}>{situacoes[g].detalhe}</p>}
          {lista!.filter((i) => i.grupo === g).map((i) => (
            <Campo key={i.nome} item={i} aoSalvar={(l) => (setLista(l), void conferir())} />
          ))}
          {g === "SMS (Comtele)" && <TesteSms pronto={lista!.some((i) => i.nome === "COMTELE_API_KEY" && i.origem !== "nenhuma")} />}
          {g === "E-mail" && <TesteEmail sugestao={lista!.find((i) => i.nome === "GMAIL_USER")?.mostra ?? ""} rotulo="Testar envio" ajuda="Manda um e-mail de teste. Escolha o canal para conferir cada um: o automático usa o Resend e só cai no Gmail se o Resend falhar." canais />}
          {g === "Alertas" && (
            <TesteEmail
              sugestao={lista!.find((i) => i.nome === "ALERTA_EMAIL")?.mostra || lista!.find((i) => i.nome === "GMAIL_USER")?.mostra || ""}
              rotulo="Testar alerta"
              ajuda="Manda um e-mail de teste para o destino dos alertas, para conferir se chega (e se não cai no spam)."
            />
          )}
        </section>
      ))}
      <RemetenteWhatsApp />
      <PrecosMensagem idToken={idToken} />
      <RoteamentoIA idToken={idToken} />
      <SaldosDosNegocios />
    </div>
  );
}

const CAMPOS_VALOR: { chave: "whatsappUtilityCents" | "whatsappServiceCents" | "smsCents" | "avisoSaldoCents" | "boasVindasCents" | "limiteNegativoCents"; rotulo: string; ajuda: string }[] = [
  { chave: "whatsappUtilityCents", rotulo: "WhatsApp: aviso (utilidade)", ajuda: "Pedido, confirmação, lembrete, Pix: tudo que a plataforma manda por conta própria." },
  { chave: "whatsappServiceCents", rotulo: "WhatsApp: resposta (janela de 24 h)", ajuda: "Resposta a quem acabou de escrever ou tocar num botão. 0 = grátis." },
  { chave: "smsCents", rotulo: "SMS", ajuda: "Confirmação e lembrete por SMS (Comtele)." },
  { chave: "avisoSaldoCents", rotulo: "Avisar o dono quando o saldo ficar abaixo de", ajuda: "Push e e-mail, uma vez por recarga." },
  { chave: "boasVindasCents", rotulo: "Crédito de boas-vindas", ajuda: "Entra no saldo do negócio novo (pré-pago)." },
  { chave: "limiteNegativoCents", rotulo: "Limite do saldo negativo", ajuda: "Só no modo \"deixar negativo\": até quanto abaixo de zero." },
];
const SEM_SALDO: Record<ConfigMensagens["semSaldo"], string> = {
  "pausar-clientes": "Pausar mensagens a clientes (lembrete, resposta e aviso ao dono seguem)",
  "pausar-tudo": "Pausar tudo (só o pedido ao dono sai)",
  negativo: "Deixar o saldo ficar negativo até o limite",
};
type Tela = Omit<ConfigMensagens, (typeof CAMPOS_VALOR)[number]["chave"] | "pacotes"> & Record<(typeof CAMPOS_VALOR)[number]["chave"], string> & { pacotes: { id: string; valor: string; bonus: string; ativo: boolean }[] };

/** Mensagens pré-pagas: preço por mensagem cobrado do negócio, saldo e pacotes de recarga. Cada envio
 *  grava o preço do momento (o consumo de antes não muda). */
function PrecosMensagem({ idToken }: { idToken: string }) {
  const [tela, setTela] = useState<Tela | null>(null);
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const paraTela = (c: ConfigMensagens): Tela => ({
    ...c,
    ...(Object.fromEntries(CAMPOS_VALOR.map(({ chave }) => [chave, emReais(c[chave])])) as Record<(typeof CAMPOS_VALOR)[number]["chave"], string>),
    pacotes: c.pacotes.map((p) => ({ id: p.id, valor: emReais(p.valorCents), bonus: emReais(p.bonusCents), ativo: p.ativo })),
  });

  useEffect(() => {
    if (!idToken) return;
    let atual = true;
    tokenAtual().then((tk) => lerConfigMensagensAction(tk)).then(
      (r) => atual && (r.ok ? setTela(paraTela(r.dados)) : setAviso({ ok: false, texto: r.error })),
      () => atual && setAviso({ ok: false, texto: "Não foi possível carregar a configuração das mensagens." }),
    );
    return () => {
      atual = false;
    };
  }, [idToken]);

  const config: ConfigMensagens | null = tela && {
    ...tela,
    ...(Object.fromEntries(CAMPOS_VALOR.map(({ chave }) => [chave, cents(tela[chave])])) as Record<(typeof CAMPOS_VALOR)[number]["chave"], number>),
    pacotes: tela.pacotes.map((p) => ({ id: p.id, valorCents: cents(p.valor), bonusCents: cents(p.bonus), ativo: p.ativo })),
  };
  const ok = (c: number) => Number.isInteger(c) && c >= 0;
  const invalido = !config || !CAMPOS_VALOR.every(({ chave }) => ok(config[chave])) || !config.pacotes.every((p) => ok(p.valorCents) && p.valorCents >= 100 && ok(p.bonusCents));
  const muda = (parte: Partial<Tela>) => (setTela({ ...tela!, ...parte }), setAviso(null));
  const CAMPO = "h-11 w-28 rounded-[10px] border border-[#D8D2C6] px-3 text-base tabular-nums";

  return (
    <section aria-label="Mensagens pré-pagas" className="flex flex-col gap-4 rounded-2xl border border-[#E2DDD3] bg-white p-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">Preço por mensagem (cobrado do negócio)</h3>
        <p className="text-xs text-[#6F6A5E]">
          Vale para os envios a partir de agora: cada mensagem grava o preço do momento. WhatsApp cobra o que saiu (falhou devolve ao saldo; parado na cota não cobra); SMS cobra no envio. No pré-pago o valor sai do saldo do negócio na hora.
        </p>
      </div>
      {!tela && !aviso && <p className="text-sm text-[#6F6A5E]">Carregando…</p>}
      {tela && (
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (invalido) return;
            setBusy(true);
            setAviso(null);
            const r = await salvarConfigMensagensAction(await tokenAtual(), config).catch(() => null);
            setBusy(false);
            if (!r?.ok) return setAviso({ ok: false, texto: r?.error ?? "Não foi possível salvar agora." });
            setTela(paraTela(r.dados));
            setAviso({ ok: true, texto: "Salvo. Vale para as próximas mensagens." });
          }}
        >
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={tela.cobrar} onChange={(e) => muda({ cobrar: e.target.checked })} className="size-4" />
            Cobrar as mensagens dos negócios
          </label>
          <div className="flex flex-col gap-1">
            <label htmlFor="mensagens-modelo" className="text-xs font-medium text-[#17150F]">Modelo</label>
            <select id="mensagens-modelo" value={tela.modelo} onChange={(e) => muda({ modelo: e.target.value as Tela["modelo"] })} className="h-11 rounded-[10px] border border-[#D8D2C6] bg-white px-2 text-sm">
              <option value="prepago">Pré-pago (saldo e recarga por Pix)</option>
              <option value="pospago">Pós-pago (só registra o consumo)</option>
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor="mensagens-sem-saldo" className="text-xs font-medium text-[#17150F]">Quando o saldo acaba</label>
            <select id="mensagens-sem-saldo" value={tela.semSaldo} onChange={(e) => muda({ semSaldo: e.target.value as Tela["semSaldo"] })} className="h-11 rounded-[10px] border border-[#D8D2C6] bg-white px-2 text-sm">
              {Object.entries(SEM_SALDO).map(([v, rotulo]) => <option key={v} value={v}>{rotulo}</option>)}
            </select>
          </div>
          {CAMPOS_VALOR.map(({ chave, rotulo, ajuda }) => (
            <div key={chave} className="flex flex-col gap-1">
              <label htmlFor={`preco-${chave}`} className="text-xs font-medium text-[#17150F]">{rotulo}</label>
              <p className="text-xs text-[#6F6A5E]">{ajuda}</p>
              <div className="flex items-center gap-2">
                <span className="text-sm text-[#6F6A5E]">R$</span>
                <input id={`preco-${chave}`} inputMode="decimal" value={tela[chave]} onChange={(e) => muda({ [chave]: e.target.value })} className={CAMPO} />
              </div>
            </div>
          ))}
          <fieldset className="flex flex-col gap-2">
            <legend className="text-xs font-medium text-[#17150F]">Pacotes de recarga (valor + bônus)</legend>
            {tela.pacotes.map((p, i) => {
              const troca = (parte: Partial<Tela["pacotes"][number]>) => muda({ pacotes: tela.pacotes.map((x, j) => (j === i ? { ...x, ...parte } : x)) });
              return (
                <div key={p.id} className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-[#6F6A5E]">R$</span>
                  <input aria-label={`Valor do pacote ${p.id}`} inputMode="decimal" value={p.valor} onChange={(e) => troca({ valor: e.target.value })} className={CAMPO} />
                  <span className="text-sm text-[#6F6A5E]">+ bônus R$</span>
                  <input aria-label={`Bônus do pacote ${p.id}`} inputMode="decimal" value={p.bonus} onChange={(e) => troca({ bonus: e.target.value })} className={CAMPO} />
                  <label className="flex items-center gap-1.5 text-xs">
                    <input type="checkbox" checked={p.ativo} onChange={(e) => troca({ ativo: e.target.checked })} className="size-4" /> ativo
                  </label>
                </div>
              );
            })}
          </fieldset>
          <button type="submit" disabled={busy || invalido} className={`${BOTAO_ESCURO} self-start`}>
            {busy ? "Salvando…" : "Salvar"}
          </button>
        </form>
      )}
      {aviso && <p role="status" className={`text-xs ${aviso.ok ? "text-[#2C6A53]" : "text-[#8A2F2F]"}`}>{aviso.texto}</p>}
    </section>
  );
}

/** O que a config da IA tem de errado agora (null = pode salvar). A mesma regra do servidor. */
function erroDaConfig(texto: string): string | null {
  let bruto: unknown;
  try {
    bruto = JSON.parse(texto || "{}");
  } catch (e) {
    return `JSON inválido: ${e instanceof Error ? e.message : "confira vírgulas e aspas"}`;
  }
  const r = ConfigRoteamento.safeParse(bruto);
  return r.success ? null : z.prettifyError(r.error);
}

const dolar = (centavos: number) => (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });

/** Roteamento da IA (config/ia-roteamento): qual modelo cada tarefa usa, a cadeia de fallback e o
 *  orçamento do dia. Vale na próxima chamada, sem deploy. A tabela embaixo mostra custo e erro por
 *  tarefa e modelo (iaChamadas), que é de onde sai a decisão de trocar. */
function RoteamentoIA({ idToken }: { idToken: string }) {
  const [texto, setTexto] = useState<string | null>(null);
  const [padrao, setPadrao] = useState<unknown>(null);
  const [custos, setCustos] = useState<{ desde: string; linhas: CustoTarefa[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  // a config salva no Firestore não passa no schema: o roteador está no padrão, e a tela diz por quê
  const [invalida, setInvalida] = useState<string | null>(null);
  // a leitura falhou: não se sabe o que está gravado, e salvar por cima apagaria a config boa
  const [naoLida, setNaoLida] = useState(false);

  useEffect(() => {
    if (!idToken) return;
    let atual = true;
    tokenAtual().then((tk) => lerRoteamentoIA(tk)).then(
      (r) => {
        if (!atual) return;
        if (!r.ok) return setAviso({ ok: false, texto: r.error });
        // inválida: o JSON gravado, para corrigir (não {}); não lida: vazio, com Salvar desligado
        setTexto(r.dados.gravado ?? "");
        setNaoLida(!r.dados.lida);
        setPadrao(r.dados.padrao);
        setCustos(r.dados.custos);
        setInvalida(r.dados.invalida);
      },
      () => atual && setAviso({ ok: false, texto: "Não foi possível carregar o roteamento da IA." }),
    );
    return () => {
      atual = false;
    };
  }, [idToken]);

  // validação a cada digitação (JSON e Zod de um texto curto: sem debounce)
  const erro = texto === null ? null : erroDaConfig(texto);

  return (
    <section aria-label="Roteamento da IA" className="flex flex-col gap-4 rounded-2xl border border-[#E2DDD3] bg-white p-4">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">IA: modelo por tarefa</h3>
        <p className="text-xs text-[#6F6A5E]">
          Cada tarefa tem uma cadeia de modelos: se um falhar, demorar ou responder fora do formato, o próximo tenta. Tarefa fora daqui usa o padrão do código. O orçamento do dia é em centavos de dólar. Vale na próxima chamada.
        </p>
      </div>
      {texto === null && !aviso && <p className="text-sm text-[#6F6A5E]">Carregando…</p>}
      {invalida && (
        <div role="alert" className="flex flex-col gap-1 rounded-xl bg-[#F1E7E7] px-3 py-2 text-xs leading-relaxed [overflow-wrap:anywhere] text-[#8A2F2F]">
          <p className="font-medium">A config salva não vale: todas as tarefas estão no padrão do código. Corrija e salve de novo.</p>
          <pre className="whitespace-pre-wrap">{invalida}</pre>
        </div>
      )}
      {naoLida && (
        <p role="alert" className="rounded-xl bg-[#F1E7E7] px-3 py-2 text-xs leading-relaxed text-[#8A2F2F]">
          Não foi possível ler a config salva: o roteador está no padrão do código, sem orçamento pago. Salvar fica desligado até ler; recarregue a página.
        </p>
      )}
      {texto !== null && (
        <form
          className="flex flex-col gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (erro || naoLida) return;
            setBusy(true);
            setAviso(null);
            const r = await tokenAtual().then((tk) => salvarRoteamentoIA(tk, JSON.parse(texto || "{}"))).catch(() => null);
            setBusy(false);
            if (!r?.ok) return setAviso({ ok: false, texto: r?.error ?? "Não foi possível salvar agora." });
            setTexto(JSON.stringify(r.dados, null, 2));
            setInvalida(null);
            setAviso({ ok: true, texto: "Salvo. A próxima chamada já usa esta rota." });
          }}
        >
          <label htmlFor="ia-roteamento" className="text-xs font-medium text-[#17150F]">config/ia-roteamento (JSON)</label>
          <textarea
            id="ia-roteamento"
            value={texto}
            onChange={(e) => (setTexto(e.target.value), setAviso(null))}
            rows={12}
            spellCheck={false}
            aria-invalid={!!erro}
            aria-describedby="ia-roteamento-erro"
            className="w-full resize-y rounded-xl border border-[#D8D2C6] bg-[#FBFAF8] p-3 font-mono text-xs leading-relaxed text-[#17150F] outline-none focus:border-[#17150F] aria-[invalid=true]:border-[#8A2F2F]"
          />
          <pre id="ia-roteamento-erro" aria-live="polite" className="whitespace-pre-wrap text-xs text-[#8A2F2F]">{erro ?? ""}</pre>
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy || !!erro || naoLida} className={BOTAO_ESCURO}>
              {busy ? "Salvando…" : "Salvar"}
            </button>
            <button type="button" disabled={busy || !padrao} onClick={() => (setTexto(JSON.stringify(padrao, null, 2)), setAviso(null))} className={BOTAO_CLARO}>
              Começar do padrão
            </button>
          </div>
        </form>
      )}
      {aviso && <p role={aviso.ok ? "status" : "alert"} className={`text-xs ${aviso.ok ? "text-[#2C6A53]" : "text-[#8A2F2F]"}`}>{aviso.texto}</p>}
      {texto !== null && !custos && <p className="text-xs text-[#6F6A5E]">Não foi possível ler o custo por tarefa agora.</p>}
      {custos && (
        <div className="flex flex-col gap-2">
          <h4 className="text-xs font-medium text-[#17150F]">Custo por tarefa desde {custos.desde.split("-").reverse().join("/")}</h4>
          {custos.linhas.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs tabular-nums">
                <thead className="text-[#6F6A5E]">
                  <tr>
                    <th scope="col" className="py-1 pr-3 font-medium">Tarefa</th>
                    <th scope="col" className="py-1 pr-3 font-medium">Modelo</th>
                    <th scope="col" className="py-1 pr-3 text-right font-medium">Chamadas</th>
                    <th scope="col" className="py-1 pr-3 text-right font-medium">Erro</th>
                    <th scope="col" className="py-1 text-right font-medium">Custo</th>
                  </tr>
                </thead>
                <tbody>
                  {custos.linhas.map((l) => (
                    <tr key={`${l.tarefa}-${l.modelo}-${l.provedor}`} className="border-t border-[#EDEAE0]">
                      <td className="py-1 pr-3">{l.tarefa}</td>
                      <td className="py-1 pr-3">{l.modelo}{l.provedor !== "anthropic" && ` (${l.provedor})`}</td>
                      <td className="py-1 pr-3 text-right">{l.chamadas}</td>
                      <td className="py-1 pr-3 text-right">{Math.round((l.erros / l.chamadas) * 100)}%</td>
                      <td className="py-1 text-right">{dolar(l.custoCentavos)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-[#6F6A5E]">Nenhuma chamada de IA no período.</p>
          )}
        </div>
      )}
    </section>
  );
}

function Campo({ item, aoSalvar }: { item: IntegracaoNaTela; aoSalvar: (l: IntegracaoNaTela[]) => void }) {
  const [valor, setValor] = useState("");
  const [busy, setBusy] = useState(false);
  const [erro, setErro] = useState("");

  async function salvar(novo: string) {
    setBusy(true);
    setErro("");
    const r = await salvarIntegracao(await tokenAtual(), item.nome, novo).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setErro(r?.error ?? "Não foi possível salvar agora.");
    setValor("");
    aoSalvar(r.dados);
  }

  const id = `ajuste-${item.nome}`;
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        if (valor.trim()) salvar(valor);
      }}
    >
      <label htmlFor={id} className="text-xs font-medium text-[#17150F]">
        {item.rotulo} <span className="font-normal text-[#8B8578]">· {item.nome}</span>
      </label>
      {/* opcional vazio (reserva, endereço extra) não é problema: cinza, não vermelho */}
      <p className={`text-xs ${item.origem === "nenhuma" && !item.opcional ? "text-[#8A2F2F]" : "text-[#6F6A5E]"}`}>
        {item.origem === "nenhuma" && item.opcional ? "Opcional · não configurado" : ORIGEM[item.origem]}
        {item.mostra && <span className="ml-1.5 font-mono text-[#17150F]">{item.mostra}</span>}
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          id={id}
          type={item.secreta ? "password" : "text"}
          autoComplete={item.secreta ? "new-password" : "off"}
          spellCheck={false}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder={item.origem === "nenhuma" ? "Cole aqui" : "Novo valor"}
          className="h-11 min-w-0 flex-1 rounded-[10px] border border-[#D8D2C6] px-3 font-mono text-sm"
        />
        <button type="submit" disabled={busy || !valor.trim()} className={BOTAO_ESCURO}>
          {busy ? "Salvando…" : "Salvar"}
        </button>
        {item.origem === "painel" && (
          <button type="button" disabled={busy} onClick={async () => {
              const texto = "Volta a valer o .env do servidor, se ele tiver essa chave; sem ele, o serviço para.";
              if (await confirmar({ titulo: `Remover ${item.rotulo.toLowerCase()}?`, texto, acao: "Remover" })) salvar("");
            }} className={BOTAO_CLARO}>
            Remover
          </button>
        )}
      </div>
      {erro && <p className="text-xs text-[#8A2F2F]">{erro}</p>}
    </form>
  );
}

/** Manda um SMS de verdade (gasta um crédito) para conferir a chave logo depois de cadastrar. */
function TesteSms({ pronto }: { pronto: boolean }) {
  const [telefone, setTelefone] = useState("");
  const [tocado, setTocado] = useState(false);
  const [busy, setBusy] = useState(false);
  // a mesma regra do envio (numeroSms): só celular, com DDD; o erro aparece ao sair do campo
  // ou quando o número já tem dígitos suficientes, não a cada tecla do começo
  const digitos = telefone.replace(/\D/g, "");
  const erro = !digitos || numeroSms(telefone) ? "" : digitos.length < 10 ? "Informe o número com DDD." : digitos[0] === "0" ? "DDD inválido." : "Fixo não recebe SMS: use um celular (9 depois do DDD).";
  // 10 dígitos sem o 9 depois do DDD já é fixo; com o 9, a pessoa ainda está digitando
  const mostraErro = !!erro && (tocado || digitos.length >= 11 || (digitos.length === 10 && digitos[2] !== "9"));
  const valido = !!digitos && !erro;
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);

  async function enviar() {
    setBusy(true);
    setResultado(null);
    const r = await testarSms(await tokenAtual(), telefone).catch(() => null);
    setBusy(false);
    if (!r?.ok) return setResultado({ ok: false, texto: r?.error ?? "Não foi possível enviar agora." });
    setResultado({ ok: true, texto: `Enviado. Confira o celular${r.dados ? ` (id na Comtele: ${r.dados})` : ""}.` });
  }

  return (
    <form
      className="flex flex-col gap-1.5 border-t border-[#EDE9E1] pt-4"
      onSubmit={(e) => {
        e.preventDefault();
        setTocado(true);
        if (valido) enviar();
      }}
    >
      <label htmlFor="teste-sms" className="text-xs font-medium text-[#17150F]">
        Testar envio
      </label>
      <p className="text-xs text-[#6F6A5E]">{pronto ? "Manda um SMS de teste para o celular informado. Gasta um crédito." : "Cadastre a chave acima para testar."}</p>
      <div className="flex flex-wrap gap-2">
        <input
          id="teste-sms"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={telefone}
          onChange={(e) => {
            setTelefone(formatPhone(e.target.value));
            setResultado(null);
          }}
          onBlur={() => setTocado(true)}
          maxLength={15}
          placeholder="(91) 98888-7777"
          disabled={!pronto}
          aria-invalid={mostraErro}
          aria-describedby={mostraErro ? "teste-sms-erro" : undefined}
          className={`h-11 min-w-0 flex-1 rounded-[10px] border px-3 text-base tabular-nums disabled:opacity-50 ${mostraErro ? "border-[#8A2F2F]" : valido ? "border-[#2C6A53]" : "border-[#D8D2C6]"}`}
        />
        <button type="submit" disabled={!pronto || busy || !valido} className={BOTAO_CLARO}>
          {busy ? "Enviando…" : "Enviar teste"}
        </button>
      </div>
      {mostraErro && (
        <p id="teste-sms-erro" role="alert" className="text-xs text-[#8A2F2F]">
          {erro}
        </p>
      )}
      {resultado && (
        <p role="status" className={`text-xs ${resultado.ok ? "text-[#2C6A53]" : "text-[#8A2F2F]"}`}>
          {resultado.texto}
        </p>
      )}
    </form>
  );
}

/** Manda um e-mail de verdade para conferir o envio (e se ele chega, inclusive fora do spam). */
function TesteEmail({ sugestao, rotulo, ajuda, canais = false }: { sugestao: string; rotulo: string; ajuda: string; canais?: boolean }) {
  const [para, setPara] = useState(sugestao);
  const [canal, setCanal] = useState<"auto" | "resend" | "gmail">("auto");
  const [busy, setBusy] = useState(false);
  const [resultado, setResultado] = useState<{ ok: boolean; texto: string } | null>(null);
  const id = `teste-${rotulo.replace(/\W+/g, "-")}`;
  return (
    <form
      className="flex flex-col gap-1.5 border-t border-[#EFEBE3] pt-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setResultado(null);
        const r = await testarEmail(await tokenAtual(), para, canal).catch(() => null);
        setBusy(false);
        setResultado(r?.ok ? { ok: true, texto: `Enviado para ${r.dados}. Confira a caixa de entrada (e o spam).` } : { ok: false, texto: r?.error ?? "Não foi possível enviar agora." });
      }}
    >
      <label htmlFor={id} className="text-xs font-medium text-[#17150F]">{rotulo}</label>
      <p className="text-xs text-[#6F6A5E]">{ajuda}</p>
      <div className="flex flex-wrap gap-2">
        {/* o canal numa linha só dele: ao lado, espremia o campo do destinatário */}
        {canais && (
          <select aria-label="Por qual canal" value={canal} onChange={(e) => setCanal(e.target.value as typeof canal)} className="h-11 basis-full rounded-[10px] border border-[#D8D2C6] bg-white px-2 text-sm">
            <option value="auto">Automático (Resend, reserva Gmail)</option>
            <option value="resend">Só o Resend</option>
            <option value="gmail">Só o Gmail de reserva</option>
          </select>
        )}
        <input id={id} type="email" value={para} onChange={(e) => setPara(e.target.value)} placeholder="voce@exemplo.com" className="h-11 min-w-0 flex-1 rounded-[10px] border border-[#D8D2C6] px-3 text-sm" />
        <button type="submit" disabled={busy || !para.trim()} className={BOTAO_CLARO}>{busy ? "Enviando…" : "Enviar teste"}</button>
      </div>
      {resultado && <p role="status" className={`text-xs ${resultado.ok ? "text-[#1F5A3A]" : "text-[#8A2F2F]"}`}>{resultado.texto}</p>}
    </form>
  );
}
