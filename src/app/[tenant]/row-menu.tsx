"use client";

import { Menu } from "@base-ui/react/menu";
import { cn } from "@/lib/utils";

export type RowAction = { label: string; onClick: () => void; danger?: boolean };

/** As ações raras de uma linha ficam atrás do "⋯": a principal continua à vista. */
export function RowMenu({ label, actions }: { label: string; actions: RowAction[] }) {
  if (!actions.length) return null;
  return (
    <Menu.Root>
      <Menu.Trigger
        aria-label={label}
        className="grid size-10 shrink-0 place-items-center rounded-lg text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 data-[popup-open]:bg-muted"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="19" cy="12" r="1.6" />
        </svg>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner align="end" sideOffset={6} className="z-20">
          <Menu.Popup className="grid min-w-48 gap-0.5 rounded-lg border bg-popover p-1 text-sm text-popover-foreground shadow-lg outline-none">
            {actions.map((a) => (
              <Menu.Item
                key={a.label}
                onClick={a.onClick}
                className={cn("flex min-h-10 cursor-default items-center rounded-md px-3 outline-none select-none data-[highlighted]:bg-muted", a.danger && "text-destructive")}
              >
                {a.label}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
