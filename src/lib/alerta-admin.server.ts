import "server-only";
import { FieldValue, type Firestore, type Timestamp } from "firebase-admin/firestore";
import { enviarEmail, type EmailSaida } from "@/lib/email.server";
import { integracao } from "@/lib/integracoes.server";
import { SITE_BASE } from "@/lib/dominio";
import { montarEmail, type Bloco } from "@/lib/email-layout";

// Falha que o cliente final não deve ver (SMS que não saiu, por exemplo) vira e-mail para o admin
// da Ruphus. No máximo um e-mail por assunto a cada 6 h: sem crédito na Comtele, todo SMS falha e a
// caixa lotaria. O que repetiu no intervalo é contado em config/alertas e entra no próximo e-mail.
// Nunca lança: quem chama está no meio de um fluxo do cliente e não pode quebrar por causa do aviso.

const JANELA_MS = 6 * 3_600_000;

type Opcoes = { enviar?: (e: EmailSaida) => Promise<unknown>; agora?: number };

/** O corpo do aviso: o que aconteceu (resumo), os blocos (dados, o que fazer, o erro técnico) e o
 *  botão (padrão: o /admin). Texto solto também vale: vira parágrafos. */
export type Aviso = { resumo: string; blocos?: Bloco[]; acao?: { texto: string; url: string } };

const avisoDe = (conteudo: string | Aviso): Aviso => {
  if (typeof conteudo !== "string") return conteudo;
  const [resumo, ...resto] = conteudo.split(/\n\n+/);
  return { resumo, blocos: resto.map((p) => ({ p })) };
};

/** Avisa o admin por e-mail. Devolve true se o e-mail saiu, false se ficou para a próxima janela
 *  (ou não havia para quem mandar). */
export async function alertarAdmin(db: Firestore, chave: string, assunto: string, conteudo: string | Aviso, { enviar = enviarEmail, agora = Date.now() }: Opcoes = {}) {
  try {
    const ref = db.doc("config/alertas");
    const repetidos = await db.runTransaction(async (tx) => {
      const ultimo = (await tx.get(ref)).get(chave) as { em?: number; repetidos?: number } | undefined;
      if (typeof ultimo?.em === "number" && agora - ultimo.em < JANELA_MS) {
        tx.set(ref, { [chave]: { repetidos: FieldValue.increment(1) } }, { merge: true });
        return null;
      }
      tx.set(ref, { [chave]: { em: agora, repetidos: 0 } }, { merge: true });
      return ultimo?.repetidos ?? 0;
    });
    if (repetidos === null) return false;
    const para = (await integracao("ALERTA_EMAIL")) || (await integracao("GMAIL_USER"));
    if (!para) {
      console.error(`[alerta] sem e-mail para avisar: ${assunto}`);
      return false;
    }
    const a = avisoDe(conteudo);
    const repeticao: Bloco[] = repetidos ? [{ p: `Desde o último aviso, a mesma falha aconteceu mais ${repetidos} ${repetidos === 1 ? "vez" : "vezes"}.` }] : [];
    const email = montarEmail({
      assunto: `[Ruphus] ${assunto}`,
      faixa: "Aviso do sistema",
      tom: "alerta",
      titulo: assunto,
      subtitulo: a.resumo,
      previa: a.resumo,
      blocos: [...(a.blocos ?? []), ...repeticao],
      acao: a.acao ?? { texto: "Abrir o admin", url: `${SITE_BASE}/admin` },
      motivo: "Você recebe este aviso por ser o e-mail de alertas da Ruphus (/admin › Ajustes). Avisos do mesmo tipo vêm no máximo a cada 6 h.",
    });
    await enviar({ para, assunto: email.assunto, texto: email.texto, html: email.html });
    return true;
  } catch (e) {
    console.error(`[alerta] não avisei o admin: ${assunto}`, e);
    return false;
  }
}

/** O cron da VPS (deploy/crontab.txt) chama /api/cron/lembretes a cada 10 min, e a rota marca
 *  config/cron. Marca com mais de 30 min quer dizer que o cron parou (crontab apagado, CRON_SECRET
 *  trocado) e os lembretes pararam calados. Sem marca (antes do primeiro cron), não avisa. */
export async function vigiarCron(db: Firestore, { enviar = enviarEmail, agora = Date.now() }: Opcoes = {}) {
  const ultima = (await db.doc("config/cron").get()).get("ultimaExecucao") as Timestamp | undefined;
  if (!ultima || agora - ultima.toMillis() < 30 * 60_000) return false;
  const quando = ultima.toDate().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
  return alertarAdmin(db, "cron-parado", "O cron dos lembretes parou", {
    resumo: "As tarefas de cada 10 minutos pararam: lembretes por WhatsApp e SMS, sinais Pix vencidos e comandos do WhatsApp que ficaram pendentes.",
    blocos: [
      { dados: [["Última execução", `${quando} (horário de Brasília)`]] },
      { passos: ["Confira se o crontab do usuário ruphus ainda existe.", "Confira se o CRON_SECRET do crontab é o mesmo do .env.local do site.", "Veja os últimos registros do cron."], titulo: "O que fazer" },
      { tecnico: "crontab -u ruphus -l\njournalctl -t ruphus-cron -n 20", titulo: "Na VPS" },
    ],
  }, { enviar, agora });
}
