"use client";

import { urlDoSite } from "@/lib/dominio";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RUPHUS } from "@/lib/catalogo";
import { CamposNegocio, errosDe, VAZIO, type Valores } from "@/components/campos-negocio";
import { idToken } from "@/lib/firebase";
import { RECADO_MAX } from "@/lib/scheduling";
import { lerNegocioAction, salvarNegocioAction, salvarRecadoAction } from "../actions";
import { InstalarPainel } from "../app-instalado";
import { useTenant } from "../painel-layout";
import { PageTitle } from "../page-title";
import { WhatsAppNegocio } from "../whatsapp-negocio";
import { PixNegocio, SinalNegocio } from "../pix-negocio";

// O que o cliente vê do negócio: o site, a bio e o WhatsApp do agendamento saem daqui.
// Salvar publica na hora (o servidor limpa o cache do site, da imagem e da bio).

export default function MeuNegocio() {
  const tenant = useTenant();
  const slug = tenant.id;
  const [nome, setNome] = useState("");
  const [campos, setCampos] = useState<Valores>(VAZIO);
  // o que está gravado: Salvar só acende quando algo mudou
  const [salvo, setSalvo] = useState<{ nome: string; campos: Valores } | null>(null);
  const [nomeVisto, setNomeVisto] = useState(false);
  const [fabrica, setFabrica] = useState(false);
  const [publicado, setPublicado] = useState(true);
  const [estado, setEstado] = useState<"carregando" | "pronto" | "erro">("carregando");
  const [tentou, setTentou] = useState(false);
  const [busy, setBusy] = useState(false);
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null);
  // muda a cada salvamento: a prévia da imagem é pedida de novo, sem cache do navegador
  const [versao, setVersao] = useState(0);
  // o recado da confirmação do agendamento: salva à parte, não mexe no site
  const [recado, setRecado] = useState("");
  const [recadoSalvo, setRecadoSalvo] = useState("");
  const [busyRecado, setBusyRecado] = useState(false);
  const [avisoRecado, setAvisoRecado] = useState<{ ok: boolean; texto: string } | null>(null);

  // muda a cada "Tentar de novo": refaz a leitura sem recarregar a página
  const [tentativa, setTentativa] = useState(0);
  useEffect(() => {
    let atual = true;
    (async () => {
      const r = await idToken().then((t) => lerNegocioAction(t, { tenantId: slug })).catch(() => null);
      if (!atual) return;
      if (!r?.ok) return setEstado("erro");
      const { name, fabrica, publicado, recado, ...resto } = r.dados;
      setRecado(recado);
      setRecadoSalvo(recado);
      const lidos = { ...VAZIO, ...resto, telefone: resto.telefone ? formatarFone(resto.telefone) : "" };
      setNome(name);
      setFabrica(fabrica);
      setPublicado(publicado);
      setCampos(lidos);
      setSalvo({ nome: name, campos: lidos });
      setEstado("pronto");
    })();
    return () => {
      atual = false;
    };
  }, [slug, tentativa]);

  const erros = errosDe(campos);
  const erroNome = nome.trim().length < 2 ? "Informe o nome do negócio" : "";
  const mudou = !!salvo && (nome !== salvo.nome || (Object.keys(VAZIO) as (keyof Valores)[]).some((c) => campos[c] !== salvo.campos[c]));
  const mudouRecado = recado.trim() !== recadoSalvo.trim();

  // sair com alteração não salva: o navegador pergunta antes
  useEffect(() => {
    if (!mudou && !mudouRecado) return;
    const segura = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", segura);
    return () => window.removeEventListener("beforeunload", segura);
  }, [mudou, mudouRecado]);

  // editar de novo tira o "Salvo." da tela
  const editar = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setAviso(null);
  };

  async function salvar() {
    setTentou(true);
    setAviso(null);
    if (erroNome || Object.keys(erros).length) return;
    setBusy(true);
    const r = await idToken().then((t) => salvarNegocioAction(t, { tenantId: slug, dados: { name: nome, ...campos } })).catch(() => null);
    setBusy(false);
    if (!r) return setAviso({ ok: false, texto: "Não foi possível salvar. Verifique a conexão e tente de novo." });
    if (!r.ok) return setAviso({ ok: false, texto: r.error });
    setSalvo({ nome, campos });
    setAviso({ ok: true, texto: fabrica ? "Dados salvos. A bio e o agendamento já mostram as mudanças." : "Salvo. O site já mostra as mudanças." });
    setVersao((v) => v + 1);
  }

  async function salvarRecado() {
    setAvisoRecado(null);
    setBusyRecado(true);
    const r = await idToken().then((t) => salvarRecadoAction(t, { tenantId: slug, recado })).catch(() => null);
    setBusyRecado(false);
    if (!r) return setAvisoRecado({ ok: false, texto: "Não foi possível salvar. Verifique a conexão e tente de novo." });
    if (!r.ok) return setAvisoRecado({ ok: false, texto: r.error });
    setRecado(recado.trim());
    setRecadoSalvo(recado.trim());
    setAvisoRecado({ ok: true, texto: recado.trim() ? "Salvo. Quem agendar já vê o seu recado." : "Salvo. Quem agendar vê o texto padrão." });
  }

  if (!tenant.podeGerir) return <p className="text-muted-foreground">Só o dono ou um administrador do negócio pode ver esta tela.</p>;
  if (estado === "carregando") {
    // o formato da tela, sem pular quando os dados chegam
    return (
      <div className="grid gap-8" aria-busy="true" aria-label="Carregando os dados do negócio">
        <div className="grid gap-2">
          <div className="h-8 w-48 animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-72 max-w-full animate-pulse rounded bg-muted" />
        </div>
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="grid gap-5 rounded-2xl border bg-card p-5 sm:p-7">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="grid gap-2">
                <div className="h-3.5 w-28 animate-pulse rounded bg-muted" />
                <div className="h-11 animate-pulse rounded-lg bg-muted" />
              </div>
            ))}
          </div>
          <div className="h-72 animate-pulse rounded-2xl border bg-muted/50" />
        </div>
      </div>
    );
  }
  if (estado === "erro") {
    return (
      <div role="alert" className="grid max-w-md gap-3 rounded-2xl border bg-card p-5">
        <p className="font-medium">Não foi possível carregar os dados do negócio.</p>
        <p className="text-sm text-muted-foreground">Confira a internet e tente de novo. Nada do que estava salvo foi perdido.</p>
        <Button className="h-11 justify-self-start px-5" onClick={() => (setEstado("carregando"), setTentativa((t) => t + 1))}>Tentar de novo</Button>
      </div>
    );
  }

  const site = urlDoSite(slug, tenant.dominio).replace(/\/$/, "");
  return (
    // com a barra de salvar fixa no celular, o fim da página não fica escondido atrás dela
    <div className={mudou ? "grid gap-8 max-sm:pb-20" : "grid gap-8"}>
      <PageTitle title="Meu negócio" sub="Os dados que aparecem no seu site, na bio e no agendamento." />

      {/* a página é longa no celular: atalhos para cada parte, cada uma com o seu Salvar */}
      <nav aria-label="Partes desta página" className="-mx-4 -mt-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:hidden [&::-webkit-scrollbar]:hidden">
        {[["#dados", "Dados"], ["#links", "Links"], ["#recado", "Recado"], ["#whatsapp", "WhatsApp"], ["#pix", "Pix"], ["#sinal", "Sinal"]].map(([href, rotulo]) => (
          <a key={href} href={href} className="flex h-9 shrink-0 items-center rounded-full border bg-card px-3.5 text-sm font-medium hover:bg-muted">{rotulo}</a>
        ))}
      </nav>

      {/* Uma coluna com todos os formulários e, ao lado, só os links (fixos ao rolar). Antes o
          WhatsApp morava no aside: com ele conectado a lateral passava da coluna de Dados e
          sobrava um vão em branco à esquerda. No celular a ordem é a dos atalhos acima. */}
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <form
          id="dados"
          noValidate
          className="grid scroll-mt-20 gap-5 rounded-2xl border bg-card p-5 sm:p-7 lg:col-start-1"
          onSubmit={(e) => {
            e.preventDefault();
            salvar();
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="negocio-nome">Nome do negócio</Label>
            <Input
              id="negocio-nome"
              value={nome}
              maxLength={80}
              onChange={(e) => editar(setNome)(e.target.value.replace(/\s+/g, " ").replace(/^\s/, ""))}
              onBlur={() => setNomeVisto(true)}
              aria-invalid={(tentou || nomeVisto) && !!erroNome}
              aria-describedby="negocio-nome-msg"
              className="h-12 bg-card px-3.5 text-base sm:h-11 sm:text-[15px]"
            />
            <p id="negocio-nome-msg" aria-live="polite" className="min-h-4 text-xs text-destructive">{tentou || nomeVisto ? erroNome : ""}</p>
          </div>
          <CamposNegocio valores={campos} onChange={editar(setCampos)} erros={erros} mostrarTodos={tentou} completo />
          {aviso && (
            <p role={aviso.ok ? "status" : "alert"} className={aviso.ok ? "text-sm text-emerald-700 dark:text-emerald-300" : "text-sm text-destructive"}>
              {aviso.texto}
            </p>
          )}
          <div className="flex items-center justify-end gap-3">
            {mudou && !busy && <span className="text-xs text-muted-foreground">Alterações não salvas</span>}
            <Button type="submit" disabled={busy || !mudou} className="h-12 px-5 text-[15px] sm:h-11 sm:text-sm">{busy ? "Salvando…" : "Salvar"}</Button>
          </div>
        </form>

        <aside id="links" className="grid scroll-mt-20 gap-4 rounded-2xl border bg-card p-5 lg:sticky lg:top-20 lg:col-start-2 lg:row-span-5 lg:row-start-1">
          {!fabrica && !publicado && (
            // o site do cadastro nasce como prévia: a faixa e o Google só mudam com a entrada paga
            <div className="grid gap-2.5 rounded-xl bg-muted p-4">
              <h2 className="text-[15px] font-semibold">Seu site está como prévia</h2>
              <p className="text-sm text-muted-foreground">
                Ele já abre e recebe agendamentos, mas mostra uma faixa de &ldquo;ainda não publicada&rdquo; e fica fora do Google. Para publicar: R$ 250 uma vez e R$ 89,90 por mês.
              </p>
              <a
                href={`https://wa.me/${RUPHUS}?text=${encodeURIComponent(`Olá! Quero publicar o site ${slug}.ruphus.site.`)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground"
              >
                Publicar meu site
              </a>
            </div>
          )}
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
                <div className="flex items-center gap-2">
                  <a href={url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate py-2 font-medium underline underline-offset-2">{url.replace("https://", "")}</a>
                  <CopiarLink url={url} rotulo={rotulo} />
                </div>
              </li>
            ))}
          </ul>
          <InstalarPainel />
        </aside>

        <form
          id="recado"
          noValidate
          className="grid scroll-mt-20 gap-4 rounded-2xl border bg-card p-5 sm:p-7 lg:col-start-1"
          onSubmit={(e) => {
            e.preventDefault();
            salvarRecado();
          }}
        >
          <div className="grid gap-1">
            <h2 className="text-[15px] font-semibold">Depois do agendamento</h2>
            <p className="text-sm text-muted-foreground">
              Opcional. O que o cliente lê logo depois de agendar. Em branco, ele vê: &ldquo;{nome || "O negócio"} vai te chamar no seu WhatsApp para confirmar.&rdquo;
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="negocio-recado">Recado para o cliente</Label>
            <textarea
              id="negocio-recado"
              value={recado}
              maxLength={RECADO_MAX}
              rows={3}
              placeholder="Ex.: Chegue 10 minutos antes. Aceitamos Pix e cartão."
              onChange={(e) => {
                setRecado(e.target.value);
                setAvisoRecado(null);
              }}
              aria-describedby="negocio-recado-msg"
              className="min-h-24 rounded-lg border border-input bg-card px-3.5 py-3 text-base outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 sm:text-[15px]"
            />
            <p id="negocio-recado-msg" className="text-xs text-muted-foreground">{recado.length}/{RECADO_MAX} · o número do cliente continua aparecendo logo abaixo</p>
          </div>
          {avisoRecado && (
            <p role={avisoRecado.ok ? "status" : "alert"} className={avisoRecado.ok ? "text-sm text-emerald-700 dark:text-emerald-300" : "text-sm text-destructive"}>
              {avisoRecado.texto}
            </p>
          )}
          <div className="flex items-center justify-end gap-3">
            {mudouRecado && !busyRecado && <span className="text-xs text-muted-foreground">Alterações não salvas</span>}
            <Button type="submit" disabled={busyRecado || !mudouRecado} className="h-12 px-5 text-[15px] sm:h-11 sm:text-sm">{busyRecado ? "Salvando…" : "Salvar recado"}</Button>
          </div>
        </form>

        <WhatsAppNegocio slug={slug} />
        <PixNegocio cidadeSugerida={salvo?.campos.cidade ?? ""} />
        <SinalNegocio />
      </div>

      {mudou && (
        <div className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between gap-3 border-t bg-card/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_-16px_rgba(0,0,0,0.25)] backdrop-blur sm:hidden">
          <span className="text-sm text-muted-foreground">Alterações não salvas</span>
          <Button type="submit" form="dados" disabled={busy} className="h-11 px-5">{busy ? "Salvando…" : "Salvar"}</Button>
        </div>
      )}
    </div>
  );
}

/** Copiar o link sem selecionar na mão; "Copiado" volta ao normal em 2 s. */
function CopiarLink({ url, rotulo }: { url: string; rotulo: string }) {
  const [ok, setOk] = useState<boolean | null>(null);
  return (
    <button
      type="button"
      aria-label={`Copiar o link: ${rotulo}`}
      onClick={async () => {
        const certo = await navigator.clipboard.writeText(url).then(() => true, () => false);
        setOk(certo);
        setTimeout(() => setOk(null), 2000);
      }}
      className="h-9 shrink-0 rounded-lg border px-3 text-xs font-medium hover:bg-muted"
    >
      <span aria-live="polite">{ok === null ? "Copiar" : ok ? "Copiado" : "Não deu"}</span>
    </button>
  );
}

/** 5596991234567 → (96) 99123-4567, para o campo mostrar o número como a pessoa digita */
function formatarFone(t: string) {
  const d = t.startsWith("55") ? t.slice(2) : t;
  return `(${d.slice(0, 2)}) ${d.slice(2, -4)}-${d.slice(-4)}`;
}
