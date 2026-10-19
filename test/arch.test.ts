// The architecture shape's layout (ui/arch-layout.js): a lens answer in, geometry out, checked for what a reader of
// the drawing relies on: a caller above what it calls, no two parts overlap, no part sits in another place's box,
// every wire turns only at right angles, and health and wire states are read from statuses and links alone.

import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error: a plain module of the UI, with no types of its own.
import { health, layout, wireState } from '../ui/arch-layout.js';

const state = { blocked: false, waits_on: [], sessions: 0 };
const item = (id: string, inside = 'r', status = 'up', extra: Record<string, unknown> = {}) => ({ id, kind: 'place', inside, title: `Part ${id}`, place: 0, open: status !== 'retired', status, state, ...extra });
/** a calls b. */
const call = (a: string, b: string, extra: Record<string, unknown> = {}) => ({ kind: 'depends_on', from: a, to: b, ...extra });
const measure = (text: string, px: number) => text.length * px * 0.55;
const run = (items: any[], links: any[]) => layout({ items: [{ ...item('r'), inside: null }, ...items], links, rootId: 'r', measure });

function checks(g: any) {
  const parts = g.all.filter((n: any) => !n.dummy);
  for (const a of parts)
    for (const b of parts) {
      if (a === b) continue;
      const apart = Math.abs(g.x.get(a.id) - g.x.get(b.id)) >= (a.w + b.w) / 2 || Math.abs(g.y.get(a.id) - g.y.get(b.id)) >= (a.h + b.h) / 2;
      assert.ok(apart, `${a.id} and ${b.id} overlap`);
    }
  // A part is inside its own place's box and no other's.
  for (const n of parts)
    for (const box of g.boxes) {
      const X = g.x.get(n.id), Y = g.y.get(n.id);
      const within = X - n.w / 2 >= box.x && X + n.w / 2 <= box.x + box.w && Y - n.h / 2 >= box.y && Y + n.h / 2 <= box.y + box.h;
      const overlaps = X + n.w / 2 > box.x && X - n.w / 2 < box.x + box.w && Y + n.h / 2 > box.y && Y - n.h / 2 < box.y + box.h;
      if (n.col === box.id) assert.ok(within, `${n.id} is outside its place ${box.id}`);
      else assert.ok(!overlaps, `${n.id} sits in ${box.id}, which is not its place`);
    }
  // No two boxes overlap.
  for (const p of g.boxes) for (const q of g.boxes) if (p !== q) assert.ok(p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y, `${p.id} and ${q.id} overlap`);
  for (const c of g.chains) {
    const pts = c.points;
    for (let k = 1; k < pts.length; k++) assert.ok(Math.abs(pts[k][0] - pts[k - 1][0]) < 0.01 || Math.abs(pts[k][1] - pts[k - 1][1]) < 0.01, `${c.key} turns at a slant`);
    const [[x1, y1], [x2, y2]] = pts.slice(-2);
    assert.ok(Math.abs(x1 - x2) < 0.01 && y2 - y1 >= 20 - 0.01, `${c.key} runs ${y2 - y1} px into its head`);
  }
}

test('a request falls down the page: each part above what it calls', () => {
  const g = run([item('edge'), item('app'), item('db', 'r', 'up', { role: 'data' })], [call('edge', 'app'), call('app', 'db', { says: 'SQL' })]);
  checks(g);
  assert.ok(g.y.get('edge') < g.y.get('app') && g.y.get('app') < g.y.get('db'));
  assert.equal(g.nodes.get('db').shape, 'store', 'a store is a cylinder');
  assert.equal(g.chains.find((c: any) => c.b === 'db').says, 'SQL');
});

test('each place is a box around its own parts, and none sits in another', () => {
  const g = run(
    [item('vps'), item('cloud'), item('user', 'r', 'up', { role: 'client' }), item('proxy', 'vps'), item('app', 'vps'), item('pg', 'vps', 'up', { role: 'data' }), item('llm', 'vps'), item('model', 'cloud'), item('kuma', 'vps')],
    [call('user', 'proxy'), call('proxy', 'app'), call('app', 'pg'), call('app', 'llm'), call('llm', 'model'), call('kuma', 'proxy')],
  );
  checks(g);
  assert.deepEqual(g.boxes.map((b: any) => b.id).sort(), ['cloud', 'vps']);
  assert.equal(g.nodes.has('vps'), false, 'a place is a box, not a part');
  assert.equal(g.nodes.get('user').col, null, 'what no place holds is drawn outside every box');
  assert.equal(g.nodes.get('user').shape, 'pill');
});

test('a wire that passes layers falls in the place it goes to, and a loop still reads down', () => {
  const g = run([item('a'), item('b'), item('c'), item('d', 'p'), item('p')], [call('a', 'b'), call('b', 'c'), call('c', 'd'), call('d', 'a')]);
  checks(g);
  assert.ok(g.chains.some((c: any) => c.back), 'one wire of the loop is turned back');
});

test('what sits in a part, wired to nothing, is a mark on it', () => {
  const g = run([item('a'), item('b'), { ...item('t', 'a', 'todo'), kind: 'work' }], [call('a', 'b')]);
  assert.equal(g.nodes.has('t'), false);
  assert.deepEqual(g.nodes.get('a').notes.map((i: any) => i.id), ['t']);
});

test('health is read from the status word, and a wire from its own state or else its ends', () => {
  assert.equal(health(item('x', 'r', 'up')), 'ok');
  assert.equal(health(item('x', 'r', 'degraded')), 'warn');
  assert.equal(health(item('x', 'r', 'down')), 'down');
  assert.equal(health(item('x', 'r', 'wiring')), 'building');
  assert.equal(health(item('x', 'r', 'planned')), 'planned');
  assert.equal(health(item('x', 'r', 'retired')), 'gone');
  assert.equal(health(item('x', 'r', 'available')), 'ok', 'a connection that answers is up');
  const [up, down, planned] = [item('u'), item('d', 'r', 'down'), item('p', 'r', 'planned')];
  assert.equal(wireState({}, up, up), 'wired');
  assert.equal(wireState({}, up, planned), 'planned');
  assert.equal(wireState({}, up, down), 'broken');
  assert.equal(wireState({ state: 'planned' }, up, up), 'planned', 'two parts up need not be wired to each other yet');
  assert.equal(wireState({ state: 'nonsense' }, up, up), 'wired');
});

test('a larger system lays out with nothing overlapping', () => {
  const places = ['p0', 'p1', 'p2', 'p3'];
  const items = [...places.map((p) => item(p)), ...Array.from({ length: 24 }, (_, k) => item(`n${k}`, places[k % 4], k % 5 ? 'up' : 'planned'))];
  const links = Array.from({ length: 30 }, (_, k) => call(`n${k % 24}`, `n${(k * 7 + 3) % 24}`)).filter((l) => l.from !== l.to);
  checks(run(items, links));
});
