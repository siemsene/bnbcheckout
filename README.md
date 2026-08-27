# Checkout Rush

A classroom project-management simulation. Five friends must check out of an
Airbnb by 10 AM: students assign friends to tasks on a drag-and-drop board,
discover hidden precedence/resource constraints, fight off distractions, and
race a live class leaderboard. 120 simulated minutes play out in ~15 real
minutes.

**Teaching goals:** precedence constraints, hard resource constraints (only two
friends can drive), soft constraints (skills, task ownership), learning curves,
multi-worker (in)efficiency, rework, and above all the value of keeping a team
working **in parallel**.

## Quick start (local, no Firebase needed)

```bash
npm install
npm run dev          # open http://localhost:5173 → "Practice run"
npm test             # engine invariants + balance guards (26 tests)
```

Practice mode works fully offline. Debug helpers: `/play?speed=60` (fast clock),
`/play?seed=42` (fixed scenario).

## Architecture

| Piece | Where | Notes |
|---|---|---|
| Simulation engine | `src/engine/` | Pure TS, deterministic: all randomness pre-rolled from a seed at `createRun`; `step()` advances 1 sim-second. Replayable from `(seed, actionLog)`. |
| Scenario content | `src/engine/content.ts` | 18-task DAG, 5 characters, chaos-event tuning. The instructor constraint panel renders from the same tables. |
| Game UI | `src/screens/student/` | Board (`@dnd-kit` drag-drop + click-to-assign fallback), painted house scene with sprites, HUD, results & charts. |
| Firebase | `functions/`, `firestore.rules` | Callables: `joinSession` (name claim/rebind), `createSession`, `approveInstructor`, `setAdminClaim`; scheduled cleanup; Trigger-Email docs in `mail/`. |
| Tests | `src/engine/__tests__`, `rules-tests/` | Engine + balance in Vitest; security rules + full-emulator E2E (auth→approve→join→rejoin) in `rules-tests/`. |
| Art pipeline | `scripts/`, `public/assets/` | Generated Ghibli-style set (see `*.meta.json` sidecars for prompts/refs). `scripts/strip_checker_bg.py` removes fake checkerboard backgrounds. |

## Firebase setup (one-time, ~20 minutes)

1. Create a Firebase project at console.firebase.google.com, upgrade to the
   **Blaze** plan (required for Cloud Functions; costs are ~zero at classroom
   scale). Enable **Authentication** (Email/Password + Anonymous) and
   **Cloud Firestore**.
2. Add a Web App in project settings; copy the config values into `.env` as
   `VITE_FIREBASE_*` (see `.env.example`).
3. Install the **Trigger Email** extension (Firestore collection: `mail`),
   entering your SMTP credentials (a Gmail app password or a free Brevo/SendGrid
   account works).
4. Deploy: `npx firebase-tools login`, then
   `npx firebase-tools deploy` (hosting + firestore rules + functions).
5. Bootstrap yourself as admin: register as an instructor in the app with
   **siemsene@gmail.com** (the admin email is fixed in
   `functions/src/index.ts`), verify the email, then open `/admin` and press
   "activate admin access".

### Running a class

- Instructors register at `/instructor/auth` → verify email → you approve them
  at `/admin` (they're emailed on approval).
- An approved instructor creates a session (choosing a planning-stage length) →
  projects the 6-letter code from the session monitor.
- Students open the site, enter code + a made-up name (no account). Same code +
  name resumes a run (any device).

A class session runs in **two room-wide stages**:

1. **Planning** — the instructor presses *Open planning*, which starts the
   countdown. Students stage their assignments with the clock frozen and press
   *I'm ready*; the monitor shows a live "N of M ready" roster.
2. **Simulation** — starts for the whole room at the same instant: the moment
   the last student is ready, when the instructor presses *Start now*, or when
   the countdown expires, whichever comes first. **Nobody can pause it.** Every
   client derives its sim-clock from one server timestamp, so a refreshed or
   backgrounded tab catches up to the room rather than drifting behind.

Students who finish early get a waiting room with the live leaderboard; their
own results stay locked until the whole class is done, so they can't broadcast
the hidden constraints to classmates still playing. The monitor also carries the
**hidden-constraint summary** for the debrief. "End session" stops every
student's clock immediately, reveals the winners and the class
utilization-vs-time scatter, and offers a CSV export.

Practice mode (`/play`) is unchanged: solo, self-paced, and pausable.

### Emulator tests

```bash
cd functions && npx tsc && cd ..
npx firebase-tools emulators:exec --only firestore --project demo-checkout "npx vitest run" # rules (from rules-tests/)
npx firebase-tools emulators:exec --only auth,firestore,functions --project demo-checkout "node rules-tests/e2e.mjs"
```

Needs a JRE 11+ on PATH for the emulators, and on some machines
`NODE_OPTIONS=--dns-result-order=ipv4first`.

## Accessibility

Keyboard path for every interaction (chips and task cards are focusable;
click-to-assign works without drag), `prefers-reduced-motion` honored
everywhere (sprites stop animating, confetti is skipped), color is never the
only signal (status icons + text badges + aria labels), an aria-live event
ticker mirrors all speech bubbles, and the celebration stays far below the
3-flashes-per-second limit.

Pause is always available in practice mode. It is deliberately **absent during a
classroom run**, where the whole room shares one clock that no single student can
stop — so anyone who needs to work at their own pace, or to step away mid-run,
should use `/play` rather than a live session. The classroom run is bounded
(~15 real minutes) and the instructor can end it at any time.
