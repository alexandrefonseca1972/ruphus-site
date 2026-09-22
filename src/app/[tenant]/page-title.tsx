/** Título das telas do painel: serifa grande, uma linha de contexto e as ações à direita. */
export function PageTitle({ title, sub, children }: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="grid gap-1.5">
        <h1 className="font-serifa text-4xl leading-none tracking-tight sm:text-5xl">{title}</h1>
        {sub && <p className="text-[15px] text-muted-foreground">{sub}</p>}
      </div>
      {children}
    </div>
  );
}
