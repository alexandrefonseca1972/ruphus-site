import { clearIndexedDbPersistence, getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager, terminate } from "firebase/firestore";
import { app } from "@/lib/firebase";

/** O Firestore do navegador, em módulo separado de propósito.
 *
 * O SDK do Firestore é ~1 MB de JS, e quem só precisa de login (o /admin, o
 * /login, o /painel) não deve baixá-lo. Enquanto ele morava em firebase.ts,
 * qualquer import de `auth` arrastava o Firestore junto: o módulo inteiro é
 * avaliado, e getFirestore(app) no topo é efeito colateral que nenhum bundler
 * remove. Importe daqui só quem realmente lê ou escreve documentos no cliente.
 *
 * Cache no aparelho (IndexedDB): o painel instalado abre a agenda e os clientes já
 * vistos sem internet, e as mudanças feitas offline sobem quando a rede volta.
 * Várias abas dividem o mesmo cache. Ao sair da conta, `limparCacheLocal` apaga tudo. */
export const db = (() => {
  try {
    return initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch {
    // já iniciado (recarga de módulo no next dev): o mesmo, sem segunda configuração
    return getFirestore(app);
  }
})();

/** Apaga do aparelho os dados do negócio. Só funciona com o Firestore encerrado, então
 *  depois disto a página tem de recarregar. Com outra aba do painel aberta o navegador
 *  recusa: aí o cache fica até a próxima saída. */
export async function limparCacheLocal() {
  await terminate(db);
  await clearIndexedDbPersistence(db).catch(() => {});
}
