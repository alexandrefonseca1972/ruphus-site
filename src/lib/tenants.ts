import { z } from "zod";

// Esquema e máscara moram num módulo sem Firebase: o servidor e os testes os usam sem inicializar o app do navegador
export * from "./tenant-input";

export const Tenant = z.object({
  name: z.string(),
  ownerId: z.string(),
  limiteStaff: z.number().int().positive().optional(),
  // Caixa e agendamento ligados para todos; o /admin desliga por negócio (src/lib/modulos.ts).
  // modulos.financeiro fica só como dado legado. .catch: um campo fora do formato não derruba o painel
  modulos: z.object({ caixa: z.boolean().optional(), agendamento: z.boolean().optional() }).optional().catch(undefined),
  gerado: z.object({ nicho: z.string().optional() }).optional().catch(undefined),
  // domínio próprio do cliente (www.salao.com.br): ativo, é o endereço do site
  dominio: z.object({ host: z.string(), status: z.enum(["pendente", "ativo"]) }).optional().catch(undefined),
  // chave Pix do salão (o QR do balcão sai dela); só o servidor grava
  pix: z.object({ chave: z.string(), nome: z.string(), cidade: z.string() }).optional().catch(undefined),
  // UF e fuso escolhido: o painel mostra no fuso do negócio a hora em que a mensagem sai (fusoDe)
  site: z.object({ uf: z.string().nullish(), fuso: z.string().nullish() }).optional().catch(undefined),
  sinal: z.object({ ativo: z.boolean(), tipo: z.enum(["percentual", "fixo"]), valor: z.number(), prazoMin: z.number() }).optional().catch(undefined),
  // WhatsApp do negócio (o WhatsApp pessoal do dono mora em privado/whatsapp)
  // canalOficial: os avisos saem pelo número da plataforma; as mensagens paradas aparecem na agenda
  whatsapp: z.object({ canalOficial: z.boolean().optional() }).optional().catch(undefined),
  avaliacoes: z.object({ enabled: z.boolean(), delayMin: z.number().int() }).optional().catch(undefined),
  // SMS de confirmação e lembrete ligado (o resto da configuração é lido no servidor: configSms)
  sms: z.object({ ligado: z.boolean().optional() }).optional().catch(undefined),
});
export type Tenant = z.infer<typeof Tenant> & { id: string };
