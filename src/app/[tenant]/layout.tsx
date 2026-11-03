import { notFound } from "next/navigation";
import { adminDb } from "@/lib/admin";
import { PainelLayout } from "./painel-layout";

const SLUG = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/;

// Qualquer caminho de um nível cai aqui (/qualquer-coisa): sem negócio com esse nome, 404 de
// verdade, em vez de 200 com "Carregando…" e depois "não encontrado". Quem é membro e o resto
// continuam no cliente (PainelLayout), com o login do Firebase.
export default async function TenantLayout({ children, params }: LayoutProps<"/[tenant]">) {
  const { tenant } = await params;
  if (!SLUG.test(tenant)) notFound();
  // leitura que falhou (cota, rede) não derruba o painel: o PainelLayout confere de novo no cliente
  const existe = await adminDb.doc(`tenants/${tenant}`).get().then((d) => d.exists, () => true);
  if (!existe) notFound();
  return <PainelLayout>{children}</PainelLayout>;
}
