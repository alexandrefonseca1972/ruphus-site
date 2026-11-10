# Plano de correção: WhatsApp, avisos ao dono e cron

Repositório: `/Users/alexandrefonseca/products/ruphus-site` (base: `origin/main` em 6b966a11).
Gateway atendys (`/Users/alexandrefonseca/AI/projects/atendys/apps/api/src`): só consulta. Não mexa nele.
Escrito em 10/11/2026. Todo item foi conferido no código antes de entrar aqui.

## Antes de começar (vale para todos os PRs)

1. `cd /Users/alexandrefonseca/products/ruphus-site && git fetch origin && git status --short --branch`.
   Os arquivos `.claude/` e `docs/revisao-final-2026-11-10.md` estão fora do git: não os inclua em nenhum commit.
2. Cada PR sai de uma branch nova a partir de `origin/main` atualizado (comando na seção "Ordem e agrupamento").
3. Aplique as trocas abaixo com substituição exata de texto. Se o "Trecho atual" não for encontrado igual,
   PARE e avise: não adapte por conta própria.
4. Nenhuma API do Next muda aqui (`after`, rotas e server actions continuam como estão).
5. Antes de abrir cada PR, rode: `npm run typecheck`, `npm run lint` e o teste indicado no PR.
   `npm run test:atendys` sobe o emulador do Firebase (precisa do `firebase-tools` e do Java já instalados).

## Resumo dos achados

| id | existe? | PR |
|----|---------|----|
| A1 | sim (só no número do salão; o canal oficial já manda ao pessoal do dono) | PR 1 |
| A2 | sim | PR 1 |
| A7 | sim | PR 2 |
| A8 | sim (padrão 3/dia, 10/semana; `PATCH /admin/tenants/:id` aceita os dois campos) | PR 1 + pedido ao atendys |
| M1 | sim (header `idempotency-key`, 1 a 80 caracteres) | PR 2 |
| M2 | sim | PR 3 |
| M3 | sim | PR 1 |
| M4 | sim, mas a equipe usa essa ação na agenda: DECISÃO DO USUÁRIO | PR 3 |
| B1 | sim | PR 2 |
| B2 | sim | PR 2 |
| B3 | sim | PR 1 |
| B4 | sim (nenhuma tela importa as duas ações) | PR 3 |
| B5 | sim (o texto do Pix sai sem o aviso de SAIR): DECISÃO DO USUÁRIO sobre a posição | PR 3 |
| B6 | sim (os três 409 do opt-in vêm como `VALIDATION_ERROR`) | só o pedido ao atendys |

---

## ALTOS

### A8 — Limite por destinatário: subir na criação e nos tenants que já existem

Arquivo(s): `src/lib/atendys.ts:254` (criação do tenant), `scripts/limites-whatsapp.mts` (novo), `package.json`

Por quê: o atendys cria o tenant com `recipientMsgPerDay: 3` e `recipientMsgPerWeek: 10`
(`tenants/tenants.controller.ts:73-74` do atendys). Com A1, o dono recebe um aviso por agendamento no
WhatsApp pessoal, e a partir do 4º agendamento do dia o aviso para na cota. O cliente também recebe recibo,
confirmação e lembrete no mesmo dia (3).

Contrato confirmado no atendys:
- `POST /admin/tenants` (`CreateTenantDto`, `dto/index.ts:311-312`): `recipientMsgPerDay` (1 a 100) e `recipientMsgPerWeek` (1 a 500).
- `PATCH /admin/tenants/:id` (`UpdateTenantDto`, `dto/index.ts:371-372`): os mesmos dois campos. O `ruphus-site` já usa esse PATCH em `apontarWebhook`.
- `GET /admin/tenants` devolve `recipientMsgPerDay` e `recipientMsgPerWeek` de cada tenant (`mapTenant`, `tenants.controller.ts:644-645`).
- Respostas (`replyToInbound`) não contam no limite por destinatário (`messages.service.ts:165`: `phone: opts.replyToInbound ? undefined : e164`).
- Não há isenção de número no atendys hoje (grep sem resultado). Veja o pedido no fim desta seção.

DECISÃO DO USUÁRIO: valores do limite por destinatário.
- (a) 30 por dia e 150 por semana. Recomendado: cobre um salão movimentado e ainda segura spam a cliente.
- (b) 50 por dia e 300 por semana.
- (c) 100 por dia e 500 por semana (o máximo do atendys).
O plano abaixo usa (a). Se a escolha for outra, troque só os dois números da constante `LIMITES_DESTINATARIO`.

#### Parte (a): criação com os limites

Trecho atual (`src/lib/atendys.ts`, linhas 253-258):
```ts
  } else {
    const criado = await chamarAdmin<{ tenant: { id: string }; apikey: string }>("POST", "/admin/tenants", {
      name: nomeNegocio,
      slug,
      webhookUrl: WEBHOOK_URL(),
    });
```
Trecho novo:
```ts
  } else {
    const criado = await chamarAdmin<{ tenant: { id: string }; apikey: string }>("POST", "/admin/tenants", {
      name: nomeNegocio,
      slug,
      webhookUrl: WEBHOOK_URL(),
      ...LIMITES_DESTINATARIO,
    });
```

Trecho atual (`src/lib/atendys.ts`, linhas 290-293):
```ts
/** Aponta os webhooks do tenant para o ruphus.site (o tenant da plataforma nasceu sem URL). */
export function apontarWebhook(tenantId: string) {
  return chamarAdmin("PATCH", `/admin/tenants/${encodeURIComponent(tenantId)}`, { webhookUrl: WEBHOOK_URL() });
}
```
Trecho novo:
```ts
/** Aponta os webhooks do tenant para o ruphus.site (o tenant da plataforma nasceu sem URL). */
export function apontarWebhook(tenantId: string) {
  return chamarAdmin("PATCH", `/admin/tenants/${encodeURIComponent(tenantId)}`, { webhookUrl: WEBHOOK_URL() });
}

/** Limite por destinatário no atendys (o padrão dele é 3 por dia e 10 por semana). O dono recebe um
 *  aviso por agendamento no WhatsApp pessoal, e o cliente recibo, confirmação e lembrete no mesmo dia:
 *  com 3 por dia, o 4º agendamento do dia parava na cota. Máximo do atendys: 100 por dia, 500 por semana. */
export const LIMITES_DESTINATARIO = { recipientMsgPerDay: 30, recipientMsgPerWeek: 150 } as const;

/** Tenants que já existiam: o mesmo limite por PATCH (scripts/limites-whatsapp.mts). */
export function ajustarLimitesDoTenant(tenantId: string) {
  return chamarAdmin("PATCH", `/admin/tenants/${encodeURIComponent(tenantId)}`, LIMITES_DESTINATARIO);
}

/** Todos os tenants ativos do atendys, com os limites atuais (só leitura). */
export function listarTenantsAtendys() {
  return chamarAdmin<Array<{ id: string; slug: string; recipientMsgPerDay?: number; recipientMsgPerWeek?: number }>>("GET", "/admin/tenants");
}
```
Observação: `LIMITES_DESTINATARIO` é usado na linha 257, antes da declaração na linha ~297. Isso funciona porque o uso fica dentro de uma função chamada depois do carregamento do módulo. Não mova nada.

#### Parte (b): script para os tenants que já existem em produção

Crie o arquivo `scripts/limites-whatsapp.mts` com este conteúdo completo:
```ts
// Uma vez, depois do deploy: sobe o limite por destinatário dos tenants do atendys criados antes
// (ficaram com o padrão de 3 por dia e 10 por semana). Só os deste site: cada negócio (o slug do
// tenant é o id em tenants/{slug}) e o tenant da plataforma (canal oficial).
//
//   npm run limites:whatsapp              # só lista
//   npm run limites:whatsapp -- --aplicar
import { adminDb } from "@/lib/admin";
import { ajustarLimitesDoTenant, LIMITES_DESTINATARIO, listarTenantsAtendys } from "@/lib/atendys";

const aplicar = process.argv.includes("--aplicar");
const { recipientMsgPerDay: dia, recipientMsgPerWeek: semana } = LIMITES_DESTINATARIO;
let ajustados = 0;
for (const t of await listarTenantsAtendys()) {
  const nosso = t.slug === "ruphus-plataforma" || (await adminDb.doc(`tenants/${t.slug}`).get()).exists;
  if (!nosso || (t.recipientMsgPerDay === dia && t.recipientMsgPerWeek === semana)) continue;
  console.log(`${t.slug}: ${t.recipientMsgPerDay ?? "?"}/dia, ${t.recipientMsgPerWeek ?? "?"}/semana`);
  ajustados++;
  if (aplicar) await ajustarLimitesDoTenant(t.id).catch((e) => console.error(`  ${t.slug} falhou: ${e instanceof Error ? e.message : e}`));
}
console.log(`${aplicar ? "ajustados" : "ajustaria"}: ${ajustados} tenant(s) para ${dia}/dia e ${semana}/semana`);
process.exit(0);
```

Em `package.json`, logo depois da linha:
```json
    "mover:segredos-whatsapp": "tsx --conditions=react-server --env-file=.env.local scripts/mover-segredos-whatsapp.mts",
```
acrescente a linha:
```json
    "limites:whatsapp": "tsx --conditions=react-server --env-file=.env.local scripts/limites-whatsapp.mts",
```

Execução em produção (só depois do deploy do PR 1, e só com o OK do usuário, porque muda o atendys de produção):
```sh
ssh root@<VPS> 'cd /opt/ruphus-site/app && sudo -u ruphus npm run limites:whatsapp'
ssh root@<VPS> 'cd /opt/ruphus-site/app && sudo -u ruphus npm run limites:whatsapp -- --aplicar'
```
Rode na VPS: o atendys responde em `127.0.0.1:3002` só lá. A primeira linha só lista; confira a lista antes da segunda.

#### Parte (c): isenção do número do dono — pedir ao atendys

O atendys não tem isenção por número. Contrato a pedir:
- `PATCH /admin/tenants/:id` aceita `exemptRecipients: string[]` (E.164, até 5 números).
- Envio para um número dessa lista não consome nem confere as chaves `rl:r:{tenant}:{phone}:d|w` em
  `ratelimit.service.ts:243-246`. Os limites da instância e do tenant continuam valendo.
- `GET /admin/tenants` devolve o campo.
Quando o atendys entregar: o `ruphus-site` grava o `ownerPhone` também nesse campo em `gravarOwnerPhone`
(`src/lib/whatsapp.server.ts:220`). Nada disso entra agora.

Outros pontos a tocar: nenhum.

Teste: `atendys.test.mts`. No primeiro bloco de `garantirTenant` (tenant novo, por volta da linha 72-78), logo depois da linha
```ts
assert.equal(chamadas[0].headers["x-admin-key"], "chave-admin");
```
acrescente:
```ts
assert.deepEqual(
  { dia: (chamadas[1].corpo as { recipientMsgPerDay?: number }).recipientMsgPerDay, semana: (chamadas[1].corpo as { recipientMsgPerWeek?: number }).recipientMsgPerWeek },
  { dia: 30, semana: 150 },
  "tenant novo nasce com o limite por destinatário da Ruphus, não com o padrão 3/10",
);
```
(se a DECISÃO trocar os valores, troque 30 e 150 aqui também). Comando: `npm run test:atendys`.

Critério de pronto: o POST de criação leva os dois campos; `npm run limites:whatsapp` (sem `--aplicar`) lista os tenants sem alterar nada; o teste passa.

---

### A1 — Aviso de novo agendamento vai ao WhatsApp pessoal do dono

Arquivo(s): `src/app/api/agendar/route.ts:102`, `src/lib/whatsapp.server.ts` (função nova)

Por quê: o aviso vai ao self-chat do salão (`conn.phone ?? conn.ownerPhone`) e pede "Responda CONFIRMADO".
O que o dono escreve no self-chat chega ao atendys como eco `fromMe` (`webhooks.controller.ts:273`,
`persistOutboundEcho`) e nunca vira `message.received`: a confirmação pelo self-chat nunca funciona.

Conferido:
- `grep "conn.phone ??"` acha só esta linha. Lembretes vão ao cliente. As respostas do comando são A2.
- Canal oficial (`avisarPeloCanalOficialSemCaptura`, linha 192 do mesmo arquivo) já manda ao `ownerPhone` e
  só a ele. Não muda.
- O `ownerPhone` hoje só é cadastrado pela plataforma (`/admin`, gaveta do WhatsApp). O dono não tem esse campo no painel dele.

Na mesma PR deve ir A8: sem ela, o 4º aviso do dia para na cota.

Trecho atual (`src/lib/whatsapp.server.ts`, linhas 219-220):
```ts
/** O número pessoal do dono: recebe os avisos e confirma respondendo. Vazio desliga. */
export async function gravarOwnerPhone(db: Firestore, slug: string, ownerPhone: string | null) {
```
Trecho novo:
```ts
/** Para onde vai o aviso de novo agendamento pelo número do salão. O WhatsApp pessoal do dono vem
 *  primeiro: é dele que CONFIRMADO/RECUSAR volta como mensagem recebida. O self-chat do salão é só
 *  aviso: o que o dono escreve no próprio número chega ao atendys como eco (fromMe) e não vira
 *  comando, então ali o texto não pede resposta. null: não há para onde mandar. */
export function destinoDoAvisoAoDono(conn: Pick<ConexaoWhatsapp, "phone" | "ownerPhone">): { para: string; podeResponder: boolean } | null {
  if (conn.ownerPhone) return { para: conn.ownerPhone, podeResponder: true };
  if (conn.phone) return { para: conn.phone, podeResponder: false };
  return null;
}

/** O número pessoal do dono: recebe os avisos e confirma respondendo. Vazio desliga. */
export async function gravarOwnerPhone(db: Firestore, slug: string, ownerPhone: string | null) {
```

Trecho atual (`src/app/api/agendar/route.ts`, linha 7):
```ts
import { codigoDoAgendamento, espelharStatusVivo, lerConexao, lerConfigWhatsApp, registrarErroNotificacao } from "@/lib/whatsapp.server";
```
Trecho novo:
```ts
import { codigoDoAgendamento, destinoDoAvisoAoDono, espelharStatusVivo, lerConexao, lerConfigWhatsApp, registrarErroNotificacao } from "@/lib/whatsapp.server";
```
(Se B1 já entrou antes, a linha terá também `limparErroDeAgendamento`: mantenha e só acrescente `destinoDoAvisoAoDono` em ordem alfabética.)

Trecho atual (`src/app/api/agendar/route.ts`, linhas 44-49):
```ts
    // A reserva nasce "booked" (aguardando confirmação): quem confirma é o dono,
    // respondendo CONFIRMADO no self-chat do próprio número do salão — toda a
    // comunicação rola pelo número do negócio, nada pelo WhatsApp pessoal dele.
    // O cliente recebe recibo na hora ("o salão vai confirmar") e a confirmação
    // depois, também pelo número do salão. Falha de qualquer aviso fica gravada
    // no negócio: a gaveta mostra, em vez de o dono descobrir pelo silêncio.
```
Trecho novo:
```ts
    // A reserva nasce "booked" (aguardando confirmação): quem confirma é o dono,
    // respondendo CONFIRMADO no WhatsApp pessoal dele (ownerPhone), que recebe o aviso
    // pelo número do salão. Sem o pessoal cadastrado, o aviso vai ao self-chat do salão
    // e o dono decide pelo painel (o que ele escreve no self-chat não chega como mensagem).
    // O cliente recebe recibo na hora ("o salão vai confirmar") e a confirmação
    // depois, pelo número do salão. Falha de qualquer aviso fica gravada
    // no negócio: a gaveta mostra, em vez de o dono descobrir pelo silêncio.
```

Trecho atual (`src/app/api/agendar/route.ts`, linhas 99-119):
```ts
        const falhas: string[] = [];
        // aviso vai pro self-chat do salão (conn.phone): o dono opera tudo no
        // próprio número do negócio, nenhuma comunicação depende do pessoal dele
        const avisoPara = conn.phone ?? conn.ownerPhone;
        if (avisoPara) {
          try {
            const ruim = naoSaiu(await enviarSemOperador(
              conn,
              avisoPara,
              `Novo agendamento (código ${codigoDoAgendamento(nova.id)}): ${customerName.trim()} · ${partes.join(" · ")} · tel ${b.data.customerPhone}. Responda CONFIRMADO ${codigoDoAgendamento(nova.id)} para confirmar ou RECUSAR ${codigoDoAgendamento(nova.id)} para recusar.`,
              OPTIN_DONO,
              prazo,
            ));
            if (ruim) falhas.push(`aviso ao salão ${ruim}`);
          } catch (e) {
            falhas.push(`aviso ao salão não chegou: ${motivoLegivel(e)}`);
            console.error("aviso de agendamento via WhatsApp", e);
          }
        } else {
          console.warn(`[whatsapp] ${tenantId}: número do salão sem telefone pareado; aviso de novo agendamento não enviado`);
        }
```
Trecho novo:
```ts
        const falhas: string[] = [];
        // aviso ao dono: no WhatsApp pessoal (ownerPhone), de onde CONFIRMADO/RECUSAR volta como
        // mensagem recebida. Sem ele, vai ao self-chat do salão, só como aviso: o que o dono escreve
        // no próprio número chega ao atendys como eco (fromMe) e nunca vira comando
        const destino = destinoDoAvisoAoDono(conn);
        if (destino) {
          const codigo = codigoDoAgendamento(nova.id);
          const painel = `${(process.env.SITE_URL ?? "https://www.ruphus.site").replace(/\/+$/, "")}/${tenantId}`;
          const pedido = destino.podeResponder
            ? `Responda CONFIRMADO ${codigo} para confirmar ou RECUSAR ${codigo} para recusar.`
            : `Confirme ou recuse no painel: ${painel}`;
          try {
            const ruim = naoSaiu(await enviarSemOperador(
              conn,
              destino.para,
              `Novo agendamento (código ${codigo}): ${customerName.trim()} · ${partes.join(" · ")} · tel ${b.data.customerPhone}. ${pedido}`,
              OPTIN_DONO,
              prazo,
            ));
            if (ruim) falhas.push(`aviso ao salão ${ruim}`);
          } catch (e) {
            falhas.push(`aviso ao salão não chegou: ${motivoLegivel(e)}`);
            console.error("aviso de agendamento via WhatsApp", e);
          }
        } else {
          console.warn(`[whatsapp] ${tenantId}: sem WhatsApp pessoal do dono nem número do salão pareado; aviso de novo agendamento não enviado`);
        }
```

Outros pontos a tocar:
- `src/lib/whatsapp.server.ts:20-23`: o comentário do topo já diz que o self-chat chega de forma instável. Não mude.

Teste: `atendys.test.mts`. Logo ANTES da linha
```ts
// ── demonstração: não conecta e nada sai dela, mesmo com conexão esquecida no documento ──
```
acrescente:
```ts
// ── aviso de novo agendamento: o pessoal do dono primeiro; o self-chat só avisa ──
{
  const { destinoDoAvisoAoDono } = await import("@/lib/whatsapp.server");
  assert.deepEqual(destinoDoAvisoAoDono({ phone: "5511900000099", ownerPhone: "5511933334444" }), { para: "5511933334444", podeResponder: true }, "o pessoal do dono vem primeiro");
  assert.deepEqual(destinoDoAvisoAoDono({ phone: "5511900000099", ownerPhone: null }), { para: "5511900000099", podeResponder: false }, "self-chat: só aviso, sem pedir resposta");
  assert.equal(destinoDoAvisoAoDono({ phone: null, ownerPhone: null }), null);
}

```
Comando: `npm run test:atendys`.

Critério de pronto: `grep -n "conn.phone ??" src` não acha nada; com `ownerPhone` cadastrado o aviso vai a ele e pede CONFIRMADO; sem ele, o texto do self-chat termina com "Confirme ou recuse no painel: …"; o teste passa.

---

### A2 — Resposta ao comando volta para quem mandou

Arquivo(s): `src/lib/whatsapp.server.ts:525`

Por quê: `respostaPara = numeroSalao ?? dono` manda a resposta ("Não encontrei…", "Há mais de um…", falhas)
ao self-chat do salão mesmo quando o dono escreveu do pessoal: ele não vê a resposta onde perguntou.
Junto: quem escreve do pessoal acabou de mandar uma mensagem, então a resposta pode ir como
`replyToInbound` (não conta no limite por destinatário nem cai no bloqueio de mensagem idêntica de 10 min
do atendys, `messages.service.ts:222-227`). Hoje isso só vale no canal oficial.

Trecho atual (`src/lib/whatsapp.server.ts`, linhas 518-529):
```ts
  const dono = conexao?.ownerPhone ? soDigitosComDDI(conexao.ownerPhone) : null;
  const numeroSalao = !oficial && conexao?.phone ? soDigitosComDDI(conexao.phone) : null;
  const remetente = msg.phone ? soDigitosComDDI(msg.phone) : null;
  if (!conexao || !canal || remetente == null) return "ignorado";
  // quem manda no fluxo é o número do salão (self-chat do dono) ou, em
  // fallback, o WhatsApp pessoal cadastrado na gaveta
  if (remetente !== numeroSalao && remetente !== dono) return "ignorado";
  const respostaPara = numeroSalao ?? dono;
  if (!respostaPara) return "ignorado"; // inalcançável (remetente bateu com um dos dois), satisfeito só o TS
  // canal oficial: o dono acabou de escrever (replyToInbound): a resposta não conta na cota por
  // destinatário, não cai no dedupe de 10 min nem espera o horário silencioso
  const responderDono = (texto: string) => enviarSemOperador(canal, respostaPara, texto, OPTIN_DONO, undefined, { resposta: !!oficial });
```
Trecho novo:
```ts
  const dono = conexao?.ownerPhone ? soDigitosComDDI(conexao.ownerPhone) : null;
  const numeroSalao = !oficial && conexao?.phone ? soDigitosComDDI(conexao.phone) : null;
  const remetente = msg.phone ? soDigitosComDDI(msg.phone) : null;
  if (!conexao || !canal || remetente == null) return "ignorado";
  // quem manda no fluxo é o WhatsApp pessoal do dono ou o próprio número do salão
  if (remetente !== numeroSalao && remetente !== dono) return "ignorado";
  // a resposta volta para quem mandou: o dono que escreveu do pessoal lê no pessoal
  const respostaPara = remetente;
  // quem escreveu do pessoal acabou de mandar mensagem (janela de 24 h aberta): replyToInbound não conta
  // na cota por destinatário, não cai no dedupe de 10 min nem espera o horário silencioso. Vale também
  // no canal oficial. O self-chat não tem mensagem recebida no atendys (é eco), então ali não vale
  const resposta = !!oficial || remetente === dono;
  const responderDono = (texto: string) => enviarSemOperador(canal, respostaPara, texto, OPTIN_DONO, undefined, { resposta });
```

Trecho atual (`src/lib/whatsapp.server.ts`, linhas 492-498):
```ts
/** O salão respondeu ao aviso de agendamento no próprio WhatsApp: CONFIRMADO
 *  confirma o agendamento pendente mais recente; RECUSAR cancela. Em ambos os
 *  casos o cliente é avisado pelo número do salão. O comando pode vir do
 *  self-chat do salão (dono operando o próprio número — comunicação toda pelo
 *  número do negócio) ou do WhatsApp pessoal dele, quando cadastrado como
 *  fallback. Não é comando: "ignorado" (a mensagem já ficou na caixa de
 *  entrada, como qualquer outra). */
```
Trecho novo:
```ts
/** O dono respondeu ao aviso de agendamento: CONFIRMADO confirma o agendamento
 *  pendente; RECUSAR cancela. Em ambos os casos o cliente é avisado pelo número
 *  do salão. O comando vem do WhatsApp pessoal do dono (o self-chat do salão
 *  chega ao atendys como eco e não vira mensagem recebida). A resposta volta a
 *  quem mandou. Não é comando: "ignorado" (a mensagem já ficou na caixa de
 *  entrada, como qualquer outra). */
```

Outros pontos a tocar:
- Comentário em `src/lib/whatsapp.server.ts:671-672` ("quem opera o salão (self-chat), que está esperando o eco"): troque
  ```ts
      // o agendamento já está confirmado; quem precisa saber que o cliente não
      // foi avisado é quem opera o salão (self-chat), que está esperando o eco
  ```
  por
  ```ts
      // o agendamento já está confirmado; quem precisa saber que o cliente não
      // foi avisado é o dono, que está esperando a resposta
  ```

Teste: `atendys.test.mts`, bloco "conta antiga (12 dígitos)". Logo depois da linha
```ts
  assert.equal(await comando("confirmado", "5511955554444"), "ignorado", "terceiro continua sem poder confirmar");
```
acrescente:
```ts
  enviadas.length = 0;
  assert.equal(await comando("confimado", "5511966665555"), "nao entendido");
  assert.equal(enviadas.at(-1)?.para, "5511966665555", "a resposta volta ao WhatsApp pessoal de quem mandou, não ao self-chat");
  assert.equal((chamadas.at(-1)!.corpo as { replyToInbound?: boolean }).replyToInbound, true, "resposta ao pessoal vai como replyToInbound");
```
Comando: `npm run test:atendys`. Os testes já existentes do self-chat (`enviadas` com `para: "5511900000099"`) têm de continuar passando sem mudança.

Critério de pronto: `respostaPara` é `remetente`; o teste novo e os antigos do comando passam.

---

### A7 — Cron de lembretes: falha nos lembretes não derruba as outras etapas

Arquivo(s): `src/app/api/cron/lembretes/route.ts:18`

Por quê: `enviarLembretesDoDia()` sem `.catch`: se a consulta inicial falha, a rota responde 500 e
`reprocessarComandos`, o SMS e a vigia das conexões não rodam no ciclo.

Trecho atual (`src/app/api/cron/lembretes/route.ts`, linhas 17-18):
```ts
  const sinaisVencidos = await expirarSinais(adminDb).catch((e) => (console.error("[cron] expirar sinais", e), 0));
  const enviados = await enviarLembretesDoDia();
```
Trecho novo:
```ts
  const sinaisVencidos = await expirarSinais(adminDb).catch((e) => (console.error("[cron] expirar sinais", e), 0));
  const enviados = await enviarLembretesDoDia().catch((e) => (console.error("[cron] lembretes do WhatsApp", e), 0));
```

Outros pontos a tocar: nenhum.

Teste: nenhum automatizado (rota de uma linha, mesmo padrão das vizinhas). Verificação: `npm run typecheck`.

Critério de pronto: as cinco etapas da rota têm `.catch`; o typecheck passa.

---

## MÉDIOS

### M1 — Lembrete com idempotency-key determinística

Arquivo(s): `src/lib/atendys.ts:355`, `:371`, `:409`, `:415`, `:538`; `src/lib/lembretes-whatsapp.server.ts:108-116`

Por quê: quando o envio do lembrete dá timeout (`AtendysForaDoAr`), a reserva é devolvida e o próximo ciclo
envia de novo: se o primeiro saiu, o cliente recebe dois. O atendys aceita o cabeçalho `idempotency-key`
(1 a 80 caracteres, `messages.controller.ts:207-214`) em `send-text` e `send-template`. Com a mesma chave ele
devolve a mensagem já aceita, sem enviar de novo (`messages.service.ts:71-76`, antes do opt-in e do dedupe).
A chave fica guardada por tenant e não expira.

Sobre "manter a reserva e conferir status" no `AtendysForaDoAr`: no timeout não há `messageId` para conferir.
Com a chave, a nova tentativa do ciclo seguinte É a conferência: se a primeira saiu, o atendys devolve a mesma
mensagem; se não saiu, envia agora. Por isso o fluxo de devolver a reserva fica como está.

Trecho atual (`src/lib/atendys.ts`, linha 2):
```ts
import { createHmac, timingSafeEqual } from "node:crypto";
```
Trecho novo:
```ts
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
```

Trecho atual (`src/lib/atendys.ts`, linhas 353-358):
```ts
/** opcoes.resposta: a pessoa acabou de escrever ou tocar num botão (janela de 24 h): no atendys não
 *  conta na cota por destinatário nem no dedupe de 10 min (replyToInbound). */
export async function enviarTexto(conn: ConexaoAtendys, phone: string, message: string, optIn: OptIn, prazo?: Date, opcoes: { resposta?: boolean } = {}): Promise<Envio> {
  const digits = phone.replace(/\D/g, "");
  return enviarComOptIn(conn, digits, optIn, "/v1/message/send-text", { number: digits, text: message, ...validade(prazo), ...(opcoes.resposta && { replyToInbound: true }) }, message, prazo, opcoes.resposta);
}
```
Trecho novo:
```ts
/** opcoes.resposta: a pessoa acabou de escrever ou tocar num botão (janela de 24 h): no atendys não
 *  conta na cota por destinatário nem no dedupe de 10 min (replyToInbound).
 *  opcoes.chave: idempotency-key (chaveDeEnvio); repetir o envio com ela devolve a mensagem já aceita. */
export async function enviarTexto(conn: ConexaoAtendys, phone: string, message: string, optIn: OptIn, prazo?: Date, opcoes: { resposta?: boolean; chave?: string } = {}): Promise<Envio> {
  const digits = phone.replace(/\D/g, "");
  return enviarComOptIn(conn, digits, optIn, "/v1/message/send-text", { number: digits, text: message, ...validade(prazo), ...(opcoes.resposta && { replyToInbound: true }) }, message, prazo, opcoes.resposta, opcoes.chave);
}

/** Idempotency-key determinística para send-text/send-template: o mesmo envio repetido (timeout, cron
 *  que tenta de novo) devolve a mensagem já aceita em vez de mandar outra. As partes identificam o envio
 *  (negócio, agendamento, horário); o hash cabe nos 80 caracteres do atendys. */
export const chaveDeEnvio = (tipo: string, ...partes: string[]) => `${tipo}-${createHash("sha256").update(partes.join("/")).digest("hex").slice(0, 40)}`;
```

Trecho atual (`src/lib/atendys.ts`, linha 371):
```ts
export async function enviarTemplate(conn: ConexaoAtendys, phone: string, t: Template, optIn: OptIn, prazo?: Date): Promise<Envio> {
```
Trecho novo:
```ts
export async function enviarTemplate(conn: ConexaoAtendys, phone: string, t: Template, optIn: OptIn, prazo?: Date, opcoes: { chave?: string } = {}): Promise<Envio> {
```

Trecho atual (`src/lib/atendys.ts`, linhas 386-387):
```ts
  // texto da parada (painel "Mensagens"): o template com os parâmetros, já que não há texto livre
  return enviarComOptIn(conn, digits, optIn, "/v1/message/send-template", corpo, `[${t.nome}] ${t.parametros.join(" · ")}`, prazo);
```
Trecho novo:
```ts
  // texto da parada (painel "Mensagens"): o template com os parâmetros, já que não há texto livre
  return enviarComOptIn(conn, digits, optIn, "/v1/message/send-template", corpo, `[${t.nome}] ${t.parametros.join(" · ")}`, prazo, false, opcoes.chave);
```

Trecho atual (`src/lib/atendys.ts`, linhas 408-413):
```ts
/** enviarTemplate + seguirSemOperador: para quem envia sem ninguém olhando a tela. */
export async function enviarTemplateSemOperador(conn: ConexaoAtendys, phone: string, t: Template, optIn: OptIn, prazo?: Date) {
  if (semFolga(prazo)) return NAO_ENVIADA;
  const envio = await enviarTemplate(conn, phone, t, optIn, prazo);
  return { ...envio, destino: await seguirSemOperador(conn, envio, prazo) };
}
```
Trecho novo:
```ts
/** enviarTemplate + seguirSemOperador: para quem envia sem ninguém olhando a tela. */
export async function enviarTemplateSemOperador(conn: ConexaoAtendys, phone: string, t: Template, optIn: OptIn, prazo?: Date, opcoes: { chave?: string } = {}) {
  if (semFolga(prazo)) return NAO_ENVIADA;
  const envio = await enviarTemplate(conn, phone, t, optIn, prazo, opcoes);
  return { ...envio, destino: await seguirSemOperador(conn, envio, prazo) };
}
```

Trecho atual (`src/lib/atendys.ts`, linhas 415-416):
```ts
async function enviarComOptIn(conn: ConexaoAtendys, digits: string, optIn: OptIn, caminho: string, corpo: unknown, message: string, prazo?: Date, resposta = false): Promise<Envio> {
  const auth = { ...authTenant(conn), instance: conn.instanceId };
```
Trecho novo:
```ts
async function enviarComOptIn(conn: ConexaoAtendys, digits: string, optIn: OptIn, caminho: string, corpo: unknown, message: string, prazo?: Date, resposta = false, chave?: string): Promise<Envio> {
  // a mesma chave nas duas tentativas (antes e depois do opt-in): a recusa NOT_OPTED_IN não grava nada no atendys
  const auth = { ...authTenant(conn), instance: conn.instanceId, ...(chave && { "idempotency-key": chave }) };
```

Trecho atual (`src/lib/atendys.ts`, linhas 537-538):
```ts
/** enviarTexto + seguirSemOperador: para quem envia sem ninguém olhando a tela. */
export async function enviarSemOperador(conn: ConexaoAtendys, phone: string, message: string, optIn: OptIn, prazo?: Date, opcoes: { resposta?: boolean } = {}) {
```
Trecho novo:
```ts
/** enviarTexto + seguirSemOperador: para quem envia sem ninguém olhando a tela. */
export async function enviarSemOperador(conn: ConexaoAtendys, phone: string, message: string, optIn: OptIn, prazo?: Date, opcoes: { resposta?: boolean; chave?: string } = {}) {
```

Trecho atual (`src/lib/lembretes-whatsapp.server.ts`, linha 7):
```ts
import { enviarSemOperador, enviarTemplateSemOperador, motivoLegivel, ROTULO_STATUS, saiuDepoisDoAceite, statusDaConexao } from "@/lib/atendys";
```
Trecho novo:
```ts
import { chaveDeEnvio, enviarSemOperador, enviarTemplateSemOperador, motivoLegivel, ROTULO_STATUS, saiuDepoisDoAceite, statusDaConexao } from "@/lib/atendys";
```

Trecho atual (`src/lib/lembretes-whatsapp.server.ts`, linhas 107-116):
```ts
      try {
        const e = oficial
          ? await enviarTemplateSemOperador(oficial, cliente, templateCliente("lembrete", { nome, negocio: nomeNegocio, servico: String(a.get("serviceName") ?? ""), quando: `${dia} às ${formatTime(start)}` }, { slug: t.id, agendamento: a.id, horario: chaveDoHorario(start) }), optIn, prazo)
          : await enviarSemOperador(
              w,
              cliente,
              comAvisoSair(`Olá, ${nome}! Lembrete do seu horário ${dia} às ${formatTime(start)}: ${a.get("serviceName")} no ${nomeNegocio}. Qualquer imprevisto, responda aqui pelo WhatsApp.`),
              optIn,
              prazo, // lembrete que sairia depois do horário não serve: fica parado
            );
```
Trecho novo:
```ts
      // um lembrete por agendamento e horário: a tentativa do ciclo seguinte (timeout, reserva devolvida)
      // repete a chave e o atendys devolve o já aceito em vez de mandar outro. Remarcou: outra chave
      const chave = chaveDeEnvio("lembrete", t.id, a.id, chaveDoHorario(start));
      try {
        const e = oficial
          ? await enviarTemplateSemOperador(oficial, cliente, templateCliente("lembrete", { nome, negocio: nomeNegocio, servico: String(a.get("serviceName") ?? ""), quando: `${dia} às ${formatTime(start)}` }, { slug: t.id, agendamento: a.id, horario: chaveDoHorario(start) }), optIn, prazo, { chave })
          : await enviarSemOperador(
              w,
              cliente,
              comAvisoSair(`Olá, ${nome}! Lembrete do seu horário ${dia} às ${formatTime(start)}: ${a.get("serviceName")} no ${nomeNegocio}. Qualquer imprevisto, responda aqui pelo WhatsApp.`),
              optIn,
              prazo, // lembrete que sairia depois do horário não serve: fica parado
              { chave },
            );
```

Outros pontos a tocar: nenhum. O aviso de novo agendamento (rota `agendar`) roda uma vez só, sem nova tentativa: fica sem chave.

Teste: `atendys.test.mts`.
1. Na linha 6 (import de `@/lib/atendys`), acrescente `chaveDeEnvio` à lista, em ordem alfabética (depois de `assumirEnvio`).
2. No bloco "P1", logo depois da linha
   ```ts
     assert.equal(chamadas.length, 0);
   ```
   (a que segue o teste "prazo sem folga"), acrescente:
   ```ts
     // lembrete: idempotency-key determinística; sem chave, sem cabeçalho
     const k = chaveDeEnvio("lembrete", "loja", "ag1", "2026-11-10T10:00");
     assert.match(k, /^lembrete-[0-9a-f]{40}$/);
     assert.equal(k, chaveDeEnvio("lembrete", "loja", "ag1", "2026-11-10T10:00"), "a mesma em toda tentativa");
     assert.notEqual(k, chaveDeEnvio("lembrete", "loja", "ag1", "2026-11-10T11:00"), "remarcou: outra chave");
     novo({ "POST /v1/message/send-text": json({ id: "m-k", status: "queued" }) });
     await enviarSemOperador(loja, "5511987654321", "lembrete", null, undefined, { chave: k });
     assert.equal(chamadas[0].headers["idempotency-key"], k);
     novo({ "POST /v1/message/send-text": json({ id: "m-k2", status: "queued" }) });
     await enviarSemOperador(loja, "5511987654321", "oi", null);
     assert.equal(chamadas[0].headers["idempotency-key"], undefined, "sem chave: sem cabeçalho");
   ```
Comando: `npm run test:atendys`.

Critério de pronto: os lembretes (número do salão e canal oficial) mandam `idempotency-key`; os outros envios não mudam; o teste passa.

---

### M2 — Conversas: falha incerta mantém a chave de idempotência

Arquivo(s): `src/app/[tenant]/actions.ts:618`, `src/app/[tenant]/conversas/conversa.tsx:139-155`

Por quê: em qualquer `ok:false` a tela troca a chave. Num timeout ou 5xx a resposta pode ter saído; com chave
nova, o reenvio duplica a mensagem ao cliente. A ação passa a devolver `incerto: true` nesses casos, e a tela
só troca a chave quando a falha é certa.

Trecho atual (`src/app/[tenant]/actions.ts`, linha 14):
```ts
import { agirNaMensagem, arquivarConversa, assumirEnvio, buscarNasConversas, CHAVE_IDEMPOTENCIA, deslogarInstancia, ID_INBOX, enviarTexto, ErroAtendys, listarConversas, manterAgendada, marcarConversa, mensagensDaConversa, qrDaConexao, responderConversa, statusDaConexao, statusDaMensagem, type ConexaoAtendys } from "@/lib/atendys";
```
Trecho novo (já sem `agirNaMensagem` e `arquivarConversa`, que saem em B4, que vai no mesmo PR):
```ts
import { AtendysForaDoAr, assumirEnvio, buscarNasConversas, CHAVE_IDEMPOTENCIA, deslogarInstancia, ID_INBOX, enviarTexto, ErroAtendys, listarConversas, manterAgendada, marcarConversa, mensagensDaConversa, qrDaConexao, responderConversa, statusDaConexao, statusDaMensagem, type ConexaoAtendys } from "@/lib/atendys";
```

Trecho atual (`src/app/[tenant]/actions.ts`, linhas 617-620):
```ts
    } catch (e) {
      if (e instanceof ErroAtendys) return { ok: false as const, error: e.message, codigo: e.codigo, retryAfter: e.retryAfter };
      if (e instanceof ErroPrevisto) return { ok: false as const, error: e.message };
      console.error("[conversas] erro inesperado", e);
```
Trecho novo:
```ts
    } catch (e) {
      // incerto: o atendys não respondeu ou falhou do lado de lá (5xx), e a mensagem pode ter saído.
      // A tela mantém a chave de idempotência: reenviar o mesmo conteúdo não duplica
      if (e instanceof ErroAtendys) return { ok: false as const, error: e.message, codigo: e.codigo, retryAfter: e.retryAfter, incerto: e.status >= 500 };
      // antes do ErroPrevisto: AtendysForaDoAr é um ErroPrevisto
      if (e instanceof AtendysForaDoAr) return { ok: false as const, error: e.message, incerto: true };
      if (e instanceof ErroPrevisto) return { ok: false as const, error: e.message };
      console.error("[conversas] erro inesperado", e);
```

Trecho atual (`src/app/[tenant]/conversas/conversa.tsx`, linhas 139-155):
```tsx
      let r: { ok: true; envio: RespostaInbox } | { ok: false; error: string };
      if (arquivo) {
        const f = new FormData();
        f.set("conversa", conversa.id);
        f.set("chave", chave.current);
        f.set("arquivo", arquivo);
        if (texto.trim()) f.set("legenda", texto.trim());
        const res = await fetch(`/api/conversas/${encodeURIComponent(tenant.id)}/responder-arquivo`, { method: "POST", headers: { authorization: `Bearer ${await idToken()}` }, body: f });
        r = await res.json().catch(() => ({ ok: false as const, error: "Não foi possível enviar o arquivo agora." }));
      } else {
        r = await responderConversaAction(await idToken(), { tenantId: tenant.id, conversa: conversa.id, texto, chave: chave.current });
      }
      if (!r.ok) {
        // recusa com resposta (janela, cota, validação): nada foi aceito, a próxima tentativa é outra
        trocarChave();
        setErroEnvio(r.error);
        return;
      }
```
Trecho novo:
```tsx
      let r: { ok: true; envio: RespostaInbox } | { ok: false; error: string; incerto?: boolean };
      if (arquivo) {
        const f = new FormData();
        f.set("conversa", conversa.id);
        f.set("chave", chave.current);
        f.set("arquivo", arquivo);
        if (texto.trim()) f.set("legenda", texto.trim());
        const res = await fetch(`/api/conversas/${encodeURIComponent(tenant.id)}/responder-arquivo`, { method: "POST", headers: { authorization: `Bearer ${await idToken()}` }, body: f });
        r = await res.json().catch(() => ({ ok: false as const, error: "Não foi possível enviar o arquivo agora." }));
        // 5xx (atendys sem resposta, falha do lado de lá ou proxy): pode ter saído
        if (!r.ok && res.status >= 500) r = { ...r, incerto: true };
      } else {
        r = await responderConversaAction(await idToken(), { tenantId: tenant.id, conversa: conversa.id, texto, chave: chave.current });
      }
      if (!r.ok) {
        // recusa com resposta (janela, cota, validação): nada foi aceito, a próxima tentativa é outra.
        // Incerta (timeout, 5xx): pode ter saído; a chave fica e reenviar o mesmo conteúdo não duplica
        if (!r.incerto) trocarChave();
        setErroEnvio(r.error);
        return;
      }
```

Outros pontos a tocar: nenhum. A rota `responder-arquivo` já devolve 502/504 nesses casos (`src/lib/conversas.server.ts:119-120` e `:209`).

Teste: nenhum automatizado (a decisão fica no componente e na server action, sem harness). Verificação:
`npm run typecheck`, `npm run lint` e `npm run test:conversas` (não pode quebrar).

Critério de pronto: com timeout ou 5xx a chave não muda; com 4xx muda como antes; typecheck, lint e `test:conversas` passam.

---

### M3 — Atendys fora do ar não apaga o comando pendente do dono

Arquivo(s): `src/lib/whatsapp.server.ts:535-542`

Por quê: `statusDaConexao(...).catch(() => null)` vira "ignorado", e `executarComandoPendente` apaga o pendente
(linha 303). Um CONFIRMADO que chega com o atendys instável some sem resposta. Com a mudança, só lança quando
o texto é (ou parece) comando: conversa comum do dono continua "ignorado", sem alarme falso de "comando descartado".

Trecho atual (`src/lib/whatsapp.server.ts`, linhas 535-542):
```ts
  // estado de verdade vem do gateway ao vivo — o status cacheado no documento
  // do tenant pode estar desatualizado se um webhook de reconexão se perder
  if (!oficial) {
    const vivo = await statusDaConexao(conexao).catch(() => null);
    if (!vivo || vivo.status !== "connected") return "ignorado";
  }
  const texto = String((msg.data as { text?: unknown } | undefined)?.text ?? "");
  const comando = lerComando(texto);
```
Trecho novo:
```ts
  const texto = String((msg.data as { text?: unknown } | undefined)?.text ?? "");
  const comando = lerComando(texto);
  // estado de verdade vem do gateway ao vivo — o status cacheado no documento
  // do tenant pode estar desatualizado se um webhook de reconexão se perder.
  // Atendys sem resposta com um comando na mão: lança, o pendente fica e o cron
  // (reprocessarComandos) tenta de novo. Conversa comum do dono segue "ignorado"
  if (!oficial) {
    const vivo = await statusDaConexao(conexao).catch((e) => {
      if (comando || pareceComando(texto)) throw e;
      return null;
    });
    if (!vivo || vivo.status !== "connected") return "ignorado";
  }
```

Outros pontos a tocar: nenhum. O webhook (`src/app/api/webhooks/atendys/route.ts:196-202`) já captura o erro com
`.catch` e só registra no log; o pendente fica com `pegoEm` e o cron o pega depois de 5 min.

Teste: `atendys.test.mts`. Logo ANTES da linha
```ts
// ── WhatsApp pessoal do dono: fora do documento do negócio (a equipe o lê pelo navegador) ──
```
acrescente:
```ts
// atendys fora do ar com comando do dono: lança (o pendente fica para o cron); conversa comum, não
{
  novo({ ...salao, "GET /v1/instance/salao-main/status": () => new Response("fora", { status: 503 }) });
  await assert.rejects(comando("confirmado"), "comando não some quando o atendys não responde");
  assert.equal(await comando("bom dia"), "ignorado", "conversa comum segue ignorada");
  novo(salao);
}

```
Comando: `npm run test:atendys`.

Critério de pronto: com o status do atendys falhando, `processarComandoAgendamento` lança para "confirmado" e devolve "ignorado" para "bom dia"; o teste passa.

---

### M4 — decidirEnvioAction só para quem gere

Arquivo(s): `src/app/[tenant]/actions.ts:542-547`, `src/app/[tenant]/page.tsx:286-290`

Por quê: "Enviar agora" devolve o link wa.me com o telefone e o texto do cliente. `mensagensParadasAction`
(linha 578) já exige gestor, mas `decidirEnvioAction` não.

Conferido: a equipe USA essa ação hoje. Na agenda (`src/app/[tenant]/page.tsx:158` e `:286-290`), quando um
profissional manda aviso ao cliente e ele para na cota, a tela mostra `CotaWhatsapp`, que chama
`decidirEnvioAction`. O comentário da linha 544 diz que isso é de propósito ("Quem pode avisar o cliente pode
decidir"). O risco real é baixo: o `messageId` é um UUID que só aparece para quem enviou, e a ação já confere
que a mensagem é do negócio.

DECISÃO DO USUÁRIO:
- (a) Exigir gestor. A equipe deixa de ver os botões e lê "O dono decide em Mensagens, no painel". A mensagem
  já aparece na lista do gestor (`MensagensParadas`), porque o envio registra a parada. Recomendado.
- (b) Manter como está. Nesse caso pule este item inteiro.

Se (a):

Trecho atual (`src/app/[tenant]/actions.ts`, linhas 542-547):
```ts
/** Mensagem parada na cota do dia: "Enviar agora" (o atendys marca a ação manual e devolve o
 *  wa.me, que a tela abre só depois desta resposta) ou "Manter agendada" (volta à fila para o
 *  retryAt). Quem pode avisar o cliente pode decidir; o atendys confere que a mensagem é do negócio. */
export const decidirEnvioAction = memberAction(
  z.object({ tenantId: docIdStaff, messageId: z.string().uuid(), acao: z.enum(["agora", "agendar"]) }),
  async (data) => {
```
Trecho novo:
```ts
/** Mensagem parada na cota do dia: "Enviar agora" (o atendys marca a ação manual e devolve o
 *  wa.me, que a tela abre só depois desta resposta) ou "Manter agendada" (volta à fila para o
 *  retryAt). Só quem gere: o wa.me leva o telefone e o texto do cliente, e a lista das paradas
 *  (mensagensParadasAction) também é só de quem gere. A equipe vê o aviso e o dono decide. */
export const decidirEnvioAction = memberAction(
  z.object({ tenantId: docIdStaff, messageId: z.string().uuid(), acao: z.enum(["agora", "agendar"]) }),
  async (data, user) => {
    await exigeGestor(data.tenantId, user.uid);
```

Trecho atual (`src/app/[tenant]/page.tsx`, linhas 286-290):
```tsx
          {notice.cota && (
            <div className="basis-full">
              <CotaWhatsapp tenantId={tenant.id} messageId={notice.cota.messageId} retryAt={notice.cota.retryAt} fuso={fuso} onFim={(text) => setNotice({ text })} />
            </div>
          )}
```
Trecho novo:
```tsx
          {notice.cota && (
            <div className="basis-full">
              {tenant.podeGerir ? (
                <CotaWhatsapp tenantId={tenant.id} messageId={notice.cota.messageId} retryAt={notice.cota.retryAt} fuso={fuso} onFim={(text) => setNotice({ text })} />
              ) : (
                <span className="text-muted-foreground">O dono decide em Mensagens, no painel.</span>
              )}
            </div>
          )}
```

Outros pontos a tocar: `src/app/[tenant]/lancamento-folha.tsx:213` também usa `CotaWhatsapp`, mas o Pix já exige
gestor (`enviarPixWhatsappAction`, linha 474). Não mude.

Teste: nenhum automatizado. Verificação: `npm run typecheck` e `npm run lint`.

Critério de pronto: `decidirEnvioAction` chama `exigeGestor`; na agenda, quem não gere vê o texto em vez dos botões.

---

## BAIXOS

### B1 — Aviso bem-sucedido só limpa falha de aviso de agendamento

Arquivo(s): `src/app/api/agendar/route.ts:151-156` e `:219-223`, `src/lib/whatsapp.server.ts:231`

Por quê: `registrarErroNotificacao(null)` apaga qualquer `lastNotifyError`, inclusive o de um lembrete que
falhou ou de um comando descartado. O dono perde o aviso de um problema que continua.

Trecho atual (`src/lib/whatsapp.server.ts`, linhas 231-236):
```ts
export async function registrarErroNotificacao(db: Firestore, slug: string, erro: { message: string; at: number } | null) {
  await db.doc(`tenants/${slug}`).set(
    { whatsapp: { lastNotifyError: erro ?? FieldValue.delete() } },
    { merge: true },
  );
}
```
Trecho novo:
```ts
export async function registrarErroNotificacao(db: Firestore, slug: string, erro: { message: string; at: number } | null) {
  await db.doc(`tenants/${slug}`).set(
    { whatsapp: { lastNotifyError: erro ?? FieldValue.delete() } },
    { merge: true },
  );
}

/** Aviso de agendamento que saiu: limpa a falha só se ela também era de aviso de agendamento
 *  ("Agendamento de …"). A de lembrete, de comando descartado ou de envio recusado fica na gaveta
 *  até a reconexão: um aviso bom não prova que aquela foi resolvida. */
export async function limparErroDeAgendamento(db: Firestore, slug: string) {
  const ref = db.doc(`tenants/${slug}`);
  await db.runTransaction(async (tx) => {
    const atual = (await tx.get(ref)).get("whatsapp.lastNotifyError.message");
    if (typeof atual === "string" && atual.startsWith("Agendamento de ")) tx.update(ref, { "whatsapp.lastNotifyError": FieldValue.delete() });
  });
}
```

Trecho atual (`src/app/api/agendar/route.ts`, linha 7; se A1 já entrou, a lista terá `destinoDoAvisoAoDono`):
```ts
import { codigoDoAgendamento, espelharStatusVivo, lerConexao, lerConfigWhatsApp, registrarErroNotificacao } from "@/lib/whatsapp.server";
```
Trecho novo (acrescente `limparErroDeAgendamento` em ordem alfabética, mantendo o que já houver):
```ts
import { codigoDoAgendamento, espelharStatusVivo, lerConexao, lerConfigWhatsApp, limparErroDeAgendamento, registrarErroNotificacao } from "@/lib/whatsapp.server";
```

Trecho atual (`src/app/api/agendar/route.ts`, linhas 150-156):
```ts
        // um aviso bem-sucedido limpa o erro anterior; falha mantém o detalhe
        await registrarErroNotificacao(
          adminDb,
          tenantId,
          falhas.length ? { message: `Agendamento de ${customerName.trim()} — ${falhas.join("; ")}.`, at: Date.now() } : null,
        ).catch(() => {});
```
Trecho novo:
```ts
        // falha grava o detalhe; aviso bem-sucedido limpa só a falha de aviso de agendamento
        // (a de lembrete ou de comando descartado continua na gaveta)
        await (falhas.length
          ? registrarErroNotificacao(adminDb, tenantId, { message: `Agendamento de ${customerName.trim()} — ${falhas.join("; ")}.`, at: Date.now() })
          : limparErroDeAgendamento(adminDb, tenantId)
        ).catch(() => {});
```

Trecho atual (`src/app/api/agendar/route.ts`, linhas 219-223):
```ts
  await registrarErroNotificacao(
    adminDb,
    tenantId,
    falhas.length ? { message: `Agendamento de ${nome} — ${falhas.join("; ")}.`, at: Date.now() } : null,
  ).catch(() => {});
```
Trecho novo:
```ts
  // aviso bem-sucedido limpa só a falha de aviso de agendamento
  await (falhas.length
    ? registrarErroNotificacao(adminDb, tenantId, { message: `Agendamento de ${nome} — ${falhas.join("; ")}.`, at: Date.now() })
    : limparErroDeAgendamento(adminDb, tenantId)
  ).catch(() => {});
```

Outros pontos a tocar: nenhum (só estas duas linhas passavam `null`).

Teste: `atendys.test.mts`, bloco "P1". Logo depois da linha
```ts
  assert.match((await lerConfigWhatsApp(db, "loja"))?.lastNotifyError?.message ?? "", /comando do dono .* descartado/);
```
acrescente:
```ts
  // aviso de agendamento que saiu não apaga a falha de outra coisa (lembrete, comando descartado)
  const { limparErroDeAgendamento, registrarErroNotificacao } = await import("@/lib/whatsapp.server");
  await registrarErroNotificacao(db, "loja", { message: "O lembrete de Ana não saiu", at: 1 });
  await limparErroDeAgendamento(db, "loja");
  assert.equal((await lerConfigWhatsApp(db, "loja"))?.lastNotifyError?.message, "O lembrete de Ana não saiu", "falha de lembrete fica");
  await registrarErroNotificacao(db, "loja", { message: "Agendamento de Ana — aviso ao salão não chegou.", at: 2 });
  await limparErroDeAgendamento(db, "loja");
  assert.equal((await lerConfigWhatsApp(db, "loja"))?.lastNotifyError ?? null, null, "falha de aviso de agendamento sai");
```
Comando: `npm run test:atendys`.

Critério de pronto: `grep -n "} : null," src/app/api/agendar/route.ts` não acha nada; o teste passa.

---

### B2 — message.status acha o segredo mesmo com o negócio desconectado

Arquivo(s): `src/app/api/webhooks/atendys/route.ts:87`

Por quê: `lerConexao` devolve `null` sem `instanceId` (negócio desconectado: `desligarConexao` apaga o campo) e
sem apikey. O `message.status` de um envio feito antes da queda (por exemplo `failed`) é descartado como
"assinatura inválida", e a falha nunca chega à gaveta. O segredo continua no doc privado: `lerConfigWhatsApp` lê.

Trecho atual (`src/app/api/webhooks/atendys/route.ts`, linha 6):
```ts
import { avisarQueda, codigoDoAgendamento, espelharStatusDaInstancia, executarComandoPendente, idDoComando, lerConexao, registrarMensagemRecebida, tenantDaInstancia } from "@/lib/whatsapp.server";
```
Trecho novo:
```ts
import { avisarQueda, codigoDoAgendamento, espelharStatusDaInstancia, executarComandoPendente, idDoComando, lerConexao, lerConfigWhatsApp, registrarMensagemRecebida, tenantDaInstancia } from "@/lib/whatsapp.server";
```

Trecho atual (`src/app/api/webhooks/atendys/route.ts`, linhas 86-87):
```ts
    if (indice.vigiada && !indice.parada && evento.status !== "failed" && !naoSai) return responder(200, { ok: true });
    const segredoDaMensagem = (await lerConexao(adminDb, slugDaMensagem))?.atendysWebhookSecret;
```
Trecho novo:
```ts
    if (indice.vigiada && !indice.parada && evento.status !== "failed" && !naoSai) return responder(200, { ok: true });
    // lerConfigWhatsApp, não lerConexao: o negócio pode ter desconectado (sem instanceId) depois do
    // envio, e a falha daquela mensagem ainda tem de chegar à gaveta
    const segredoDaMensagem = (await lerConfigWhatsApp(adminDb, slugDaMensagem))?.atendysWebhookSecret;
```

Outros pontos a tocar: nenhum (`lerConexao` continua usado na linha 174).

Teste: `atendys.test.mts`, bloco "P1". Logo depois da linha
```ts
  assert.equal((await lerConfigWhatsApp(db, "loja"))?.lastNotifyError ?? null, null, "reentrega não repete o aviso");
```
acrescente:
```ts
  // negócio desconectado (sem instanceId) ainda recebe o message.status do que mandou antes
  const ID6 = "6cd4d428-4361-4153-bc2c-60db816d8b77";
  novo({ "POST /v1/message/send-text": json({ id: ID6, status: "queued" }) });
  await enviarSemOperador(loja, "5511987654321", "Lembrete de amanhã", null);
  await db.doc("tenants/loja").update({ "whatsapp.instanceId": FieldValue.delete() });
  assert.equal((await entregar({ event: "message.status", messageId: ID6, status: "failed", errorCode: "META_131026" }, "s-loja")).status, 200);
  assert.match((await lerConfigWhatsApp(db, "loja"))?.lastNotifyError?.message ?? "", /Lembrete de amanhã/, "desconectado: a falha chega à gaveta");
  await db.doc("tenants/loja").update({ "whatsapp.instanceId": "loja-main", "whatsapp.lastNotifyError": FieldValue.delete() });
```
Comando: `npm run test:atendys`.

Critério de pronto: o teste novo passa (e falha se a linha 87 voltar a usar `lerConexao`).

---

### B3 — message.received sem messageId não grava pendente

Arquivo(s): `src/lib/whatsapp.server.ts:273`

Por quê: sem `messageId` não há dedupe das reentregas (o id do doc vira aleatório) e o webhook não dispara o
processamento na hora (ele precisa do `messageId`, linha 195 da rota). O pendente só rodaria pelo cron, 5 min
depois, e cada reentrega criaria outro: o mesmo comando rodaria duas vezes.

Trecho atual (`src/lib/whatsapp.server.ts`, linhas 272-276):
```ts
    const texto = (msg.data as { text?: unknown } | null)?.text;
    if (comando && typeof texto === "string") {
      // pegoEm = agora: quem recebeu processa já (after); o cron só pega o que ficou 5 min parado
      b.set(db.doc(`${PENDENTES}/${idDoComando(slug, ref.id)}`), { slug, phone: msg.phone ?? null, text: texto, via: comando, pegoEm: Date.now(), tentativas: 1, ...(esperado && { esperado }) });
    }
```
Trecho novo:
```ts
    const texto = (msg.data as { text?: unknown } | null)?.text;
    // sem messageId (o contrato sempre manda; é defesa) não há dedupe das reentregas nem quem processe
    // na hora (o webhook dispara pelo messageId): a mensagem fica só na caixa de entrada
    if (comando && msg.messageId && typeof texto === "string") {
      // pegoEm = agora: quem recebeu processa já (after); o cron só pega o que ficou 5 min parado
      b.set(db.doc(`${PENDENTES}/${idDoComando(slug, ref.id)}`), { slug, phone: msg.phone ?? null, text: texto, via: comando, pegoEm: Date.now(), tentativas: 1, ...(esperado && { esperado }) });
    }
```

Outros pontos a tocar: nenhum.

Teste: `atendys.test.mts`, bloco "P1", logo depois dos testes de B1 (ou, se B1 ainda não entrou, logo depois da
linha `assert.match(... /comando do dono .* descartado/);`):
```ts
  // sem messageId: fica na caixa de entrada, sem pendente
  const pendentesAntes = (await db.collection("comandosPendentes").get()).size;
  assert.equal(await registrarMensagemRecebida(db, "loja", { phone: "5511900000001", data: { text: "CONFIRMADO" } }, "salao"), true);
  assert.equal((await db.collection("comandosPendentes").get()).size, pendentesAntes);
```
Comando: `npm run test:atendys`.

Critério de pronto: o teste passa; mensagens com `messageId` continuam gerando pendente (testes existentes do bloco P1).

---

### B4 — Remover arquivarConversaAction e agirNaMensagemAction (sem uso)

Arquivo(s): `src/app/[tenant]/actions.ts:668-672` e `:682-701`, imports nas linhas 13 e 14

Por quê: nenhuma tela importa as duas ações (`grep -rn "arquivarConversaAction\|agirNaMensagemAction" src *.test.mts scripts`
acha só a definição). As funções de `src/lib/atendys.ts` (`arquivarConversa`, `agirNaMensagem`) ficam: são
testadas em `conversas.test.mts`.

Antes de editar, rode de novo o grep acima. Se achar algum uso fora de `actions.ts`, PARE e avise.

Trecho atual (`src/app/[tenant]/actions.ts`, linhas 668-673), apague inteiro (incluindo a linha em branco depois):
```ts
export const arquivarConversaAction = conversaAction(ComConversa.extend({ arquivada: z.boolean() }), async ({ conversa, arquivada }, a) => {
  await exigeConversaVisivel(a, conversa);
  await arquivarConversa(a.conn, conversa, arquivada);
  return { ok: true as const };
});

```

Trecho atual (`src/app/[tenant]/actions.ts`, linhas 682-702), apague inteiro (incluindo a linha em branco depois):
```ts
export const agirNaMensagemAction = conversaAction(
  z.object({
    tenantId: docIdStaff,
    mensagem: idOpaco,
    // a conversa da mensagem: a equipe só reage em mensagem de conversa que pode ver
    conversa: idOpaco.optional(),
    chave: chaveEnvio,
    acao: z.discriminatedUnion("tipo", [
      z.object({ tipo: z.literal("reacao"), emoji: z.string().regex(/^(\p{Extended_Pictographic}[\p{Emoji_Modifier}️‍\p{Extended_Pictographic}]*)?$/u, "Reação inválida.").max(16) }),
      z.object({ tipo: z.literal("editar"), texto: z.string().trim().min(1).max(4096) }),
      z.object({ tipo: z.literal("apagar") }),
    ]),
  }),
  async ({ mensagem, conversa, chave, acao }, a) => {
    // editar e apagar para todos mexem no que o dono, a IA e as confirmações automáticas mandaram
    if (acao.tipo !== "reacao") soGestor(a, acao.tipo === "editar" ? "editar mensagens enviadas" : "apagar mensagens enviadas");
    await exigeMensagemVisivel(a, conversa ?? null, mensagem);
    return { ok: true as const, resultado: await agirNaMensagem(a.conn, mensagem, acao, chave) };
  },
);

```
(A linha do `emoji` tem caracteres invisíveis dentro da regex. Apague pelo número da linha, com o arquivo aberto,
em vez de colar o texto.)

Trecho atual (`src/app/[tenant]/actions.ts`, linha 13):
```ts
import { atenderComo, type Atendimento, conversaVisivel, exigeConversaVisivel, exigeMensagemVisivel, permitirEquipeNasConversas, visiveis } from "@/lib/conversas.server";
```
Trecho novo:
```ts
import { atenderComo, type Atendimento, conversaVisivel, exigeConversaVisivel, permitirEquipeNasConversas, visiveis } from "@/lib/conversas.server";
```

Linha 14: use o "Trecho novo" de M2 (já sem `agirNaMensagem` e `arquivarConversa`). Se M2 não entrar, a linha 14
fica só sem esses dois nomes:
```ts
import { assumirEnvio, buscarNasConversas, CHAVE_IDEMPOTENCIA, deslogarInstancia, ID_INBOX, enviarTexto, ErroAtendys, listarConversas, manterAgendada, marcarConversa, mensagensDaConversa, qrDaConexao, responderConversa, statusDaConexao, statusDaMensagem, type ConexaoAtendys } from "@/lib/atendys";
```

Outros pontos a tocar: `soGestor`, `idOpaco` e `chaveEnvio` continuam em uso (linhas 646 e 675). Não apague.

Teste: `npm run typecheck`, `npm run lint`, `npm run test:conversas`.

Critério de pronto: o grep do início não acha nada; typecheck e lint passam sem "unused".

---

### B5 — Aviso de SAIR no Pix enviado pelo WhatsApp

Arquivo(s): `src/app/[tenant]/actions.ts:498`

Por quê: toda mensagem automática ao cliente leva "Para não receber mais mensagens, responda SAIR." (`comAvisoSair`).
O Pix enviado pelo painel sai sem ela. `textoPix` também monta o texto do wa.me manual (`src/components/pix-qr.tsx:91`),
que não deve ter o aviso: a troca é só na ação.

DECISÃO DO USUÁRIO: onde fica o aviso.
- (a) Antes do código Pix: o código continua sendo a última linha, e quem copia a mensagem inteira não leva o aviso
  junto para o app do banco. Recomendado.
- (b) No fim, como as outras mensagens (`comAvisoSair(textoPix(...))`), mais simples.

Trecho atual (`src/app/[tenant]/actions.ts`, linha 498):
```ts
    const envio = await enviarTexto(w, cliente, textoPix({ valorCents: data.valorCents, nome: recebedor.nome, codigo }), optIn);
```
Trecho novo, se (a):
```ts
    // o aviso de SAIR antes do código: o código Pix fica por último, e quem copia a mensagem
    // inteira não leva o aviso junto para o app do banco
    const texto = textoPix({ valorCents: data.valorCents, nome: recebedor.nome, codigo });
    const corte = texto.lastIndexOf("\n\n");
    const envio = await enviarTexto(w, cliente, `${comAvisoSair(texto.slice(0, corte))}\n\n${texto.slice(corte + 2)}`, optIn);
```
Trecho novo, se (b):
```ts
    const envio = await enviarTexto(w, cliente, comAvisoSair(textoPix({ valorCents: data.valorCents, nome: recebedor.nome, codigo })), optIn);
```

Outros pontos a tocar: nenhum (`comAvisoSair` já está importado na linha 19).

Teste: nenhum automatizado (server action). Verificação: `npm run typecheck`.

Critério de pronto: o Pix enviado pelo painel contém "responda SAIR"; o wa.me manual (`pix-qr.tsx`) não muda.

---

### B6 — 409 do opt-in reconhecido por regex: pedir ao atendys

Arquivo(s): `src/lib/atendys.ts:461` e `:463` (sem mudança agora)

Por quê: os três conflitos do opt-in vêm com `code: "VALIDATION_ERROR"` e o `ruphus-site` distingue pela frase
(`/já foi registrado/i`, `/posterior à revogação/i`). Se o atendys mudar a frase, o envio quebra calado.
Conferido em `optin/optin.service.ts:79`, `:82` e `:102` do atendys.

Pedir ao atendys (mantendo HTTP 409 e a mesma frase):
- `:102` "Este evento de consentimento já foi registrado" → `code: "OPTIN_EVENT_DUPLICATE"`
- `:82` "A autorização precisa ser posterior à revogação" → `code: "OPTIN_BEFORE_REVOCATION"`
- `:79` "Reativação exige eventId e occurredAt de uma nova autorização" → `code: "OPTIN_REACTIVATION_REQUIRES_EVENT"`

Quando o atendys publicar, troque as duas regex por `r.codigo === "OPTIN_EVENT_DUPLICATE"` e
`r.codigo === "OPTIN_BEFORE_REVOCATION"` (mantendo a regex como alternativa por um deploy).

No `ruphus-site`, nada agora. Teste: nenhum. Critério de pronto: pedido registrado com o atendys.

---

## Ordem e agrupamento em PRs

Os PRs 1 e 2 mexem nos mesmos arquivos (`atendys.ts`, `whatsapp.server.ts`, `agendar/route.ts`, `atendys.test.mts`):
faça o PR 2 só depois do merge do PR 1, a partir do `origin/main` atualizado. O PR 3 é independente e pode correr junto.

### PR 1 — avisos e comandos do dono
- Itens, nesta ordem: A8 (a e b), A1, A2, M3, B3.
- Branch: `git fetch origin && git switch -c fix/whatsapp-aviso-dono origin/main`
- Título: `WhatsApp: aviso de agendamento no pessoal do dono, resposta a quem mandou e limite por destinatário`
- Testes: `npm run test:atendys && npm run typecheck && npm run lint`
- Depois do merge e do deploy (`scripts/deploy-vps.sh`): rodar `npm run limites:whatsapp` na VPS (parte b de A8), primeiro sem e depois com `--aplicar`, só com o OK do usuário.

### PR 2 — envio idempotente e cron
- Itens, nesta ordem: A7, M1, B1, B2.
- Branch (depois do merge do PR 1): `git fetch origin && git switch -c fix/whatsapp-cron-idempotencia origin/main`
- Título: `WhatsApp: lembrete sem duplicar, cron que não para e falhas que não somem da gaveta`
- Testes: `npm run test:atendys && npm run typecheck && npm run lint`

### PR 3 — ações do painel
- Itens, nesta ordem: B4, M2, M4 (só se a DECISÃO for "a"), B5.
- Branch: `git fetch origin && git switch -c fix/painel-whatsapp-acoes origin/main`
- Título: `Painel: reenvio de conversa sem duplicar, decisão da cota só para quem gere e SAIR no Pix`
- Testes: `npm run test:conversas && npm run typecheck && npm run lint`

### Pedidos ao atendys (fora dos PRs)
- A8(c): `exemptRecipients` por tenant.
- B6: códigos próprios para os três 409 do opt-in.

## Riscos e o que NÃO fazer

- Não edite nada em `/Users/alexandrefonseca/AI/projects/atendys`. O que falta lá vira pedido (A8c, B6).
- Não rode `npm run limites:whatsapp -- --aplicar` sem o OK do usuário: muda o atendys de produção para todos os
  negócios. Rode antes sem `--aplicar` e mostre a lista.
- Não faça deploy nem merge por conta própria. Produção é só a VPS (`scripts/deploy-vps.sh`). Não existe homologação:
  não proponha uma.
- Não apague dados do Firestore, sites gerados, nem a demo (`barbearia-force`).
- A1 depende de A8: não publique A1 sem A8 no mesmo deploy. Sem o limite novo, o 4º aviso do dia ao dono para na cota.
- Com A1, um negócio SEM `ownerPhone` deixa de receber "Responda CONFIRMADO" no self-chat e passa a receber o link do
  painel. Isso é o correto: aquela resposta nunca funcionou. Não "conserte" voltando o pedido de resposta.
- A2: não tire a condição `remetente === dono` do `resposta`. No self-chat não há mensagem recebida no atendys, e
  `replyToInbound` ali volta 403.
- M1: não use a chave em envios que o dono pode repetir de propósito (avisos do painel, Pix): a segunda tentativa
  devolveria a primeira mensagem em vez de mandar de novo. A chave é só dos lembretes.
- M1: a chave do lembrete inclui o horário. Não tire `chaveDoHorario(start)`: sem ele, o lembrete de um horário
  remarcado nunca sairia.
- M3: o `throw` vale só para texto que é ou parece comando. Não lance para toda mensagem do dono: cada "bom dia" com o
  atendys fora viraria "comando descartado" e e-mail de alerta.
- B4: apague só as duas server actions. As funções `arquivarConversa` e `agirNaMensagem` de `src/lib/atendys.ts` ficam.
- `AGENTS.md` avisa que o `next dev` reescreve um bloco no fim do arquivo. Se aparecer diff em `AGENTS.md`, não o
  inclua nos commits deste plano.
- Se um "Trecho atual" não bater exatamente com o arquivo, pare e avise. Não improvise.
