// O que todo layout de bio usa: os links (agenda, WhatsApp, mapa), o "aberto agora", as abas de
// horários sem JavaScript, a lista de serviços com "ver todos" e os ícones. Cada layout desenha
// por cima disso com o seu estilo. Nada aqui lê o banco: carregar.ts entrega os dados prontos.
import type { ReactNode } from "react";
import { situacaoExpediente } from "@/lib/bio";
import { precoDe, todayIn, weekday } from "@/lib/datetime";
import { telefoneDoNegocio, whatsappDoNegocio } from "@/lib/contato";
import type { Bio, Livres, Servico } from "./carregar";

export type PropsBio = { tenant: string; bio: Bio; livres: Livres | null };

// contraste: sobre cor escura o texto é claro, sobre clara é escuro
export function claro(hex: string) {
  const h = hex.replace("#", "");
  const n = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) || 0);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.6;
}

export const hhmm = (t: string) => t.replace(":00", "h").replace(":", "h");
export const duracao = (min: number) =>
  min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}min` : ""}` : `${min} min`;

/** Preço do serviço como a bio mostra; sem preço (saúde, "sob consulta") = null. */
export const precoServico = (sv: Servico) => (sv.preco ? precoDe({ priceCents: sv.preco, tipoPreco: sv.tipoPreco }) : null);

/* Abas dos dias sem JavaScript: rádios irmãos dos rótulos e das grades; o rádio marcado
   (n-ésimo) mostra a n-ésima grade. São no máximo três dias. */
export const abasCss = (escopo: string, marcado: string, foco: string, mostrar = "grid") =>
  [1, 2, 3]
    .map(
      (n) => `${escopo}>input:nth-of-type(${n}):checked~label:nth-of-type(${n}){${marcado}}
${escopo}>input:nth-of-type(${n}):focus-visible~label:nth-of-type(${n}){outline:2px solid ${foco};outline-offset:2px}
${escopo}>input:nth-of-type(${n}):checked~div:nth-of-type(${n}){display:${mostrar}}`,
    )
    .join("\n");

/** Tudo o que os layouts derivam dos dados: links, situação de hoje, atalhos e a barra. */
export function montar({ tenant, bio, livres }: PropsBio) {
  const local = [bio.cidade, bio.uf].filter(Boolean).join("/");
  const agendar = `${bio.site}agendar`;
  // Sem catálogo ou com a agenda desligada, o contato direto assume; telefone fixo vira ligação.
  const agenda = bio.servicos.length > 0 && bio.agendaOnline;
  const mapa = bio.endereco
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${bio.nome} ${bio.endereco}`)}`
    : null;
  const zap = whatsappDoNegocio(bio.telefone, `Olá! Vim pelo Instagram do ${bio.nome}.`);
  const { aberto, ate } = situacaoExpediente(bio.expediente, bio.fuso);
  const dias = [...bio.expediente].sort((a, b) => ((a.dia + 6) % 7) - ((b.dia + 6) % 7));
  // Caminho completo nos dois endereços: em www é o arquivo; no subdomínio o proxy o deixa
  // passar sem prefixar de novo. Sem ler o host, a página inteira pode ficar em cache.
  // A foto do banco compartilhado (/assets/…: sites gerados) mora em /s/assets,
  // não na pasta do negócio — prefixar o slug nela dava 404
  const fotoSrc = bio.foto && (bio.foto.startsWith("/assets/") ? `/s${bio.foto}` : `/s/${tenant}${bio.foto}`);
  // Cor clara demais some sobre o fundo creme (#faf3f1 no Amanda): o destaque vira tinta
  const acento = claro(bio.cor) ? "#17150F" : bio.cor;

  const hoje = weekday(todayIn(bio.fuso));
  const precos = bio.servicos.map((x) => x.preco).filter(Boolean);
  const jornadaHoje = bio.expediente.find((e) => e.dia === hoje);
  const ligar = telefoneDoNegocio(bio.telefone);
  const contato = zap ?? ligar;
  const atalhos = [
    zap && { href: zap, rotulo: "WhatsApp", tinta: "#2C6A53", icone: <IconeZap /> },
    ligar && { href: ligar, rotulo: "Ligar", tinta: "#17150F", icone: <IconeFone />, externo: false },
    mapa && { href: mapa, rotulo: "Como chegar", tinta: "#8A4520", icone: <IconeMapa /> },
    bio.instagram && { href: `https://instagram.com/${bio.instagram}`, rotulo: "Instagram", tinta: "#8A3A63", icone: <IconeInsta /> },
  ].filter(Boolean) as { href: string; rotulo: string; tinta: string; icone: ReactNode; externo?: boolean }[];

  // Tocar num serviço abre a agenda; sem ela, pergunta pelo canal que o negócio atende.
  const linkServico = (sv: Servico) =>
    agenda ? `${agendar}?servico=${encodeURIComponent(sv.id)}` : (whatsappDoNegocio(bio.telefone, `Olá! Quero saber do serviço ${sv.nome}.`) ?? ligar ?? agendar);
  const primeiro = livres?.dias[0];
  // a barra fixa: agenda, senão o canal de contato disponível (inclusive ligação para fixo)
  const barra = agenda || contato ? { href: agenda ? agendar : contato!, rotulo: agenda ? "Agendar" : zap ? "Falar no WhatsApp" : "Ligar para o negócio", livre: agenda && primeiro ? `livre ${primeiro.rotulo.toLowerCase()} ${hhmm(primeiro.horarios[0])}` : null } : null;
  return { local, agendar, agenda, mapa, zap, aberto, ate, dias, fotoSrc, acento, hoje, precos, jornadaHoje, ligar, contato, atalhos, linkServico, primeiro, barra };
}

/** "Seg a sex 9h–19h · Sáb 8h–13h": dias seguidos com o mesmo horário viram um intervalo. */
export function resumoSemana(expediente: Bio["expediente"]) {
  const CURTO = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];
  const ordem = [...expediente].sort((a, b) => ((a.dia + 6) % 7) - ((b.dia + 6) % 7));
  const grupos: { de: number; ate: number; h: string }[] = [];
  for (const e of ordem) {
    const h = [e.inicio, e.fim].map((x) => hhmm(x).replace(/^0/, "")).join("–");
    const g = grupos.at(-1);
    if (g && g.h === h && (g.ate + 1) % 7 === e.dia) g.ate = e.dia;
    else grupos.push({ de: e.dia, ate: e.dia, h });
  }
  const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
  return grupos.map((g) => `${cap(CURTO[g.de])}${g.de === g.ate ? "" : ` a ${CURTO[g.ate]}`} ${g.h}`).join(" · ");
}

/** Abas de dias com os horários livres; cada toque abre a agenda já no serviço, dia e hora.
 *  O layout dá as classes (`escopo` é a classe do contêiner, as outras derivam dela) e o CSS. */
export function Horarios({ livres, agendar, escopo, hora = hhmm, maximo = 8, rotulo = (d) => d.rotulo, coluna, children }: {
  livres: Livres;
  agendar: string;
  escopo: string;
  hora?: (h: string) => string;
  maximo?: number;
  rotulo?: (d: Livres["dias"][number]) => ReactNode;
  /** posição explícita na grade (Agenda: a tira da semana) */
  coluna?: (k: number) => number;
  children?: ReactNode;
}) {
  return (
    <div className={escopo}>
      {livres.dias.map((d, k) => (
        <input key={d.date} type="radio" name="dia" id={`dia-${k}`} defaultChecked={k === 0} className="sr-only" />
      ))}
      {livres.dias.map((d, k) => (
        <label key={d.date} htmlFor={`dia-${k}`} className={`${escopo}-dia`} style={coluna && { gridColumn: coluna(k), gridRow: 1 }}>
          {rotulo(d)}
        </label>
      ))}
      {children}
      {livres.dias.map((d, k) => (
        <div key={d.date} className={`${escopo}-hs`}>
          {d.horarios.slice(0, maximo).map((h, i) => (
            <a key={h} href={`${agendar}?servico=${encodeURIComponent(livres.servico.id)}&data=${d.date}&hora=${h}`} className={k === 0 && i === 0 ? `${escopo}-h ${escopo}-h1` : `${escopo}-h`}>
              {hora(h)}
            </a>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Os quatro primeiros serviços e o resto num <details> nativo ("ver os N"), sem JavaScript. */
export function ListaServicos({ servicos, item, mais }: { servicos: Servico[]; item: (sv: Servico, i: number) => ReactNode; mais: string }) {
  const VISIVEIS = 4;
  return (
    <>
      {servicos.slice(0, VISIVEIS).map(item)}
      {servicos.length > VISIVEIS && (
        <details>
          <summary className={mais}>Ver os {servicos.length} serviços</summary>
          {servicos.slice(VISIVEIS).map((sv, i) => item(sv, i + VISIVEIS))}
        </details>
      )}
    </>
  );
}

export const Seta = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m9 18 6-6-6-6" />
  </svg>
);

export const IconeZap = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
    <path d="M12 2a10 10 0 0 0-8.6 15L2 22l5.2-1.4A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3.1.8.8-3-.2-.3A8.2 8.2 0 1 1 12 20.2z" />
  </svg>
);
export const IconeInsta = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
    <circle cx="12" cy="12" r="4" />
    <circle cx="17.2" cy="6.8" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);
export const IconeMapa = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z" />
    <circle cx="12" cy="10" r="2.6" />
  </svg>
);
export const IconeFone = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />
  </svg>
);
export const Estrela = ({ tamanho = 13 }: { tamanho?: number }) => (
  <svg viewBox="0 0 24 24" width={tamanho} height={tamanho} fill="#E8A33D" aria-hidden="true">
    <path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.2 6.1L12 16.9 6.5 19.7l1.2-6.1L3.2 9.4l6.1-.8z" />
  </svg>
);
