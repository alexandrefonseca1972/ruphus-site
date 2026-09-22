import { z } from "zod";

export const Role = z.enum(["owner", "admin", "member"]);
export type Role = z.infer<typeof Role>;

// Rotas do app, páginas de public/ e subdomínios do próprio app: um negócio com
// um desses endereços ficaria escondido atrás da rota (ou do subdomínio) de mesmo nome
const RESERVADOS = ["admin", "agendar", "api", "app", "bio", "convite", "indisponivel", "login", "marca", "pagar", "painel", "privacidade", "s", "sobre", "www"];

export const TenantInput = z.object({
  slug: z
    .string()
    .min(2, "Use pelo menos 2 caracteres")
    .max(63, "Use no máximo 63 caracteres")
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "Comece e termine com letra ou número")
    .refine((s) => !s.includes("--"), "Não use dois hífens seguidos")
    .refine((s) => !RESERVADOS.includes(s), "Esse endereço é reservado"),
  name: z.string().trim().min(2, "Informe o nome do negócio").max(80, "Use no máximo 80 caracteres"),
});

/** Máscara do endereço enquanto digita: minúsculas sem acento, espaço vira hífen,
 * o resto some. O hífen do fim fica (a pessoa ainda está digitando); `slugify` tira. */
export const mascaraSlug = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9-]/g, "").replace(/-{2,}/g, "-").replace(/^-/, "").slice(0, 63);
export const slugify = (s: string) => mascaraSlug(s).replace(/-$/, "");
