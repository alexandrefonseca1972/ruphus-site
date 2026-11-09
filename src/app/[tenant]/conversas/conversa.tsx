"use client";

import { ArrowLeft, Paperclip, Send } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, buttonVariants } from "@/components/ui/button";
import type { ConversaInbox, MensagemInbox, RespostaInbox } from "@/lib/atendys";
import { formatTime } from "@/lib/datetime";
import { idToken } from "@/lib/firebase";
import { avisoDoEnvio, type ClienteDoCadastro, janelaRestante, nomeDaConversa, novaChave, POR_QUE_NAO_RESPONDE, ROTULO_STATUS, telefoneLegivel } from "@/lib/conversas";
import { cn } from "@/lib/utils";
import { marcarConversaAction, mensagensDaConversaAction, responderConversaAction } from "../actions";
import { useTenant } from "../painel-layout";
import { PlanForm } from "../plan-form";
import { Midia } from "./midia";

const hora = (iso: string) => formatTime(new Date(iso));
const diaEHora = (iso: string) => {
  const d = new Date(iso);
  const hoje = new Date().toDateString() === d.toDateString();
  return hoje ? formatTime(d) : `${d.toLocaleDateString("pt-BR", { day: "numeric", month: "short" })}, ${formatTime(d)}`;
};

/** Da mais antiga para a mais nova pela hora; no mesmo instante, a ordem que o atendys mandou. */
const emOrdem = (lista: MensagemInbox[]) => lista.map((m, i) => ({ m, i, t: Date.parse(m.at) })).sort((a, b) => a.t - b.t || a.i - b.i).map((x) => x.m);

type Envio = { texto: string; resposta: RespostaInbox };

export function Conversa({
  conversa,
  cliente,
  onVoltar,
  onMudou,
  atualizar,
}: {
  conversa: ConversaInbox;
  cliente?: ClienteDoCadastro;
  onVoltar: () => void;
  /** a lista recarrega: lida, resposta enviada */
  onMudou: () => void;
  /** muda quando a lista é recarregada: a conversa aberta recarrega junto */
  atualizar: number;
}) {
  const tenant = useTenant();
  const [mensagens, setMensagens] = useState<MensagemInbox[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [erro, setErro] = useState("");
  const [carregandoMais, setCarregandoMais] = useState(false);
  const [texto, setTexto] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [erroEnvio, setErroEnvio] = useState("");
  const [ultimoEnvio, setUltimoEnvio] = useState<Envio | null>(null);
  const [agendar, setAgendar] = useState(false);
  // uma chave por mensagem composta: o duplo clique repete a mesma e o atendys não duplica
  const chave = useRef(novaChave());
  const fim = useRef<HTMLDivElement>(null);
  const titulo = useRef<HTMLHeadingElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);

  const buscar = useCallback(
    async (depois?: string) => mensagensDaConversaAction(await idToken(), { tenantId: tenant.id, conversa: conversa.id, cursor: depois, limite: 30 }),
    [tenant.id, conversa.id],
  );
  const aplicar = useCallback((r: Awaited<ReturnType<typeof buscar>>, depois?: string) => {
    if (!r.ok) {
      setErro(r.error);
      return;
    }
    setErro("");
    // o atendys manda a mais nova primeiro; a tela mostra de cima (antiga) para baixo (nova)
    const lote = [...r.pagina.items].reverse();
    setMensagens((atual) => emOrdem(depois && atual ? [...lote, ...atual.filter((m) => !lote.some((x) => x.id === m.id))] : lote));
    // recarregar a página mais nova não perde o ponto onde "anteriores" parou
    setCursor((c) => (depois ? r.pagina.nextCursor : (c ?? r.pagina.nextCursor)));
  }, []);
  const carregar = useCallback(async (depois?: string) => aplicar(await buscar(depois), depois), [buscar, aplicar]);

  // abrir (a lista monta uma por conversa, key): histórico e "lida" (o contador da lista zera)
  useEffect(() => {
    titulo.current?.focus({ preventScroll: true });
    let vivo = true;
    void buscar().then((r) => vivo && aplicar(r));
    if (conversa.unreadCount > 0 || conversa.manuallyUnread) {
      void idToken()
        .then((t) => marcarConversaAction(t, { tenantId: tenant.id, conversa: conversa.id, lida: true }))
        .then((r) => r.ok && onMudou());
    }
    return () => {
      vivo = false;
    };
    // só ao abrir
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // a lista recarregou (tempo ou resposta): o histórico aberto acompanha
  useEffect(() => {
    if (!atualizar) return;
    let vivo = true;
    void buscar().then((r) => vivo && aplicar(r));
    return () => {
      vivo = false;
    };
  }, [atualizar, buscar, aplicar]);

  // nova mensagem embaixo: rola até ela
  const ultima = mensagens?.at(-1)?.id;
  useEffect(() => {
    // rola só a caixa da conversa: scrollIntoView arrastava a página inteira no celular
    const caixa = fim.current?.parentElement;
    if (caixa) caixa.scrollTop = caixa.scrollHeight;
  }, [ultima]);

  const nome = nomeDaConversa(conversa, cliente);
  const restante = janelaRestante(conversa.replyWindowEndsAt);
  const bloqueio = conversa.canReply ? null : conversa.replyBlockedReason;

  async function enviar() {
    if (enviando || (!texto.trim() && !arquivo)) return;
    setEnviando(true);
    setErroEnvio("");
    try {
      let r: { ok: true; envio: RespostaInbox } | { ok: false; error: string };
      if (arquivo) {
        const f = new FormData();
        f.set("conversa", conversa.id);
        f.set("chave", chave.current);
        f.set("arquivo", arquivo);
        if (texto.trim()) f.set("legenda", texto.trim());
        const res = await fetch(`/api/conversas/${encodeURIComponent(tenant.id)}/responder-arquivo`, { method: "POST", headers: { authorization: `Bearer ${await idToken()}` }, body: f });
        r = await res.json().catch(() => ({ ok: false as const, error: "Não foi possível enviar o arquivo agora." }));
      } else {
        r = await responderConversaAction(await idToken(), { tenantId: tenant.id, conversa: conversa.id, texto, chave: chave.current });
      }
      if (!r.ok) {
        setErroEnvio(r.error);
        return;
      }
      setUltimoEnvio({ texto: texto.trim() || arquivo?.name || "", resposta: r.envio });
      setTexto("");
      setArquivo(null);
      chave.current = novaChave();
      await carregar();
      onMudou();
      campo.current?.focus();
    } catch {
      setErroEnvio("Sem conexão com o servidor. Confira a internet e tente de novo: a mesma mensagem não sai duas vezes.");
    } finally {
      setEnviando(false);
    }
  }

  const aviso = ultimoEnvio && avisoDoEnvio(ultimoEnvio.resposta, hora);

  return (
    <section aria-label={`Conversa com ${nome}`} className="flex min-h-0 flex-col rounded-xl border bg-card max-lg:h-[calc(100dvh-14rem)] max-lg:min-h-[26rem]">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b p-3 sm:p-4">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onVoltar} aria-label="Voltar para a lista">
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 ref={titulo} tabIndex={-1} className="truncate font-semibold outline-none">{nome}</h2>
          <p className="truncate text-sm text-muted-foreground">{telefoneLegivel(conversa.contactPhone)}</p>
        </div>
        <div className="flex flex-wrap gap-2 max-sm:basis-full">
          {cliente && (
            <Link href={`/${tenant.id}/clientes/${encodeURIComponent(cliente.key)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              Ver cliente e horários
            </Link>
          )}
          {conversa.contactPhone && (
            <Button variant="outline" size="sm" onClick={() => setAgendar(true)}>
              Novo agendamento
            </Button>
          )}
        </div>
      </header>

      {agendar && conversa.contactPhone && (
        <PlanForm tenantId={tenant.id} customer={{ name: cliente?.name ?? conversa.contactName ?? "", phone: conversa.contactPhone.replace(/^55/, "") }} onClose={() => setAgendar(false)} />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4" aria-live="polite" aria-busy={mensagens === null}>
        {erro && (
          <p role="alert" className="mb-3 text-sm text-destructive">
            {erro}
          </p>
        )}
        {mensagens === null && !erro && <p className="text-sm text-muted-foreground">Carregando a conversa…</p>}
        {cursor && mensagens && (
          <div className="mb-3 text-center">
            <Button
              variant="ghost"
              size="sm"
              disabled={carregandoMais}
              onClick={async () => {
                setCarregandoMais(true);
                await carregar(cursor);
                setCarregandoMais(false);
              }}
            >
              {carregandoMais ? "Carregando…" : "Mensagens anteriores"}
            </Button>
          </div>
        )}
        <ol className="grid gap-2">
          {mensagens?.map((m) => (
            <li key={m.id} className={cn("flex", m.direction === "out" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "grid max-w-[85%] gap-1 rounded-2xl px-3 py-2 text-[15px] sm:max-w-[70%]",
                  m.direction === "out" ? "rounded-br-sm bg-primary text-primary-foreground" : "rounded-bl-sm bg-muted",
                )}
              >
                {m.deleted ? (
                  <p className="italic opacity-80">Mensagem apagada</p>
                ) : (
                  <>
                    {m.attachment && <Midia tenantId={tenant.id} mensagemId={m.id} anexo={m.attachment} />}
                    {m.text && <p className="break-words whitespace-pre-wrap">{m.text}</p>}
                  </>
                )}
                <p className={cn("flex flex-wrap items-center justify-end gap-x-2 text-xs", m.direction === "out" ? "text-primary-foreground/75" : "text-muted-foreground")}>
                  {m.origin === "ai" && <span>Resposta automática</span>}
                  {m.edited && !m.deleted && <span>editada</span>}
                  <time dateTime={m.at}>{diaEHora(m.at)}</time>
                  {m.direction === "out" && m.status && <span className={cn(m.status === "failed" && "font-semibold")}>{ROTULO_STATUS[m.status]}</span>}
                </p>
                {!!m.reactions?.length && <p aria-label="Reações">{m.reactions.map((r) => r.emoji).join(" ")}</p>}
              </div>
            </li>
          ))}
        </ol>
        {mensagens?.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma mensagem nesta conversa.</p>}
        <div ref={fim} />
      </div>

      <div className="grid gap-2 border-t p-3 sm:p-4">
        {bloqueio ? (
          <p role="status" className="rounded-lg bg-muted px-3 py-2 text-sm">
            {POR_QUE_NAO_RESPONDE[bloqueio]}
          </p>
        ) : (
          restante && <p className="text-xs text-muted-foreground">Dá para responder por mais {restante} (janela de 24 h do WhatsApp).</p>
        )}
        {aviso && (
          <div role="status" className="grid gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100">
            <p>{aviso}</p>
            {ultimoEnvio?.resposta.manualHandoffUrl && (
              <a href={ultimoEnvio.resposta.manualHandoffUrl} target="_blank" rel="noopener" className="font-medium underline underline-offset-4">
                Enviar pelo WhatsApp
              </a>
            )}
          </div>
        )}
        {erroEnvio && (
          <p role="alert" className="text-sm text-destructive">
            {erroEnvio}
          </p>
        )}
        {!bloqueio && (
          <form
            className="grid gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void enviar();
            }}
          >
            {arquivo && (
              <p className="flex items-center gap-2 text-sm">
                <Paperclip className="size-4" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{arquivo.name}</span>
                <Button type="button" variant="ghost" size="sm" onClick={() => setArquivo(null)}>
                  Tirar
                </Button>
              </p>
            )}
            <div className="flex items-end gap-2">
              <label className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-lg border hover:bg-muted has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50 max-sm:size-11">
                <Paperclip className="size-4" aria-hidden="true" />
                <span className="sr-only">Anexar foto, áudio, vídeo ou documento</span>
                <input
                  type="file"
                  className="sr-only"
                  accept="image/*,audio/*,video/*,application/pdf"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    e.target.value = "";
                    if (f && f.size > 12 * 1024 * 1024) {
                      setErroEnvio("Arquivo acima de 12 MB. Envie um menor.");
                      return;
                    }
                    setErroEnvio("");
                    setArquivo(f);
                  }}
                />
              </label>
              <label htmlFor="resposta" className="sr-only">
                {arquivo ? "Legenda (opcional)" : "Sua resposta"}
              </label>
              <textarea
                id="resposta"
                ref={campo}
                value={texto}
                rows={1}
                maxLength={arquivo ? 1024 : 4096}
                placeholder={arquivo ? "Legenda (opcional)" : "Escreva a resposta"}
                onChange={(e) => setTexto(e.target.value)}
                onKeyDown={(e) => {
                  // Enter envia; Shift+Enter quebra a linha (no celular o teclado não tem Enter de enviar)
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && matchMedia("(pointer: fine)").matches) {
                    e.preventDefault();
                    void enviar();
                  }
                }}
                className="max-h-40 min-h-10 flex-1 resize-y rounded-lg border bg-background px-3 py-2 text-[15px] outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 max-sm:min-h-11"
              />
              <Button type="submit" size="icon-lg" disabled={enviando || (!texto.trim() && !arquivo)} aria-label={enviando ? "Enviando" : "Enviar"}>
                <Send />
              </Button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
