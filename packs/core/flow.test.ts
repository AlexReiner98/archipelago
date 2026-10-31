// The flow drawing's layout (draw/flow/layout.js): a lens answer in, a flat graph out, checked for what a reader of the
// drawing relies on: every item a step and none inside another, no two steps overlap, every wire turns only at right
// angles and comes straight into its head, no two share a line, wires cross only where they must, part_of keeps its ends
// near, a step put by hand stays where it was put, and a huge map is drawn in a few seconds at about the page's shape.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
// @ts-expect-error: a plain module of the drawing, with no types of its own.
import { count } from './draw/flow/count.js';
// @ts-expect-error: a plain module of the drawing, with no types of its own.
import { layout } from './draw/flow/layout.js';

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

/**
 * What `f` answers, and the milliseconds of work it took: this process's CPU time, not the clock's. The whole suite
 * runs files side by side, which slows the clock two or three times over and leaves the work as it was.
 */
function timed<T>(f: () => T): [T, number] {
  const before = process.cpuUsage();
  const answer = f();
  const { user, system } = process.cpuUsage(before);
  return [answer, (user + system) / 1000];
}

const wires = (g: any) => [...g.chains, ...g.ties].map((w: any) => w.points);
/** What is drawn from `items` with nothing above them: `run` puts one item over all the rest. */
const alone = (items: any[], links: any[], extra: Record<string, unknown> = {}) => layout({ items: items.map((i) => ({ ...i, inside: null })), links, measure, sizes: house.sizes, ...extra });

function checks(g: any) {
  const steps = g.all;
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
    // Straight into the head.
    const [[x1, y1], [x2, y2]] = pts.slice(-2);
    assert.ok(Math.abs(x1 - x2) < 0.01 || Math.abs(y1 - y2) < 0.01, `${c.key} comes into its head at a slant`);
  }
  // Every tie is routed as a wire is: at right angles, from one of its steps to the other.
  for (const t of g.ties) {
    assert.ok(t.points.length >= 2, `${t.a} ${t.b} is drawn`);
    for (let k = 1; k < t.points.length; k++) assert.ok(Math.abs(t.points[k][0] - t.points[k - 1][0]) < 0.01 || Math.abs(t.points[k][1] - t.points[k - 1][1]) < 0.01, `${t.a} ${t.b} turns at a slant`);
  }
}

test('a chain is a straight line down, with nothing crossing', () => {
  const g = alone([item('a'), item('b'), item('c')], [dep('b', 'a'), dep('c', 'b')]);
  checks(g);
  assert.equal(count(wires(g)).crossings, 0);
  assert.deepEqual(['a', 'b', 'c'].map((id) => g.y.get(id)).sort((p, q) => p - q), ['a', 'b', 'c'].map((id) => g.y.get(id)));
  assert.equal(new Set(g.chains.flatMap((c: any) => c.points.map((p: number[]) => p[0]))).size, 1, 'the wires drop without a turn');
  // With what it is part of tied to each step, each wire still drops without a turn.
  const held = run([item('a'), item('b'), item('c')], [dep('b', 'a'), dep('c', 'b')]);
  checks(held);
  assert.equal(count(wires(held)).crossings, 0);
  assert.ok(held.chains.every((c: any) => c.points.length === 2 && c.points[0][0] === c.points[1][0]), 'each wire one straight drop');
});

test('a wire between two boxes is long enough to show its head', { todo: 'solve.js: boxes joined by one straight wire stand gap / 2 apart, 8 px, under the 9 px head' }, () => {
  const g = alone([item('a'), item('b'), item('c')], [dep('b', 'a'), dep('c', 'b')]);
  for (const c of g.chains) assert.ok(Math.abs(c.points.at(-1)[1] - c.points.at(-2)[1]) >= house.sizes.flow_head_length, `${c.key} is ${Math.abs(c.points.at(-1)[1] - c.points.at(-2)[1])} long`);
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
  assert.ok(count(wires(g)).crossings <= 2, `${count(wires(g)).crossings} crossings`);
  assert.equal(count(wires(g)).shared, 0, 'no two wires share a line');
  assert.deepEqual(new Set(g.all.map((n: any) => n.shape)), new Set(['box', 'diamond', 'pill', 'sheet', 'end']));
});

test('a loop in the order is cut where it closes, and the rest still reads from the top down', () => {
  const g = run([item('a'), item('b'), item('c')], [dep('b', 'a'), dep('c', 'b'), dep('a', 'c')]);
  checks(g);
  assert.equal(g.chains.length, 2);
});

test('a large answer is laid out within the budget', () => {
  const n = 60 * 2;
  const items = Array.from({ length: n }, (_, k) => item(`s${k}`));
  const links = items.slice(1).flatMap((_, k) => [dep(`s${k + 1}`, `s${k}`), ...(k > 2 ? [dep(`s${k + 1}`, `s${k - 3}`)] : [])]);
  const [g, took] = timed(() => run(items, links));
  assert.ok(took < 3000, `laid out in ${Math.round(took)} ms of work`);
  checks(g);
});

/** `n` steps in chains of `long`, some across: a part in itself when `hub` is false, all part of one when it is true. */
function chains(n: number, long: number, hub: boolean) {
  const items = Array.from({ length: n }, (_, k) => item(`s${k}`));
  const links = items.flatMap((_, k) => [...(k % long ? [dep(`s${k}`, `s${k - 1}`)] : []), ...(k > long && k % 17 === 0 ? [dep(`s${k}`, `s${k - 17}`)] : [])]);
  return hub ? run(items, links) : alone(items, links);
}

test('two thousand steps in wide layers are laid out in a few seconds', () => {
  // A hundred chains of twenty, some across, all part of one: planarity tested link by link took minutes on this.
  const [g, took] = timed(() => chains(2000, 20, true));
  // About 4 s of work, counting the collector's threads (30 Oct 2026). Counted as work, not by the clock, it is not slowed
  // by the shards run beside it, and the page's twelve seconds is far over the bound.
  assert.ok(took < 8000, `laid out in ${Math.round(took)} ms of work`);
  assert.equal(g.all.length, 2001);
  // One box holds two thousand wires, each on its own line, so it sets the width and cannot be cut.
  assert.ok(g.width / g.height < 4, `${Math.round(g.width)} wide by ${Math.round(g.height)} tall`);
});

test('a big part far taller than the page stands in columns: about the shape asked for, and nothing crossed for it', () => {
  // Chains with some across all the way down make one section: alone it comes out a strip tens of thousands tall.
  const [g, took] = timed(() => chains(2000, 2000, false));
  assert.ok(took < 8000, `laid out in ${Math.round(took)} ms of work`);
  assert.equal(g.all.length, 2000);
  checks(g);
  const shape = g.width / g.height;
  assert.ok(shape > 0.8 && shape < 3.2, `${Math.round(g.width)} wide by ${Math.round(g.height)} tall`);
  const crossed = count(wires(g));
  assert.equal(crossed.crossings, 0, 'the wrap crosses nothing');
  assert.equal(crossed.shared, 0, 'and each wire over a cut has a track of its own');
});

test('a short picture keeps to its column, however tall', () => {
  const steps = Array.from({ length: 30 }, (_, k) => item(`s${k}`));
  const g = alone(steps, steps.slice(1).map((_, k) => dep(`s${k + 1}`, `s${k}`)));
  assert.equal(new Set(steps.map((s) => g.x.get(s.id))).size, 1, 'a chain of thirty reads straight down');
});

test('a chain too long to fold into a comb is drawn', () => {
  const steps = Array.from({ length: 1500 }, (_, k) => item(`s${k}`));
  const g = alone(steps, steps.slice(1).map((_, k) => dep(`s${k + 1}`, `s${k}`)));
  assert.equal(g.all.length, 1500);
  assert.equal(count(wires(g)).crossings, 0);
});

test('nothing to draw is an empty picture', () => {
  const g = layout({ items: [], links: [], measure, sizes: house.sizes });
  assert.equal(g.all.length, 0);
  assert.ok(g.width <= house.sizes.flow_margin, 'nothing but the margin');
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
  assert.deepEqual([...g.nodes.values()].map((n: any) => n.id).sort(), ['a', 'b', 'c', 'd', 'p', 'q', 't'], 'every item a step');
  assert.deepEqual(g.chains.map((c: any) => c.key), ['a b', 'b c'], 'the order');
  assert.deepEqual(g.ties.map((t: any) => `${t.type} ${t.a} ${t.b}`).sort(), ['link q c', 'part_of a p', 'part_of b p', 'part_of c p'], 'every other link a tie, but what the style leaves undrawn');
  assert.ok(g.y.get('a') < g.y.get('b') && g.y.get('b') < g.y.get('c'), 'read from the top down');
});

test('many leaves of one, in no order, fold beside it, each tie a line of its own and none crossing', () => {
  const leaves = Array.from({ length: 14 }, (_, k) => item(`l${k}`));
  const g = run(leaves, []);
  checks(g);
  assert.ok(g.height < leaves.length * (g.nodes.get('l0').h + house.sizes.flow_node_gap), 'folded, not one long column');
  assert.equal(count(wires(g)).crossings, 0);
  assert.equal(count(wires(g)).shared, 0, 'no two ties share a line');
  for (const l of leaves) {
    const t = g.ties.find((t: any) => t.a === l.id), [x, y] = t.points[0], n = g.nodes.get(l.id);
    assert.ok(Math.abs(x - g.x.get(l.id)) <= n.w / 2 + 0.5 && Math.abs(y - g.y.get(l.id)) <= n.h / 2 + 0.5, `${l.id}'s tie ends on it`);
  }
});

test('leaves lean to the shape asked for: down a narrow pane, across a wide one', () => {
  const leaves = Array.from({ length: 13 }, (_, k) => item(`l${k}`, 'question'));
  const at = (aspect: number) => layout({ items: [{ ...item('r'), inside: null }, ...leaves], links: [], measure, sizes: house.sizes, aspect });
  const [narrow, wide] = [at(0.5), at(2)];
  checks(narrow);
  checks(wide);
  assert.ok(narrow.width / narrow.height < wide.width / wide.height, `${Math.round(narrow.width)} by ${Math.round(narrow.height)} in a narrow pane, ${Math.round(wide.width)} by ${Math.round(wide.height)} in a wide one`);
  assert.ok(narrow.width < narrow.height && wide.width > wide.height, 'taller than wide in a narrow pane, wider than tall in a wide one');
});

test('what is tied to nothing is a step of its own, set apart from the rest', () => {
  const top = (id: string, extra: Record<string, unknown> = {}) => ({ ...item(id), inside: null, ...extra });
  const g = layout({ items: [top('a'), top('b'), top('c'), top('p', { kind: 'actor' })], links: [dep('b', 'a'), { kind: 'waits_on', from: 'b', to: 'p' }], measure, sizes: house.sizes });
  checks(g);
  assert.ok(g.nodes.has('c') && g.nodes.has('p'), 'started on the canvas and not yet wired up, it is drawn; one waited on too');
  assert.ok(g.ties.some((t: any) => t.type === 'waits_on' && t.a === 'b' && t.b === 'p'), 'waits_on is a tie');
});

test('a step put by hand stays exactly where it was put, and nothing overlaps', () => {
  const items = ['a', 'b', 'c', 'd', 'e'].map((id) => item(id)), links = [dep('b', 'a'), dep('c', 'b'), dep('e', 'd')], free = run(items, links);
  const to = { b: [free.width + 200, free.height + 200], d: [free.width + 600, free.height + 200] };
  const g = run(items, links, to);
  for (const [id, [px, py]] of Object.entries(to)) assert.ok(Math.abs(g.x.get(id) - px) < 1e-6 && Math.abs(g.y.get(id) - py) < 1e-6, `${id} stays where it was put`);
  const steps = g.all;
  for (const p of steps)
    for (const q of steps) if (p !== q) assert.ok(Math.abs(g.x.get(p.id) - g.x.get(q.id)) >= (p.w + q.w) / 2 || Math.abs(g.y.get(p.id) - g.y.get(q.id)) >= (p.h + q.h) / 2, `${p.id} and ${q.id} overlap`);
  // The wires to them solved at right angles, from the foot of one into the head of the other.
  for (const key of ['a b', 'b c', 'd e']) {
    const c = g.chains.find((w: any) => w.key === key);
    assert.ok(c, `${key} is wired`);
    assert.ok(c.points.slice(1).every(([px, py]: number[], k: number) => px === c.points[k][0] || py === c.points[k][1]), `${key} turns square`);
  }
  assert.deepEqual([g.x.get('r'), g.y.get('r')], [free.x.get('r'), free.y.get('r')], 'what was not moved stays where it was');
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
  assert.ok(items.length > 60);
  const g = layout({ items, links, measure, sizes: house.sizes });
  assert.ok(g.width / g.height < 4, `${Math.round(g.width)} wide by ${Math.round(g.height)} tall`);
  assert.ok(g.y.get('p0') > g.y.get('top') && g.y.get('p7') > g.y.get('top'), 'what is part of something sits under it');
  assert.ok(Math.abs(g.y.get('p0.0') - g.y.get('p0')) < g.height / 2, 'and keeps near it');
});
