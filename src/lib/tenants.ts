import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import { z } from "zod";
import { auth, db } from "@/lib/firebase";

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

export const Tenant = z.object({ name: z.string(), ownerId: z.string() });
export type Tenant = z.infer<typeof Tenant> & { id: string };

function uid() {
  const id = auth.currentUser?.uid;
  if (!id) throw new Error("Não autenticado");
  return id;
}

// O slug é o id do documento, então a unicidade é garantida pelo Firestore
export async function createTenant(input: z.input<typeof TenantInput>) {
  const { slug, name } = TenantInput.parse(input);
  const owner = uid();
  const batch = writeBatch(db);
  batch.set(doc(db, "tenants", slug), { name, ownerId: owner, createdAt: serverTimestamp() });
  batch.set(doc(db, "tenants", slug, "members", owner), { uid: owner, role: "owner", createdAt: serverTimestamp() });
  await batch.commit();
  return slug;
}

/** Os negócios de quem entrou, com o nome e o papel de cada um. */
export async function myTenants() {
  const snap = await getDocs(query(collectionGroup(db, "members"), where("uid", "==", uid())));
  // Só membros em tenants/{id}/members (defesa extra contra coleções "members" aninhadas)
  const membros = snap.docs.filter((d) => d.ref.parent.parent?.parent.id === "tenants");
  // ponytail: uma leitura por negócio; quem tem muitos (o admin da plataforma) vai para o /admin antes
  const docs = await Promise.all(membros.map((d) => getDoc(d.ref.parent.parent!)));
  return membros
    .map((d, i) => ({ id: d.ref.parent.parent!.id, name: (docs[i].get("name") as string | undefined) ?? d.ref.parent.parent!.id, role: Role.catch("member").parse(d.get("role")) }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

// Todo dado de negócio vive em tenants/{id}/<coleção>
export const tenantCollection = (tenantId: string, name: string) =>
  collection(db, "tenants", tenantId, name);
