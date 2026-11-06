// The archipelago measured on a real picture (test/fixtures/layouts/flow-islands.json: the owner's islands view, every word
// hidden). Each fault is a count, and a count may only go down: lower its ceiling when a change brings it down, never raise
// it. The faults are what the owner has seen go wrong (6 Nov 2026): a wire that does not reach its step, a step outside
// its island or on another step, a wire through a step or a finding's name, two wires on one stretch, a jog by a port, and a crossing with no break.

import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8'));
const house = { ...pack.styles.find((s: any) => s.id === 'core.house').props, shape: 'flow' };
const laid = mkdtempSync(join(tmpdir(), 'flow-islands-view-'));
for (const [name, file] of Object.entries(pack.layouts.find((d: any) => d.id === 'core.flow').modules)) copyFileSync(join(import.meta.dirname, file as string), join(laid, name));
const load = (name: string) => import(pathToFileURL(join(laid, name)).href);
const [{ layout }, { compose, islandModels }, { count }, { nameOf, saidOf }] = await Promise.all([load('layout.js'), load('archipelago.js'), load('count.js'), load('islands.js')]);
const { result: answer } = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'layouts', 'flow-islands.json'), 'utf8'));

/** What each fault may count, at most: lower a ceiling when a change brings its count down, never raise one. */
const CEILING: Record<string, number> = { 'loose ends': 11, outside: 0, overlapping: 0, through: 3, 'through a name': 0, shared: 0, jogs: 2, unbridged: 0, crossings: 255 };

const z = (name: string) => house.sizes[`flow_${name}`], measure = (t: string, px: number) => String(t).length * px * 0.55;
/** The shapes a page lays the picture out to: tall, the house's, and wide. Each fault is counted in all three. */
const ASPECTS = [1, 1.6, 2.4];
let aspect = ASPECTS[0];
const run = (part: any) => layout({ ...part, undrawn: house.undrawn ?? [], headless: house.headless, measure, sizes: house.sizes, aspect, shapes: { type: house.type_shapes ?? {} } });
const entry = (title: string) => z('key_width') + z('island_legend_mark_gap') + measure(title, z('island_legend_text'));
const legends = new Map(answer.islands.map((i: any) => [i.id, [...(i.pack?.types ?? []), ...(i.pack?.links ?? [])].map((t: any) => entry(t.title))]));
const names = new Map(answer.islands.map((i: any) => [i.id, z('island_name_x') + measure(nameOf(i), z('island_text'))]));
const labels = (l: any) => Math.min(measure(saidOf(answer.items.find((i: any) => i.id === l.to)), z('island_gate_text')), z('island_gate_most') - 2 * z('island_gate_pad')) + 2 * z('island_gate_pad');
const laidOut = () => compose(islandModels({ items: answer.items, links: answer.links, run }), { legends, names, labels, sizes: house.sizes });
let g = laidOut();

type Rect = { l: number; t: number; r: number; b: number };
const boxOf = (id: string): Rect => { const n = g.nodes.get(id); return { l: g.x.get(id) - n.w / 2, t: g.y.get(id) - n.h / 2, r: g.x.get(id) + n.w / 2, b: g.y.get(id) + n.h / 2 }; };
const meet = (a: Rect, b: Rect, by = 0.5) => a.l < b.r - by && b.l < a.r - by && a.t < b.b - by && b.t < a.b - by;
const inside = (p: number[], r: Rect) => p[0] > r.l + 0.5 && p[0] < r.r - 0.5 && p[1] > r.t + 0.5 && p[1] < r.b - 0.5;
const stretchMeets = (p: number[], q: number[], r: Rect) => !inside(p, r) && !inside(q, r) && meet({ l: Math.min(p[0], q[0]), t: Math.min(p[1], q[1]), r: Math.max(p[0], q[0]), b: Math.max(p[1], q[1]) }, r, 0.5);
const len = (p: number[], q: number[]) => Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]);

/** Every fault, counted. */
function faults() {
  const steps = g.all.filter((n: any) => !n.dummy).map((n: any) => n.id), wires = [...g.chains, ...g.ties];
  const landOf = new Map(g.islands.flatMap((i: any) => [...i.steps].map((id) => [id, i.land[0]])));
  const outside = steps.filter((id: string) => landOf.has(id) && !(([b, f]) => b.l >= f.l && b.r <= f.r && b.t >= f.t && b.b <= f.b)([boxOf(id), landOf.get(id)])).length;
  let overlapping = 0, through = 0, onName = 0, jogs = 0;
  for (let i = 0; i < steps.length; i++) for (let j = i + 1; j < steps.length; j++) if (meet(boxOf(steps[i]), boxOf(steps[j]))) overlapping++;
  const named = [...new Map(g.ties.filter((t: any) => t.label).map((t: any) => [t.label.id, t.label])).values()].map((n: any) => ({ l: n.at[0] - n.w / 2, t: n.at[1] - z('island_gate_height') / 2, r: n.at[0] + n.w / 2, b: n.at[1] + z('island_gate_height') / 2 }));
  for (const w of wires) for (let k = 1; k < w.points.length; k++) {
    const [p, q] = [w.points[k - 1], w.points[k]];
    for (const id of steps) if (id !== w.a && id !== w.b && stretchMeets(p, q, boxOf(id))) through++;
    for (const n of named) if (stretchMeets(p, q, n)) onName++;
    // A jog: a stretch between two bends shorter than a wire's run from a port, where nothing asks it to be.
    if (k > 1 && k < w.points.length - 1 && len(p, q) > 0.5 && len(p, q) < z('port_run')) jogs++;
  }
  // A loose end: a wire's end more than a hair off its own box (a read across ends on a finding's name, not its box).
  const off = (p: number[], r: Rect) => Math.max(r.l - p[0], p[0] - r.r, r.t - p[1], p[1] - r.b, 0);
  const loose = wires.reduce((n: number, w: any) => n + [[w.fromName ? null : w.a, w.points[0]], [w.crossing && w.label ? null : w.b, w.points.at(-1)]].filter(([id, p]) => id && g.x.has(id) && off(p, boxOf(id)) > 1).length, 0);
  const c = count(wires.map((w: any) => w.points));
  return { 'loose ends': loose, outside, overlapping, through, 'through a name': onName, shared: c.shared, jogs, unbridged: c.crossings - g.breaks.length, crossings: c.crossings };
}

test('islands view: no fault counts more than it did', () => {
  const found: Record<string, number> = {};
  for (const shape of ASPECTS) {
    (aspect = shape), (g = laidOut());
    for (const [k, n] of Object.entries(faults())) found[k] = (found[k] ?? 0) + (n as number);
  }
  const over = Object.keys(CEILING).filter((k) => found[k] > CEILING[k]).map((k) => `${k}: ${found[k]}, at most ${CEILING[k]}`);
  const under = Object.keys(CEILING).filter((k) => found[k] < CEILING[k]).map((k) => `${k}: ${found[k]}, ceiling ${CEILING[k]}`);
  assert.deepEqual(over, [], `More faults than before: ${JSON.stringify(found)}`);
  assert.deepEqual(under, [], 'Fewer faults: lower the ceilings in CEILING to the new counts');
});
