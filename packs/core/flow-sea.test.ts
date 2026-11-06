// The sea is one more level of the flow (design e_87x2us2b, the owner, 6 Nov 2026): a read across is three wires joined at
// two ports, each wire's end at sea held where its island put its port, and no wire routed by anything but the flow's own
// layers. Checked on the whole model of a picture of three islands: where each read crosses, that no two wires share a
// stretch, that no wire crosses a finding's name, and that where any two wires cross, one passes under.

import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8'));
const house = { ...pack.styles.find((s: any) => s.id === 'core.house').props, shape: 'flow' };
const laid = mkdtempSync(join(tmpdir(), 'flow-sea-'));
for (const [name, file] of Object.entries(pack.layouts.find((d: any) => d.id === 'core.flow').modules)) copyFileSync(join(import.meta.dirname, file as string), join(laid, name));
const load = (name: string) => import(pathToFileURL(join(laid, name)).href);
const [{ layout }, { compose, islandModels }, { count }] = await Promise.all([load('layout.js'), load('archipelago.js'), load('count.js')]);

const measure = (t: string, px: number) => t.length * px * 0.55;
const item = (id: string, title: string, island?: string, kind = 'work') => ({ id, type: kind === 'record' ? 'finding' : 'task', is: [kind], title, open: true, ...(island && { island }) });
const [A, B, C] = ['e_islandaa', 'e_islandbb', 'e_islandcc'];
const items = [
  item('e_costzzzz', 'Cost per sample', A, 'record'), item('e_yieldzzz', 'Yield per run', A, 'record'), item('e_trialzzz', 'Run the trial', A),
  item('e_budgetzz', 'Set the budget', B), item('e_bidzzzzz', 'Write the bid', B), item('e_sendzzzz', 'Send it', B),
  item('e_planzzzz', 'Plan the season', C), item('e_alexzzzz', 'Alex', undefined, 'actor'),
];
const links = [
  { type: 'depends_on', from: 'e_costzzzz', to: 'e_trialzzz' }, { type: 'depends_on', from: 'e_yieldzzz', to: 'e_trialzzz' },
  { type: 'depends_on', from: 'e_bidzzzzz', to: 'e_budgetzz' }, { type: 'depends_on', from: 'e_sendzzzz', to: 'e_bidzzzzz' },
  // Reads across: one finding read from two islands, and one island reading the other's two findings.
  { type: 'reads', from: 'e_budgetzz', to: 'e_costzzzz' }, { type: 'reads', from: 'e_bidzzzzz', to: 'e_yieldzzz' },
  { type: 'reads', from: 'e_planzzzz', to: 'e_costzzzz' }, { type: 'reads', from: 'e_sendzzzz', to: 'e_costzzzz' },
  { type: 'waits_on', from: 'e_sendzzzz', to: 'e_alexzzzz' },
];
const LABEL = 90;
const run = (part: any) => layout({ ...part, undrawn: [], headless: house.headless, measure, sizes: house.sizes, aspect: 1.6, shapes: { type: house.type_shapes ?? {} } });
const g = compose(islandModels({ items, links, run }), { legends: new Map(), names: new Map(), labels: () => LABEL, sizes: house.sizes });
const crossing = g.ties.filter((t: any) => t.crossing);
const all = [...g.chains, ...g.ties];

/** Whether point `p` lies on the polyline `line`, within a hair. */
const onLine = (line: number[][], p: number[]) => line.some((q, i) => i > 0 && (() => {
  const r = line[i - 1], [lo, hi] = [[Math.min(r[0], q[0]), Math.min(r[1], q[1])], [Math.max(r[0], q[0]), Math.max(r[1], q[1])]];
  return p[0] >= lo[0] - 0.5 && p[0] <= hi[0] + 0.5 && p[1] >= lo[1] - 0.5 && p[1] <= hi[1] + 0.5 && (Math.abs(r[0] - q[0]) < 0.5 || Math.abs(r[1] - q[1]) < 0.5);
})());

test('sea: each read across is one wire from its reader, through its port, to the finding’s name', () => {
  assert.equal(crossing.length, 5, 'every link between two groups crosses');
  for (const t of crossing.filter((v: any) => v.gates.length)) {
    const [reader, finding] = t.gates;
    assert.ok(onLine(t.points, reader.at), `${t.a} passes through its port`);
    assert.ok(t.label, `${t.b} is named where it leaves its island`);
    const [x, y] = t.label.at, end = t.points.at(-1);
    assert.ok(Math.abs(end[0] - x) <= LABEL / 2 + 0.5 && Math.abs(end[1] - y) <= house.sizes.flow_island_gate_height / 2 + 0.5, `${t.a} ends on the name of ${t.b}`);
    assert.deepEqual(finding.at, t.label.at, 'the finding’s gate is its name');
  }
});

test('sea: no two wires share a stretch, inside an island or at sea', () => {
  assert.equal(count(all.map((w: any) => w.points)).shared, 0);
});

test('sea: no wire crosses a finding’s name', () => {
  const H = house.sizes.flow_island_gate_height / 2, names = [...new Map(crossing.filter((t: any) => t.label).map((t: any) => [t.label.id, t.label])).values()] as any[];
  assert.ok(names.length >= 2, 'the two findings read across are named');
  for (const n of names) {
    const r = { l: n.at[0] - n.w / 2 + 0.5, r: n.at[0] + n.w / 2 - 0.5, t: n.at[1] - H + 0.5, b: n.at[1] + H - 0.5 };
    const inside = (p: number[]) => p[0] > r.l && p[0] < r.r && p[1] > r.t && p[1] < r.b;
    for (const w of all) for (let i = 1; i < w.points.length; i++) {
      const [p, q] = [w.points[i - 1], w.points[i]];
      if (inside(p) || inside(q)) continue;
      const through = Math.max(p[0], q[0]) > r.l && Math.min(p[0], q[0]) < r.r && Math.max(p[1], q[1]) > r.t && Math.min(p[1], q[1]) < r.b;
      assert.ok(!through, `${w.a} to ${w.b} passes through the name ${n.id}`);
    }
  }
});

test('sea: where any two wires cross, one passes under, at sea as inside', () => {
  const { crossings } = count(all.map((w: any) => w.points));
  assert.equal(g.breaks.length, crossings, 'a break for every crossing');
  const gaps = all.reduce((n: number, w: any) => n + (w.gaps?.length ?? 0), 0);
  assert.equal(gaps, crossings, 'each break a gap in the wire that passes under');
});

test('sea: no island stands on another, and each holds its own steps', () => {
  const lands = g.islands.map((i: any) => ({ id: i.id, ...i.land[0] }));
  for (const a of lands) for (const b of lands) if (a.id < b.id) assert.ok(a.r <= b.l || b.r <= a.l || a.b <= b.t || b.b <= a.t, `${a.id} and ${b.id} overlap`);
  for (const i of g.islands) for (const id of i.steps) {
    const [x, y, land] = [g.x.get(id), g.y.get(id), i.land[0]];
    assert.ok(x > land.l && x < land.r && y > land.t && y < land.b, `${id} stands on its island`);
  }
});
