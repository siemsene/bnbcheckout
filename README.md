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
npm test             # engine invariants + balance guards (101 tests)
```

Practice mode works fully offline. Debug helpers: `/play?speed=60` (fast clock),
`/play?seed=42` (fixed scenario).

## Architecture

| Piece | Where | Notes |
|---|---|---|
| Simulation engine | `src/engine/` | Pure TS, deterministic: all randomness pre-rolled from a seed at `createRun`; `step()` advances 1 sim-second. Replayable from `(seed, actionLog)`. |
| Scenario content | `src/engine/content.ts` | 22-task DAG, 5 characters, chaos-event tuning. The instructor constraint panel renders from the same tables. |
| Game UI | `src/screens/student/` | Board (`@dnd-kit` drag-drop + click-to-assign fallback), painted house scene with sprites, HUD, results & charts. |
| Firebase | `functions/`, `firestore.rules` | Callables: `joinSession` (name claim/rebind), `createSession`, `markReady`, `sessionControl` (stage transitions), `getServerTime`, `approveInstructor`, `setAdminClaim`; scheduled cleanup; notification email via the SMTP2GO REST API. |
| Tests | `src/engine/__tests__`, `rules-tests/` | Engine + balance in Vitest; security rules + full-emulator E2E (auth→approve→join→rejoin) in `rules-tests/`. |
| Art pipeline | `scripts/`, `public/assets/` | Generated Ghibli-style set (see `*.meta.json` sidecars for prompts/refs). `scripts/strip_checker_bg.py` removes fake checkerboard backgrounds. |

## Firebase setup (one-time, ~20 minutes)

1. Create a Firebase project at console.firebase.google.com, upgrade to the
   **Blaze** plan (required for Cloud Functions; costs are ~zero at classroom
   scale). Enable **Authentication** (Email/Password + Anonymous) and
   **Cloud Firestore**.
2. Add a Web App in project settings; copy the config values into `.env` as
   `VITE_FIREBASE_*` (see `.env.example`).
3. Notification email goes out through **SMTP2GO's REST API** (no extension to
   install). Two things to set:
   - `npx firebase-tools functions:secrets:set SMTP2GO_API_KEY` — paste the API
     key from your SMTP2GO dashboard.
   - `MAIL_SENDER` in `functions/.env.<projectId>` — the From address. SMTP2GO
     only sends from a **domain you have verified with them**, so a bare
     gmail.com address will be rejected. Example:
     `MAIL_SENDER=no-reply@yourdomain.edu`

   Email is optional: without the key everything still works, the functions just
   log `SMTP2GO_API_KEY unset — skipping email` and you approve instructors
   without a notification.
4. Deploy: `npx firebase-tools login`, then
   `npx firebase-tools deploy` (hosting + firestore rules + functions).
5. Bootstrap yourself. Admin and instructor are **separate claims** — you need
   both, because `createSession` requires the instructor one:
   1. Register at `/instructor/auth` with **siemsene@gmail.com** (the admin
      email is fixed in `functions/src/index.ts`) and verify the email.
      Firebase's verification mail often lands in Spam/Promotions; the screen
      has a resend button.
   2. Open `/admin` → **"I am the admin — activate admin access"**. Nothing
      links here until you're signed in and verified, which is why the
      pending-approval screen points at it.
   3. Still on `/admin`, approve your own pending instructor request.
   4. Sign out and back in so the new claims land in your ID token, then
      `/instructor` will let you create sessions.

### Running a class

- Instructors register at `/instructor/auth` with their name and **university
  affiliation** → verify email → you approve them at `/admin` (they're emailed
  on approval). The affiliation shows on each approval card and in the
  notification email. Accounts predating the field show "No affiliation on
  file"; the admin can fill it in inline from `/admin`.
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

If the functions emulator reports **"Failed to load function definition from
source … Cannot determine backend specification. Timeout after 10000"** — and
every callable then 404s with `functions/not-found` — the code is fine; the
emulator's 10-second discovery handshake is not. It shows up when the host Node
is newer than the `engines.node` the functions declare. Raise the window:

```bash
export FUNCTIONS_DISCOVERY_TIMEOUT=90
```

### Testing a whole class by yourself

```
npm run classroom
```

Starts the emulators and the dev server, seeds an approved instructor and a
session, and prints the two URLs plus the sign-in and the join code. Ctrl+C
stops everything it started. Options: `--format single|two-run`,
`--students N` (extra pre-joined players).

Open the instructor at `/instructor` and each student at `/join` in **separate
tabs of the same browser**. That works because `.env.development.local` sets
`VITE_TAB_SCOPED_AUTH=1`, which makes dev builds keep the signed-in user in
per-tab session storage instead of browser-wide IndexedDB.

Without it two tabs cannot hold two roles: Firebase shares one signed-in user
across every tab of an origin, so signing in as the instructor replaces a
student's anonymous session — and because `ensureAnonAuth` reuses
`currentUser`, a student tab opened behind a signed-in instructor joins the
room **as the instructor**. The flag is gated on `import.meta.env.DEV` as well,
so production keeps normal persistence and a closed tab never signs a student
out. Set it to `0` to exercise production's behaviour locally.

A run lasts fifteen real minutes, so to reach the later stages without waiting:

```
node scripts/dev_stage.mjs <sessionId> running
#   stages: planning | running | review1 | plan2 | running2
node scripts/dev_seed_run1.mjs <sessionId>   # plausible run-1 results
```

### Running the app against the emulators

Put the emulator config in **`.env.development.local`** — not `.env.local`.

Vite reads `.env.local` in *every* mode, including `vite build`, so an emulator
flag left there gets compiled into the production bundle: the deployed site then
calls `connectAuthEmulator('http://127.0.0.1:9099')` in every visitor's browser
and all sign-in fails. `.env.development.local` is only read by `vite dev`.
`vite.config.ts` refuses to build if emulator or `demo-` settings are in scope,
and `src/firebase/client.ts` ignores the flag outside a dev build.

The project id must match the `--project` the emulators run under, or callables
resolve to the wrong path:

```
VITE_USE_EMULATORS=1
VITE_FIREBASE_PROJECT_ID=demo-checkout
VITE_FIREBASE_API_KEY=fake-api-key
VITE_FIREBASE_AUTH_DOMAIN=demo-checkout.firebaseapp.com
VITE_FIREBASE_APP_ID=1:0:web:0
VITE_FIREBASE_MESSAGING_SENDER_ID=0
VITE_FIREBASE_STORAGE_BUCKET=demo-checkout.appspot.com
```

Then `npx firebase-tools emulators:start --only auth,firestore,functions
--project demo-checkout` alongside `npm run dev`. A `demo-` prefixed project id
never contacts Google, so this cannot touch a real deployment.

### If sign-in fails on the deployed site

Check what the deployed bundle was built against before suspecting the account:

```
curl -s https://<your-site>.web.app/assets/index-*.js | grep -c 127.0.0.1
```

Anything other than `0` means the build picked up emulator config and the site
is talking to the visitor's own localhost. Rebuild with `.env` in scope and
redeploy. Sign-in errors now name the real cause (network, configuration,
provider disabled) rather than reporting everything as a bad password.

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
