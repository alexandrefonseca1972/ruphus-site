import { CircleAlert, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

export function FormMessage({ children, tone = "error", id }: { children: React.ReactNode; tone?: "error" | "warning"; id?: string }) {
  const Icone = tone === "error" ? CircleAlert : TriangleAlert;
  return (
    <p
      id={id}
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "flex items-start gap-2 rounded-lg border p-3 text-sm leading-snug",
        tone === "error"
          ? "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
          : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
      )}
    >
      <Icone className="mt-0.5 size-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}
