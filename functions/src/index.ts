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
const DEFAULT_PLAN_MINUTES = 8;

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
      action === "openPlan2"
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
      if (existingMs == null || now < existingMs + runWindowMs(session)) {
        // Not simply pedantry: opening early would drag students out of a run
        // that, as far as their own clock is concerned, is still going.
        throw new HttpsError(
          "failed-precondition",
          "Run 1 is still going. Wait for it to finish, or end the session."
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
// 6. cleanupSessions — daily purge of sessions older than 30 days.
// ---------------------------------------------------------------------------
export const cleanupSessions = onSchedule("every 24 hours", async () => {
  const cutoff = Timestamp.fromMillis(
    Date.now() - 30 * 24 * 60 * 60 * 1000
  );

  const stale = await db
    .collection("sessions")
    .where("createdAt", "<", cutoff)
    .get();

  for (const doc of stale.docs) {
    const code = doc.data().code as string | undefined;
    await db.recursiveDelete(doc.ref);
    if (code) {
      await db.collection("sessionCodes").doc(code).delete();
    }
  }
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
