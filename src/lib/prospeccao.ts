import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { EtapaCadencia } from "@/lib/crm-tipos";
import { VARIANTES, VARIANTES_F1, type Nicho, type Variante } from "@/lib/prospeccao-variantes";
import { paraSlug, type VarianteId } from "@/lib/tipos-marca";

// A/B da prospecção (F1): a variante sai do hash do slug, sem sorteio. O mesmo lead recebe
// sempre a mesma, e a divisão fica perto de meio a meio. Só o nicho salão entra nesta fase.

/** hash(slug) % 2: o índice da variante, estável por lead. */
export const varianteAB = (slug: string): Variante =>
  VARIANTES_F1[createHash("sha256").update(slug).digest().readUInt32BE(0) % VARIANTES_F1.length];

/** A variante do "Primeiro contato" do negócio, ou null fora do piloto (outro nicho). */
export const varianteDoNegocio = (slug: string, sub: unknown): Variante | null => (sub === "salao" ? varianteAB(slug) : null);

// ————— rotação por nicho (F2) —————

/** Os números de uma variante (prospeccaoVariantes/{id}); `ultimoEnvioEm` em ms. */
export type StatsVariante = { enviados: number; respostas: number; optouts: number; ultimoEnvioEm?: number };
export type Alerta = { id: VarianteId; motivo: string };

/** Pausa só com amostra: abaixo disso, a taxa ainda é ruído e vira só alerta. */
export const PAUSA = { optout: { minimo: 80, taxa: 0.04 }, semResposta: { minimo: 100 } } as const;
// ponytail: o alerta de "nenhuma resposta" começa em 50 envios, metade da pausa; ajustar com dados reais
const ALERTA_SEM_RESPOSTA = 50;

function saude(id: VarianteId, s: StatsVariante | undefined): { pausada: boolean; alerta?: Alerta } {
  if (!s || s.enviados <= 0) return { pausada: false };
  const optoutAlto = s.optouts / s.enviados > PAUSA.optout.taxa;
  if (optoutAlto && s.enviados >= PAUSA.optout.minimo) return { pausada: true, alerta: { id, motivo: `opt-out acima de 4% em ${s.enviados} envios` } };
  if (s.respostas === 0 && s.enviados >= PAUSA.semResposta.minimo) return { pausada: true, alerta: { id, motivo: `nenhuma resposta humana em ${s.enviados} envios` } };
  if (optoutAlto) return { pausada: false, alerta: { id, motivo: `opt-out acima de 4%, mas só ${s.enviados} envios: amostra pequena` } };
  if (s.respostas === 0 && s.enviados >= ALERTA_SEM_RESPOSTA) return { pausada: false, alerta: { id, motivo: `nenhuma resposta humana em ${s.enviados} envios: amostra pequena` } };
  return { pausada: false };
}

/** Envios somados das ativas do nicho e etapa antes de a rotação começar. Abaixo disso a variante é
 *  fixa (a primeira ativa que o lead não recebeu): sortear com amostra pequena só espalha ruído.
 *  ponytail: o mesmo número da pausa por falta de resposta; ajustar com dados reais. */
export const AMOSTRA_ROTACAO = PAUSA.semResposta.minimo;

/** A variante da etapa para o lead (pura; o sorteio vem de fora para o teste ser determinístico):
 *  1. as ativas (não pausadas) do nicho; sem nenhuma, as de `geral`;
 *  2. sem as que o lead já recebeu;
 *  3. amostra abaixo de AMOSTRA_ROTACAO: a primeira que sobrou, sempre a mesma (sem sorteio);
 *  4. depois: sem a última enviada naquele nicho e etapa (não repete em sequência; só quando sobra
 *     outra não recebida) e sorteio com peso (respostas+1)/(enviados+2).
 *  ponytail: média suavizada, não Thompson; trocar quando houver volume para separar as variantes.
 *  `biblioteca`: as ativas de prospeccaoVariantes (F4, lerBiblioteca); sem ela, a do código.
 *  null: nenhuma sobrou (a gaveta usa o texto padrão). */
export function escolherVariante(
  lead: { nicho: Nicho; recebidas: readonly string[] },
  etapa: EtapaCadencia,
  stats: Readonly<Record<string, StatsVariante>>,
  aleatorio: () => number,
  biblioteca: readonly Variante[] = VARIANTES,
): { variante: Variante | null; pausadas: VarianteId[]; alertas: Alerta[] } {
  const pausadas: VarianteId[] = [];
  const alertas: Alerta[] = [];
  const ativas = (nicho: Nicho) =>
    biblioteca.filter((v) => v.nicho === nicho && v.etapa === etapa).filter((v) => {
      const s = saude(v.id, stats[v.id]);
      if (s.alerta) alertas.push(s.alerta);
      if (s.pausada) pausadas.push(v.id);
      return !s.pausada;
    });
  let pool = ativas(lead.nicho);
  if (!pool.length && lead.nicho !== "geral") pool = ativas("geral");
  const naoRecebidas = pool.filter((v) => !lead.recebidas.includes(v.id));
  const amostra = pool.reduce((t, v) => t + (stats[v.id]?.enviados ?? 0), 0);
  if (amostra < AMOSTRA_ROTACAO) return { variante: naoRecebidas[0] ?? null, pausadas, alertas };
  const ultima = pool.reduce<Variante | null>((m, v) => ((stats[v.id]?.ultimoEnvioEm ?? -1) > (m ? (stats[m.id]?.ultimoEnvioEm ?? -1) : -1) ? v : m), null);
  // sem a última só quando sobra outra: com uma só não recebida, ela sai (nunca null por isso)
  const semUltima = naoRecebidas.filter((v) => v.id !== ultima?.id);
  const candidatas = semUltima.length ? semUltima : naoRecebidas;
  const peso = (v: Variante) => ((stats[v.id]?.respostas ?? 0) + 1) / ((stats[v.id]?.enviados ?? 0) + 2);
  let sorteio = aleatorio() * candidatas.reduce((t, v) => t + peso(v), 0);
  const variante = candidatas.find((v) => (sorteio -= peso(v)) < 0) ?? candidatas.at(-1) ?? null;
  return { variante, pausadas, alertas };
}

// ————— visita ao site demo (beacon) —————

/** Prévia de link (WhatsApp, Facebook, Telegram...) e robôs: abrir o link no app já dispara a
 *  prévia, que não é visita. Sem user-agent também não conta. Robô genérico só com borda antes
 *  (início, espaço, ";", "/", "(", "+" ou "-") ou seguido de versão ("MJ12bot/1.4"): "Googlebot"
 *  casa pelo nome, "+http://…/bot.html" pela borda; "CUBOT X30" (marca de celular) não. */
const PREVIA = /whatsapp|facebookexternalhit|facebot|meta-externalagent|telegrambot|twitterbot|slackbot|discordbot|linkedinbot|skypeuripreview|googlebot|bingbot|applebot|yandexbot|baiduspider|duckduckbot|ahrefsbot|semrushbot|petalbot|gptbot|bot\/|(?:^|[\s;/(+-])(?:bot|crawler|spider)|preview|headless|curl|wget|python|go-http|okhttp|java\//i;
export const ehPrevia = (ua: string | null | undefined) => !ua?.trim() || PREVIA.test(ua);

/** Quantas visitas por hora cada IP e cada slug podem gravar. Por slug é uma: o funil quer saber
 *  se viu, e o resto da hora é a mesma pessoa rolando a página. */
export const LIMITE_VISITA = { porIp: 20, porSlug: 1, janelaMs: 60 * 60_000 } as const;

/** A chave do IP no limitador: IPv6 por /64 (um cliente costuma ter o /64 inteiro e trocar o
 *  sufixo à vontade); IPv4 (e IPv4 mapeado em IPv6) como está. */
export function chaveDoIp(ip: string) {
  if (ip.includes(".") || !ip.includes(":")) return ip.slice(ip.lastIndexOf(":") + 1);
  const [esq, dir] = ip.toLowerCase().split("::");
  const a = esq ? esq.split(":") : [];
  const b = dir ? dir.split(":") : [];
  const grupos = dir === undefined ? a : [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b];
  return grupos.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

/** Limite em memória: a produção é um processo só na VPS. Um Map por IP e outro por slug, cada um com
 *  teto (`maxChaves`). No de IP, passou do teto, saem as chaves mais antigas (o Map guarda a ordem de
 *  inserção, e a janela renovada volta ao fim). No de slug só saem as vencidas: despejar um slug ainda
 *  na janela daria uma segunda visita na mesma hora, e quem chama só cria chave de slug conhecido.
 *  ponytail: contador por processo; vira documento no Firestore se a VPS tiver mais de um processo.
 *  ponytail: acima do teto, o Map de slug varre as chaves a cada chave nova; limitado pelo número de
 *  slugs que existem (índice do painel), ou pelo teto por IP quando o índice ainda não montou. */
export function limitador(limite: { porIp: number; porSlug: number; janelaMs: number } = LIMITE_VISITA, maxChaves = 5000) {
  type Contas = Map<string, { n: number; ate: number }>;
  const ips: Contas = new Map();
  const slugs: Contas = new Map();
  const conta = (contas: Contas, k: string, max: number, agora: number, vigenteSai: boolean) => {
    const c = contas.get(k);
    if (!c || c.ate <= agora) {
      contas.delete(k);
      contas.set(k, { n: 1, ate: agora + limite.janelaMs });
      for (const [velha, v] of contas) {
        if (contas.size <= maxChaves) break;
        if (vigenteSai || v.ate <= agora) contas.delete(velha);
      }
      return true;
    }
    if (c.n >= max) return false;
    c.n++;
    return true;
  };
  const ip = (ip: string, agora = Date.now()) => conta(ips, chaveDoIp(ip), limite.porIp, agora, true);
  const slug = (slug: string, agora = Date.now()) => conta(slugs, slug, limite.porSlug, agora, false);
  const pode = (i: string, s: string, agora = Date.now()) => ip(i, agora) && slug(s, agora);
  return Object.assign(pode, { ip, slug, tamanho: () => ips.size + slugs.size });
}

/** O corpo do beacon é `{"slug":"…"}`: mais que isto é abuso, e nem é lido. */
export const CORPO_VISITA_MAX = 256;
const CorpoVisita = z.object({ slug: z.string().max(63) });

/** O POST /api/visita, com o que toca o banco de fora (o teste troca por dublês):
 *  - `registrar`: grava a visita (registrarVisita);
 *  - `conhecido`: o slug existe? null quando não dá para saber sem ir ao Firestore.
 *  Prévia, slug inexistente, slug que já contou na hora e visita gravada respondem igual (204): ninguém
 *  descobre quais slugs existem. Só o teto por IP dá 429. A resposta não espera a gravação. */
export function rotaVisita(dep: { registrar: (slug: string) => Promise<unknown>; conhecido: (slug: string) => boolean | null }, pode = limitador()) {
  const vazio = (status: number) => new Response(null, { status });
  return async (req: Request) => {
    if (ehPrevia(req.headers.get("user-agent"))) return vazio(204);
    // tamanho conferido antes de ler: sem content-length (corpo em pedaços) também não passa
    const tamanho = Number(req.headers.get("content-length") ?? NaN);
    if (!(tamanho >= 0 && tamanho <= CORPO_VISITA_MAX)) return vazio(413);
    const bruto = await req.text();
    if (bruto.length > CORPO_VISITA_MAX) return vazio(413);
    // o beacon manda texto simples (JSON no corpo): sem CORS e sem preflight
    let json: unknown = null;
    try {
      json = JSON.parse(bruto);
    } catch {
      return vazio(400);
    }
    const corpo = CorpoVisita.safeParse(json);
    const slug = corpo.success ? paraSlug(corpo.data.slug) : null;
    if (!slug) return vazio(400);
    // x-real-ip vem do proxy; no x-forwarded-for vale o último, que quem chama não escolhe
    const ip = req.headers.get("x-real-ip")?.trim() || req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "sem-ip";
    if (!pode.ip(ip)) return vazio(429);
    if (dep.conhecido(slug) === false) return vazio(204);
    // a chave do slug só nasce depois de saber que ele existe (slug inventado não ocupa o Map); o que
    // passou do teto do slug responde o mesmo 204 do slug inexistente
    if (!pode.slug(slug)) return vazio(204);
    dep.registrar(slug).catch((e: unknown) => console.error(`[visita] ${slug}: não gravou a visita. ${e instanceof Error ? e.message : String(e)}`));
    return vazio(204);
  };
}

/** O script que o site demo leva: avisa a visita depois de 3 s na página e de uma rolagem. Texto
 *  simples no corpo (sendBeacon com JSON exigiria CORS); `slug` já passou por SLUG_SITE. */
export const scriptVisita = (slug: string) =>
  `<script>(function(){var t=0,r=0,f=0;function v(){if(t&&r&&!f&&navigator.sendBeacon){f=1;navigator.sendBeacon("/api/visita",JSON.stringify({slug:${JSON.stringify(slug)}}))}}setTimeout(function(){t=1;v()},3000);addEventListener("scroll",function(){r=1;v()},{passive:true,once:true})})()</script>`;

/** O HTML com o beacon antes do </body> (ou no fim, sem ele). */
export const comBeacon = (html: string, slug: string) => {
  const i = html.lastIndexOf("</body>");
  return i < 0 ? html + scriptVisita(slug) : html.slice(0, i) + scriptVisita(slug) + html.slice(i);
};
