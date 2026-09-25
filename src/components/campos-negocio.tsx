"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DadosNegocio, GRUPOS, SUBS } from "@/lib/gerador";
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

export function CamposNegocio({
  valores, onChange, erros, completo = false,
}: {
  valores: Valores;
  onChange: (v: Valores) => void;
  /** só os erros que já devem aparecer (campo tocado ou tentativa de salvar) */
  erros: Partial<Record<Campo, string>>;
  /** a aba "Meu negócio" também edita endereço, Instagram e horário */
  completo?: boolean;
}) {
  const muda = (c: Campo) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange({ ...valores, [c]: e.target.value });
  const msg = (c: Campo) => <p id={`negocio-${c}-msg`} aria-live="polite" className="min-h-4 text-xs text-destructive">{erros[c] ?? ""}</p>;
  const texto = (c: Campo, rotulo: string, extra: React.InputHTMLAttributes<HTMLInputElement>) => (
    <div className="grid gap-1.5">
      <Label htmlFor={`negocio-${c}`}>{rotulo}</Label>
      <Input id={`negocio-${c}`} value={valores[c]} onChange={muda(c)} aria-invalid={!!erros[c]} aria-describedby={`negocio-${c}-msg`} className={CAMPO} {...extra} />
      {msg(c)}
    </div>
  );

  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor="negocio-sub">Ramo</Label>
        <select
          id="negocio-sub"
          value={valores.sub}
          onChange={muda("sub")}
          aria-invalid={!!erros.sub}
          aria-describedby="negocio-sub-msg"
          className={cn("h-12 rounded-lg border border-input bg-card px-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:h-11 sm:text-[15px]", erros.sub && "border-destructive")}
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
      <div className="grid grid-cols-[1fr_5.5rem] gap-3">
        {texto("cidade", "Cidade", { autoComplete: "address-level2", maxLength: 60 })}
        {texto("uf", "UF", { autoComplete: "address-level1", maxLength: 2, placeholder: "SP", className: cn(CAMPO, "uppercase") })}
      </div>
      {texto("bairro", "Bairro (opcional)", { maxLength: 60 })}
      {completo && (
        <>
          {texto("endereco", "Endereço (opcional)", { autoComplete: "street-address", maxLength: 160, placeholder: "Rua, número" })}
          {texto("instagram", "Instagram (opcional)", { placeholder: "@seunegocio", maxLength: 60 })}
          {texto("horario", "Horário de funcionamento (opcional)", { placeholder: "Seg a sex, 9h às 18h", maxLength: 120 })}
        </>
      )}
    </>
  );
}
