// What the structure test reads the code with: the files, by part, and the ratchet each rule keeps.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = join(import.meta.dirname, '..');
const CODE = /\.(ts|js|mjs|css|html)$/;
/** Vendored as a file at the owner's asking (CLAUDE.md), not written here. */
export const VENDORED = ['ui/three.module.min.js'];

export const walk = (dir: string): string[] =>
  !existsSync(join(ROOT, dir))
    ? []
    : readdirSync(join(ROOT, dir)).flatMap((name) => {
        const path = `${dir}/${name}`;
        return statSync(join(ROOT, path)).isDirectory() ? walk(path) : [path];
      });
export const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
export const lines = (text: string) => text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
export const codeFiles = ['src', 'ui', 'test', 'packs', 'scripts', 'examples'].flatMap(walk).filter((f) => CODE.test(f) && !VENDORED.includes(f));
export const kernelFiles = [...walk('src'), ...walk('ui')].filter((f) => /\.(ts|js)$/.test(f) && !VENDORED.includes(f));
export const packIds = readdirSync(join(ROOT, 'packs')).filter((p) => statSync(join(ROOT, 'packs', p)).isDirectory());
/** The packs gone to hosted (9 Nov 2026), with their type and link names. */
export const LEFT = JSON.parse(read('test/fixtures/left-packs.json')) as Record<string, string[]>;
/** The kernel's own packs: the kinds, the root relations and the system tier. */
export const KERNEL_PACKS = ['core', 'local'];

/**
 * Compare what is counted with what is allowed: anything not listed may have up to `limit`; a listed
 * entry may not grow, and must be lowered (or removed, once within the limit) when it shrinks.
 */
export function ratchet(counted: Record<string, number>, frozen: Record<string, number>, limit = 0): string[] {
  const problems: string[] = [];
  for (const [what, n] of Object.entries(counted)) {
    const cap = frozen[what] ?? limit;
    if (n > cap) problems.push(`${what}: ${n}, over ${cap}`);
  }
  for (const [what, cap] of Object.entries(frozen)) {
    const n = counted[what] ?? 0;
    if (n < cap) problems.push(n <= limit ? `${what}: ${n} now, within ${limit}: remove its entry` : `${what}: ${n} now: lower its entry from ${cap} to ${n}`);
  }
  return problems;
}

export const count = (files: string[], pattern: RegExp) =>
  Object.fromEntries(files.map((f) => [f, read(f).match(pattern)?.length ?? 0]).filter(([, n]) => (n as number) > 0));

/** A baseline whose every entry names the step on the map that removes it: [count, step]. */
export type Owed = Record<string, [number, string]>;
export const counts = (owed: Owed) => Object.fromEntries(Object.entries(owed).map(([f, [n]]) => [f, n]));
