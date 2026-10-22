// The architecture drawing's layout (draw/architecture/layout.js): a lens answer in, geometry out, checked for what a reader of
// the drawing relies on: a caller above what it calls, no two parts overlap, no part sits in another place's box,
// every wire turns only at right angles, and health and wire states are read from statuses and links alone.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
// @ts-expect-error: a plain module of the UI, with no types of its own.
import { health, layout, wireState } from './draw/architecture/layout.js';
// @ts-expect-error: a plain module of the drawing, with no types of its own.
import { picture } from './draw/architecture/index.js';

const state = { blocked: false, waits_on: [], sessions: 0 };
const item = (id: string, inside = 'r', status = 'up', extra: Record<string, unknown> = {}) => ({ id, kind: 'place', inside, title: `Part ${id}`, place: 0, open: status !== 'retired', status, state, ...extra });
/** a calls b. */
const call = (a: string, b: string, extra: Record<string, unknown> = {}) => ({ kind: 'depends_on', from: a, to: b, ...extra });
const measure = (text: string, px: number) => text.length * px * 0.55;
// Laid out by the house style's lengths, as the page lays it out (packs/core/pack.json).
const house = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8')).styles.find((s: any) => s.id === 'core.house').props;
const run = (items: any[], links: any[]) => layout({ items: [{ ...item('r'), inside: null }, ...items], links, rootId: 'r', measure, sizes: house.sizes });

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
  const idle = item('s', 'r', 'standby');
  assert.equal(health(idle), 'standby');
  assert.equal(wireState({}, up, idle), 'standby', 'a wire to a part stopped on purpose is quiet, not owed');
  assert.equal(wireState({}, planned, idle), 'planned');
});

test('a larger system lays out with nothing overlapping', () => {
  const places = ['p0', 'p1', 'p2', 'p3'];
  const items = [...places.map((p) => item(p)), ...Array.from({ length: 24 }, (_, k) => item(`n${k}`, places[k % 4], k % 5 ? 'up' : 'planned'))];
  const links = Array.from({ length: 30 }, (_, k) => call(`n${k % 24}`, `n${(k * 7 + 3) % 24}`)).filter((l) => l.from !== l.to);
  checks(run(items, links));
});

// The drawing itself (draw/architecture/index.js): an answer in, marks out, as the page is sent them.

const answerOf = (items: any[], links: any[]) => ({ lens: { from: 'r' }, items: [{ ...item('r'), inside: null }, ...items].map((i) => ({ ...i, within: { items: 0, blocked: 0, needs_you: 0 } })), links });
const drawn = (answer: any, extra: Record<string, unknown> = {}) => picture({ answer, style: { ...house, shape: 'architecture', ...extra } }, { measure });
/** Every mark in a mark, itself first. */
const marks = (m: any): any[] => (Array.isArray(m) && typeof m[0] === 'string' ? [m, ...m.slice(2).flatMap(marks)] : []);

test('the drawing answers with marks only: tags, attributes and words, nothing that runs', () => {
  const { scene } = drawn(answerOf([item('a'), item('b')], [call('a', 'b', { says: 'HTTPS' })]));
  const all = [scene.svg, scene.legend, scene.bar].flatMap(marks);
  assert.ok(all.length > 20);
  for (const [tag, attrs, ...kids] of all) {
    assert.match(tag, /^[a-zA-Z]+$/);
    for (const [name, value] of Object.entries(attrs)) {
      assert.ok(!name.startsWith('on') || name === 'on', `${tag} has ${name}`);
      if (name === 'href') assert.match(String(value), /^#\/e\/[a-z0-9_]+$/);
    }
    for (const kid of kids) assert.ok(typeof kid === 'string' || Array.isArray(kid));
  }
  assert.equal(typeof scene.css, 'string');
  assert.deepEqual(Object.keys(scene.size), ['width', 'height']);
});

test('hovering a part lights its wires, leaving puts them out, and the lit switch dims by key', () => {
  const { scene, on, restyle } = drawn(answerOf([item('a'), item('b'), item('c', 'r', 'up', { state: { ...state, needs_you: false, blocked: true } })], [call('a', 'b'), call('b', 'c')]));
  const keyed = new Map([scene.svg].flatMap(marks).filter((m) => m[1].key).map((m) => [m[1].key, m]));
  const lit = (list: any[]) => list.filter((p) => p.toggle.lit).map((p) => p.key).sort();
  assert.deepEqual(lit(on({ name: 'enter', key: 'p:a' })), ['h:0', 'w:0']);
  assert.deepEqual(lit(on({ name: 'enter', key: 'p:b' })), ['h:0', 'h:1', 'w:0', 'w:1']);
  assert.deepEqual(lit(on({ name: 'leave', key: 'p:b' })), []);
  for (const p of on({ name: 'enter', key: 'p:a' })) assert.ok(keyed.has(p.key), `${p.key} is a mark`);
  const dimmed = restyle({ ...house, lit: 'blocked' }).filter((p: any) => p.toggle.dim).map((p: any) => p.key);
  assert.deepEqual(dimmed.sort(), ['p:a', 'p:b']);
});

test('a system with no parts says so instead of drawing', () => {
  assert.deepEqual(drawn(answerOf([], [])).scene, { message: 'Nothing here is part of a system.' });
});

test('the drawing imports only its own modules, and nothing of the kernel', () => {
  const pack = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8'));
  const d = pack.drawings.find((one: any) => one.id === 'core.architecture');
  for (const file of Object.values(d.modules) as string[]) {
    const code = readFileSync(join(import.meta.dirname, file), 'utf8');
    for (const [, spec] of code.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g)) assert.ok(Object.keys(d.modules).includes(spec.replace(/^\.\//, '')), `${file} imports ${spec}`);
  }
});
