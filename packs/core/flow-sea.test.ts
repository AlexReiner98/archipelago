// The sea is one more level of the flow (design e_87x2us2b, the owner, 6 Nov 2026): a read across is three wires joined at
// two ports, each wire's end at sea held where its island put its port, and no wire routed by anything but the flow's own
// layers. Checked on the whole model of a picture of four islands: where each read crosses, that no two wires share a
// stretch, that a finding's reads that leave by one port share the wire in to it, that its readers on one island share
// one port and one wire across the sea, and that where any two wires cross, one
// passes under.

import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8'));
const house = { ...pack.styles.find((s: any) => s.id === 'core.house').props, shape: 'flow' };
const laid = mkdtempSync(join(tmpdir(), 'pelago-flow-sea-'));
for (const [name, file] of Object.entries(pack.layouts.find((d: any) => d.id === 'core.flow').modules)) copyFileSync(join(import.meta.dirname, file as string), join(laid, name));
const load = (name: string) => import(pathToFileURL(join(laid, name)).href);
const [{ layout }, { compose, islandModels }, { count }] = await Promise.all([load('layout.js'), load('archipelago.js'), load('count.js')]);

const measure = (t: string, px: number) => t.length * px * 0.55;
const item = (id: string, title: string, island?: string, kind = 'work') => ({ id, type: kind === 'record' ? 'finding' : 'task', is: [kind], title, open: true, ...(island && { island }) });
const [A, B, C, D] = ['e_islandaa', 'e_islandbb', 'e_islandcc', 'e_islanddd'];
const items = [
  item('e_costzzzz', 'Cost per sample', A, 'record'), item('e_yieldzzz', 'Yield per run', A, 'record'), item('e_trialzzz', 'Run the trial', A),
  item('e_budgetzz', 'Set the budget', B), item('e_bidzzzzz', 'Write the bid', B), item('e_sendzzzz', 'Send it', B),
  item('e_planzzzz', 'Plan the season', C), item('e_shipzzzz', 'Ship the kit', D), item('e_alexzzzz', 'Alex', undefined, 'actor'),
];
const links = [
  { type: 'depends_on', from: 'e_costzzzz', to: 'e_trialzzz' }, { type: 'depends_on', from: 'e_yieldzzz', to: 'e_trialzzz' },
  { type: 'depends_on', from: 'e_bidzzzzz', to: 'e_budgetzz' }, { type: 'depends_on', from: 'e_sendzzzz', to: 'e_bidzzzzz' },
  // Reads across: one finding read from three islands, twice from one of them, and one island reading the other's two findings.
  { type: 'reads', from: 'e_budgetzz', to: 'e_costzzzz' }, { type: 'reads', from: 'e_bidzzzzz', to: 'e_yieldzzz' },
  { type: 'reads', from: 'e_planzzzz', to: 'e_costzzzz' }, { type: 'reads', from: 'e_sendzzzz', to: 'e_costzzzz' }, { type: 'reads', from: 'e_shipzzzz', to: 'e_costzzzz' },
  { type: 'waits_on', from: 'e_sendzzzz', to: 'e_alexzzzz' },
];
const run = (part: any) => layout({ ...part, undrawn: [], headless: house.headless, measure, sizes: house.sizes, aspect: 1.6, shapes: { type: house.type_shapes ?? {} } });
const g = compose(islandModels({ items, links, run }), { legends: new Map(), names: new Map(), sizes: house.sizes });
const crossing = g.ties.filter((t: any) => t.crossing);
const all = [...g.chains, ...g.ties];

/** Whether point `p` lies on the polyline `line`, within a hair. */
const onLine = (line: number[][], p: number[]) => line.some((q, i) => i > 0 && (() => {
  const r = line[i - 1], [lo, hi] = [[Math.min(r[0], q[0]), Math.min(r[1], q[1])], [Math.max(r[0], q[0]), Math.max(r[1], q[1])]];
  return p[0] >= lo[0] - 0.5 && p[0] <= hi[0] + 0.5 && p[1] >= lo[1] - 0.5 && p[1] <= hi[1] + 0.5 && (Math.abs(r[0] - q[0]) < 0.5 || Math.abs(r[1] - q[1]) < 0.5);
})());

/** Whether `p` lies on the bar of `gate`: on its shore, within its span. */
const onBar = (p: number[], gate: any) => { const along = gate.way[0] ? 1 : 0; return Math.abs(p[along] - gate.at[along]) <= gate.span / 2 + 0.5 && Math.abs(p[1 - along] - gate.at[1 - along]) <= 0.5; };

test('sea: each read across is one wire from its reader, through its port, to its finding or the port it shares', () => {
  assert.equal(crossing.length, 5, 'every link between two groups crosses, and the two reads of one finding from one island as one');
  for (const t of crossing.filter((v: any) => v.gates.length)) {
    const [reader, finding] = t.gates;
    assert.ok(t.fromPort ? onBar(t.points[0], reader) : onLine(t.points, reader.at), `${t.a} passes through its port`);
    const end = t.points.at(-1), n = g.nodes.get(t.b);
    if (t.toPort) assert.ok(onBar(end, finding), `${t.a} ends on the port of ${t.b}`);
    else assert.ok(Math.abs(end[0] - g.x.get(t.b)) <= n.w / 2 + 0.5 && Math.abs(end[1] - g.y.get(t.b)) <= n.h / 2 + 0.5, `${t.a} ends on ${t.b}`);
    assert.ok(onLine(t.points, finding.at) || t.toPort, `${t.a} passes through the port of ${t.b}`);
  }
});

test('sea: no two wires share a stretch, inside an island or at sea', () => {
  assert.equal(count(all.map((w: any) => w.points)).shared, 0);
});

test('sea: a finding’s reads that leave by one port share one wire in to it, from that port to the finding', () => {
  const ports = new Set(crossing.filter((t: any) => t.toPort).map((t: any) => t.toPort)), ins = g.ties.filter((t: any) => t.fromPort);
  assert.ok(ports.size >= 1, 'the finding read twice by one side leaves by one port');
  for (const id of ports) {
    const own = ins.filter((t: any) => t.fromPort === id);
    assert.equal(own.length, 1, `one wire in from ${id}`);
    const [w] = own, reads = crossing.filter((t: any) => t.toPort === id), gate = reads[0].gates[1];
    assert.ok(reads.every((t: any) => t.b === w.b), 'every read on the port is of its finding');
    assert.ok(Math.abs(w.points[0][0] - gate.at[0]) <= 0.5 && Math.abs(w.points[0][1] - gate.at[1]) <= 0.5, `the wire in starts on ${id}`);
  }
});

test('sea: a finding’s readers on one island share one port and one wire across the sea', () => {
  const over = crossing.filter((t: any) => t.b === 'e_costzzzz' && t.fromPort);
  assert.equal(over.length, 1, 'Set the budget and Send it read Cost per sample across one wire');
  const [t] = over, gate = t.gates[0], ins = g.ties.filter((v: any) => v.toPort === t.fromPort && !v.crossing);
  assert.deepEqual(ins.map((v: any) => v.a).sort(), ['e_budgetzz', 'e_sendzzzz'], 'each reader has its own wire to the port');
  for (const v of ins) {
    const n = g.nodes.get(v.a), [p, end] = [v.points[0], v.points.at(-1)];
    assert.ok(Math.abs(p[0] - g.x.get(v.a)) <= n.w / 2 + 0.5 && Math.abs(p[1] - g.y.get(v.a)) <= n.h / 2 + 0.5, `${v.a} starts on its step`);
    assert.ok(onBar(end, gate), `${v.a} ends on the port`);
  }
  assert.ok(ins.every((v: any) => Math.abs(v.points.at(-1)[0] - t.points[0][0]) > 0.5 || Math.abs(v.points.at(-1)[1] - t.points[0][1]) > 0.5), 'the wire across leaves the port clear of every reader’s');
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

/** Whether two stretches that are not next to each other on one line meet anywhere: a line that crosses itself. */
const crossesItself = (line: number[][]) => line.some((_, i) => line.some((__, j) => {
  if (j < i + 2 || !line[i + 1] || !line[j + 1]) return false;
  const [a, b, c, d] = [line[i], line[i + 1], line[j], line[j + 1]];
  return [0, 1].every((k) => Math.max(Math.min(a[k], b[k]), Math.min(c[k], d[k])) <= Math.min(Math.max(a[k], b[k]), Math.max(c[k], d[k])));
}));

test('sea: a wire whose sketch ends on another side of its island than its port comes to the port without a loop', async () => {
  // The sea's first sketch ends on the island's left; its port is on the top. Brought round to the port, the wire must
  // not run on to the old end and turn back (the loops on "How is Archipelago built", 7 Nov 2026).
  const { holdPorts } = await load('ports.js');
  const nodes = new Map([['A', { w: 200, h: 200 }], ['B', { w: 100, h: 100 }]]), x = new Map([['A', 0], ['B', 400]]), y = new Map([['A', 0], ['B', 300]]);
  const routes = new Map([['A|B', { from: 'A', points: [[100, 0], [330, 0], [330, 300], [350, 300]] }]]);
  holdPorts({ nodes, x, y, routes, ties: [{ type: 'sea:0', route: 'A|B', a: 'A' }], run: house.sizes.flow_port_run,
    held: [{ id: 'pa', on: 'A', at: [0, 100], side: 'bottom' }, { id: 'pb', on: 'B', at: [0, -50], side: 'top' }], rewire: { 'sea:0': ['pa', 'pb'] } });
  const line = routes.get('A|B').points;
  assert.deepEqual([line[0], line.at(-1)], [[0, 100], [400, 250]], 'it still runs from port to port');
  assert.ok(!crossesItself(line), `no loop: ${JSON.stringify(line)}`);
});

test('sea: no wire crosses itself, inside an island or at sea', () => {
  for (const w of all) assert.ok(!crossesItself(w.points), `${w.a} → ${w.b} crosses itself`);
});
