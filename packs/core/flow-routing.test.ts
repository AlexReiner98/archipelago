// The flow's routing conventions (docs/drawings.md, e_k78mxqxt), each held on pictures dense enough to break them: the
// order in wires at right angles from the foot of what is depended on down into the head of what depends on it; every
// other link a tie at right angles too, round the steps, off the lines already drawn unless two share a step (a bus),
// with a head where the link points unless the style draws its type headless. Input in, marks out: no database.

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
const LEAD = house.sizes.flow_lead_out;

const state = { blocked: false, waits_on: [], sessions: 0, needs_you: false };
const item = (id: string, kind = 'work') => ({ id, kind, type: 'task', title: `Step ${id}`, open: true, status: 'todo', state, fields: {} });
const link = (type: string, from: string, to: string) => ({ id: `r_${type}${from}${to}`, type, from, to });

/**
 * A map as the live one is where the conventions broke: one hub that many things are part of, chains of the order under
 * it in wide rows, so a tie from the hub to a part far down has whole rows of steps in its way; things that serve
 * others across the rows; and two items with many leaves each, wrapped under them as outlines side by side.
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
  const steps = g.all.filter((n: any) => !n.dummy && !ends.includes(n.id)).map((n: any) => boxOf(g, n.id));
  const hit = new Set<string>();
  for (let k = 1; k < points.length; k++) {
    const [[x1, y1], [x2, y2]] = [points[k - 1], points[k]];
    for (const s of steps) if (Math.max(x1, x2) > s.x - s.w / 2 + 0.5 && Math.min(x1, x2) < s.x + s.w / 2 - 0.5 && Math.max(y1, y2) > s.y - s.h / 2 + 0.5 && Math.min(y1, y2) < s.y + s.h / 2 - 0.5) hit.add(s.id);
  }
  return [...hit];
};
/** Every run of every wire and tie, with the steps its path joins. */
const runs = (g: any) => [...g.chains, ...g.ties].flatMap((p: any) => p.points.slice(1).map(([x2, y2]: number[], k: number) => {
  const [x1, y1] = p.points[k], across = Math.abs(y1 - y2) < 0.01;
  return { p, across, at: across ? y1 : x1, lo: across ? Math.min(x1, x2) : Math.min(y1, y2), hi: across ? Math.max(x1, x2) : Math.max(y1, y2) };
}));

test('every wire and tie turns only at right angles, and none passes through a step', () => {
  const g = laidOut(dense());
  assert.ok(g.ties.length > 120 && g.chains.length > 80, `a dense picture: ${g.ties.length} ties, ${g.chains.length} wires`);
  for (const p of [...g.chains, ...g.ties]) {
    assert.ok(square(p.points), `${p.a} to ${p.b} turns at a slant`);
    // A wire of the order passes through its waypoints, which are no steps.
    assert.deepEqual(through(g, p.points, [p.a, p.b]), [], `${p.type ?? 'the order'} from ${p.a} to ${p.b} passes through a step`);
  }
});

test('the order runs from the foot of what is depended on down into the head of what depends on it', () => {
  const g = laidOut(dense());
  for (const c of g.chains) {
    const [a, b] = [boxOf(g, c.a), boxOf(g, c.b)], [first, last, before] = [c.points[0], c.points.at(-1), c.points.at(-2)];
    assert.ok(Math.abs(first[1] - (a.y + a.h / 2)) < 0.5 && Math.abs(first[0] - a.x) <= a.w / 2, `${c.key} leaves the foot of ${c.a}`);
    assert.ok(Math.abs(last[1] - (b.y - b.h / 2)) < 0.5 && Math.abs(last[0] - b.x) <= b.w / 2, `${c.key} comes into the head of ${c.b}`);
    assert.ok(Math.abs(before[0] - last[0]) < 0.01 && before[1] < last[1], `${c.key} comes down into it`);
    assert.ok(b.y > a.y, `${c.key} is read from the top down`);
  }
});

test('a tie leaves the foot of the higher of its steps and comes down into the head of the lower, or into a leaf\'s side', () => {
  const g = laidOut(dense());
  for (const t of g.ties) {
    const [a, b] = [boxOf(g, t.a), boxOf(g, t.b)], [hi, lo] = a.y <= b.y ? [a, b] : [b, a];
    const [first, last, before] = [t.points[0], t.points.at(-1), t.points.at(-2)];
    assert.ok(Math.abs(first[1] - (hi.y + hi.h / 2)) < 0.5 && Math.abs(first[0] - hi.x) <= hi.w / 2, `${t.a} to ${t.b} leaves the foot of ${hi.id}`);
    const side = Math.abs(last[0] - (lo.x - lo.w / 2)) < 0.01 && Math.abs(last[1] - lo.y) < 0.01;
    const head = Math.abs(last[1] - (lo.y - lo.h / 2)) < 0.5 && Math.abs(before[0] - last[0]) < 0.01 && before[1] < last[1];
    assert.ok(head || side, `${t.a} to ${t.b} comes down into the head of ${lo.id}, or into its side from its outline's bus`);
  }
});

test('no two paths run along each other unless they share a step: then they are one bus', () => {
  const g = laidOut(dense());
  const all = runs(g);
  const along: string[] = [];
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const [r, o] = [all[i], all[j]];
      if (r.p === o.p || r.across !== o.across || Math.abs(r.at - o.at) > 0.5 || Math.min(r.hi, o.hi) - Math.max(r.lo, o.lo) <= 1) continue;
      const shared = [r.p.a, r.p.b].some((e) => [o.p.a, o.p.b].includes(e));
      // Two wires of the order never share a stretch, a bus or not: each has a track of its own (layout.js).
      if (!shared || (!r.p.type && !o.p.type)) along.push(`${r.p.type ?? 'order'} ${r.p.a}>${r.p.b} and ${o.p.type ?? 'order'} ${o.p.a}>${o.p.b}`);
    }
  assert.deepEqual(along, [], 'paths that share no step run apart');
});

test('two outlines side by side each run across at a height of their own', () => {
  // Two items under one, each with more leaves than a row holds: each wraps them under it as an outline (./graph.js).
  const items = [item('hub', 'aim')], links = [];
  for (const p of ['p', 'q']) {
    items.push(item(p));
    links.push(link('part_of', p, 'hub'));
    for (let k = 0; k < 14; k++) (items.push(item(`${p}${k}`)), links.push(link('part_of', `${p}${k}`, p)));
  }
  const g = laidOut({ items, links });
  const across = (p: string) => g.ties.filter((t: any) => t.b === p).map((t: any) => t.points[1][1]);
  const [p, q] = [new Set(across('p')), new Set(across('q'))];
  assert.equal(g.y.get('p'), g.y.get('q'), 'the two are in one row');
  assert.ok(p.size === 1 && q.size === 1, 'the leaves of one outline share its bus');
  assert.notEqual([...p][0], [...q][0], 'the two outlines do not share a lane');
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
