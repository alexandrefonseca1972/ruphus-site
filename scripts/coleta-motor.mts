// O navegador da coleta: busca no Google Maps e leitura das fichas com o agent-browser.
// Usado pelo scripts/coletar.mts, direto pela linha de comando ou como worker da fila.
//
// Estado em arquivos na pasta da coleta, para retomar de onde parou: busca feita e ficha
// lida não se repetem, e o que falhou é tentado de novo (até 3 vezes, no fim da fila).
// Roda em qualquer máquina com o agent-browser instalado (Mac ou VPS Linux).
import { spawn, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as esperar } from "node:timers/promises";
import { FICHA_JS, LINKS_JS, placeId, ROLAR_JS, type Ficha, type Progresso } from "@/lib/coleta";

export type Config = {
  pasta: string;
  cidade: string;
  uf: string;
  termos: string[];
  rolagens?: number;
  /** chamado a cada item; o worker usa para publicar o andamento e saber se foi cancelado (lança para parar) */
  aoAvancar?: (p: Progresso) => Promise<void> | void;
};

export class Interrompida extends Error {}

const SESSAO = "coleta-maps";
const TENTATIVAS = 3;
const LENTO_MS = 15_000; // média normal: ~6 s por ficha
const REINICIAR_A_CADA = 250;

/** Cada chamada tem prazo: sem ele, um `wait` numa página que não carrega espera para
 *  sempre. stdin vazio: o agent-browser herdando o stdin já engoliu a lista de links. */
function ab(args: string[], prazo = 30_000, entrada = "") {
  const r = spawnSync("agent-browser", ["--session", SESSAO, ...args], { input: entrada, timeout: prazo, encoding: "utf8", killSignal: "SIGKILL" });
  // Ctrl+C mata o filho junto; sem isto viria um reinício e outra tentativa antes de sair
  if (r.signal === "SIGINT") throw new Interrompida("interrompido");
  if (r.error) throw new Error(r.error.message.includes("ETIMEDOUT") ? `agent-browser ${args[0]}: passou de ${prazo / 1000} s` : r.error.message);
  if (r.status !== 0) throw new Error(`agent-browser ${args[0]}: ${(r.stderr || r.stdout).trim().split("\n").pop()}`);
  return r.stdout.trim();
}
/** O eval devolve o resultado em JSON; o JSON.stringify da página chega como string dentro dele. */
function avaliar<T>(js: string, prazo = 20_000): T {
  const v = JSON.parse(ab(["eval", "--stdin"], prazo, js));
  return typeof v === "string" ? JSON.parse(v) : v;
}

export function fecharNavegador() {
  spawnSync("agent-browser", ["--session", SESSAO, "close"], { timeout: 15_000, stdio: "ignore" });
}
/** Horas de navegador aberto deixam cada ficha 5× mais lenta, e às vezes o daemon para de
 *  responder: fechar e deixar o próximo comando abrir outro resolve os dois. */
function reiniciar(motivo: string) {
  console.log(`  ↻ reiniciando o navegador (${motivo})`);
  const r = spawnSync("agent-browser", ["--session", SESSAO, "close"], { timeout: 15_000, stdio: "ignore" });
  if (r.status !== 0) {
    // ponytail: daemon travado não responde ao close; mata todos os agent-browser da máquina, sessão própria se isso atrapalhar
    spawnSync("pkill", ["-9", "-f", "agent-browser-"]);
    spawnSync("pkill", ["-9", "-f", "Chrome for Testing"]);
  }
}
/** Tenta de novo uma vez, com o navegador reiniciado; a segunda falha sobe. */
async function comRetentativa<T>(oque: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof Interrompida) throw e;
    reiniciar(`${oque}: ${(e as Error).message}`);
    return await fn();
  }
}

/** No Mac, o repouso congela a coleta de horas; o caffeinate sai junto com este processo.
 *  Fora do Mac não existe, e tudo bem. */
export function manterAcordado() {
  spawn("caffeinate", ["-i", "-w", String(process.pid)], { stdio: "ignore" }).on("error", () => {});
}

export function motor(cfg: Config) {
  mkdirSync(cfg.pasta, { recursive: true });
  const BUSCAS = resolve(cfg.pasta, "buscas.txt"); // buscas concluídas, uma por linha
  const LINKS = resolve(cfg.pasta, "links.txt");
  const FICHAS = resolve(cfg.pasta, "fichas.jsonl");
  const FALHAS = resolve(cfg.pasta, "falhas.txt"); // busca ou lugar que falhou, uma linha por falha
  const linhasDe = (arq: string) => (existsSync(arq) ? readFileSync(arq, "utf8").split("\n").filter(Boolean) : []);
  // linha cortada por queda de energia no meio da gravação não pode travar as próximas rodadas
  const fichas = () => linhasDe(FICHAS).flatMap((l) => { try { return [JSON.parse(l) as Ficha]; } catch { return []; } });
  const lugares = () => new Set(linhasDe(LINKS).map(placeId)).size;
  const progresso: Progresso = { etapa: "", feitas: 0, total: 0, lugares: 0, fichas: 0, falhas: 0 };
  const avancar = async (p: Partial<Progresso>) => {
    Object.assign(progresso, p);
    await cfg.aoAvancar?.({ ...progresso });
  };

  /** O que falha sempre vai para o fim da fila (senão cinco itens quebrados no começo
   *  derrubam toda retomada) e sai dela na 3ª falha. */
  function semQuebrados<T>(itens: T[], chave: (x: T) => string) {
    const n = new Map<string, number>();
    for (const f of linhasDe(FALHAS)) n.set(f, (n.get(f) ?? 0) + 1);
    const vezes = (x: T) => n.get(chave(x)) ?? 0;
    const fila = itens.filter((x) => vezes(x) < TENTATIVAS).sort((a, b) => vezes(a) - vezes(b));
    if (fila.length < itens.length) console.log(`  ${itens.length - fila.length} desistido(s) depois de ${TENTATIVAS} falhas (${FALHAS})`);
    return fila;
  }

  /** Bairro × termo; "" é a cidade toda. */
  async function buscar(bairros: string[]) {
    const feitas = new Set(linhasDe(BUSCAS));
    const todas = bairros.flatMap((b) => cfg.termos.map((t) => [t, b, cfg.cidade, cfg.uf].filter(Boolean).join(" ")));
    const pendentes = semQuebrados(todas.filter((q) => !feitas.has(q)), (q) => q);
    console.log(`busca: ${todas.length - pendentes.length} feitas, ${pendentes.length} pendentes`);
    let seguidas = 0, falhas = 0;
    await avancar({ etapa: "busca", feitas: 0, total: pendentes.length, lugares: lugares(), falhas: 0 });
    for (const [i, q] of pendentes.entries()) {
      try {
        const links = await comRetentativa(`busca "${q}"`, async () => {
          ab(["open", `https://www.google.com/maps/search/${encodeURIComponent(q)}?hl=pt-BR`]);
          try {
            ab(["wait", "div[role=feed]"], 20_000);
          } catch {
            // sem lista: busca com um resultado só abre direto a ficha; qualquer outra coisa
            // (consentimento, "tráfego incomum", página que não carregou) é falha, não "nada achado"
            const url = ab(["get", "url"], 20_000);
            if (url.includes("/maps/place/")) return [url];
            throw new Error(`a busca não mostrou resultados (${url.slice(0, 80)})`);
          }
          for (let r = 0; r < (cfg.rolagens ?? 3); r++) {
            avaliar(ROLAR_JS);
            await esperar(1500);
          }
          return avaliar<string[]>(LINKS_JS);
        });
        if (links.length) appendFileSync(LINKS, links.join("\n") + "\n");
        appendFileSync(BUSCAS, q + "\n");
        seguidas = 0;
      } catch (e) {
        if (e instanceof Interrompida) throw e;
        falhas++;
        console.log(`  ✗ ${q}: ${(e as Error).message}`);
        appendFileSync(FALHAS, q + "\n");
        if (++seguidas >= 5) throw new Error("5 buscas seguidas falharam: Google bloqueou ou caiu a rede? Tente de novo mais tarde.");
      }
      if ((i + 1) % 10 === 0) console.log(`  ${i + 1}/${pendentes.length} buscas, ${lugares()} lugares`);
      await avancar({ feitas: i + 1, lugares: lugares(), falhas });
    }
  }

  async function ler() {
    // ficha gravada vazia (versões antigas gravavam página que não terminou de abrir) conta como não lida
    const gravadas = fichas();
    const lidos = new Set(gravadas.filter((f) => f.nome?.trim()).map((f) => placeId(f.link_maps)));
    const linkDe = new Map<string, string>();
    for (const link of [...linhasDe(LINKS), ...gravadas.map((f) => f.link_maps)]) {
      const id = placeId(link);
      if (id && !lidos.has(id) && !linkDe.has(id)) linkDe.set(id, link);
    }
    const pendentes = semQuebrados([...linkDe], ([id]) => id).map(([, link]) => link);
    console.log(`fichas: ${lidos.size} lidas, ${pendentes.length} pendentes (~${Math.ceil((pendentes.length * 6) / 60)} min)`);
    let seguidas = 0, falhas = 0, n = 0;
    const tempos: number[] = [];
    await avancar({ etapa: "fichas", feitas: 0, total: pendentes.length, fichas: lidos.size, falhas: 0 });
    for (const link of pendentes) {
      const inicio = Date.now();
      try {
        const ficha = await comRetentativa("ficha", async () => {
          ab(["open", link]);
          ab(["wait", "h1"], 20_000);
          await esperar(1000);
          const f = avaliar<Omit<Ficha, "link_maps">>(FICHA_JS);
          // h1 apareceu mas o painel ainda não tinha nada: gravar assim perderia o lugar de vez
          if (!f.nome?.trim()) throw new Error("ficha veio vazia");
          return f;
        });
        appendFileSync(FICHAS, JSON.stringify({ ...ficha, link_maps: link }) + "\n");
        seguidas = 0;
      } catch (e) {
        if (e instanceof Interrompida) throw e;
        falhas++;
        console.log(`  ✗ ${link.split("/data=")[0]}: ${(e as Error).message}`);
        appendFileSync(FALHAS, placeId(link) + "\n");
        if (++seguidas >= 5) throw new Error("5 fichas seguidas falharam: Google bloqueou ou caiu a rede? Tente de novo mais tarde.");
      }
      tempos.push(Date.now() - inicio);
      if (tempos.length > 20) tempos.shift();
      if (++n % 50 === 0) console.log(`  ${n}/${pendentes.length} fichas${falhas ? `, ${falhas} falharam` : ""}`);
      if (n % REINICIAR_A_CADA === 0) reiniciar(`${REINICIAR_A_CADA} fichas`);
      else if (tempos.length === 20 && tempos.reduce((a, b) => a + b) / 20 > LENTO_MS) {
        reiniciar("lento");
        tempos.length = 0;
      }
      await avancar({ feitas: n, fichas: lidos.size + n - falhas, falhas });
    }
    if (falhas) console.log(`${falhas} ficha(s) falharam: rodar de novo tenta outra vez`);
  }

  return { buscar, ler, fichas };
}
