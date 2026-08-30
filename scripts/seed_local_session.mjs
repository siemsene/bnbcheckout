/**
 * Stand up a playable session against the local emulators.
 *
 * Mints the admin, grants themselves the instructor claim, approves it, and
 * creates a session — the same bootstrap `rules-tests/e2e.mjs` performs, minus
 * the assertions, so a browser can be pointed straight at a working room.
 *
 * Run from the repo root with the emulators already up:
 *   node scripts/seed_local_session.mjs [--format two-run] [--students 2]
 *
 * Emulator-only by construction: it talks to 127.0.0.1 and uses a `demo-`
 * project, which can never reach a real deployment.
 */
import { initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  sendEmailVerification,
  signInAnonymously,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import {
  connectFirestoreEmulator,
  doc,
  getFirestore,
  serverTimestamp,
  setDoc,
} from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';

const PROJECT = 'demo-checkout';
const AUTH_HOST = 'http://127.0.0.1:9099';
// Fixed in functions/src/index.ts; only this address can claim admin.
const ADMIN_EMAIL = 'siemsene@gmail.com';
const ADMIN_PASS = 'admintest123';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const format = arg('format', 'two-run');
const students = Number(arg('students', '2'));

function ctx(label) {
  const app = initializeApp({ apiKey: 'fake-api-key', projectId: PROJECT }, label);
  const auth = getAuth(app);
  connectAuthEmulator(auth, AUTH_HOST, { disableWarnings: true });
  const dbi = getFirestore(app);
  connectFirestoreEmulator(dbi, '127.0.0.1', 8080);
  const fns = getFunctions(app);
  connectFunctionsEmulator(fns, '127.0.0.1', 5001);
  return { auth, db: dbi, fns };
}

/** The emulator exposes verification links rather than sending mail. */
async function verifyEmail(user, email) {
  await sendEmailVerification(user);
  const res = await fetch(`${AUTH_HOST}/emulator/v1/projects/${PROJECT}/oobCodes`);
  const { oobCodes = [] } = await res.json();
  const oob = [...oobCodes]
    .reverse()
    .find((c) => c.email === email && c.requestType === 'VERIFY_EMAIL');
  if (!oob) throw new Error(`no verification code issued for ${email}`);
  await fetch(
    `${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:update?key=fake-api-key`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ oobCode: oob.oobCode }),
    },
  );
  await user.reload();
  await user.getIdToken(true); // so email_verified reaches the ID token
}

async function main() {
  const admin = ctx('seed-admin');

  // Re-runnable: the emulator keeps state until it is restarted.
  let user;
  try {
    ({ user } = await createUserWithEmailAndPassword(admin.auth, ADMIN_EMAIL, ADMIN_PASS));
    await verifyEmail(user, ADMIN_EMAIL);
  } catch (e) {
    if (e.code !== 'auth/email-already-in-use') throw e;
    ({ user } = await signInWithEmailAndPassword(admin.auth, ADMIN_EMAIL, ADMIN_PASS));
  }

  await httpsCallable(admin.fns, 'setAdminClaim')();
  await user.getIdToken(true);

  // Admin and instructor are separate claims, and createSession needs the
  // instructor one — so the admin registers, then approves themselves.
  // Registration is a plain users/{uid} write; a Firestore trigger picks it up.
  await setDoc(doc(admin.db, 'users', user.uid), {
    email: ADMIN_EMAIL,
    displayName: 'Local Instructor',
    affiliation: 'UW-Madison',
    status: 'pending',
    createdAt: serverTimestamp(),
  });
  await httpsCallable(admin.fns, 'approveInstructor')({
    uid: user.uid,
    approve: true,
  });
  await user.getIdToken(true); // so the instructor claim reaches the token

  const { data } = await httpsCallable(admin.fns, 'createSession')({
    title: `Local ${format} session`,
    planningMinutes: 30,
    format,
    planMinutes: 30,
    replayScenario: 'sameSeed',
  });

  const joined = [];
  for (let i = 0; i < students; i++) {
    const s = ctx(`seed-student-${i}`);
    await signInAnonymously(s.auth);
    const res = await httpsCallable(s.fns, 'joinSession')({
      code: data.code,
      name: ['Ana', 'Ben', 'Cleo', 'Dev'][i] ?? `Student${i}`,
    });
    joined.push(res.data.playerId);
  }

  console.log(
    JSON.stringify(
      {
        sessionId: data.sessionId,
        code: data.code,
        format,
        students: joined.length,
        instructor: { email: ADMIN_EMAIL, password: ADMIN_PASS },
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

main().catch((e) => {
  console.error('seed failed:', e.code ?? '', e.message);
  process.exit(1);
});
