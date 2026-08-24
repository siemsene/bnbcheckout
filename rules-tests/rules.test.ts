import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { beforeAll, afterAll, beforeEach, describe, it } from "vitest";
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc, collection } from "firebase/firestore";

const __dirname = dirname(fileURLToPath(import.meta.url));

let testEnv: RulesTestEnvironment;

const SID = "sess1";
const CODE = "ABC234";
const PID = "player1";
const STUDENT = "stu-1"; // owns player1
const OTHER = "stu-2";
const INSTRUCTOR = "teach-1";

/** Seed a session, name ticket, player and private checkpoint with rules off. */
async function seed() {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "sessionCodes", CODE), {
      sessionId: SID,
      createdAt: new Date(),
    });
    await setDoc(doc(db, "sessions", SID), {
      code: CODE,
      instructorUid: INSTRUCTOR,
      title: "Test session",
      status: "running",
      createdAt: new Date(),
      playerCount: 1,
      settings: { simDeadlineMin: 120, compression: 8 },
    });
    await setDoc(doc(db, "sessions", SID, "names", "alice"), {
      playerId: PID,
      displayName: "Alice",
      uid: STUDENT,
      claimedAt: new Date(),
    });
    await setDoc(doc(db, "sessions", SID, "players", PID), {
      name: "Alice",
      uid: STUDENT,
      joinedAt: new Date(),
      phase: "running",
      simMinute: 10,
      pctComplete: 0.25,
      utilizationAvg: 0.5,
      finished: false,
      finishSimMinute: null,
      score: 0,
      seed: 12345,
      lastWriteAt: new Date(),
    });
    await setDoc(doc(db, "sessions", SID, "players", PID, "private", "checkpoint"), {
      engineVersion: 1,
      seed: 12345,
      tick: 42,
      stateJSON: "{}",
      savedAt: new Date(),
      uid: STUDENT,
    });
  });
}

/** A valid owner update of the player summary doc (unchanged identity/seed). */
function playerUpdate(overrides: Record<string, unknown> = {}) {
  return {
    simMinute: 20,
    pctComplete: 0.5,
    utilizationAvg: 0.6,
    phase: "running",
    lastWriteAt: new Date(),
    ...overrides,
  };
}

beforeAll(async () => {
  const hostEnv = process.env.FIRESTORE_EMULATOR_HOST ?? "localhost:8080";
  const [host, port] = hostEnv.split(":");
  testEnv = await initializeTestEnvironment({
    projectId: "demo-checkout",
    firestore: {
      rules: readFileSync(join(__dirname, "..", "firestore.rules"), "utf8"),
      host,
      port: Number(port),
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await seed();
});

describe("players/{pid}", () => {
  it("owner can update own summary with increasing simMinute", async () => {
    const db = testEnv.authenticatedContext(STUDENT).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "sessions", SID, "players", PID), playerUpdate())
    );
  });

  it("owner can update with equal simMinute (>= allowed)", async () => {
    const db = testEnv.authenticatedContext(STUDENT).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "sessions", SID, "players", PID), playerUpdate({ simMinute: 10 }))
    );
  });

  it("decreasing simMinute is rejected", async () => {
    const db = testEnv.authenticatedContext(STUDENT).firestore();
    await assertFails(
      updateDoc(doc(db, "sessions", SID, "players", PID), playerUpdate({ simMinute: 5 }))
    );
  });

  it("changing name is rejected", async () => {
    const db = testEnv.authenticatedContext(STUDENT).firestore();
    await assertFails(
      updateDoc(doc(db, "sessions", SID, "players", PID), playerUpdate({ name: "Mallory" }))
    );
  });

  it("changing uid is rejected", async () => {
    const db = testEnv.authenticatedContext(STUDENT).firestore();
    await assertFails(
      updateDoc(doc(db, "sessions", SID, "players", PID), playerUpdate({ uid: OTHER }))
    );
  });

  it("changing seed is rejected", async () => {
    const db = testEnv.authenticatedContext(STUDENT).firestore();
    await assertFails(
      updateDoc(doc(db, "sessions", SID, "players", PID), playerUpdate({ seed: 999 }))
    );
  });

  it("another student cannot write someone else's player doc", async () => {
    const db = testEnv.authenticatedContext(OTHER).firestore();
    await assertFails(
      updateDoc(doc(db, "sessions", SID, "players", PID), playerUpdate())
    );
  });

  it("clients cannot create player docs", async () => {
    const db = testEnv.authenticatedContext(OTHER).firestore();
    await assertFails(
      setDoc(doc(db, "sessions", SID, "players", "newplayer"), {
        name: "Eve",
        uid: OTHER,
        joinedAt: new Date(),
        phase: "lobby",
        simMinute: 0,
        pctComplete: 0,
        utilizationAvg: 0,
        finished: false,
        finishSimMinute: null,
        score: 0,
        seed: 1,
        lastWriteAt: new Date(),
      })
    );
  });

  it("signed-in (anonymous) users can read player docs (leaderboard)", async () => {
    const db = testEnv.authenticatedContext(OTHER).firestore();
    await assertSucceeds(getDoc(doc(db, "sessions", SID, "players", PID)));
  });
});

describe("sessions/{sid}", () => {
  it("unauthenticated cannot read sessions", async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, "sessions", SID)));
  });

  it("signed-in (anonymous) can read sessions", async () => {
    const db = testEnv.authenticatedContext(STUDENT).firestore();
    await assertSucceeds(getDoc(doc(db, "sessions", SID)));
  });

  it("instructor claim can create a session with own instructorUid", async () => {
    const db = testEnv
      .authenticatedContext(INSTRUCTOR, { instructor: true })
      .firestore();
    await assertSucceeds(
      setDoc(doc(db, "sessions", "sess2"), {
        code: "DEF345",
        instructorUid: INSTRUCTOR,
        title: "Another session",
        status: "lobby",
        createdAt: new Date(),
        playerCount: 0,
        settings: { simDeadlineMin: 120, compression: 8 },
      })
    );
  });

  it("instructor cannot create a session with someone else's instructorUid", async () => {
    const db = testEnv
      .authenticatedContext(INSTRUCTOR, { instructor: true })
      .firestore();
    await assertFails(
      setDoc(doc(db, "sessions", "sess3"), {
        code: "GHJ456",
        instructorUid: "someone-else",
        title: "Spoofed session",
        status: "lobby",
        createdAt: new Date(),
        playerCount: 0,
        settings: { simDeadlineMin: 120, compression: 8 },
      })
    );
  });

  it("plain user (no instructor claim) cannot create a session", async () => {
    const db = testEnv.authenticatedContext(STUDENT).firestore();
    await assertFails(
      setDoc(doc(db, "sessions", "sess4"), {
        code: "KMN567",
        instructorUid: STUDENT,
        title: "Nope",
        status: "lobby",
        createdAt: new Date(),
        playerCount: 0,
        settings: { simDeadlineMin: 120, compression: 8 },
      })
    );
  });
});

describe("users/{uid}", () => {
  it("user can create own pending doc", async () => {
    const db = testEnv
      .authenticatedContext("newteach", { email: "new@example.com" })
      .firestore();
    await assertSucceeds(
      setDoc(doc(db, "users", "newteach"), {
        email: "new@example.com",
        displayName: "New Teacher",
        status: "pending",
        createdAt: new Date(),
      })
    );
  });

  it("cannot create own doc with status 'approved'", async () => {
    const db = testEnv
      .authenticatedContext("newteach", { email: "new@example.com" })
      .firestore();
    await assertFails(
      setDoc(doc(db, "users", "newteach"), {
        email: "new@example.com",
        displayName: "New Teacher",
        status: "approved",
        createdAt: new Date(),
      })
    );
  });

  it("non-admin cannot update another user's doc", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", "victim"), {
        email: "victim@example.com",
        displayName: "Victim",
        status: "pending",
        createdAt: new Date(),
      });
    });
    const db = testEnv.authenticatedContext(OTHER).firestore();
    await assertFails(
      updateDoc(doc(db, "users", "victim"), { status: "approved" })
    );
  });

  it("admin claim can update a user doc", async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users", "victim"), {
        email: "victim@example.com",
        displayName: "Victim",
        status: "pending",
        createdAt: new Date(),
      });
    });
    const db = testEnv.authenticatedContext("admin-u", { admin: true }).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "users", "victim"), { status: "approved" })
    );
  });
});

describe("function-only collections", () => {
  it("clients cannot write mail/", async () => {
    const db = testEnv.authenticatedContext(STUDENT).firestore();
    await assertFails(
      setDoc(doc(collection(db, "mail")), {
        to: "x@example.com",
        message: { subject: "spam", html: "spam" },
      })
    );
  });

  it("clients cannot write sessionCodes/", async () => {
    const db = testEnv.authenticatedContext(STUDENT).firestore();
    await assertFails(
      setDoc(doc(db, "sessionCodes", "ZZZZZZ"), {
        sessionId: "hijack",
        createdAt: new Date(),
      })
    );
  });

  it("clients cannot write names/", async () => {
    const db = testEnv.authenticatedContext(STUDENT).firestore();
    await assertFails(
      setDoc(doc(db, "sessions", SID, "names", "bob"), {
        playerId: "pX",
        displayName: "Bob",
        uid: STUDENT,
        claimedAt: new Date(),
      })
    );
  });
});

describe("players/{pid}/private/{doc}", () => {
  it("owner can write checkpoint with data.uid == own uid", async () => {
    const db = testEnv.authenticatedContext(STUDENT).firestore();
    await assertSucceeds(
      setDoc(doc(db, "sessions", SID, "players", PID, "private", "checkpoint"), {
        engineVersion: 1,
        seed: 12345,
        tick: 99,
        stateJSON: "{\"a\":1}",
        savedAt: new Date(),
        uid: STUDENT,
      })
    );
  });

  it("owner cannot write checkpoint with a different data.uid", async () => {
    const db = testEnv.authenticatedContext(STUDENT).firestore();
    await assertFails(
      setDoc(doc(db, "sessions", SID, "players", PID, "private", "checkpoint"), {
        engineVersion: 1,
        seed: 12345,
        tick: 99,
        stateJSON: "{}",
        savedAt: new Date(),
        uid: OTHER,
      })
    );
  });

  it("owner can read own checkpoint", async () => {
    const db = testEnv.authenticatedContext(STUDENT).firestore();
    await assertSucceeds(
      getDoc(doc(db, "sessions", SID, "players", PID, "private", "checkpoint"))
    );
  });

  it("another user cannot read the checkpoint", async () => {
    const db = testEnv.authenticatedContext(OTHER).firestore();
    await assertFails(
      getDoc(doc(db, "sessions", SID, "players", PID, "private", "checkpoint"))
    );
  });

  it("another user cannot write the checkpoint", async () => {
    const db = testEnv.authenticatedContext(OTHER).firestore();
    await assertFails(
      setDoc(doc(db, "sessions", SID, "players", PID, "private", "checkpoint"), {
        engineVersion: 1,
        seed: 12345,
        tick: 1,
        stateJSON: "{}",
        savedAt: new Date(),
        uid: OTHER,
      })
    );
  });

  it("instructor claim can read the checkpoint", async () => {
    const db = testEnv
      .authenticatedContext(INSTRUCTOR, { instructor: true })
      .firestore();
    await assertSucceeds(
      getDoc(doc(db, "sessions", SID, "players", PID, "private", "checkpoint"))
    );
  });
});
