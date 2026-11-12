// Bundles: packs that go on and off together (the owner, 11 Nov 2026, decision e_f9ybsuce). On an island map a pack
// holds types or code, never both (packs/loader/kernel/islands.ts), so what is one way of working is often two packs: an island pack
// of words and the map pack that acts on them (refine and replays). A bundle names them, so the owner turns them on
// and off as one, the Packs screen draws them as one plate, and a distribution (PELAGO_START_PACKS) can name it.
//
// A bundle is a small manifest of its own, bundle.json in a folder beside the packs (in any folder packs are read
// from): { id, title, description, packs }. Its id is its folder's, never a pack's, and a pack is in one bundle at
// most. A bundle is offered to a workspace only when all its packs are (packs/loader/kernel/pack-allow.ts); where one of them is not,
// the others stand alone there.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface Bundle {
  id: string;
  title: string;
  description?: string;
  /** Its packs, by id: two or more. */
  packs: string[];
}

const KEYS = ['id', 'title', 'description', 'packs'];

/** One bundle.json read and checked; `where` names it in an error. */
export function readBundle(text: string, where: string): Bundle {
  const raw = JSON.parse(text) as Record<string, unknown>;
  const extra = Object.keys(raw).filter((k) => !KEYS.includes(k));
  if (extra.length) throw new Error(`Bundle ${where}: unknown key${extra.length === 1 ? '' : 's'} ${extra.join(', ')} (a bundle has ${KEYS.join(', ')})`);
  const { id, title, description, packs } = raw;
  if (typeof id !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(id)) throw new Error(`Bundle ${where}: id must be a lowercase name`);
  if (typeof title !== 'string' || !title.trim() || title.length > 60) throw new Error(`Bundle ${where}: title must be a name of 60 characters at most`);
  if (description !== undefined && typeof description !== 'string') throw new Error(`Bundle ${where}: description must be text`);
  if (!Array.isArray(packs) || packs.length < 2 || packs.some((p) => typeof p !== 'string') || new Set(packs).size !== packs.length) throw new Error(`Bundle ${where}: packs must name two or more packs, each once`);
  return { id, title, ...(description !== undefined && { description }), packs: packs as string[] };
}

/**
 * Every bundle in the folders, checked against the packs found there: its id is no pack's, and a pack is in one bundle
 * at most. A bundle may name a pack no folder holds; it is then never offered (bundlesOffered).
 */
export function readBundles(dirs: string[], packs: Iterable<string>): Bundle[] {
  const ids = new Set(packs);
  const out: Bundle[] = [];
  const holder = new Map<string, string>();
  for (const dir of dirs) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const file = join(dir, name, 'bundle.json');
      if (!existsSync(file)) continue;
      const b = readBundle(readFileSync(file, 'utf8'), `${name}/bundle.json`);
      if (b.id !== name) throw new Error(`Bundle folder "${name}" contains bundle id "${b.id}"`);
      if (ids.has(b.id)) throw new Error(`Bundle "${b.id}" has a pack's id: a bundle and a pack are never named alike`);
      if (out.some((o) => o.id === b.id)) throw new Error(`Bundle "${b.id}" is in two folders`);
      for (const p of b.packs) {
        if (holder.has(p)) throw new Error(`Pack "${p}" is in two bundles: ${holder.get(p)} and ${b.id}`);
        holder.set(p, b.id);
      }
      out.push(b);
    }
  }
  return out;
}

/** The bundles a workspace is offered: those whose every pack is here and offered to it. */
export const bundlesOffered = (bundles: Bundle[], offered: (pack: string) => boolean): Bundle[] => bundles.filter((b) => b.packs.every(offered));

/** The packs a name stands for: a bundle's packs, a bundled pack's whole bundle, or the pack alone. */
export function packsNamed(bundles: Bundle[], name: string): { packs: string[]; bundle?: Bundle } {
  const bundle = bundles.find((b) => b.id === name || b.packs.includes(name));
  return bundle ? { packs: bundle.packs, bundle } : { packs: [name] };
}

/** A distribution's names as packs: each bundle named stands for its packs. */
export const expandBundles = (names: string[], bundles: Bundle[]): string[] => [...new Set(names.flatMap((n) => bundles.find((b) => b.id === n)?.packs ?? [n]))];
