/**
 * Cloud Functions for Checkout Rush.
 *
 * firebase-functions v2 API, Node 22, region us-central1 (default).
 *
 * firebase-admin v14 removed the namespaced API, so everything here uses the
 * modular entry points (getFirestore / getAuth) rather than admin.firestore()
 * and admin.auth().
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret, defineString } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import {
  getFirestore,
  FieldValue,
  Timestamp,
  type DocumentData,
} from "firebase-admin/firestore";

initializeApp();

const db = getFirestore();

const ADMIN_EMAIL = "siemsene@gmail.com";
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

/**
 * How long a session survives before cleanupSessions purges it. Named because
 * usageStats reports it: every total that screen shows is a window this many
 * days wide, not a lifetime figure, and the two must never drift apart.
 */
const RETENTION_DAYS = 30;

// --- Notification email (SMTP2GO REST API) ---------------------------------
//
// Set once with:  firebase functions:secrets:set SMTP2GO_API_KEY
const SMTP2GO_API_KEY = defineSecret("SMTP2GO_API_KEY");
/**
 * The From address. SMTP2GO refuses to send unless this sits on a domain you
 * have verified with them — a bare gmail.com address will NOT work, so set
 * this in functions/.env.<projectId>. The default only exists so the emulator
 * and unattended deploys don't stall on a prompt; SMTP2GO's rejection reason
 * is logged by sendEmail if it is left wrong.
 */
const MAIL_SENDER = defineString("MAIL_SENDER", {
  default: ADMIN_EMAIL,
  description:
    "From address for notification emails; must be a verified SMTP2GO sender.",
});

/**
 * Fire off a notification. Deliberately never throws: these are courtesy
 * emails, and an SMTP outage must not fail an instructor approval that has
 * already been applied, nor cause a Firestore trigger to retry forever.
 */
async function sendEmail(to: string, subject: string, html: string): Promise<void> {
  let apiKey = "";
  try {
    apiKey = SMTP2GO_API_KEY.value();
  } catch {
    // Secret not bound (e.g. the emulator) — fall through to the notice below.
  }
  const sender = MAIL_SENDER.value() || ADMIN_EMAIL;

  if (!apiKey) {
    // `sender` is logged so the From address can be confirmed from the logs
    // without having to send anything.
    logger.warn("SMTP2GO_API_KEY unset — skipping email", { to, subject, sender });
    return;
  }

  try {
    const res = await fetch("https://api.smtp2go.com/v3/email/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Smtp2go-Api-Key": apiKey,
      },
      body: JSON.stringify({
        sender,
        to: [to],
        subject,
        html_body: html,
      }),
    });
    if (!res.ok) {
      logger.error("SMTP2GO rejected the send", {
        to,
        status: res.status,
        body: await res.text().catch(() => "(unreadable)"),
      });
      return;
    }
    // SMTP2GO answers 200 with a per-request failure list, so check the body.
    const data = (await res.json().catch(() => null)) as {
      data?: { succeeded?: number; failures?: unknown[] };
    } | null;
    if (data?.data?.succeeded !== 1) {
      logger.error("SMTP2GO accepted the request but sent nothing", { to, data });
      return;
    }
    logger.info("notification sent", { to, subject });
  } catch (err) {
    logger.error("SMTP2GO request failed", { to, err: String(err) });
  }
}

/** Default planning-stage cap, in minutes. Mirrors the client constant. */
const DEFAULT_PLANNING_MINUTES = 5;
/** Minutes the between-runs plan board stays open in a two-run session. */
const DEFAULT_PLAN_MINUTES = 12;

/** Wall-clock ms one run lasts, mirroring runWindowMs on the client. */
function runWindowMs(session: FirebaseFirestore.DocumentData): number {
  const deadlineMin = session.settings?.simDeadlineMin ?? 120;
  const compression = session.settings?.compression ?? 8;
  return ((deadlineMin * 60) / compression) * 1000;
}

function planMinutes(session: FirebaseFirestore.DocumentData): number {
  const m = session.settings?.planMinutes;
  return typeof m === "number" && Number.isFinite(m) ? m : DEFAULT_PLAN_MINUTES;
}

function requireTwoRun(session: FirebaseFirestore.DocumentData): void {
  if (session.settings?.format !== "two-run") {
    throw new HttpsError(
      "failed-precondition",
      "This session is a single run."
    );
  }
}
/**
 * Milliseconds of "starting in 5… 4… 3…" between a start trigger and the run.
 * Generous enough to cover a cold callable round-trip, so the student who
 * pressed Ready last still sees a countdown rather than an instant start.
 */
const COUNTDOWN_MS = 5_000;

/**
 * True once the room's clock is running. The stage boundary is the
 * `runStartsAt` instant, not the advisory `status` field.
 */
function hasRunStarted(session: DocumentData): boolean {
  if (session.status === "lobby") return false;
  const now = Date.now();

  if (session.settings?.format === "two-run") {
    const r2 =
      session.run2StartsAt instanceof Timestamp
        ? session.run2StartsAt.toMillis()
        : null;
    // Run 2 under way: closed again, same reasoning as run 1.
    if (r2 != null && now >= r2) return true;
    // Between the runs — results are up, or the plan board is open — the room
    // is deliberately open. This is the student whose laptop died during run 1:
    // they can rejoin, plan, and take part in the replay. There is nothing
    // half-finished to drop them into.
    if (session.planOpensAt) return false;
    const startsAt1 =
      session.runStartsAt instanceof Timestamp
        ? session.runStartsAt.toMillis()
        : null;
    if (startsAt1 != null && now >= startsAt1 + runWindowMs(session)) return false;
  }

  const startsAt =
    session.runStartsAt instanceof Timestamp
      ? session.runStartsAt.toMillis()
      : null;
  return startsAt != null && now >= startsAt;
}

// ---------------------------------------------------------------------------
// 1. onInstructorRegistered — notify the admin when a new instructor signs up.
// ---------------------------------------------------------------------------
export const onInstructorRegistered = onDocumentCreated(
  { document: "users/{uid}", secrets: [SMTP2GO_API_KEY] },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data();
    const displayName = (data.displayName as string) ?? "(no name)";
    const email = (data.email as string) ?? "(no email)";
    // Absent on accounts recovered by the client's missing-profile repair
    // path, which has no affiliation to offer — say so rather than omit it.
    const affiliation = (data.affiliation as string) || "(not given)";

    await sendEmail(
      ADMIN_EMAIL,
      `Checkout Rush: instructor registration pending — ${displayName}`,
      `<p>A new instructor has registered and is awaiting approval.</p>` +
        `<p><strong>Name:</strong> ${escapeHtml(displayName)}<br/>` +
        `<strong>Email:</strong> ${escapeHtml(email)}<br/>` +
        `<strong>Affiliation:</strong> ${escapeHtml(affiliation)}<br/>` +
        `<strong>UID:</strong> ${escapeHtml(event.params.uid)}</p>` +
        `<p>Open the admin page to approve.</p>`
    );
  }
);

// ---------------------------------------------------------------------------
// 2. approveInstructor — admin approves or rejects a pending instructor.
// ---------------------------------------------------------------------------
export const approveInstructor = onCall(
  { secrets: [SMTP2GO_API_KEY] },
  async (request) => {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError("permission-denied", "Admin privileges required.");
  }

  const uid = request.data?.uid;
  const approve = request.data?.approve;
  if (typeof uid !== "string" || uid.length === 0 || typeof approve !== "boolean") {
    throw new HttpsError(
      "invalid-argument",
      "Expected { uid: string, approve: boolean }."
    );
  }

  const userRef = db.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new HttpsError("not-found", `No users/${uid} document.`);
  }
  const userData = userSnap.data() ?? {};

  // Merge the instructor claim without clobbering any other claims.
  const authUser = await getAuth().getUser(uid);
  const claims: Record<string, unknown> = { ...(authUser.customClaims ?? {}) };
  if (approve) {
    claims.instructor = true;
  } else {
    delete claims.instructor;
  }
  await getAuth().setCustomUserClaims(uid, claims);

  await userRef.update({
    status: approve ? "approved" : "rejected",
    approvedAt: FieldValue.serverTimestamp(),
    approvedBy: request.auth!.uid,
  });

  const email = userData.email as string | undefined;
  if (email) {
    const outcome = approve ? "approved" : "rejected";
    await sendEmail(
      email,
      `Checkout Rush: your instructor account was ${outcome}`,
      approve
        ? `<p>Good news — your Checkout Rush instructor account has been approved. ` +
            `Sign out and sign back in, then you can create sessions.</p>`
        : `<p>Your Checkout Rush instructor registration was rejected. ` +
            `If you believe this is a mistake, contact ${ADMIN_EMAIL}.</p>`
    );
  }

  return { uid, status: approve ? "approved" : "rejected" };
  }
);

// ---------------------------------------------------------------------------
// 3. setAdminClaim — self-service bootstrap for the single known admin.
// ---------------------------------------------------------------------------
export const setAdminClaim = onCall(async (request) => {
  const token = request.auth?.token;
  if (!request.auth || !token) {
    throw new HttpsError("unauthenticated", "Sign in first.");
  }
  if (token.email !== ADMIN_EMAIL || token.email_verified !== true) {
    throw new HttpsError(
      "permission-denied",
      "Only the verified admin account may call this."
    );
  }

  const authUser = await getAuth().getUser(request.auth.uid);
  const claims: Record<string, unknown> = { ...(authUser.customClaims ?? {}) };
  claims.admin = true;
  await getAuth().setCustomUserClaims(request.auth.uid, claims);

  return { admin: true };
});

// ---------------------------------------------------------------------------
// 4. createSession — instructor creates a session with a unique join code.
// ---------------------------------------------------------------------------
function randomCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

export const createSession = onCall(async (request) => {
  if (request.auth?.token?.instructor !== true) {
    throw new HttpsError("permission-denied", "Instructor privileges required.");
  }

  const title = request.data?.title;
  if (typeof title !== "string" || title.trim().length === 0) {
    throw new HttpsError("invalid-argument", "Expected { title: string }.");
  }

  const rawPlanning = request.data?.planningMinutes;
  const planningMinutes =
    typeof rawPlanning === "number" && Number.isFinite(rawPlanning)
      ? Math.min(30, Math.max(1, Math.round(rawPlanning)))
      : DEFAULT_PLANNING_MINUTES;

  // Two-run is opt-in per session. Anything unrecognised (including nothing at
  // all, from an older client) is a plain single run — the original format.
  const format = request.data?.format === "two-run" ? "two-run" : "single";
  const replayScenario =
    request.data?.replayScenario === "newChaos" ? "newChaos" : "sameSeed";
  const rawPlan = request.data?.planMinutes;
  const planMinutes =
    typeof rawPlan === "number" && Number.isFinite(rawPlan)
      ? Math.min(30, Math.max(1, Math.round(rawPlan)))
      : DEFAULT_PLAN_MINUTES;

  const instructorUid = request.auth.uid;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const sessionRef = db.collection("sessions").doc();
    const codeRef = db.collection("sessionCodes").doc(code);

    try {
      await db.runTransaction(async (tx) => {
        const codeSnap = await tx.get(codeRef);
        if (codeSnap.exists) {
          throw new CodeCollisionError();
        }
        tx.create(codeRef, {
          sessionId: sessionRef.id,
          createdAt: FieldValue.serverTimestamp(),
        });
        tx.create(sessionRef, {
          code,
          instructorUid,
          title: title.trim(),
          status: "lobby",
          createdAt: FieldValue.serverTimestamp(),
          playerCount: 0,
          runStartsAt: null,
          planOpensAt: null,
          run2StartsAt: null,
          readyCount: 0,
          settings: {
            simDeadlineMin: 120,
            compression: 8,
            planningMinutes,
            format,
            ...(format === "two-run" ? { replayScenario, planMinutes } : {}),
          },
        });
      });
      return { sessionId: sessionRef.id, code };
    } catch (err) {
      if (err instanceof CodeCollisionError) continue; // retry with a new code
      throw err;
    }
  }

  throw new HttpsError(
    "resource-exhausted",
    "Could not allocate a unique session code; try again."
  );
});

class CodeCollisionError extends Error {
  constructor() {
    super("session code collision");
  }
}

// ---------------------------------------------------------------------------
// 5. joinSession — student (or anyone signed in) joins / rejoins by code.
// ---------------------------------------------------------------------------

/** Deterministic 32-bit FNV-1a hash of a string. */
function fnv1a32(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export const joinSession = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in (anonymous is fine) first.");
  }
  const uid = request.auth.uid;

  const code = request.data?.code;
  const rawName = request.data?.name;
  if (typeof code !== "string" || typeof rawName !== "string") {
    throw new HttpsError("invalid-argument", "Expected { code: string, name: string }.");
  }

  const name = rawName.trim();
  if (name.length < 2 || name.length > 20) {
    throw new HttpsError("invalid-argument", "Name must be 2-20 characters.");
  }
  const nameLower = name.toLowerCase();
  const codeUpper = code.trim().toUpperCase();

  const codeRef = db.collection("sessionCodes").doc(codeUpper);

  return db.runTransaction(async (tx) => {
    const codeSnap = await tx.get(codeRef);
    if (!codeSnap.exists) {
      throw new HttpsError("not-found", "Unknown session code.");
    }
    const sessionId = codeSnap.data()!.sessionId as string;

    const sessionRef = db.collection("sessions").doc(sessionId);
    const sessionSnap = await tx.get(sessionRef);
    if (!sessionSnap.exists) {
      throw new HttpsError("not-found", "Session no longer exists.");
    }
    const session = sessionSnap.data()!;
    if (session.status === "ended") {
      throw new HttpsError("failed-precondition", "This session has ended.");
    }

    const nameRef = sessionRef.collection("names").doc(nameLower);
    const nameSnap = await tx.get(nameRef);

    // A brand-new name cannot enter a run that is already under way — they'd
    // be dropped into a half-finished morning. Rejoins (below) still work,
    // since that is how a student who refreshed gets back to their own run.
    if (!nameSnap.exists && hasRunStarted(session)) {
      throw new HttpsError(
        "failed-precondition",
        "This session's simulation has already started."
      );
    }

    if (nameSnap.exists) {
      // REBIND: same display name reclaims the existing player slot.
      const ticket = nameSnap.data()!;
      const playerId = ticket.playerId as string;
      const playerRef = sessionRef.collection("players").doc(playerId);
      const playerSnap = await tx.get(playerRef);
      if (!playerSnap.exists) {
        throw new HttpsError("internal", "Player record missing for name ticket.");
      }
      const seed = playerSnap.data()!.seed as number;

      tx.update(nameRef, { uid });
      tx.update(playerRef, { uid });

      return {
        sessionId,
        playerId,
        seed,
        rejoined: true,
        serverNowMs: Date.now(),
      };
    }

    // New player.
    const playerRef = sessionRef.collection("players").doc();
    const playerId = playerRef.id;
    const createdAtMillis =
      session.createdAt instanceof Timestamp
        ? session.createdAt.toMillis()
        : 0;
    const seed = (fnv1a32(sessionId + nameLower) ^ createdAtMillis) >>> 0;

    tx.create(nameRef, {
      playerId,
      displayName: name,
      uid,
      claimedAt: FieldValue.serverTimestamp(),
    });
    tx.create(playerRef, {
      name,
      uid,
      joinedAt: FieldValue.serverTimestamp(),
      phase: "lobby",
      simMinute: 0,
      pctComplete: 0,
      utilizationAvg: 0,
      finished: false,
      finishSimMinute: null,
      score: 0,
      seed,
      ready: false,
      lastWriteAt: FieldValue.serverTimestamp(),
    });
    tx.update(sessionRef, {
      playerCount: FieldValue.increment(1),
    });

    return {
      sessionId,
      playerId,
      seed,
      rejoined: false,
      serverNowMs: Date.now(),
    };
  });
});

// ---------------------------------------------------------------------------
// 5b. markReady — a student finishes planning. The only writer of `ready`.
// ---------------------------------------------------------------------------

/**
 * Counting the ready players inside the transaction is what makes the
 * last-student-ready race safe: two simultaneous calls cannot both observe
 * "not everyone is ready yet" and leave the run unstarted.
 */
export const markReady = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in (anonymous is fine) first.");
  }
  const uid = request.auth.uid;

  const sessionId = request.data?.sessionId;
  const playerId = request.data?.playerId;
  if (typeof sessionId !== "string" || typeof playerId !== "string") {
    throw new HttpsError(
      "invalid-argument",
      "Expected { sessionId: string, playerId: string }."
    );
  }

  const sessionRef = db.collection("sessions").doc(sessionId);
  const playersRef = sessionRef.collection("players");
  const playerRef = playersRef.doc(playerId);

  return db.runTransaction(async (tx) => {
    const [sessionSnap, playerSnap, playersSnap] = await Promise.all([
      tx.get(sessionRef),
      tx.get(playerRef),
      tx.get(playersRef),
    ]);

    if (!sessionSnap.exists) {
      throw new HttpsError("not-found", "Session no longer exists.");
    }
    if (!playerSnap.exists) {
      throw new HttpsError("not-found", "Player no longer exists.");
    }
    if (playerSnap.data()!.uid !== uid) {
      throw new HttpsError("permission-denied", "That is not your player slot.");
    }

    const session = sessionSnap.data()!;
    if (session.status === "ended") {
      throw new HttpsError("failed-precondition", "This session has ended.");
    }
    if (session.status === "lobby") {
      throw new HttpsError(
        "failed-precondition",
        "Planning has not been opened yet."
      );
    }

    // Which run is this readiness for? Once the plan board has opened, "ready"
    // means ready for run 2, and it must pull run 2's timestamp forward rather
    // than run 1's — which is long past and would start nothing.
    const planOpen =
      session.settings?.format === "two-run" && !!session.planOpensAt;
    const startField = planOpen ? "run2StartsAt" : "runStartsAt";
    const round = planOpen ? 2 : 1;
    const existingMs =
      session[startField] instanceof Timestamp
        ? session[startField].toMillis()
        : null;
    const now = Date.now();

    // Count with this call's own write folded in — the snapshot predates it.
    let readyCount = 0;
    playersSnap.forEach((d) => {
      if (d.id === playerId || d.data().ready === true) readyCount++;
    });
    const playerCount = playersSnap.size;
    const allReady = playerCount > 0 && readyCount === playerCount;

    // The run is already going: readiness is moot, but still answer with the
    // clock so a retrying client can correct its offset.
    if (existingMs != null && now >= existingMs) {
      return {
        readyCount,
        playerCount,
        allReady,
        round,
        runStartsAtMs: existingMs,
        serverNowMs: now,
      };
    }

    tx.update(playerRef, {
      ready: true,
      readyAt: FieldValue.serverTimestamp(),
      phase: "planning",
    });

    let runStartsAtMs = existingMs;
    if (allReady) {
      const soon = now + COUNTDOWN_MS;
      // Never push the start later than it already is — only pull it forward.
      // This invariant is what keeps concurrent callers safe.
      if (existingMs == null || soon < existingMs) {
        runStartsAtMs = soon;
        tx.update(sessionRef, { [startField]: Timestamp.fromMillis(soon) });
      }
    }

    return {
      readyCount,
      playerCount,
      allReady,
      round,
      runStartsAtMs,
      serverNowMs: now,
    };
  });
});

// ---------------------------------------------------------------------------
// 5c. sessionControl — the instructor's stage transitions.
// ---------------------------------------------------------------------------

/**
 * All run timing is stamped here rather than on the instructor's machine: a
 * skewed instructor clock would otherwise be baked into the one timestamp every
 * student derives their stage and sim-clock from.
 */
export const sessionControl = onCall(async (request) => {
  if (request.auth?.token?.instructor !== true) {
    throw new HttpsError("permission-denied", "Instructor privileges required.");
  }
  const sessionId = request.data?.sessionId;
  const action = request.data?.action;
  const ACTIONS = [
    "openPlanning",
    "startNow",
    "end",
    // Two-run only.
    "openPlan2",
    "startNow2",
    "skipToPlan2",
  ] as const;
  if (typeof sessionId !== "string" || !ACTIONS.includes(action)) {
    throw new HttpsError(
      "invalid-argument",
      `Expected { sessionId: string, action: ${ACTIONS.join("|")} }.`
    );
  }

  const sessionRef = db.collection("sessions").doc(sessionId);

  return db.runTransaction(async (tx) => {
    const snap = await tx.get(sessionRef);
    if (!snap.exists) throw new HttpsError("not-found", "Session not found.");
    const session = snap.data()!;
    if (session.instructorUid !== request.auth!.uid) {
      throw new HttpsError("permission-denied", "Not your session.");
    }
    // Firestore transactions require every read before the first write, so the
    // roster is fetched up front even though only openPlan2 uses it.
    const playerDocs =
      action === "openPlan2" || action === "skipToPlan2"
        ? (await tx.get(sessionRef.collection("players"))).docs
        : [];

    const now = Date.now();
    const existingMs =
      session.runStartsAt instanceof Timestamp
        ? session.runStartsAt.toMillis()
        : null;
    let status = session.status as string;
    let runStartsAtMs = existingMs;

    if (action === "end") {
      status = "ended";
      tx.update(sessionRef, {
        status: "ended",
        endedAt: FieldValue.serverTimestamp(),
      });
    } else if (action === "openPlanning") {
      if (session.status !== "lobby") {
        throw new HttpsError(
          "failed-precondition",
          "Planning has already been opened."
        );
      }
      const minutes =
        typeof session.settings?.planningMinutes === "number"
          ? session.settings.planningMinutes
          : DEFAULT_PLANNING_MINUTES;
      // The countdown cap IS the fallback start instant, so expiry needs no
      // actor: every client simply crosses it on its own.
      runStartsAtMs = now + minutes * 60_000;
      status = "planning";
      tx.update(sessionRef, {
        status: "planning",
        planningOpenedAt: FieldValue.serverTimestamp(),
        runStartsAt: Timestamp.fromMillis(runStartsAtMs),
      });
    } else if (action === "startNow") {
      if (session.status !== "planning") {
        throw new HttpsError("failed-precondition", "Planning is not open.");
      }
      const soon = now + COUNTDOWN_MS;
      if (existingMs == null || soon < existingMs) {
        runStartsAtMs = soon;
        tx.update(sessionRef, { runStartsAt: Timestamp.fromMillis(soon) });
      }
    } else if (action === "openPlan2") {
      requireTwoRun(session);
      if (session.planOpensAt) {
        throw new HttpsError("failed-precondition", "Planning is already open.");
      }
      if (existingMs == null) {
        throw new HttpsError("failed-precondition", "Run 1 has not started yet.");
      }
      // Run 1 is over when its wall-clock window expires OR when every student
      // has finished — which is the normal case, since a class that plans well
      // beats the two-hour morning with real minutes to spare. Requiring the
      // window alone left the instructor watching "5 of 5 finished" with no
      // control but "End session", and the second run unreachable.
      const everyoneDone =
        playerDocs.length > 0 &&
        playerDocs.every((p) => {
          const phase = p.data().phase;
          return phase === "finished" || phase === "abandoned";
        });
      const windowElapsed = now >= existingMs + runWindowMs(session);
      // The instructor is the authority in the room: a dead tab among thirty
      // students must not be able to hold the whole class in run 1.
      const force = request.data?.force === true;
      if (!windowElapsed && !everyoneDone && !force) {
        throw new HttpsError(
          "failed-precondition",
          "Run 1 is still going. Wait for everyone to finish, or open it anyway."
        );
      }
      // Clearing `ready` is load-bearing. Rules make it function-only, so if it
      // is not reset here every student is still flagged ready from run 1 and
      // markReady starts run 2 the instant the board opens.
      for (const p of playerDocs) tx.update(p.ref, { ready: false });
      tx.update(sessionRef, {
        planOpensAt: Timestamp.fromMillis(now),
        run2StartsAt: Timestamp.fromMillis(now + planMinutes(session) * 60_000),
        readyCount: 0,
      });
    } else if (action === "skipToPlan2") {
      // Straight from the lobby to the plan board, for trying the second half
      // of the format out without playing the first. `runStartsAt` is left
      // unstamped on purpose: `stageOf` reads the run-2 instants before it, so
      // the room never derives a run-1 stage and there is no run 1 to skip out
      // of. Students land on the plan board with nothing to plan FROM, which is
      // exactly what makes this a testing shortcut rather than a lesson.
      requireTwoRun(session);
      if (session.status !== "lobby") {
        throw new HttpsError(
          "failed-precondition",
          "This session has already started. Open the plan board the usual way."
        );
      }
      status = "planning";
      // Same reason as openPlan2: `ready` is function-only, so a stale flag
      // from the lobby would start run 2 the instant the board opened.
      for (const p of playerDocs) tx.update(p.ref, {ready: false});
      tx.update(sessionRef, {
        status: "planning",
        planOpensAt: Timestamp.fromMillis(now),
        run2StartsAt: Timestamp.fromMillis(now + planMinutes(session) * 60_000),
        readyCount: 0,
      });
    } else if (action === "startNow2") {
      requireTwoRun(session);
      if (!session.planOpensAt) {
        throw new HttpsError("failed-precondition", "The plan board is not open.");
      }
      const existing2 =
        session.run2StartsAt instanceof Timestamp
          ? session.run2StartsAt.toMillis()
          : null;
      const soon = now + COUNTDOWN_MS;
      // Never push the start back, for the same reason startNow doesn't: a
      // second press must not rewind a countdown other clients are already on.
      if (existing2 == null || soon < existing2) {
        tx.update(sessionRef, { run2StartsAt: Timestamp.fromMillis(soon) });
      }
    }

    return { status, runStartsAtMs, serverNowMs: now };
  });
});

// ---------------------------------------------------------------------------
// 5d. getServerTime — lets a client correct its own clock skew.
// ---------------------------------------------------------------------------

export const getServerTime = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Sign in first.");
  }
  return { serverNowMs: Date.now() };
});

// ---------------------------------------------------------------------------
// 6. deleteSession — an instructor removes one of their own old sessions.
// ---------------------------------------------------------------------------
export const deleteSession = onCall(async (request) => {
  if (request.auth?.token?.instructor !== true) {
    throw new HttpsError("permission-denied", "Instructor privileges required.");
  }
  const sessionId = request.data?.sessionId;
  if (typeof sessionId !== "string" || sessionId.length === 0) {
    throw new HttpsError("invalid-argument", "Expected { sessionId: string }.");
  }

  const sessionRef = db.collection("sessions").doc(sessionId);
  const snap = await sessionRef.get();
  // Already gone is the outcome the caller wanted; don't make them care whether
  // a double-click or a stale list got here first.
  if (!snap.exists) return { deleted: true, alreadyGone: true };

  const session = snap.data()!;
  if (session.instructorUid !== request.auth!.uid) {
    throw new HttpsError("permission-denied", "Not your session.");
  }

  // Refuse while a run is actually under way. Deleting then would strand every
  // student mid-run on a session doc that stops existing under them.
  const status = session.status as string;
  if (status !== "ended" && status !== "lobby" && !runsAreOver(session)) {
    throw new HttpsError(
      "failed-precondition",
      "This session is still running. End it first, then delete it."
    );
  }

  const code = session.code as string | undefined;
  // Fold the counts into the lifetime archive first — after recursiveDelete
  // there is nothing left to count. An instructor tidying up their dashboard
  // must not be able to erase usage history by doing so.
  await archiveSessionUsage(sessionRef, session);
  // Players, their name tickets and their private checkpoints all hang off the
  // session, so a plain delete would orphan them.
  await db.recursiveDelete(sessionRef);
  if (code) {
    // Free the join code for reuse; it lives in a top-level collection.
    await db.collection("sessionCodes").doc(code).delete();
  }
  logger.info("session deleted", { sessionId, by: request.auth!.uid });
  return { deleted: true, alreadyGone: false };
});

/** True once every run this session will ever have is behind us. */
function runsAreOver(session: FirebaseFirestore.DocumentData): boolean {
  const window = runWindowMs(session);
  const now = Date.now();
  const startedAt =
    session.runStartsAt instanceof Timestamp ? session.runStartsAt.toMillis() : null;
  if (startedAt == null) return false;
  if (session.settings?.format === "two-run") {
    const r2 =
      session.run2StartsAt instanceof Timestamp
        ? session.run2StartsAt.toMillis()
        : null;
    // The plan board is open or run 2 is pending: not over yet.
    if (session.planOpensAt && r2 == null) return false;
    if (r2 != null) return now >= r2 + window;
  }
  return now >= startedAt + window;
}

// ---------------------------------------------------------------------------
// 7. Usage reporting: the lifetime archive, and the admin roll-up that reads it.
// ---------------------------------------------------------------------------
//
// Deliberately raw: this returns measured document counts and nothing else.
// The money figure is derived on the client (src/billing/costModel.ts) so the
// pricing table and its assumptions live in one readable place that a test can
// pin, rather than being baked into a deployed function nobody can see.
//
// Cost of the call itself is reported back as `docsRead`, because this is the
// one screen where the reader cares that looking costs money too.

/** How many runs of the sim this session actually got through. */
function runsPlayed(session: DocumentData): 0 | 1 | 2 {
  const started = (v: unknown) => v instanceof Timestamp;
  if (!started(session.runStartsAt)) return 0;
  return session.settings?.format === "two-run" && started(session.run2StartsAt)
    ? 2
    : 1;
}

const millis = (v: unknown): number | null =>
  v instanceof Timestamp ? v.toMillis() : null;

// ---------------------------------------------------------------------------
// 7a. Lifetime usage archive.
// ---------------------------------------------------------------------------
//
// `cleanupSessions` deletes sessions after RETENTION_DAYS, which means the live
// collections can only ever answer "the last 30 days". Anything the admin
// screen should still know a year from now has to be folded into a durable
// counter BEFORE the session is deleted — that is all this is.
//
// What gets stored is counts and a small histogram of session SHAPES, never a
// price. Pricing stays on the client (src/billing/costModel.ts) where it can be
// read and tested: an archive that baked in dollars would freeze whatever the
// model said on the day of the purge, and quietly disagree with every live
// session next to it the moment either the model or Google's rates moved.
//
// The histogram is keyed by exactly the inputs the cost model takes, so a
// purged session can be re-priced later as faithfully as a live one.

/** Where a session's shape is recorded so it can be re-priced after deletion. */
function sizeKey(
  players: number,
  runs: number,
  format: string,
  deadlineMin: number,
  compression: number
): string {
  return `${players}|${runs}|${format}|${deadlineMin}|${compression}`;
}

/**
 * Distinct shapes one instructor's archive will hold before it starts rounding.
 *
 * The histogram is bounded by distinct class shapes, not by sessions, so in
 * practice it stays at a handful of entries forever. This cap only exists so
 * that a pathological spread — every class a different size — cannot grow the
 * document without limit. Past it, class sizes round UP to the next multiple of
 * five, which collapses the key space and keeps the estimate conservative.
 */
const MAX_ARCHIVE_SHAPES = 400;
const SHAPE_ROUNDING = 5;

/** Sessions with no readable owner still cost money; park them somewhere real. */
const UNATTRIBUTED_UID = "unattributed";

/**
 * Fold one session's usage into its instructor's lifetime totals, then mark it
 * archived.
 *
 * Both writes land in a single transaction, and the caller deletes the session
 * afterwards. That ordering is deliberate: if the delete fails, the flag has
 * already been set, so the next cleanup run deletes the session WITHOUT
 * counting it twice. Losing a session from the archive would understate the
 * totals; counting one twice would overstate them, and only the second kind of
 * error compounds silently every night.
 */
async function archiveSessionUsage(
  sessionRef: FirebaseFirestore.DocumentReference,
  session: DocumentData
): Promise<void> {
  if (session.usageArchived === true) return;

  // Counted here rather than from `playerCount`, which is a live counter the
  // rules let the join path move and nothing reconciles.
  const players = await sessionRef.collection("players").count().get();
  const playerCount = players.data().count;

  const runs = runsPlayed(session);
  const format = session.settings?.format === "two-run" ? "two-run" : "single";
  const deadlineMin = (session.settings?.simDeadlineMin as number) ?? 120;
  const compression = (session.settings?.compression as number) ?? 8;
  const createdAtMs = millis(session.createdAt);
  const uid = (session.instructorUid as string) || UNATTRIBUTED_UID;

  const archiveRef = db.collection("usageArchive").doc(uid);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(archiveRef);
    const prev = snap.data() ?? {};
    const sizes: Record<string, number> = { ...(prev.sizes ?? {}) };

    // Round the class size only once the shape map is already large; see
    // MAX_ARCHIVE_SHAPES. Rounding up never understates the later estimate.
    const keyed =
      Object.keys(sizes).length >= MAX_ARCHIVE_SHAPES
        ? Math.ceil(playerCount / SHAPE_ROUNDING) * SHAPE_ROUNDING
        : playerCount;
    const key = sizeKey(keyed, runs, format, deadlineMin, compression);
    sizes[key] = (sizes[key] ?? 0) + 1;

    const first = prev.firstSessionAtMs as number | null | undefined;
    const last = prev.lastSessionAtMs as number | null | undefined;

    tx.set(
      archiveRef,
      {
        sessions: (prev.sessions ?? 0) + 1,
        // Seats, not people: one student who comes back for a second session is
        // two seats. Distinct humans cannot survive the purge — the anonymous
        // uids that identified them are deleted with the players.
        seats: (prev.seats ?? 0) + playerCount,
        runs: (prev.runs ?? 0) + runs,
        biggestClass: Math.max((prev.biggestClass ?? 0) as number, playerCount),
        firstSessionAtMs:
          createdAtMs == null
            ? (first ?? null)
            : Math.min(first ?? createdAtMs, createdAtMs),
        lastSessionAtMs:
          createdAtMs == null
            ? (last ?? null)
            : Math.max(last ?? createdAtMs, createdAtMs),
        sizes,
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    tx.update(sessionRef, { usageArchived: true });
  });
}

// ---------------------------------------------------------------------------
// 7b. usageStats — admin-only roll-up: live sessions plus the lifetime archive.
// ---------------------------------------------------------------------------
export const usageStats = onCall(async (request) => {
  if (request.auth?.token?.admin !== true) {
    throw new HttpsError("permission-denied", "Admin privileges required.");
  }

  // One collection-group read instead of one query per session. Unfiltered, so
  // it needs no composite index.
  const [userSnap, sessionSnap, playerSnap, archiveSnap] = await Promise.all([
    db.collection("users").get(),
    db.collection("sessions").get(),
    db.collectionGroup("players").get(),
    db.collection("usageArchive").get(),
  ]);

  // Group players by their owning session before touching the session list, so
  // a session with no players still reports zero rather than being skipped.
  const bySession = new Map<string, DocumentData[]>();
  for (const doc of playerSnap.docs) {
    const sid = doc.ref.parent.parent?.id;
    if (!sid) continue; // not under a session — nothing sane to attribute it to
    const list = bySession.get(sid);
    if (list) list.push(doc.data());
    else bySession.set(sid, [doc.data()]);
  }

  // Distinct student uids per instructor. A student who plays two of the same
  // instructor's sessions is one person with two seats, and the difference is
  // exactly what tells a repeat class from a new one.
  const uidsByInstructor = new Map<string, Set<string>>();

  const sessions = sessionSnap.docs
    // A session already folded into the archive but not yet deleted — the purge
    // crashed between the two writes, and tomorrow's run will finish the job.
    // Counting it here as well as in the archive is the one way this screen
    // could overstate itself, so drop it.
    .filter((doc) => doc.data().usageArchived !== true)
    .map((doc) => {
      const s = doc.data();
      const players = bySession.get(doc.id) ?? [];
      const instructorUid = (s.instructorUid as string) ?? "";

      const uids = new Set<string>();
      for (const p of players) {
        if (typeof p.uid === "string" && p.uid) uids.add(p.uid);
      }
      if (instructorUid) {
        const seen = uidsByInstructor.get(instructorUid) ?? new Set<string>();
        for (const uid of uids) seen.add(uid);
        uidsByInstructor.set(instructorUid, seen);
      }

      return {
        id: doc.id,
        title: (s.title as string) ?? "(untitled)",
        instructorUid,
        createdAtMs: millis(s.createdAt),
        endedAtMs: millis(s.endedAt),
        format: s.settings?.format === "two-run" ? "two-run" : "single",
        simDeadlineMin: (s.settings?.simDeadlineMin as number) ?? 120,
        compression: (s.settings?.compression as number) ?? 8,
        players: players.length,
        distinctStudents: uids.size,
        runsPlayed: runsPlayed(s),
        finished: players.filter((p) => p.finished === true).length,
      };
    });

  const instructors = userSnap.docs.map((doc) => {
    const u = doc.data();
    return {
      uid: doc.id,
      email: (u.email as string) ?? "",
      displayName: (u.displayName as string) ?? "(no name)",
      affiliation: (u.affiliation as string) ?? null,
      status: (u.status as string) ?? "pending",
      createdAtMs: millis(u.createdAt),
      /** Distinct humans across every session this instructor has run. */
      distinctStudents: uidsByInstructor.get(doc.id)?.size ?? 0,
    };
  });

  // Sessions the purge has already taken, folded into per-instructor totals.
  // Added to the live sessions above, these are what make the headline counts
  // lifetime figures rather than a rolling 30-day window.
  const archive = archiveSnap.docs.map((doc) => {
    const a = doc.data();
    return {
      instructorUid: doc.id,
      sessions: (a.sessions as number) ?? 0,
      seats: (a.seats as number) ?? 0,
      runs: (a.runs as number) ?? 0,
      biggestClass: (a.biggestClass as number) ?? 0,
      firstSessionAtMs: (a.firstSessionAtMs as number | null) ?? null,
      lastSessionAtMs: (a.lastSessionAtMs as number | null) ?? null,
      // Session shapes, so the client can re-price purged sessions with the
      // model it is running today rather than one frozen at purge time.
      sizes: (a.sizes as Record<string, number>) ?? {},
    };
  });

  return {
    generatedAtMs: Date.now(),
    // How long a session stays queryable in full. Past this it survives only as
    // the counts in `archive` — no titles, no per-student detail.
    retentionDays: RETENTION_DAYS,
    // What answering this question cost, in billable reads.
    docsRead:
      userSnap.size + sessionSnap.size + playerSnap.size + archiveSnap.size,
    instructors,
    sessions,
    archive,
  };
});

// ---------------------------------------------------------------------------
// 8. cleanupSessions — daily purge of sessions older than RETENTION_DAYS.
// ---------------------------------------------------------------------------
/**
 * The purge itself, split out from its schedule so it can be invoked directly.
 *
 * A scheduled function is not reachable over HTTP in the emulator, which made
 * this — the one code path that permanently destroys data, and the one that
 * has to archive it first — the only path with no way to exercise it short of
 * waiting a day in production. Now a test can just call it.
 */
export async function purgeStaleSessions(): Promise<{
  archived: number;
  deleted: number;
  skipped: number;
}> {
  const cutoff = Timestamp.fromMillis(
    Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000
  );

  const stale = await db
    .collection("sessions")
    .where("createdAt", "<", cutoff)
    .get();

  let archived = 0;
  let deleted = 0;
  let skipped = 0;

  for (const doc of stale.docs) {
    const data = doc.data();
    const code = data.code as string | undefined;
    // One session failing to archive must not stop the purge, and must not stop
    // the sessions after it either — but it also must not be deleted, or its
    // usage is lost for good. Skip it and let tomorrow's run retry.
    try {
      await archiveSessionUsage(doc.ref, data);
      archived++;
    } catch (err) {
      logger.error("could not archive session usage; leaving it in place", {
        sessionId: doc.id,
        err: String(err),
      });
      skipped++;
      continue;
    }
    await db.recursiveDelete(doc.ref);
    if (code) {
      await db.collection("sessionCodes").doc(code).delete();
    }
    deleted++;
  }

  logger.info("purge complete", { archived, deleted, skipped });
  return { archived, deleted, skipped };
}

export const cleanupSessions = onSchedule("every 24 hours", async () => {
  await purgeStaleSessions();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
