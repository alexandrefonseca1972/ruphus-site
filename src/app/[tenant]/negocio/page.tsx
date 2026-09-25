"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CamposNegocio, errosDe, VAZIO, type Valores } from "@/components/campos-negocio";
import { idToken } from "@/lib/firebase";
import { lerNegocioAction, salvarNegocioAction } from "../actions";
import { useTenant } from "../layout";
import { PageTitle } from "../page-title";

// O que o cliente vê do negócio: o site, a bio e o WhatsApp do agendamento saem daqui.
// Salvar publica na hora (o servidor limpa o cache do site, da imagem e da bio).

export default function MeuNegocio() {
  const tenant = useTenant();
  const slug = tenant.id;
  const [nome, setNome] = useState("");
  const [campos, setCampos] = useState<Valores>(VAZIO);
  const [fabrica, setFabrica] = useState(false);
  const [estado, setEstado] = useState<"carregando" | "pronto" | "erro">("carregando");
  const [tentou, setTentou] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  // muda a cada salvamento: a prévia da imagem é pedida de novo, sem cache do navegador
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let atual = true;
    (async () => {
      const r = await lerNegocioAction(await idToken(), { tenantId: slug }).catch(() => null);
      if (!atual) return;
      if (!r?.ok) return setEstado("erro");
      const { name, fabrica, ...resto } = r.dados;
      setNome(name);
      setFabrica(fabrica);
      setCampos({ ...VAZIO, ...resto, telefone: resto.telefone ? formatarFone(resto.telefone) : "" });
      setEstado("pronto");
    })();
    return () => {
      atual = false;
    };
  }, [slug]);

  const erros = errosDe(campos);
  const erroNome = nome.trim().length < 2 ? "Informe o nome do negócio" : "";

  async function salvar() {
    setTentou(true);
    setAviso(null);
    if (erroNome || Object.keys(erros).length) return;
    setBusy(true);
    const r = await salvarNegocioAction(await idToken(), { tenantId: slug, dados: { name: nome, ...campos } }).catch(() => null);
    setBusy(false);
    if (!r) return setAviso({ ok: false, texto: "Não foi possível salvar. Verifique a conexão e tente de novo." });
    if (!r.ok) return setAviso({ ok: false, texto: r.error });
    setAviso({ ok: true, texto: fabrica ? "Dados salvos. A bio e o agendamento já mostram as mudanças." : "Salvo. O site já mostra as mudanças." });
    setVersao((v) => v + 1);
  }

  if (!tenant.podeGerir) return <p className="text-muted-foreground">Só o dono ou um administrador do negócio pode ver esta tela.</p>;
  if (estado === "carregando") return <p className="text-muted-foreground">Carregando…</p>;
  if (estado === "erro") return <p role="alert" className="text-destructive">Não foi possível carregar os dados do negócio.</p>;

  const site = `https://${slug}.ruphus.site`;
  return (
    <div className="grid gap-8">
      <PageTitle title="Meu negócio" sub="Os dados que aparecem no seu site, na bio e no agendamento." />

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <form
          noValidate
          className="grid gap-5 rounded-2xl border bg-card p-5 sm:p-7"
          onSubmit={(e) => {
            e.preventDefault();
            salvar();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="negocio-nome">Nome do negócio</Label>
            <Input id="negocio-nome" value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} aria-invalid={tentou && !!erroNome} className="h-12 bg-card px-3.5 text-base sm:h-11 sm:text-[15px]" />
            <p aria-live="polite" className="min-h-4 text-xs text-destructive">{tentou ? erroNome : ""}</p>
          </div>
          <CamposNegocio valores={campos} onChange={setCampos} erros={tentou ? erros : {}} completo />
          {aviso && (
            <p role={aviso.ok ? "status" : "alert"} className={aviso.ok ? "text-sm text-emerald-700 dark:text-emerald-300" : "text-sm text-destructive"}>
              {aviso.texto}
            </p>
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={busy} className="h-12 px-5 text-[15px] sm:h-11 sm:text-sm">{busy ? "Salvando…" : "Salvar"}</Button>
          </div>
        </form>

        <aside className="grid gap-4 rounded-2xl border bg-card p-5">
          <h2 className="text-[15px] font-semibold">Seus links</h2>
          {fabrica ? (
            <p className="text-sm text-muted-foreground">O seu site foi feito sob medida pela Ruphus: para mudar a página, fale com a gente. Os dados daqui valem para a bio e o agendamento.</p>
          ) : (
            // prévia do que aparece no WhatsApp quando alguém recebe o link do site
            // eslint-disable-next-line @next/next/no-img-element -- imagem gerada pela própria rota, 1200×630
            <img src={`/s/${slug}/og.jpg?v=${versao}`} alt={`Prévia do link do site de ${nome}`} width={1200} height={630} className="aspect-[1200/630] w-full rounded-lg border object-cover" />
          )}
          <ul className="grid gap-2 text-sm">
            {[["Site", site], ["Bio para o Instagram", `${site}/bio`], ["Agenda online", `${site}/agendar`]].map(([rotulo, url]) => (
              <li key={rotulo} className="grid">
                <span className="text-xs text-muted-foreground">{rotulo}</span>
                <a href={url} target="_blank" rel="noreferrer" className="truncate font-medium underline underline-offset-2">{url.replace("https://", "")}</a>
              </li>
            ))}
          </ul>
        </aside>
      </div>
    </div>
  );
}

/** 5596991234567 → (96) 99123-4567, para o campo mostrar o número como a pessoa digita */
function formatarFone(t: string) {
  const d = t.startsWith("55") ? t.slice(2) : t;
  return `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}`;
}
