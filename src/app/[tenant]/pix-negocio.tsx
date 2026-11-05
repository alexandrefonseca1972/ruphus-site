"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatBRL, maskBRL } from "@/lib/datetime";
import { idToken } from "@/lib/firebase";
import { valorDoSinal } from "@/lib/sinal";
import { ConfigSinal, SINAL_PADRAO } from "@/lib/sinal-config";
import { ERRO_CHAVE, ERRO_CIDADE, ERRO_NOME, legivel, normalizarChave, tipoDaChave } from "@/lib/pix";
import { ConfirmDialog } from "./confirm-dialog";
import { cn } from "@/lib/utils";
import { salvarPixAction, salvarSinalAction } from "./actions";
import { useTenant } from "./painel-layout";

/** A chave Pix do salão: com ela, o Caixa mostra o QR com o valor na hora de receber. */
export function PixNegocio({ cidadeSugerida = "" }: { cidadeSugerida?: string }) {
  const tenant = useTenant();
  const inicial = { chave: tenant.pix?.chave ?? "", nome: tenant.pix?.nome ?? "", cidade: tenant.pix?.cidade ?? "" };
  // sem chave ainda: a cidade do negócio já vem preenchida (e isso não conta como alteração)
  const [pix, setPix] = useState(tenant.pix ? inicial : { ...inicial, cidade: cidadeSugerida });
  const [tentou, setTentou] = useState(false);
  const [salvo, setSalvo] = useState(tenant.pix ? inicial : { ...inicial, cidade: cidadeSugerida });
  // sem chave e sem a cidade mexida: a cidade segue a de Dados quando o dono a muda e salva lá
  if (!salvo.chave && pix.cidade === salvo.cidade && pix.cidade !== cidadeSugerida) {
    setPix({ ...pix, cidade: cidadeSugerida });
    setSalvo({ ...salvo, cidade: cidadeSugerida });
  }
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const mudou = pix.chave !== salvo.chave || pix.nome !== salvo.nome || pix.cidade !== salvo.cidade;
  // validação na tela, a mesma do servidor: o dono vê o tipo entendido antes de salvar
  const removendo = !pix.chave.trim();
  const chaveLida = removendo ? null : normalizarChave(pix.chave);
  const erros = removendo
    ? {}
    : {
        chave: chaveLida ? "" : ERRO_CHAVE,
        nome: legivel(pix.nome, 25) ? "" : ERRO_NOME,
        cidade: legivel(pix.cidade, 15) ? "" : ERRO_CIDADE,
      };
  const temErro = Object.values(erros).some(Boolean);
  // chave gravada antes de uma regra nova (ex.: CNPJ com dígito errado): o dono vê já, sem tentar salvar
  const mostrar = tentou || (!!salvo.chave && pix.chave === salvo.chave);
  const [confirmarRemocao, setConfirmarRemocao] = useState(false);
  useAvisoAoSair(mudou);
  const campo = (k: keyof typeof pix) => (e: React.ChangeEvent<HTMLInputElement>) => (setPix({ ...pix, [k]: e.target.value }), setAviso(null));

  async function salvar(confirmado = false) {
    setTentou(true);
    if (temErro) return;
    // tirar a chave também desliga o sinal do agendamento online: pergunta antes
    if (removendo && !confirmado) return setConfirmarRemocao(true);
    setBusy(true);
    setAviso(null);
    const r = await idToken().then((t) => salvarPixAction(t, { tenantId: tenant.id, pix })).catch(() => null);
    setBusy(false);
    if (!r) return setAviso({ ok: false, texto: "Não foi possível salvar. Verifique a conexão e tente de novo." });
    if (!r.ok) return setAviso({ ok: false, texto: r.error });
    // a chave volta como o banco espera (ex.: celular com +55): é a que o QR usa
    const gravado = r.pix ?? { chave: "", nome: "", cidade: "" };
    setPix(gravado);
    setSalvo(gravado);
    // sem chave, o servidor desliga o sinal: a tela do sinal tem que saber
    tenant.atualizar?.({ pix: r.pix ?? undefined, ...(!r.pix && tenant.sinal && { sinal: { ...tenant.sinal, ativo: false } }) });
    setAviso({ ok: true, texto: r.pix ? `Salvo como ${tipoDaChave(r.pix.chave)}. No Caixa, escolha Pix ao receber e toque em "Mostrar QR do Pix".` : "Chave removida. O sinal do agendamento online foi desligado." });
  }

  return (
    <form
      id="pix"
      noValidate
      className="grid scroll-mt-20 gap-4 rounded-2xl border bg-card p-5 sm:p-7 lg:col-start-1"
      onSubmit={(e) => {
        e.preventDefault();
        void salvar();
      }}
    >
      <div className="grid gap-1">
        <h2 className="text-[15px] font-semibold">Pix para receber</h2>
        <p className="text-sm text-muted-foreground">
          Opcional. Com a sua chave, o Caixa mostra o QR com o valor para o cliente pagar na hora. O dinheiro cai direto na sua conta: confira no app do banco antes de dar baixa.
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="pix-chave">Chave Pix</Label>
        <Input id="pix-chave" value={pix.chave} maxLength={100} onChange={campo("chave")} autoComplete="off" spellCheck={false} placeholder="CPF, CNPJ, e-mail, celular ou chave aleatória" aria-invalid={mostrar && !!erros.chave} aria-describedby="pix-chave-msg" className="h-12 bg-card px-3.5 text-base sm:h-11 sm:text-[15px]" />
        {/* a dica muda a cada tecla: sem aria-live, senão o leitor de tela repete tudo */}
        <p id="pix-chave-msg" className={cn("text-xs", mostrar && erros.chave ? "text-destructive" : "text-muted-foreground")}>
          {chaveLida ? `Entendida como ${tipoDaChave(chaveLida)}: ${chaveLida}` : mostrar && erros.chave ? erros.chave : "Celular que também é um CPF válido? Escreva com (DDD) ou +55."}
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="pix-nome">Nome de quem recebe</Label>
          <Input id="pix-nome" value={pix.nome} maxLength={100} onChange={campo("nome")} autoComplete="name" placeholder="Como está no banco" aria-invalid={mostrar && !!erros.nome} aria-describedby="pix-nome-msg" className="h-12 bg-card px-3.5 text-base sm:h-11 sm:text-[15px]" />
          <p id="pix-nome-msg" aria-live="polite" className="min-h-4 text-xs text-destructive">{mostrar ? erros.nome : ""}</p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="pix-cidade">Cidade</Label>
          <Input id="pix-cidade" value={pix.cidade} maxLength={60} onChange={campo("cidade")} autoComplete="address-level2" aria-invalid={mostrar && !!erros.cidade} aria-describedby="pix-cidade-msg" className="h-12 bg-card px-3.5 text-base sm:h-11 sm:text-[15px]" />
          <p id="pix-cidade-msg" aria-live="polite" className="min-h-4 text-xs text-destructive">{mostrar ? erros.cidade : ""}</p>
        </div>
      </div>
      {aviso && (
        <p role={aviso.ok ? "status" : "alert"} className={aviso.ok ? "text-sm text-emerald-700 dark:text-emerald-300" : "text-sm text-destructive"}>
          {aviso.texto}
        </p>
      )}
      <div className="flex items-center justify-end gap-3">
        {mudou && !busy && <span className="text-xs text-muted-foreground">Alterações não salvas</span>}
        {/* sem chave salva, campo vazio não tem o que remover */}
        <Button type="submit" disabled={busy || !mudou || (removendo && !salvo.chave)} className="h-12 px-5 text-[15px] sm:h-11 sm:text-sm">{busy ? "Salvando…" : removendo && salvo.chave ? "Remover chave" : "Salvar Pix"}</Button>
      </div>
      {confirmarRemocao && (
        <ConfirmDialog
          title="Remover a chave Pix?"
          description={`O Caixa deixa de mostrar o QR${tenant.sinal?.ativo ? ", e o agendamento online para de pedir sinal" : ""}. Dá para cadastrar de novo quando quiser.`}
          confirmLabel="Sim, remover"
          onConfirm={() => {
            setConfirmarRemocao(false);
            return salvar(true);
          }}
          onCancel={() => setConfirmarRemocao(false)}
        />
      )}
    </form>
  );
}

/** Sair da página (fechar a aba, recarregar) com alteração não salva: o navegador pergunta. */
function useAvisoAoSair(ativo: boolean) {
  useEffect(() => {
    if (!ativo) return;
    const segura = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", segura);
    return () => window.removeEventListener("beforeunload", segura);
  }, [ativo]);
}

const PRAZOS = [15, 30, 60, 120, 24 * 60];
const rotuloPrazo = (min: number) => (min >= 60 ? `${min / 60} h` : `${min} min`);

/** Sinal no agendamento online: o cliente paga parte por Pix para garantir o horário. */
export function SinalNegocio() {
  const tenant = useTenant();
  const inicial = { ...SINAL_PADRAO, ...ConfigSinal.safeParse(tenant.sinal).data };
  const [sinal, setSinal] = useState(inicial);
  const [valor, setValor] = useState(inicial.tipo === "fixo" ? formatBRL(inicial.valor) : String(inicial.valor));
  const [salvo, setSalvo] = useState(JSON.stringify(inicial));
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  const numero = Number(valor.replace(/\D/g, "")) || 0;
  const atual = { ...sinal, valor: numero };
  const mudou = JSON.stringify(atual) !== salvo;
  // o servidor mudou o sinal por fora (remover a chave Pix desliga): a tela segue o contexto,
  // senão "Pedir sinal" fica marcado aqui e desligado lá. Edição em andamento não é apagada
  const [visto, setVisto] = useState(JSON.stringify(tenant.sinal ?? null));
  if (JSON.stringify(tenant.sinal ?? null) !== visto) {
    setVisto(JSON.stringify(tenant.sinal ?? null));
    if (!mudou) {
      setSinal(inicial);
      setValor(inicial.tipo === "fixo" ? formatBRL(inicial.valor) : String(inicial.valor));
      setSalvo(JSON.stringify(inicial));
    }
  }
  const muda = (p: Partial<typeof sinal>) => (setSinal({ ...sinal, ...p }), setAviso(null));
  useAvisoAoSair(mudou && !!tenant.pix);

  // sem chave não há QR: em vez de sumir, a parte diz o que falta
  if (!tenant.pix) {
    return (
      <section id="sinal" aria-labelledby="sinal-t" className="grid scroll-mt-20 gap-2 rounded-2xl border border-dashed bg-card p-5 sm:p-7 lg:col-start-1">
        <h2 id="sinal-t" className="text-[15px] font-semibold">Sinal no agendamento online</h2>
        <p className="text-sm text-muted-foreground">
          Para pedir um sinal por Pix a quem agenda pelo link, cadastre primeiro a sua chave em{" "}
          <a href="#pix" className="font-medium text-foreground underline underline-offset-2">Pix para receber</a>.
        </p>
      </section>
    );
  }

  async function salvar() {
    setAviso(null);
    const ok = ConfigSinal.safeParse(atual);
    if (!ok.success) return setAviso({ ok: false, texto: numero ? ok.error.issues[0].message : "Informe o valor do sinal." });
    setBusy(true);
    const r = await idToken().then((t) => salvarSinalAction(t, { tenantId: tenant.id, sinal: ok.data })).catch(() => null);
    setBusy(false);
    if (!r) return setAviso({ ok: false, texto: "Não foi possível salvar. Verifique a conexão e tente de novo." });
    if (!r.ok) return setAviso({ ok: false, texto: r.error });
    setSalvo(JSON.stringify(r.sinal));
    tenant.atualizar?.({ sinal: r.sinal });
    setAviso({ ok: true, texto: r.sinal.ativo ? "Salvo. Quem agendar online já vê o sinal e o QR do Pix." : "Salvo. O agendamento online não pede sinal." });
  }

  return (
    <form
      id="sinal"
      noValidate
      className="grid scroll-mt-20 gap-4 rounded-2xl border bg-card p-5 sm:p-7 lg:col-start-1"
      onSubmit={(e) => {
        e.preventDefault();
        void salvar();
      }}
    >
      <div className="grid gap-1">
        <h2 className="text-[15px] font-semibold">Sinal no agendamento online</h2>
        <p className="text-sm text-muted-foreground">
          Opcional. Quem agenda pelo link paga uma parte por Pix para garantir o horário. Sem o sinal no prazo, o horário é liberado sozinho. Quando cair na sua conta, toque em &ldquo;Sinal recebido&rdquo; na agenda.
        </p>
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
        <input type="checkbox" checked={sinal.ativo} onChange={(e) => muda({ ativo: e.target.checked })} className="size-5 accent-primary" />
        Pedir sinal para reservar
      </label>
      {sinal.ativo && numero > 0 && ConfigSinal.safeParse(atual).success && (
        <p className="text-sm text-muted-foreground">
          Exemplo: num serviço de R$ 50,00, o cliente paga {formatBRL(valorDoSinal(atual, 5000))} por Pix ao agendar e o resto no local.
        </p>
      )}
      {sinal.ativo && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="sinal-valor">{sinal.tipo === "percentual" ? "Percentual do valor" : "Valor fixo"}</Label>
            <div className="flex gap-2">
              <Input
                id="sinal-valor"
                inputMode="numeric"
                value={valor}
                onChange={(e) => (setValor(sinal.tipo === "fixo" ? maskBRL(e.target.value) : e.target.value.replace(/\D/g, "").slice(0, 3)), setAviso(null))}
                className="h-12 bg-card px-3.5 text-base sm:h-11 sm:text-[15px]"
              />
              <select
                aria-label="Tipo de sinal"
                value={sinal.tipo}
                onChange={(e) => (muda({ tipo: e.target.value as "percentual" | "fixo" }), setValor(""))}
                className="h-12 rounded-lg border border-input bg-card px-2 text-sm sm:h-11"
              >
                <option value="percentual">%</option>
                <option value="fixo">R$</option>
              </select>
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sinal-prazo">Prazo para pagar</Label>
            <select id="sinal-prazo" value={sinal.prazoMin} onChange={(e) => muda({ prazoMin: Number(e.target.value) })} className="h-12 rounded-lg border border-input bg-card px-3 text-base sm:h-11 sm:text-[15px]">
              {PRAZOS.map((p) => (
                <option key={p} value={p}>{rotuloPrazo(p)}</option>
              ))}
            </select>
          </div>
        </div>
      )}
      {aviso && (
        <p role={aviso.ok ? "status" : "alert"} className={aviso.ok ? "text-sm text-emerald-700 dark:text-emerald-300" : "text-sm text-destructive"}>
          {aviso.texto}
        </p>
      )}
      <div className="flex items-center justify-end gap-3">
        {mudou && !busy && <span className="text-xs text-muted-foreground">Alterações não salvas</span>}
        <Button type="submit" disabled={busy || !mudou} className="h-12 px-5 text-[15px] sm:h-11 sm:text-sm">{busy ? "Salvando…" : "Salvar sinal"}</Button>
      </div>
    </form>
  );
}
