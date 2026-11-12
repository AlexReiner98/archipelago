// What the structure test reads the code with: the files, by part, and the ratchet each rule keeps.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

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

// Kernel packs in the wave (docs/kernel-packs.md, "Moving in the wave (as built)"). A module moved into a pack leaves
// a shim at its old path, a file whose only code is `export * from '../packs/<p>/kernel/<m>.ts';`, found here by that
// shape alone. Until the gather step every rule reads the moved code at its old path (the shim's), with its imports
// written as if it were still there, so no list keyed by a path changes when a module moves.
const SHIM = /^export \* from '\.\.\/(packs\/[\w-]+\/kernel\/[\w./-]+\.ts)';$/;
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').trim();
/** Each shim's old path, with the moved file it stands for. */
export const SHIMS = new Map(rawWalk('src').flatMap((f) => { const to = f.endsWith('.ts') ? SHIM.exec(code(raw(f)))?.[1] : undefined; return to ? [[f, to] as const] : []; }));
/**
 * A service pack's adapter shim (docs/kernel-packs.md, "Moving a service in the wave (as built)"): at the old path, it
 * re-exports its moved module and adapts what took the map, building the pack's context when called. Its only value
 * imports are of `../packs/<p>/kernel/<its own name>.ts`, every other static import is `import type`, and its one
 * dynamic import is `./kernel-context.ts`. The kernel may import that pack there, and nowhere else.
 */
const adapts = (f: string, text: string) => {
  const own = basename(f), targets = [...text.matchAll(/^(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+'([^']+)'/gm)].map((m) => m[1]);
  const dynamic = [...text.matchAll(/\bimport\s*\(\s*'([^']+)'/g)].map((m) => m[1]);
  const ofOwn = (t: string) => /^\.\.\/packs\/[\w-]+\/kernel\/[^/]+$/.test(t) && basename(t) === own;
  return targets.length > 0 && targets.every(ofOwn) && dynamic.every((t) => t === './kernel-context.ts');
};
export const ADAPTERS = new Set(rawWalk('src').filter((f) => f.endsWith('.ts') && !SHIMS.has(f) && adapts(f, code(raw(f)))));
/** Each moved file, with the old path it is read at. */
export const MOVED = new Map([...SHIMS].map(([from, to]) => [to, from]));
/** A moved module's imports as they read from its old path: of src/ and of any pack's kernel/, each `./<m>`. */
const reroot = (text: string) => text.replace(/(['"`])\.\.\/\.\.\/\.\.\/src\//g, '$1./').replace(/(['"`])\.\.\/\.\.\/[\w-]+\/kernel\//g, '$1./');

/** Every file under a folder, a moved module at its old path only. */
export const walk = (dir: string): string[] => rawWalk(dir).filter((f) => !MOVED.has(f));
/** A file's text; at a shim, the moved module's, read as from there. */
export const read = (path: string) => (SHIMS.has(path) ? reroot(raw(SHIMS.get(path)!)) : raw(path));
export const lines = (text: string) => text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
export const packIds = readdirSync(join(ROOT, 'packs')).filter((p) => statSync(join(ROOT, 'packs', p)).isDirectory());
const manifest = (p: string) => (existsSync(join(ROOT, 'packs', p, 'pack.json')) ? JSON.parse(raw(`packs/${p}/pack.json`)) : {}) as { kernel?: { trust?: string } };
/** The packs whose manifest says they are root: their code is the kernel's, under every rule the kernel keeps. */
export const rootPacks = packIds.filter((p) => manifest(p).kernel?.trust === 'root');
/** A root pack's code that was never in src/ (its index.ts, a module written there): moved modules are read at their shims. */
export const rootCode = rootPacks.flatMap((p) => walk(`packs/${p}/kernel`)).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
/** The kernel's TypeScript: src/, and the root packs' code. */
export const srcCode = [...walk('src').filter((f) => f.endsWith('.ts')), ...rootCode];
export const codeFiles = ['src', 'ui', 'test', 'packs', 'scripts', 'examples'].flatMap(walk).filter((f) => CODE.test(f) && !VENDORED.includes(f));
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
