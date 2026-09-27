// A conta de demonstração: é por ela que o vendedor mostra o produto. O site nasce do
// cadastro, com a faixa de prévia e o WhatsApp de teste (96) 99999-0000 — não publicar
// nem trocar o número. Os dados de exemplo e a restauração ficam em demo.server.ts.
export const DEMO = "barbearia-force";
export const DEMO_EMAIL = "demo@ruphus.site";

const base = `https://${DEMO}.ruphus.site`;
export const LINKS_DEMO = [
  { rotulo: "Site", href: `${base}/` },
  { rotulo: "Bio", href: `${base}/bio` },
  { rotulo: "Agendamento", href: `${base}/agendar` },
  { rotulo: "Painel do dono", href: `/${DEMO}` },
] as const;
