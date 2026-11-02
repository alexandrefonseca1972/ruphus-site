import "server-only";
import type { DocumentSnapshot, Firestore, QuerySnapshot } from "firebase-admin/firestore";
import { negocio, trivial } from "@/lib/crm";
import type { Crm } from "@/lib/crm-tipos";
import { LIMITE_STAFF_MAX, limiteStaffDe } from "@/lib/limites";
import { ehUf, limparTexto, nichoDe, type Espaco } from "@/lib/painel-tipos";

// Índice do painel do admin (docs/plano-paginacao-admin.md, 3.1): uma cópia enxuta de
// tenants, crm, config/admin e dos membros de fora da plataforma, mantida por listeners.
// Montado na primeira consulta e solto depois de OCIOSO_MS sem consulta: reinício sem
// ninguém no admin não custa leitura. As consultas são síncronas e os callbacks dos
// listeners também, então uma consulta nunca vê uma mudança aplicada pela metade.

export const OCIOSO_MS = 2 * 3_600_000;
const ESPERA_MAX_MS = 60_000;

const colador = new Intl.Collator("pt-BR");

const textoOuNull = (v: unknown, max: number) => (typeof v === "string" ? limparTexto(v).slice(0, max) || null : null);
const numeroEntre = (v: unknown, min: number, max: number, inteiro = false) =>
  typeof v === "number" && Number.isFinite(v) && v >= min && v <= max && (!inteiro || Number.isInteger(v)) ? v : null;
// o telefone fica como foi gravado (a busca acha "(91) 9…"); sem dígitos de um telefone, some
const telefoneOuNull = (v: unknown) => {
  const t = textoOuNull(v, 30);
  const digitos = t?.replace(/\D/g, "").length ?? 0;
  return digitos >= 8 && digitos <= 15 ? t : null;
};

/** O tenant como a lista o mostra, com cada campo conferido (6.3): valor de tipo ou faixa
 *  errada vira o neutro, e `corrigido` diz se algum campo presente foi descartado. */
export function espacoDe(slug: string, get: (campo: string) => unknown, acessos: number) {
  let corrigido = false;
  const conferido = <T>(campo: string, limpar: (v: unknown) => T | null): T | null => {
    const bruto = get(campo);
    const limpo = limpar(bruto);
    if (bruto != null && bruto !== "" && limpo === null) corrigido = true;
    return limpo;
  };
  const espaco: Espaco = {
    slug,
    nome: conferido("name", (v) => textoOuNull(v, 120)) ?? slug,
    telefone: conferido("site.phone", telefoneOuNull),
    nicho: nichoDe(get("site.category")),
    cidade: conferido("site.city", (v) => textoOuNull(v, 80)),
    uf: conferido("site.uf", (v) => (typeof v === "string" && ehUf(v) ? v : null)),
    nota: conferido("site.rating", (v) => numeroEntre(v, 0, 5)),
    avaliacoes: conferido("site.reviews", (v) => numeroEntre(v, 0, 1e9, true)),
    acessos,
    limiteStaff: limiteStaffDe(conferido("limiteStaff", (v) => numeroEntre(v, 0, LIMITE_STAFF_MAX, true))),
    caixa: get("modulos.financeiro") === true,
  };
  return { espaco, corrigido };
}

type Estado = {
  versao: number;
  montadoEm: number;
  espacos: Map<string, Espaco>;
  crm: Record<string, Crm>;
  admins: string[];
  revogados: unknown;
  /** os membros de fora da plataforma que gerem o espaço: caminho do documento → slug */
  clientes: Map<string, string>;
  porEspaco: Map<string, number>;
  /** em cada espaço com cliente, quantas contas da plataforma também gerem */
  ruphus: Map<string, number>;
  /** sem o not-in (0 ou mais de 10 contas da plataforma), ouve todos os membros */
  filtrado: boolean;
  corrigidos: number;
  pulados: number;
  lista: Espaco[] | null;
  soltar: (() => void)[];
  /** falso depois de solto: uma montagem cujo listener caiu no meio não vira o índice */
  vivo: boolean;
};

export type Indice = {
  versao: number;
  montadoEm: number;
  /** ordenada por nome; o mesmo array enquanto nada muda (a consulta guarda cache por ele) */
  lista: () => Espaco[];
  crm: Record<string, Crm>;
  admins: readonly string[];
  revogados: unknown;
};

export class IndiceIndisponivel extends Error {}

type Ouvinte<S> = { onSnapshot(proximo: (s: S) => void, erro: (e: Error) => void): () => void };

type Log = Pick<Console, "info" | "error">;

export function criarIndice(db: Firestore, { ociosoMs = OCIOSO_MS, log = console as Log } = {}) {
  let atual: Estado | null = null;
  let montando: Promise<Estado> | null = null;
  let ocioso: ReturnType<typeof setTimeout> | undefined;
  let falhas = 0;
  let proximaTentativa = 0;

  const visao = (e: Estado): Indice => ({
    versao: e.versao,
    montadoEm: e.montadoEm,
    lista: () => (e.lista ??= [...e.espacos.values()].sort((a, b) => colador.compare(a.nome, b.nome))),
    crm: e.crm,
    admins: e.admins,
    revogados: e.revogados,
  });

  function desmontar(e: Estado, motivo: string) {
    e.vivo = false;
    e.soltar.splice(0).forEach((s) => s());
    if (atual === e) atual = null;
    log.info(`[painel] índice solto (${motivo})`);
  }

  const acessosDe = (e: Estado, slug: string) => {
    const n = e.porEspaco.get(slug) ?? 0;
    return e.filtrado ? (n ? n + (e.ruphus.get(slug) ?? 0) : 1) : n;
  };

  function mudou(e: Estado) {
    e.versao++;
    e.lista = null;
  }

  function atualizarAcessos(e: Estado, slugs: Iterable<string>) {
    for (const s of slugs) {
      const antes = e.espacos.get(s);
      const acessos = acessosDe(e, s);
      if (antes && antes.acessos !== acessos) e.espacos.set(s, { ...antes, acessos });
    }
    mudou(e);
  }

  /** Nos espaços com cliente, se a plataforma também gere: acessos = cliente + plataforma. */
  // ponytail: só relido quando um membro de fora muda no espaço; a plataforma entrar ou sair
  // sozinha de um espaço com cliente aparece na próxima montagem
  async function lerRuphus(e: Estado, slugs: string[]) {
    if (!e.filtrado || !slugs.length || !e.admins.length) return;
    const refs = slugs.flatMap((s) => e.admins.map((uid) => db.doc(`tenants/${s}/members/${uid}`)));
    const docs = await db.getAll(...refs, { fieldMask: ["role"] });
    for (const s of slugs) e.ruphus.set(s, 0);
    for (const d of docs) {
      const s = d.ref.parent.parent?.id;
      if (s && d.exists && d.get("role") !== "member") e.ruphus.set(s, (e.ruphus.get(s) ?? 0) + 1);
    }
    atualizarAcessos(e, slugs);
  }

  /** Cada documento num try: um com problema é pulado e contado, os outros entram. */
  function cadaMudanca(e: Estado, snap: QuerySnapshot, aplicar: (d: DocumentSnapshot, removido: boolean) => void) {
    for (const m of snap.docChanges()) {
      try {
        aplicar(m.doc, m.type === "removed");
      } catch (err) {
        e.pulados++;
        log.error(`[painel] documento pulado: ${m.doc.ref.path}`, err instanceof Error ? err.message : err);
      }
    }
    mudou(e);
  }

  /** Ouve e resolve no primeiro snapshot. Erro depois disso solta o índice: a próxima consulta monta de novo. */
  function ouvir<S>(e: Estado, alvo: Ouvinte<S>, aplicar: (s: S) => void) {
    return new Promise<void>((pronto, falhou) => {
      let primeiro = true;
      e.soltar.push(
        alvo.onSnapshot(
          (s) => {
            try {
              aplicar(s);
            } catch (err) {
              log.error("[painel] falha ao aplicar mudança", err);
            }
            if (primeiro) {
              primeiro = false;
              pronto();
            }
          },
          (err) => {
            if (primeiro) return falhou(err);
            log.error("[painel] listener caiu", err);
            desmontar(e, "listener caiu");
          },
        ),
      );
    });
  }

  async function montar(): Promise<Estado> {
    const inicio = Date.now();
    const e: Estado = {
      versao: 0, montadoEm: 0, espacos: new Map(), crm: {}, admins: [], revogados: undefined,
      clientes: new Map(), porEspaco: new Map(), ruphus: new Map(), filtrado: false,
      corrigidos: 0, pulados: 0, lista: null, soltar: [], vivo: true,
    };
    try {
      // config/admin primeiro: a consulta de membros depende das contas da plataforma
      await ouvir(e, db.doc("config/admin"), (d: DocumentSnapshot) => {
        const uids = d.get("uids");
        const admins = Array.isArray(uids) ? uids.filter((u): u is string => typeof u === "string") : [];
        e.revogados = d.get("revogados");
        if (e.montadoEm && admins.join() !== e.admins.join()) {
          // a consulta not-in mudou: monta outro índice e troca quando ficar pronto
          log.info("[painel] contas da plataforma mudaram; remontando");
          void substituir(e);
        }
        e.admins = admins;
      });
      e.filtrado = e.admins.length > 0 && e.admins.length <= 10;
      const membros = e.filtrado ? db.collectionGroup("members").where("uid", "not-in", e.admins) : db.collectionGroup("members");
      let ruphusPendente: Promise<void> = Promise.resolve();
      await Promise.all([
        ouvir(e, db.collection("tenants"), (snap: QuerySnapshot) =>
          cadaMudanca(e, snap, (d, removido) => {
            if (removido) return void e.espacos.delete(d.id);
            const { espaco, corrigido } = espacoDe(d.id, (c) => d.get(c), acessosDe(e, d.id));
            if (corrigido) e.corrigidos++;
            e.espacos.set(d.id, espaco);
          }),
        ),
        ouvir(e, db.collection("crm"), (snap: QuerySnapshot) =>
          cadaMudanca(e, snap, (d, removido) => {
            if (removido || trivial(d)) delete e.crm[d.id];
            else e.crm[d.id] = negocio(d);
          }),
        ),
        ouvir(e, membros, (snap: QuerySnapshot) => {
          const tocados = new Set<string>();
          cadaMudanca(e, snap, (d, removido) => {
            const espaco = d.ref.parent.parent;
            if (espaco?.parent.id !== "tenants") return;
            const antes = e.clientes.get(d.ref.path);
            if (antes) e.porEspaco.set(antes, (e.porEspaco.get(antes) ?? 1) - 1);
            e.clientes.delete(d.ref.path);
            if (!removido && d.get("role") !== "member") {
              e.clientes.set(d.ref.path, espaco.id);
              e.porEspaco.set(espaco.id, (e.porEspaco.get(espaco.id) ?? 0) + 1);
            }
            tocados.add(espaco.id);
          });
          const slugs = [...tocados];
          atualizarAcessos(e, slugs);
          ruphusPendente = lerRuphus(e, slugs.filter((s) => (e.porEspaco.get(s) ?? 0) > 0)).catch((err) =>
            log.error("[painel] falha ao conferir a plataforma nos espaços com cliente", err),
          );
        }),
      ]);
      await ruphusPendente;
      if (!e.vivo) throw new IndiceIndisponivel("listener caiu durante a montagem");
      // os tenants podem ter chegado antes dos membros: acerta os acessos de todos uma vez
      atualizarAcessos(e, e.espacos.keys());
      e.montadoEm = Date.now();
      falhas = 0;
      const heap = Math.round(process.memoryUsage().heapUsed / 2 ** 20);
      log.info(
        `[painel] índice montado em ${((e.montadoEm - inicio) / 1000).toFixed(1)} s: ${e.espacos.size} negócios, ` +
          `${Object.keys(e.crm).length} no CRM, ${e.clientes.size} membros de fora, ${e.corrigidos} corrigidos, ` +
          `${e.pulados} pulados, heap ${heap} MB`,
      );
      return e;
    } catch (err) {
      e.vivo = false;
      e.soltar.splice(0).forEach((s) => s());
      falhas++;
      proximaTentativa = Date.now() + Math.min(1000 * 2 ** (falhas - 1), ESPERA_MAX_MS);
      log.error(`[painel] montagem falhou (${falhas}ª seguida)`, err);
      throw err;
    }
  }

  /** Troca atômica: o índice velho responde até o novo ficar pronto. */
  async function substituir(velho: Estado) {
    try {
      const novo = await (montando ??= montar().finally(() => (montando = null)));
      if (atual === velho) atual = novo;
      desmontar(velho, "substituído");
    } catch {
      // falhou: o velho continua respondendo
    }
  }

  function tocar() {
    clearTimeout(ocioso);
    ocioso = setTimeout(() => atual && desmontar(atual, "ocioso"), ociosoMs);
    ocioso.unref?.();
  }

  return {
    /** O índice pronto: monta na primeira chamada, e chamadas juntas esperam a mesma montagem. */
    async pronto(): Promise<Indice> {
      tocar();
      if (atual) return visao(atual);
      if (!montando && Date.now() < proximaTentativa) throw new IndiceIndisponivel("montagem falhou há pouco");
      montando ??= montar().finally(() => (montando = null));
      const e = await montando;
      atual ??= e;
      return visao(atual);
    },
    /** O índice se já estiver montado, sem montar (a rota usa a cópia de config/admin). */
    montado: (): Indice | null => (atual ? visao(atual) : null),
    soltar() {
      clearTimeout(ocioso);
      if (atual) desmontar(atual, "pedido");
    },
  };
}
