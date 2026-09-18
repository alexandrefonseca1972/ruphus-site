import {
  collection,
  collectionGroup,
  doc,
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

export const TenantInput = z.object({
  slug: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/, "Use de 2 a 63 letras minúsculas, números ou hífen")
    // Rotas fixas do app têm prioridade sobre /[tenant]
    .refine((s) => !["login", "agendar", "api"].includes(s), "Esse endereço é reservado"),
  name: z.string().trim().min(1).max(80),
});

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

export async function myTenantIds() {
  const snap = await getDocs(query(collectionGroup(db, "members"), where("uid", "==", uid())));
  // Só membros em tenants/{id}/members (defesa extra contra coleções "members" aninhadas)
  return snap.docs.flatMap((d) => (d.ref.parent.parent?.parent.id === "tenants" ? [d.ref.parent.parent.id] : []));
}

// Todo dado de negócio vive em tenants/{id}/<coleção>
export const tenantCollection = (tenantId: string, name: string) =>
  collection(db, "tenants", tenantId, name);
