// A slot a root opens and the roots above it fill (docs/kernel-packs.md, "Slots"): each root declares what it fills
// as a named export of a module of its kernel/, read in the order packs/roots.json starts the roots. A root asks no
// root above it by name: it reads what each declares, as the stub reads their start and the identity root their open
// (packs/identity/kernel/lifecycle.ts). What is read is read once, when first asked, never while a module is still being loaded.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

/** The packs folder whose roots.json and root packs are read. */
const PACKS = join(import.meta.dirname, '..', '..');
const read = new Map<string, Promise<{ root: string; value: unknown }[]>>();

/** The roots in the order they start. */
export function rootIds(): string[] {
  const { roots = [] } = JSON.parse(readFileSync(join(PACKS, 'roots.json'), 'utf8')) as { roots?: { id: string }[] };
  return roots.map((r) => r.id);
}

/** Each root's export `name` of its `kernel/<file>`, in the order the roots start: those that have neither are passed over. */
export function rootFills<T>(file: string, name: string): Promise<{ root: string; value: T }[]> {
  const key = `${file}#${name}`;
  if (!read.has(key)) {
    read.set(key, (async () => {
      const out: { root: string; value: unknown }[] = [];
      for (const root of rootIds()) {
        const path = join(PACKS, root, 'kernel', file);
        if (!existsSync(path)) continue;
        const value = ((await import(pathToFileURL(path).href)) as Record<string, unknown>)[name];
        if (value !== undefined) out.push({ root, value });
      }
      return out;
    })().catch((err) => {
      read.delete(key); // asked again, it is read again
      throw err;
    }));
  }
  return read.get(key)! as Promise<{ root: string; value: T }[]>;
}
