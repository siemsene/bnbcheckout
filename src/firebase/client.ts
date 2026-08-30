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

/** Routes a student uses. Everything else is instructor/admin territory. */
const STUDENT_ROUTE = /^\/(join|session|play)(\/|$)/;

/**
 * Should THIS page keep its signed-in user in the tab rather than the browser?
 *
 * Firebase persists auth in IndexedDB, which every tab of an origin shares, and
 * one Auth instance holds one user. So a student joining in a second tab calls
 * signInAnonymously, replaces the single shared record, and the instructor tab
 * sees an anonymous user and drops to signed-out. (If the instructor's session
 * has already rehydrated in that tab, the other failure happens instead:
 * `ensureAnonAuth` reuses `currentUser`, and the student joins the room AS the
 * instructor, writing the instructor's uid onto the player doc.)
 *
 * Splitting by route rather than by build fixes both, in production as well as
 * dev, and asymmetrically — which is what makes it cheap:
 *
 *   - student pages use per-tab session persistence, so joining never touches
 *     the instructor's IndexedDB record. A student who closes the tab rejoins
 *     with the same code and name; joinSession rebinds the player to the new
 *     uid, which is a path that already existed and is covered by the e2e.
 *   - instructor and admin pages keep normal browser-wide persistence, so
 *     signing in once still lasts across tabs and restarts.
 *
 * Evaluated when Auth is constructed rather than at module load, so a student
 * who lands on `/` and clicks through to `/join` is judged by where they end
 * up. The one gap is navigating instructor -> student inside a single tab,
 * where Auth already exists: open the student page in a new tab.
 */
function wantsTabScopedAuth(): boolean {
  if (typeof location === 'undefined') return false;
  return STUDENT_ROUTE.test(location.pathname);
}

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
    authInst = wantsTabScopedAuth()
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
