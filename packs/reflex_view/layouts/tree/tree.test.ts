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
  const said = treeOf({ ...answer(3, []), items: [node(0, { fields: { for: ['file:src/**'] } }), node(1, { fields: { for: ['file:ui/*'] } }), node(2)] })!;
  assert.equal(said.nodes.get(id(0))!.parent!.id, '~for:file');
  assert.equal(said.nodes.get(id(1))!.parent!.id, '~for:file');
  const hub = { id: 'e_hubhubhu', type: 'task', title: 'Hub', created_at: node(0).created_at };
  const of = treeOf({ lens: { from: hub.id }, items: [hub, node(1), node(2)], links: [partOf(1, 2)] })!;
  assert.equal(of.root.id, hub.id);
  assert.equal(treeOf({ items: [hub], links: [] }), null);
});

test('it is placed the same each time, each child within its parent’s share of the circle', () => {
  const measure = (text: string, px: number) => text.length * px * 0.55;
  const a = radial(treeOf(answer())!, z, n, measure), b = radial(treeOf(answer())!, z, n, measure);
  assert.ok(a.names.size > 0, 'the first levels are named where there is room');
  assert.deepEqual([...a.place], [...b.place]);
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
  const played = picture({ answer: answer(), style, reduced: false }, tools);
  assert.ok(played.scene.surface, 'a played tree is never mounted from a picture kept still');
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(frames > 2);
  assert.ok(patches.some((p) => p.key === 'cam' && p.set?.transform));
  assert.ok(played.on({ name: 'click', key: 'rt:replay' }).some((p: any) => p.toggle?.on === false));
  played.end();
  const still = picture({ answer: { ...answer(), lens: { find: ['still'] } }, style, reduced: true }, tools);
  assert.equal(still.scene.surface, undefined);
  assert.equal(JSON.stringify(still.scene.svg).match(/rt-node on/g)?.length, 12);
  assert.ok(picture({ answer: answer(), style: { shape: 'reflex_tree' }, reduced: true }, tools).scene.message);
});

test('the counts the pack answers through the view’s sends stand in for the schematic ones', async () => {
  const patches: any[] = [], asked: any[] = [];
  const act = async (name: string, params: any) => (asked.push([name, params]), { answer: params.ids.map((one: string, i: number) => ({ id: one, said: i })) });
  const tools = { frame: () => new Promise(() => {}), patch: (p: any[]) => patches.push(...p), open() {}, act };
  picture({ answer: { ...answer(), lens: { find: ['counted'] } }, style, reduced: true }, tools);
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(asked[0][0], style.sends.said);
  assert.equal(asked[0][1].ids.length, 12);
  assert.deepEqual(patches.find((p) => p.key === 'rt-said-n'), { key: 'rt-said-n', text: '66' });
  assert.ok(patches.some((p) => p.key === 'rt-schematic' && p.remove));
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
