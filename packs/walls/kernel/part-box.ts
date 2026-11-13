// Where the server runs a part's code to keep its marks with a published page (decision e_rhz4dvpk: a page read with no
// login draws marks frozen when it was published, and no part's code goes to its reader). Never in the server's own
// process: in one of the part's own, as a drawing's first frame is made (./drawing-box.ts), under node --permission,
// with an empty environment, read access to the part's folder and its runner only (./part-runner.ts), no network, and
// limits on memory and time. One process a run, stopped when it answers or overruns.

import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';

const RUNNER = join(import.meta.dirname, 'part-runner.ts');
/** How long a part may take to answer, and the memory its process may have. */
export const PART_MS = 10_000;
const MEMORY_MB = 256;
/** The most of its answer read: more than a page's marks may be. */
const MOST = 16 * 1024 * 1024;

/** What a part answered: its marks, its page's title, and the marks of each item it opens beside the page. Not yet checked. */
export type PartDrawn = { marks: unknown; title?: string; sheets?: unknown };

/** The most marks a page keeps, and how deep they may go: what the page's own check allows (packs/walls/page/part-check.js). */
const MARKS_MOST = 5000;
const DEPTH_MOST = 32;
const KIND = /^[a-z]+$/;

/**
 * Marks kept with a page, held to their shape: a tree of `[kind, attributes?, ...]` of the kinds the part names, no
 * more of them or deeper than a page draws, or a refusal saying what is wrong. The page checks every mark whole before
 * it draws one (packs/walls/page/part-check.js, which it alone reads), so what is kept here is never trusted there.
 */
export function checkedMarks(marks: unknown, kinds: string[]): unknown {
  let n = 0;
  const walk = (m: unknown, depth: number): void => {
    if (!Array.isArray(m) || typeof m[0] !== 'string' || !KIND.test(m[0])) throw new Error('The part sent what cannot be drawn: a mark that is not [kind, attributes, ...]');
    if (!kinds.includes(m[0])) throw new Error(`The part sent what cannot be drawn: the mark "${m[0].slice(0, 40)}", which the part does not name in its marks`);
    if (++n > MARKS_MOST || depth > DEPTH_MOST) throw new Error(`The part sent what cannot be drawn: more than ${MARKS_MOST} marks, or deeper than ${DEPTH_MOST}`);
    for (const kid of m.slice(1)) if (Array.isArray(kid)) walk(kid, depth + 1);
  };
  walk(marks, 0);
  return marks;
}

/** Run the part entered at `entry` once on `input`, in its own sandboxed process. Throws what it threw. */
export function runPartOnce(entry: string, input: unknown, ms = PART_MS): Promise<PartDrawn> {
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
    const timer = setTimeout(() => finish(() => reject(new Error(`The part took longer than ${ms} ms and was stopped.`))), ms);
    child.stdout!.setEncoding('utf8');
    child.stdout!.on('data', (chunk: string) => {
      text += chunk;
      if (text.length > MOST) return finish(() => reject(new Error('The part answered with more than a page may hold.')));
      const end = text.indexOf('\n');
      if (end < 0) return;
      let line: { drawn?: PartDrawn; error?: string };
      try {
        line = JSON.parse(text.slice(0, end));
      } catch {
        return finish(() => reject(new Error('The part answered with what is not JSON.')));
      }
      finish(() => (line.error !== undefined || !line.drawn ? reject(new Error(String(line.error ?? 'The part answered nothing.'))) : resolve(line.drawn)));
    });
    child.stderr!.on('data', (chunk) => (stderr = (stderr + chunk).slice(-2000)));
    child.on('error', (err) => finish(() => reject(err)));
    child.on('close', () => finish(() => reject(new Error(`The part's process ended${stderr ? `: ${stderr.trim().split('\n').at(-1)}` : ''}`))));
    child.stdin!.on('error', () => undefined);
    child.stdin!.end(JSON.stringify({ entry, input }) + '\n');
  });
}
