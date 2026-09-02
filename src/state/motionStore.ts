// Whether the app animates. The OS reduced-motion request is the default, but
// it is a coarse machine-wide switch (on Windows it is Accessibility →
// "Animation effects", often off for reasons unrelated to motion sensitivity),
// so the player can explicitly opt back in — or out — from the HUD. An
// explicit choice is remembered and wins over the OS from then on.

import { create } from 'zustand';

const STORAGE_KEY = 'motion-override';

const systemReduced = () =>
  typeof window !== 'undefined' &&
  !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function storedOverride(): 'full' | 'reduced' | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === 'full' || v === 'reduced' ? v : null;
  } catch {
    return null; // storage blocked — just follow the OS
  }
}

interface MotionStore {
  /** Effective preference — the stylesheets and scene code key off this. */
  reduced: boolean;
  /** True once the player has chosen for themselves. */
  overridden: boolean;
  setReduced(reduced: boolean): void;
}

export const useMotionStore = create<MotionStore>((set) => ({
  reduced: (storedOverride() ?? (systemReduced() ? 'reduced' : 'full')) === 'reduced',
  overridden: storedOverride() !== null,
  setReduced(reduced) {
    try {
      localStorage.setItem(STORAGE_KEY, reduced ? 'reduced' : 'full');
    } catch {
      // not persistable; the choice still holds for this session
    }
    set({ reduced, overridden: true });
  },
}));

// Stylesheets can't read the store, so mirror the choice onto the root
// element; every former prefers-reduced-motion block now keys off this.
if (typeof document !== 'undefined') {
  const apply = () => {
    document.documentElement.dataset.motion = useMotionStore.getState().reduced
      ? 'reduced'
      : 'full';
  };
  apply();
  useMotionStore.subscribe(apply);
  // Follow live OS changes until the player overrides.
  window
    .matchMedia?.('(prefers-reduced-motion: reduce)')
    ?.addEventListener?.('change', (e) => {
      if (!useMotionStore.getState().overridden) {
        useMotionStore.setState({ reduced: e.matches });
      }
    });
}
