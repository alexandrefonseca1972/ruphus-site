"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatPhone } from "@/lib/datetime";
import { useState } from "react";
import { normalizar } from "@/lib/catalogo";
import { DadosNegocio, GRUPOS, SUBS, UFS, ufDoTelefone } from "@/lib/gerador";
import { cn } from "@/lib/utils";

// Os campos do negócio que o cadastro e a aba "Meu negócio" pedem. As mensagens vêm do
// mesmo schema que o servidor aplica: o que a tela avisa é o que o salvamento recusa.

export type Valores = { sub: string; telefone: string; cidade: string; uf: string; bairro: string; endereco: string; instagram: string; horario: string };
export const VAZIO: Valores = { sub: "", telefone: "", cidade: "", uf: "", bairro: "", endereco: "", instagram: "", horario: "" };
type Campo = keyof Valores;

/** Erro de cada campo, pelo schema; só os que a tela mostra. */
export function errosDe(v: Valores): Partial<Record<Campo, string>> {
  const e: Partial<Record<Campo, string>> = {};
  for (const c of ["sub", "telefone", "cidade", "uf"] as const) {
    const r = DadosNegocio.shape[c].safeParse(v[c]);
    if (!r.success) e[c] = r.error.issues[0].message;
  }
  return e;
}

const CAMPO = "h-12 bg-card px-3.5 text-base sm:h-11 sm:text-[15px]";

// Máscara de cada campo enquanto a pessoa digita; o schema confere de novo no servidor.
const texto = (v: string) => v.replace(/\s+/g, " ").replace(/^\s/, "");
const MASCARA: Partial<Record<Campo, (v: string) => string>> = {
  telefone: formatPhone,
  cidade: (v) => texto(v.replace(/[^\p{L}\s'.-]/gu, "")),
  bairro: (v) => texto(v.replace(/[^\p{L}\d\s'.,-]/gu, "")),
  endereco: texto,
  horario: texto,
  // @ opcional e só o que um perfil do Instagram aceita
  instagram: (v) => v.replace(/[^@\w.]/g, "").replace(/(?!^)@/g, "").slice(0, 31),
};

export function CamposNegocio({
  valores, onChange, erros: todos, mostrarTodos, completo = false,
}: {
  valores: Valores;
  onChange: (v: Valores) => void;
  erros: Partial<Record<Campo, string>>;
  /** tentou salvar: todos os erros aparecem, não só os dos campos por onde a pessoa passou */
  mostrarTodos: boolean;
  /** a aba "Meu negócio" também edita endereço, Instagram e horário */
  completo?: boolean;
}) {
  // O erro aparece ao sair do campo e, daí em diante, a cada tecla: acusar quem ainda digita é ruído
  const [vistos, setVistos] = useState<ReadonlySet<Campo>>(new Set());
  const ver = (c: Campo) => () => setVistos((v) => (v.has(c) ? v : new Set(v).add(c)));
  const erros = Object.fromEntries(Object.entries(todos).filter(([c]) => mostrarTodos || vistos.has(c as Campo))) as Partial<Record<Campo, string>>;
  const muda = (c: Campo) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const novo = { ...valores, [c]: (MASCARA[c] ?? ((v: string) => v))(e.target.value) };
    // UF vazia: a do DDD do WhatsApp, que a pessoa troca se o número for de fora
    if (c === "telefone" && !valores.uf) novo.uf = ufDoTelefone(normalizar(novo.telefone));
    onChange(novo);
  };
  const msg = (c: Campo) => <p id={`negocio-${c}-msg`} aria-live="polite" className="min-h-4 text-xs text-destructive">{erros[c] ?? ""}</p>;
  const texto = (c: Campo, rotulo: string, extra: React.InputHTMLAttributes<HTMLInputElement>, dica?: string) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`negocio-${c}`}>{rotulo}</Label>
      <Input id={`negocio-${c}`} value={valores[c]} onChange={muda(c)} onBlur={ver(c)} aria-invalid={!!erros[c]} aria-describedby={`negocio-${c}-msg`} className={CAMPO} {...extra} />
      {dica && !erros[c] ? <p id={`negocio-${c}-msg`} className="min-h-4 text-xs text-muted-foreground">{dica}</p> : msg(c)}
    </div>
  );
  const SELETOR = "h-12 rounded-lg border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-11 sm:text-[15px]";

  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor="negocio-sub">Ramo</Label>
        <select
          id="negocio-sub"
          value={valores.sub}
          onChange={muda("sub")}
          onBlur={ver("sub")}
          aria-invalid={!!erros.sub}
          aria-describedby="negocio-sub-msg"
          className={cn(SELETOR, erros.sub && "border-destructive")}
        >
          <option value="" disabled>Escolha o ramo do negócio</option>
          {GRUPOS.map(([grupo, subs]) => (
            <optgroup key={grupo} label={grupo}>
              {subs.map((s) => <option key={s} value={s}>{SUBS[s].rotulo}</option>)}
            </optgroup>
          ))}
        </select>
        <p id="negocio-sub-msg" aria-live="polite" className="min-h-4 text-xs">
          {erros.sub ? <span className="text-destructive">{erros.sub}</span> : <span className="text-muted-foreground">Define o modelo do site e os serviços iniciais da agenda.</span>}
        </p>
      </div>
      {texto("telefone", "WhatsApp do negócio", { type: "tel", inputMode: "tel", autoComplete: "tel", placeholder: "(00) 90000-0000", maxLength: 20 })}
      <div className="grid grid-cols-[1fr_6.5rem] gap-3">
        {texto("cidade", "Cidade", { autoComplete: "address-level2", maxLength: 60 })}
        <div className="grid gap-1.5">
          <Label htmlFor="negocio-uf">UF</Label>
          <select
            id="negocio-uf"
            value={valores.uf}
            onChange={muda("uf")}
            onBlur={ver("uf")}
            autoComplete="address-level1"
            aria-invalid={!!erros.uf}
            aria-describedby="negocio-uf-msg"
            className={cn(SELETOR, erros.uf && "border-destructive")}
          >
            <option value="" disabled>UF</option>
            {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          {msg("uf")}
        </div>
      </div>
      {texto("bairro", "Bairro (opcional)", { maxLength: 60 })}
      {completo && (
        // O que só enfeita a página: fica junto, depois do que o agendamento precisa
        <fieldset className="grid gap-5 border-t pt-5">
          <legend className="sr-only">Na página e na bio</legend>
          <div aria-hidden="true" className="-mb-2 grid gap-0.5">
            <span className="text-[15px] font-semibold">Na página e na bio</span>
            <span className="text-xs text-muted-foreground">Opcionais: aparecem no site e na bio quando preenchidos.</span>
          </div>
          {texto("endereco", "Endereço", { autoComplete: "street-address", maxLength: 160, placeholder: "Rua, número" })}
          {texto("instagram", "Instagram", { placeholder: "@seunegocio", maxLength: 60 }, valores.instagram.replace("@", "") ? `instagram.com/${valores.instagram.replace("@", "")}` : undefined)}
          {texto("horario", "Horário de funcionamento", { placeholder: "Seg a sex, 9h às 18h", maxLength: 120 })}
        </fieldset>
      )}
    </>
  );
}
