"use client";

import {
  createUserWithEmailAndPassword,
  GoogleAuthProvider,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { errorMessage } from "@/lib/auth-errors";
import { auth } from "@/lib/firebase";
import { handleSubmit } from "@/lib/utils";

const Credentials = z.object({
  email: z.email("Informe um e-mail válido."),
  password: z.string().min(6, "A senha precisa de pelo menos 6 caracteres."),
});

function Login() {
  const router = useRouter();
  // Quem chegou por um convite volta para ele depois de entrar
  const proximo = useSearchParams().get("next");
  const destino = proximo?.startsWith("/") ? proximo : "/";
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<unknown>, redirect = true) {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await action();
      if (redirect) router.replace(destino);
    } catch (err) {
      if (!(err instanceof Error && "code" in err && err.code === "auth/popup-closed-by-user")) {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }

  function submit(form: FormData) {
    run(() => {
      const { email, password } = Credentials.parse(Object.fromEntries(form));
      return mode === "signin"
        ? signInWithEmailAndPassword(auth, email, password)
        : createUserWithEmailAndPassword(auth, email, password);
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
    <main className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{signin ? "Entrar no Siteflow" : "Criar conta"}</CardTitle>
          <CardDescription>{signin ? "Use seu e-mail ou sua conta Google." : "Leva menos de um minuto."}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => run(() => signInWithPopup(auth, new GoogleAuthProvider()))}
          >
            Continuar com Google
          </Button>
          <div className="text-center text-xs text-muted-foreground">ou</div>
          <form onSubmit={handleSubmit(submit)} className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="email">E-mail</Label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="grid gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password">Senha</Label>
                {signin && (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground underline-offset-4 hover:underline"
                    disabled={busy}
                    onClick={(e) => resetPassword(new FormData(e.currentTarget.form!).get("email") as string)}
                  >
                    Esqueci a senha
                  </button>
                )}
              </div>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={signin ? "current-password" : "new-password"}
                minLength={6}
                required
              />
            </div>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
            <Button type="submit" disabled={busy}>
              {signin ? "Entrar" : "Criar conta"}
            </Button>
          </form>
        </CardContent>
        <CardFooter className="justify-center text-sm">
          <button
            type="button"
            className="underline-offset-4 hover:underline"
            onClick={() => {
              setMode(signin ? "signup" : "signin");
              setError("");
              setNotice("");
            }}
          >
            {signin ? "Não tem conta? Criar conta" : "Já tem conta? Entrar"}
          </button>
        </CardFooter>
      </Card>
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
