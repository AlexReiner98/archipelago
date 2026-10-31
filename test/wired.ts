// A wired drawing run as the page runs it, for the structure test (test/structure.test.ts): its modules set out under the
// names pack.json gives them, a few small maps to draw, and what each draws read as boxes and lines. Kept apart so that
// test stays within the length every file keeps to.

import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = join(import.meta.dirname, '..');

type Drawing = { id: string; pack: string; modules: Record<string, string> };
/** Every drawing of every pack. */
export const drawings: Drawing[] = readdirSync(join(ROOT, 'packs')).filter((p) => existsSync(join(ROOT, 'packs', p, 'pack.json'))).flatMap((pack) =>
  ((JSON.parse(readFileSync(join(ROOT, 'packs', pack, 'pack.json'), 'utf8')) as { drawings?: Drawing[] }).drawings ?? []).map((d) => ({ ...d, pack })));
/** What a module imports of its drawing, by name. */
export const imported = (text: string) => [...text.matchAll(/(?:from\s+|import\s*\(\s*)['"]\.\/([^'"]+)['"]/g)].map((m) => m[1]);
export const pathOf = (d: Drawing, name: string) => `packs/${d.pack}/${d.modules[name]}`;
export const short = (file: string) => file.replace('packs/core/draw/', '');

export type Sketch = { items: any[]; links: { type: string; from: string; to: string }[] };
type Line = { ends: string[]; points: number[][] };
type Box = { id: string; l: number; r: number; t: number; u: number };

const measure = (text: string, px: number) => text.length * px * 0.55;
const item = (id: string, kind = 'work') => ({ id, kind, type: 'task', title: `Step ${id}`, open: true, status: 'todo', state: { blocked: false, waits_on: [], sessions: 0 } });
const dep = (from: string, to: string) => ({ id: `d_${from}_${to}`, type: 'depends_on', from, to });
const tie = (from: string, to: string, type = 'calls') => ({ id: `t_${from}_${to}`, type, from, to });
const named = (n: number, at = 'n') => Array.from({ length: n }, (_, k) => `${at}${k}`);
const sketch = (ids: string[], links: Sketch['links']): Sketch => ({ items: ids.map((id) => item(id)), links });

/** Order and ties tangled enough to take the search, not the even rows, with a few leaves on `hub`. */
function knot() {
  const ids = named(48), kids = named(3, 'k');
  return sketch([...ids, ...kids, 'hub'], [
    ...ids.flatMap((id, k) => [...(k % 7 ? [dep(id, ids[k - 1])] : []), ...(k > 8 && k % 5 === 0 ? [tie(ids[k - 8], id)] : [])]),
    ...kids.map((id) => tie(id, 'hub', 'part_of')), dep('hub', 'n3'), dep('n20', 'hub'),
  ]);
}

/** One box many wires land on, from both sides. */
function fan() {
  const before = named(8, 'a'), after = named(8, 'b');
  return sketch([...before, ...after, 'mid'], [...before.map((id) => dep('mid', id)), ...after.map((id) => dep(id, 'mid'))]);
}

/** Three that each reach the same three, so some wires must cross. */
function crossed() {
  const tops = named(3, 'p'), feet = named(3, 'q');
  return sketch([...tops, ...feet], feet.flatMap((q) => tops.map((p) => dep(q, p))));
}

/** A holder with many leaves, in a chain: every leaf's wire is its own. */
function comb() {
  const kids = named(12, 'k');
  return sketch([...kids, 'hub', 'up', 'down'], [...kids.map((id) => tie(id, 'hub', 'part_of')), dep('hub', 'up'), dep('down', 'hub')]);
}

/** What is not joined: two chains, and items joined to nothing. */
function apart() {
  const [a, b, c] = [named(4, 'a'), named(4, 'b'), named(5, 'c')];
  return sketch([...a, ...b, ...c], [...[a, b].flatMap((chain) => chain.slice(1).map((id, k) => dep(id, chain[k])))]);
}

export const SKETCHES: Record<string, Sketch> = { knot: knot(), fan: fan(), crossed: crossed(), comb: comb(), apart: apart() };

/** The core pack's house style. */
const house = () => JSON.parse(readFileSync(join(ROOT, 'packs/core/pack.json'), 'utf8')).styles.find((s: any) => s.id === 'core.house').props;

const boxesOf = (g: any): Box[] => g.all.filter((n: any) => !n.dummy).map((n: any) => {
  const [x, y] = [g.x.get(n.id), g.y.get(n.id)];
  return { id: n.id, l: x - n.w / 2, r: x + n.w / 2, t: y - n.h / 2, u: y + n.h / 2 };
});
const linesOf = (wires: any[]): Line[] => wires.filter((w) => w.points?.length > 1).map((w) => ({ ends: [w.a, w.b], points: w.points }));

/** What every wired drawing draws of a sketch, with its layout, and the spacing it keeps its wires at. A new wired drawing is added here. */
export const WIRED: Record<string, { gap: (sizes: Record<string, number>) => number; draw: (layout: any, s: Sketch) => { boxes: Box[]; lines: Line[] } }> = {
  'core.flow': {
    gap: (sizes) => sizes.flow_wire_gap,
    draw(layout, { items, links }) {
      const { sizes, headless, undrawn } = house(), g = layout({ items, links, measure, sizes, headless, undrawn });
      return { boxes: boxesOf(g), lines: linesOf([...g.chains, ...g.ties]) };
    },
  },
  'core.architecture': {
    gap: (sizes) => sizes.arch_track,
    draw(layout, { items, links }) {
      const inside = [{ ...item('root', 'place'), inside: null }, ...items.map((i) => ({ ...i, inside: 'root' }))], g = layout({ items: inside, links, rootId: 'root', measure, sizes: house().sizes });
      return { boxes: boxesOf(g), lines: linesOf(g.chains) };
    },
  },
};

/** How each sketch fails a drawing, counted: `count` is spacing from flow's faults.js, run on its lines at `gap`. */
export function faultsOf(wired: (typeof WIRED)[string], layout: any, spacing: (lines: Line[], gap: number) => any) {
  const gap = wired.gap(house().sizes), found: Record<string, number> = {};
  for (const [name, s] of Object.entries(SKETCHES)) {
    const { boxes, lines } = wired.draw(layout, s), { down, across } = spacing(lines, gap);
    const stand = boxes.flatMap((p, i) => boxes.slice(i + 1).filter((q) => Math.min(p.r, q.r) - Math.max(p.l, q.l) > 0.5 && Math.min(p.u, q.u) - Math.max(p.t, q.t) > 0.5)).length;
    const through = lines.filter((w) => boxes.some((b) => !w.ends.includes(b.id) && w.points.some((p, i) => {
      const q = w.points[i - 1];
      return i > 0 && Math.max(p[0], q[0]) > b.l + 1 && Math.min(p[0], q[0]) < b.r - 1 && Math.max(p[1], q[1]) > b.t + 1 && Math.min(p[1], q[1]) < b.u - 1;
    }))).length;
    const counts = { overlaps: down.overlaps + across.overlaps, shared: down.shared + across.shared, under: down.under + across.under, 'boxes on boxes': stand, 'wires through boxes': through };
    for (const [what, n] of Object.entries(counts)) if (n) found[`${name}: ${what}`] = n;
  }
  return found;
}

/** The layers of a wired drawing, in the order each may read those before it (docs/drawings.md). */
export const LAYERS = ['graph', 'topology', 'shape', 'metrics', 'marks'];
/** What each module that does not yet say its layer will say, by folder then layer. Architecture's are a first reading. */
const LAYERS_OWED: Record<string, Record<string, string>> = {
  flow: {
    graph: 'combs graph lines places polyline shapes steps', topology: 'count numbering planar thread upward', shape: 'faults',
    metrics: 'layout tidy', marks: 'index look story',
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
export async function setOut<T>({ pack, modules }: Drawing, use: (url: (name: string) => string) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'wired-'));
  try {
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    for (const [name, file] of Object.entries(modules)) cpSync(join(ROOT, 'packs', pack, file), join(dir, name));
    return await use((name) => pathToFileURL(join(dir, name)).href);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

/** Every keyed wire's path in a scene's marks, by key. */
function pathsIn(mark: unknown, out = new Map<string, string>()) {
  if (!Array.isArray(mark)) return out;
  const attrs = mark[1];
  if (attrs && typeof attrs === 'object' && /^[wn]:/.test(attrs.key ?? '') && attrs.d) out.set(attrs.key, attrs.d);
  for (const inner of mark) pathsIn(inner, out);
  return out;
}

/** The steps the one-call rule moves: a sketch, a step, and how far. */
export const MOVED: [string, string, number[]][] = [['knot', 'n10', [70, 40]], ['fan', 'mid', [-90, 60]], ['crossed', 'q1', [120, 30]]];

/**
 * Wires that differ from the picture drawn afresh with the step there: at a drag frame halfway, and let go. Drawn, moved and
 * reloaded are one call when this is 0. Told what it is opened on (`here`), a picture starts at that step's middle.
 */
export function differsFromReload(picture: (input: any, tools: any) => any, name: string, id: string, by: number[]) {
  const { items, links } = SKETCHES[name], tools = { measure, patch() {}, open() {}, frame: async () => {} }, style = house();
  const drawn = (placed: Record<string, number[]>) => picture({ answer: { items, links }, style: { ...style, placed, here: id }, reduced: true, width: 1600, height: 1000 }, tools);
  const moving = drawn({}), from: number[] = moving.scene.start, paths = pathsIn(moving.scene.svg), key = `s:${id}`;
  const spot = (part: number) => [Math.round(from[0] + by[0] * part), Math.round(from[1] + by[1] * part)];
  const event = (what: string, to: number[]) => ({ name: what, key, dx: to[0] - from[0], dy: to[1] - from[1] });
  const apply = (patches: any[]) => { for (const p of patches) if (p.set?.d && paths.has(p.key)) paths.set(p.key, p.set.d); };
  const differing = (to: number[]) => { const again = pathsIn(drawn({ [id]: to }).scene.svg); return [...paths].filter(([k, d]) => again.get(k) !== d).length; };
  apply(moving.on(event('drag', spot(0.5))));
  const atFrame = differing(spot(0.5));
  apply(moving.on(event('drop', spot(1))));
  return atFrame + differing(spot(1));
}
