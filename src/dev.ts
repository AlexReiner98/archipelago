// Dev mode, for working on Lattice itself: `npm run dev`.
//
// Runs the server with LATTICE_DEV=1 and keeps it running. When the server
// exits asking for a restart (the `restart` tool), it is started again on the
// code now on disk. When it dies any other way, it is started again as soon as
// a file under src/ or packs/ changes, so a session that broke the server can
// repair it without anyone at the terminal. Everything the server prints is
// also kept in runs/dev-server.log, where an agent can read why it fell over.

import { spawn } from 'node:child_process';
import { appendFileSync, mkdirSync, watch } from 'node:fs';
import { join } from 'node:path';
import { RESTART_EXIT } from './config.ts';

const ROOT = join(import.meta.dirname, '..');
const LOG = join(ROOT, 'runs', 'dev-server.log');
mkdirSync(join(ROOT, 'runs'), { recursive: true });

const say = (text: string | Buffer) => {
  process.stdout.write(text);
  appendFileSync(LOG, text);
};
const note = (text: string) => say(`[dev ${new Date().toISOString()}] ${text}\n`);

let stopping = false;
let waiting: (() => void) | undefined;

function start(): void {
  note('starting the server');
  const child = spawn(process.execPath, [join(ROOT, 'src', 'server.ts')], { cwd: ROOT, env: { ...process.env, LATTICE_DEV: '1' }, stdio: ['inherit', 'pipe', 'pipe'] });
  child.stdout.on('data', say);
  child.stderr.on('data', say);
  child.on('exit', (code) => {
    if (stopping) return process.exit(0);
    if (code === RESTART_EXIT) return start();
    note(`the server stopped (exit ${code}); it starts again when a file under src/ or packs/ changes`);
    waiting = start;
  });
}

for (const dir of ['src', 'packs']) {
  let timer: NodeJS.Timeout | undefined;
  watch(join(ROOT, dir), { recursive: true }, () => {
    if (!waiting) return;
    // Editors write a file in several steps; wait for them to finish.
    clearTimeout(timer);
    timer = setTimeout(() => {
      const again = waiting;
      waiting = undefined;
      again?.();
    }, 500);
  });
}

// Ctrl+C reaches the server too; let it close its databases, then leave.
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    if (waiting) process.exit(0);
    stopping = true;
  });

start();
