/**
 * Cloud Functions for Checkout Rush.
 *
 * firebase-functions v2 API, Node 20, region us-central1 (default).
 */
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";

admin.initializeApp();

const db = admin.firestore();

const ADMIN_EMAIL = "siemsene@gmail.com";
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

// ---------------------------------------------------------------------------
// 1. onInstructorRegistered — notify the admin when a new instructor signs up.
// ---------------------------------------------------------------------------
export const onInstructorRegistered = onDocumentCreated(
  "users/{uid}",
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const data = snap.data();
    const displayName = (data.displayName as string) ?? "(no name)";
    const email = (data.email as string) ?? "(no email)";

    await db.collection("mail").add({
      to: ADMIN_EMAIL,
      message: {
        subject: `Checkout Rush: instructor registration pending — ${displayName}`,
        html:
          `<p>A new instructor has registered and is awaiting approval.</p>` +
          `<p><strong>Name:</strong> ${escapeHtml(displayName)}<br/>` +
          `<strong>Email:</strong> ${escapeHtml(email)}<br/>` +
          `<strong>UID:</strong> ${escapeHtml(event.params.uid)}</p>` +
          `<p>Open the admin page to approve.</p>`,
      },
    });
  }
);

// ---------------------------------------------------------------------------
// 2. approveInstructor — admin approves or rejects a pending instructor.
// ---------------------------------------------------------------------------
export const approveInstructor = onCall(async (request) => {
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
  const authUser = await admin.auth().getUser(uid);
  const claims: Record<string, unknown> = { ...(authUser.customClaims ?? {}) };
  if (approve) {
    claims.instructor = true;
  } else {
    delete claims.instructor;
  }
  await admin.auth().setCustomUserClaims(uid, claims);

  await userRef.update({
    status: approve ? "approved" : "rejected",
    approvedAt: admin.firestore.FieldValue.serverTimestamp(),
    approvedBy: request.auth!.uid,
  });

  const email = userData.email as string | undefined;
  if (email) {
    const outcome = approve ? "approved" : "rejected";
    await db.collection("mail").add({
      to: email,
      message: {
        subject: `Checkout Rush: your instructor account was ${outcome}`,
        html: approve
          ? `<p>Good news — your Checkout Rush instructor account has been approved. ` +
            `Sign out and sign back in, then you can create sessions.</p>`
          : `<p>Your Checkout Rush instructor registration was rejected. ` +
            `If you believe this is a mistake, contact ${ADMIN_EMAIL}.</p>`,
      },
    });
  }

  return { uid, status: approve ? "approved" : "rejected" };
});

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

  const authUser = await admin.auth().getUser(request.auth.uid);
  const claims: Record<string, unknown> = { ...(authUser.customClaims ?? {}) };
  claims.admin = true;
  await admin.auth().setCustomUserClaims(request.auth.uid, claims);

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
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        tx.create(sessionRef, {
          code,
          instructorUid,
          title: title.trim(),
          status: "lobby",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          playerCount: 0,
          settings: { simDeadlineMin: 120, compression: 8 },
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

      return { sessionId, playerId, seed, rejoined: true };
    }

    // New player.
    const playerRef = sessionRef.collection("players").doc();
    const playerId = playerRef.id;
    const createdAtMillis =
      session.createdAt instanceof admin.firestore.Timestamp
        ? session.createdAt.toMillis()
        : 0;
    const seed = (fnv1a32(sessionId + nameLower) ^ createdAtMillis) >>> 0;

    tx.create(nameRef, {
      playerId,
      displayName: name,
      uid,
      claimedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.create(playerRef, {
      name,
      uid,
      joinedAt: admin.firestore.FieldValue.serverTimestamp(),
      phase: "lobby",
      simMinute: 0,
      pctComplete: 0,
      utilizationAvg: 0,
      finished: false,
      finishSimMinute: null,
      score: 0,
      seed,
      lastWriteAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.update(sessionRef, {
      playerCount: admin.firestore.FieldValue.increment(1),
    });

    return { sessionId, playerId, seed, rejoined: false };
  });
});

// ---------------------------------------------------------------------------
// 6. cleanupSessions — daily purge of sessions older than 30 days.
// ---------------------------------------------------------------------------
export const cleanupSessions = onSchedule("every 24 hours", async () => {
  const cutoff = admin.firestore.Timestamp.fromMillis(
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
