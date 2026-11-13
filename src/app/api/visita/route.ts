import { adminDb } from "@/lib/admin";
import { registrarVisita } from "@/lib/crm";
import { indiceDoPainel } from "@/lib/painel-indice.server";
import { rotaVisita } from "@/lib/prospeccao";

// O beacon do site demo (F1): o script injetado em /s/{slug}/index.html?c=1 avisa a visita depois
// de 3 s e de uma rolagem. Chamável por qualquer um: prévia de link e robô não contam, o corpo tem
// teto de tamanho, o slug passa pela forma da máscara e há teto por IP (IPv6 por /64) e por slug.
// Resposta sempre sem corpo. A lógica (e o teste dela) mora em rotaVisita.

export const POST = rotaVisita({
  registrar: (slug) => registrarVisita(adminDb, slug),
  // o índice do painel, quando montado, tem todos os tenants: slug fora dele nem vai ao Firestore
  conhecido: (slug) => {
    const indice = indiceDoPainel(adminDb).montado();
    return indice ? indice.lista().some((e) => e.slug === slug) : null;
  },
});
