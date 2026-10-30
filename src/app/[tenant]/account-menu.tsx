"use client";

import { Menu } from "@base-ui/react/menu";
import Link from "next/link";
import { auth } from "@/lib/firebase";
import { sair } from "@/lib/sessao";
import { useAvisos } from "./avisos";
import { useTenantSeHouver } from "./layout";

const ITEM = "flex cursor-default rounded-md px-3 py-2 outline-none select-none data-[highlighted]:bg-muted";

/** Conta de quem entrou: trocar de negócio e sair. O layout já manda para /login quando a sessão acaba.
 *  Também aparece no /painel, fora de um negócio: lá não tem "Meus negócios" nem avisos. */
export function AccountMenu() {
  const email = auth.currentUser?.email ?? "";
  const tenant = useTenantSeHouver();
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label="Conta"
        className="grid size-10 place-items-center rounded-full border bg-muted font-semibold uppercase hover:bg-accent data-[popup-open]:ring-2 data-[popup-open]:ring-ring/50"
      >
        {email.charAt(0) || "?"}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={8} className="z-20">
          <Menu.Popup className="grid min-w-56 gap-0.5 rounded-lg border bg-background p-1 text-sm shadow-lg outline-none">
            <p className="truncate px-3 py-2 text-xs text-muted-foreground">{email}</p>
            <Menu.Separator className="my-1 h-px bg-border" />
            {/* o admin da plataforma não tem "meus negócios": o /painel o manda para o /admin */}
            {tenant?.adminPlataforma ? (
              <Menu.LinkItem render={<Link href="/admin" />} className={ITEM}>
                Voltar ao admin
              </Menu.LinkItem>
            ) : (
              tenant && (
                <Menu.LinkItem render={<Link href="/painel" />} className={ITEM}>
                  Meus negócios
                </Menu.LinkItem>
              )
            )}
            <Menu.LinkItem render={<Link href="/ajuda" />} className={ITEM}>
              Ajuda
            </Menu.LinkItem>
            {tenant && <ItemAvisos tenantId={tenant.id} />}
            {/* recarga de verdade: o Firestore foi encerrado para apagar o cache do aparelho */}
            <Menu.Item onClick={() => sair().then(() => window.location.replace("/login"))} className={`${ITEM} text-destructive`}>
              Sair
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
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
