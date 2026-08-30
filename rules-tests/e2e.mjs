/**
 * End-to-end test of the auth/session flow against the full emulator suite.
 *
 * Run from the repo root (so firebase.json is found):
 *   npx firebase-tools emulators:exec --only auth,firestore,functions \
 *     --project demo-checkout "node rules-tests/e2e.mjs"
 */
import { initializeApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  signInAnonymously,
} from "firebase/auth";
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  collection,
  serverTimestamp,
} from "firebase/firestore";
import {
  getFunctions,
  connectFunctionsEmulator,
  httpsCallable,
} from "firebase/functions";

const PROJECT = "demo-checkout";
const AUTH_HOST = "http://127.0.0.1:9099";
const ADMIN_EMAIL = "siemsene@gmail.com";

let passed = 0;
let failed = 0;

function check(name, cond, extra = "") {
  if (cond) {
    passed++;
    console.log(`PASS: ${name}`);
  } else {
    failed++;
    console.log(`FAIL: ${name}${extra ? " — " + extra : ""}`);
  }
}

async function expectError(name, fn, codeSubstr) {
  try {
    await fn();
    check(name, false, `expected error containing '${codeSubstr}' but call succeeded`);
    return null;
  } catch (err) {
    const code = err?.code ?? String(err);
    const ok = String(code).includes(codeSubstr);
    check(name, ok, ok ? "" : `expected '${codeSubstr}', got '${code}': ${err?.message}`);
    return err;
  }
}

function makeCtx(name) {
  const app = initializeApp(
    { projectId: PROJECT, apiKey: "fake-api-key", authDomain: "127.0.0.1" },
    name
  );
  const auth = getAuth(app);
  connectAuthEmulator(auth, AUTH_HOST, { disableWarnings: true });
  const dbi = getFirestore(app);
  connectFirestoreEmulator(dbi, "127.0.0.1", 8080);
  const fns = getFunctions(app, "us-central1");
  connectFunctionsEmulator(fns, "127.0.0.1", 5001);
  return { app, auth, db: dbi, fns };
}

async function main() {
  // ---------------------------------------------------------------- Step 1
  console.log("--- Step 1: admin bootstrap ---");
  const adminCtx = makeCtx("admin");
  const adminCred = await createUserWithEmailAndPassword(
    adminCtx.auth,
    ADMIN_EMAIL,
    "admintest123"
  );
  const adminUser = adminCred.user;
  check("admin user created", !!adminUser.uid);

  await sendEmailVerification(adminUser);
  const oobResp = await fetch(`${AUTH_HOST}/emulator/v1/projects/${PROJECT}/oobCodes`);
  const oobJson = await oobResp.json();
  const oob = (oobJson.oobCodes ?? []).find(
    (c) => c.email === ADMIN_EMAIL && c.requestType === "VERIFY_EMAIL"
  );
  check("verification oobCode found", !!oob);

  const applyResp = await fetch(
    `${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:update?key=fake-api-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ oobCode: oob?.oobCode }),
    }
  );
  check("oobCode applied via REST", applyResp.ok, `status ${applyResp.status}`);

  await adminUser.reload();
  check("admin emailVerified after reload", adminUser.emailVerified === true);

  // Refresh token so email_verified lands in the ID token before the callable.
  await adminUser.getIdToken(true);

  const setAdminClaim = httpsCallable(adminCtx.fns, "setAdminClaim");
  const claimRes = await setAdminClaim();
  check("setAdminClaim returned admin:true", claimRes.data?.admin === true);

  const adminTok = await adminUser.getIdTokenResult(true);
  check("admin claim present in ID token", adminTok.claims.admin === true);

  // ---------------------------------------------------------------- Step 2
  console.log("--- Step 2: instructor registration ---");
  const instrCtx = makeCtx("instructor");
  const instrCred = await createUserWithEmailAndPassword(
    instrCtx.auth,
    "instructor@example.com",
    "instrpass123"
  );
  const instrUser = instrCred.user;
  const instrUid = instrUser.uid;

  await setDoc(doc(instrCtx.db, "users", instrUid), {
    email: "instructor@example.com",
    displayName: "Dr. Test",
    affiliation: "University College Dublin",
    status: "pending",
    createdAt: serverTimestamp(),
  });
  const instrDoc = await getDoc(doc(instrCtx.db, "users", instrUid));
  check(
    "instructor users doc created as pending",
    instrDoc.exists() && instrDoc.data().status === "pending"
  );
  check(
    "affiliation stored on registration",
    instrDoc.data().affiliation === "University College Dublin"
  );

  // Accounts predating the affiliation field, and profiles rebuilt by the
  // client's repair path, carry none — the admin fills those in from /admin,
  // which needs `allow update: if isAdmin()` to accept the write.
  await expectError(
    "instructor cannot edit their own affiliation",
    () =>
      updateDoc(doc(instrCtx.db, "users", instrUid), {
        affiliation: "Self-Declared University",
      }),
    "permission-denied"
  );
  await updateDoc(doc(adminCtx.db, "users", instrUid), {
    affiliation: "UW-Madison",
  });
  const edited = await getDoc(doc(instrCtx.db, "users", instrUid));
  check("admin can set affiliation", edited.data().affiliation === "UW-Madison");

  await expectError(
    "mail collection unreadable by clients",
    () => getDocs(collection(instrCtx.db, "mail")),
    "permission-denied"
  );
  // Note: mail docs are written by the onInstructorRegistered trigger with the
  // Admin SDK; clients cannot read them, so the trigger's effect is only
  // observable in the functions emulator log.

  // ---------------------------------------------------------------- Step 3
  console.log("--- Step 3: approval ---");
  const approveInstructor = httpsCallable(adminCtx.fns, "approveInstructor");
  const approveRes = await approveInstructor({ uid: instrUid, approve: true });
  check("approveInstructor returned approved", approveRes.data?.status === "approved");

  const instrTok = await instrUser.getIdTokenResult(true);
  check("instructor claim present", instrTok.claims.instructor === true);

  const instrDoc2 = await getDoc(doc(instrCtx.db, "users", instrUid));
  check(
    "users doc status == approved",
    instrDoc2.exists() && instrDoc2.data().status === "approved"
  );

  // ---------------------------------------------------------------- Step 4
  console.log("--- Step 4: create session ---");
  const createSession = httpsCallable(instrCtx.fns, "createSession");
  const sessRes = await createSession({ title: "E2E" });
  const { sessionId, code } = sessRes.data ?? {};
  check("createSession returned code matching pattern", /^[A-HJ-NP-Z2-9]{6}$/.test(code ?? ""),
    `code=${code}`);

  const sessDoc = await getDoc(doc(instrCtx.db, "sessions", sessionId));
  check(
    "session doc readable, title/code correct",
    sessDoc.exists() && sessDoc.data().title === "E2E" && sessDoc.data().code === code
  );

  // ---------------------------------------------------------------- Step 5
  console.log("--- Step 5: student join ---");
  const kidCtx = makeCtx("student1");
  const kidCred = await signInAnonymously(kidCtx.auth);
  const kidUid = kidCred.user.uid;

  const joinSession1 = httpsCallable(kidCtx.fns, "joinSession");
  const join1 = await joinSession1({ code, name: "TestKid" });
  const { playerId, seed, rejoined } = join1.data ?? {};
  check("joinSession returned playerId + seed", !!playerId && typeof seed === "number");
  check("first join rejoined === false", rejoined === false);

  const playerPath = ["sessions", sessionId, "players", playerId];
  const playerDoc1 = await getDoc(doc(kidCtx.db, ...playerPath));
  check(
    "players doc name == TestKid, uid == student1",
    playerDoc1.exists() &&
      playerDoc1.data().name === "TestKid" &&
      playerDoc1.data().uid === kidUid
  );

  // ---------------------------------------------------------------- Step 6
  console.log("--- Step 6: duplicate name rebind ---");
  const kid2Ctx = makeCtx("student2");
  const kid2Cred = await signInAnonymously(kid2Ctx.auth);
  const kid2Uid = kid2Cred.user.uid;

  const joinSession2 = httpsCallable(kid2Ctx.fns, "joinSession");
  const join2 = await joinSession2({ code, name: "TestKid" });
  check("duplicate name rejoined === true", join2.data?.rejoined === true);
  check("rebind kept same playerId", join2.data?.playerId === playerId);

  const playerDoc2 = await getDoc(doc(kid2Ctx.db, ...playerPath));
  check(
    "players doc uid rebound to student2",
    playerDoc2.exists() && playerDoc2.data().uid === kid2Uid
  );

  const join3 = await joinSession2({ code, name: "testkid " });
  check("normalized name ('testkid ') rejoined === true", join3.data?.rejoined === true);
  check("normalized rebind same playerId", join3.data?.playerId === playerId);
  const playerDoc3 = await getDoc(doc(kid2Ctx.db, ...playerPath));
  check(
    "players doc uid still student2 after normalized rebind",
    playerDoc3.exists() && playerDoc3.data().uid === kid2Uid
  );

  // ------------------------------------------------------------- Step 6.5
  console.log("--- Step 6.5: two-stage classroom flow ---");

  // A second, separate session so the readiness maths is unambiguous.
  const stageRes = await createSession({ title: "Staged", planningMinutes: 1 });
  const stageId = stageRes.data?.sessionId;
  const stageCode = stageRes.data?.code;
  const stageRef = doc(instrCtx.db, "sessions", stageId);

  let d = (await getDoc(stageRef)).data();
  check("createSession stored planningMinutes", d.settings?.planningMinutes === 1);
  check("new session starts in lobby with no runStartsAt", d.status === "lobby" && !d.runStartsAt);

  const aCtx = makeCtx("stageA");
  await signInAnonymously(aCtx.auth);
  const bCtx = makeCtx("stageB");
  await signInAnonymously(bCtx.auth);
  const joinA = await httpsCallable(aCtx.fns, "joinSession")({ code: stageCode, name: "Ana" });
  const joinB = await httpsCallable(bCtx.fns, "joinSession")({ code: stageCode, name: "Ben" });
  const aId = joinA.data.playerId;
  const bId = joinB.data.playerId;
  check("joinSession returns serverNowMs for clock correction",
    typeof joinA.data.serverNowMs === "number");

  const readyA = httpsCallable(aCtx.fns, "markReady");
  const readyB = httpsCallable(bCtx.fns, "markReady");

  await expectError(
    "markReady before planning opens is rejected",
    () => readyA({ sessionId: stageId, playerId: aId }),
    "failed-precondition"
  );

  const control = httpsCallable(instrCtx.fns, "sessionControl");
  await control({ sessionId: stageId, action: "openPlanning" });
  d = (await getDoc(stageRef)).data();
  const plannedStart = d.runStartsAt.toMillis();
  check("openPlanning sets status + a ~1min runStartsAt",
    d.status === "planning" && Math.abs(plannedStart - Date.now() - 60_000) < 15_000,
    `delta=${plannedStart - Date.now()}`);

  // The countdown cap IS the fallback start, so one ready student must not move it.
  await readyA({ sessionId: stageId, playerId: aId });
  d = (await getDoc(stageRef)).data();
  check("one of two ready leaves the start time alone",
    d.runStartsAt.toMillis() === plannedStart);
  check("markReady set the player's ready flag",
    (await getDoc(doc(aCtx.db, "sessions", stageId, "players", aId))).data().ready === true);

  // Idempotent: pressing Ready twice must not double-count.
  await readyA({ sessionId: stageId, playerId: aId });
  d = (await getDoc(stageRef)).data();
  check("repeat markReady is idempotent (start still unmoved)",
    d.runStartsAt.toMillis() === plannedStart);

  await expectError(
    "markReady on someone else's player slot is denied",
    () => readyB({ sessionId: stageId, playerId: aId }),
    "permission-denied"
  );

  await expectError(
    "student cannot set ready directly (rules)",
    () => updateDoc(doc(bCtx.db, "sessions", stageId, "players", bId), { ready: true }),
    "permission-denied"
  );

  // The last student readying pulls the whole room's start forward.
  const readyRes = await readyB({ sessionId: stageId, playerId: bId });
  check("last ready reports allReady", readyRes.data?.allReady === true);
  d = (await getDoc(stageRef)).data();
  check("all ready pulls runStartsAt forward",
    d.runStartsAt.toMillis() < plannedStart,
    `was ${plannedStart}, now ${d.runStartsAt.toMillis()}`);

  await expectError(
    "instructor cannot stamp runStartsAt directly (rules)",
    () => updateDoc(stageRef, { instructorUid: instrUid, runStartsAt: new Date() }),
    "permission-denied"
  );

  // Wait out the short countdown, then check the join gate.
  const startsAt = d.runStartsAt.toMillis();
  await new Promise((r) => setTimeout(r, Math.max(0, startsAt - Date.now()) + 500));

  const cCtx = makeCtx("stageC");
  await signInAnonymously(cCtx.auth);
  await expectError(
    "a NEW name cannot join a run already under way",
    () => httpsCallable(cCtx.fns, "joinSession")({ code: stageCode, name: "Latecomer" }),
    "failed-precondition"
  );
  const rejoinA = await httpsCallable(aCtx.fns, "joinSession")({ code: stageCode, name: "Ana" });
  check("but a REJOIN still works mid-run (the refresh path)",
    rejoinA.data?.rejoined === true && rejoinA.data?.playerId === aId);

  // ---------------------------------------------------------------- Step 7
  console.log("--- Step 7: progress writes ---");
  const ownerPlayerRef = doc(kid2Ctx.db, ...playerPath);
  await updateDoc(ownerPlayerRef, {
    simMinute: 5,
    pctComplete: 0.1,
    utilizationAvg: 0.2,
    finished: false,
    finishSimMinute: null,
    score: 900,
    phase: "running",
    lastWriteAt: serverTimestamp(),
  });
  const afterProgress = await getDoc(ownerPlayerRef);
  check(
    "owner progress write succeeded (simMinute 5, score 900)",
    afterProgress.data().simMinute === 5 && afterProgress.data().score === 900
  );

  await expectError(
    "simMinute decrease denied",
    () => updateDoc(ownerPlayerRef, { simMinute: 3 }),
    "permission-denied"
  );

  await expectError(
    "non-owner progress write denied",
    () => updateDoc(doc(kidCtx.db, ...playerPath), { simMinute: 6 }),
    "permission-denied"
  );

  // ---------------------------------------------------------------- Step 8
  console.log("--- Step 8: checkpoint ---");
  const checkpointPath = [...playerPath, "private", "checkpoint"];
  await setDoc(doc(kid2Ctx.db, ...checkpointPath), {
    engineVersion: 1,
    seed,
    tick: 300,
    stateJSON: "{}",
    uid: kid2Uid,
    savedAt: serverTimestamp(),
  });
  const cpOwner = await getDoc(doc(kid2Ctx.db, ...checkpointPath));
  check("owner wrote and read checkpoint", cpOwner.exists() && cpOwner.data().tick === 300);

  await expectError(
    "other anonymous user checkpoint read denied",
    () => getDoc(doc(kidCtx.db, ...checkpointPath)),
    "permission-denied"
  );

  const cpInstr = await getDoc(doc(instrCtx.db, ...checkpointPath));
  check("instructor checkpoint read allowed", cpInstr.exists());

  // ---------------------------------------------------------------- Step 9
  console.log("--- Step 9: ended session ---");
  await updateDoc(doc(instrCtx.db, "sessions", sessionId), { status: "ended" });
  const endedDoc = await getDoc(doc(instrCtx.db, "sessions", sessionId));
  check("instructor set session status to ended", endedDoc.data().status === "ended");

  const lateCtx = makeCtx("student3");
  await signInAnonymously(lateCtx.auth);
  const joinLate = httpsCallable(lateCtx.fns, "joinSession");
  await expectError(
    "join on ended session rejected",
    () => joinLate({ code, name: "LateKid" }),
    "failed-precondition"
  );

  // ---------------------------------------------------------------- Summary
  console.log(`E2E: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("E2E: fatal error:", err);
  console.log(`E2E: ${passed} passed, ${failed + 1} failed (aborted)`);
  process.exit(1);
});
