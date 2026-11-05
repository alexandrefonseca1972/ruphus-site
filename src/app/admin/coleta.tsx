"use client";

import { confirmar } from "@/components/confirmar";
import { ehVersaoAntiga, esperaDe, RECONECTOU, recarregarUmaVez } from "@/lib/conexao";
import { idToken as tokenAtual } from "@/lib/firebase";

/** O token na hora de cada chamada: o SDK devolve um válido e renova sozinho se venceu.
 *  Guardado num estado, ele vencia em 1 h com a aba em segundo plano ou o computador
 *  dormindo, e a lista passava a dar "Sessão expirada" (e "Nenhum worker no ar"). */
const tokenFresco = () => tokenAtual();

/** Falha de uma ação: aba de versão anterior recarrega; o resto vira null (a tela diz que falhou). */
const versaoOuNada = (e: unknown) => {
  if (ehVersaoAntiga(e)) recarregarUmaVez();
  return null;
};
import { useEffect, useState } from "react";
import { NumeroVivo } from "@/components/numero-vivo";
import { type Amostra, anotar, duracao, faltam, porcentagem, ritmo } from "@/lib/coleta-tempo";
import { desmarcar, marcarTodas, sortear } from "@/lib/coleta-selecao";
import { CAPITAIS, LIMITES, problemaNoPedido, TERMOS_PADRAO, UFS, type Uf } from "@/lib/coleta";
import type { LinhaGerada } from "@/lib/gerador.server";
import { cancelarColeta, type Coleta, devolverAGeracao, desligarWorker, type LinhaDaPrevia, tirarDaGeracao, excluirColeta, gerarLoteDaColeta, ligarWorker, type WorkerLocal, jaTemosNaCidade, municipios, painelColeta, pedirColeta, previaDaColeta, recolocarColeta, type Worker } from "./coleta-actions";

// Coleta de leads no Google Maps: o admin escolhe estado e cidade e põe na fila; um
// worker com navegador (npm run coletar -- --fila, neste Mac ou numa VPS) coleta e
// devolve os novos já separados. Daqui mesmo eles viram sites, sem planilha.

const BOTAO = "h-10 rounded-[10px] px-4 text-[13px] font-semibold";
const CAMPO = "h-10 rounded-[10px] border border-[#D8D2C6] bg-white px-3 text-[13px] outline-none focus:border-[#17150F]";
const MINI = "h-8 rounded-lg border border-[#D8D2C6] bg-white px-2.5 font-semibold hover:border-[#17150F] disabled:opacity-40 disabled:hover:border-[#D8D2C6]";
const SEM_SINAL_MS = 3 * 60_000; // o worker dá sinal a cada 20 s enquanto coleta e a cada 30 s parado

// A lista em blocos, na ordem em que pedem atenção. A nota do bloco diz uma vez o que
// antes se repetia em cada cartão da fila.
const GRUPOS: [string, Coleta["estado"][], ((semWorker: boolean) => string) | null][] = [
  ["Em andamento", ["coletando"], null],
  ["Na fila", ["fila"], (semWorker) => (semWorker ? "Param até o worker ser ligado (aviso no topo)." : "Começam sozinhas, uma por vez, na ordem abaixo.")],
  ["Para gerar", ["pronta", "gerando"], null],
  ["Com erro", ["erro"], null],
  ["Encerradas", ["concluida", "cancelada"], null],
];

const ESTADOS: Record<Coleta["estado"], [string, string]> = {
  fila: ["Na fila", "bg-[#F1EEE7] text-[#6F6A5E]"],
  coletando: ["Coletando", "bg-[#EAF0F7] text-[#2F4E73]"],
  pronta: ["Pronta para gerar", "bg-[#FBF3E4] text-[#7A5A2E]"],
  gerando: ["Gerando sites", "bg-[#FBF3E4] text-[#7A5A2E]"],
  concluida: ["Sites gerados", "bg-[#EFF5F1] text-[#235B45]"],
  erro: ["Erro", "bg-[#FBEFEB] text-[#8A3A22]"],
  cancelada: ["Cancelada", "bg-[#F1EEE7] text-[#8B8578]"],
};

function haQuanto(ms: number | null, agora: number) {
  if (!ms) return "nunca";
  const s = Math.max(0, Math.round((agora - ms) / 1000));
  return s < 60 ? `há ${s} s` : s < 3600 ? `há ${Math.round(s / 60)} min` : s < 86_400 ? `há ${Math.round(s / 3600)} h` : `há ${Math.round(s / 86_400)} d`;
}
const lista = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
const qtd = (n: number, um: string, varios: string) => `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;
const SEG_POR_FICHA = 6;

const TONS = {
  erro: "border-[#E3C6BD] bg-[#FBEFEB] text-[#8A3A22]",
  atencao: "border-[#E9D9B8] bg-[#FBF3E4] text-[#7A5A2E]",
};
function Alerta({ tom, children, fechar }: { tom: keyof typeof TONS; children: React.ReactNode; fechar?: () => void }) {
  return (
    <div role={tom === "erro" ? "alert" : "status"} className={`flex items-start gap-3 rounded-xl border p-3 text-[13px] ${TONS[tom]}`}>
      <p className="flex-1">{children}</p>
      {fechar && (
        <button type="button" onClick={fechar} aria-label="Fechar aviso" className="-m-1 rounded p-1 leading-none opacity-70 hover:opacity-100">×</button>
      )}
    </div>
  );
}

/** Sem acento e minúsculo: "sao cristovao" acha "São Cristóvão". */
const chave = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export function ColetaMaps({ idToken, aoGerar }: { idToken: string; aoGerar: (slugs: string[]) => void }) {
  const [coletas, setColetas] = useState<Coleta[] | null>(null);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [local, setLocal] = useState<WorkerLocal | null>(null);
  const [ligando, setLigando] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());
  const [erro, setErro] = useState("");
  // falha ao atualizar a lista: some sozinha quando a próxima atualização der certo
  const [erroPainel, setErroPainel] = useState("");

  const [uf, setUf] = useState<Uf | "">("");
  const [cidades, setCidades] = useState<string[]>([]);
  const [busca, setBusca] = useState("");
  const [escolhidas, setEscolhidas] = useState<string[]>([]);
  const [sorteio, setSorteio] = useState(5);
  const [jaTemos, setJaTemos] = useState<Record<string, number>>({});
  const [bairros, setBairros] = useState("");
  const [termos, setTermos] = useState(TERMOS_PADRAO.join(", "));
  const [enviando, setEnviando] = useState(false);
  const [aviso, setAviso] = useState("");
  const [alerta, setAlerta] = useState("");

  // depois de pedir, cancelar ou gerar, recarrega na hora em vez de esperar o próximo ciclo
  const [versao, setVersao] = useState(0);
  const atualizar = () => setVersao((v) => v + 1);

  // andamento ao vivo: de 15 em 15 s com coleta em curso, de minuto em minuto sem
  const emCurso = (coletas?.some((c) => c.estado === "fila" || c.estado === "coletando") ?? false) || ligando;
  useEffect(() => {
    if (!idToken) return;
    let atual = true;
    let falhas = 0;
    let t: ReturnType<typeof setTimeout> | undefined;
    const proxima = (ms: number) => {
      clearTimeout(t);
      t = setTimeout(carregar, ms);
    };
    function carregar() {
      tokenFresco().then((tk) => painelColeta(tk)).then(
        (r) => {
          if (!atual) return;
          falhas = 0;
          proxima(emCurso ? 15_000 : 60_000);
          if (!r.ok) return setErroPainel(`Não consegui atualizar a lista: ${r.error}`);
          setErroPainel("");
          setColetas(r.dados.coletas);
          setWorkers(r.dados.workers);
          setLocal(r.dados.local);
          setAgora(Date.now());
        },
        (e) => {
          if (!atual) return;
          // a aba é de antes de um deploy: a ação mudou de id; recarrega a página
          if (ehVersaoAntiga(e) && recarregarUmaVez()) return setErroPainel("Versão nova no ar. Recarregando…");
          // queda de rede ou app reiniciando: tenta de novo com espera crescente (e já ao reconectar)
          falhas += 1;
          setErroPainel(`Sem conexão com o servidor. Nova tentativa em ${Math.round(esperaDe(falhas) / 1000)} s.`);
          proxima(esperaDe(falhas));
        },
      );
    }
    carregar();
    const reconectou = () => carregar();
    window.addEventListener(RECONECTOU, reconectou);
    return () => {
      atual = false;
      clearTimeout(t);
      window.removeEventListener(RECONECTOU, reconectou);
    };
  }, [idToken, emCurso, versao]);

  async function ligarOuDesligar() {
    setErro("");
    setLigando(true);
    const r = await (local?.ligado ? desligarWorker(await tokenFresco()) : ligarWorker(await tokenFresco())).catch(versaoOuNada);
    setLigando(false);
    if (!r) return setErro("A conexão falhou. Tente de novo.");
    if (!r.ok) return setErro(r.error);
    setLocal(r.dados);
    if (r.dados.ligado) setAviso("Worker ligando: em alguns segundos ele aparece no ar e pega a fila.");
    atualizar();
  }

  async function escolherUf(v: Uf | "") {
    setUf(v);
    setAviso("");
    setAlerta("");
    setErro("");
    setBusca("");
    setEscolhidas([]);
    setCidades([]);
    if (!v) return;
    const r = await tokenFresco().then((tk) => municipios(tk, v)).catch(versaoOuNada);
    if (r?.ok) setCidades(r.dados);
    else setErro(r?.error ?? "Não consegui carregar as cidades. Escolha o estado de novo para tentar outra vez.");
  }

  /** Quantos negócios já temos em cada cidade nova: de 5 em 5, para marcar 50 de uma vez não
   *  disparar 50 consultas juntas. */
  async function contar(novas: string[]) {
    if (!uf) return;
    const faltam = novas.filter((c) => !(c in jaTemos));
    for (let i = 0; i < faltam.length; i += 5) {
      const lote = faltam.slice(i, i + 5);
      const tk = await tokenFresco().catch(() => "");
      const rs = await Promise.all(lote.map((c) => jaTemosNaCidade(tk, c, uf).catch(versaoOuNada)));
      setJaTemos((j) => ({ ...j, ...Object.fromEntries(lote.flatMap((c, k) => (rs[k]?.ok ? [[c, rs[k].dados]] : []))) }));
    }
  }

  async function alternar(cidade: string) {
    setAviso("");
    if (escolhidas.includes(cidade)) return setEscolhidas((xs) => xs.filter((x) => x !== cidade));
    if (escolhidas.length >= LIMITES.cidades) return setAlerta(`Cabem ${LIMITES.cidades} cidades por pedido. Ponha estas na fila e peça as outras depois.`);
    setEscolhidas((xs) => [...xs, cidade]);
    await contar([cidade]);
  }

  /** Marcar todas, desmarcar ou sortear: sempre sobre as cidades visíveis (a busca filtra). */
  function emMassa(nova: string[], aviso = "") {
    setAviso("");
    setAlerta(aviso);
    setEscolhidas(nova);
    void contar(nova.filter((c) => !escolhidas.includes(c)));
  }

  async function pedir() {
    if (!uf || problema) return setErro(problema || "Escolha o estado.");
    setEnviando(true);
    setErro("");
    setAviso("");
    setAlerta("");
    const r = await tokenFresco().then((tk) => pedirColeta(tk, { uf, ...pedido })).catch(versaoOuNada);
    setEnviando(false);
    if (!r) return setErro("A conexão falhou e o pedido não foi enviado. Confira a internet e tente de novo.");
    if (!r.ok) return setErro(r.error);
    const { criadas, jaNaFila } = r.dados;
    if (criadas.length) setAviso(`${qtd(criadas.length, "cidade entrou", "cidades entraram")} na fila.`);
    if (jaNaFila.length)
      setAlerta(`${jaNaFila.join(", ")} já ${jaNaFila.length === 1 ? "estava" : "estavam"} na fila e não ${jaNaFila.length === 1 ? "foi pedida" : "foram pedidas"} de novo. Para mudar bairros ou termos, cancele o pedido abaixo e peça outra vez.`);
    setEscolhidas([]);
    setBairros("");
    atualizar();
  }

  const capital = uf ? CAPITAIS[uf] : "";
  // a capital sempre no topo; o resto em ordem alfabética, filtrado pela busca
  const visiveis = cidades.filter((c) => chave(c).includes(chave(busca.trim()))).sort((a, b) => Number(b === capital) - Number(a === capital));
  const vivos = workers.filter((w) => w.batidaEm && agora - w.batidaEm < SEM_SINAL_MS);
  const varias = escolhidas.length > 1;
  const pedido = { cidades: escolhidas, bairros: varias ? [] : lista(bairros), termos: lista(termos) };
  // conferido aqui antes de enviar, com as mesmas regras do servidor
  const problema = escolhidas.length ? problemaNoPedido(pedido) : "";
  const nTermos = pedido.termos.length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <h2 className="font-[family-name:var(--fonte-serifa)] text-[26px] leading-none">Coletar leads</h2>
        <p className="max-w-[68ch] text-[13px] text-[#6F6A5E]">
          Escolha as cidades e a coleta busca salões, barbearias, unhas, estética e sobrancelha no Google Maps, bairro a bairro, e já separa o que é novo do que já temos.
          Uma capital leva algumas horas; as cidades são coletadas uma de cada vez, na ordem escolhida. No fim, os novos viram sites daqui mesmo.
        </p>
      </div>

      <div className={`flex flex-wrap items-center gap-3 rounded-xl border p-3 text-[12.5px] ${vivos.length ? "border-[#CADCD1] bg-[#EFF5F1] text-[#235B45]" : "border-[#E9D9B8] bg-[#FBF3E4] text-[#7A5A2E]"}`}>
        <p className="min-w-0 flex-1">
          {vivos.length ? (
            <>Worker no ar: {vivos.map((w) => `${w.nome}${w.ocupado ? " (coletando)" : " (livre)"}`).join(", ")}.</>
          ) : local?.ligado ? (
            <>Worker ligando… Se não aparecer em 1 min, veja o log em <code className="font-mono break-all">{local.log}</code>.</>
          ) : local?.pode ? (
            <>Nenhum worker no ar: os pedidos esperam na fila.</>
          ) : (
            <>
              Nenhum worker no ar: os pedidos esperam na fila. Para coletar, rode{" "}
              <code className="rounded bg-white/70 px-1 font-mono whitespace-nowrap">npm run coletar -- --fila</code> no Mac (ou numa VPS) com o projeto e o agent-browser.
              Pelo site publicado não dá para ligar daqui: só pelo admin rodando nessa máquina.
            </>
          )}
        </p>
        {/* o botão some quando OUTRO worker está no ar (dois iguais disputariam a fila); o sinal
            velho do próprio worker daqui (parou sem conseguir apagá-lo) não esconde o Ligar */}
        {local?.pode && (local.ligado || vivos.every((w) => w.nome === local.nome)) && (
          <button
            type="button"
            disabled={ligando}
            onClick={async () =>
              (!local.ligado ||
                (await confirmar({ titulo: "Desligar o worker?", texto: "A coleta em andamento para e continua de onde parou quando ele for ligado de novo.", acao: "Desligar" }))) &&
              ligarOuDesligar()
            }
            className={`${BOTAO} shrink-0 border border-current bg-white disabled:opacity-50`}
          >
            {ligando ? "Aguarde…" : local.ligado ? "Desligar worker" : "Ligar worker"}
          </button>
        )}
      </div>

      <section aria-label="Nova coleta" className="flex flex-col gap-3 rounded-2xl border border-[#E2DDD3] bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
          <label className="flex flex-col gap-1 self-start text-[12px] font-semibold">
            Estado
            <select className={CAMPO} value={uf} onChange={(e) => escolherUf(e.currentTarget.value as Uf | "")}>
              <option value="">Escolha…</option>
              {Object.entries(UFS).map(([sigla, nome]) => (
                <option key={sigla} value={sigla}>{nome} ({sigla})</option>
              ))}
            </select>
          </label>

          <fieldset className="flex min-w-0 flex-col gap-1.5" disabled={!cidades.length}>
            <legend className="mb-1 text-[12px] font-semibold">Cidades</legend>
            {escolhidas.length > 0 && (
              <ul aria-label="Cidades escolhidas" className="flex flex-wrap gap-1.5">
                {escolhidas.map((c) => (
                  <li key={c}>
                    <button
                      type="button"
                      onClick={() => alternar(c)}
                      aria-label={`Tirar ${c}`}
                      className="flex h-8 items-center gap-1.5 rounded-full border border-[#D8D2C6] bg-[#FBFAF8] pr-2 pl-3 text-[12px] hover:border-[#17150F]"
                    >
                      <span className="font-semibold">{c}</span>
                      {c === capital && <span className="text-[10.5px] font-semibold text-[#7A5A2E] uppercase">capital</span>}
                      {c in jaTemos && <span className="text-[#8B8578]">· {jaTemos[c] ? `já temos ${jaTemos[c].toLocaleString("pt-BR")}` : "nenhum ainda"}</span>}
                      <span aria-hidden="true" className="text-[#8B8578]">×</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <input
              type="search"
              className={CAMPO}
              aria-label="Buscar cidade"
              placeholder={uf ? (cidades.length ? `Buscar entre ${cidades.length} cidades` : "Carregando…") : "Escolha o estado primeiro"}
              value={busca}
              onChange={(e) => setBusca(e.currentTarget.value)}
            />
            {cidades.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-[12px]" role="group" aria-label="Seleção em massa">
                {(() => {
                  const faltam = visiveis.filter((c) => !escolhidas.includes(c)).length;
                  const marcadasVisiveis = visiveis.length - faltam;
                  const cheio = escolhidas.length >= LIMITES.cidades;
                  const filtro = busca.trim() ? " visíveis" : "";
                  return (
                    <>
                      <button
                        type="button"
                        disabled={!faltam || cheio}
                        onClick={() => {
                          const { lista, cortadas } = marcarTodas(escolhidas, visiveis, LIMITES.cidades);
                          emMassa(lista, cortadas ? `Cabem ${LIMITES.cidades} cidades por pedido: ${qtd(cortadas, "ficou de fora", "ficaram de fora")}. Ponha estas na fila e peça as outras depois.` : "");
                        }}
                        className={MINI}
                      >
                        Marcar {faltam === visiveis.length ? "todas" : `as ${faltam} restantes`}{filtro}
                      </button>
                      <button type="button" disabled={!marcadasVisiveis} onClick={() => emMassa(desmarcar(escolhidas, visiveis))} className={MINI}>
                        Desmarcar{filtro ? `${filtro}` : " todas"}
                      </button>
                      <span className="flex items-center gap-1.5">
                        <button type="button" disabled={!faltam || cheio} onClick={() => emMassa(sortear(escolhidas, visiveis, sorteio, LIMITES.cidades))} className={MINI}>
                          Sortear
                        </button>
                        <select aria-label="Quantas cidades sortear" value={sorteio} onChange={(e) => setSorteio(Number(e.target.value))} className="h-8 rounded-lg border border-[#D8D2C6] bg-white px-1.5">
                          {[1, 3, 5, 10, 20].map((n) => (
                            <option key={n} value={n}>{n}</option>
                          ))}
                        </select>
                      </span>
                      <span className="ml-auto tabular-nums text-[#8B8578]" aria-live="polite">
                        {escolhidas.length} de {LIMITES.cidades} marcadas
                      </span>
                    </>
                  );
                })()}
              </div>
            )}
            {cidades.length > 0 && (
              <ul aria-label="Cidades do estado" className="max-h-60 overflow-y-auto rounded-[10px] border border-[#E2DDD3]">
                {visiveis.length === 0 && <li className="px-3 py-2 text-[12.5px] text-[#8B8578]">Nenhuma cidade com esse nome.</li>}
                {visiveis.map((c) => (
                  <li key={c} className={c === capital ? "border-b border-[#E2DDD3] bg-[#FBF3E4]/60" : ""}>
                    <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-[#FBFAF8]">
                      <input type="checkbox" className="size-4 accent-[#17150F]" checked={escolhidas.includes(c)} onChange={() => alternar(c)} />
                      <span className={c === capital ? "font-semibold" : ""}>{c}</span>
                      {c === capital && <span className="rounded-full bg-[#FBF3E4] px-2 py-0.5 text-[10.5px] font-semibold text-[#7A5A2E] uppercase">capital</span>}
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </fieldset>
        </div>

        <details className="text-[12.5px]">
          <summary className="cursor-pointer text-[#6F6A5E]">Bairros e termos (opcional)</summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-[12px] font-semibold">
              Bairros
              <textarea
                className={`${CAMPO} h-24 py-2 disabled:bg-[#F4F2EE] disabled:text-[#8B8578]`}
                disabled={varias}
                placeholder={varias ? "Com várias cidades, os bairros são descobertos sozinhos" : "Vazio: descobre sozinha os bairros com mais comércio de beleza"}
                value={varias ? "" : bairros}
                onChange={(e) => setBairros(e.currentTarget.value)}
              />
              <span className="font-normal text-[#6F6A5E]">{varias ? "Bairros só valem para uma cidade por vez." : "Um por linha ou separados por vírgula."}</span>
            </label>
            <label className="flex flex-col gap-1 text-[12px] font-semibold">
              Termos de busca
              <textarea className={`${CAMPO} h-24 py-2`} value={termos} onChange={(e) => setTermos(e.currentTarget.value)} />
              <span className={`font-normal ${nTermos > LIMITES.termos ? "text-[#8A3A22]" : "text-[#6F6A5E]"}`}>
                {nTermos ? `${qtd(nTermos, "termo", "termos")} de até ${LIMITES.termos}` : `Vazio: usa os ${TERMOS_PADRAO.length} padrão`}. Cada termo é buscado em cada bairro: mais termos, coleta mais longa.
              </span>
            </label>
          </div>
        </details>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" disabled={enviando || !escolhidas.length || !!problema} onClick={pedir} className={`${BOTAO} bg-[#17150F] text-white disabled:opacity-50`}>
            {enviando ? "Enviando…" : escolhidas.length > 1 ? `Pôr ${escolhidas.length} cidades na fila` : "Pôr na fila"}
          </button>
          {problema ? (
            <span className="text-[12.5px] font-semibold text-[#8A3A22]">{problema}</span>
          ) : aviso ? (
            <span role="status" className="text-[12.5px] font-semibold text-[#235B45]">{aviso}</span>
          ) : (
            !escolhidas.length && <span className="text-[12px] text-[#8B8578]">{uf ? "Marque uma ou mais cidades." : "Escolha o estado e as cidades."}</span>
          )}
        </div>

        {erro && <Alerta tom="erro" fechar={() => setErro("")}>{erro}</Alerta>}
        {alerta && <Alerta tom="atencao" fechar={() => setAlerta("")}>{alerta}</Alerta>}
      </section>

      {erroPainel && <Alerta tom="atencao">{erroPainel}</Alerta>}

      <section aria-label="Coletas" className="flex flex-col gap-5">
        {coletas === null ? (
          <p className="text-[13px] text-[#6F6A5E]">Carregando…</p>
        ) : coletas.length === 0 ? (
          <p className="text-[13px] text-[#6F6A5E]">Nenhuma coleta ainda.</p>
        ) : (
          GRUPOS.map(([titulo, estados, nota]) => {
            const itens = coletas.filter((c) => estados.includes(c.estado));
            if (!itens.length) return null;
            // a fila na ordem em que o worker atende (mais antiga primeiro); o resto, mais recente primeiro
            if (titulo === "Na fila") itens.sort((a, b) => (a.criadaEm ?? 0) - (b.criadaEm ?? 0));
            const cartoes = itens.map((c, i) => <Cartao key={c.id} c={c} agora={agora} posicao={titulo === "Na fila" ? i + 1 : null} aoMudar={atualizar} aoGerar={aoGerar} />);
            const cabecalho = (
              <>
                <span className="font-semibold text-[#17150F]">{titulo}</span>
                <span className="rounded-full bg-[#F1EEE7] px-2 py-0.5 text-[11px] font-semibold tabular-nums text-[#6F6A5E]">{itens.length}</span>
                {nota && <span className="text-[12px] text-[#8B8578]">{nota(!vivos.length)}</span>}
              </>
            );
            // encerradas recolhidas: são as mais numerosas e as que menos pedem ação
            return titulo === "Encerradas" ? (
              <details key={titulo} className="group flex flex-col gap-2">
                <summary className="flex cursor-pointer list-none items-center gap-2 text-[13px] [&::-webkit-details-marker]:hidden">
                  <span aria-hidden="true" className="text-[10px] text-[#8B8578] transition-transform group-open:rotate-90">▶</span>
                  {cabecalho}
                </summary>
                <div className="mt-2 flex flex-col gap-2">{cartoes}</div>
              </details>
            ) : (
              <div key={titulo} className="flex flex-col gap-2">
                <h3 className="flex items-center gap-2 text-[13px]">{cabecalho}</h3>
                {cartoes}
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}

function Cartao({ c, agora, posicao, aoMudar, aoGerar }: { c: Coleta; agora: number; posicao: number | null; aoMudar: () => void; aoGerar: (slugs: string[]) => void }) {
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const [previa, setPrevia] = useState<LinhaDaPrevia[] | null>(null);
  // o último tirado da geração, com a posição na lista: "Desfazer" devolve no mesmo lugar
  const [tirado, setTirado] = useState<{ linha: LinhaDaPrevia; pos: number } | null>(null);
  const [tirando, setTirando] = useState<string | null>(null);

  async function tirar(l: LinhaDaPrevia) {
    setTirando(l.leadId);
    setErro("");
    const r = await tokenFresco().then((tk) => tirarDaGeracao(tk, c.id, l.leadId)).catch(versaoOuNada);
    setTirando(null);
    if (!r) return setErro("Não foi possível tirar agora. Tente de novo.");
    if (!r.ok) return setErro(r.error);
    setTirado({ linha: l, pos: previa?.indexOf(l) ?? 0 });
    setPrevia((p) => p?.filter((x) => x.leadId !== l.leadId) ?? null);
    aoMudar();
  }

  async function desfazer() {
    if (!tirado) return;
    const { linha, pos } = tirado;
    setTirando(linha.leadId);
    const r = await tokenFresco().then((tk) => devolverAGeracao(tk, c.id, linha.leadId)).catch(versaoOuNada);
    setTirando(null);
    if (!r) return setErro("Não foi possível devolver agora. Tente de novo.");
    if (!r.ok) return setErro(r.error);
    setTirado(null);
    setPrevia((p) => (p ? [...p.slice(0, pos), linha, ...p.slice(pos)] : p));
    aoMudar();
  }
  const [gerando, setGerando] = useState<{ feitos: number; total: number } | null>(null);
  const [feito, setFeito] = useState<number | null>(null);
  const [rotulo, cor] = ESTADOS[c.estado];
  const semSinal = c.estado === "coletando" && (!c.batidaEm || agora - c.batidaEm > SEM_SINAL_MS);
  const p = c.progresso;
  // relógio próprio do cartão: o cronômetro anda de segundo em segundo, sem esperar a lista
  const [tique, setTique] = useState(() => Date.now());
  useEffect(() => {
    if (c.estado !== "coletando") return;
    const id = setInterval(() => setTique(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [c.estado]);
  // ritmo medido: uma amostra a cada atualização que chega do worker
  // (ajustada no render quando chega batida nova: é o padrão do React para estado que segue a prop)
  const [amostras, setAmostras] = useState<Amostra[]>([]);
  const [batidaVista, setBatidaVista] = useState<number | null>(null);
  if (p && c.batidaEm && c.batidaEm !== batidaVista) {
    setBatidaVista(c.batidaEm);
    setAmostras(anotar(amostras, p, c.batidaEm));
  }
  const porSegundo = ritmo(amostras, Math.max(tique, agora));
  const restaSeg = p ? faltam(p, porSegundo, p.etapa === "fichas" ? SEG_POR_FICHA : undefined) : null;
  const decorrido = c.iniciadaEm ? Math.max(tique, agora) - c.iniciadaEm : null;
  const pct = p ? porcentagem(p) : 0;

  async function acao<T>(fn: () => Promise<{ ok: true; dados: T } | { ok: false; error: string }>, depois?: (d: T) => void) {
    setOcupado(true);
    setErro("");
    const r = await fn().catch(versaoOuNada);
    setOcupado(false);
    if (!r) return setErro("Não foi possível agora. Tente de novo.");
    if (!r.ok) return setErro(r.error);
    depois?.(r.dados);
  }

  /** Um lote de 300 por chamada, até acabar; se um falhar, o botão continua do mesmo ponto. */
  async function gerar(aGerar: number) {
    if (!(await confirmar({ titulo: `Gerar ${qtd(aGerar, "site", "sites")} de ${c.cidade}?`, texto: "Eles entram no ar e no funil.", acao: "Gerar", tom: "normal" }))) return;
    setOcupado(true);
    setErro("");
    let feitos = 0;
    const gerados: string[] = [];
    for (;;) {
      const r = await tokenFresco().then((tk) => gerarLoteDaColeta(tk, c.id)).catch(versaoOuNada);
      if (!r || !r.ok) {
        setOcupado(false);
        setGerando(null);
        setErro(`${r ? r.error : "A conexão caiu."} O que já foi gerado fica; clique em continuar para seguir do mesmo ponto.`);
        aoGerar(gerados); // os lotes que saíram já entram na lista
        aoMudar();
        return;
      }
      const lote = r.dados.linhas.filter((l) => l.acao !== "pular");
      feitos += lote.length;
      gerados.push(...lote.map((l) => l.slug));
      setGerando({ feitos: r.dados.geradosAte, total: r.dados.total });
      if (r.dados.concluida) break;
    }
    setOcupado(false);
    setGerando(null);
    setFeito(feitos);
    aoGerar(gerados);
    aoMudar();
  }

  const conta = (a: LinhaGerada["acao"]) => previa?.filter((l) => l.acao === a).length ?? 0;
  const fixos = previa?.filter((l) => l.aviso?.includes("fixo")).length ?? 0;
  const aGerar = conta("criar") + conta("atualizar");
  const totalNovos = c.resumo?.novos ?? 0;

  return (
    <article className={`flex flex-col gap-2.5 rounded-2xl border border-[#E2DDD3] bg-white text-[12.5px] ${c.estado === "fila" ? "px-4 py-2.5" : "p-4"}`}>
      <div className="flex flex-wrap items-center gap-2">
        {posicao !== null && <span className="w-6 text-right text-[13px] tabular-nums text-[#8B8578]">{posicao}º</span>}
        <h4 className="text-[15px] font-semibold">{c.cidade}/{c.uf}</h4>
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cor}`}>{rotulo}</span>
        <span className="text-[#8B8578]">
          pedida {haQuanto(c.criadaEm, agora)} · {c.bairros.length ? qtd(c.bairros.length, "bairro", "bairros") : "bairros automáticos"} · {c.termos.join(", ")}
        </span>
        {/* na fila, o cartão é uma linha: o cancelar fica nela, sem rodapé */}
        {c.estado === "fila" && (
          <button type="button" disabled={ocupado} onClick={async () => (await confirmar({ titulo: `Cancelar a coleta de ${c.cidade}?`, texto: "O que já foi coletado fica guardado se ela for recolocada na fila.", acao: "Cancelar a coleta" })) && acao(async () => cancelarColeta(await tokenFresco(), c.id), aoMudar)} className={`${MINI} ml-auto text-[12px]`}>
            Cancelar
          </button>
        )}
      </div>

      {c.estado === "coletando" && (
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="font-semibold text-[#17150F]">
              {p ? `Etapa ${p.etapa === "busca" ? 1 : 2} de 2 · ${p.etapa === "busca" ? "Buscando no Maps" : "Lendo as fichas"}` : "Começando…"}
            </span>
            {/* cronômetro desde que o worker pegou a coleta */}
            {decorrido !== null && (
              <span className="flex items-center gap-1.5 tabular-nums text-[#6F6A5E]" aria-label={`Coletando há ${duracao(decorrido)}`}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="13" r="8" />
                  <path d="M12 9v4l2.5 2.5M9.5 2h5" />
                </svg>
                {duracao(decorrido)}
              </span>
            )}
          </div>
          {p && p.total > 0 && (
            <div className="flex items-center gap-3">
              <div
                className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-[#F1EEE7]"
                role="progressbar"
                aria-label={`Etapa ${p.etapa === "busca" ? 1 : 2} de 2`}
                aria-valuemin={0}
                aria-valuemax={p.total}
                aria-valuenow={p.feitas}
                aria-valuetext={`${pct}%: ${p.feitas} de ${p.total}`}
              >
                <div className="h-full rounded-full bg-[#2F4E73] transition-[width] duration-700 ease-out" style={{ width: `${pct}%` }} />
                {/* brilho correndo enquanto o worker trabalha (some sem sinal ou com menos movimento) */}
                {!semSinal && <div className="absolute inset-y-0 w-1/4 animate-[coleta-brilho_1.8s_linear_infinite] bg-gradient-to-r from-transparent via-white/40 to-transparent motion-reduce:hidden" />}
              </div>
              <span className="w-10 text-right font-semibold tabular-nums text-[#17150F]">{pct}%</span>
            </div>
          )}
          {p && (
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
              <div>
                <dt className="text-[11px] text-[#8B8578]">{p.etapa === "busca" ? "buscas" : "fichas"}</dt>
                <dd className="text-[15px]"><NumeroVivo valor={p.feitas} className="font-semibold" /> <span className="text-[#8B8578]">de {p.total.toLocaleString("pt-BR")}</span></dd>
              </div>
              <div>
                <dt className="text-[11px] text-[#8B8578]">lugares achados</dt>
                <dd className="text-[15px]"><NumeroVivo valor={p.lugares} className="font-semibold" /></dd>
              </div>
              <div>
                <dt className="text-[11px] text-[#8B8578]">fichas lidas</dt>
                <dd className="text-[15px]"><NumeroVivo valor={p.fichas} className="font-semibold" />{p.falhas ? <span className="text-[#8A3A22]"> · {qtd(p.falhas, "falha", "falhas")}</span> : null}</dd>
              </div>
              <div>
                <dt className="text-[11px] text-[#8B8578]">falta na etapa</dt>
                <dd className="text-[15px] tabular-nums">
                  {restaSeg === null ? <span className="text-[#8B8578]">medindo…</span> : <span className="font-semibold">~{duracao(restaSeg * 1000)}</span>}
                  {porSegundo ? <span className="block text-[11px] text-[#8B8578]">{(porSegundo * 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} por min</span> : null}
                </dd>
              </div>
            </dl>
          )}
          <span className="text-[11.5px] text-[#8B8578]">{c.worker} · último sinal {haQuanto(c.batidaEm, agora)}</span>
          {semSinal && <span className="text-[#8A3A22]">O worker parou de dar sinal. Se ele não voltar, recoloque na fila para outro worker continuar.</span>}
        </div>
      )}

      {c.estado === "erro" && (
        <p className="text-[#8A3A22]">
          {c.erro || "A coleta parou com erro."} O que já foi coletado fica guardado: recoloque na fila para continuar de onde parou.
        </p>
      )}

      {c.resumo && (
        <p className="text-[#6F6A5E]">
          {c.iniciadaEm && c.terminadaEm && c.terminadaEm > c.iniciadaEm && <span className="block text-[11.5px] text-[#8B8578]">coletada em {duracao(c.terminadaEm - c.iniciadaEm)}</span>}
          <span className="font-semibold text-[#17150F]">{qtd(c.resumo.novos, "novo", "novos")}</span>, {c.resumo.conferir} para conferir, {c.resumo.fora} fora
          {Object.keys(c.resumo.motivos).length > 0 && ` (${Object.entries(c.resumo.motivos).sort((a, b) => b[1] - a[1]).map(([m, n]) => `${n} ${m}`).join(", ")})`}
          {c.estado === "concluida" && c.gerados !== null && <> · <span className="font-semibold text-[#235B45]">{qtd(c.gerados, "site gerado", "sites gerados")}</span></>}
        </p>
      )}

      {c.estado === "gerando" && !gerando && (
        <p className="text-[#7A5A2E]">Geração interrompida em {c.geradosAte} de {totalNovos}. Continue para gerar o resto.</p>
      )}

      {gerando && (
        <div className="flex flex-col gap-1.5" role="status">
          <div className="h-1.5 overflow-hidden rounded-full bg-[#F1EEE7]">
            <div className="h-full bg-[#7A5A2E] transition-[width] duration-500" style={{ width: `${Math.round((gerando.feitos / Math.max(1, gerando.total)) * 100)}%` }} />
          </div>
          <span className="text-[#6F6A5E]">Gerando: {gerando.feitos} de {gerando.total}. Não feche esta aba.</span>
        </div>
      )}

      {erro && <Alerta tom="erro" fechar={() => setErro("")}>{erro}</Alerta>}

      <div className="flex flex-wrap items-center gap-2">
        {c.estado === "coletando" && (
          <button type="button" disabled={ocupado} onClick={async () => (await confirmar({ titulo: `Cancelar a coleta de ${c.cidade}?`, texto: "O que já foi coletado fica guardado se ela for recolocada na fila.", acao: "Cancelar a coleta" })) && acao(async () => cancelarColeta(await tokenFresco(), c.id), aoMudar)} className={`${BOTAO} border border-[#D8D2C6] bg-white hover:border-[#17150F] disabled:opacity-50`}>
            Cancelar
          </button>
        )}
        {(c.estado === "erro" || c.estado === "cancelada" || semSinal) && (
          <button type="button" disabled={ocupado} onClick={() => acao(async () => recolocarColeta(await tokenFresco(), c.id), aoMudar)} className={`${BOTAO} border border-[#D8D2C6] bg-white hover:border-[#17150F] disabled:opacity-50`}>
            Recolocar na fila
          </button>
        )}
        {c.estado === "pronta" && !previa && totalNovos > 0 && (
          <button type="button" disabled={ocupado} onClick={() => acao(async () => previaDaColeta(await tokenFresco(), c.id), setPrevia)} className={`${BOTAO} bg-[#17150F] text-white disabled:opacity-50`}>
            {ocupado ? "Conferindo…" : "Ver prévia dos sites"}
          </button>
        )}
        {["cancelada", "erro", "pronta", "concluida"].includes(c.estado) && !gerando && (
          <button
            type="button"
            disabled={ocupado}
            onClick={async () =>
              (await confirmar({
                titulo: `Excluir a coleta de ${c.cidade}?`,
                texto:
                  c.estado === "pronta" && totalNovos > 0
                    ? `Os ${qtd(totalNovos, "novo", "novos")} ainda não viraram site e serão perdidos.`
                    : c.estado === "concluida"
                      ? "Os sites gerados continuam no ar; só este registro some."
                      : "O registro e o que foi coletado somem.",
                acao: "Excluir",
              })) && acao(async () => excluirColeta(await tokenFresco(), c.id), aoMudar)
            }
            className={`${BOTAO} ml-auto text-[#8A3A22] hover:bg-[#FBEFEB] disabled:opacity-50`}
          >
            Excluir
          </button>
        )}
        {c.estado === "gerando" && !gerando && (
          <button type="button" disabled={ocupado} onClick={() => gerar(totalNovos - c.geradosAte)} className={`${BOTAO} bg-[#17150F] text-white disabled:opacity-50`}>
            Continuar geração
          </button>
        )}
      </div>

      {previa && feito === null && !gerando && c.estado === "pronta" && (
        <div className="flex flex-col gap-2 rounded-xl bg-[#FBFAF8] p-3">
          <p>
            {qtd(conta("criar"), "site novo", "sites novos")}
            {conta("atualizar") > 0 && `, ${qtd(conta("atualizar"), "atualização", "atualizações")}`}
            {conta("pular") > 0 && `, ${qtd(conta("pular"), "pulado por já ter site", "pulados por já terem site")}`}.
            {fixos > 0 && <span className="text-[#7A5A2E]"> {qtd(fixos, "tem", "têm")} telefone fixo: o botão de WhatsApp desses sites não vai funcionar.</span>}
          </p>
          <details>
            <summary className="cursor-pointer text-[#6F6A5E]">Ver a lista</summary>
            <ul className="mt-2 flex max-h-72 flex-col gap-0.5 overflow-y-auto text-[12px]">
              {previa.map((l) => (
                <li key={l.leadId} className={`group flex items-start gap-2 rounded-md px-1 py-0.5 hover:bg-white ${l.acao === "pular" ? "text-[#8B8578]" : ""}`}>
                  <span className="min-w-0 flex-1">
                    <span className="font-semibold">{l.nome}</span>
                    {l.slug && <> · <span className="font-mono">{l.slug}.ruphus.site</span></>}
                    {l.acao === "pular" ? ` · ${l.motivo ?? "já tem site"}` : l.acao === "atualizar" ? " · atualiza" : ""}
                    {l.aviso && <span className="text-[#7A5A2E]"> · {l.aviso}</span>}
                  </span>
                  {/* tirar da geração: o lead não vira site (e sai dos novos da coleta) */}
                  {l.acao !== "pular" && (
                    <button
                      type="button"
                      disabled={!!tirando || ocupado}
                      onClick={() => void tirar(l)}
                      aria-label={`Não gerar o site de ${l.nome}`}
                      className="shrink-0 rounded-md border border-[#D8D2C6] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#8A3A22] opacity-60 group-hover:opacity-100 focus-visible:opacity-100 disabled:opacity-30"
                    >
                      {tirando === l.leadId ? "Tirando…" : "Tirar"}
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </details>
          {tirado && (
            <p role="status" className="flex flex-wrap items-center gap-2 text-[#6F6A5E]">
              <span><span className="font-semibold text-[#17150F]">{tirado.linha.nome}</span> não vai ser gerado.</span>
              <button type="button" disabled={!!tirando} onClick={() => void desfazer()} className="font-semibold text-[#17150F] underline underline-offset-2 disabled:opacity-50">
                {tirando === tirado.linha.leadId ? "Devolvendo…" : "Desfazer"}
              </button>
            </p>
          )}
          {aGerar > 0 && (
            <div>
              <button type="button" disabled={ocupado} onClick={() => gerar(aGerar)} className={`${BOTAO} bg-[#17150F] text-white disabled:opacity-50`}>
                Gerar {qtd(aGerar, "site", "sites")}
              </button>
            </div>
          )}
        </div>
      )}

      {feito !== null && (
        <p role="status" className="rounded-xl border border-[#CADCD1] bg-[#EFF5F1] p-3 font-semibold text-[#235B45]">
          {qtd(feito, "site no ar", "sites no ar")}. Eles já estão na lista e no funil.
        </p>
      )}
    </article>
  );
}
