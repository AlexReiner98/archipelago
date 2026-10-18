// The flow shape's layout (ui/flow-layout.js): a lens answer in, geometry out, checked for what a reader of the
// drawing relies on: no two steps overlap, every wire turns only at right angles and runs straight into its head,
// and wires cross only where they must.

import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error: a plain module of the UI, with no types of its own.
import { layout, LARGE } from '../ui/flow-layout.js';

const state = { blocked: false, waits_on: [], sessions: 0 };
const item = (id: string, kind = 'work', extra: Record<string, unknown> = {}) => ({ id, kind, inside: 'r', title: `Step ${id}`, place: 0, open: true, status: 'todo', state, ...extra });
/** b depends on a: a leads to b. */
const dep = (b: string, a: string, says?: string) => ({ kind: 'depends_on', from: b, to: a, ...(says && { says }) });
const measure = (text: string, px: number) => text.length * px * 0.55;
const run = (items: any[], links: any[]) => layout({ items: [{ ...item('r', 'aim'), inside: null }, ...items], links, rootId: 'r', measure });

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

test('work about a step, wired to nothing, is a mark on it', () => {
  const g = run([item('a'), item('b'), item('n', 'work', { inside: 'a' })], [dep('b', 'a')]);
  assert.equal(g.nodes.has('n'), false);
  assert.deepEqual(g.nodes.get('a').notes.map((i: any) => i.id), ['n']);
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

test('a large answer is laid out within the budget', () => {
  const n = LARGE * 2;
  const items = Array.from({ length: n }, (_, k) => item(`s${k}`));
  const links = items.slice(1).flatMap((_, k) => [dep(`s${k + 1}`, `s${k}`), ...(k > 2 ? [dep(`s${k + 1}`, `s${k - 3}`)] : [])]);
  const started = performance.now();
  const g = run(items, links);
  assert.ok(performance.now() - started < 3000, 'laid out in under three seconds');
  checks(g);
});

test('nothing to draw is an empty picture', () => {
  const g = run([], []);
  assert.equal(g.all.length, 0);
  assert.equal(g.width, 0);
});

test('the item a picture is of is a step when it waits on the others, and only then', () => {
  const g = run([item('a'), item('b')], [dep('b', 'a'), dep('r', 'b')]);
  checks(g);
  assert.ok(g.nodes.has('r'), 'a release that waits on the work is its last step');
  assert.ok(g.y.get('r') > g.y.get('b'));
  assert.equal(run([item('a'), item('b')], [dep('b', 'a')]).nodes.has('r'), false, 'a project that holds the work is not');
});
