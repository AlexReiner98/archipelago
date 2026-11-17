// The wired drawings, for the structure test (test/structure.test.ts): their modules, the layer each says, and a drawing
// set out under the names pack.json gives its modules, to run as the page runs it. Kept apart so that test stays within
// the length every file keeps to.

import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = join(import.meta.dirname, '..');

type Layout = { id: string; pack: string; modules: Record<string, string> };
/** Every drawing of every pack. */
export const drawings: Layout[] = readdirSync(join(ROOT, 'packs')).filter((p) => existsSync(join(ROOT, 'packs', p, 'pack.json'))).flatMap((pack) =>
  ((JSON.parse(readFileSync(join(ROOT, 'packs', pack, 'pack.json'), 'utf8')) as { layouts?: Layout[] }).layouts ?? []).map((d) => ({ ...d, pack })));
/** What a module imports of its drawing, by name. */
export const imported = (text: string) => [...text.matchAll(/(?:from\s+|import\s*\(\s*)['"]\.\/([^'"]+)['"]/g)].map((m) => m[1]);
export const pathOf = (d: Layout, name: string) => `packs/${d.pack}/${d.modules[name]}`;
export const short = (file: string) => file.replace('packs/canvas/layouts/', '');

/** The wired drawings, whose modules keep the layers apart (docs/layouts.md). Those retired on 9 Nov 2026 are at git tag
 *  archive/layouts-2026-11-09. */
export const WIRED: Record<string, true> = { 'core.map': true };

/** The layers of a wired drawing, in the order each may read those before it (docs/layouts.md). */
export const LAYERS = ['graph', 'topology', 'shape', 'metrics', 'marks'];
/** What each module that does not yet say its layer will say, by folder then layer. Architecture's are a first reading. */
const LAYERS_OWED: Record<string, Record<string, string>> = {
  flow: {
    graph: 'combs graph lines places polyline shapes steps', topology: 'count', shape: 'faults',
    metrics: 'layout', marks: 'index look story',
  },
  architecture: {
    shape: 'sides', 'shape and metrics': 'route', 'graph and metrics': 'layout',
    marks: 'boards boats deep index islands look marks moves play says story story-look',
  },
};
/** A place or a wire's points set. */
export const WRITES = /\.points\s*=[^=>]|\.points\.(?:push|splice|unshift)\(|\b(?:x|y|places)\.set\(|\.at\[[^\]]+\]\s*[-+]?=[^=]|\.[xy]\s*[-+]?=[^=>]/g;
const said = new RegExp(`\\bLayers?: ((?:${LAYERS.join('|')})(?:(?:, | and )(?:${LAYERS.join('|')}))*)`);
export const owedLayer = (file: string) => Object.entries(LAYERS_OWED[file.split('/').at(-2)!] ?? {}).find(([, names]) => names.split(' ').includes(basename(file, '.js')))?.[0];
/** The layer a module's first comment says. */
export const saysLayer = (file: string) => said.exec(/^(?:\/\/.*\r?\n)+/.exec(readFileSync(join(ROOT, file), 'utf8'))?.[0].replace(/^\/\/ ?/gm, '').replace(/\s+/g, ' ') ?? '')?.[1];
/** Where a module stands among the layers: one number, or more for a module not yet apart. */
export const ranks = (file: string) => (saysLayer(file) ?? owedLayer(file) ?? '').split(/, | and /).map((l) => LAYERS.indexOf(l));

/** `use` run with a drawing's modules set out as the page loads them, by the names in `modules`: `url(name)` is how to import one. */
export async function setOut<T>({ pack, modules }: Layout, use: (url: (name: string) => string) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-wired-'));
  try {
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    for (const [name, file] of Object.entries(modules)) cpSync(join(ROOT, 'packs', pack, file), join(dir, name));
    return await use((name) => pathToFileURL(join(dir, name)).href);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}


