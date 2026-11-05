import { collection } from "firebase/firestore";
import { z } from "zod";
import { db } from "@/lib/firebase-db";

// Esquema e máscara moram num módulo sem Firebase: o servidor e os testes os usam sem inicializar o app do navegador
export * from "./tenant-input";

export const Tenant = z.object({
  name: z.string(),
  ownerId: z.string(),
  limiteStaff: z.number().int().positive().optional(),
  // módulos que o admin da plataforma liga por cliente; o nicho escolhe as categorias do Caixa
  // .catch: um campo fora do formato não pode derrubar o painel inteiro
  modulos: z.object({ financeiro: z.boolean().optional() }).optional().catch(undefined),
  gerado: z.object({ nicho: z.string().optional() }).optional().catch(undefined),
  // domínio próprio do cliente (www.salao.com.br): ativo, é o endereço do site
  dominio: z.object({ host: z.string(), status: z.enum(["pendente", "ativo"]) }).optional().catch(undefined),
  // chave Pix do salão (o QR do balcão sai dela); só o servidor grava
  pix: z.object({ chave: z.string(), nome: z.string(), cidade: z.string() }).optional().catch(undefined),
  sinal: z.object({ ativo: z.boolean(), tipo: z.enum(["percentual", "fixo"]), valor: z.number(), prazoMin: z.number() }).optional().catch(undefined),
  // estado da conexão do WhatsApp (sem credenciais: essas moram em privado/whatsapp)
  whatsapp: z
    .object({ status: z.string().optional(), instanceId: z.string().optional(), ownerManaged: z.boolean().optional(), conectadoEm: z.number().optional() })
    .optional()
    .catch(undefined),
});
export type Tenant = z.infer<typeof Tenant> & { id: string };

// Todo dado de negócio vive em tenants/{id}/<coleção>
export const tenantCollection = (tenantId: string, name: string) =>
  collection(db, "tenants", tenantId, name);
