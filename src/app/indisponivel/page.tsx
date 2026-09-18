export const metadata = {
  title: "Site indisponível",
  robots: { index: false, follow: false },
};

export default function Indisponivel() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="text-2xl font-semibold">Este site está fora do ar</h1>
      <p className="text-sm text-muted-foreground">
        Esta página foi desativada. Se o negócio é seu e você quer colocá-la de volta, fale com a gente.
      </p>
      <a
        href="https://www.ruphus.site/sobre"
        className="mt-2 inline-flex h-11 items-center rounded-lg border px-4 text-sm font-semibold"
      >
        Saber mais
      </a>
    </main>
  );
}
