// Drawings: the code a picture is drawn by, shipped by a pack and changed on the map. A pack declares each in its
// pack.json (`layouts`: the shape it draws and its modules, files in the pack's folder, entered at index.js); a
// layout kept with a drawing's id as its preset is the owner's version, whose `modules` stand in for the pack's file
// by file. The page runs it in the sandbox (packs/walls/page/layout.js); the kernel draws no shape itself once a drawing draws it.
//
// A drawing goes to the page with its hash, and its modules only when the page does not have them yet (`have`).

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { LayoutDef } from './declared.ts';

/** A drawing as the page is sent it. */
export interface Layout {
  id: string;
  title: string;
  /** The shape it draws: a page draws with it only a picture of that shape. */
  shape: string;
  hash: string;
  /** "whole" when it reads each item's note whole: the page asks the lens for them so. */
  notes?: 'whole';
  modules?: Record<string, string>;
}

const NAME = /^[a-z][a-z0-9_-]*\.js$/;
const read = new Map<string, string>();
/** A pack's drawing's modules, read from its folder once. */
function modulesOf(folder: string, d: LayoutDef): Record<string, string> {
  return Object.fromEntries(
    Object.entries(d.modules).map(([name, file]) => {
      const path = join(folder, file);
      if (!read.has(path)) read.set(path, readFileSync(path, 'utf8'));
      return [name, read.get(path)!];
    }),
  );
}

/** Every drawing the packs ship, in the order the packs load. */
export const layoutsOf = (packs: { id: string; layouts?: LayoutDef[] }[]) => packs.flatMap((pack) => (pack.layouts ?? []).map((d) => ({ ...d, pack: pack.id })));

const hashOf = (modules: Record<string, string>) => createHash('sha256').update(JSON.stringify(Object.entries(modules).sort(([a], [b]) => (a < b ? -1 : 1)))).digest('hex');

/**
 * The drawing a style is drawn by: its shape's, as the pack ships it under the owner's version of it (`versions`:
 * layouts kept with a drawing's id as preset). A style whose layout has code is drawn by that, and a shape no pack draws by the first drawing shipped.
 */
export function layoutFor(
  packs: { folderOf(pack: string): string; packs: { id: string; layouts?: LayoutDef[] }[] },
  style: Record<string, unknown>,
  versions: { is_open: boolean; props: Record<string, unknown> }[],
  have: string[] = [],
): Layout | undefined {
  if (typeof style.code === 'string' && style.code.trim()) return undefined;
  // A shape no pack draws (one retired, or none said) is drawn by the first drawing the packs ship: canvas's map, where only it ships one.
  const shipped = layoutsOf(packs.packs);
  const d = shipped.find((one) => one.shape === style.shape) ?? shipped[0];
  if (!d) return undefined;
  const mine = versions.find((v) => v.props.preset === d.id);
  if (mine && !mine.is_open) return undefined;
  const modules = modulesWith(packs, d, mine);
  const hash = hashOf(modules);
  return { id: d.id, title: d.title, shape: d.shape, hash, ...(d.notes === 'whole' && { notes: d.notes }), ...(d.flat === true && { flat: true }), ...(!have.includes(hash) && { modules }) };
}

/** A shipped drawing's modules, under the owner's version of it when there is one: its `modules` stand in file by file. */
function modulesWith(packs: { folderOf(pack: string): string }, d: LayoutDef & { pack: string }, mine?: { props: Record<string, unknown> }): Record<string, string> {
  const changed = mine?.props.modules && typeof mine.props.modules === 'object' ? Object.entries(mine.props.modules as Record<string, unknown>).filter(([name, text]) => NAME.test(name) && typeof text === 'string') : [];
  return { ...modulesOf(packs.folderOf(d.pack), d), ...Object.fromEntries(changed) } as Record<string, string>;
}

/**
 * Every drawing a page may be sent, by its hash (the one `layoutFor` gives): each the packs ship as they ship it, and as
 * each open version of it (`versions`) changes it. What packs/publish/kernel/drawing-files.ts serves a module of.
 */
export function drawingsBy(packs: { folderOf(pack: string): string; packs: { id: string; layouts?: LayoutDef[] }[] }, versions: { is_open: boolean; props: Record<string, unknown> }[] = []): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  for (const d of layoutsOf(packs.packs)) {
    for (const mine of [undefined, ...versions.filter((v) => v.is_open && v.props.preset === d.id)]) {
      const modules = modulesWith(packs, d, mine);
      out.set(hashOf(modules), modules);
    }
  }
  return out;
}

/**
 * A pack's drawing as the pack ships it: its hash, and the entry's file, which the server may import
 * (packs/publish/kernel/published-frames.ts). Where each module is a file of its own name in one folder, that folder's; else (a module
 * shared with another drawing) the modules are laid out by name in a folder of their own, kept by the hash. Code kept
 * by the hash is the pack's own.
 */
export function packLayout(packs: { folderOf(pack: string): string; packs: { id: string; layouts?: LayoutDef[] }[] }, id: string): { hash: string; entry?: string } | undefined {
  const d = layoutsOf(packs.packs).find((one) => one.id === id);
  if (!d) return undefined;
  const files = Object.entries(d.modules).map(([name, file]) => [name, join(packs.folderOf(d.pack), file)]);
  const folder = dirname(files.find(([name]) => name === 'index.js')?.[1] ?? '');
  const modules = modulesOf(packs.folderOf(d.pack), d), hash = hashOf(modules);
  if (files.every(([name, path]) => path === join(folder, name))) return { hash, entry: join(folder, 'index.js') };
  const laid = join(tmpdir(), 'pelago-drawings', hash);
  mkdirSync(laid, { recursive: true });
  for (const [name, text] of Object.entries(modules)) if (NAME.test(name)) writeFileSync(join(laid, name), text);
  return { hash, ...('index.js' in modules && { entry: join(laid, 'index.js') }) };
}
