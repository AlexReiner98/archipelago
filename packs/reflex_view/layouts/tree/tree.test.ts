// The reflex tree drawing, without a page: an answer in, the tree, its places, its film and its patches out.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { treeOf } from './tree.js';
import { radial } from './radial.js';
import { sayingsOf } from './said.js';
import { filmOf } from './film.js';
import { picture } from './index.js';
import { namesShown, overlap } from './names.js';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'pack.json'), 'utf8'));
const style = pack.styles.find((s: any) => s.id === 'reflex_view.tree').props.style;
const z = (name: string) => style.sizes[name], n = (name: string) => style.numbers[name];
const id = (i: number) => `e_${String(i).padStart(8, 'a')}`;
const hour = 3600000;
const node = (i: number, extra: Record<string, unknown> = {}) => ({ id: id(i), type: 'instruction', title: `Rule ${i}`, created_at: new Date(Date.UTC(2026, 10, 1) + i * hour).toISOString(), ...extra });
const partOf = (a: number, b: number) => ({ id: `l${a}`, type: 'part_of', from: id(a), to: id(b) });
const answer = (count = 12, links = [partOf(4, 1), partOf(5, 1), partOf(6, 4), partOf(9, 2)]) => ({ lens: { find: ['type instruction'] }, items: Array.from({ length: count }, (_, i) => node(i)), links });

test('the tree hangs each node from what it is part of, and the loose ones from the root', () => {
  const tree = treeOf(answer())!;
  assert.equal(tree.root.id, '~root');
  assert.equal(tree.nodes.get(id(6))!.parent!.id, id(4));
  assert.equal(tree.nodes.get(id(4))!.depth, 2);
  assert.equal(tree.nodes.get(id(3))!.parent, tree.root);
  assert.equal(tree.written.length, 12);
  // Born in the order made, each after what it grows from.
  for (const one of tree.born) if (one.parent && one.parent !== tree.root) assert.ok(tree.born.indexOf(one.parent) < tree.born.indexOf(one));
});

test('a ring of part_of is cut where it closes, a node said somewhere hangs from that bough, and the view’s item is the root', () => {
  const ring = treeOf(answer(4, [partOf(1, 2), partOf(2, 1)]))!;
  assert.equal(ring.nodes.size, 5);
  const said = treeOf({ ...answer(3, []), items: [node(0, { fields: { for: ['file:src/**'] } }), node(1, { fields: { for: ['file:ui/*'] } }), node(2)] }, undefined, n)!;
  assert.equal(said.nodes.get(id(0))!.parent!.id, '~for:file:src/');
  assert.equal(said.nodes.get(id(0))!.parent!.parent!.id, '~for:file');
  assert.equal(said.nodes.get(id(1))!.parent!.parent, said.nodes.get(id(0))!.parent!.parent, 'two folders under one file bough');
  const hub = { id: 'e_hubhubhu', type: 'task', title: 'Hub', created_at: node(0).created_at };
  const of = treeOf({ lens: { from: hub.id }, items: [hub, node(1), node(2)], links: [partOf(1, 2)] })!;
  assert.equal(of.root.id, hub.id);
  assert.equal(treeOf({ items: [hub], links: [] }), null);
});

test('it is placed the same each time, each child within its parent’s share of the circle', () => {
  const measure = (text: string, px: number) => text.length * px * 0.55;
  const a = radial(treeOf(answer())!, z, n, measure), b = radial(treeOf(answer())!, z, n, measure);
  assert.deepEqual([...a.place], [...b.place]);
  assert.equal(a.labels.size, a.place.size - 1, 'every node but the root has a name laid out');
  assert.deepEqual([a.centre.x * 2, a.centre.y * 2], [a.width, a.height], 'the root stands at the middle');
  assert.ok(a.width > 0 && a.height > 0);
  for (const p of a.place.values()) assert.ok(p.x >= 0 && p.y >= 0 && p.x <= a.width && p.y <= a.height);
  assert.ok(a.branch.get(id(6))!.startsWith('M'));
  assert.equal(a.along.get(id(6))!.length, n('reflex_curve_steps') + 1);
});

test('the film grows to the whole, and the counts end on what was said', () => {
  const tree = treeOf(answer())!, said = sayingsOf(tree, n), film = filmOf(tree, said, n);
  assert.equal(said.schematic, true);
  const times = tree.born.map((one) => film.born.get(one.id)!);
  assert.deepEqual([...times].sort((x, y) => x - y), times);
  assert.ok(times.every((t) => t > 0 && t <= film.end));
  assert.equal(film.writtenAt(film.end), 12);
  assert.equal(film.saidAt(film.end), said.total);
  assert.ok(film.saidAt(film.end / 2) < said.total);
  const counted = sayingsOf(treeOf({ ...answer(2, []), items: [node(0, { fields: { said: 7 } }), node(1)] })!, n);
  assert.deepEqual([counted.schematic, counted.total], [false, 7]);
});

test('played, it patches the tree in as it grows; under reduced motion it stands whole and still', async () => {
  const patches: any[] = [];
  let frames = 0;
  const tools = { frame: () => new Promise((r) => setTimeout(r, 1)).then(() => frames++), patch: (p: any[]) => patches.push(...p), open() {}, surface: async () => null };
  const played = await picture({ answer: answer(), style, reduced: false }, tools);
  assert.ok(played.scene.surface, 'a played tree is never mounted from a picture kept still');
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(frames > 2);
  assert.ok(patches.some((p) => p.key === 'cam' && p.set?.transform));
  assert.ok(played.on({ name: 'click', key: 'rt:replay' }).some((p: any) => p.toggle?.on === false));
  played.end();
  const still = await picture({ answer: { ...answer(), lens: { find: ['still'] } }, style, reduced: true }, tools);
  assert.equal(still.scene.surface, undefined);
  assert.equal(JSON.stringify(still.scene.svg).match(/rt-node on/g)?.length, 12);
  assert.ok((await picture({ answer: answer(), style: { shape: 'reflex_tree' }, reduced: true }, tools)).scene.message);
});

test('the counts the pack answers through the view’s sends stand in for the schematic ones', async () => {
  const patches: any[] = [], asked: any[] = [];
  const act = async (name: string, params: any) => (asked.push([name, params]), { answer: params.ids.map((one: string, i: number) => ({ id: one, said: i })) });
  const tools = { frame: () => new Promise(() => {}), patch: (p: any[]) => patches.push(...p), open() {}, act };
  const act2 = async (name: string, params: any) => ((await act(name, params)) as any);
  const counted = await picture({ answer: { ...answer(), lens: { find: ['counted'] } }, style, reduced: true }, { ...tools, act: async (name: string, params: any) => { const got = await act2(name, params); got.answer.forEach((r: any, i: number) => (r.for = i < 3 ? ['tool:change'] : undefined)); return got; } });
  assert.equal(asked[0][0], style.sends.said);
  assert.equal(asked[0][1].ids.length, 12);
  const svg = JSON.stringify(counted.scene.svg);
  assert.ok(svg.includes('66 said') || JSON.stringify(counted.scene.before).includes('66'), 'the counts it answered are the ones shown');
  assert.ok(!JSON.stringify(counted.scene.before).includes('schematic'));
  assert.ok(svg.includes('n:~for:tool:change'), 'a node part of nothing hangs from the boughs of where it is said');
});

test('counted, a node never said is never lit', () => {
  const tree = treeOf(answer())!, said = sayingsOf(tree, n);
  for (const id of said.counts.keys()) said.counts.set(id, id === tree.written[0].id ? 3 : 0);
  said.schematic = false;
  const film = filmOf(tree, said, n), rnd = () => 0.9;
  assert.equal(film.pick(film.end, rnd)!.id, tree.written[0].id);
  said.counts.set(tree.written[0].id, 0);
  assert.equal(film.pick(film.end, rnd), null);
});

test('grown, no two shown names overlap or cross a wire, and every node is named or a dot with its name as tooltip', async () => {
  const places = ['tool:change', 'tool:query', 'file:packs/canvas/layouts/*.js', 'file:packs/*/page/*.js', 'file:ui/*', 'session_start', 'working_rules', 'guide:style_code'];
  const items = Array.from({ length: 40 }, (_, i) => node(i, { title: `A rule of the harness, number ${i}`, fields: { for: [places[i % places.length]] } }));
  const links = [partOf(9, 1), partOf(17, 1), partOf(25, 9), partOf(12, 4), partOf(20, 4), partOf(28, 4), partOf(33, 2), partOf(34, 33)];
  const answer40 = { lens: { find: ['forty'] }, items, links };
  const tree = treeOf(answer40, undefined, n)!;
  const placed = radial(tree, z, n, (text: string, px: number) => text.length * px * 0.55, 2);
  const counts = new Map(tree.written.map((one, i) => [one.id, i % 5]));
  for (const f of [1.4, 1, 0.5]) {
    const { shown, boxes } = namesShown(tree, placed, counts, z, n, f);
    const ids = [...shown];
    for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) assert.ok(!overlap(boxes.get(ids[i]), boxes.get(ids[j])), `${ids[i]} and ${ids[j]} at ${f}`);
    for (const id of ids) {
      const own = new Set([id, ...tree.nodes.get(id)!.kids.map((k) => k.id)]);
      for (const [to, points] of placed.along) if (!own.has(to)) for (let k = 1; k < points.length; k++) assert.ok(!overlap([points[k - 1], points[k]], boxes.get(id)), `${id} and the wire to ${to} at ${f}`);
    }
    if (f === 1) assert.ok(shown.size > 0 && shown.size < placed.labels.size, 'some names show and some give way');
  }
  // Zoomed in, more show; every bough that shows outranks a leaf it met.
  assert.ok(namesShown(tree, placed, counts, z, n, 0.5).shown.size >= namesShown(tree, placed, counts, z, n, 1).shown.size);
  const drawn = await picture({ answer: answer40, style, reduced: true }, { frame: () => new Promise(() => {}), patch() {}, open() {} });
  const marks = JSON.stringify(drawn.scene.svg);
  for (const one of tree.order.filter((x) => x.parent)) assert.ok(marks.includes(JSON.stringify(['title', {}, one.title])), `${one.title} has its tooltip`);
  assert.ok(marks.includes('rt-quiet'), 'a name that gives way is drawn quiet');
  assert.ok(drawn.viewport({ x: 0, y: 0, width: 1, height: 1, scale: 0.5 }).some((p: any) => p.set?.transform?.includes('scale(2)')), 'names keep their size on screen');
});
