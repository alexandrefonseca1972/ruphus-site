"use server";

// Aba Coleta do admin: pedidos de coleta no Google Maps. O admin só põe na fila,
// acompanha e gera os sites; quem coleta é o worker (npm run coletar -- --fila),
// numa máquina com navegador. Fila e resultado ficam no Firestore (coletas).
import { spawn, spawnSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { revalidatePath } from "next/cache";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import { adminDb } from "@/lib/admin";
import { adminAction, ErroPrevisto } from "@/lib/admin-guard";
import { LIMITES, problemaNoPedido, TERMOS_PADRAO, UFS, type EstadoColeta, type Progresso, type Resumo } from "@/lib/coleta";
import { gerarNoBanco, TETO_LOTE } from "@/lib/gerador.server";

export type Coleta = {
  id: string; uf: string; cidade: string; bairros: string[]; termos: string[]; estado: EstadoColeta;
  worker: string | null; progresso: Progresso | null; resumo: Resumo | null; erro: string | null; gerados: number | null; geradosAte: number;
  criadaEm: number | null; batidaEm: number | null; terminadaEm: number | null;
};
export type Worker = { nome: string; batidaEm: number | null; ocupado: string | null };
/** O worker daqui: só dá para ligar pelo admin quando o servidor roda na máquina do navegador. */
export type WorkerLocal = { pode: boolean; ligado: boolean; nome: string; log: string };

const coletas = () => adminDb.collection("coletas");
const ms = (t: unknown) => (t as Timestamp | undefined)?.toMillis?.() ?? null;
const UF = z.enum(Object.keys(UFS) as [keyof typeof UFS, ...(keyof typeof UFS)[]]);
// id de documento do Firestore: sem "/", senão "x/leads/y" apontaria para dentro de outra coleta
const Id = z.string().regex(/^[A-Za-z0-9]{1,40}$/);

/** Municípios do estado pelo IBGE (lista oficial; muda quase nunca, então fica um dia em cache). */
async function doIbge(uf: string) {
  const r = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${UF.parse(uf)}/municipios?orderBy=nome`, { next: { revalidate: 86_400 } });
  if (!r.ok) throw new ErroPrevisto("O IBGE não respondeu. Tente de novo em instantes.");
  return ((await r.json()) as { nome: string }[]).map((m) => m.nome);
}
export const municipios = adminAction(async (_user, uf: string) => doIbge(uf));

/** Quantos negócios já temos na cidade: para não pedir de novo o que já foi coletado. */
export const jaTemosNaCidade = adminAction(async (_user, cidade: string, uf: string) => {
  const r = await adminDb.collection("tenants").where("site.city", "==", z.string().min(1).max(80).parse(cidade)).where("site.uf", "==", UF.parse(uf)).count().get();
  return r.data().count;
});

// ── worker ligado pelo admin ────────────────────────────────────────────────────────
// Só onde o Next roda na mesma máquina que o agent-browser (npm run dev no Mac, ou uma VPS).
// Na Vercel não há navegador nem processo que dure horas: lá o botão some e fica o comando.
const RAIZ = process.env.COLETA_PASTA ?? join(process.cwd(), "dblocal/pesquisa");
const PID = join(RAIZ, "worker.pid");
const LOG = join(RAIZ, "worker.log");
const NOME = process.env.COLETA_WORKER ?? hostname();
const SEM_SINAL_MS = 3 * 60_000;

let temNavegador: boolean | undefined;
function podeLigarAqui() {
  // COLETA_SERVICO: o worker é um serviço da máquina (systemd na VPS), não um processo do admin
  if (process.env.VERCEL || process.env.COLETA_SERVICO) return false;
  temNavegador ??= spawnSync("agent-browser", ["--version"], { timeout: 10_000, stdio: "ignore" }).status === 0;
  return temNavegador;
}
/** pid do worker que o admin ligou, se ainda estiver vivo. */
function pidVivo() {
  if (!existsSync(PID)) return null;
  const pid = Number(readFileSync(PID, "utf8"));
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    rmSync(PID, { force: true });
    return null;
  }
}
const local = (): WorkerLocal => ({ pode: podeLigarAqui(), ligado: podeLigarAqui() && pidVivo() !== null, nome: NOME, log: LOG });

export const ligarWorker = adminAction(async () => {
  if (!podeLigarAqui()) throw new ErroPrevisto("Daqui não dá para ligar: este servidor não tem o agent-browser. Rode npm run coletar -- --fila no Mac.");
  if (pidVivo()) throw new ErroPrevisto("O worker já está ligado.");
  // ligado à mão no terminal (mesmo nome): dois iguais disputariam o mesmo pedido
  const batida = ms((await adminDb.collection("coletaWorkers").doc(NOME).get()).get("batidaEm"));
  if (batida && Date.now() - batida < SEM_SINAL_MS) throw new ErroPrevisto(`Já há um worker "${NOME}" no ar (talvez num terminal). Desligue o outro antes.`);
  mkdirSync(RAIZ, { recursive: true });
  const saida = openSync(LOG, "a");
  // grupo próprio (detached): sobrevive a um reinício do servidor e o desligar alcança npm, tsx e node juntos
  const filho = spawn("npm", ["run", "coletar", "--", "--fila"], { cwd: process.cwd(), detached: true, stdio: ["ignore", saida, saida] });
  closeSync(saida);
  if (!filho.pid) throw new ErroPrevisto(`O worker não subiu. Veja ${LOG}.`);
  filho.unref();
  writeFileSync(PID, String(filho.pid));
  return local();
});

export const desligarWorker = adminAction(async () => {
  const pid = pidVivo();
  if (!pid) throw new ErroPrevisto("Este worker não foi ligado pelo admin (ou já parou). Se está num terminal, pare com Ctrl+C.");
  // SIGINT no grupo, como o Ctrl+C: o worker fecha o navegador e a coleta em curso continua quando ele voltar
  process.kill(-pid, "SIGINT");
  rmSync(PID, { force: true });
  return local();
});

export const painelColeta = adminAction(async () => {
  const [lista, workers] = await Promise.all([coletas().orderBy("criadaEm", "desc").limit(30).get(), adminDb.collection("coletaWorkers").get()]);
  return {
    coletas: lista.docs.map((d): Coleta => ({
      id: d.id, uf: d.get("uf"), cidade: d.get("cidade"), bairros: d.get("bairros") ?? [], termos: d.get("termos") ?? [], estado: d.get("estado"),
      worker: d.get("worker") ?? null, progresso: d.get("progresso") ?? null, resumo: d.get("resumo") ?? null, erro: d.get("erro") ?? null,
      gerados: d.get("gerados") ?? null, geradosAte: d.get("geradosAte") ?? 0, criadaEm: ms(d.get("criadaEm")), batidaEm: ms(d.get("batidaEm")), terminadaEm: ms(d.get("terminadaEm")),
    })),
    workers: workers.docs.map((d): Worker => ({ nome: d.id, batidaEm: ms(d.get("batidaEm")), ocupado: d.get("ocupado") ?? null })),
    local: local(),
  };
});

const Pedido = z.object({
  uf: UF,
  cidades: z.array(z.string().trim().min(2).max(80)).min(1).max(LIMITES.cidades),
  // vazio: o worker descobre os bairros pelos endereços da primeira volta (sempre, com várias cidades)
  bairros: z.array(z.string().trim().min(2).max(60)).max(LIMITES.bairros),
  termos: z.array(z.string().trim().min(2).max(40)).max(LIMITES.termos),
});

/** Um pedido por cidade, na ordem escolhida (a fila atende do mais antigo). Cidade que já está
 *  na fila ou coletando fica de fora e volta na resposta. */
export const pedirColeta = adminAction(async (user, entrada: unknown) => {
  const p = Pedido.parse(entrada);
  const problema = problemaNoPedido(p);
  if (problema) throw new ErroPrevisto(problema);
  const doEstado = new Set(await doIbge(p.uf));
  const fora = p.cidades.filter((c) => !doEstado.has(c));
  if (fora.length) throw new ErroPrevisto(`Não achei no IBGE: ${fora.join(", ")}.`);
  const termos = p.termos.length ? p.termos : TERMOS_PADRAO;
  // conferir e criar juntos: dois cliques (ou duas abas) não põem a mesma cidade duas vezes
  return adminDb.runTransaction(async (tx) => {
    const ativas = await tx.get(coletas().where("uf", "==", p.uf).where("estado", "in", ["fila", "coletando"]));
    const jaNaFila = new Set(ativas.docs.map((d) => d.get("cidade") as string));
    const novas = [...new Set(p.cidades)].filter((c) => !jaNaFila.has(c));
    const agora = Date.now();
    novas.forEach((cidade, i) =>
      // criadaEm em ms crescentes: a fila respeita a ordem da escolha, mesmo criadas juntas
      tx.create(coletas().doc(), { uf: p.uf, cidade, bairros: p.bairros, termos, estado: "fila", criadaEm: Timestamp.fromMillis(agora + i), criadaPor: user.uid }));
    return { criadas: novas, jaNaFila: p.cidades.filter((c) => jaNaFila.has(c)) };
  });
});

/** Na fila sai na hora; coletando, o worker percebe em até 20 s e para. */
export const cancelarColeta = adminAction(async (_user, id: string) => {
  const ref = coletas().doc(Id.parse(id));
  await adminDb.runTransaction(async (tx) => {
    const d = await tx.get(ref);
    if (!["fila", "coletando"].includes(d.get("estado"))) throw new ErroPrevisto("Essa coleta já terminou.");
    tx.update(ref, { estado: "cancelada", terminadaEm: FieldValue.serverTimestamp() });
  });
});

/** Volta para a fila (com erro, cancelada ou com o worker sumido): qualquer worker pega e
 *  continua de onde parou, se tiver a pasta da coleta; senão começa do zero. */
export const recolocarColeta = adminAction(async (_user, id: string) => {
  const ref = coletas().doc(Id.parse(id));
  await adminDb.runTransaction(async (tx) => {
    const d = await tx.get(ref);
    if (!["erro", "cancelada", "coletando"].includes(d.get("estado"))) throw new ErroPrevisto("Essa coleta não pode voltar para a fila.");
    tx.update(ref, { estado: "fila", worker: null, erro: null });
  });
});

const EXCLUIVEIS: EstadoColeta[] = ["cancelada", "erro", "pronta", "concluida"];

/** Apaga o pedido e os leads coletados. Sites já gerados não são tocados. Na fila ou
 *  coletando, cancele antes: o worker ainda poderia gravar nele. */
export const excluirColeta = adminAction(async (_user, id: string) => {
  const ref = coletas().doc(Id.parse(id));
  await adminDb.runTransaction(async (tx) => {
    const d = await tx.get(ref);
    if (!d.exists) return;
    if (!EXCLUIVEIS.includes(d.get("estado"))) throw new ErroPrevisto("Cancele a coleta antes de excluir (ou espere a geração terminar).");
    // cancela antes de apagar: se a exclusão cair no meio, ninguém gera de um pedido pela metade
    tx.update(ref, { estado: "cancelada" });
  });
  await adminDb.recursiveDelete(ref);
});

async function novosDa(ref: FirebaseFirestore.DocumentReference) {
  // sem orderBy: igualdade devolve em ordem de id, a mesma em toda chamada (o cursor depende disso)
  const novos = await ref.collection("leads").where("situacao", "==", "novo").get();
  return novos.docs.map((d, i) => ({ aba: "coleta", linha: i + 1, lead: d.get("lead") }));
}

/** O que gerar os novos faria, sem gravar nada. */
export const previaDaColeta = adminAction(async (user, id: string) => {
  const ref = coletas().doc(Id.parse(id));
  const estado = (await ref.get()).get("estado");
  if (estado !== "pronta" && estado !== "gerando") throw new ErroPrevisto("A coleta ainda não terminou (ou já foi gerada).");
  const leads = await novosDa(ref);
  const linhas = [];
  for (let i = 0; i < leads.length; i += TETO_LOTE) linhas.push(...(await gerarNoBanco(adminDb, leads.slice(i, i + TETO_LOTE), false, process.env.OWNER_UID || user.uid)));
  return linhas;
});

const TRAVA_MS = 5 * 60_000;

/** Gera o próximo lote de até 300 novos e avança o cursor; o admin chama até acabar. Um lote por
 *  chamada cabe no tempo de uma função, mostra o andamento e, se um lote falhar, os anteriores
 *  ficam gerados e o próximo clique continua dali. A trava impede duas gerações ao mesmo tempo
 *  (duas abas, clique repetido), que poderiam criar o mesmo negócio duas vezes. */
export const gerarLoteDaColeta = adminAction(async (user, id: string) => {
  const ref = coletas().doc(Id.parse(id));
  const inicio = await adminDb.runTransaction(async (tx) => {
    const d = await tx.get(ref);
    if (d.get("estado") !== "pronta" && d.get("estado") !== "gerando") throw new ErroPrevisto("Essa coleta não está pronta para gerar.");
    const trava = ms(d.get("travaEm"));
    if (trava && Date.now() - trava < TRAVA_MS) throw new ErroPrevisto("Já há uma geração em andamento para essa coleta.");
    tx.update(ref, { estado: "gerando", travaEm: FieldValue.serverTimestamp() });
    return { cursor: (d.get("geradosAte") as number) ?? 0, gerados: (d.get("gerados") as number) ?? 0 };
  });
  try {
    const leads = await novosDa(ref);
    const linhas = await gerarNoBanco(adminDb, leads.slice(inicio.cursor, inicio.cursor + TETO_LOTE), true, process.env.OWNER_UID || user.uid);
    for (const { slug } of linhas.filter((l) => l.acao !== "pular")) {
      revalidatePath(`/s/${slug}/index.html`);
      revalidatePath(`/s/${slug}/og.jpg`);
      revalidatePath(`/bio/${slug}`);
    }
    const geradosAte = Math.min(leads.length, inicio.cursor + TETO_LOTE);
    const gerados = inicio.gerados + linhas.filter((l) => l.acao !== "pular").length;
    const concluida = geradosAte >= leads.length;
    await ref.update({
      geradosAte, gerados, travaEm: FieldValue.delete(),
      ...(concluida ? { estado: "concluida", geradaEm: FieldValue.serverTimestamp() } : {}),
    });
    return { linhas, geradosAte, total: leads.length, concluida };
  } catch (e) {
    await ref.update({ travaEm: FieldValue.delete() }); // fica "gerando": o próximo clique continua do cursor
    throw e;
  }
});
