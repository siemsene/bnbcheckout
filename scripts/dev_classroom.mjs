/**
 * One command to test a class with yourself: instructor in one browser tab,
 * students in others.
 *
 *   npm run classroom
 *
 * Starts the auth/firestore/functions emulators and the Vite dev server, seeds
 * an approved instructor and a session, then prints the URLs and credentials.
 * Ctrl+C stops everything it started.
 *
 * Why a plain `npm run dev` is not enough: Firebase persists the signed-in user
 * in IndexedDB, which every tab of an origin shares. Signing in as the
 * instructor would replace a student's anonymous session — and because
 * `ensureAnonAuth` reuses `currentUser`, a student tab opened behind a
 * signed-in instructor joins the room AS the instructor. So
 * `.env.development.local` sets VITE_TAB_SCOPED_AUTH=1, which switches dev
 * builds to per-tab (session) persistence and gives each tab its own identity.
 *
 * Emulator-only by construction: a `demo-` project id never contacts Google.
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';

const stripAnsi = (str) => str.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const format = arg('format', 'two-run');
const students = arg('students', '0');

const isWin = process.platform === 'win32';
const children = [];
let shuttingDown = false;

/**
 * `spec` is either a plain argv array (spawned directly) or {shell: 'cmd ...'}
 * for something that needs a shell — firebase-tools is not a local dependency,
 * so it has to go through npx. The shell form passes ONE string rather than a
 * command plus args, which is what Node's DEP0190 deprecation asks for.
 */
function run(label, spec) {
  const opts = {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FUNCTIONS_DISCOVERY_TIMEOUT: '90' },
  };
  const child = Array.isArray(spec)
    ? spawn(spec[0], spec.slice(1), opts)
    : spawn(spec.shell, { ...opts, shell: true });
  children.push(child);
  child.on('exit', (code) => {
    if (!shuttingDown && code !== 0) {
      console.error(`\n[${label}] exited with code ${code}. Shutting down.`);
      shutdown(1);
    }
  });
  return child;
}

/** Resolve once `pattern` appears on the child's output, or reject on timeout. */
function waitFor(child, label, pattern, ms) {
  return new Promise((resolve, reject) => {
    let seen = '';
    const timer = setTimeout(() => {
      cleanup();
      reject(
        new Error(
          `${label} did not report ready within ${ms / 1000}s.\n` +
            `Last output:\n${seen.slice(-900)}`,
        ),
      );
    }, ms);
    const onData = (chunk) => {
      // Strip ANSI first: Vite colours the URL, so the raw bytes read
      // "Local:<esc>[36mhttp://localhost:<esc>[1m5173" and a pattern anchored
      // on "Local:" followed by whitespace then "http" never matches.
      seen += stripAnsi(chunk.toString());
      if (pattern.test(seen)) {
        cleanup();
        resolve(seen);
      }
    };
    function cleanup() {
      clearTimeout(timer);
      child.stdout.off('data', onData);
      child.stderr.off('data', onData);
    }
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
  });
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (child.exitCode !== null || child.signalCode) continue;
    // child.kill() leaves the real emulator/vite processes alive on Windows,
    // which then hold their ports and break the next run.
    if (isWin && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        shell: true,
      });
    } else {
      child.kill('SIGTERM');
    }
  }
  setTimeout(() => process.exit(code), 800);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

const RULE = '-'.repeat(66);

/** Ports this script needs: emulators (+ their hub/logging) and Vite. */
const PORTS = [9099, 8080, 5001, 4400, 4500, 9150, 5173];

function portFree(port) {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    srv.listen(port, '127.0.0.1');
  });
}

/**
 * Fail fast on ports that are already held.
 *
 * Worth the check because the common cause is this script's own previous run:
 * if the orchestrator is killed hard rather than interrupted, the emulator and
 * Vite children outlive it and keep every port. Without this the run would sit
 * through the emulator's four-minute start timeout before saying anything
 * useful.
 */
async function preflight() {
  const taken = [];
  for (const p of PORTS) if (!(await portFree(p))) taken.push(p);
  if (taken.length === 0) return;

  console.error(`\nPorts already in use: ${taken.join(', ')}`);
  console.error('Most likely a previous `npm run classroom` did not shut down cleanly.');
  console.error('\nClear them with:');
  if (isWin) {
    console.error(
      "  powershell -Command \"Get-CimInstance Win32_Process -Filter \\\"Name='node.exe' or Name='java.exe'\\\" |\n" +
        '    Where-Object { $_.CommandLine -like \'*firebase*\' -or $_.CommandLine -like \'*vite*\' } |\n' +
        '    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"',
    );
  } else {
    console.error(`  lsof -ti :${taken.join(' -ti :')} | xargs kill -9`);
  }
  console.error('');
  process.exit(1);
}

async function main() {
  await preflight();
  process.stdout.write('Starting emulators (first run downloads them)...');
  const emu = run('emulators', {
    shell:
      'npx firebase-tools emulators:start ' +
      '--only auth,firestore,functions --project demo-checkout',
  });
  await waitFor(emu, 'emulators', /All emulators ready/, 240_000);

  process.stdout.write(' ready.\nStarting dev server...');
  // Vite is a local dependency, so it can be spawned directly — no shell.
  const vite = run('vite', [process.execPath, 'node_modules/vite/bin/vite.js']);
  const viteOut = await waitFor(vite, 'vite', /Local:\s+http:\/\/\S+/, 60_000);
  const appUrl = (
    viteOut.match(/Local:\s+(http:\/\/[^\s]+)/)?.[1] ?? 'http://localhost:5173/'
  ).replace(/\/$/, '');

  process.stdout.write(' ready.\nSeeding a session...');
  const seed = spawn(
    process.execPath,
    ['scripts/seed_local_session.mjs', '--format', format, '--students', students],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let seedOut = '';
  seed.stdout.on('data', (c) => (seedOut += c));
  seed.stderr.on('data', (c) => (seedOut += c));
  const [seedCode] = await once(seed, 'exit');
  if (seedCode !== 0) throw new Error(`seed failed:\n${seedOut}`);
  const info = JSON.parse(seedOut.slice(seedOut.indexOf('{')));

  console.log(' done.\n');
  console.log(RULE);
  console.log('  Checkout Rush - local classroom');
  console.log(RULE);
  console.log(`  INSTRUCTOR   ${appUrl}/instructor`);
  console.log(`               sign in: ${info.instructor.email} / ${info.instructor.password}`);
  console.log('');
  console.log(`  STUDENT      ${appUrl}/join     <- open in a NEW TAB`);
  console.log(`               join code: ${info.code}`);
  console.log('');
  console.log('  Each tab keeps its own login, so opening the student tab does');
  console.log('  not sign the instructor out. Open as many student tabs as you');
  console.log('  like - each one is a separate player.');
  console.log('');
  console.log(`  Session id   ${info.sessionId}  (${info.format})`);
  console.log(`  Skip ahead   node scripts/dev_stage.mjs ${info.sessionId} running`);
  console.log('               stages: planning running review1 plan2 running2');
  console.log(RULE);
  console.log('  Ctrl+C stops the emulators and the dev server.\n');
}

main().catch((e) => {
  console.error(`\n${e.message}`);
  shutdown(1);
});
