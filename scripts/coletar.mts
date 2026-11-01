// Coleta leads de beleza no Google Maps (agent-browser), cruzados com o que já está no sistema.
//
//   npm run coletar -- --fila                                # worker: atende os pedidos do /admin (aba Coleta)
//   npm run coletar -- "Belo Horizonte" MG                   # direto: bairros descobertos sozinhos
//   npm run coletar -- "Belo Horizonte" MG --bairros="Centro,Savassi" --termos="barbearia" --rolagens=5
//   npm run coletar -- "Belo Horizonte" MG --so-montar       # só refaz as planilhas
//
// Sem --bairros, a primeira volta busca na cidade toda e os bairros mais citados nos endereços
// viram a segunda volta. Direto, o resultado sai em planilhas para o npm run gerar:sites; pela
// fila, vai para o Firestore e o admin gera os sites de lá.
//
// O worker roda em qualquer máquina com agent-browser e as credenciais do Firebase
// (.env.local): este Mac ou uma VPS. COLETA_PASTA muda onde fica o estado das coletas
// (padrão dblocal/pesquisa); COLETA_WORKER, o nome com que o worker aparece no admin.
import { hostname } from "node:os";
import { resolve } from "node:path";
import { setTimeout as esperar } from "node:timers/promises";
import { FieldValue } from "firebase-admin/firestore";
import writeExcelFile from "write-excel-file/node";
import { adminDb } from "@/lib/admin";
import { abas, bairrosDe, lotes, montarBase, motivoCurto, paraGerador, placeId, separar, TERMOS_PADRAO, type Progresso, type Resumo } from "@/lib/coleta";
import { norm } from "@/lib/dblocal";
import { fecharNavegador, Interrompida, manterAcordado, motor } from "./coleta-motor.mjs";

type Pedido = { cidade: string; uf: string; bairros: string[]; termos: string[]; rolagens?: number; id?: string };

const RAIZ = process.env.COLETA_PASTA ?? resolve(import.meta.dirname, "../dblocal/pesquisa");
// pela fila, uma pasta por pedido: um pedido novo da mesma cidade semanas depois coleta de novo
// em vez de devolver o retrato antigo; retomar (queda, recolocar na fila) usa o mesmo id
const pastaDe = (p: Pedido) => resolve(RAIZ, `${norm(p.cidade)}-${p.uf.toLowerCase()}${p.id ? `-${p.id}` : ""}`);

/** Telefones e nomes de todos os negócios do sistema: o que já tem site não volta como lead. */
async function baseDoSistema() {
  const t = await adminDb.collection("tenants").select("name", "site.phone", "site.city").get();
  return montarBase(t.docs.map((d) => ({ nome: d.get("name"), telefone: d.get("site.phone"), cidade: d.get("site.city"), origem: `site ${d.id}` })));
}

async function coletar(p: Pedido, aoAvancar?: (pr: Progresso) => Promise<void>) {
  const m = motor({ pasta: pastaDe(p), cidade: p.cidade, uf: p.uf, termos: p.termos, rolagens: p.rolagens, aoAvancar });
  if (p.bairros.length) {
    await m.buscar(["", ...p.bairros]);
  } else {
    await m.buscar([""]);
    await m.ler();
    const descobertos = bairrosDe(m.fichas(), p);
    console.log(`bairros descobertos (${descobertos.length}): ${descobertos.join(", ")}`);
    await m.buscar(descobertos);
  }
  await m.ler();
  fecharNavegador();
  return separar(m.fichas(), await baseDoSistema(), p);
}

// ---- direto: planilhas -----------------------------------------------------------------------

async function direto() {
  const [cidade, uf] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const opcao = (nome: string) => process.argv.find((a) => a.startsWith(`--${nome}=`))?.slice(nome.length + 3);
  const lista = (s?: string) => s?.split(",").map((x) => x.trim()).filter(Boolean);
  if (!cidade || !/^[A-Za-z]{2}$/.test(uf ?? "")) throw new Error('Informe cidade e UF: npm run coletar -- "Belo Horizonte" MG [--bairros=a,b]  (ou --fila)');
  const p: Pedido = { cidade, uf: uf.toUpperCase(), bairros: lista(opcao("bairros")) ?? [], termos: lista(opcao("termos")) ?? TERMOS_PADRAO, rolagens: Number(opcao("rolagens") ?? 3) };

  const sep = process.argv.includes("--so-montar")
    ? separar(motor({ pasta: pastaDe(p), ...p }).fichas(), await baseDoSistema(), p)
    : await coletar(p);
  const { novos, conferir, fora } = sep;
  const grupos = lotes(novos);
  // com a data no nome, os lotes de uma coleta anterior (talvez já gravados) não se misturam aos de hoje
  const nome = `Leads_Beleza_${cidade.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\W+/g, "")}_${new Date().toISOString().slice(0, 10)}`;
  const arquivos: string[] = [];
  for (const [i, lote] of grupos.entries()) {
    const arq = resolve(pastaDe(p), grupos.length === 1 ? `${nome}.xlsx` : `${nome}_lote${i + 1}.xlsx`);
    // conferir e fora vão só no primeiro lote, para não repetir
    await writeExcelFile(abas(lote, i === 0 ? conferir : undefined, i === 0 ? fora : undefined).map((a) => ({ ...a, stickyRowsCount: 1 }))).toFile(arq);
    arquivos.push(arq);
  }
  const motivos = Object.entries(Object.groupBy(fora, (f) => motivoCurto(f.motivo))).map(([m, xs]) => `${xs!.length} ${m}`);
  console.log(`\n${novos.length + conferir.length + fora.length} lugares → ${novos.length} novos, ${conferir.length} conferir, ${fora.length} fora (${motivos.join(", ") || "nenhum"})`);
  for (const a of arquivos) console.log(`  ${a}`);
  console.log(`\nprévia: npm run gerar:sites -- <arquivo>   depois: --aplicar`);
}

// ---- worker da fila ----------------------------------------------------------------------------

const coletas = adminDb.collection("coletas");
class Cancelada extends Error {}

/** Escreve no pedido só se ele ainda é deste worker e está coletando: o admin pode ter
 *  cancelado, ou recolocado na fila para outro worker, desde a última conferência. */
async function seAindaMeu(ref: FirebaseFirestore.DocumentReference, worker: string, mudanca?: Record<string, unknown>) {
  await adminDb.runTransaction(async (tx) => {
    const d = await tx.get(ref);
    if (d.get("estado") !== "coletando" || d.get("worker") !== worker) throw new Cancelada();
    if (mudanca) tx.update(ref, mudanca);
  });
}

/** Primeiro o pedido que este worker largou no meio (queda, reinício); depois o mais antigo da fila. */
async function pegar(worker: string) {
  return adminDb.runTransaction(async (tx) => {
    const meu = await tx.get(coletas.where("estado", "==", "coletando").where("worker", "==", worker).limit(1));
    if (!meu.empty) return meu.docs[0];
    const fila = await tx.get(coletas.where("estado", "==", "fila"));
    const d = fila.docs.sort((a, b) => a.get("criadaEm")?.toMillis() - b.get("criadaEm")?.toMillis())[0];
    if (!d) return null;
    tx.update(d.ref, { estado: "coletando", worker, iniciadaEm: FieldValue.serverTimestamp(), erro: null });
    return d;
  });
}

/** Resultado no Firestore: os lugares em coletas/{id}/leads (um documento cada, por causa do
 *  limite de 1 MB por documento) e o resumo no pedido. O admin gera os sites a partir dos novos. */
async function gravarResultado(id: string, worker: string, final: ReturnType<typeof paraGerador>) {
  const ref = coletas.doc(id);
  const leads = ref.collection("leads");
  await seAindaMeu(ref, worker); // antes de apagar: os leads podem já ser de quem pegou o pedido depois
  await adminDb.recursiveDelete(leads); // coleta refeita: sem sobras da anterior
  const docs = [
    // o Firestore recusa undefined: o JSON tira os campos opcionais vazios do lead
    ...final.novos.map((n) => ({ situacao: "novo", nome: n.lead.nome, cidade: n.lead.cidade, link_maps: n.link_maps, lead: JSON.parse(JSON.stringify(n.lead)) })),
    ...final.conferir.map((l) => ({ situacao: "conferir", ...l })),
    ...final.fora.map((l) => ({ situacao: "fora", ...l })),
  ];
  for (let i = 0; i < docs.length; i += 400) {
    const lote = adminDb.batch();
    docs.slice(i, i + 400).forEach((d, k) => lote.set(leads.doc(String(placeId(d.link_maps) ?? `sem-id-${i + k}`).replace(/[:/]/g, "_")), d));
    await lote.commit();
  }
  const motivos: Record<string, number> = {};
  for (const f of final.fora) motivos[motivoCurto(f.motivo)] = (motivos[motivoCurto(f.motivo)] ?? 0) + 1;
  const resumo: Resumo = { novos: final.novos.length, conferir: final.conferir.length, fora: final.fora.length, motivos };
  await seAindaMeu(ref, worker, { estado: "pronta", resumo, terminadaEm: FieldValue.serverTimestamp() });
  return resumo;
}

async function worker() {
  const nome = process.env.COLETA_WORKER ?? hostname();
  const eu = adminDb.collection("coletaWorkers").doc(nome);
  manterAcordado();
  process.on("SIGINT", async () => {
    fecharNavegador();
    console.log("\nworker parado: o pedido em andamento continua quando ele voltar");
    // o admin vê na hora que ele saiu, em vez de esperar 3 min sem sinal
    await Promise.race([eu.set({ batidaEm: null, ocupado: null }, { merge: true }), esperar(3000)]).catch(() => {});
    process.exit(130);
  });
  console.log(`worker ${nome}: esperando pedidos (Ctrl+C para parar)`);
  for (;;) {
    await eu.set({ batidaEm: FieldValue.serverTimestamp(), ocupado: null }, { merge: true });
    const doc = await pegar(nome);
    if (!doc) {
      await esperar(30_000);
      continue;
    }
    const p: Pedido = { id: doc.id, cidade: doc.get("cidade"), uf: doc.get("uf"), bairros: doc.get("bairros") ?? [], termos: doc.get("termos")?.length ? doc.get("termos") : TERMOS_PADRAO };
    console.log(`\n▶ ${p.cidade}/${p.uf} (${doc.id})`);
    // o andamento vai para o admin a cada 20 s; é também quando o worker descobre um cancelamento
    let ultimo = 0;
    const aoAvancar = async (pr: Progresso) => {
      if (Date.now() - ultimo < 20_000) return;
      ultimo = Date.now();
      try {
        await seAindaMeu(doc.ref, nome, { progresso: pr, batidaEm: FieldValue.serverTimestamp() });
        await eu.set({ batidaEm: FieldValue.serverTimestamp(), ocupado: doc.id }, { merge: true });
      } catch (e) {
        // falha passageira do Firestore não pode derrubar horas de coleta: tenta no próximo aviso
        if (e instanceof Cancelada) throw e;
        console.log(`  (andamento não publicado: ${(e as Error).message})`);
      }
    };
    try {
      const resumo = await gravarResultado(doc.id, nome, paraGerador(await coletar(p, aoAvancar)));
      console.log(`✓ ${p.cidade}/${p.uf}: ${resumo.novos} novos, ${resumo.conferir} conferir, ${resumo.fora} fora`);
    } catch (e) {
      fecharNavegador();
      if (e instanceof Interrompida) process.exit(130);
      if (e instanceof Cancelada) {
        console.log(`■ ${p.cidade}/${p.uf}: cancelada ou passada a outro worker no admin`);
        continue;
      }
      console.error(`✗ ${p.cidade}/${p.uf}:`, e);
      await seAindaMeu(doc.ref, nome, { estado: "erro", erro: (e as Error).message.slice(0, 500), terminadaEm: FieldValue.serverTimestamp() }).catch(() => {});
    }
  }
}

if (process.argv.includes("--fila")) await worker();
else {
  manterAcordado();
  try {
    await direto();
  } catch (e) {
    fecharNavegador();
    if (e instanceof Interrompida) {
      console.log("\ninterrompido: rode o mesmo comando para continuar");
      process.exit(130);
    }
    throw e;
  }
}
process.exit(0);
