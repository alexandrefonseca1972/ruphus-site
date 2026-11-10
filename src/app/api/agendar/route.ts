import { after, NextResponse } from "next/server";
import { avisar, quando } from "@/lib/avisos.server";
import { adminDb } from "@/lib/admin";
import { SemSaldo } from "@/lib/consumo.server";
import { book } from "@/lib/booking.server";
import { MAX_DAYS_AHEAD, dentroDaJanela, fusoDe, zonedTime } from "@/lib/datetime";
import { BookingInput } from "@/lib/scheduling";
import { codigoDoAgendamento, lerConfigWhatsApp, limparErroDeAgendamento, registrarErroNotificacao } from "@/lib/whatsapp.server";
import { conexaoOficial, contatoDoNegocio, templateCliente, templateNovoDono, usaCanalOficial } from "@/lib/canal-oficial.server";
import { motivoDaFalha } from "@/lib/mensagens-paradas.server";
import { soDigitosComDDI } from "@/lib/telefone";
import { optInDoDoc } from "@/lib/consentimento-whatsapp";
import { enviarTemplateSemOperador, motivoLegivel, OPTIN_DONO, saiuDepoisDoAceite, type ConexaoAtendys } from "@/lib/atendys";

// A reserva da página pública. Rota, não server action: o Next manda um server action
// por vez, e com a rede travada a nova tentativa (e a agenda) ficava na fila atrás da
// primeira. Aqui a tela aborta o pedido com 20 s e o seguinte sai na hora.
// Chamável por qualquer pessoa: toda entrada é validada aqui.

export async function POST(req: Request) {
  // só JSON: outro site não consegue postar aqui sem a checagem de CORS do navegador
  if (!req.headers.get("content-type")?.startsWith("application/json")) return new NextResponse(null, { status: 415 });
  const b = BookingInput.safeParse(await req.json().catch(() => null));
  if (!b.success) return NextResponse.json({ ok: false, error: b.error.issues[0].message, field: true });
  if (!dentroDaJanela(b.data.date)) {
    return NextResponse.json({ ok: false, error: `Agende com até ${MAX_DAYS_AHEAD} dias de antecedência.`, field: true });
  }
  // IP só para contar tentativas por dispositivo; guardado apenas como hash
  // x-real-ip vem do proxy; no x-forwarded-for o primeiro valor é escolhido por
  // quem chama, então vale o último, que foi acrescentado por quem está na frente
  const encaminhado = req.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim();
  const ip = req.headers.get("x-real-ip")?.trim() || encaminhado;
  // Aviso no celular de quem atende, depois da resposta: push lento não atrasa a reserva.
  // Só a reserva nova: a repetição (resposta perdida, segundo toque) já foi avisada.
  const r = await book(adminDb, b.data, ip, (nova) => {
    const { tenantId, customerName } = b.data;
    after(() =>
      avisar(adminDb, tenantId, {
        title: "Novo agendamento",
        body: `${customerName.trim()} · ${nova.serviceName} · ${quando(nova.date, nova.time)}${nova.staffName ? ` · com ${nova.staffName}` : ""}`,
        url: `/${tenantId}`,
        tag: `agendamento-${nova.id}`,
      }).catch((e) => console.error("aviso de agendamento", e)),
    );
    // A reserva nasce "booked" (aguardando confirmação): quem confirma é o dono, respondendo
    // CONFIRMADO (ou tocando no botão) no WhatsApp pessoal dele (ownerPhone), que recebe o aviso
    // pelo canal oficial (número da plataforma). O cliente recebe o recibo na hora e a confirmação
    // depois, pelo mesmo número. Fora do canal oficial nenhum WhatsApp sai: fica o push acima e o
    // painel. Falha de qualquer aviso fica gravada no negócio: a gaveta mostra, em vez de o dono
    // descobrir pelo silêncio.
    after(() =>
      (async () => {
        // a marca fora do try: erro ao ler o negócio não vira "canal oficial indisponível"
        if (!(await usaCanalOficial(adminDb, tenantId))) return;
        let oficial: ConexaoAtendys | null;
        try {
          oficial = await conexaoOficial(adminDb, tenantId);
        } catch (e) {
          // negócio do canal oficial sem a plataforma pronta: registra
          console.error("[whatsapp] canal oficial", e);
          await registrarErroNotificacao(adminDb, tenantId, { message: `Agendamento de ${customerName.trim()}: ninguém foi avisado (canal oficial do WhatsApp indisponível: ${motivoLegivel(e)}).`, at: Date.now() }).catch(() => {});
          return;
        }
        if (oficial) await avisarPeloCanalOficial(oficial, tenantId, nova, b.data);
      })(),
    );
  });
  return NextResponse.json(r);
}

/** Novo agendamento pelo canal oficial: o dono recebe o aviso (com o código para CONFIRMADO/
 *  RECUSAR) no WhatsApp pessoal e o cliente, o recibo — os dois por template. */
async function avisarPeloCanalOficial(
  oficial: ConexaoAtendys,
  tenantId: string,
  nova: { id: string; serviceName: string; date: string; time: string; staffName?: string | null },
  dados: { customerName: string; customerPhone: string; aceiteWhatsapp?: boolean },
) {
  try {
    await avisarPeloCanalOficialSemCaptura(oficial, tenantId, nova, dados);
  } catch (e) {
    console.error("[whatsapp] aviso pelo canal oficial", e);
    await registrarErroNotificacao(adminDb, tenantId, { message: `Agendamento de ${dados.customerName.trim()}: aviso pelo canal oficial falhou (${motivoLegivel(e)}).`, at: Date.now() }).catch(() => {});
  }
}

async function avisarPeloCanalOficialSemCaptura(
  oficial: ConexaoAtendys,
  tenantId: string,
  nova: { id: string; serviceName: string; date: string; time: string; staffName?: string | null },
  dados: { customerName: string; customerPhone: string; aceiteWhatsapp?: boolean },
) {
  const falhas: string[] = [];
  const tenant = await adminDb.doc(`tenants/${tenantId}`).get();
  // prazo: o horário no fuso do negócio (a agenda grava hora de parede)
  const prazo = zonedTime(nova.date, nova.time, fusoDe(tenant.get("site")));
  const negocio = String(tenant.get("name") ?? "").trim() || tenantId;
  const servico = nova.staffName ? `${nova.serviceName} com ${nova.staffName}` : nova.serviceName;
  const quandoVai = quando(nova.date, nova.time);
  const nome = dados.customerName.trim();
  const dono = (await lerConfigWhatsApp(adminDb, tenantId))?.ownerPhone;
  const donoNumero = dono ? soDigitosComDDI(dono) : null;
  if (!donoNumero) {
    falhas.push("aviso ao salão não saiu: cadastre o WhatsApp pessoal do dono na gaveta do WhatsApp");
  } else {
    try {
      const codigo = codigoDoAgendamento(nova.id);
      const ruim = naoSaiu(await enviarTemplateSemOperador(oficial, donoNumero, templateNovoDono({ negocio, cliente: nome, telefone: dados.customerPhone, servico, quando: quandoVai, codigo }, { slug: tenantId, agendamento: nova.id, horario: `${nova.date}T${nova.time}` }), OPTIN_DONO, prazo));
      if (ruim) falhas.push(`aviso ao salão ${ruim}`);
    } catch (e) {
      falhas.push(`aviso ao salão não chegou: ${motivoLegivel(e)}`);
      console.error("aviso de agendamento pelo canal oficial", e);
    }
  }
  const cliente = soDigitosComDDI(dados.customerPhone);
  if (dados.aceiteWhatsapp && cliente) {
    try {
      const optIn = optInDoDoc(tenantId, await adminDb.doc(`tenants/${tenantId}/appointments/${nova.id}`).get());
      if (!optIn) throw new Error("aceite do WhatsApp não gravado no agendamento");
      const primeiro = nome.split(/\s+/)[0] ?? nome;
      const ruim = naoSaiu(await enviarTemplateSemOperador(oficial, cliente, templateCliente("recebido", { nome: primeiro, negocio, servico, quando: quandoVai, contato: contatoDoNegocio(tenant) }), optIn, prazo));
      if (ruim) falhas.push(`recibo ao cliente ${ruim}`);
    } catch (e) {
      falhas.push(`recibo ao cliente não chegou: ${motivoLegivel(e)}`);
      if (!saiuDepoisDoAceite(e) && !(e instanceof SemSaldo)) console.error("recibo de agendamento pelo canal oficial", e);
    }
  }
  // aviso bem-sucedido limpa só a falha de aviso de agendamento
  await (falhas.length
    ? registrarErroNotificacao(adminDb, tenantId, { message: `Agendamento de ${nome} — ${falhas.join("; ")}.`, at: Date.now() })
    : limparErroDeAgendamento(adminDb, tenantId)
  ).catch(() => {});
}

/** Aceito, mas não vai sair (parado na cota ou adiado para depois do horário): falha visível
 *  na gaveta, como na confirmação. null = enviado ou agendado a tempo. */
function naoSaiu(e: { destino: string; errorCode?: string }) {
  if (e.destino === "parada") return "parou na cota diária do WhatsApp: decida em Mensagens no painel";
  if (e.destino === "nao_sai") return "não sai antes do horário do agendamento (fora do horário de envio do WhatsApp)";
  if (e.destino === "falhou") return `não foi entregue: ${motivoDaFalha(e.errorCode)}`; // o mesmo motivo que avisarFalhaDeEnvio gravou
  return null;
}
