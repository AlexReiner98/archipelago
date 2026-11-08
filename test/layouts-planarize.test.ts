// The whole map planarized at once (packs/core/layouts/planarize/, task e_snvzsxj4), run with no database: wires
// joined by pair, rings broken by turning the fewest, trunks of one type and way, islands as closed runs of the line
// crossed once by each wire that leaves them, and the plain drawing of it.

import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';

const LAYOUTS = join(import.meta.dirname, '..', 'packs', 'core', 'layouts');
/** The flow's, the kit's and these modules side by side, under the names they import each other by. */
const dir = mkdtempSync(join(tmpdir(), 'planarize-test-'));
for (const folder of ['flow', 'kit', 'planarize']) for (const f of readdirSync(join(LAYOUTS, folder))) if (f.endsWith('.js')) cpSync(join(LAYOUTS, folder, f), join(dir, f));
const mod = (name: string) => import(pathToFileURL(join(dir, name)).href);

const house = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'packs/core/pack.json'), 'utf8')).styles.find((s: any) => s.id === 'core.house').props;
const measure = (text: string, px: number) => text.length * px * 0.55;
const item = (id: string, island?: string) => ({ id, type: 'task', title: `Step ${id}`, open: true, ...(island && { island }) });
const link = (type: string, from: string, to: string) => ({ type, from, to });
const graph = async (items: any[], links: any[]) => (await mod('model.js')).model({ items, links, measure, sizes: house.sizes, headless: house.headless, undrawn: [] });

test('wires: one per pair, opposed links as one headless tie', async () => {
  const { joined } = await mod('direct.js');
  const m = await graph(['a', 'b', 'c'].map((id) => item(id)), [link('about', 'a', 'b'), link('about', 'b', 'a'), link('depends_on', 'c', 'a'), link('calls', 'a', 'c')]);
  const wires = joined(m, house.headless);
  assert.equal(wires.length, 2);
  const ab = wires.find((w: any) => [w.u, w.v].sort().join() === 'a,b');
  assert.equal(ab.directed, false, 'A about B and B about A tie with no way');
  const ac = wires.find((w: any) => [w.u, w.v].sort().join() === 'a,c');
  assert.equal(ac.directed, true, 'two links the same way stay one wire with that way');
  assert.deepEqual(ac.types.sort(), ['calls', 'depends_on']);
});

test('rings: the fewest wires are turned, the same each run', async () => {
  const { feedback } = await mod('direct.js');
  const ids = ['a', 'b', 'c', 'd'], made = (id: string) => ids.indexOf(id);
  const wire = (u: string, v: string) => ({ u, v, directed: true });
  const wires = [wire('a', 'b'), wire('b', 'c'), wire('c', 'a'), wire('c', 'd'), wire('d', 'b')];
  const first = feedback(ids, wires, made), again = feedback(ids, wires, made);
  assert.equal(first.turned.size, 1, 'two rings through b to c, broken by one wire');
  assert.deepEqual([...first.turned], [...again.turned]);
  const at = new Map<string, number>(first.order.map((v: string, k: number) => [v, k]));
  for (const w of wires) if (!first.turned.has(w)) assert.ok(at.get(w.u)! < at.get(w.v)!, 'every other wire runs down the order');
});

test('trunks: one type and one way only, crossing a shore once', async () => {
  const { withTrunks } = await mod('trunks.js');
  const wire = (id: string, v: string, type = 'about', turned = false) => ({ id, u: 'hub', v, top: 'hub', foot: v, types: [type], directed: true, turned, links: [] });
  const made = (id: string) => id.length;
  const islandOf = (id: string) => (id.startsWith('x') ? 'far' : 'home');
  const { wires, junctions, trunks } = withTrunks([wire('1', 'a'), wire('2', 'b'), wire('3', 'xa'), wire('4', 'xb'), wire('5', 'c', 'calls'), wire('6', 'd', 'about', true)], made, islandOf);
  assert.equal(trunks, 1, 'the link of another type and the turned one share no trunk');
  assert.ok(wires.some((w: any) => w.id === '5') && wires.some((w: any) => w.id === '6'));
  const far = junctions.find((j: any) => j.island === 'far');
  assert.ok(far, 'the two wires to the far island meet at a junction on it');
  assert.equal(wires.filter((w: any) => w.trunk === 0 && [w.u, w.v].includes(far.id) && ![w.u, w.v].some((v: string) => v.startsWith('x'))).length, 1, 'one stretch of the trunk crosses to the far island');
});

test('embedding: islands closed, each wire across one crosses each border once, the order runs down', async () => {
  const { embedding } = await mod('embedding.js');
  const { visibility } = await mod('plain.js');
  const items = [...['a1', 'a2', 'a3', 'a4'].map((id) => item(id, 'A')), ...['b1', 'b2', 'b3'].map((id) => item(id, 'B')), item('s')];
  const links = [link('depends_on', 'a2', 'a1'), link('depends_on', 'a3', 'a2'), link('depends_on', 'a4', 'a1'), link('depends_on', 'b2', 'b1'), link('depends_on', 'b3', 'b2'),
    link('depends_on', 'b1', 'a3'), link('about', 'a4', 'b3'), link('about', 's', 'a2'), link('calls', 'b2', 's'), link('about', 'a1', 'b1')];
  const m = await graph(items, links);
  const e = embedding(m, { sizes: house.sizes, headless: house.headless, islandOf: (id: string) => m.nodes.get(id)?.item?.island ?? null });
  assert.equal(e.counts.up, 0, 'no wire runs against its way');
  assert.equal(e.counts.twice, 0, 'no wire crosses a border twice');
  assert.equal(e.counts.lost, 0);
  const across = e.wires.filter((w: any) => e.place.get(w.u) !== e.place.get(w.v));
  for (const w of across) for (const island of [e.place.get(w.u), e.place.get(w.v)].filter(Boolean)) {
    assert.equal(w.path.filter((v: string) => e.portAt.get(v)?.island === island).length, 1, `${w.id} has one port on ${island}`);
  }
  // What lives on an island stands between its tops and its foot on the line, and nothing else does.
  for (const island of ['A', 'B']) {
    const at = (v: string) => e.line.indexOf(v), [lo, hi] = [at(`top2 ${island}`), at(`foot ${island}`)];
    for (const v of e.line.filter((x: string) => m.nodes.has(x))) assert.equal(at(v) > lo && at(v) < hi, e.place.get(v) === island, `${v} on ${island}`);
  }
  const again = embedding(m, { sizes: house.sizes, headless: house.headless, islandOf: (id: string) => m.nodes.get(id)?.item?.island ?? null });
  assert.deepEqual(again.counts, e.counts, 'the same each run');
  // The plain drawing: every wire with a way runs down its rows.
  const { row } = visibility(e);
  for (const w of e.wires.filter((x: any) => x.firm)) for (let i = 1; i < w.path.length; i++) assert.ok(row.get(w.path[i]) > row.get(w.path[i - 1]), `${w.id} runs down`);
});

test('embedding: a graph that cannot be drawn flat crosses at points of its own', async () => {
  const { embedding } = await mod('embedding.js');
  // K3,3: three above, three under, each joined to each.
  const items = ['p', 'q', 'r', 'x', 'y', 'z'].map((id) => item(id));
  const links = ['p', 'q', 'r'].flatMap((a) => ['x', 'y', 'z'].map((b) => link('depends_on', b, a)));
  const e = embedding(await graph(items, links), { sizes: house.sizes, headless: house.headless });
  assert.ok(e.counts.crossings >= 1);
  assert.equal(e.counts.up, 0);
  for (const c of e.crossings) assert.equal([...e.owner.keys()].filter((k: string) => k.split('|').includes(c)).length, 2 * 2, 'a crossing joins two wires, each passing');
});

test('format: the embedding as step 2 takes it, faces and rotation agreeing, borders clockwise', async () => {
  const { embedding } = await mod('embedding.js');
  const { asInput } = await mod('format.js');
  const { visibility } = await mod('plain.js');
  const items = [...['a1', 'a2', 'a3'].map((id) => item(id, 'A')), ...['b1', 'b2'].map((id) => item(id, 'B')), item('s')];
  const links = [link('depends_on', 'a2', 'a1'), link('depends_on', 'a3', 'a1'), link('depends_on', 'b2', 'b1'), link('depends_on', 'b1', 'a2'),
    link('about', 'a3', 'b2'), link('about', 's', 'a1'), link('calls', 'b1', 's'), link('depends_on', 'b2', 'a3')];
  const m = await graph(items, links), e = embedding(m, { sizes: house.sizes, headless: house.headless, islandOf: (id: string) => m.nodes.get(id)?.item?.island ?? null });
  const g = asInput(e, m), edge = new Map<string, any>(g.edges.map((x: any) => [x.id, x]));
  const kinds = new Set(g.nodes.map((n: any) => n.kind));
  for (const k of ['item', 'border', 'port']) assert.ok(kinds.has(k), `a node of kind ${k}`);
  for (const w of g.wires) for (let i = 1; i < w.edges.length; i++) assert.equal(edge.get(w.edges[i - 1]).to, edge.get(w.edges[i]).from, `${w.id}'s edges run on in order`);
  for (const w of g.wires.filter((x: any) => x.type === 'depends_on')) assert.equal(edge.get(w.edges[0]).dir, w.reversed ? 'up' : 'down');
  assert.equal(g.nodes.length - g.edges.length + g.faces.length, 2, 'Euler: the rotation is a planar embedding of one piece');
  // Walking a face, each next edge is the one after it round the node they share.
  const ends = (id: string): string[] => [edge.get(id).from, edge.get(id).to];
  for (const f of g.faces) f.forEach((id: string, k: number) => {
    const next = f[(k + 1) % f.length], at = ends(id).find((v) => ends(next).includes(v))!, ring = g.rotation[at];
    const step = (ring.indexOf(id) - ring.indexOf(next) + ring.length) % ring.length;
    assert.ok(ring.length < 3 || step === 1 || step === ring.length - 1, `faces turn by the rotation at ${at}: ${id} then ${next} in ${ring.join(', ')}`);
  });
  // Each border turns clockwise on the plain drawing (y down): its signed area is positive.
  const { row, span } = visibility(e), mid = (v: string) => (span.get(v)[0] + span.get(v)[1]) / 2;
  for (const island of g.islands) {
    const p = island.border.map((v: string) => [mid(v), row.get(v)]);
    const area = p.reduce((sum: number, a: number[], k: number) => { const b = p[(k + 1) % p.length]; return sum + a[0] * b[1] - b[0] * a[1]; }, 0);
    assert.ok(area > 0, `${island.id} turns clockwise`);
  }
});

test('format: a border runs clockwise with its island on the right, with ports or none', async () => {
  const { embedding } = await mod('embedding.js');
  const { asInput } = await mod('format.js');
  const cases = [
    { items: ['a', 'b', 'c'].map((id) => item(id, 'A')), links: [link('depends_on', 'b', 'a'), link('depends_on', 'c', 'a')] },
    { items: [...['a', 'b'].map((id) => item(id, 'A')), item('s')], links: [link('depends_on', 'b', 'a'), link('about', 's', 'b'), link('calls', 'a', 's')] },
  ];
  for (const { items, links } of cases) {
    const m = await graph(items, links), e = embedding(m, { sizes: house.sizes, headless: house.headless, islandOf: (id: string) => m.nodes.get(id)?.item?.island ?? null });
    const g = asInput(e, m), edge = new Map<string, any>(g.edges.map((x: any) => [x.id, x]));
    const between = (a: string, b: string) => g.edges.find((x: any) => (x.from === a && x.to === b) || (x.from === b && x.to === a)).id;
    for (const island of g.islands) {
      const [a, b] = island.border, step = between(a, b);
      // The face holding the stretch a to b walked from a to b, on its right.
      const face = g.faces.find((f: string[]) => f.some((id, k) => {
        if (id !== step) return false;
        const next = edge.get(f[(k + 1) % f.length]);
        return next.from === b || next.to === b;
      }));
      const held = new Set(face.flatMap((id: string) => [edge.get(id).from, edge.get(id).to]));
      assert.ok(items.some((i: any) => i.island === island.id && held.has(i.id)), `${island.id}: the face on the right of its border is inside`);
    }
  }
});
