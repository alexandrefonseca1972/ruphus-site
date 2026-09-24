import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { z } from "zod";

const config = z
  .object({
    apiKey: z.string().min(1),
    authDomain: z.string().min(1),
    projectId: z.string().min(1),
    storageBucket: z.string().min(1),
    messagingSenderId: z.string().min(1),
    appId: z.string().min(1),
  })
  .parse({
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  });

export const app = getApps().length ? getApp() : initializeApp(config);
export const auth = getAuth(app);
// `db` mora em @/lib/firebase-db: aqui ele faria todo mundo que precisa só de
// login baixar 1 MB do SDK do Firestore junto.

export const idToken = () =>
  auth.currentUser?.getIdToken() ?? Promise.reject(new Error("Sessão expirada. Entre novamente."));
