import type { Dia, Situacao } from "@/lib/consumo-tela";
import { FAIXAS } from "@/lib/consumo-tela";

// Gráficos da tela de consumo em SVG puro (sem biblioteca): o desenho aprovado em 10/11 (pranchas em
// docs/consumo-desenho). Cada um tem aria-label com o que mostra, para quem não vê o desenho.

export const COR = { whatsapp: "#0f766e", sms: "#1d4ed8" } as const;
export const COR_SITUACAO: Record<Situacao, string> = { lida: "#0f766e", entregue: "#5eb5a8", enviada: "#d4d4d8", parada: "#f59e0b", falhou: "#dc2626" };
export const ROTULO_SITUACAO: Record<Situacao, string> = { lida: "Lida", entregue: "Entregue", enviada: "Enviada", parada: "Parada", falhou: "Falhou" };

const SEMANA_CURTA = ["D", "S", "T", "Q", "Q", "S", "S"];
export const SEMANA_LONGA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** Linha do saldo nos últimos dias (no cartão escuro). */
export function LinhaDoSaldo({ pontos, rotulo }: { pontos: number[]; rotulo: string }) {
  if (pontos.length < 2) return null;
  const max = Math.max(...pontos, 1);
  const min = Math.min(...pontos, 0);
  const x = (i: number) => (i / (pontos.length - 1)) * 320;
  const y = (v: number) => 38 - ((v - min) / (max - min || 1)) * 32;
  const d = pontos.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 320 44" width="100%" height="44" role="img" aria-label={rotulo} preserveAspectRatio="none">
      <defs>
        <linearGradient id="saldo-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#34d399" stopOpacity=".45" />
          <stop offset="1" stopColor="#34d399" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${d} L320 44 L0 44Z`} fill="url(#saldo-grad)" />
      <path d={d} fill="none" stroke="#34d399" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** Linha pequena das mensagens por dia (cartão "Mensagens"). */
export function Faisca({ valores }: { valores: number[] }) {
  if (valores.length < 2) return null;
  const max = Math.max(...valores, 1);
  const pts = valores.map((v, i) => `${((i / (valores.length - 1)) * 120).toFixed(1)},${(26 - (v / max) * 24).toFixed(1)}`).join(" ");
  return (
    <svg viewBox="0 0 120 28" width="120" height="28" aria-hidden="true">
      <polyline fill="none" stroke={COR.whatsapp} strokeWidth="2" strokeLinejoin="round" points={pts} />
    </svg>
  );
}

/** Anel de porcentagem (cartão "Entrega"). */
export function Anel({ pct, rotulo }: { pct: number; rotulo: string }) {
  const c = 2 * Math.PI * 20;
  return (
    <svg viewBox="0 0 48 48" width="48" height="48" role="img" aria-label={rotulo} className="shrink-0">
      <circle cx="24" cy="24" r="20" fill="none" stroke="#f0f0f1" strokeWidth="6" />
      <circle cx="24" cy="24" r="20" fill="none" stroke={COR.whatsapp} strokeWidth="6" strokeDasharray={`${(c * pct) / 100} ${c}`} strokeLinecap="round" transform="rotate(-90 24 24)" />
    </svg>
  );
}

/** Barra dividida pelas situações (lida, entregue, …). */
export function Segmentos({ partes, rotulo, alta }: { partes: { cor: string; n: number }[]; rotulo: string; alta?: boolean }) {
  const total = partes.reduce((t, p) => t + p.n, 0);
  return (
    <div role="img" aria-label={rotulo} className={`flex w-full overflow-hidden rounded-full bg-[#f0f0f1] ${alta ? "h-3" : "h-2.5"}`}>
      {total > 0 && partes.filter((p) => p.n > 0).map((p, i) => <i key={i} className="block h-full" style={{ width: `${(p.n / total) * 100}%`, background: p.cor }} />)}
    </div>
  );
}

/** O caminho das mensagens de WhatsApp: enviadas → aceitas → entregues → lidas. */
export function Funil({ etapas }: { etapas: { rotulo: string; n: number }[] }) {
  const max = Math.max(1, etapas[0]?.n ?? 0);
  const cores = ["#0f766e", "#14857c", "#2a9d8f", "#5eb5a8"];
  const larg = 560 / etapas.length;
  return (
    <svg viewBox="0 0 560 76" width="100%" height="76" role="img" aria-label={`Caminho das mensagens de WhatsApp: ${etapas.map((e) => `${e.n} ${e.rotulo}`).join(", ")}`}>
      <g fontFamily="inherit" fontSize="12">
        {etapas.map((e, i) => {
          const h = Math.max(14, (e.n / max) * 36);
          const x = i * larg;
          return (
            <g key={e.rotulo}>
              <rect x={x} y={26 - h / 2} width={larg - 16} height={h} rx="6" fill={cores[i] ?? cores.at(-1)} />
              <text x={x + (larg - 16) / 2} y="30.5" textAnchor="middle" fill="#fff" fontWeight="700" fontSize="14">{e.n}</text>
              <text x={x + (larg - 16) / 2} y="64" textAnchor="middle" fill="#52525b">{e.rotulo}</text>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

/** Rosca do custo por canal. */
export function Rosca({ whatsapp, sms, centro, rotulo }: { whatsapp: number; sms: number; centro: string; rotulo: string }) {
  const c = 2 * Math.PI * 38;
  const total = whatsapp + sms;
  const parte = total ? (whatsapp / total) * c : 0;
  return (
    <svg viewBox="0 0 96 96" width="96" height="96" role="img" aria-label={rotulo} className="shrink-0">
      <circle cx="48" cy="48" r="38" fill="none" stroke={total ? COR.sms : "#f0f0f1"} strokeWidth="14" />
      {total > 0 && <circle cx="48" cy="48" r="38" fill="none" stroke={COR.whatsapp} strokeWidth="14" strokeDasharray={`${parte} ${c}`} transform="rotate(-90 48 48)" />}
      <text x="48" y="46" textAnchor="middle" fontSize="12" fontWeight="700" fill="currentColor">{centro}</text>
      <text x="48" y="60" textAnchor="middle" fontSize="10" fill="#71717a">no mês</text>
    </svg>
  );
}

/** Mapa de calor da leitura: faixas de hora × dias da semana. */
export function MapaLeitura({ celulas, max, rotulo }: { celulas: number[][]; max: number; rotulo: string }) {
  const escala = ["#f0fdfa", "#ccfbf1", "#99f6e4", "#5eead4", "#2dd4bf", "#0d9488", "#0f766e"];
  const cor = (n: number) => (n === 0 || max === 0 ? "#f4f4f5" : escala[Math.min(escala.length - 1, Math.ceil((n / max) * (escala.length - 1)))]);
  return (
    <svg viewBox="0 0 220 110" width="100%" height="110" role="img" aria-label={rotulo}>
      <g fontSize="9" fill="#71717a">
        {FAIXAS.map((f, i) => <text key={f.rotulo} x="2" y={20 + i * 18}>{f.rotulo}</text>)}
        {SEMANA_CURTA.map((d, i) => <text key={i} x={48 + i * 26} y="106" textAnchor="middle">{d}</text>)}
      </g>
      {celulas.map((linha, f) => linha.map((n, d) => <rect key={`${f}-${d}`} x={38 + d * 26} y={10 + f * 18} width="20" height="14" rx="3" fill={cor(n)}><title>{`${SEMANA_LONGA[d]}, ${FAIXAS[f].rotulo}: ${n}`}</title></rect>))}
    </svg>
  );
}

/** Barras por dia (WhatsApp + SMS empilhados) com a linha do custo acumulado no eixo da direita. */
export function PorDia({ dias, hoje, brl }: { dias: Dia[]; hoje: string; brl: (c: number) => string }) {
  const W = 1200;
  const esq = 40;
  const dir = 1130;
  const topo = 20;
  const base = 170;
  const maxMsg = Math.max(4, ...dias.map((d) => d.whatsapp + d.sms));
  const maxCusto = Math.max(1, dias.at(-1)?.acumuladoCents ?? 0);
  const passo = (dir - esq) / Math.max(1, dias.length);
  const barra = Math.min(44, passo * 0.6);
  const yM = (v: number) => base - (v / maxMsg) * (base - topo);
  const yC = (v: number) => base - (v / maxCusto) * (base - topo);
  const cx = (i: number) => esq + passo * i + passo / 2;
  const linha = dias.map((d, i) => `${i ? "L" : "M"}${cx(i).toFixed(1)} ${yC(d.acumuladoCents).toFixed(1)}`).join(" ");
  const pico = dias.reduce((m, d) => (d.whatsapp + d.sms > m.whatsapp + m.sms ? d : m), dias[0]);
  const marcas = [0, 0.33, 0.66, 1];
  // rótulo de dia a cada N barras para não encavalar no mês de 31 dias
  const cada = dias.length > 16 ? 3 : 1;
  const semana = (dia: string) => ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][new Date(`${dia}T12:00:00Z`).getUTCDay()];
  return (
    <svg viewBox={`0 0 ${W} 222`} width="100%" height="222" role="img" aria-label={`Mensagens por dia, WhatsApp e SMS empilhados${pico ? `; pico de ${pico.whatsapp + pico.sms} no dia ${Number(pico.dia.slice(8))}` : ""}; custo acumulado chega a ${brl(maxCusto === 1 && !dias.at(-1)?.acumuladoCents ? 0 : maxCusto)}`}>
      <g stroke="#f0f0f1" strokeWidth="1">{marcas.map((m) => <line key={m} x1={esq} y1={base - m * (base - topo)} x2={dir} y2={base - m * (base - topo)} />)}</g>
      <g fontSize="11" fill="#a1a1aa">
        {marcas.map((m) => <text key={`m${m}`} x={esq - 10} y={base - m * (base - topo) + 4} textAnchor="end">{Math.round(m * maxMsg)}</text>)}
        {marcas.map((m) => <text key={`c${m}`} x={dir + 10} y={base - m * (base - topo) + 4}>{brl(Math.round(m * maxCusto))}</text>)}
      </g>
      {dias.map((d, i) => {
        const x = cx(i) - barra / 2;
        const tz = d.whatsapp;
        const ts = d.sms;
        return (
          <g key={d.dia}>
            {ts > 0 && <rect x={x} y={yM(ts)} width={barra} height={base - yM(ts)} fill={COR.sms} />}
            {tz > 0 && <rect x={x} y={yM(tz + ts)} width={barra} height={yM(ts) - yM(tz + ts)} rx="4" fill={COR.whatsapp} />}
            {tz + ts > 0 && <text x={cx(i)} y={yM(tz + ts) - 6} textAnchor="middle" fontSize="11" fontWeight="600" fill="currentColor">{tz + ts}</text>}
            {(i % cada === 0 || d.dia === hoje) && (
              <text x={cx(i)} y="194" textAnchor="middle" fontSize="12" fill={d.dia === hoje ? COR.whatsapp : "#71717a"} fontWeight={d.dia === hoje ? 600 : 400}>
                {d.dia === hoje ? "hoje" : `${semana(d.dia)} ${Number(d.dia.slice(8))}`}
              </text>
            )}
            <title>{`${Number(d.dia.slice(8))}/${d.dia.slice(5, 7)}: ${tz} WhatsApp, ${ts} SMS, ${brl(d.custoCents)}`}</title>
          </g>
        );
      })}
      {(dias.at(-1)?.acumuladoCents ?? 0) > 0 && (
        <>
          <path d={linha} fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="5 4" strokeLinejoin="round" />
          <circle cx={cx(dias.length - 1)} cy={yC(dias.at(-1)!.acumuladoCents)} r="4" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

/** Linha do tempo de uma mensagem: aceita → entregue → lida. */
export function LinhaDoTempo({ status, canal }: { status: string; canal: "whatsapp" | "sms" }) {
  const pontos = [6, 44, 82];
  const cor = status === "falhou" || status === "sem-saldo" ? "#dc2626" : status === "parado" ? "#f59e0b" : canal === "sms" ? COR.sms : status === "lido" ? COR.whatsapp : "#5eb5a8";
  const ate = status === "lido" ? 2 : status === "entregue" ? 1 : 0;
  const rotulo =
    status === "lido" ? "Aceita, entregue e lida" : status === "entregue" ? "Aceita e entregue; ainda não lida" : status === "falhou" ? "Falhou" : status === "sem-saldo" ? "Não saiu: sem saldo" : status === "parado" ? "Parada na cota" : canal === "sms" ? "Enviado; o SMS não informa entrega" : "Aceita; esperando a entrega";
  return (
    <svg width="88" height="16" role="img" aria-label={rotulo} className="shrink-0">
      <line x1="6" y1="8" x2="82" y2="8" stroke="#e4e4e7" strokeWidth="2" strokeDasharray="3 3" />
      {ate > 0 && <line x1="6" y1="8" x2={pontos[ate]} y2="8" stroke={cor} strokeWidth="2" />}
      {pontos.map((x, i) =>
        i <= ate ? <circle key={i} cx={x} cy="8" r={i === ate ? 5 : 4} fill={cor} /> : <circle key={i} cx={x} cy="8" r="4" fill="#fff" stroke="#d4d4d8" strokeWidth="2" />,
      )}
    </svg>
  );
}
