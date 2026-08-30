/**
 * Write a plausible run-1 result for every player in a local session, so the
 * run-1-vs-run-2 comparison in the debrief can be exercised without playing a
 * full fifteen-minute first run.
 *
 * Emulator-only: talks to 127.0.0.1 with a `demo-` project.
 *
 *   node scripts/dev_seed_run1.mjs <sessionId>
 */
const PROJECT = 'demo-checkout';
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer owner' };

const sessionId = process.argv[2];
if (!sessionId) {
  console.error('usage: node scripts/dev_seed_run1.mjs <sessionId>');
  process.exit(1);
}

/** Firestore REST wants every value tagged; arrays of numbers are the verbose bit. */
const num = (v) => ({ doubleValue: v });
const arr = (vs) => ({ arrayValue: { values: vs } });

/** A slightly worse first run: later finish, lower utilisation, more rework. */
function run1Fields(uid) {
  const completion = [];
  for (let m = 1; m <= 120; m++) completion.push(num(Math.min(1, (m / 120) ** 1.6)));
  const seg = (charId, taskId, kind, start, end) => ({
    mapValue: {
      fields: {
        charId: { stringValue: charId },
        taskId: { stringValue: taskId },
        kind: { stringValue: kind },
        start: num(start),
        end: num(end),
      },
    },
  });
  return {
    uid: { stringValue: uid },
    outcome: { stringValue: 'deadline' },
    finishSimMinute: { nullValue: null },
    pctComplete: num(0.82),
    avgUtilization: num(0.54),
    score: num(7380),
    reworkTotal: num(4),
    elapsedSimMinutes: num(120),
    completion: arr(completion),
    utilization: arr([]),
    timeline: arr([
      seg('sora', 'strip-beds', 'working', 0, 900),
      seg('sora', 'strip-beds', 'travel', 900, 1000),
      seg('kenji', 'fetch-car-a', 'working', 0, 1200),
      seg('kenji', 'fetch-car-a', 'blocked', 1200, 2000),
      seg('mei', 'make-breakfast', 'working', 0, 1800),
    ]),
  };
}

const main = async () => {
  const res = await fetch(`${FS}/sessions/${sessionId}/players`, { headers: H });
  const { documents = [] } = await res.json();
  if (documents.length === 0) throw new Error('no players in that session');

  for (const d of documents) {
    const playerId = d.name.split('/').pop();
    const uid = d.fields?.uid?.stringValue ?? 'unknown';
    const w = await fetch(`${FS}/sessions/${sessionId}/players/${playerId}/private/result`, {
      method: 'PATCH',
      headers: H,
      body: JSON.stringify({ fields: run1Fields(uid) }),
    });
    if (!w.ok) throw new Error(`write failed for ${playerId}: ${await w.text()}`);
    console.log(`run-1 result seeded for ${d.fields?.name?.stringValue ?? playerId}`);
  }
};

main().catch((e) => {
  console.error('seed run1 failed:', e.message);
  process.exit(1);
});
