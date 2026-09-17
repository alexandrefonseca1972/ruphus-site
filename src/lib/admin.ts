import "server-only";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";

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
export const adminAuth = getAuth(app);
