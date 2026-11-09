// Mensagens que pararam na cota antes do Ruphus registrar (awaiting_manual): acha o negócio
// de cada id (a chave do atendys é por negócio: só o dono responde 200) e registra para o
// painel listar. Não envia nada. O wa.me tem número e texto: não vai para o log.
//
//   npx tsx --env-file=.env.local --conditions=react-server scripts/importar-mensagens-paradas.mts <id> [id…]
import { adminDb } from "@/lib/admin";
import { ErroAtendys, statusDaMensagem } from "@/lib/atendys";
import { registrarParada } from "@/lib/mensagens-paradas.server";
import { lerConexao } from "@/lib/whatsapp.server";

const ids = process.argv.slice(2);
if (!ids.length) throw new Error("Passe os ids das mensagens.");
const comWhatsapp = (await adminDb.collection("tenants").where("whatsapp.status", "==", "connected").select().get()).docs.map((d) => d.id);

for (const id of ids) {
  let achou = false;
  for (const slug of comWhatsapp) {
    const conn = await lerConexao(adminDb, slug);
    if (!conn) continue;
    // 404: não é deste negócio. Outro erro (fora do ar, timeout) para tudo: não dá para dizer "desconhecida"
    const s = await statusDaMensagem(conn, id).catch((e) => {
      if (e instanceof ErroAtendys && e.status === 404) return null;
      throw e;
    });
    if (!s) continue;
    achou = true;
    if (s.status !== "awaiting_manual") {
      console.log(`${id}: ${slug}, já está ${s.status} — nada a registrar`);
      break;
    }
    const u = s.manualHandoffUrl ? new URL(s.manualHandoffUrl) : null;
    await registrarParada(slug, { messageId: id, retryAt: s.retryAt ?? null, para: u?.pathname.replace(/\D/g, "") ?? "", texto: u?.searchParams.get("text") ?? "(mensagem anterior ao registro)" });
    console.log(`${id}: registrada em ${slug}`);
    break;
  }
  if (!achou) console.log(`${id}: nenhum negócio conectado reconhece esta mensagem`);
}
process.exit(0);
