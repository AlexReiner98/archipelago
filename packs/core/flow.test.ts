// The flow drawing's layout (draw/flow/layout.js): a lens answer in, a flat graph out, checked for what a reader of the
// drawing relies on: every item a step and none inside another, no two steps overlap, every wire of the order turns
// only at right angles and runs straight into its head, wires cross only where they must, part_of keeps its ends near,
// and a step put by hand stays where it was put.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
// @ts-expect-error: a plain module of the drawing, with no types of its own.
import { layout, LARGE } from './draw/flow/layout.js';

const state = { blocked: false, waits_on: [], sessions: 0 };
const item = (id: string, kind = 'work', extra: Record<string, unknown> = {}) => ({ id, kind, inside: 'r', title: `Step ${id}`, place: 0, open: true, status: 'todo', state, ...extra });
/** b depends on a: a leads to b. */
const dep = (b: string, a: string, says?: string) => ({ kind: 'depends_on', from: b, to: a, ...(says && { says }) });
const measure = (text: string, px: number) => text.length * px * 0.55;
// Laid out by the house style's lengths, as the page lays it out (packs/core/pack.json).
const house = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8')).styles.find((s: any) => s.id === 'core.house').props;
const run = (items: any[], links: any[], placed = {}) => layout({ items: [{ ...item('r', 'aim'), inside: null }, ...items], links, placed, measure, sizes: house.sizes });
/** A flat lens's answer: items with no inside, place or state; links each with its type. */
const flat = (id: string, extra: Record<string, unknown> = {}) => ({ id, kind: 'work', type: 'task', title: `Step ${id}`, open: true, status: 'todo', ...extra });
const link = (type: string, from: string, to: string) => ({ id: `r_${from}${to}`, type, from, to });

function checks(g: any) {
  const steps = g.all.filter((n: any) => !n.dummy);
  // No two steps overlap.
  for (const a of steps)
    for (const b of steps) {
      if (a === b) continue;
      const apart = Math.abs(g.x.get(a.id) - g.x.get(b.id)) >= (a.w + b.w) / 2 || Math.abs(g.y.get(a.id) - g.y.get(b.id)) >= (a.h + b.h) / 2;
      assert.ok(apart, `${a.id} and ${b.id} overlap`);
    }
  for (const c of g.chains) {
    const pts = c.points;
    // Right angles only.
    for (let k = 1; k < pts.length; k++) assert.ok(Math.abs(pts[k][0] - pts[k - 1][0]) < 0.01 || Math.abs(pts[k][1] - pts[k - 1][1]) < 0.01, `${c.key} turns at a slant`);
    // A straight run of at least 22 px into the head.
    const [[x1, y1], [x2, y2]] = pts.slice(-2);
    assert.ok(Math.abs(x1 - x2) < 0.01 && y2 - y1 >= 22 - 0.01, `${c.key} runs ${y2 - y1} px into its head`);
  }
  // Every tie is routed as a wire is: at right angles, from one of its steps to the other.
  for (const t of g.ties) {
    assert.ok(t.points.length >= 2, `${t.a} ${t.b} is drawn`);
    for (let k = 1; k < t.points.length; k++) assert.ok(Math.abs(t.points[k][0] - t.points[k - 1][0]) < 0.01 || Math.abs(t.points[k][1] - t.points[k - 1][1]) < 0.01, `${t.a} ${t.b} turns at a slant`);
  }
}

test('a chain is a straight line down, with nothing crossing', () => {
  const g = run([item('a'), item('b'), item('c')], [dep('b', 'a'), dep('c', 'b')]);
  checks(g);
  assert.equal(g.breaks.length, 0);
  assert.deepEqual(['a', 'b', 'c'].map((id) => g.y.get(id)).sort((p, q) => p - q), ['a', 'b', 'c'].map((id) => g.y.get(id)));
  assert.equal(new Set(g.chains.flatMap((c: any) => c.points.map((p: number[]) => p[0]))).size, 1, 'the wires drop without a turn');
});

test('a wire another path implies is not drawn', () => {
  const g = run([item('a'), item('b'), item('c')], [dep('b', 'a'), dep('c', 'b'), dep('c', 'a')]);
  assert.deepEqual(g.chains.map((c: any) => c.key).sort(), ['a b', 'b c']);
});

test('what is part of a step is a step of its own, tied to it and near it', () => {
  const g = run([item('a'), item('b'), item('n', 'work', { inside: 'a' })], [dep('b', 'a')]);
  checks(g);
  assert.ok(g.nodes.has('n'), 'every item is a step');
  assert.ok(g.ties.some((t: any) => t.a === 'n' && t.b === 'a' && t.type === 'part_of'), 'part_of is a tie');
  assert.ok(!g.chains.some((c: any) => c.a === 'n' || c.b === 'n'), 'and no wire of the order');
  const d = Math.hypot(g.x.get('n') - g.x.get('a'), g.y.get('n') - g.y.get('a'));
  assert.ok(d < 3 * house.sizes.flow_layer_gap, `near what it is part of (${Math.round(d)} px)`);
});

test("an open question's choices: one taken leads on as a scenario, one not taken ends in a pill", () => {
  const g = run([item('a'), item('d', 'question', { choices: ['Go', 'Stop'] }), item('e')], [dep('d', 'a'), dep('e', 'd', 'Go')]);
  checks(g);
  const stubs = g.all.filter((n: any) => n.stub);
  assert.deepEqual(stubs.map((n: any) => n.item.title), ['Stop']);
  assert.ok(g.potential.has('e'), 'what follows a choice is a scenario');
  assert.ok(g.chains.find((c: any) => c.b === 'e').dashed);
  assert.equal(g.nodes.get('d').shape, 'diamond');
});

test('a tangle is laid out with few crossings and every wire readable', () => {
  // Two layers fully wired to two, a decision and a join: the shape of a real process.
  const items = ['a', 'b', 'c', 'f', 'g', 'h'].map((id) => item(id)).concat([item('d', 'question', { choices: ['Go', 'Stop', 'Wait'] }), item('e', 'occurrence'), item('s', 'record')]);
  const links = [dep('b', 'a'), dep('c', 'a'), dep('d', 'b'), dep('d', 'c'), dep('e', 'd', 'Go'), dep('f', 'b'), dep('f', 'c'), dep('g', 'b'), dep('g', 'c'), dep('g', 'e'), dep('s', 'f'), dep('h', 's'), dep('h', 'g')];
  const g = run(items, links);
  checks(g);
  assert.ok(g.breaks.length <= 2, `${g.breaks.length} breaks`);
  assert.deepEqual(new Set(g.all.filter((n: any) => !n.dummy).map((n: any) => n.shape)), new Set(['box', 'diamond', 'pill', 'sheet', 'end']));
});

test('a loop in the order is cut where it closes, and the rest still reads from the top down', () => {
  const g = run([item('a'), item('b'), item('c')], [dep('b', 'a'), dep('c', 'b'), dep('a', 'c')]);
  checks(g);
  assert.equal(g.chains.length, 2);
});

test('a large answer is laid out within the budget', () => {
  const n = LARGE * 2;
  const items = Array.from({ length: n }, (_, k) => item(`s${k}`));
  const links = items.slice(1).flatMap((_, k) => [dep(`s${k + 1}`, `s${k}`), ...(k > 2 ? [dep(`s${k + 1}`, `s${k - 3}`)] : [])]);
  const started = performance.now();
  const g = run(items, links);
  assert.ok(performance.now() - started < 3000, 'laid out in under three seconds');
  checks(g);
});

test('two thousand steps in wide layers are laid out in a few seconds', () => {
  // A hundred chains of twenty, some across, all part of one: what the old layout took more than twelve seconds on.
  const items = Array.from({ length: 2000 }, (_, k) => item(`s${k}`));
  const links = items.flatMap((_, k) => [...(k % 20 ? [dep(`s${k}`, `s${k - 1}`)] : []), ...(k > 20 && k % 17 === 0 ? [dep(`s${k}`, `s${k - 17}`)] : [])]);
  const started = performance.now();
  const g = run(items, links);
  const took = performance.now() - started;
  // About 1.3 s alone (26 Oct 2026); the whole suite runs files side by side and slows it twice or three times over, so
  // the bound is set well clear of that and still far under what it guards against.
  assert.ok(took < 8000, `laid out in ${Math.round(took)} ms`);
  assert.equal(g.all.filter((n: any) => !n.dummy).length, 2001);
});

test('nothing to draw is an empty picture', () => {
  const g = layout({ items: [], links: [], measure, sizes: house.sizes });
  assert.equal(g.all.length, 0);
  assert.equal(g.width, 0);
});

test('the item a picture is of is a step like any other, tied to what is part of it', () => {
  const g = run([item('a'), item('b')], [dep('b', 'a')]);
  checks(g);
  assert.ok(g.nodes.has('r'), 'a project that holds the work is a step');
  assert.deepEqual(g.ties.map((t: any) => `${t.a} ${t.b}`).sort(), ['a r', 'b r']);
  const w = run([item('a'), item('b')], [dep('b', 'a'), dep('r', 'b')]);
  assert.ok(w.y.get('r') > w.y.get('b'), 'a release that waits on the work is its last step');
});

test("a flat lens's answer is drawn: every item a step, part_of a tie, depends_on the order, nothing nested", () => {
  const items = [flat('p', { type: 'project' }), flat('a'), flat('b'), flat('c'), flat('d'), flat('q', { kind: 'question' }), flat('t', { kind: 'aim', type: 'tag' })];
  const links = [link('part_of', 'a', 'p'), link('part_of', 'b', 'p'), link('part_of', 'c', 'p'), link('depends_on', 'b', 'a'), link('depends_on', 'c', 'b'), link('link', 'q', 'c'), link('tagged', 'd', 't')];
  const g = layout({ items, links, undrawn: ['tagged'], measure, sizes: house.sizes });
  checks(g);
  assert.deepEqual([...g.nodes.values()].filter((n: any) => !n.dummy).map((n: any) => n.id).sort(), ['a', 'b', 'c', 'd', 'p', 'q', 't'], 'every item a step');
  assert.deepEqual(g.chains.map((c: any) => c.key), ['a b', 'b c'], 'the order');
  assert.deepEqual(g.ties.map((t: any) => `${t.type} ${t.a} ${t.b}`).sort(), ['link q c', 'part_of a p', 'part_of b p', 'part_of c p'], 'every other link a tie, but what the style leaves undrawn');
  assert.ok(g.y.get('a') < g.y.get('b') && g.y.get('b') < g.y.get('c'), 'read from the top down');
});

test("many leaves of one, in no order, wrap under it in a block: its ties one bus, down into each leaf's head", () => {
  const leaves = Array.from({ length: 14 }, (_, k) => item(`l${k}`));
  const g = run(leaves, []);
  checks(g);
  const rows = new Set(leaves.map((l) => g.y.get(l.id)));
  assert.ok(rows.size > 1, 'wrapped');
  assert.ok(Math.min(...rows) > g.y.get('r'), 'under what they are part of');
  assert.equal(new Set(g.ties.map((t: any) => JSON.stringify(t.points.slice(0, 2)))).size, 1, 'the ties leave it at one place, as one bus');
  for (const l of leaves) {
    const t = g.ties.find((t: any) => t.a === l.id), [[x1, y1], [x2, y2]] = t.points.slice(-2);
    assert.ok(x1 === x2 && y1 < y2 && Math.abs(y2 - (g.y.get(l.id) - g.nodes.get(l.id).h / 2)) < 0.5, `${l.id} is come into from above`);
  }
});

test('leaves lean to the shape asked for: down a narrow pane, across a wide one', () => {
  const leaves = Array.from({ length: 13 }, (_, k) => item(`l${k}`, 'question'));
  const at = (aspect: number) => layout({ items: [{ ...item('r'), inside: null }, ...leaves], links: [], measure, sizes: house.sizes, aspect });
  const [narrow, wide] = [at(0.5), at(2)];
  checks(narrow);
  checks(wide);
  const rows = (g: any) => new Set(leaves.map((l) => g.y.get(l.id))).size;
  assert.ok(rows(narrow) > rows(wide), `${rows(narrow)} rows in a narrow pane, ${rows(wide)} in a wide one`);
  assert.ok(narrow.width < narrow.height && wide.width > wide.height, 'taller than wide in a narrow pane, wider than tall in a wide one');
});

test('what is tied to nothing is a step of its own, set apart from the rest', () => {
  const top = (id: string, extra: Record<string, unknown> = {}) => ({ ...item(id), inside: null, ...extra });
  const g = layout({ items: [top('a'), top('b'), top('c'), top('p', { kind: 'actor' })], links: [dep('b', 'a'), { kind: 'waits_on', from: 'b', to: 'p' }], measure, sizes: house.sizes });
  checks(g);
  assert.ok(g.nodes.has('c') && g.nodes.has('p'), 'started on the canvas and not yet wired up, it is drawn; one waited on too');
  assert.ok(g.ties.some((t: any) => t.type === 'waits_on' && t.a === 'b' && t.b === 'p'), 'waits_on is a tie');
});

test('a step put by hand stays exactly where it was put, and the rest is laid out round it without overlapping', () => {
  const items = ['a', 'b', 'c', 'd', 'e'].map((id) => item(id));
  const g = run(items, [dep('b', 'a'), dep('c', 'b'), dep('e', 'd')], { b: [400, 300], d: [60, 60] });
  assert.deepEqual([g.x.get('b'), g.y.get('b')], [400, 300]);
  assert.deepEqual([g.x.get('d'), g.y.get('d')], [60, 60]);
  const steps = g.all.filter((n: any) => !n.dummy);
  for (const p of steps)
    for (const q of steps) if (p !== q) assert.ok(Math.abs(g.x.get(p.id) - g.x.get(q.id)) >= (p.w + q.w) / 2 || Math.abs(g.y.get(p.id) - g.y.get(q.id)) >= (p.h + q.h) / 2, `${p.id} and ${q.id} overlap`);
  // The wires to them solved at right angles, from the foot of one into the head of the other.
  for (const key of ['a b', 'b c', 'd e']) {
    const c = g.chains.find((w: any) => w.key === key);
    assert.ok(c, `${key} is wired`);
    assert.ok(c.points.slice(1).every(([px, py]: number[], k: number) => px === c.points[k][0] || py === c.points[k][1]), `${key} turns square`);
  }
  assert.ok(g.y.get('e') > g.y.get('d'), 'what follows one put by hand is set under it');
});

test('a step put by hand is wired live at right angles, round the steps in the way', async () => {
  // @ts-expect-error: a plain module of the drawing, with no types of its own.
  const { route, placesOf, tieLine } = await import('./draw/flow/free.js');
  const square = (pts: number[][]) => pts.slice(1).every(([x, y], k) => x === pts[k][0] || y === pts[k][1]);
  const a = { x: 100, y: 50, w: 120, h: 34 }, b = { x: 400, y: 300, w: 120, h: 34 };
  const straight = route(a, b, 12);
  assert.ok(square(straight) && straight[0][1] === 67 && straight.at(-1)[1] === 283, 'from the foot of one to the head of the other, every turn square');
  // A step right across the middle track: the wire takes another.
  const block = { x: 250, y: 175, w: 600, h: 20 };
  const round = route(a, b, 12, [block]);
  const through = (pts: number[][]) => pts.slice(1).some(([x, y], k) => Math.max(y, pts[k][1]) > block.y - block.h / 2 && Math.min(y, pts[k][1]) < block.y + block.h / 2 && Math.max(x, pts[k][0]) > block.x - block.w / 2 && Math.min(x, pts[k][0]) < block.x + block.w / 2 && x !== pts[k][0]);
  assert.ok(square(round) && !through(round), 'its track across misses the step in the way');
  // Not below: out and round, still square, still into the head from above.
  const up = route(b, a, 12);
  assert.ok(square(up) && up.at(-2)[1] < a.y - a.h / 2, 'into the head of one above it, from above');
  // A tie leaves the edge of one toward the other.
  assert.deepEqual(tieLine({ x: 0, y: 0, w: 20, h: 10 }, { x: 100, y: 0, w: 20, h: 10 }), [[10, 0], [90, 0]]);
  assert.deepEqual(placesOf({ lens: { from: 'p' } }, { placed: { x: [1, 2], z: [0, 0] }, moved: { z: [5, 6] } }), { x: [1, 2], z: [5, 6] }, "this canvas's places, as the page read them, with what was moved over them");
  assert.deepEqual(placesOf({ lens: {} }, {}), {}, 'nothing placed: the drawing lays every step');
});

test('a large map wraps its wide layers into rows: it comes out about the page\'s shape, not one band', () => {
  // Twenty projects, each with nine parts: one cluster of two hundred steps, every layer far wider than tall.
  const items = [flat('top')];
  const links = [];
  for (let p = 0; p < 20; p++) {
    items.push(flat(`p${p}`));
    links.push(link('part_of', `p${p}`, 'top'));
    for (let k = 0; k < 9; k++) (items.push(flat(`p${p}.${k}`)), links.push(link('part_of', `p${p}.${k}`, `p${p}`)));
  }
  assert.ok(items.length > LARGE);
  const g = layout({ items, links, measure, sizes: house.sizes });
  assert.ok(g.width / g.height < 4, `${Math.round(g.width)} wide by ${Math.round(g.height)} tall`);
  assert.ok(g.y.get('p0.0') > g.y.get('p0') && g.y.get('p0') > g.y.get('top'), 'what is part of something still sits under it');
});
