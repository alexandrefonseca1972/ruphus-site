"use client";

import { Menu } from "@base-ui/react/menu";
import { LogOut } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { auth, idToken } from "@/lib/firebase";
import { meuContratoAction } from "./actions";
import { ConfirmDialog } from "./confirm-dialog";
import { sair } from "@/lib/sessao";
import { useAvisos } from "./avisos";
import { ligarSom, useSomLigado } from "./aviso-novo-agendamento";
import { useTenantSeHouver } from "./painel-layout";

const ITEM = "flex min-h-11 cursor-default items-center rounded-md px-3 py-2 outline-none select-none data-[highlighted]:bg-muted";

/** Conta de quem entrou: trocar de negócio e sair. O layout já manda para /login quando a sessão acaba.
 *  Também aparece no /painel, fora de um negócio: lá não tem "Meus negócios" nem avisos. */
export function AccountMenu() {
  const email = auth.currentUser?.email ?? "";
  const tenant = useTenantSeHouver();
  // o diálogo fica fora do menu: o menu fecha (e desmonta) ao clicar em "Sair"
  const [confirmarSaida, setConfirmarSaida] = useState(false);
  return (
    <>
      <Menu.Root>
        <Menu.Trigger
          aria-label="Conta"
          className="grid size-10 place-items-center rounded-full border bg-muted font-semibold uppercase hover:bg-accent data-[popup-open]:ring-2 data-[popup-open]:ring-ring/50"
        >
          {email.charAt(0) || "?"}
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner align="end" sideOffset={8} className="z-20">
            <Menu.Popup className="grid max-h-[var(--available-height)] min-w-56 max-w-[min(20rem,calc(100vw-1rem))] gap-0.5 overflow-y-auto rounded-lg border bg-background p-1 text-sm shadow-lg outline-none">
              <p className="truncate px-3 py-2 text-xs text-muted-foreground">{email}</p>
              <Menu.Separator className="my-1 h-px bg-border" />
              {/* o admin da plataforma não tem "meus negócios": o /painel o manda para o /admin */}
              {tenant?.adminPlataforma ? (
                <Menu.LinkItem render={<Link href="/admin" />} className={ITEM}>
                  Voltar ao admin
                </Menu.LinkItem>
              ) : (
                // com um negócio só não há para onde trocar: o /painel voltaria para cá
                tenant?.varios && (
                  <Menu.LinkItem render={<Link href="/painel" />} className={ITEM}>
                    Meus negócios
                  </Menu.LinkItem>
                )
              )}
              <Menu.LinkItem render={<Link href="/ajuda" />} className={ITEM}>
                Ajuda
              </Menu.LinkItem>
              {tenant && <ItemAvisos tenantId={tenant.id} />}
              {tenant && <ItemSom />}
              <Menu.Separator className="my-1 h-px bg-border" />
              {tenant && !tenant.adminPlataforma && <ItemContrato tenantId={tenant.id} />}
              <Menu.LinkItem render={<a href="/termos" target="_blank" rel="noopener" />} className={ITEM}>
                Termos de uso
              </Menu.LinkItem>
              <Menu.LinkItem render={<a href="/privacidade" target="_blank" rel="noopener" />} className={ITEM}>
                Política de privacidade
              </Menu.LinkItem>
              <Menu.Separator className="my-1 h-px bg-border" />
              {/* recarga de verdade: o Firestore foi encerrado para apagar o cache do aparelho */}
              <Menu.Item onClick={() => setConfirmarSaida(true)} className={`${ITEM} items-center gap-2 text-destructive`}>
                <LogOut className="size-4" aria-hidden="true" />
                Sair
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
      {confirmarSaida && (
        <ConfirmDialog
          title="Sair da conta?"
          description="Para voltar, você entra de novo com o seu e-mail."
          confirmLabel="Sair"
          onConfirm={() => sair()}
          onCancel={() => setConfirmarSaida(false)}
        />
      )}
    </>
  );
}

/** Aviso de novo agendamento neste aparelho; cada pessoa decide o seu. */
function ItemAvisos({ tenantId }: { tenantId: string }) {
  const avisos = useAvisos(tenantId);
  if (!avisos.suportado || avisos.ativo === null || avisos.bloqueado) return null;
  return (
    <Menu.Item
      closeOnClick={false}
      disabled={avisos.ocupado}
      onClick={() => (avisos.ativo ? avisos.desligar() : avisos.ligar())}
      className={`${ITEM} justify-between gap-4`}
    >
      Avisos de agendamento
      <span className="text-muted-foreground">{avisos.ocupado ? "…" : avisos.ativo ? "ligados" : "desligados"}</span>
    </Menu.Item>
  );
}

/** Som com o painel aberto quando um cliente marca pelo link; cada aparelho decide o seu. */
function ItemSom() {
  const ligado = useSomLigado();
  return (
    <Menu.Item closeOnClick={false} onClick={() => ligarSom(!ligado)} className={`${ITEM} justify-between gap-4`}>
      Som de agendamento
      <span className="text-muted-foreground">{ligado ? "ligado" : "desligado"}</span>
    </Menu.Item>
  );
}

/** O contrato que esta conta aceitou, na versão que leu: o link de cada versão não muda.
 *  Some para quem entrou pela equipe (não aceitou) e enquanto carrega. */
function ItemContrato({ tenantId }: { tenantId: string }) {
  const [c, setC] = useState<{ tenantId: string; versao: string; em: number | null } | null>(null);
  useEffect(() => {
    let vivo = true;
    idToken()
      .then((t) => meuContratoAction(t, { tenantId }))
      .then((r) => vivo && r.ok && r.contrato && setC({ tenantId, ...r.contrato }))
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [tenantId]);
  if (c?.tenantId !== tenantId) return null;
  return (
    <Menu.LinkItem render={<a href={`/termos/${c.versao}`} target="_blank" rel="noopener" />} className={`${ITEM} justify-between gap-4`}>
      Contrato aceito
      <span className="text-muted-foreground">
        v{c.versao}
        {c.em && ` · ${new Date(c.em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}`}
      </span>
    </Menu.LinkItem>
  );
}
