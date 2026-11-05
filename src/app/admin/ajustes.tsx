"use client";

import { useEffect, useState } from "react";
import { confirmar } from "@/components/confirmar";
import { numeroSms } from "@/lib/comtele";
import { formatPhone } from "@/lib/datetime";
import { idToken as tokenAtual } from "@/lib/firebase";
import type { IntegracaoNaTela } from "@/lib/integracoes.server";
import type { Situacao } from "@/lib/verificar-integracoes.server";
import { lerIntegracoes, salvarIntegracao, testarEmail, testarSms, verificarAjustes } from "./actions";

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
    </div>
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
