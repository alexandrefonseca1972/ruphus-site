import "server-only";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";

// Vercel: FIREBASE_SERVICE_ACCOUNT com o JSON da conta de serviço.
// Local: GOOGLE_APPLICATION_CREDENTIALS com o caminho do arquivo.
const app =
  getApps()[0] ??
  initializeApp({
    credential: process.env.FIREBASE_SERVICE_ACCOUNT
      ? cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
      : applicationDefault(),
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  });

export const adminDb = getFirestore(app);
// Os sites da fábrica publicados sem deploy ficam em sites/{slug}/ (ver lib/site-arquivo).
// Aberto só no uso: sem o nome do bucket (os testes com emulador), importar este
// arquivo para usar o Firestore não pode quebrar.
export const adminBucket = () => getStorage(app).bucket(process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET);
