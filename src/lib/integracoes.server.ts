import "server-only";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/admin";

// Chaves dos serviços de fora (SMS, e-mail, WhatsApp), cadastradas pelo /admin em vez do .env.
// Moram em config/integracoes: nenhuma regra do Firestore libera config/*, só o Admin SDK lê.
// O valor do painel vale mais que o do .env; sem ele, o .env segue valendo (migração sem susto).
//
// Fica de fora o que não dá para ler do banco: a credencial do próprio Firebase, as NEXT_PUBLIC_*
// (entram no build), OWNER_UID, o token que o proxy confere a cada requisição e o endereço do
// atendys (infraestrutura: trocá-lo pelo painel mandaria as chaves para outro servidor).

export const INTEGRACOES = {
  COMTELE_API_KEY: { grupo: "SMS (Comtele)", rotulo: "Chave da API", secreta: true },
  RESEND_API_KEY: { grupo: "E-mail", rotulo: "Chave do Resend", secreta: true },
  GMAIL_USER: { grupo: "E-mail", rotulo: "Conta do Gmail (reserva)", secreta: false },
  GMAIL_APP_PASSWORD: { grupo: "E-mail", rotulo: "Senha de app do Gmail", secreta: true },
  // quem responde fala com ele; no Gmail é o remetente (precisa estar em "Enviar e-mail como" na conta)
  EMAIL_CONTATO: { grupo: "E-mail", rotulo: "Endereço de contato (remetente do Gmail e resposta)", secreta: false },
  ATENDYS_ADMIN_KEY: { grupo: "WhatsApp (atendys)", rotulo: "Chave de administração", secreta: true },
  // sem ele, os alertas vão para a conta do Gmail acima
  ALERTA_EMAIL: { grupo: "Alertas", rotulo: "E-mail para alertas do sistema", secreta: false },
  // o assistente da seção "Visual" da gaveta do site (src/lib/ia.server.ts)
  ANTHROPIC_API_KEY: { grupo: "IA (Anthropic)", rotulo: "Chave da API", secreta: true },
} as const;

export type NomeIntegracao = keyof typeof INTEGRACOES;

const DOC = "config/integracoes";
const VALIDADE_MS = 60_000;
// a leitura em curso fica guardada: chamadas juntas fazem uma leitura só, e salvar troca a geração
// para uma leitura antiga, que termine depois, não repor o valor velho
let cache: { em: number; leitura: Promise<Record<string, unknown>> } | null = null;
let geracao = 0;

function doPainel() {
  if (!cache || Date.now() - cache.em > VALIDADE_MS) {
    const minha = geracao;
    const leitura = adminDb
      .doc(DOC)
      .get()
      .then((d) => d.data() ?? {})
      .catch((e) => {
        // Firestore fora: segue com o .env e tenta de novo na próxima chamada
        console.error("[integracoes] não li config/integracoes", e);
        if (geracao === minha) cache = null;
        return {};
      });
    cache = { em: Date.now(), leitura };
  }
  return cache.leitura;
}

/** O valor em uso: o do painel, ou o do .env. "" quando nenhum dos dois tem. */
export async function integracao(nome: NomeIntegracao): Promise<string> {
  const v = (await doPainel())[nome];
  return typeof v === "string" && v ? v : (process.env[nome] ?? "");
}

export type IntegracaoNaTela = {
  nome: NomeIntegracao;
  grupo: string;
  rotulo: string;
  secreta: boolean;
  origem: "painel" | "env" | "nenhuma";
  /** secreta: só os 4 últimos caracteres; o valor inteiro nunca volta ao navegador */
  mostra: string;
};

export async function integracoesNaTela(): Promise<IntegracaoNaTela[]> {
  const painel = await doPainel();
  return (Object.keys(INTEGRACOES) as NomeIntegracao[]).map((nome) => {
    const { grupo, rotulo, secreta } = INTEGRACOES[nome];
    const p = painel[nome];
    const valor = typeof p === "string" && p ? p : (process.env[nome] ?? "");
    const origem = typeof p === "string" && p ? "painel" : valor ? "env" : "nenhuma";
    // segredo curto não mostra nem o final: 4 letras de 8 já entregam metade
    const mostra = !valor ? "" : !secreta ? valor : valor.length >= 12 ? `••••${valor.slice(-4)}` : "••••";
    return { nome, grupo, rotulo, secreta, origem, mostra };
  });
}

/** Grava (ou apaga, com "") a chave no painel. Vale na hora neste processo. */
export async function gravarIntegracao(nome: NomeIntegracao, valor: string) {
  await adminDb.doc(DOC).set({ [nome]: valor || FieldValue.delete() }, { merge: true });
  geracao += 1;
  cache = null;
}
