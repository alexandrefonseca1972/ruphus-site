// Clientes de exemplo dos modelos claros (pet, saúde e cursos), um por ramo: o vendedor
// mostra o site e a bio de cada nicho sem depender de um lead real. Saem pelo mesmo
// caminho da planilha (gerarNoBanco) e ficam fora do funil, como a barbearia-force.
// Telefones da faixa de teste (96) 99999-02xx: o botão de WhatsApp não chama ninguém.
// Idempotente: rodar de novo só atualiza os dados.
//
//   npm run exemplos:nichos               # só mostra o que faria
//   npm run exemplos:nichos -- --aplicar  # grava
//
// Dono dos negócios: OWNER_UID; sem ele, o mesmo dono da demonstração.
import { adminDb } from "@/lib/admin";
import { DEMO } from "@/lib/demo";
import type { Lead } from "@/lib/gerador";
import { gerarNoBanco } from "@/lib/gerador.server";

const aplicar = process.argv.includes("--aplicar");

const CIDADE = { cidade: "Macapá", uf: "AP", bairro: "Centro" };
// [slug, nome, categoria (decide o ramo), horário, serviços]
const EXEMPLOS: [string, string, string, string, string[]][] = [
  ["exemplo-petshop", "Patas & Cia Pet Shop", "Pet shop", "Seg a sáb, 8h às 19h", ["Banho", "Tosa higiênica", "Tosa completa", "Hidratação", "Leva e traz"]],
  ["exemplo-vet", "Clínica Veterinária Amigo Fiel", "Clínica veterinária", "Seg a sex, 8h às 18h; sáb até 12h", ["Consulta", "Vacinação", "Exames", "Castração", "Emergência"]],
  ["exemplo-odonto", "Odonto Sorriso", "Dentista", "Seg a sex, 8h às 18h", ["Avaliação", "Limpeza", "Clareamento", "Aparelho ortodôntico", "Implante"]],
  ["exemplo-fisio", "Fisio Vida", "Fisioterapia", "Seg a sex, 7h às 20h", ["Avaliação", "Fisioterapia ortopédica", "RPG", "Pilates clínico", "Liberação miofascial"]],
  ["exemplo-psico", "Espaço Mente Leve", "Psicóloga", "Seg a sex, 9h às 20h", ["Psicoterapia individual", "Terapia de casal", "Atendimento online", "Orientação de pais"]],
  ["exemplo-nutri", "Nutri Bem Viver", "Nutricionista", "Seg a sex, 8h às 18h", ["Consulta nutricional", "Avaliação física", "Plano alimentar", "Acompanhamento online"]],
  ["exemplo-clinica", "Clínica Saúde Total", "Clínica médica", "Seg a sex, 7h às 19h; sáb até 13h", ["Clínico geral", "Pediatria", "Cardiologia", "Exames laboratoriais", "Check-up"]],
  ["exemplo-cursos", "Instituto Pró-Carreira", "Cursos profissionalizantes", "Seg a sex, 8h às 22h; sáb até 13h", ["Auxiliar administrativo", "Informática", "Cabeleireiro", "Mecânica de motos", "Elétrica predial"]],
];

const leads = EXEMPLOS.map(([slug, nome, categoria, horario, servicos], i) => ({
  aba: "exemplos",
  linha: i + 1,
  lead: {
    nome, categoria, horario, servicos, slug, ...CIDADE,
    telefone: `5596999990${String(201 + i)}`,
    endereco: `Av. FAB, ${100 + i * 10} - Centro`,
    nota: 4.8, avaliacoes: 37 + i * 11,
    instagram: "", email: "", score: "", abordagem: "", maps: "",
  } satisfies Lead,
}));

const dono = process.env.OWNER_UID ?? (await adminDb.doc(`tenants/${DEMO}`).get()).get("ownerId");
if (!dono) throw new Error(`Defina OWNER_UID: a demonstração ${DEMO} não tem dono.`);

const linhas = await gerarNoBanco(adminDb, leads, aplicar, dono);
for (const l of linhas) console.log(`  ${l.acao === "pular" ? "✗" : "✓"} ${l.acao} ${l.slug || l.nome}${l.motivo ? `: ${l.motivo}` : ""}${l.aviso ? ` (${l.aviso})` : ""}`);
if (!aplicar) { console.log("nada foi gravado: rode de novo com --aplicar"); process.exit(0); }

// exemplo não é lead: fora do funil (o gerador cria a ficha do CRM junto com o site)
for (const l of linhas) if (l.acao !== "pular") await adminDb.doc(`crm/${l.slug}`).delete();
console.log(`${linhas.filter((l) => l.acao !== "pular").length} exemplo(s) no ar: https://exemplo-petshop.ruphus.site, …`);
process.exit(0);
