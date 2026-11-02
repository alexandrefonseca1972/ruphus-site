import "server-only";
import { textoSms } from "@/lib/comtele";

// Envio de SMS pela Comtele (painel antigo): POST /api/v2/send com a chave no cabeçalho `auth-key`.
// Sem COMTELE_API_KEY no ambiente, nada sai (e nada quebra): o SMS fica desligado na plataforma.
const ENVIO = "https://sms.comtele.com.br/api/v2/send";

export const smsDisponivel = () => !!process.env.COMTELE_API_KEY;

export class ErroSms extends Error {}

/** Envia um SMS para um celular já no formato da Comtele (numeroSms). Devolve o id do envio
 *  (requestUniqueId, para conferir no relatório da Comtele), "" sem id, ou null sem chave. */
export async function enviarSms(numero: string, texto: string, { fetch: buscar = fetch } = {}): Promise<string | null> {
  const chave = process.env.COMTELE_API_KEY;
  if (!chave) return null;
  const res = await buscar(ENVIO, {
    method: "POST",
    headers: { "auth-key": chave, "content-type": "application/json" },
    // Sender é só um rótulo nos relatórios da Comtele: não chega ao cliente
    body: JSON.stringify({ Sender: "ruphus", Receivers: numero, Content: textoSms(texto) }),
    signal: AbortSignal.timeout(10_000),
  });
  const corpo = (await res.json().catch(() => null)) as { Success?: boolean; Message?: string; Object?: { requestUniqueId?: string } | null } | null;
  if (!res.ok || !corpo?.Success) throw new ErroSms(`Comtele ${res.status}: ${corpo?.Message ?? "sem resposta"}`);
  return corpo.Object?.requestUniqueId ?? "";
}
