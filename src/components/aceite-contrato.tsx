import { CONTRATO_URL, RESUMO_CONTRATO } from "@/lib/contrato";

/** "Li e aceito os Termos": o mesmo aviso no cadastro do negócio e no convite do dono.
 *  O servidor confere e grava o aceite; isto aqui só colhe o clique. */
export function AceiteContrato({ aceito, onChange, erro }: { aceito: boolean; onChange: (v: boolean) => void; erro?: boolean }) {
  return (
    <div className="grid gap-3">
      {/* as cláusulas essenciais antes do clique (Decreto 7.962/2013, art. 4º, I) */}
      <ul className="grid list-disc gap-1 rounded-lg border bg-muted/40 p-3 pl-7 text-[13px] leading-relaxed text-muted-foreground">
        {RESUMO_CONTRATO.map((linha) => <li key={linha}>{linha}</li>)}
      </ul>
      <label className="flex items-start gap-2.5 text-sm leading-relaxed">
        <input
          type="checkbox"
          className="mt-1 size-4 shrink-0 accent-primary"
          checked={aceito}
          onChange={(e) => onChange(e.target.checked)}
          aria-invalid={erro || undefined}
        />
        <span className={erro ? "text-destructive" : "text-muted-foreground"}>
          Li e aceito os{" "}
          <a href={CONTRATO_URL} target="_blank" rel="noopener" className="font-medium text-foreground underline underline-offset-2">
            Termos de Contratação
          </a>{" "}
          da Ruphus.
        </span>
      </label>
    </div>
  );
}
