// Firebase app bootstrap. Config comes from VITE_FIREBASE_* env vars; when
// they are absent the app runs in "local mode" (practice runs only, no
// sessions) so the game remains usable without any backend.

import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserSessionPersistence,
  connectAuthEmulator,
  getAuth,
  initializeAuth,
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

/**
 * Scope the signed-in user to the browser TAB rather than the whole browser.
 *
 * Firebase persists auth in IndexedDB, which every tab of an origin shares —
 * so signing in as an instructor in one tab and joining as a student in
 * another does not work: the second sign-in replaces the first. Worse,
 * `ensureAnonAuth` reuses `currentUser` when there is one, so a student tab
 * opened behind a signed-in instructor joins the room AS the instructor.
 *
 * Session persistence is per-tab, so each tab gets its own identity and one
 * browser can hold an instructor and any number of students at once. It
 * survives reload (so the rejoin path still works) but not closing the tab.
 *
 * Development only, and gated on `import.meta.env.DEV` as well as the flag so
 * it cannot reach a deployment where students would be signed out by a closed
 * tab. Real persistence is what production uses; turn the flag off in
 * `.env.development.local` to exercise that locally.
 */
const tabScopedAuth =
  import.meta.env.DEV && import.meta.env.VITE_TAB_SCOPED_AUTH === '1';

let app: FirebaseApp | null = null;
let authInst: Auth | null = null;
let dbInst: Firestore | null = null;
let fnsInst: Functions | null = null;

function ensureApp(): FirebaseApp {
  if (!firebaseEnabled) throw new Error('Firebase is not configured (VITE_FIREBASE_*)');
  if (!app) {
    app = initializeApp(config as Record<string, string>);

    // Auth is constructed here, before anything can reach for it, because
    // initializeAuth() throws if the app already has an Auth instance — so the
    // persistence choice has to be made at the single point of construction.
    authInst = tabScopedAuth
      ? initializeAuth(app, { persistence: browserSessionPersistence })
      : getAuth(app);

    // Emulator wiring is development-only, and deliberately gated on
    // `import.meta.env.DEV` rather than on the flag alone.
    //
    // Vite reads `.env.local` during `vite build` too, so an emulator flag left
    // there once got constant-folded into the deployed bundle as an
    // unconditional connect: every visitor's browser tried to reach its own
    // 127.0.0.1:9099, and sign-in failed for everyone with what looked like a
    // credentials error. The flag now lives in `.env.development.local` and
    // vite.config.ts refuses to build with it, but this gate means even a
    // mis-set env can no longer point a real deployment at localhost.
    if (import.meta.env.VITE_USE_EMULATORS === '1') {
      if (import.meta.env.DEV) {
        connectAuthEmulator(authInst, 'http://127.0.0.1:9099', {
          disableWarnings: true,
        });
        connectFirestoreEmulator(getFirestore(app), '127.0.0.1', 8080);
        connectFunctionsEmulator(getFunctions(app), '127.0.0.1', 5001);
      } else {
        console.error(
          'VITE_USE_EMULATORS=1 was compiled into a production build — ignoring ' +
            'it and using the real Firebase backend. Check which .env file set it.',
        );
      }
    }
  }
  return app;
}

export function auth(): Auth {
  ensureApp();
  // Non-null by construction: ensureApp always builds it alongside the app.
  return authInst as Auth;
}

export function db(): Firestore {
  if (!dbInst) dbInst = getFirestore(ensureApp());
  return dbInst;
}

export function fns(): Functions {
  if (!fnsInst) fnsInst = getFunctions(ensureApp());
  return fnsInst;
}
