// Drawings: the code a picture is drawn by, shipped by a pack and changed on the map. A pack declares each in its
// pack.json (`drawings`: the shape it draws and its modules, files in the pack's folder, entered at index.js); a
// style kept with a drawing's id as its preset is the owner's version, whose `modules` stand in for the pack's file
// by file. The page runs it in the sandbox (ui/drawing.js); the kernel draws no shape itself once a drawing draws it.
//
// A drawing goes to the page with its hash, and its modules only when the page does not have them yet (`have`).

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { DrawingDef } from './declared.ts';

/** A drawing as the page is sent it. */
export interface Drawing {
  id: string;
  title: string;
  /** The shape it draws: a page draws with it only a picture of that shape. */
  shape: string;
  hash: string;
  modules?: Record<string, string>;
}

const NAME = /^[a-z][a-z0-9_-]*\.js$/;
const read = new Map<string, string>();
/** A pack's drawing's modules, read from its folder once. */
function modulesOf(dir: string, pack: string, d: DrawingDef): Record<string, string> {
  return Object.fromEntries(
    Object.entries(d.modules).map(([name, file]) => {
      const path = join(dir, pack, file);
      if (!read.has(path)) read.set(path, readFileSync(path, 'utf8'));
      return [name, read.get(path)!];
    }),
  );
}

/** Every drawing the packs ship, in the order the packs load. */
export const drawingsOf = (packs: { id: string; drawings?: DrawingDef[] }[]) => packs.flatMap((pack) => (pack.drawings ?? []).map((d) => ({ ...d, pack: pack.id })));

const hashOf = (modules: Record<string, string>) => createHash('sha256').update(JSON.stringify(Object.entries(modules).sort(([a], [b]) => (a < b ? -1 : 1)))).digest('hex');

/**
 * The drawing a style is drawn by: its shape's, as the pack ships it under the owner's version of it (`versions`:
 * styles kept with a preset). A style with code of its own is drawn by that, and a shape no pack draws by the kernel.
 */
export function drawingFor(
  packs: { dir: string; packs: { id: string; drawings?: DrawingDef[] }[] },
  style: Record<string, unknown>,
  versions: { is_open: boolean; props: Record<string, unknown> }[],
  have: string[] = [],
): Drawing | undefined {
  if (typeof style.code === 'string' && style.code.trim()) return undefined;
  const d = drawingsOf(packs.packs).find((one) => one.shape === style.shape);
  if (!d) return undefined;
  const mine = versions.find((v) => v.props.preset === d.id);
  if (mine && !mine.is_open) return undefined;
  const changed = mine?.props.modules && typeof mine.props.modules === 'object' ? Object.entries(mine.props.modules as Record<string, unknown>).filter(([name, text]) => NAME.test(name) && typeof text === 'string') : [];
  const modules = { ...modulesOf(packs.dir, d.pack, d), ...Object.fromEntries(changed) } as Record<string, string>;
  const hash = hashOf(modules);
  return { id: d.id, title: d.title, shape: d.shape, hash, ...(!have.includes(hash) && { modules }) };
}

/**
 * A pack's drawing as the pack ships it: its hash, and the entry's file, which the server may import
 * (src/published-frames.ts). Where each module is a file of its own name in one folder, that folder's; else (a module
 * shared with another drawing) the modules are laid out by name in a folder of their own, kept by the hash. Code kept
 * by the hash is the pack's own.
 */
export function packDrawing(packs: { dir: string; packs: { id: string; drawings?: DrawingDef[] }[] }, id: string): { hash: string; entry?: string } | undefined {
  const d = drawingsOf(packs.packs).find((one) => one.id === id);
  if (!d) return undefined;
  const files = Object.entries(d.modules).map(([name, file]) => [name, join(packs.dir, d.pack, file)]);
  const folder = dirname(files.find(([name]) => name === 'index.js')?.[1] ?? '');
  const modules = modulesOf(packs.dir, d.pack, d), hash = hashOf(modules);
  if (files.every(([name, path]) => path === join(folder, name))) return { hash, entry: join(folder, 'index.js') };
  const laid = join(tmpdir(), 'pelago-drawings', hash);
  mkdirSync(laid, { recursive: true });
  for (const [name, text] of Object.entries(modules)) if (NAME.test(name)) writeFileSync(join(laid, name), text);
  return { hash, ...('index.js' in modules && { entry: join(laid, 'index.js') }) };
}
