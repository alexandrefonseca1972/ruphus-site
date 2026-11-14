"use client";

import { useRef, useState } from "react";
import { AlertCircle, Star } from "lucide-react";
import { COMENTARIO_AVALIACAO_MAX, RespostaAvaliacao } from "@/lib/avaliacoes";
import { responderAvaliacaoAction } from "../../actions";
import { Agradecimento } from "./agradecimento";

type NotasForm = { servico: number | null; profissional: number | null; atendimento: number | null; ambiente: number | null; localizacao: number | null };
type Campo = keyof NotasForm | "comentario";
type Erros = Partial<Record<Campo, string>>;

const CATEGORIAS: { id: keyof NotasForm; titulo: string; descricao: string; opcional?: boolean }[] = [
  { id: "servico", titulo: "Serviço", descricao: "O resultado ficou como você esperava?" },
  { id: "profissional", titulo: "Profissional", descricao: "Como foi o trabalho de quem atendeu você?" },
  { id: "atendimento", titulo: "Atendimento", descricao: "Você se sentiu bem recebido e ouvido?" },
  { id: "ambiente", titulo: "Ambiente", descricao: "Como avalia o espaço e o conforto?", opcional: true },
  { id: "localizacao", titulo: "Localização", descricao: "Foi fácil encontrar e chegar?", opcional: true },
];
const NOTA_TEXTO = ["Muito ruim", "Ruim", "Regular", "Boa", "Excelente"];
const vazias = (): NotasForm => ({ servico: null, profissional: null, atendimento: null, ambiente: null, localizacao: null });

export function AvaliacaoForm(props: {
  tenantId: string;
  appointmentId: string;
  token: string;
  nome: string;
  negocio: string;
  servico: string;
  profissional: string;
  siteUrl: string;
}) {
  const [notas, setNotas] = useState<NotasForm>(vazias);
  const [comentario, setComentario] = useState("");
  const [erros, setErros] = useState<Erros>({});
  const [erroGeral, setErroGeral] = useState("");
  const [tentou, setTentou] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sucesso, setSucesso] = useState(false);
  const resumoRef = useRef<HTMLDivElement>(null);

  function payload() {
    return { tenantId: props.tenantId, appointmentId: props.appointmentId, token: props.token, notas, comentario };
  }

  function validar(atual = payload()): Erros {
    const r = RespostaAvaliacao.safeParse(atual);
    const proximos: Erros = {};
    if (!r.success) {
      for (const issue of r.error.issues) {
        const campo = issue.path[0] === "notas" ? issue.path[1] as Campo : issue.path[0] === "comentario" ? "comentario" : null;
        if (campo && !proximos[campo]) proximos[campo] = issue.message;
      }
    }
    return proximos;
  }

  function escolher(campo: keyof NotasForm, valor: number | null) {
    const proximas = { ...notas, [campo]: valor };
    setNotas(proximas);
    if (tentou || erros[campo]) setErros(validar({ ...payload(), notas: proximas }));
  }

  function validarComentario(valor: string) {
    if (!tentou && valor.length <= COMENTARIO_AVALIACAO_MAX) return;
    setErros(validar({ ...payload(), comentario: valor }));
  }

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setTentou(true);
    setErroGeral("");
    const proximos = validar();
    setErros(proximos);
    if (Object.keys(proximos).length) {
      requestAnimationFrame(() => resumoRef.current?.focus());
      return;
    }
    if (!navigator.onLine) return setErroGeral("Você está sem internet. Sua resposta continua na tela; conecte-se e tente de novo.");
    setBusy(true);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const r = await Promise.race([
        responderAvaliacaoAction(payload()),
        new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 20_000); }),
      ]);
      if (!r) return setErroGeral("O servidor demorou para responder. Confira sua conexão e tente de novo; não enviaremos uma avaliação duplicada.");
      if (!r.ok) return setErroGeral(r.error);
      setSucesso(true);
    } catch {
      setErroGeral("Não foi possível registrar agora. Sua resposta continua na tela; tente de novo.");
    } finally {
      if (timer) clearTimeout(timer);
      setBusy(false);
    }
  }

  if (sucesso) return <Agradecimento nome={props.nome} negocio={props.negocio} siteUrl={props.siteUrl} />;
  const resumo = Object.entries(erros).filter(([, mensagem]) => mensagem);

  return (
    <form onSubmit={enviar} noValidate className="grid gap-5">
      {tentou && resumo.length > 0 && (
        <div ref={resumoRef} tabIndex={-1} role="alert" aria-labelledby="erros-avaliacao" className="rounded-xl border border-[#E7C9BF] bg-[#FBF1EE] p-4 text-sm text-[#8D3524] focus:outline-2 focus:outline-offset-2 focus:outline-[#8D3524]">
          <h2 id="erros-avaliacao" className="flex items-center gap-2 font-semibold"><AlertCircle className="size-4" aria-hidden="true" />Revise sua avaliação</h2>
          <ul className="mt-2 grid gap-1">
            {resumo.map(([campo, mensagem]) => <li key={campo}><a href={`#campo-${campo}`} className="underline underline-offset-2">{mensagem}</a></li>)}
          </ul>
        </div>
      )}

      {CATEGORIAS.map((c) => {
        const valor = notas[c.id];
        return (
          <fieldset key={c.id} id={`campo-${c.id}`} aria-describedby={`${c.id}-ajuda${erros[c.id] ? ` ${c.id}-erro` : ""}`} className="rounded-xl border border-[#E0DCCE] bg-[#FAF9F5] p-4">
            <legend className="px-1 text-[15px] font-semibold">{c.titulo}{c.opcional && <span className="ml-1 text-xs font-normal text-[#6B6555]">(opcional)</span>}</legend>
            <p id={`${c.id}-ajuda`} className="text-sm leading-relaxed text-[#6B6555]">{c.descricao}</p>
            <div className="mt-3 grid grid-cols-5 gap-2" role="group" aria-label={`Nota para ${c.titulo}`}>
              {[1, 2, 3, 4, 5].map((nota) => (
                <button
                  key={nota}
                  type="button"
                  aria-label={`${nota} ${nota === 1 ? "estrela" : "estrelas"}: ${NOTA_TEXTO[nota - 1]}`}
                  aria-pressed={valor === nota}
                  onClick={() => escolher(c.id, nota)}
                  className={`grid min-h-12 place-items-center rounded-lg border transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#17150F] ${valor === nota ? "border-[#17150F] bg-[#17150F] text-[#FAF9F5]" : "border-[#D5D0C1] bg-white text-[#8A6A22] hover:border-[#8A6A22]"}`}
                >
                  <Star className="size-6" fill={valor !== null && nota <= valor ? "currentColor" : "none"} strokeWidth={1.7} aria-hidden="true" />
                </button>
              ))}
            </div>
            <div className="mt-2 flex min-h-6 flex-wrap items-center justify-between gap-2 text-xs text-[#6B6555]">
              <span aria-live="polite">{valor ? `${valor}/5 · ${NOTA_TEXTO[valor - 1]}` : "1 = muito ruim · 5 = excelente"}</span>
              {c.opcional && valor !== null && <button type="button" onClick={() => escolher(c.id, null)} className="min-h-6 underline underline-offset-2">Não se aplica</button>}
            </div>
            {c.opcional && valor === null && <p className="mt-1 text-xs text-[#6B6555]">Deixe sem nota se não se aplicar ao seu atendimento.</p>}
            {erros[c.id] && <p id={`${c.id}-erro`} role="alert" className="mt-2 text-sm text-[#A13D28]">{erros[c.id]}</p>}
          </fieldset>
        );
      })}

      <div id="campo-comentario" className="grid gap-2">
        <label htmlFor="comentario" className="text-[15px] font-semibold">Conte mais, se quiser <span className="text-xs font-normal text-[#6B6555]">(opcional)</span></label>
        <textarea
          id="comentario"
          value={comentario}
          maxLength={COMENTARIO_AVALIACAO_MAX}
          rows={4}
          onChange={(e) => { setComentario(e.target.value); if (tentou) validarComentario(e.target.value); }}
          onBlur={() => validarComentario(comentario)}
          aria-describedby={`comentario-ajuda${erros.comentario ? " comentario-erro" : ""}`}
          aria-invalid={!!erros.comentario}
          placeholder="O que você mais gostou? O que poderia melhorar?"
          className="min-h-28 w-full resize-y rounded-xl border border-[#D5D0C1] bg-white px-3.5 py-3 leading-relaxed text-[#17150F] placeholder:text-[#777163] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#17150F]"
        />
        <div id="comentario-ajuda" className="flex justify-between gap-3 text-xs text-[#6B6555]"><span>Não inclua dados pessoais sensíveis.</span><span className="tabular-nums">{comentario.length}/{COMENTARIO_AVALIACAO_MAX}</span></div>
        {erros.comentario && <p id="comentario-erro" role="alert" className="text-sm text-[#A13D28]">{erros.comentario}</p>}
      </div>

      {erroGeral && <div role="alert" className="rounded-xl border border-[#E7C9BF] bg-[#FBF1EE] p-4 text-sm leading-relaxed text-[#8D3524]">{erroGeral}</div>}
      <button type="submit" disabled={busy} className="inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-[#17150F] px-5 text-[15px] font-semibold text-[#FAF9F5] hover:bg-[#353127] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#17150F] disabled:cursor-wait disabled:opacity-60">
        {busy ? "Registrando avaliação…" : "Enviar avaliação"}
      </button>
    </form>
  );
}
