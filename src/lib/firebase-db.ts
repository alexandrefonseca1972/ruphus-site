import { getFirestore } from "firebase/firestore";
import { app } from "@/lib/firebase";

/** O Firestore do navegador, em módulo separado de propósito.
 *
 * O SDK do Firestore é ~1 MB de JS, e quem só precisa de login (o /admin, o
 * /login, o /painel) não deve baixá-lo. Enquanto ele morava em firebase.ts,
 * qualquer import de `auth` arrastava o Firestore junto: o módulo inteiro é
 * avaliado, e getFirestore(app) no topo é efeito colateral que nenhum bundler
 * remove. Importe daqui só quem realmente lê ou escreve documentos no cliente. */
export const db = getFirestore(app);
