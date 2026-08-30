/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Refuse to produce a production bundle that carries emulator/demo config.
 *
 * This is not hypothetical: a `.env.local` holding `VITE_USE_EMULATORS=1` and
 * the `demo-checkout` project was picked up by `vite build` (Vite reads
 * `.env.local` in every mode), so the deployed site had
 * `connectAuthEmulator(..., 'http://127.0.0.1:9099')` constant-folded in as an
 * unconditional call. Every visitor's browser tried to reach its own
 * localhost, and sign-in and registration failed for everyone. The emulator
 * env now lives in `.env.development.local`; this guard is the backstop.
 */
function assertDeployableEnv(env: Record<string, string>): void {
  const problems: string[] = [];
  if (env.VITE_USE_EMULATORS === '1') {
    problems.push('VITE_USE_EMULATORS=1 (emulator wiring would be compiled in)');
  }
  if ((env.VITE_FIREBASE_PROJECT_ID ?? '').startsWith('demo-')) {
    problems.push(`VITE_FIREBASE_PROJECT_ID=${env.VITE_FIREBASE_PROJECT_ID}`);
  }
  if (env.VITE_FIREBASE_API_KEY === 'fake-api-key') {
    problems.push('VITE_FIREBASE_API_KEY=fake-api-key');
  }
  if (!env.VITE_FIREBASE_API_KEY || !env.VITE_FIREBASE_PROJECT_ID) {
    // Not fatal: a deployment with no backend still runs practice mode, and
    // the landing page says so. Warn rather than block.
    console.warn(
      '\n[build] VITE_FIREBASE_* is incomplete — building in local-only mode ' +
        '(practice runs work, class sessions do not).\n',
    );
  }
  if (problems.length > 0) {
    throw new Error(
      '\n\n[build] Refusing to build: emulator/demo settings are in scope.\n' +
        problems.map((p) => `  - ${p}`).join('\n') +
        '\n\nThese belong in .env.development.local (dev only), not .env or ' +
        '.env.local.\nThe real project config goes in .env — see .env.example.\n',
    );
  }
}

export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    assertDeployableEnv(loadEnv(mode, process.cwd(), 'VITE_'));
  }
  return {
    plugins: [react()],
    test: {
      include: ['src/**/__tests__/**/*.test.ts'],
      environment: 'node',
    },
  };
});
