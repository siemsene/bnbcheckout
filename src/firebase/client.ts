// Firebase app bootstrap. Config comes from VITE_FIREBASE_* env vars; when
// they are absent the app runs in "local mode" (practice runs only, no
// sessions) so the game remains usable without any backend.

import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  type Auth,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  getFirestore,
  type Firestore,
} from 'firebase/firestore';
import {
  connectFunctionsEmulator,
  getFunctions,
  type Functions,
} from 'firebase/functions';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET as string | undefined,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID as
    | string
    | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const firebaseEnabled = Boolean(config.apiKey && config.projectId);

let app: FirebaseApp | null = null;
let authInst: Auth | null = null;
let dbInst: Firestore | null = null;
let fnsInst: Functions | null = null;

function ensureApp(): FirebaseApp {
  if (!firebaseEnabled) throw new Error('Firebase is not configured (VITE_FIREBASE_*)');
  if (!app) {
    app = initializeApp(config as Record<string, string>);
    if (import.meta.env.VITE_USE_EMULATORS === '1') {
      connectAuthEmulator(getAuth(app), 'http://127.0.0.1:9099', {
        disableWarnings: true,
      });
      connectFirestoreEmulator(getFirestore(app), '127.0.0.1', 8080);
      connectFunctionsEmulator(getFunctions(app), '127.0.0.1', 5001);
    }
  }
  return app;
}

export function auth(): Auth {
  if (!authInst) authInst = getAuth(ensureApp());
  return authInst;
}

export function db(): Firestore {
  if (!dbInst) dbInst = getFirestore(ensureApp());
  return dbInst;
}

export function fns(): Functions {
  if (!fnsInst) fnsInst = getFunctions(ensureApp());
  return fnsInst;
}
