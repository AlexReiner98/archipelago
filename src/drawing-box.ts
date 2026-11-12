// Where the server runs a drawing's code to have its first frame (src/published-frames.ts, src/public-bake.ts): never
// in its own process, but in one of the drawing's own, as the pack host runs a pack's handler (src/packhost.ts): under
// node --permission, with an empty environment, read access to the drawing's folder and its runner only, no network
// (src/drawing-runner.ts), and limits on memory and time. One process a frame, stopped when it answers or overruns.

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { OTHER, WIDTHS } from './text-widths.ts';

const RUNNER = join(import.meta.dirname, 'drawing-runner.ts');
/** How long a first frame may take, and the memory its process may have. */
export const FRAME_MS = 15_000;
const MEMORY_MB = 256;
/** The most of its answer read: a scene larger than this is not kept. */
const MOST = 16 * 1024 * 1024;

/** Run the drawing at `entry` once on `input`, in its own sandboxed process; its scene, or null. Throws what it threw. */
export function drawOnce(entry: string, input: unknown, ms = FRAME_MS): Promise<Record<string, unknown> | null> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ['--permission', `--allow-fs-read=${dirname(entry)}`, `--allow-fs-read=${RUNNER}`, `--max-old-space-size=${MEMORY_MB}`, '--disallow-code-generation-from-strings', RUNNER],
      { env: {}, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
    );
    let text = '';
    let stderr = '';
    let done = false;
    const finish = (fn: () => void) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      child.kill();
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error(`The drawing took longer than ${ms} ms and was stopped.`))), ms);
    // Read as text whole: a character split between two chunks is not two broken ones.
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      text += chunk;
      if (text.length > MOST) return finish(() => reject(new Error('The drawing answered with more than a scene may be.')));
      const end = text.indexOf('\n');
      if (end < 0) return;
      let line: { scene?: Record<string, unknown> | null; error?: string };
      try {
        line = JSON.parse(text.slice(0, end));
      } catch {
        return finish(() => reject(new Error('The drawing answered with what is not JSON.')));
      }
      finish(() => (line.error !== undefined ? reject(new Error(String(line.error))) : resolve(line.scene ?? null)));
    });
    child.stderr!.on('data', (chunk) => (stderr = (stderr + chunk).slice(-2000)));
    child.on('error', (err) => finish(() => reject(err)));
    child.on('close', () => finish(() => reject(new Error(`The drawing's process ended${stderr ? `: ${stderr.trim().split('\n').at(-1)}` : ''}`))));
    child.stdin!.on('error', () => undefined);
    child.stdin!.end(JSON.stringify({ entry, input, widths: WIDTHS, other: OTHER }) + '\n');
  });
}
