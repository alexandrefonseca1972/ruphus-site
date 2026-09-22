import {
  collection,
  collectionGroup,
  getDoc,
  getDocs,
  query,
  where,
} from "firebase/firestore";
import { z } from "zod";
import { auth, db } from "@/lib/firebase";

// Esquema e máscara moram num módulo sem Firebase: o servidor e os testes os usam sem inicializar o app do navegador
export * from "./tenant-input";
import { Role } from "./tenant-input";

export const Tenant = z.object({ name: z.string(), ownerId: z.string() });
export type Tenant = z.infer<typeof Tenant> & { id: string };

function uid() {
  const id = auth.currentUser?.uid;
  if (!id) throw new Error("Não autenticado");
  return id;
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
