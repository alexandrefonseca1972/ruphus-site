"use client";

import { Menu } from "@base-ui/react/menu";
import { signOut } from "firebase/auth";
import Link from "next/link";
import { auth } from "@/lib/firebase";

const ITEM = "flex cursor-default rounded-md px-3 py-2 outline-none select-none data-[highlighted]:bg-muted";

/** Conta de quem entrou: trocar de negócio e sair. O layout já manda para /login quando a sessão acaba. */
export function AccountMenu() {
  const email = auth.currentUser?.email ?? "";
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
            <Menu.LinkItem render={<Link href="/painel" />} className={ITEM}>
              Meus negócios
            </Menu.LinkItem>
            <Menu.LinkItem render={<Link href="/ajuda" />} className={ITEM}>
              Ajuda
            </Menu.LinkItem>
            <Menu.Item onClick={() => signOut(auth)} className={`${ITEM} text-destructive`}>
              Sair
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
