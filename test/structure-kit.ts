// What the structure test reads the code with: the files, by part, and the ratchet each rule keeps.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

export const ROOT = join(import.meta.dirname, '..');
const CODE = /\.(ts|js|mjs|css|html)$/;
/** Vendored as a file at the owner's asking (CLAUDE.md), not written here. */
export const VENDORED = ['ui/three.module.min.js'];

/** Every file under a folder, as it is on disk. */
export const rawWalk = (dir: string): string[] =>
  !existsSync(join(ROOT, dir))
    ? []
    : readdirSync(join(ROOT, dir)).flatMap((name) => {
        const path = `${dir}/${name}`;
        return statSync(join(ROOT, path)).isDirectory() ? rawWalk(path) : [path];
      });
/** A file's text as it is on disk. */
export const raw = (path: string) => readFileSync(join(ROOT, path), 'utf8');

// Every module is read at its own place (docs/kernel-packs.md, "Where each module goes"). The kernel is src/ (the boot
// stub, plumbing and the entries run by path) and the root packs' kernel/; a service pack's code is a pack's, under
// rule 4. The lists keyed by a path name the module where it lives.

/** Every file under a folder. */
export const walk = rawWalk;
/** A file's text. */
export const read = raw;
/** The pack a path is in, if it is under packs/. */
export const packOfPath = (path: string) => /^packs\/([\w-]+)\//.exec(path)?.[1];
/** A relative import's target, as a path from the repository's root. */
export const target = (from: string, spec: string) => posix.normalize(posix.join(posix.dirname(from), spec));
export const lines = (text: string) => text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
export const packIds = readdirSync(join(ROOT, 'packs')).filter((p) => statSync(join(ROOT, 'packs', p)).isDirectory());
const manifest = (p: string) => (existsSync(join(ROOT, 'packs', p, 'pack.json')) ? JSON.parse(raw(`packs/${p}/pack.json`)) : {}) as { kernel?: { trust?: string } };
/** The packs whose manifest says they are root: their code is the kernel's, under every rule the kernel keeps. */
export const rootPacks = packIds.filter((p) => manifest(p).kernel?.trust === 'root');
/** A root pack's code: every module under its kernel/ but its tests. */
export const rootCode = rootPacks.flatMap((p) => walk(`packs/${p}/kernel`)).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
/** The kernel's TypeScript: src/, and the root packs' code. */
export const srcCode = [...walk('src').filter((f) => f.endsWith('.ts')), ...rootCode];
export const codeFiles = ['src', 'ui', 'test', 'packs', 'scripts', 'examples'].flatMap(walk).filter((f) => CODE.test(f) && !VENDORED.includes(f));
const VALUE_IMPORT = /(?:^|;)[ \t]*(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+['"`]([^'"`]+)['"`]|\bimport\s*\(\s*['"`]([^'"`]+)['"`]/gm;
/** How many value imports of a file name a pack that is not a root (a service pack's code, or a plain pack's). */
export const serviceImports = (f: string) => [...read(f).matchAll(VALUE_IMPORT)].filter((m) => {
  const spec = m[1] ?? m[2], pack = spec.startsWith('.') ? packOfPath(target(f, spec)) : undefined;
  return pack !== undefined && !rootPacks.includes(pack);
}).length;
export const kernelFiles = [...walk('src'), ...walk('ui'), ...rootCode].filter((f) => /\.(ts|js)$/.test(f) && !VENDORED.includes(f));
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
