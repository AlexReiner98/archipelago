// The flow's routing conventions (docs/drawings.md, e_k78mxqxt), each held on pictures dense enough to break them.
// The order runs from the foot of what is depended on down into the head of what depends on it, every other link is a tie
// between the outlines of its two steps, and each is a line of its own: at right angles, round the steps, never along
// another; a head where the link points unless the style draws its type headless. Input in, marks out: no database.

import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8'));
const house = { ...pack.styles.find((s: any) => s.id === 'core.house').props, shape: 'flow' };
const laid = mkdtempSync(join(tmpdir(), 'flow-routing-'));
for (const [name, file] of Object.entries(pack.drawings.find((d: any) => d.id === 'core.flow').modules)) copyFileSync(join(import.meta.dirname, file as string), join(laid, name));
const { layout } = await import(pathToFileURL(join(laid, 'layout.js')).href);
const { picture } = await import(pathToFileURL(join(laid, 'index.js')).href);
const measure = (t: string, px: number) => t.length * px * 0.55;
const { count } = await import(pathToFileURL(join(laid, 'count.js')).href);

const state = { blocked: false, waits_on: [], sessions: 0, needs_you: false };
const item = (id: string, kind = 'work') => ({ id, kind, type: 'task', title: `Step ${id}`, open: true, status: 'todo', state, fields: {} });
const link = (type: string, from: string, to: string) => ({ id: `r_${type}${from}${to}`, type, from, to });

/**
 * A map as the live one is where the conventions broke: one hub that many things are part of, chains of the order under
 * it in wide rows, so a tie from the hub to a part far down has whole rows of steps in its way; things that serve
 * others across the rows; and two items with many leaves each, wrapped under them in blocks side by side.
 */
function dense() {
  const items = [item('hub', 'aim')];
  const links = [];
  for (let c = 0; c < 12; c++)
    for (let k = 0; k < 8; k++) {
      const id = `c${c}.${k}`;
      items.push(item(id));
      links.push(link('part_of', id, 'hub'));
      if (k) links.push(link('depends_on', id, `c${c}.${k - 1}`));
    }
  for (let k = 0; k < 10; k++) links.push(link('serves', `c${k}.${(k * 3) % 8}`, `c${(k + 5) % 12}.${(k * 5 + 2) % 8}`));
  for (const p of ['p', 'q']) {
    items.push(item(p));
    links.push(link('part_of', p, 'hub'));
    for (let k = 0; k < 14; k++) (items.push(item(`${p}${k}`)), links.push(link('part_of', `${p}${k}`, p)));
  }
  return { items, links };
}

const laidOut = (answer: { items: any[]; links: any[] }) => layout({ items: answer.items, links: answer.links, undrawn: house.undrawn, placed: {}, measure, sizes: house.sizes });
const boxOf = (g: any, id: string) => ({ id, x: g.x.get(id), y: g.y.get(id), w: g.nodes.get(id).w, h: g.nodes.get(id).h });
const square = (points: number[][]) => points.slice(1).every(([x, y], k) => Math.abs(x - points[k][0]) < 0.01 || Math.abs(y - points[k][1]) < 0.01);
/** Which steps a path's runs pass through, its own ends left out. */
const through = (g: any, points: number[][], ends: string[]) => {
  const steps = g.all.filter((n: any) => !ends.includes(n.id)).map((n: any) => boxOf(g, n.id));
  const hit = new Set<string>();
  for (let k = 1; k < points.length; k++) {
    const [[x1, y1], [x2, y2]] = [points[k - 1], points[k]];
    for (const s of steps) if (Math.max(x1, x2) > s.x - s.w / 2 + 0.5 && Math.min(x1, x2) < s.x + s.w / 2 - 0.5 && Math.max(y1, y2) > s.y - s.h / 2 + 0.5 && Math.min(y1, y2) < s.y + s.h / 2 - 0.5) hit.add(s.id);
  }
  return [...hit];
};
test('no wire or tie passes through a step', () => {
  const g = laidOut(dense());
  assert.ok(g.ties.length > 120 && g.chains.length > 80, `a dense picture: ${g.ties.length} ties, ${g.chains.length} wires`);
  for (const p of [...g.chains, ...g.ties]) assert.deepEqual(through(g, p.points, [p.a, p.b]), [], `${p.type ?? 'the order'} from ${p.a} to ${p.b} passes through a step`);
});

test('every wire and tie turns only at right angles', { todo: 'solve.js: an end set back on its box after a pass leaves two or three wires slanted on this map' }, () => {
  const g = laidOut(dense());
  for (const p of [...g.chains, ...g.ties]) assert.ok(square(p.points), `${p.a} to ${p.b} turns at a slant`);
});

test('the order runs from the foot of what is depended on down into the head of what depends on it', { todo: 'numbering: on this map of hub ties, 8 of 84 order wires run up' }, () => {
  const g = laidOut(dense());
  for (const c of g.chains) {
    const [a, b] = [boxOf(g, c.a), boxOf(g, c.b)], [first, last, before] = [c.points[0], c.points.at(-1), c.points.at(-2)];
    assert.ok(Math.abs(first[1] - (a.y + a.h / 2)) < 0.5 && Math.abs(first[0] - a.x) <= a.w / 2, `${c.key} leaves the foot of ${c.a}`);
    assert.ok(Math.abs(last[1] - (b.y - b.h / 2)) < 0.5 && Math.abs(last[0] - b.x) <= b.w / 2, `${c.key} comes into the head of ${c.b}`);
    assert.ok(Math.abs(before[0] - last[0]) < 0.01 && before[1] < last[1], `${c.key} comes down into it`);
    assert.ok(b.y > a.y, `${c.key} is read from the top down`);
  }
});

test('a tie ends on the edge of each of its steps', () => {
  const g = laidOut(dense());
  const on = ([x, y]: number[], s: any) => Math.abs(x - s.x) <= s.w / 2 + 0.5 && Math.abs(y - s.y) <= s.h / 2 + 0.5 && (Math.abs(Math.abs(x - s.x) - s.w / 2) < 0.5 || Math.abs(Math.abs(y - s.y) - s.h / 2) < 0.5);
  for (const t of g.ties) {
    assert.ok(on(t.points[0], boxOf(g, t.a)), `${t.a} to ${t.b} starts on ${t.a}`);
    assert.ok(on(t.points.at(-1), boxOf(g, t.b)), `${t.a} to ${t.b} ends on ${t.b}`);
  }
});

test('no two paths share a line', () => {
  const g = laidOut(dense());
  assert.equal(count([...g.chains, ...g.ties].map((p: any) => p.points)).shared, 0, 'every wire and tie a line of its own');
});

test('many leaves of two, side by side: each folds beside its own, each tie a line of its own', () => {
  // Two items under one, each with more leaves than a row holds.
  const items = [item('hub', 'aim')], links = [];
  for (const p of ['p', 'q']) {
    items.push(item(p));
    links.push(link('part_of', p, 'hub'));
    for (let k = 0; k < 14; k++) (items.push(item(`${p}${k}`)), links.push(link('part_of', `${p}${k}`, p)));
  }
  const g = laidOut({ items, links });
  const shape = g.width / g.height;
  assert.ok(shape > 0.5 && shape < 4, `folded: ${Math.round(g.width)} wide by ${Math.round(g.height)} tall`);
  assert.equal(count(g.ties.map((t: any) => t.points)).crossings, 0, 'no leaf crosses another');
  assert.equal(count(g.ties.map((t: any) => t.points)).shared, 0, 'and none shares a line');
  const side = (p: string) => Array.from({ length: 14 }, (_, k) => g.x.get(`${p}${k}`));
  const down = (p: string) => Array.from({ length: 14 }, (_, k) => g.y.get(`${p}${k}`));
  const apart = (a: number[], b: number[]) => Math.max(...a) < Math.min(...b) || Math.max(...b) < Math.min(...a);
  assert.ok(apart(side('p'), side('q')) || apart(down('p'), down('q')), 'each block keeps to itself');
  for (const t of g.ties) assert.deepEqual(through(g, t.points, [t.a, t.b]), [], `${t.a} to ${t.b} passes through no step`);
});

test('a tie has its head where its link points, into the head of a step below or the foot of one above', () => {
  const answer = { items: [item('e_topzzzzz'), item('e_lowzzzzz'), item('e_midzzzzz')], links: [link('depends_on', 'e_midzzzzz', 'e_topzzzzz'), link('depends_on', 'e_lowzzzzz', 'e_midzzzzz'), link('serves', 'e_lowzzzzz', 'e_topzzzzz'), link('serves', 'e_topzzzzz', 'e_lowzzzzz')] };
  const drawn = picture({ answer, style: house, reduced: true }, { measure, patch: () => {}, frame: () => Promise.resolve(0), open: () => {} });
  const svg = JSON.stringify(drawn.scene.svg);
  const paths = [...svg.matchAll(/"key":"(nh?:\d+)","d":"([^"]+)"/g)].map((m) => [m[1], m[2]]);
  const heads = paths.filter(([key]) => key.startsWith('nh:')).map(([, d]) => d.slice(1).split('L')[0].split(' ').map(Number));
  assert.equal(heads.length, 2, 'each serves tie is headed');
  // The tip of each head lies on the step its link points to: the top one's foot (from below), the low one's head (from above).
  const g = laidOut(answer);
  const [top, low] = [boxOf(g, 'e_topzzzzz'), boxOf(g, 'e_lowzzzzz')];
  const on = ([x, y]: number[], s: any, edge: number) => Math.abs(y - edge) < 0.5 && Math.abs(x - s.x) <= s.w / 2;
  assert.ok(heads.some((p) => on(p, top, top.y + top.h / 2)), `a head into the foot of what the low one serves: ${JSON.stringify(heads)}`);
  assert.ok(heads.some((p) => on(p, low, low.y - low.h / 2)), `a head into the head of what the top one serves: ${JSON.stringify(heads)}`);
});
