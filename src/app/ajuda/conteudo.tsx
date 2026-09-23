import Link from "next/link";

/** Peças do manual. O texto mora nas páginas; aqui fica só a moldura, para os
 *  dois manuais (o do dono e o do vendedor) terem a mesma cara. */

export function Capa({ titulo, linha, children }: { titulo: string; linha: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="font-[family-name:var(--fonte-serifa)] text-[40px] leading-none">{titulo}</h1>
      <p className="max-w-[60ch] text-[15px] leading-relaxed text-[#4A4639]">{linha}</p>
      {children}
    </div>
  );
}

export function Indice({ itens }: { itens: [string, string][] }) {
  return (
    <nav aria-label="Índice" className="flex flex-wrap gap-2 rounded-2xl border border-[#E2DDD3] bg-white p-4">
      {itens.map(([id, rotulo]) => (
        <a
          key={id}
          href={`#${id}`}
          className="flex h-10 items-center rounded-full border border-[#D8D2C6] px-3.5 text-[13px] text-[#17150F] hover:border-[#17150F]"
        >
          {rotulo}
        </a>
      ))}
    </nav>
  );
}

export function Secao({ id, titulo, children }: { id: string; titulo: string; children: React.ReactNode }) {
  return (
    <section id={id} className="flex scroll-mt-6 flex-col gap-4 rounded-2xl border border-[#E2DDD3] bg-white p-5 sm:p-6">
      <h2 className="font-[family-name:var(--fonte-serifa)] text-[26px] leading-none">{titulo}</h2>
      {children}
    </section>
  );
}

export function P({ children }: { children: React.ReactNode }) {
  return <p className="max-w-[68ch] text-[14.5px] leading-relaxed text-[#2E2B22]">{children}</p>;
}

/** Lista numerada: para passo a passo, onde a ordem importa. */
export function Passos({ itens }: { itens: React.ReactNode[] }) {
  return (
    <ol className="flex flex-col gap-2.5">
      {itens.map((item, i) => (
        <li key={i} className="flex gap-3 text-[14.5px] leading-relaxed text-[#2E2B22]">
          <span
            aria-hidden="true"
            className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-[#EFEBE2] font-[family-name:var(--font-geist-mono)] text-[11px] font-semibold"
          >
            {i + 1}
          </span>
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ol>
  );
}

export function Lista({ itens }: { itens: React.ReactNode[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {itens.map((item, i) => (
        <li key={i} className="flex gap-2.5 text-[14.5px] leading-relaxed text-[#2E2B22]">
          <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-[#2C6A53]" />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** O que costuma dar errado, dito antes de dar errado. */
export function Atencao({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-2.5 rounded-xl border border-[#E7D6B4] bg-[#FBF3DC] p-3.5 text-[13.5px] leading-relaxed text-[#6B4E24]">
      <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true" className="mt-0.5 shrink-0">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v5" />
        <path d="M12 16.4v.1" />
      </svg>
      <span className="min-w-0">{children}</span>
    </p>
  );
}

export function Termo({ children }: { children: React.ReactNode }) {
  return <b className="font-semibold text-[#17150F]">{children}</b>;
}

export function Rodape({ outro, rotulo }: { outro: string; rotulo: string }) {
  return (
    <footer className="flex flex-wrap items-center gap-3 border-t border-[#E2DDD3] pt-5 text-[13px] text-[#6F6A5E]">
      <Link href={outro} className="flex h-10 items-center rounded-[10px] border border-[#D8D2C6] bg-white px-3.5 text-[#17150F] hover:border-[#17150F]">
        {rotulo}
      </Link>
      <span>Ficou faltando alguma coisa? Fale com a Ruphus pelo WhatsApp.</span>
    </footer>
  );
}
