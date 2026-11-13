// How the code is read: each file's imports, its pack and its header comment, as plain data. The structure test checks
// the architecture with it and the anatomy sync maps it with it, so the check and the map read code alike. Text and
// paths in, data out; the one walk of a folder (walkFiles) is the only read of the disk.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';

/** How a module names another: `import … from`, `export … from`, `import(…)`, a bare `import '…'`, or `require(…)`. */
export type ImportKind = 'import' | 'export' | 'dynamic' | 'bare' | 'require';

/** One import of a file: what it says, how, whether it is erased (`import type`), and where it lands if relative. */
export type Import = { spec: string; kind: ImportKind; typeOnly: boolean; to?: string; at: number };

/** A module as the map and the structure test read it. */
export type Module = { path: string; pack?: string; header: string; imports: Import[] };

// Statements start a line or follow a `;` (several imports may share one line). `import type` / `export type` are
// erased at run time; `import { type A, B }` is not, and counts as a value import.
const STATIC = /(?:^|;)[ \t]*(import|export)\s+(?:(type)\b)?[^;]*?\bfrom\s+(['"`])([^'"`]+)\3/gm;
const DYNAMIC = /\bimport\s*\(\s*(['"`])([^'"`]+)\1/g;
const BARE = /(?:^|;)[ \t]*import\s+(['"])([^'"]+)\1/gm;
const REQUIRE = /\brequire\s*\(\s*(['"])([^'"]+)\1/g;

/** The pack a path is in, if it is under packs/. */
export const packOf = (path: string): string | undefined => /^packs\/([\w-]+)\//.exec(path)?.[1];

/** A relative import's target, as a path from the repository's root. */
export const resolve = (from: string, spec: string): string => posix.normalize(posix.join(posix.dirname(from), spec));

/** Whether a path is a file the page is served: in ui/, or in a root pack's page/ (the host's page modules). */
export const isServed = (path: string): boolean => /^(?:ui|packs\/[\w-]+\/page)\/[^/]+$/.test(path);

/** The files the page is served, by the name it asks for (`/<name>`): every served file of a list, keyed by its file name. */
export const servedNames = (files: string[]): Record<string, string> =>
  Object.fromEntries(files.filter(isServed).map((f) => [posix.basename(f), f]));

/**
 * A relative import's target as the page loads it. A served file names another by `./<name>`, which the browser asks
 * for at `/<name>` whatever folder either is in (packs/surface/kernel/ui-files.ts), so it is the served file of that
 * name; anything else resolves as a path.
 */
export const resolveServed = (from: string, spec: string, served: Record<string, string>): string => {
  const name = /^\.\/([^/]+)$/.exec(spec)?.[1];
  return isServed(from) && name !== undefined && served[name] !== undefined ? served[name] : resolve(from, spec);
};

/** Whether a spec names a file of this repository (relative), rather than a built-in, a dependency or an alias. */
export const isRelative = (spec: string): boolean => spec.startsWith('./') || spec.startsWith('../');

/**
 * Every import a text makes, in order of where it stands. Read from the text alone, as the structure rules always have:
 * an import inside a comment or a string still counts.
 */
export function importsOf(text: string, from?: string): Import[] {
  const found: Import[] = [];
  const add = (spec: string, kind: ImportKind, typeOnly: boolean, at: number) =>
    found.push({ spec, kind, typeOnly, at, ...(from !== undefined && isRelative(spec) ? { to: resolve(from, spec) } : {}) });
  for (const m of text.matchAll(STATIC)) add(m[4], m[1] as 'import' | 'export', m[2] === 'type', m.index);
  for (const m of text.matchAll(DYNAMIC)) add(m[2], 'dynamic', false, m.index);
  for (const m of text.matchAll(BARE)) add(m[2], 'bare', false, m.index);
  for (const m of text.matchAll(REQUIRE)) add(m[2], 'require', false, m.index);
  return found.sort((a, b) => a.at - b.at);
}

/** The imports that load code when the module runs: every one but `import type` / `export type`. */
export const valueImports = (text: string, from?: string): Import[] => importsOf(text, from).filter((i) => !i.typeOnly);

/** The imports erased at run time: `import type` and `export type`. */
export const typeImports = (text: string, from?: string): Import[] => importsOf(text, from).filter((i) => i.typeOnly);

/**
 * The comment a file opens with, its markers taken off: the `//` lines at its head, or its leading block comment.
 * A `#!` line before it is passed over. Empty when the file opens with code.
 */
export function headerOf(text: string): string {
  const body = text.replace(/^﻿/, '').replace(/^#![^\n]*\n/, '').replace(/\r\n/g, '\n');
  const block = /^\s*\/\*\*?([\s\S]*?)\*\//.exec(body);
  if (block) return block[1].split('\n').map((l) => l.replace(/^\s*\*? ?/, '').trimEnd()).join('\n').trim();
  const lines: string[] = [];
  for (const line of body.replace(/^\s*\n/, '').split('\n')) {
    const m = /^\s*\/\/ ?(.*)$/.exec(line);
    if (!m) break;
    lines.push(m[1].trimEnd());
  }
  return lines.join('\n').trim();
}

/** A module read: its pack, header and imports. */
export const readModule = (path: string, text: string): Module => {
  const pack = packOf(path);
  return { path, ...(pack ? { pack } : {}), header: headerOf(text), imports: importsOf(text, path) };
};

// Which files are the code. The kernel is src/ and the root packs' kernel/ (docs/kernel-packs.md); a root pack is one
// whose manifest says `kernel.trust: "root"`.

/** A pack manifest, as far as reading code needs it. */
export type Manifest = { kernel?: { trust?: string } };

/** The packs whose manifest says they are root. */
export const rootPacksOf = (manifests: Record<string, Manifest>): string[] =>
  Object.entries(manifests).filter(([, m]) => m.kernel?.trust === 'root').map(([p]) => p);

/** A root pack's code: every TypeScript module under its kernel/ but its tests. */
export const rootCodeOf = (files: string[], roots: string[]): string[] =>
  files.filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && roots.some((p) => f.startsWith(`packs/${p}/kernel/`)));

/** The kernel's TypeScript: src/ (its tests too, as the structure rules read it), then the root packs' code. */
export const kernelCodeOf = (files: string[], roots: string[]): string[] =>
  [...files.filter((f) => f.startsWith('src/') && f.endsWith('.ts')), ...rootCodeOf(files, roots)];

/** Every file under a folder of a repository, as paths from its root with `/`; none when the folder is missing. */
export const walkFiles = (root: string, dir: string): string[] =>
  !existsSync(join(root, dir))
    ? []
    : readdirSync(join(root, dir)).flatMap((name) => {
        const path = `${dir}/${name}`;
        return statSync(join(root, path)).isDirectory() ? walkFiles(root, path) : [path];
      });
