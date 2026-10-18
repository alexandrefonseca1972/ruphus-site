// Manda um e-mail de teste pela conta da Ruphus, com o mesmo texto e o mesmo HTML
// da proposta. Roda no seu computador, com o .env.local preenchido:
//   npm run email:teste -- seu@email.com
import { enviarEmail } from "@/lib/email.server";
import { emailDaProposta } from "@/lib/proposta-email";

const para = process.argv[2];
if (!para || !para.includes("@")) {
  console.error("Uso: npm run email:teste -- <e-mail de destino>");
  process.exit(1);
}

// Prazo de 7 dias no fuso de Brasília, como a proposta real
const valeAte = new Date(Date.now() + 7 * 86_400_000).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
const { assunto, texto, html } = emailDaProposta({
  nome: "Negócio de teste",
  donoNome: "Teste",
  url: "https://www.ruphus.site/proposta/teste?t=exemplo",
  valeAte,
  entradaCents: 250_00,
  mensalCents: 89_90,
  assinatura: null,
});

await enviarEmail({ para, assunto: `[teste] ${assunto}`, texto, html });
console.log(`Enviado para ${para}`);
