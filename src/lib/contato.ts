import { linkWhatsApp } from "@/lib/datetime";

export const telefoneFixo = (telefone: string | null | undefined) => (telefone ?? "").replace(/\D/g, "").length === 12;

export const whatsappDoNegocio = (telefone: string | null | undefined, texto: string) =>
  telefoneFixo(telefone) ? null : linkWhatsApp(telefone, texto);

export const telefoneDoNegocio = (telefone: string | null | undefined) => {
  const d = (telefone ?? "").replace(/\D/g, "");
  const numero = d.length === 10 || d.length === 11 ? `55${d}` : d.length === 12 || d.length === 13 ? d : "";
  return numero ? `tel:+${numero}` : null;
};
