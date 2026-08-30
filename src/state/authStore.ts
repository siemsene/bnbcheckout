// Instructor/admin auth state (email+password accounts, custom claims).

import { create } from 'zustand';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db, firebaseEnabled } from '../firebase/client';

interface AuthStore {
  user: User | null;
  /** From custom claims. */
  isAdmin: boolean;
  isInstructor: boolean;
  /** From users/{uid} doc. */
  instructorStatus: 'pending' | 'approved' | 'rejected' | null;
  loading: boolean;
  error: string | null;

  init(): void;
  register(
    email: string,
    password: string,
    displayName: string,
    affiliation: string,
  ): Promise<boolean>;
  login(email: string, password: string): Promise<boolean>;
  logout(): Promise<void>;
  refreshClaims(): Promise<void>;
  /** Send the verification email again (it lands in spam more often than not). */
  resendVerification(): Promise<boolean>;
  /** Re-read emailVerified from the server after the link is clicked. */
  reloadUser(): Promise<void>;
}

/**
 * Turn a Firebase error into something true.
 *
 * Every failure here used to surface as "Wrong email or password", including
 * network and configuration failures — which is exactly how a deployment
 * pointed at an unreachable emulator came to look like a bad password. Report
 * what actually happened; a wrong credential is only one of the possibilities.
 */
function authErrorMessage(e: unknown, fallback: string): string {
  const code =
    typeof e === 'object' && e !== null && 'code' in e
      ? String((e as { code: unknown }).code)
      : '';

  switch (code) {
    // Genuinely bad credentials. Modern Firebase collapses wrong-password and
    // user-not-found into invalid-credential when email enumeration protection
    // is on, so all three get the same wording.
    case 'auth/invalid-credential':
    case 'auth/invalid-login-credentials':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Wrong email or password.';

    case 'auth/invalid-email':
      return 'That does not look like a valid email address.';
    case 'auth/user-disabled':
      return 'That account has been disabled. Contact the site admin.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a few minutes, then try again.';
    case 'auth/email-already-in-use':
      return 'That email is already registered — sign in instead.';
    case 'auth/weak-password':
      return 'Pick a password of at least 8 characters.';

    // Not the user's fault — say so, so nobody retypes a correct password.
    case 'auth/network-request-failed':
    case 'unavailable':
      return (
        'Could not reach the authentication server. Check your connection — ' +
        'and if this is a local build, that the Firebase emulators are running.'
      );
    case 'auth/operation-not-allowed':
      return 'Email/password sign-in is not enabled on this Firebase project.';
    case 'auth/api-key-not-valid':
    case 'auth/invalid-api-key':
    case 'auth/configuration-not-found':
      return 'This build has an invalid Firebase configuration. Check VITE_FIREBASE_*.';
    case 'permission-denied':
      return 'The server refused that write. Check the Firestore security rules.';
  }

  const msg = e instanceof Error ? e.message : '';
  return code || msg ? `${fallback} (${code || msg})` : fallback;
}

/**
 * Create the pending approval request at users/{uid}.
 *
 * `email` comes from the Auth record, never from the typed-in string: the
 * security rule requires `request.resource.data.email == request.auth.token.email`,
 * and Firebase normalises the address it stores. Writing what the user typed
 * meant any capitalisation ("Name@Gmail.com") was rejected by the rules.
 */
async function writeInstructorProfile(
  user: User,
  displayName: string,
  affiliation: string,
): Promise<void> {
  const trimmedAffiliation = affiliation.trim();
  await setDoc(doc(db(), 'users', user.uid), {
    email: user.email ?? '',
    displayName: displayName.trim() || user.displayName || user.email || '(no name)',
    // Omitted rather than written empty when unknown: setDoc rejects undefined,
    // and the recovery path below genuinely has no affiliation to offer, so
    // "absent" and "left blank" must stay distinguishable on the admin screen.
    ...(trimmedAffiliation ? { affiliation: trimmedAffiliation } : {}),
    status: 'pending',
    createdAt: serverTimestamp(),
  });
}

let initialized = false;

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  isAdmin: false,
  isInstructor: false,
  instructorStatus: null,
  loading: true,
  error: null,

  init() {
    if (initialized || !firebaseEnabled) {
      if (!firebaseEnabled) set({ loading: false });
      return;
    }
    initialized = true;
    onAuthStateChanged(auth(), async (user) => {
      if (!user || user.isAnonymous) {
        set({ user: null, isAdmin: false, isInstructor: false, instructorStatus: null, loading: false });
        return;
      }
      set({ user, loading: false });
      await get().refreshClaims();
    });
  },

  async resendVerification() {
    const user = auth().currentUser;
    if (!user) return false;
    set({ error: null });
    try {
      await sendEmailVerification(user);
      return true;
    } catch (e) {
      // Firebase throttles these fairly aggressively; say so rather than
      // leaving the button looking broken.
      const msg = e instanceof Error ? e.message : '';
      set({
        error: /too-many-requests/.test(msg)
          ? 'Firebase is rate-limiting verification emails — wait a few minutes and try again.'
          : msg || 'Could not resend the verification email.',
      });
      return false;
    }
  },

  async reloadUser() {
    const user = auth().currentUser;
    if (!user) return;
    await user.reload();
    // reload() mutates in place, so hand React a fresh reference.
    set({ user: auth().currentUser });
  },

  async refreshClaims() {
    const user = auth().currentUser;
    if (!user || user.isAnonymous) return;
    const token = await user.getIdTokenResult(true);
    let status: AuthStore['instructorStatus'] = null;
    try {
      const snap = await getDoc(doc(db(), 'users', user.uid));
      if (snap.exists()) {
        status = (snap.data().status as AuthStore['instructorStatus']) ?? null;
      } else {
        // The account exists in Auth but has no approval request. That happens
        // when registration created the account and then the profile write
        // failed — retrying registration would only ever return
        // email-already-in-use, leaving the account permanently invisible to
        // the admin. Re-create it here so signing in is enough to recover.
        // No affiliation is recoverable here — it only ever existed in the
        // registration form. The admin screen flags it so it can be asked for.
        await writeInstructorProfile(user, user.displayName ?? '', '');
        status = 'pending';
      }
    } catch {
      // Non-fatal: the claims below are what gate the UI, and the pending
      // screen still offers a retry.
    }
    set({
      isAdmin: token.claims.admin === true,
      isInstructor: token.claims.instructor === true,
      instructorStatus: status,
    });
  },

  async register(email, password, displayName, affiliation) {
    set({ error: null });

    let user: User;
    try {
      const cred = await createUserWithEmailAndPassword(
        auth(),
        email.trim(),
        password,
      );
      user = cred.user;
    } catch (e) {
      set({ error: authErrorMessage(e, 'Registration failed.') });
      return false;
    }

    // Past this point the Auth account EXISTS. A failure here must not read as
    // "registration failed" — the user would retry, hit email-already-in-use,
    // and never get anywhere. Say what is actually left to do instead.
    try {
      // Keep the name on the Auth record too, so refreshClaims can rebuild the
      // approval request from it if the Firestore write below is ever lost.
      if (displayName.trim()) {
        await updateProfile(user, { displayName: displayName.trim() });
      }
      await writeInstructorProfile(user, displayName, affiliation);
    } catch (e) {
      set({
        error:
          'Your account was created, but the approval request could not be ' +
          `saved: ${authErrorMessage(e, 'write failed')} ` +
          'Sign in again and it will be retried automatically.',
      });
      return false;
    }

    try {
      await sendEmailVerification(user);
    } catch (e) {
      // The account and the approval request are both in place; a throttled
      // verification mail is recoverable from the next screen's resend button.
      set({
        error:
          'Account created, but the verification email could not be sent: ' +
          `${authErrorMessage(e, 'send failed')} Use "Resend" below.`,
      });
    }
    return true;
  },

  async login(email, password) {
    set({ error: null });
    try {
      await signInWithEmailAndPassword(auth(), email.trim(), password);
      await get().refreshClaims();
      return true;
    } catch (e) {
      set({ error: authErrorMessage(e, 'Sign-in failed.') });
      return false;
    }
  },

  async logout() {
    await signOut(auth());
  },
}));
