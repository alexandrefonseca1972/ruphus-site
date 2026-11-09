import { collection } from "firebase/firestore";
import { z } from "zod";
import { db } from "@/lib/firebase-db";
import { DEMO } from "@/lib/demo";

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
  // UF e fuso escolhido: o painel mostra no fuso do negócio a hora em que a mensagem sai (fusoDe)
  site: z.object({ uf: z.string().nullish(), fuso: z.string().nullish() }).optional().catch(undefined),
  sinal: z.object({ ativo: z.boolean(), tipo: z.enum(["percentual", "fixo"]), valor: z.number(), prazoMin: z.number() }).optional().catch(undefined),
  // Central de conversas: a equipe (role member) só atende com isto ligado pelo dono; só o servidor grava
  conversas: z.object({ equipeAtende: z.boolean() }).optional().catch(undefined),
  // estado da conexão do WhatsApp (sem credenciais: essas moram em privado/whatsapp)
  whatsapp: z
    .object({ status: z.string().optional(), instanceId: z.string().optional(), ownerManaged: z.boolean().optional(), conectadoEm: z.number().optional() })
    .optional()
    .catch(undefined),
});
export type Tenant = z.infer<typeof Tenant> & { id: string };

/** O WhatsApp do negócio está conectado (atendys): mensagens ao cliente saem por ele. A demonstração
 *  nunca envia nada (lerConexao), então nela vale o WhatsApp do aparelho.
 *  ponytail: conexão antiga (wtsfy, sem apikey) também parece conectada aqui; o servidor recusa e a
 *  tela oferece o wa.me. Expor um "atendys" no doc público se isso voltar a existir. */
export const whatsappDoNegocio = (t: Pick<Tenant, "id" | "whatsapp">) => t.id !== DEMO && !!t.whatsapp?.instanceId && t.whatsapp.status === "connected";

// Todo dado de negócio vive em tenants/{id}/<coleção>
export const tenantCollection = (tenantId: string, name: string) =>
  collection(db, "tenants", tenantId, name);
