# Plano de correção — agendamento, sinal e Pix (revisão de 10/11/2026)

Repo: `/Users/alexandrefonseca/products/ruphus-site`. Base: `origin/main` (6b966a11).
Todos os achados abaixo foram conferidos no código. Todos existem. Os números de linha valem para 6b966a11.

Regras para quem executa:
- A indentação dos trechos dentro de listas pode ter espaços a mais por causa do markdown: use a indentação que está no arquivo.
- Faça cada troca copiando o "Trecho atual" exato e pondo o "Trecho novo" no lugar (Edit com old_string = trecho atual).
- Se o trecho atual não bater com o arquivo, PARE e avise. Não adapte por conta própria.
- Não mexa em nada fora do que está escrito aqui.
- Testes de emulador precisam do Firebase CLI e Java. Rode sempre o comando indicado em cada item.
- Antes de abrir cada PR, rode também `npm run typecheck` e `npm run lint`.
- Os blocos de teste novos em `booking.test.mts` entram SEMPRE logo antes da linha `console.log("booking ok");` (perto do fim do arquivo), um depois do outro.

---

## PR 1 — Telefone canônico (M1, B2)

### M1 — customerKey sem o 9º dígito
Arquivo(s): `src/lib/datetime.ts:164`
Por quê: `customerKey("(11) 8123-4567")` gera `551181234567`; o mesmo celular com o 9 gera `5511981234567`. São dois clientes e dois contadores de limite para a mesma pessoa. `soDigitosComDDI` (telefone.ts) já acrescenta o 9 com `canonicalBrMobile`; a chave do cliente tem de seguir a mesma regra.

Trecho atual (topo do arquivo, linhas 1–2):
```ts
// Datas, horários e formatação — sem zod, para não entrar no pacote do celular
export const TIMEZONE = "America/Sao_Paulo";
```
Trecho novo:
```ts
// Datas, horários e formatação — sem zod, para não entrar no pacote do celular
import { canonicalBrMobile } from "@/lib/telefone";
export const TIMEZONE = "America/Sao_Paulo";
```

Trecho atual (linhas 163–167):
```ts
/** Telefone só com dígitos e DDI (55 quando vier com 10-11 dígitos). Também é o id do cliente. */
export function customerKey(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return digits.length <= 11 ? `55${digits}` : digits;
}
```
Trecho novo:
```ts
/** Telefone só com dígitos e DDI (55 quando vier com 10-11 dígitos). Também é o id do cliente.
 *  Celular sem o 9º dígito ganha o 9 (canonicalBrMobile, a mesma regra do WhatsApp): o mesmo
 *  celular, digitado com ou sem o 9, é um cliente só e conta um limite só. */
export function customerKey(phone: string) {
  const digits = phone.replace(/\D/g, "");
  return canonicalBrMobile(digits.length <= 11 ? `55${digits}` : digits);
}
```
(Não há import circular: `telefone.ts` não importa nada.)

Outros pontos a tocar:
1. `src/app/[tenant]/page.tsx:37-53` — o link do nome do cliente na agenda recalcula a chave pelo telefone. Agendamento antigo (gravado com a chave sem o 9) passaria a apontar para uma ficha vazia. Usar a chave gravada no agendamento.
   Trecho atual (linhas 46–47):
   ```ts
     customerPhone: z.string(),
     planId: z.string().optional(),
   ```
   Trecho novo:
   ```ts
     customerPhone: z.string(),
     // a chave gravada na reserva: a ficha antiga (sem o 9º dígito) continua achando o cliente
     customerKey: z.string().optional(),
     planId: z.string().optional(),
   ```
   Trecho atual (linha 365):
   ```tsx
                     <Link href={`/${tenant.id}/clientes/${customerKey(a.customerPhone)}`} className="text-base font-semibold underline-offset-4 hover:underline">
   ```
   Trecho novo:
   ```tsx
                     <Link href={`/${tenant.id}/clientes/${a.customerKey ?? customerKey(a.customerPhone)}`} className="text-base font-semibold underline-offset-4 hover:underline">
   ```
   ATENÇÃO: o trecho `customerPhone: z.string(),\n  planId: z.string().optional(),` pode aparecer em outro schema do mesmo arquivo. Se o Edit reclamar de duplicado, use mais contexto (a linha `customerName: z.string(),` acima).
2. Script novo de relatório/migração: `scripts/migrar-chave-cliente.mts` (arquivo inteiro abaixo).
3. `scripts/diagnostico-limites.ts:19` repete a regra antiga — é one-off de suporte; NÃO mexer.

Script novo `scripts/migrar-chave-cliente.mts`:
```ts
#!/usr/bin/env -S npx tsx
/** Clientes gravados com celular sem o 9º dígito (55+DDD+8 dígitos) passam para a chave
 *  canônica, com o 9 (a mesma de customerKey desde a correção M1).
 *
 *   npx tsx --env-file=.env.local scripts/migrar-chave-cliente.mts            # só relatório
 *   npx tsx --env-file=.env.local scripts/migrar-chave-cliente.mts --aplicar  # migra
 *
 * Migra só quem não tem par: se a chave com o 9 já existe (a pessoa marcou dos dois jeitos),
 * o script NÃO junta — lista como DUPLICADO para o dono decidir na mão.
 * Idempotente: a cópia leva "migradoDe"; rodar de novo depois de uma queda termina o que
 * faltou, e um cliente já migrado não aparece mais (a chave antiga deixa de existir). */
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { canonicalBrMobile } from "@/lib/telefone";

async function main() {
  const app =
    getApps()[0] ??
    initializeApp({
      credential: process.env.FIREBASE_SERVICE_ACCOUNT ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)) : applicationDefault(),
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    });
  const db = getFirestore(app);
  const aplicar = process.argv.includes("--aplicar");
  let migrar = 0;
  let duplicados = 0;
  for (const c of (await db.collectionGroup("customers").get()).docs) {
    const tenant = c.ref.parent.parent;
    if (!tenant || tenant.parent.id !== "tenants") continue;
    const nova = canonicalBrMobile(c.id);
    if (nova === c.id) continue;
    const destino = tenant.collection("customers").doc(nova);
    const ja = await destino.get();
    if (ja.exists && ja.get("migradoDe") !== c.id) {
      duplicados++;
      console.log(`DUPLICADO ${tenant.id}: ${c.id} e ${nova} — não mexi; juntar à mão`);
      continue;
    }
    migrar++;
    console.log(`${aplicar ? "migrando" : "migraria"} ${tenant.id}: ${c.id} -> ${nova}`);
    if (!aplicar) continue;
    const bw = db.bulkWriter();
    for (const col of ["appointments", "plans", "lancamentos"]) {
      for (const d of (await tenant.collection(col).where("customerKey", "==", c.id).get()).docs) bw.update(d.ref, { customerKey: nova });
    }
    for (const n of (await c.ref.collection("notas").get()).docs) bw.set(destino.collection("notas").doc(n.id), n.data());
    bw.set(destino, { ...c.data(), migradoDe: c.id });
    await bw.close();
    await db.recursiveDelete(c.ref); // só depois de tudo copiado
  }
  console.log(`${aplicar ? "migrados" : "a migrar"}: ${migrar}; duplicados (não mexidos): ${duplicados}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
```

DECISÃO DO USUÁRIO: rodar o script com `--aplicar` em produção, ou só o relatório.
Recomendação: rodar só o relatório primeiro. A memória do projeto diz 0 clientes reais em 06/11/2026; se o relatório vier vazio (ou só com dados de teste), não precisa aplicar. Duplicados NUNCA são mesclados automaticamente (mesclar duas fichas mistura anotações e etiquetas; é decisão do dono).

Teste: `booking.test.mts` — bloco novo (antes de `console.log("booking ok");`):
```ts
// M1: celular antigo (sem o 9) tem a mesma chave do número com o 9, no cliente e no limite
{
  assert.equal(customerKey("(11) 8123-4567"), "5511981234567");
  assert.equal(customerKey("551181234567"), "5511981234567");
  assert.equal(customerKey("(11) 3333-4444"), "551133334444", "fixo fica como está");
  await t.collection("staff").doc("m1-prof").set({ name: "Edu", serviceIds: ["corte"], hours, active: true });
  const r = await book(db, { tenantId: "salao", staffId: "m1-prof", serviceIds: ["corte"], date: addDays(todayIn(), 41), time: "09:00", customerName: "Gil", customerPhone: "(11) 8123-4567" });
  assert.ok(r.ok);
  assert.equal((await t.collection("customers").doc("5511981234567").get()).exists, true, "cadastro na chave com o 9");
}
```
Comando: `npm run test:booking` e `npm run test:clientes`.
Teste do script (manual, no emulador): com `firebase emulators:start --only firestore --project demo-siteflow` aberto, em outro terminal criar `tenants/x/customers/551181234567` (com uma nota) e um `tenants/x/appointments/a1` com `customerKey: "551181234567"`; rodar `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-siteflow npx tsx scripts/migrar-chave-cliente.mts` (deve listar "migraria"), depois com `--aplicar` (cliente e nota em `5511981234567`, `a1.customerKey` trocado, chave antiga apagada), depois de novo com `--aplicar` (não lista nada).

Critério de pronto: `customerKey` com e sem o 9 devolve a mesma chave; `test:booking` e `test:clientes` verdes; o script, sem `--aplicar`, não grava nada (só imprime).

### B2 — BookingInput aceita 12–13 dígitos sem 55
Arquivo(s): `src/lib/scheduling.ts:102`
Por quê: `/^\d{10,13}$/` deixa passar `123456789012` (12 dígitos sem DDI), que vira uma chave de cliente sem sentido. `telefoneBrValido` (telefone.ts) aceita só 10–11 dígitos ou 55 + 10–11.

Trecho atual (linhas 1–2):
```ts
import { z } from "zod";
import { phoneError, TIPOS_PRECO } from "@/lib/datetime";
```
Trecho novo:
```ts
import { z } from "zod";
import { phoneError, TIPOS_PRECO } from "@/lib/datetime";
import { telefoneBrValido } from "@/lib/telefone";
```
Trecho atual (linhas 101–102):
```ts
    .regex(/^[\d\s()+-]{8,20}$/, "Informe um telefone válido")
    .refine((p) => /^\d{10,13}$/.test(p.replace(/\D/g, "")), "Informe o telefone com DDD")
```
Trecho novo:
```ts
    .regex(/^[\d\s()+-]{8,20}$/, "Informe um telefone válido")
    // DDD + número, com ou sem o 55: 12-13 dígitos sem o 55 não são telefone do Brasil
    .refine(telefoneBrValido, "Informe o telefone com DDD")
```
Outros pontos a tocar: nenhum (`PlanInput` usa o mesmo campo e herda a regra).
Teste: `booking.test.mts`, logo depois da linha 48 (`assert.ok(!phoneOk("--------") ...`), acrescentar:
```ts
assert.ok(!phoneOk("123456789012") && !phoneOk("1191234567890"), "12-13 dígitos sem o 55");
assert.ok(phoneOk("5511912345678") && phoneOk("551133334444"), "com o 55 continua valendo");
```
Comando: `npm run test:booking`.
Critério de pronto: os dois asserts passam e o resto do `test:booking` continua verde.

---

## PR 2 — Cron do sinal (B5, M2, M3)

Faça B5 primeiro (os testes de M2 e M3 usam `depois()`).

### B5 — `depois` calculado uma vez no teste do sinal
Arquivo(s): `sinal.test.mts:62`
Por quê: `depois` fica fixo; reservas feitas segundos depois têm prazo maior que ele. Se o teste demorar mais de 1 minuto até a linha 131, `r7` não vence e o teste falha à toa.
Trecho atual:
```ts
const depois = new Date(Date.now() + 31 * 60_000);
```
Trecho novo:
```ts
// recalculado a cada uso: reservas feitas depois têm prazo depois
const depois = () => new Date(Date.now() + 31 * 60_000);
```
Outros pontos a tocar: trocar `depois` por `depois()` nas 4 chamadas: linhas 63, 69, 75 e 131 (`expirarSinais(db, depois)` → `expirarSinais(db, depois())`).
Teste: o próprio arquivo. Comando: `npm run test:sinal`.
Critério de pronto: `grep -n "depois)" sinal.test.mts` não acha nada; `test:sinal` verde.

### M2 — Reserva em cima da hora é cancelada quando o cliente chega
Arquivo(s): `src/lib/booking.server.ts:598`, `src/lib/sinal.server.ts:64-74`
Por quê: `prazoDoSinal` limita o prazo ao início do horário; reserva feita a menos de `prazoMin` do início tem prazo = início, e o cron cancela o horário na hora em que o cliente chega.
Escolha: o cron não cancela depois do início — marca o sinal "vencido" e deixa o horário marcado. É a opção mais segura porque nunca tira da agenda alguém que já pode estar no salão, e o teto em "início − margem" geraria prazo no passado para reserva feita em cima da hora (cancelamento imediato).

Arquivo `src/lib/sinal.server.ts`.
Trecho atual (linha 4):
```ts
import { todayIn } from "@/lib/datetime";
```
Trecho novo:
```ts
import { instanteReal, todayIn } from "@/lib/datetime";
```
Trecho atual (linhas 64–74):
```ts
    const ok = await db.runTransaction(async (tx) => {
      const a = await tx.get(d.ref);
      if (a.get("sinal.status") !== "pendente") return false;
      // confirmado na mão, cancelado ou faltou: o sinal deixa de ser esperado e sai da consulta
      if (a.get("status") !== "booked") {
        tx.update(d.ref, { "sinal.status": a.get("status") === "confirmed" ? "dispensado" : "vencido" });
        return false;
      }
      const historico = d.ref.parent.parent!.collection("history").doc();
```
Trecho novo:
```ts
    const ok = await db.runTransaction(async (tx) => {
      const [a, negocio] = await tx.getAll(d.ref, d.ref.parent.parent!);
      if (a.get("sinal.status") !== "pendente") return false;
      // confirmado na mão, cancelado ou faltou: o sinal deixa de ser esperado e sai da consulta
      if (a.get("status") !== "booked") {
        tx.update(d.ref, { "sinal.status": a.get("status") === "confirmed" ? "dispensado" : "vencido" });
        return false;
      }
      // o horário já começou (reserva em cima da hora: o prazo foi até o início): o cliente pode
      // estar chegando. Não cancela; o sinal fica "não pago" e o salão decide no balcão
      if (instanteReal((a.get("start") as Timestamp).toDate(), negocio.get("site")) <= agora) {
        tx.update(d.ref, { "sinal.status": "vencido" });
        return false;
      }
      const historico = d.ref.parent.parent!.collection("history").doc();
```
(`Timestamp` já é importado no arquivo. `start` é hora de parede de Brasília; `instanteReal` converte para o instante real no fuso do negócio, como o prazo.)

Outros pontos a tocar:
1. `src/lib/sinal.server.ts:20` — o salão tem de poder registrar o sinal pago no balcão depois disso. Trecho atual:
   ```ts
    if (a.get("sinal.status") !== "pendente") throw new UserError("Este agendamento não tem sinal a confirmar.");
   ```
   Trecho novo (já inclui o "erro" do M3):
   ```ts
    // vencido com o horário ainda marcado (o cliente chegou) e erro do cron: o salão ainda registra
    if (!["pendente", "vencido", "erro"].includes(a.get("sinal.status"))) throw new UserError("Este agendamento não tem sinal a confirmar.");
   ```
   (Cancelado continua recusado pela linha seguinte, que confere `status`.)
2. `src/app/[tenant]/page.tsx:392` — o botão "Sinal recebido". Trecho atual:
   ```tsx
                  {a.sinal?.status === "pendente" && ATIVO(a) && tenant.podeGerir && (
   ```
   Trecho novo:
   ```tsx
                  {(a.sinal?.status === "pendente" || a.sinal?.status === "vencido" || a.sinal?.status === "erro") && ATIVO(a) && tenant.podeGerir && (
   ```
3. `src/app/[tenant]/page.tsx:380` — aviso para o dono. Trecho atual:
   ```tsx
                    {a.sinal?.status === "pago" && <span className="rounded-full border px-2.5 py-0.5 text-xs">Sinal pago · {brl(a.sinal.cents)}</span>}
   ```
   Trecho novo:
   ```tsx
                    {a.sinal?.status === "pago" && <span className="rounded-full border px-2.5 py-0.5 text-xs">Sinal pago · {brl(a.sinal.cents)}</span>}
                    {a.sinal?.status === "vencido" && ATIVO(a) && <span className="rounded-full border px-2.5 py-0.5 text-xs">Sinal não pago · {brl(a.sinal.cents)}</span>}
   ```
4. `src/lib/booking.server.ts:598` (`prazoDoSinal`) — NÃO mexer.

Teste: `sinal.test.mts`, bloco novo logo antes de `console.log("sinal ok");`:
```ts
// M2: reserva em cima da hora (prazo = início): depois do início o cron não cancela
const r8 = await book(db, { ...base, date: addDays(date, 2), time: "09:00", customerPhone: "11 91616-1616" });
assert.ok(r8.ok && r8.sinal);
const a8 = t.collection("appointments").doc(r8.id!);
const inicio8 = new Date(Date.now() - 60_000);
await a8.update({ start: inicio8, "sinal.ate": inicio8 });
await expirarSinais(db, new Date());
assert.equal((await a8.get()).get("status"), "booked", "não cancela quem está chegando");
assert.equal((await a8.get()).get("sinal.status"), "vencido");
await confirmarSinal(db, "sinal-salao", r8.id!, { uid: "owner" });
assert.equal((await a8.get()).get("sinal.status"), "pago", "o salão registra o sinal pago no balcão");
```
Comando: `npm run test:sinal` e `npm run test:sinal-puro`.
Critério de pronto: o bloco passa; os casos antigos (linhas 59–69: prazo vencido antes do início cancela) continuam verdes.

### M3 — Erro passageiro no cron grava "erro" para sempre
Arquivo(s): `src/lib/sinal.server.ts:76-80`, `src/lib/sinal.ts:22`
Por quê: uma falha de rede ou disputa numa rodada tira o agendamento da consulta para sempre, e o "Sinal recebido" passa a ser recusado.

Trecho atual (`src/lib/sinal.server.ts`, linhas 9–10):
```ts
/** Id do lançamento do sinal no Caixa: um por agendamento, sem repetir. */
export const idDoSinal = (appointmentId: string) => `sn-${appointmentId}`;
```
Trecho novo:
```ts
/** Id do lançamento do sinal no Caixa: um por agendamento, sem repetir. */
export const idDoSinal = (appointmentId: string) => `sn-${appointmentId}`;

/** Rodadas do cron que podem falhar no mesmo agendamento antes de ele sair da consulta. */
const TENTATIVAS_SINAL = 3;
```
Trecho atual (linhas 76–80):
```ts
    }).catch(async (e) => {
      console.error("[sinal] expirar", d.ref.path, e);
      // tira da consulta: um documento que sempre falha não pode ocupar a rodada inteira
      await d.ref.update({ "sinal.status": "erro" }).catch(() => undefined);
      return false;
```
Trecho novo:
```ts
    }).catch(async (e) => {
      console.error("[sinal] expirar", d.ref.path, e);
      // erro passageiro tenta de novo na próxima rodada; só depois de TENTATIVAS_SINAL falhas
      // sai da consulta (um documento que sempre falha não pode ocupar todas as rodadas)
      const tentativas = (Number(d.get("sinal.tentativas")) || 0) + 1;
      await d.ref
        .update(tentativas >= TENTATIVAS_SINAL ? { "sinal.status": "erro", "sinal.tentativas": tentativas } : { "sinal.tentativas": tentativas })
        .catch(() => undefined);
      return false;
```
Trecho atual (`src/lib/sinal.ts:22`):
```ts
export type SinalDoAgendamento = { cents: number; status: "pendente" | "pago" | "vencido" | "dispensado" | "erro"; ate: Date; hora: string; txid: string; pix: { chave: string; nome: string; cidade: string } };
```
Trecho novo:
```ts
// tentativas: rodadas do cron que falharam neste agendamento (só o cron grava)
export type SinalDoAgendamento = { cents: number; status: "pendente" | "pago" | "vencido" | "dispensado" | "erro"; ate: Date; hora: string; txid: string; pix: { chave: string; nome: string; cidade: string }; tentativas?: number };
```
Outros pontos a tocar: `confirmarSinal` aceitar "erro" — já feito no item 1 do M2; o botão — item 2 do M2.
Teste: `sinal.test.mts`, bloco novo depois do bloco do M2 (antes de `console.log("sinal ok");`):
```ts
// M3: erro passageiro no cron tenta de novo; só desiste depois de 3 falhas, e o salão ainda confirma
const r9 = await book(db, { ...base, date: addDays(date, 2), time: "09:30", customerPhone: "11 91717-1717" });
assert.ok(r9.ok && r9.sinal);
const a9 = t.collection("appointments").doc(r9.id!);
const transacao = db.runTransaction.bind(db);
db.runTransaction = (async () => { throw new Error("passageiro"); }) as typeof db.runTransaction;
await expirarSinais(db, depois());
assert.deepEqual([(await a9.get()).get("sinal.status"), (await a9.get()).get("sinal.tentativas")], ["pendente", 1], "uma falha não desiste");
await expirarSinais(db, depois());
await expirarSinais(db, depois());
db.runTransaction = transacao;
assert.equal((await a9.get()).get("sinal.status"), "erro", "três falhas: sai da consulta");
await confirmarSinal(db, "sinal-salao", r9.id!, { uid: "owner" });
assert.equal((await a9.get()).get("sinal.status"), "pago", "erro ainda aceita o Sinal recebido");
```
Comando: `npm run test:sinal`.
Critério de pronto: o bloco passa; `grep -n '"sinal.status": "erro"' src/lib/sinal.server.ts` mostra só a linha com `tentativas >= TENTATIVAS_SINAL`.

---

## PR 3 — Painel e fuso (M4, B1, B3, B6, B7, B8)

### M4 — Remarcação do painel exige serviço/profissional ativos
Arquivo(s): `src/lib/booking.server.ts:243-245` (slotContext), `:720-726` (rescheduleContext), `:728-730` (rescheduleSlots), `:734-737` (reschedule); `src/app/[tenant]/actions.ts:49` e `:98`
Por quê: "ativo" é "no link" (serviço "Oculto", profissional "Fora do link"). Tirar do link não pode impedir o dono de remarcar um horário que já existe: hoje dá "Agendamento, serviço ou profissional indisponível.".

Trecho atual (linhas 234–246):
```ts
// excludeId: ao remarcar, o próprio agendamento não conta como ocupado
async function slotContext(tx: Transaction, db: Firestore, q: SlotQuery, excludeId?: string) {
```
Trecho novo:
```ts
// excludeId: ao remarcar, o próprio agendamento não conta como ocupado
// exigirAtivo: o link público (e o cliente pelo WhatsApp) só vê o que está no link; o painel
// remarca mesmo com o serviço oculto ou o profissional fora do link
async function slotContext(tx: Transaction, db: Firestore, q: SlotQuery, excludeId?: string, exigirAtivo = true) {
```
Trecho atual (linhas 241–246):
```ts
  if (
    !staff.success ||
    !staff.data.active ||
    !q.serviceIds.every((id) => staff.data.serviceIds.includes(id)) ||
    services.some((s) => !s.success || !s.data.active)
  ) {
```
Trecho novo:
```ts
  if (
    !staff.success ||
    (exigirAtivo && !staff.data.active) ||
    !q.serviceIds.every((id) => staff.data.serviceIds.includes(id)) ||
    services.some((s) => !s.success || (exigirAtivo && !s.data.active))
  ) {
```
Trecho atual (linhas 720–730):
```ts
async function rescheduleContext(tx: Transaction, db: Firestore, q: Omit<RescheduleInput, "time">) {
  const ref = db.doc(`tenants/${q.tenantId}/appointments/${q.appointmentId}`);
  const appt = await tx.get(ref);
  if (!appt.exists || !["booked", "confirmed"].includes(appt.get("status"))) return null;
  const query = { tenantId: q.tenantId, serviceIds: appt.get("serviceIds") as string[], staffId: appt.get("staffId") as string, date: q.date };
  const ctx = await slotContext(tx, db, query, q.appointmentId);
  return ctx && { ...ctx, ref, appt };
}

export async function rescheduleSlots(db: Firestore, q: Omit<RescheduleInput, "time">) {
  return db.runTransaction(async (tx) => (await rescheduleContext(tx, db, q))?.slots ?? [], { readOnly: true });
}
```
Trecho novo:
```ts
async function rescheduleContext(tx: Transaction, db: Firestore, q: Omit<RescheduleInput, "time">, exigirAtivo = true) {
  const ref = db.doc(`tenants/${q.tenantId}/appointments/${q.appointmentId}`);
  const appt = await tx.get(ref);
  if (!appt.exists || !["booked", "confirmed"].includes(appt.get("status"))) return null;
  const query = { tenantId: q.tenantId, serviceIds: appt.get("serviceIds") as string[], staffId: appt.get("staffId") as string, date: q.date };
  const ctx = await slotContext(tx, db, query, q.appointmentId, exigirAtivo);
  return ctx && { ...ctx, ref, appt };
}

/** exigirAtivo: false no painel (remarca com serviço oculto ou profissional fora do link). */
export async function rescheduleSlots(db: Firestore, q: Omit<RescheduleInput, "time">, exigirAtivo = true) {
  return db.runTransaction(async (tx) => (await rescheduleContext(tx, db, q, exigirAtivo))?.slots ?? [], { readOnly: true });
}
```
Trecho atual (linhas 732–737):
```ts
/** opcoes.manterStatus: remarcação pelo cliente (WhatsApp) não desfaz a confirmação do dono.
 *  opcoes.esperado: o horário que o cliente viu; se mudou até a transação, não remarca. */
export async function reschedule(db: Firestore, input: RescheduleInput, actor: Actor, opcoes: { manterStatus?: boolean; esperado?: Date } = {}) {
  const preso = await profissionalDaConta(db, input.tenantId, actor.uid);
  return contended(() => db.runTransaction(async (tx) => {
    const ctx = await rescheduleContext(tx, db, input);
```
Trecho novo:
```ts
/** opcoes.manterStatus: remarcação pelo cliente (WhatsApp) não desfaz a confirmação do dono.
 *  opcoes.esperado: o horário que o cliente viu; se mudou até a transação, não remarca.
 *  opcoes.exigirAtivo: false no painel (remarca com serviço oculto ou profissional fora do link). */
export async function reschedule(db: Firestore, input: RescheduleInput, actor: Actor, opcoes: { manterStatus?: boolean; esperado?: Date; exigirAtivo?: boolean } = {}) {
  const preso = await profissionalDaConta(db, input.tenantId, actor.uid);
  return contended(() => db.runTransaction(async (tx) => {
    const ctx = await rescheduleContext(tx, db, input, opcoes.exigirAtivo ?? true);
```
Outros pontos a tocar:
1. `src/app/[tenant]/actions.ts:49` — trecho atual:
   ```ts
    return { ok: true as const, slots: await rescheduleSlots(adminDb, q.data) };
   ```
   trecho novo:
   ```ts
    return { ok: true as const, slots: await rescheduleSlots(adminDb, q.data, false) };
   ```
2. `src/app/[tenant]/actions.ts:98` — trecho atual:
   ```ts
export const rescheduleAppointment = memberAction(RescheduleInput, (data, user) => reschedule(adminDb, data, user));
   ```
   trecho novo:
   ```ts
// painel: remarca mesmo com o serviço oculto ou o profissional fora do link
export const rescheduleAppointment = memberAction(RescheduleInput, (data, user) => reschedule(adminDb, data, user, { exigirAtivo: false }));
   ```
3. `src/lib/botoes-whatsapp.server.ts:44` e `:189` (cliente pelo WhatsApp) — NÃO mexer: continuam com o padrão `true`.
4. `availableSlots` e `book` (link público) — NÃO mexer: usam o padrão `true`.
5. `createPlan` / `criarPlano` (`booking.server.ts:625` e `:634`) — NÃO mexer neste PR. Motivo: o formulário do plano (`plan-form.tsx:69-70`) só oferece serviços e profissionais ativos e busca a grade em `getAgenda` (agenda pública, só o que está no link). Afrouxar só o servidor não muda nada para o dono.
   DECISÃO DO USUÁRIO: o plano/agendamento novo pelo painel deve poder usar serviço oculto e profissional fora do link? Se sim, é outra tarefa (formulário + grade + servidor), fora deste plano.

DECISÃO DO USUÁRIO: a remarcação que o próprio cliente faz pelo WhatsApp deve continuar exigindo serviço/profissional no link (padrão deste plano) ou seguir o painel? O plano mantém exigindo (mais conservador: o cliente não marca com quem saiu do link).

Teste: `booking.test.mts`, bloco novo (antes de `console.log("booking ok");`):
```ts
// M4: serviço oculto ou profissional fora do link: o painel remarca; o link e o WhatsApp não
{
  await t.collection("services").doc("m4-servico").set({ name: "Escova", durationMin: 30, priceCents: 4000, active: true });
  await t.collection("staff").doc("m4-prof").set({ name: "Duda", serviceIds: ["m4-servico"], hours, active: true });
  const dia = addDays(todayIn(), 40);
  const r = await book(db, { tenantId: "salao", staffId: "m4-prof", serviceIds: ["m4-servico"], date: dia, time: "09:00", customerName: "Clara", customerPhone: "11 95432-1000" });
  assert.ok(r.ok);
  await t.collection("services").doc("m4-servico").update({ active: false });
  await t.collection("staff").doc("m4-prof").update({ active: false });
  const q = { tenantId: "salao", appointmentId: r.id!, date: dia };
  assert.deepEqual(await rescheduleSlots(db, q), [], "padrão (WhatsApp): exige o que está no link");
  assert.ok((await rescheduleSlots(db, q, false)).includes("10:00"), "painel vê os horários");
  assert.equal((await reschedule(db, { ...q, time: "10:00" }, actor)).ok, false);
  assert.equal((await reschedule(db, { ...q, time: "10:00" }, actor, { exigirAtivo: false })).ok, true, "painel remarca");
  assert.deepEqual(await availableSlots(db, { tenantId: "salao", staffId: "m4-prof", serviceIds: ["m4-servico"], date: dia }), [], "o link continua sem eles");
}
```
Comando: `npm run test:booking`.
Critério de pronto: o bloco passa; `grep -n "exigirAtivo" src/app/\[tenant\]/actions.ts` mostra as duas chamadas com `false`; `botoes-whatsapp.server.ts` sem diff.

### B1 — Excluir profissional com horário futuro ou plano ativo
Arquivo(s): `src/app/[tenant]/actions.ts:169-173`, `src/lib/booking.server.ts` (função nova)
Por quê: excluir o profissional deixa horários marcados apontando para ninguém (o cliente chega e não está na agenda de ninguém). `deleteCustomer` já recusa nesse caso; aplicar a mesma regra.

Função nova em `src/lib/booking.server.ts`, logo DEPOIS do fim de `deleteCustomer` (depois da linha 189, `}` que fecha a função, antes do comentário `/** Papel de dono ou admin do negócio`):
```ts

/** Excluir profissional com horário marcado ou plano ativo deixaria o cliente chegar ao salão
 *  sem estar na agenda de ninguém: como no cliente, encerrar/cancelar primeiro. */
export async function exigeProfissionalSemCompromisso(db: Firestore, tenantId: string, staffId: string) {
  const t = db.collection("tenants").doc(tenantId);
  const [futuros, planos] = await Promise.all([
    t.collection("appointments").where("staffId", "==", staffId).where("start", ">", new Date()).get(),
    t.collection("plans").where("staffId", "==", staffId).where("status", "==", "active").limit(1).get(),
  ]);
  if (!planos.empty) throw new UserError("Encerre os planos recorrentes deste profissional antes de excluir.");
  if (futuros.docs.some((d) => ["booked", "confirmed"].includes(d.get("status")))) {
    throw new UserError("Este profissional tem horário marcado. Remarque ou cancele antes de excluir.");
  }
}
```
(O índice `appointments (staffId, start)` já existe em `firestore.indexes.json`. A consulta de `plans` só tem igualdades e não precisa de índice composto.)

Trecho atual (`src/app/[tenant]/actions.ts:5`):
```ts
import { createPlan, deleteCustomer, endPlan, profissionalDaConta, renameCustomer, requireMember, reschedule, rescheduleSlots, salvarDadosCliente, UserError } from "@/lib/booking.server";
```
Trecho novo:
```ts
import { createPlan, deleteCustomer, endPlan, exigeProfissionalSemCompromisso, profissionalDaConta, renameCustomer, requireMember, reschedule, rescheduleSlots, salvarDadosCliente, UserError } from "@/lib/booking.server";
```
Trecho atual (`actions.ts:169-171`):
```ts
export const excluirProfissionalAction = memberAction(z.object({ tenantId: docIdStaff, staffId: docId }), async (data, user) => {
  await exigeGestor(data.tenantId, user.uid);
  await tirarAcessosDoProfissional(adminDb, data.tenantId, data.staffId);
```
Trecho novo:
```ts
export const excluirProfissionalAction = memberAction(z.object({ tenantId: docIdStaff, staffId: docId }), async (data, user) => {
  await exigeGestor(data.tenantId, user.uid);
  // antes de tirar os acessos: recusado, nada muda
  await exigeProfissionalSemCompromisso(adminDb, data.tenantId, data.staffId);
  await tirarAcessosDoProfissional(adminDb, data.tenantId, data.staffId);
```
Outros pontos a tocar: nenhum. `profissionais/page.tsx:334` já trata `{ ok: false, error }` (o `memberAction` devolve a mensagem do `UserError`). Confirmar lendo as linhas 330–340; se a tela não mostrar `r.error`, PARE e avise.
Teste: `booking.test.mts` — acrescentar `exigeProfissionalSemCompromisso` ao import da linha 7 (lista em ordem alfabética, entre `endPlan` e `LIMITS`) e o bloco novo:
```ts
// B1: excluir profissional com horário marcado ou plano ativo é recusado
{
  await t.collection("staff").doc("b1-prof").set({ name: "Fê", serviceIds: ["corte"], hours, active: true });
  const r = await book(db, { tenantId: "salao", staffId: "b1-prof", serviceIds: ["corte"], date: addDays(todayIn(), 42), time: "09:00", customerName: "Iara", customerPhone: "11 95432-3000" });
  assert.ok(r.ok);
  await assert.rejects(exigeProfissionalSemCompromisso(db, "salao", "b1-prof"), /horário marcado/);
  await t.collection("appointments").doc(r.id!).update({ status: "cancelled" });
  await exigeProfissionalSemCompromisso(db, "salao", "b1-prof"); // sem compromisso: passa
  await t.collection("plans").doc("b1-plano").set({ staffId: "b1-prof", status: "active", customerKey: "5511954323000" });
  await assert.rejects(exigeProfissionalSemCompromisso(db, "salao", "b1-prof"), /planos recorrentes/);
  await t.collection("plans").doc("b1-plano").update({ status: "ended" });
}
```
Comando: `npm run test:booking`.
Critério de pronto: o bloco passa; na action, a checagem vem antes de `tirarAcessosDoProfissional`.

### B3 — "Já passou" com o relógio de Brasília em vez do fuso do negócio
Arquivo(s): `src/lib/booking.server.ts:392` (limitError), `:706` (endPlan), `src/app/[tenant]/actions.ts:523`
Por quê: `start` é gravado como hora de parede (convenção de Brasília). Comparar com `new Date()` erra 1–2 h em negócios de outro fuso (Manaus, Acre): limite de horários ativos, plano encerrado que não cancela o horário da próxima hora, aviso recusado como "já passou". `agoraNaParede(fusoDe(site))` é o "agora" na mesma convenção (já usado em `slotContext` e `criarPlano`).

(a) limitError — trecho atual (linhas 366–372):
```ts
/** Conta e valida limites do dia. Devolve a mensagem quando estourou. */
async function limitError(
  tx: Transaction,
  t: FirebaseFirestore.DocumentReference,
  input: BookingInput,
  ip: string | undefined,
) {
```
Trecho novo:
```ts
/** Conta e valida limites do dia. Devolve a mensagem quando estourou.
 *  agora: hora de parede do negócio (agoraNaParede), a mesma convenção do "start" gravado. */
async function limitError(
  tx: Transaction,
  t: FirebaseFirestore.DocumentReference,
  input: BookingInput,
  ip: string | undefined,
  agora: Date,
) {
```
Trecho atual (linha 392):
```ts
    t.collection("appointments").where("customerKey", "==", key).where("start", ">", new Date()),
```
Trecho novo:
```ts
    t.collection("appointments").where("customerKey", "==", key).where("start", ">", agora),
```
Trecho atual (chamada, linha 567):
```ts
    const limit = await limitError(tx, livre.ctx.t, input, ip);
```
Trecho novo:
```ts
    const limit = await limitError(tx, livre.ctx.t, input, ip, agoraNaParede(livre.ctx.cfg.fuso));
```
(b) endPlan — trecho atual (linhas 701–706):
```ts
    const plan = await tx.get(t.collection("plans").doc(input.planId));
    if (!plan.exists || plan.get("status") !== "active") return { ok: false as const, error: "Plano não encontrado ou já encerrado." };
    // "Qualquer um" espalha semanas por outros profissionais: encerrar cancelaria horários deles
    if (preso && (plan.get("staffId") !== preso || plan.get("qualquer"))) return { ok: false as const, error: "Esse plano é de outro profissional: só quem gere o negócio encerra." };
    const future = await tx.get(
      t.collection("appointments").where("planId", "==", input.planId).where("start", ">", new Date()),
```
Trecho novo:
```ts
    const [plan, negocio] = await tx.getAll(t.collection("plans").doc(input.planId), t);
    if (!plan.exists || plan.get("status") !== "active") return { ok: false as const, error: "Plano não encontrado ou já encerrado." };
    // "Qualquer um" espalha semanas por outros profissionais: encerrar cancelaria horários deles
    if (preso && (plan.get("staffId") !== preso || plan.get("qualquer"))) return { ok: false as const, error: "Esse plano é de outro profissional: só quem gere o negócio encerra." };
    const future = await tx.get(
      t.collection("appointments").where("planId", "==", input.planId).where("start", ">", agoraNaParede(fusoDe(negocio.get("site")))),
```
(`agoraNaParede` e `fusoDe` já estão no import da linha 8.)
(c) `src/app/[tenant]/actions.ts` — trecho atual (linha 24):
```ts
import { formatBRL } from "@/lib/datetime";
```
Trecho novo:
```ts
import { agoraNaParede, formatBRL, fusoDe } from "@/lib/datetime";
```
Trecho atual (linha 523):
```ts
    if (start.getTime() < Date.now()) throw new UserError("Esse horário já passou.");
```
Trecho novo:
```ts
    // "start" é hora de parede: compara com o agora do fuso do negócio
    if (start.getTime() < agoraNaParede(fusoDe(tenant.get("site"))).getTime()) throw new UserError("Esse horário já passou.");
```
(`tenant` é o snapshot lido nas linhas 511–515, `const [ag, tenant, preso] = await Promise.all(...)`. Se o nome for outro, PARE e avise.)
Outros pontos a tocar: `renameCustomer` (linha 133) e `deleteCustomer` (linha 179) também usam `new Date()` — NÃO mexer (fora do escopo; erro de 1 h nesses dois só inclui/exclui um horário da próxima hora).
Teste: sem teste novo (os testes usam negócio no fuso de Brasília, onde nada muda; montar Manaus no `endPlan` exigiria fixture nova). Regressão: `npm run test:booking`, `npm run typecheck`.
Critério de pronto: `grep -n 'new Date())' src/lib/booking.server.ts` não mostra mais as linhas do `limitError` nem do `endPlan`; `Date.now()` sumiu da linha do "já passou"; testes verdes.

### B6 — Id do contador com o dia lido depois da reserva
Arquivo(s): `booking.test.mts:348-356`
Por quê: se a meia-noite passar entre a reserva e a leitura, o teste procura o contador do dia seguinte e falha.
Trecho atual (linha 348):
```ts
assert.equal((await book(db, { ...spam, customerPhone: "11 98888-2222", date: addDays(limDate, 13), time: "09:00" }, "203.0.113.5")).ok, true);
```
Trecho novo:
```ts
const diaDoLimite = todayIn(); // antes da reserva: a meia-noite no meio não troca o id do contador
assert.equal((await book(db, { ...spam, customerPhone: "11 98888-2222", date: addDays(limDate, 13), time: "09:00" }, "203.0.113.5")).ok, true);
```
Trecho atual (linhas 355–356):
```ts
assert.equal((await db.doc(`limitesAgenda/phone-5511988882222-${todayIn()}`).get()).get("count"), 1, "conta também fora do negócio");
await db.doc(`limitesAgenda/phone-5511977773333-${todayIn()}`).set({ count: LIMITS.globalPerPhone, day: todayIn() });
```
Trecho novo:
```ts
assert.equal((await db.doc(`limitesAgenda/phone-5511988882222-${diaDoLimite}`).get()).get("count"), 1, "conta também fora do negócio");
await db.doc(`limitesAgenda/phone-5511977773333-${diaDoLimite}`).set({ count: LIMITS.globalPerPhone, day: diaDoLimite });
```
Outros pontos a tocar: nenhum.
Teste: o próprio arquivo. Comando: `npm run test:booking`.
Critério de pronto: `todayIn()` não aparece mais nas linhas 355–356; teste verde.

### B7 — "Hoje" do formulário de plano no fuso de Brasília
Arquivo(s): `src/app/[tenant]/plan-form.tsx:48`
Por quê: num negócio no Acre, entre 22h e 0h de Brasília o formulário já mostra o dia seguinte como "hoje" e bloqueia o dia de hoje no campo de data.
Trecho atual (linha 12):
```ts
import { MAX_DAYS_AHEAD, WEEKDAYS, addDays, datasDoPlano, formatDuration, formatLongDate, formatPhone, planDates, todayIn, weekday, zonedTime, precoDe } from "@/lib/datetime";
```
Trecho novo:
```ts
import { MAX_DAYS_AHEAD, WEEKDAYS, addDays, datasDoPlano, formatDuration, formatLongDate, formatPhone, fusoDe, planDates, todayIn, weekday, zonedTime, precoDe } from "@/lib/datetime";
```
Trecho atual (linha 48):
```ts
  const [hoje] = useState(todayIn);
```
Trecho novo:
```ts
  const [hoje] = useState(() => todayIn(fusoDe(tenant.site)));
```
Outros pontos a tocar: nenhum (`planLabel`, linha 418, fica como está).
Teste: sem teste automatizado (componente de tela). Rodar `npm run typecheck` e `npm run lint`.
Critério de pronto: typecheck e lint sem erro novo.

### B8 — "Cliente nao encontrado." sem acento
Arquivo(s): `src/lib/booking.server.ts:128`, `booking.test.mts:384`
Por quê: texto mostrado ao dono sem acento. O teste compara essa frase — mudar os dois juntos.
Trecho atual (`booking.server.ts:128`):
```ts
  if (!(await cliente.get()).exists) throw new UserError("Cliente nao encontrado.");
```
Trecho novo:
```ts
  if (!(await cliente.get()).exists) throw new UserError("Cliente não encontrado.");
```
Trecho atual (`booking.test.mts:384`):
```ts
    /Cliente nao encontrado/,
```
Trecho novo:
```ts
    /Cliente não encontrado/,
```
Outros pontos a tocar: nenhum (`grep -rn "nao encontrado" src *.test.mts` deve ficar vazio).
Teste: `npm run test:booking`.
Critério de pronto: grep vazio; teste verde.

---

## PR 4 — Txid do Pix (B4)

### B4a — txidLivre só com milissegundos (BAIXO)
Arquivo(s): `src/lib/pix.ts:81-83`
Por quê: duas reservas do mesmo salão no mesmo milissegundo ganham o mesmo txid, e o extrato não distingue os dois pagamentos.
Trecho atual:
```ts
/** Identificador livre para a cobrança do salão (no balcão ou sinal): o que o extrato mostra. */
export const txidLivre = (prefixo: string) =>
  `${prefixo.toUpperCase().replace(/[^A-Z0-9]/g, "")}${Date.now().toString(36).toUpperCase()}`.slice(-25);
```
Trecho novo:
```ts
/** Identificador livre para a cobrança do salão (no balcão ou sinal): o que o extrato mostra.
 *  3 caracteres aleatórios no fim: duas cobranças no mesmo milissegundo não repetem o txid. */
export const txidLivre = (prefixo: string) =>
  `${prefixo.toUpperCase().replace(/[^A-Z0-9]/g, "")}${Date.now().toString(36).toUpperCase()}${Math.random().toString(36).slice(2, 5).toUpperCase().padEnd(3, "0")}`.slice(-25);
```
Outros pontos a tocar: nenhum (`lancamento-folha.tsx:94` roda no navegador; `Math.random` existe lá).
Teste: `pix.test.mts`, depois da linha 77 (`assert.match(tx, /^[A-Z0-9]{1,25}$/);`):
```ts
assert.notEqual(txidLivre("salao-da-ana"), txidLivre("salao-da-ana"), "mesmo milissegundo, txid diferente");
assert.match(txidLivre("s".repeat(40)), /^[A-Z0-9]{25}$/, "slug longo: corta no começo, cabe em 25");
```
Comando: `npm run test:pix`.
Critério de pronto: teste verde.

### B4b — txidDe corta o mês quando o slug é longo (MÉDIO)
Arquivo(s): `src/lib/pix.ts:68-73`, `src/lib/cobranca.ts:139`
Por quê: com slug de 21+ letras, `.slice(0, 25)` no fim corta a marca e o mês: todas as mensalidades do negócio saem com o mesmo txid. A reemissão (cobrança cancelada e emitida de novo, `cobranca.ts:121-122`) também repete o txid da cancelada.
Trecho atual:
```ts
export function txidDe(slug: string, tipo: "entrada" | "mensal", competencia: string | null) {
  const marca = tipo === "entrada" ? "E" : "M";
  const quando = competencia ? competencia.slice(2).replace("-", "") : "";
  const negocio = slug.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return `${negocio}${marca}${quando}`.slice(0, 25);
}
```
Trecho novo:
```ts
export function txidDe(slug: string, tipo: "entrada" | "mensal", competencia: string | null, reemissao = 1) {
  const marca = tipo === "entrada" ? "E" : "M";
  const quando = competencia ? competencia.slice(2).replace("-", "") : "";
  // reemitida (a anterior foi cancelada): outro txid, para o extrato não confundir as duas
  const fim = `${marca}${quando}${reemissao > 1 ? `R${reemissao}` : ""}`;
  // quem cede espaço é o slug: marca, mês e reemissão sempre cabem nos 25
  const negocio = slug.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 25 - fim.length);
  return `${negocio}${fim}`;
}
```
Trecho atual (`src/lib/cobranca.ts:139`):
```ts
      txid: txidDe(a.slug, a.tipo, a.competencia),
```
Trecho novo:
```ts
      txid: txidDe(a.slug, a.tipo, a.competencia, n),
```
(`n` é o contador do `for` da linha 121; n = 1 na primeira emissão, então o txid de quem já tem cobrança não muda.)
Outros pontos a tocar: nenhum. Cobranças já gravadas guardam o txid no documento (`cobranca.ts:177` lê do banco), então nada antigo muda.
Teste: `pix.test.mts`, depois da linha 49:
```ts
const longoTx = txidDe("a".repeat(40), "mensal", "2026-10");
assert.ok(longoTx.endsWith("M2610") && longoTx.length === 25, "slug longo não come o mês");
assert.notEqual(longoTx, txidDe("a".repeat(40), "mensal", "2026-11"), "um mês do outro, mesmo com slug longo");
assert.ok(txidDe("a".repeat(40), "mensal", "2026-10", 2).endsWith("M2610R2"), "reemissão tem txid próprio");
assert.equal(txidDe("acme", "mensal", "2026-10", 1), "ACMEM2610", "primeira emissão igual a antes");
```
Comando: `npm run test:pix` e `npm run test:cobranca` (este confere `"ACMEM2610"` na linha 42 e precisa continuar verde).
Critério de pronto: os dois testes verdes.

---

## Ordem e agrupamento em PRs

Cada PR sai de `origin/main` atualizado (`git fetch origin && git switch -c <branch> origin/main`). Abrir na ordem abaixo; o PR seguinte só começa depois do anterior mergeado (PRs 1 e 3 acrescentam blocos no fim de `booking.test.mts`, e o PR 2 depende de nada, mas manter a ordem evita conflito).

| # | Branch | Título | Itens | Testes |
|---|--------|--------|-------|--------|
| 1 | `fix/agenda-telefone-canonico` | Agenda: celular com e sem o 9 é o mesmo cliente; telefone sem DDI recusado | M1, B2 (+ script `scripts/migrar-chave-cliente.mts`) | `npm run test:booking && npm run test:clientes && npm run typecheck && npm run lint` |
| 2 | `fix/sinal-cron` | Sinal: não cancela quem já está chegando; erro passageiro tenta de novo | B5, M2, M3 | `npm run test:sinal && npm run test:sinal-puro && npm run typecheck && npm run lint` |
| 3 | `fix/agenda-painel-fuso` | Painel: remarca com serviço oculto, não exclui profissional com horário, "agora" no fuso do negócio | M4, B1, B3, B6, B7, B8 | `npm run test:booking && npm run typecheck && npm run lint` |
| 4 | `fix/pix-txid` | Pix: txid não repete no mesmo milissegundo nem perde o mês com slug longo | B4a, B4b | `npm run test:pix && npm run test:cobranca && npm run typecheck` |

Depois do merge do PR 1: rodar o script SÓ em modo relatório (`npx tsx --env-file=.env.local scripts/migrar-chave-cliente.mts`) e levar a saída ao usuário. `--aplicar` só com o "sim" dele.

## Riscos e o que NÃO fazer

- NÃO mudar o formato do id de `appointments`, `plans`, `pedidos` nem dos contadores em `limits`/`limitesAgenda` (só a chave do telefone dentro do id muda, pelo M1).
- NÃO rodar `scripts/migrar-chave-cliente.mts --aplicar` sem antes rodar sem a flag e mostrar a saída ao usuário. Nunca mesclar duplicados no script.
- NÃO apagar dados do CRM, sites gerados nem a demo `barbearia-force` (regra do projeto).
- NÃO mexer em `prazoDoSinal` (`src/lib/sinal.ts:17`) nem no teste da linha 18 de `sinal.test.mts` ("nunca depois do horário" continua valendo).
- NÃO mudar `botoes-whatsapp.server.ts`: a remarcação do cliente pelo WhatsApp continua exigindo o que está no link.
- NÃO afrouxar `criarPlano` (createPlan) neste plano: ver a DECISÃO DO USUÁRIO no M4.
- NÃO trocar `new Date()` em `renameCustomer`/`deleteCustomer` (fora do escopo do B3).
- M1 muda a chave de quem digita celular antigo: até rodar a migração (se o usuário quiser), um cliente antigo que marcar de novo com o mesmo número sem o 9 ganha uma ficha nova (com o 9). A agenda continua abrindo a ficha certa de cada horário (item 1 do M1). É o comportamento esperado.
- M2 deixa o horário marcado com sinal não pago depois do início: o dono vê "Sinal não pago" e decide (cancelar, marcar falta ou receber no balcão).
- Se qualquer teste antigo quebrar, PARE e avise com a saída do teste; não "conserte" o teste antigo.
- Não usar `--no-verify`, não fazer force push, não fazer merge sozinho.
