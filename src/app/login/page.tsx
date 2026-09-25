"use client";

import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  updateProfile,
} from "firebase/auth";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ehAdminDaPlataforma } from "@/app/admin/actions";
import { negocioDoConvite } from "@/app/convite/actions";
import { Suspense, useEffect, useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorMessage } from "@/lib/auth-errors";
import { auth } from "@/lib/firebase";
import { handleSubmit } from "@/lib/utils";

const Credentials = z.object({
  email: z.email("Informe um e-mail válido."),
  password: z.string().min(6, "A senha precisa de pelo menos 6 caracteres."),
});
// No cadastro o nome também: sem ele, quem entra por senha aparece só como
// e-mail em "Quem tem acesso", e nas trilhas de auditoria nem isso.
const Cadastro = Credentials.extend({
  nome: z.string().trim().min(2, "Informe seu nome.").max(80),
});

const Vitrine = z.array(z.object({ slug: z.string(), nome: z.string(), sobre: z.string(), capa: z.string() }));
type Vitrine = z.infer<typeof Vitrine>;

const ROTULO = "font-[family-name:var(--font-geist-mono)] text-[9px] font-medium tracking-[0.14em] text-[#6B6555] uppercase";
const CAMPO =
  "h-12 rounded-[10px] border-[#D5D0C1] bg-white px-3.5 text-[15px] text-[#17150F] focus-visible:border-[#17150F] focus-visible:ring-[3px] focus-visible:ring-[#17150F]/8";

function Login() {
  const router = useRouter();
  // Quem chegou por um convite volta para ele depois de entrar
  const params = useSearchParams();
  const proximo = params.get("next");
  // Voltou porque a sessão expirou: diga isso, senão parece que o login caiu sozinho
  const expirou = Number(params.get("expirou")) || 0;
  // Quem chega por "?trocar=1" quer entrar com outra conta: não é para levar embora
  const trocar = params.get("trocar") === "1";

  // Quem administra a plataforma trabalha no /admin; quem é dono de um negócio,
  // no /painel. O convite, quando existe, vence os dois.
  async function paraOnde() {
    // "//evil.com" e "/\\evil.com" também começam com "/" e levam para fora do site
    if (proximo && /^\/(?![/\\])/.test(proximo)) return proximo;
    const user = auth.currentUser;
    if (!user) return "/painel";
    const r = await ehAdminDaPlataforma(await user.getIdToken()).catch(() => ({ ok: false as const }));
    return r.ok ? "/admin" : "/painel";
  }

  // "?criar=1" vem do "Criar minha conta" da landing: abrir em "Entrar" fazia a pessoa procurar o cadastro
  const [mode, setMode] = useState<"signin" | "signup">(params.get("criar") === "1" ? "signup" : "signin");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [convidado, setConvidado] = useState<{ nome: string } | null>(null);
  const rodando = useRef(false);        // uma ação do formulário está em curso
  const escolheuModo = useRef(false);   // a pessoa já escolheu entrar ou criar conta
  const [verSenha, setVerSenha] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [vitrine, setVitrine] = useState<Vitrine>([]);

  // De quem é o convite: o nome do negócio é o que a pessoa reconhece, e ela
  // chegou aqui por um link no WhatsApp, não procurando a Ruphus.
  useEffect(() => {
    const token = proximo?.startsWith("/convite") ? new URLSearchParams(proximo.split("?")[1]).get("c") : null;
    if (!token) return;
    let vivo = true;
    negocioDoConvite(token).then(
      (r) => {
        if (!vivo) return;
        if (r.ok) {
          setConvidado({ nome: r.nome });
          // quem já clicou em "Já tem conta? Entrar" enquanto isto voltava do
          // servidor não é jogado de volta para o cadastro
          if (!escolheuModo.current) setMode("signup");
        } else {
          // convite vencido ou já usado: sem isto a tela vira um login comum e
          // a pessoa não entende por que o link "não fez nada"
          setError("Este convite não vale mais. Peça outro à Ruphus — eles valem 7 dias.");
        }
      },
      () => {},
    );
    return () => {
      vivo = false;
    };
  }, [proximo]);

  // Já entrou: esta tela não tem nada a oferecer. Vai para onde a conta pertence.
  // Enquanto uma ação roda, não: criar conta já deixa a pessoa logada, e sair
  // daqui no meio abortaria o nome e a verificação de e-mail que vêm depois.
  // "?trocar=1" desliga isto: é a única forma de entrar com outra conta.
  useEffect(() => {
    if (trocar) return;
    let vivo = true;
    const parar = onAuthStateChanged(auth, async (u) => {
      if (!u || rodando.current) return;
      const destino = await paraOnde();
      // de novo depois do await: paraOnde faz uma volta ao servidor, e nesse
      // meio-tempo a pessoa pode ter começado a criar a conta
      if (vivo && !rodando.current) router.replace(destino);
    });
    return () => {
      vivo = false;
      parar();
    };
    // paraOnde lê apenas `proximo`, que não muda sem recarregar a tela
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, proximo, trocar]);

  // A folha de contato do desktop. Falhar aqui não custa nada: a tela fica lisa.
  useEffect(() => {
    let vivo = true;
    fetch("/_vitrine.json")
      .then((r) => r.json())
      .then((d) => {
        const lida = Vitrine.safeParse(d);
        if (vivo && lida.success) setVitrine(lida.data);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, []);

  async function run(action: () => Promise<unknown>, redirect = true) {
    setError("");
    setNotice("");
    setBusy(true);
    rodando.current = true;
    try {
      await action();
      if (redirect) router.replace(await paraOnde());
    } catch (err) {
      if (!(err instanceof Error && "code" in err && err.code === "auth/popup-closed-by-user")) {
        setError(errorMessage(err));
      }
    } finally {
      rodando.current = false;
      setBusy(false);
    }
  }

  function submit(form: FormData) {
    run(async () => {
      const dados = Object.fromEntries(form);
      if (mode === "signin") {
        const { email, password } = Credentials.parse(dados);
        await signInWithEmailAndPassword(auth, email, password);
        return;
      }
      const { email, password, nome } = Cadastro.parse(dados);
      const { user } = await createUserWithEmailAndPassword(auth, email, password);
      // Daqui para baixo nada pode barrar a entrada: a conta já existe, e falhar
      // deixaria a pessoa logada olhando o formulário, sem conseguir criar de novo.
      await updateProfile(user, { displayName: nome })
        // o nome só entra no token depois de renovar, e é dele que o servidor lê
        .then(() => user.getIdToken(true))
        .catch(() => {});
      await sendEmailVerification(user).catch(() => {});
    });
  }

  function resetPassword(email: string) {
    run(async () => {
      await sendPasswordResetEmail(auth, Credentials.shape.email.parse(email));
      setNotice("Se houver conta com esse e-mail, enviamos um link para redefinir a senha.");
    }, false);
  }

  const signin = mode === "signin";

  return (
    <main className="relative flex flex-1 items-center justify-center overflow-hidden bg-[#F2F0E7] p-4">

      {/* Os sites que já estão no ar. Decorativo para quem usa leitor de tela:
          o conteúdo útil da página é o formulário. */}
      {vitrine.length > 0 && (
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 hidden select-none auto-rows-[158px] grid-cols-6 content-center gap-3 p-7 lg:grid">
          {vitrine.map((v) => (
            <div key={v.slug} className="flex flex-col gap-2 overflow-hidden rounded-xl border border-[#E4E1D5] bg-[#F8F6EF] p-3.5">
              {/* eslint-disable-next-line @next/next/no-img-element -- captura já gerada em public/s/_p, servida estática */}
              <img src={v.capa} alt="" width={260} height={150} loading="lazy" decoding="async" className="h-[62px] w-full rounded-lg object-cover object-top opacity-70" />
              <span className="truncate text-xs font-semibold text-[#3F3B2F]">{v.nome}</span>
            </div>
          ))}
        </div>
      )}

      {vitrine.length > 0 && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 hidden lg:block"
          style={{
            background:
              "radial-gradient(130% 95% at 50% 50%, rgba(242,240,231,0.99) 0%, rgba(242,240,231,0.97) 30%, rgba(242,240,231,0.78) 62%, rgba(242,240,231,0.5) 100%)",
          }}
        />
      )}

      <section className="relative flex w-full max-w-[408px] flex-col gap-6 rounded-[18px] p-1 lg:border lg:border-[#E0DCCE] lg:bg-[#FAF9F5] lg:p-9 lg:shadow-[0_48px_80px_-40px_rgba(22,21,15,0.3)]">

        {/* A marca também é a saída: sem isto a tela de entrada é um beco sem
            saída para quem só queria voltar ao site. */}
        <Link href="/" className="flex w-fit items-center gap-2 text-[#17150F] hover:text-[#2C6A53]" aria-label="Voltar para o site da Ruphus">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-[#6B6555]">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          <span className="font-[family-name:var(--fonte-titulo)] text-[25px] leading-none tracking-[0.03em]">ruphus</span>
          <span className="mb-1 size-1.5 rounded-full bg-[#2C6A53]" />
        </Link>

        {convidado && (
          <div className="flex items-center gap-3 rounded-xl border border-[#DFE9E2] bg-[#F2F7F4] p-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-[#2C6A53] font-[family-name:var(--fonte-titulo)] text-[15px] text-[#FAF9F5]">
              {convidado.nome.slice(0, 2).toUpperCase()}
            </span>
            <span className="grid min-w-0">
              <span className="font-[family-name:var(--font-geist-mono)] text-[9px] tracking-[0.12em] text-[#2C6A53] uppercase">convite para administrar</span>
              <span className="truncate text-sm font-semibold">{convidado.nome}</span>
            </span>
          </div>
        )}

        <div className="grid gap-1.5">
          {expirou > 0 && (
            <p role="status" className="mb-1 rounded-xl border border-[#E2DDD3] bg-[#F7F5EF] p-3 text-[13px] leading-snug text-[#5C5747]">
              Sua sessão foi encerrada depois de {expirou} minutos sem uso. Entre de novo para continuar.
            </p>
          )}
          <h1 className="text-[36px] leading-[1.04] font-semibold tracking-[-0.032em]">
            {convidado && !signin ? "Entre para abrir sua agenda" : signin ? "Entrar na Ruphus" : "Criar conta"}
          </h1>
          <p className="text-sm leading-relaxed text-[#5C5747]">
            {convidado && !signin
              ? "Use o Google ou crie uma senha. O acesso fica no seu nome."
              : convidado
                ? "Entre com a conta que você já tem: o convite continua valendo."
                : signin
                  ? "Use seu e-mail ou sua conta Google."
                  : "Leva menos de um minuto."}
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => run(() => signInWithPopup(auth, new GoogleAuthProvider()))}
          className="h-12 gap-2.5 rounded-[10px] border-[#D5D0C1] bg-white text-sm font-semibold"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M23 12.2c0-.8-.1-1.6-.2-2.3H12v4.4h6.1a5.3 5.3 0 0 1-2.3 3.4v2.9h3.7c2.2-2 3.5-5 3.5-8.4z" />
            <path fill="#34A853" d="M12 24c3.2 0 5.9-1.1 7.8-2.9l-3.7-2.9c-1 .7-2.4 1.1-4.1 1.1-3.1 0-5.8-2.1-6.7-5H1.5v3a12 12 0 0 0 10.5 6.7z" />
            <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6v-3H1.5a12 12 0 0 0 0 10.6z" />
            <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.5 1.8l3.3-3.3A12 12 0 0 0 1.5 6.7l3.8 3a7.1 7.1 0 0 1 6.7-4.9z" />
          </svg>
          Continuar com Google
        </Button>

        <div className="flex items-center gap-3.5">
          <span className="h-px grow bg-[#E6E3D9]" />
          <span className="font-[family-name:var(--font-geist-mono)] text-[9px] font-medium tracking-[0.16em] text-[#9A9484] uppercase">ou por e-mail</span>
          <span className="h-px grow bg-[#E6E3D9]" />
        </div>

        {/* o handler é montado no evento, não no render: submit lê uma ref, e
            montá-lo durante o render quebra a regra de refs do compilador */}
        <form onSubmit={(ev) => handleSubmit(submit)(ev)} className="grid gap-4">
          {!signin && (
            <div className="grid gap-1.5">
              <label htmlFor="nome" className={ROTULO}>Seu nome</label>
              <Input id="nome" name="nome" type="text" autoComplete="name" maxLength={80} required className={CAMPO} />
            </div>
          )}

          <div className="grid gap-1.5">
            <label htmlFor="email" className={ROTULO}>E-mail</label>
            <Input id="email" name="email" type="email" autoComplete="email" required className={CAMPO} />
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor="password" className={ROTULO}>{signin ? "Senha" : "Crie uma senha"}</label>
              {signin && (
                <button
                  type="button"
                  className="text-xs text-[#6B6555] underline underline-offset-[3px]"
                  disabled={busy}
                  onClick={(e) => {
                    const form = e.currentTarget.form!;
                    const email = String(new FormData(form).get("email") ?? "");
                    if (!email.trim()) {
                      setError("Escreva seu e-mail para receber o link.");
                      (form.elements.namedItem("email") as HTMLInputElement).focus();
                      return;
                    }
                    resetPassword(email);
                  }}
                >
                  Esqueci a senha
                </button>
              )}
            </div>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={verSenha ? "text" : "password"}
                autoComplete={signin ? "current-password" : "new-password"}
                minLength={6}
                required
                onKeyDown={(e) => setCapsLock(e.getModifierState?.("CapsLock") ?? false)}
                onKeyUp={(e) => setCapsLock(e.getModifierState?.("CapsLock") ?? false)}
                onBlur={() => setCapsLock(false)}
                className={`${CAMPO} pr-12`}
              />
              <button
                type="button"
                aria-pressed={verSenha}
                aria-label={verSenha ? "Ocultar a senha" : "Mostrar a senha"}
                onClick={() => setVerSenha((v) => !v)}
                className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-[#6B6555] hover:text-[#17150F]"
              >
                {verSenha ? (
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
                    <path d="M3 3l18 18" /><path d="M10.6 10.7a2 2 0 0 0 2.8 2.8" />
                    <path d="M6.7 6.8C4.6 8.1 3 10 2 12c1.8 3.6 5.5 6 10 6 1.7 0 3.2-.3 4.6-1" />
                    <path d="M9.9 6.2A9.9 9.9 0 0 1 12 6c4.5 0 8.2 2.4 10 6a14 14 0 0 1-3.2 4" />
                  </svg>
                ) : (
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
                    <path d="M2 12c1.8-3.6 5.5-6 10-6s8.2 2.4 10 6c-1.8 3.6-5.5 6-10 6s-8.2-2.4-10-6z" />
                    <circle cx="12" cy="12" r="2.6" />
                  </svg>
                )}
              </button>
            </div>
            {capsLock && <span className="text-xs text-[#8A5A22]">Caps Lock está ligado.</span>}
            {!signin && <span className="text-xs text-[#8C8574]">Pelo menos 6 caracteres.</span>}
          </div>

          {error && (
            <p role="alert" className="flex items-start gap-2 rounded-xl border border-[#E3C6BD] bg-[#FBEFEB] p-3 text-[13px] leading-snug text-[#8A3A22]">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" className="mt-px shrink-0" aria-hidden="true">
                <circle cx="12" cy="12" r="9" /><path d="M12 8v4.5" /><path d="M12 16.2v.1" />
              </svg>
              {error}
            </p>
          )}

          {notice && (
            <p role="status" className="flex items-start gap-2 rounded-xl border border-[#CADCD1] bg-[#EFF5F1] p-3 text-[13px] leading-snug text-[#235B45]">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="mt-px shrink-0" aria-hidden="true">
                <path d="M3 7l9 6 9-6" /><rect x="3" y="5" width="18" height="14" rx="2" />
              </svg>
              {notice}
            </p>
          )}

          <Button
            type="submit"
            disabled={busy}
            className={`h-[50px] gap-2.5 rounded-[10px] text-[15px] font-semibold ${convidado ? "bg-[#2C6A53] hover:bg-[#245C47]" : ""}`}
          >
            {busy ? "Um instante…" : convidado && !signin ? "Criar conta e entrar" : signin ? "Entrar" : "Criar conta"}
            <span className="flex size-5 items-center justify-center rounded-md bg-white/15 font-[family-name:var(--font-geist-mono)] text-[11px]">&#8629;</span>
          </Button>
        </form>

        {/* Convidado que já é cliente também troca de modo: sem isto, "este e-mail
            já tem conta" virava um beco sem saída */}
        <div className="flex items-baseline gap-2">
          <span className="text-sm text-[#5C5747]">{signin ? "Não tem conta?" : "Já tem conta?"}</span>
          <button
            type="button"
            className="text-sm font-semibold underline underline-offset-4"
            onClick={() => {
              escolheuModo.current = true;
              setMode(signin ? "signup" : "signin");
              setError("");
              setNotice("");
            }}
          >
            {signin ? "Criar conta" : "Entrar"}
          </button>
        </div>

        <div className="grid gap-3">
          <span className="h-px bg-[#EFEDE4]" />
          <span className="flex items-center gap-2.5 text-[11px] leading-snug text-[#8C8574]">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="shrink-0" aria-hidden="true">
              <rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" />
            </svg>
            {convidado
              ? "Este convite vale uma vez e é só seu."
              : "Sua agenda e seus clientes só aparecem depois de você entrar."}
          </span>
        </div>
      </section>

      {vitrine.length > 0 && (
        <span className="absolute bottom-7 left-7 hidden items-center gap-3 rounded-full border border-[#E0DCCE] bg-[#FAF9F5] px-4 py-2.5 lg:flex">
          <span className="font-[family-name:var(--font-geist-mono)] text-[13px] font-medium">675</span>
          <span className="h-3.5 w-px bg-[#E0DCCE]" />
          <span className="font-[family-name:var(--font-geist-mono)] text-[10px] tracking-[0.12em] text-[#6B6555] uppercase">sites no ar atrás desta tela</span>
        </span>
      )}
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <Login />
    </Suspense>
  );
}
