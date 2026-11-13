// What the structure test reads the code with: the files, by part, and the ratchet each rule keeps.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { kernelCodeOf, packOf, resolve, resolveServed, rootCodeOf, rootPacksOf, servedNames, valueImports, walkFiles } from '../packs/anatomy_sync/reader.ts';

export const ROOT = join(import.meta.dirname, '..');
const CODE = /\.(ts|js|mjs|css|html)$/;
/** Vendored as a file at the owner's asking (CLAUDE.md), not written here. */
export const VENDORED = ['packs/walls/page/three.module.min.js'];

/** Every file under a folder, as it is on disk. */
export const rawWalk = (dir: string): string[] => walkFiles(ROOT, dir);
/** A file's text as it is on disk. */
export const raw = (path: string) => readFileSync(join(ROOT, path), 'utf8');

// Every module is read at its own place (docs/kernel-packs.md, "Where each module goes"). The kernel is src/ (the boot
// stub, plumbing and the entries run by path) and the root packs' kernel/; a service pack's code is a pack's, under
// rule 4. The lists keyed by a path name the module where it lives.

/** Every file under a folder. */
export const walk = rawWalk;
/** A file's text. */
export const read = raw;
// How a file's pack, imports and their targets are read is the anatomy sync's reader (packs/anatomy_sync/reader.ts),
// so the structure rules and the map of the code read code alike.
/** The pack a path is in, if it is under packs/. */
export const packOfPath = packOf;
/** A relative import's target, as a path from the repository's root. */
export const target = resolve;
export const lines = (text: string) => text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
export const packIds = readdirSync(join(ROOT, 'packs')).filter((p) => statSync(join(ROOT, 'packs', p)).isDirectory());
const manifest = (p: string) => (existsSync(join(ROOT, 'packs', p, 'pack.json')) ? JSON.parse(raw(`packs/${p}/pack.json`)) : {}) as { kernel?: { trust?: string } };
/** The packs whose manifest says they are root: their code is the kernel's, under every rule the kernel keeps. */
export const rootPacks = rootPacksOf(Object.fromEntries(packIds.map((p) => [p, manifest(p)])));
/** A root pack's code: every module under its kernel/ but its tests. */
export const rootCode = rootCodeOf(rootPacks.flatMap((p) => walk(`packs/${p}/kernel`)), rootPacks);
/** The kernel's TypeScript: src/, and the root packs' code. */
export const srcCode = kernelCodeOf([...walk('src'), ...rootCode], rootPacks);
export const codeFiles = ['src', 'test', 'packs', 'scripts', 'examples'].flatMap(walk).filter((f) => CODE.test(f) && !VENDORED.includes(f));
/** How many value imports of a file (static, re-exported or dynamic) name a pack that is not a root (a service pack's code, or a plain pack's). */
export const serviceImports = (f: string) => valueImports(read(f), f).filter(({ kind, to }) => {
  const pack = kind !== 'bare' && kind !== 'require' && to ? packOfPath(to) : undefined;
  return pack !== undefined && !rootPacks.includes(pack);
}).length;
/** The order the roots start in (packs/roots.json): a root's page imports only from its own and those before it. */
export const rootOrder = (JSON.parse(raw('packs/roots.json')) as { roots: { id: string }[] }).roots.map((r) => r.id);
/** The files the page is served: the app's, in ui/, and the host's, in each root pack's page/. */
export const uiFiles = [...rootOrder.flatMap((p) => walk(`packs/${p}/page`))];
/** A served file by the name the page asks for it by. */
export const served = servedNames(uiFiles);
/** A page module's value imports of other served files, as paths: by served name, as the browser loads them. */
export const pageImports = (f: string) => valueImports(read(f)).filter((i) => i.kind !== 'bare' && i.kind !== 'require' && i.spec.startsWith('./')).map((i) => resolveServed(f, i.spec, served));
export const kernelFiles = [...walk('src'), ...uiFiles, ...rootCode].filter((f) => /\.(ts|js)$/.test(f) && !VENDORED.includes(f));
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

/** How many times each file says `pattern`, read by `text` (history, for a rule that counts nothing in a released step). */
export const count = (files: string[], pattern: RegExp, text: (f: string) => string = read) =>
  Object.fromEntries(files.map((f) => [f, text(f).match(pattern)?.length ?? 0]).filter(([, n]) => (n as number) > 0));

/** A baseline whose every entry names the step on the map that removes it: [count, step]. */
export type Owed = Record<string, [number, string]>;
export const counts = (owed: Owed) => Object.fromEntries(Object.entries(owed).map(([f, [n]]) => [f, n]));
