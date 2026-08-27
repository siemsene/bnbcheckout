// Instructor/admin auth state (email+password accounts, custom claims).

import { create } from 'zustand';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  signInWithEmailAndPassword,
  signOut,
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
  register(email: string, password: string, displayName: string): Promise<boolean>;
  login(email: string, password: string): Promise<boolean>;
  logout(): Promise<void>;
  refreshClaims(): Promise<void>;
  /** Send the verification email again (it lands in spam more often than not). */
  resendVerification(): Promise<boolean>;
  /** Re-read emailVerified from the server after the link is clicked. */
  reloadUser(): Promise<void>;
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
      if (snap.exists()) status = (snap.data().status as AuthStore['instructorStatus']) ?? null;
    } catch {
      // ignore — doc may not exist yet
    }
    set({
      isAdmin: token.claims.admin === true,
      isInstructor: token.claims.instructor === true,
      instructorStatus: status,
    });
  },

  async register(email, password, displayName) {
    set({ error: null });
    try {
      const cred = await createUserWithEmailAndPassword(auth(), email, password);
      await setDoc(doc(db(), 'users', cred.user.uid), {
        email,
        displayName,
        status: 'pending',
        createdAt: serverTimestamp(),
      });
      await sendEmailVerification(cred.user);
      return true;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : 'Registration failed' });
      return false;
    }
  },

  async login(email, password) {
    set({ error: null });
    try {
      await signInWithEmailAndPassword(auth(), email, password);
      await get().refreshClaims();
      return true;
    } catch {
      set({ error: 'Wrong email or password.' });
      return false;
    }
  },

  async logout() {
    await signOut(auth());
  },
}));
