import "server-only";
import { ErroPrevisto } from "@/lib/erro-previsto";

// Cliente do gateway WhatsApp próprio (wtsfy). Só roda no servidor: a chave mora
// em variável de ambiente e nenhum segredo vai ao navegador. Autenticação pelo
// header x-api-key; erros viram mensagem clara para a tela (ErroPrevisto).

const BASE = () => (process.env.WTSFY_BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const KEY = () => process.env.WTSFY_API_KEY ?? "";
// o primeiro envio para um número novo estabelece a sessão de criptografia do
// WhatsApp e leva 8–15s; 35s cobre o pior caso sem deixar a tela travada num
// fetch sem fim (e sem abortar um envio que o gateway já está concluindo)
const TIMEOUT_MS = 35_000;

export type StatusInstancia = "connected" | "disconnected" | "qr" | "created";

export type Instancia = {
  id: string;
  name: string;
  phone: string | null;
  status: StatusInstancia;
  paused: boolean;
  uptime_seconds: number;
  reconnects: number;
};

/** QR pronto: PNG em base64, ou o estado da conexão enquanto o QR não sai. */
export type QrWhatsApp = { status: "qr"; base64: string } | { status: "connecting" } | { status: "connected"; phone: string };

export type EnvioTexto = { messageId: string; status: string };

async function chamar<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  if (!KEY()) {
    throw new ErroPrevisto("O gateway WhatsApp não está configurado neste ambiente (falta a variável WTSFY_API_KEY).");
  }
  const url = `${BASE()}${caminho}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: metodo,
      headers: { "x-api-key": KEY(), ...(corpo !== undefined ? { "content-type": "application/json" } : {}) },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new ErroPrevisto(`O gateway WhatsApp (${url}) demorou mais de ${Math.round(TIMEOUT_MS / 1000)}s para responder. Tente de novo.`);
    }
    throw new ErroPrevisto(`O gateway WhatsApp (${BASE()}) não respondeu. Verifique se o wtsfy está no ar.`);
  }
  if (!res.ok) {
    const detalhe = await res.text().catch(() => "");
    throw new ErroPrevisto(`O gateway WhatsApp respondeu ${res.status}${detalhe ? `: ${detalhe.slice(0, 160)}` : ""}.`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** Cria a instância do número no gateway. A conexão de verdade acontece na leitura do QR. */
export function createInstance(name: string) {
  return chamar<{ id: string; status: string }>("POST", "/instances", { name });
}

export function getStatus(instanceId: string) {
  return chamar<Instancia>("GET", `/instances/${instanceId}`);
}

export function getQr(instanceId: string) {
  return chamar<QrWhatsApp>("GET", `/instances/${instanceId}/qr`);
}

/** Texto simples para um cliente: phone só dígitos, DDI+DDD+número (ex.: 5511998887777).
 *  prioridade transacional (padrão do fluxo de agendamento) sai na hora: furam o
 *  pacing e a janela de horário do gateway; campanha respeita ambos. */
export function sendText(
  instanceId: string,
  phone: string,
  message: string,
  prioridade: "transacional" | "campanha" = "transacional",
) {
  return chamar<EnvioTexto>("POST", `/instances/${instanceId}/send/text`, { phone, message, prioridade });
}

export function checkInstance(instanceId: string) {
  return chamar<{ dbStatus: string; alive: boolean; action: string }>("POST", `/instances/${instanceId}/check`);
}

/** Desliga o número (despareia a sessão); a instância continua no gateway. */
export function logout(instanceId: string) {
  return chamar<{ ok: boolean }>("POST", `/instances/${instanceId}/logout`);
}
