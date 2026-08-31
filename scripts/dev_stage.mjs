/**
 * Drive a local session through its stages without waiting out the clock.
 *
 * A run lasts fifteen real minutes, which makes the between-runs stages
 * impossible to reach by hand. This back-dates the room's start instant through
 * the Firestore emulator's owner endpoint — which bypasses rules, so it can do
 * what the product deliberately forbids an instructor from doing — and then
 * calls the real callables for every transition that has a real code path.
 *
 * Emulator-only: `Bearer owner` is meaningless against a real project.
 *
 *   node scripts/dev_stage.mjs <sessionId> <stage>
 *      stage: planning | running | review1 | plan2 | running2 | skip
 *
 * `skip` is the odd one out: it is the instructor's own "skip run 1" control,
 * so it back-dates nothing and leaves `runStartsAt` unset. The room goes from
 * the lobby straight to the plan board.
 */
import { initializeApp } from 'firebase/app';
import {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
} from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';

const PROJECT = 'demo-checkout';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const ADMIN_EMAIL = 'siemsene@gmail.com';
const ADMIN_PASS = 'admintest123';

const [sessionId, target = 'plan2'] = process.argv.slice(2);
if (!sessionId) {
  console.error('usage: node scripts/dev_stage.mjs <sessionId> <stage>');
  process.exit(1);
}

const app = initializeApp({ apiKey: 'fake-api-key', projectId: PROJECT }, 'dev-stage');
const auth = getAuth(app);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const fns = getFunctions(app);
connectFunctionsEmulator(fns, '127.0.0.1', 5001);

/** Rewrite one timestamp field, bypassing rules the way only the emulator can. */
async function backdate(field, msAgo) {
  const when = new Date(Date.now() - msAgo).toISOString();
  const res = await fetch(
    `${FS}/sessions/${sessionId}?updateMask.fieldPaths=${field}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
      body: JSON.stringify({ fields: { [field]: { timestampValue: when } } }),
    },
  );
  if (!res.ok) throw new Error(`backdate ${field}: ${res.status} ${await res.text()}`);
}

async function main() {
  await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASS);
  const control = (action) => httpsCallable(fns, 'sessionControl')({ sessionId, action });

  const read = async () => {
    const r = await fetch(`${FS}/sessions/${sessionId}`, {
      headers: { Authorization: 'Bearer owner' },
    });
    return (await r.json()).fields ?? {};
  };

  // Note the REST shape: an unset timestamp comes back as {nullValue: null},
  // which is a truthy object. Test for the timestamp itself.
  const f = await read();

  // Straight from the lobby to the plan board — the real control, not a
  // back-dated clock, so this takes the same path the instructor's button does.
  if (target === 'skip') {
    await control('skipToPlan2');
    return;
  }

  // A session that skipped run 1 has no run-1 clock to arrange, and stamping
  // one now would undo the very thing `skip` did. Jump straight to the run-2
  // transitions, so `skip` then `running2` is a working sequence.
  const skippedRun1 =
    !!f.planOpensAt?.timestampValue && !f.runStartsAt?.timestampValue;

  if (!skippedRun1) {
    if (!f.runStartsAt?.timestampValue) await control('openPlanning');

    if (target === 'planning') return;

    // Run 1 in progress.
    await backdate('runStartsAt', 60_000);
    if (target === 'running') return;

    // Past the run window (15 real minutes at 8x), so stageOf derives review1.
    await backdate('runStartsAt', 20 * 60_000);
    if (target === 'review1') return;

    // Idempotent: these are re-run constantly while iterating on a live session.
    const f2 = await read();
    if (!f2.planOpensAt?.timestampValue) await control('openPlan2');
    if (target === 'plan2') return;
  } else if (target !== 'running2') {
    // The board is already open and there is no run 1 to rewind to.
    console.log(`run 1 was skipped; session is already at plan2`);
    return;
  }

  await control('startNow2');
  await backdate('run2StartsAt', 30_000);
}

main()
  .then(() => {
    console.log(`session ${sessionId} -> ${target}`);
    process.exit(0);
  })
  .catch((e) => {
    console.error('dev_stage failed:', e.code ?? '', e.message);
    process.exit(1);
  });
