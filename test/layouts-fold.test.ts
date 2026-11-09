// An island seen far off folded to one step (packs/core/layouts/map/fold.js, task e_yn9f9zpn): past what the style
// lets a picture read whole, each company island holds one step, its count, that opens the island, and the links to
// its items end on it. The island the view is about stays whole. Counted from the answer alone, never timed.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { drawings, setOut } from './wired.ts';

/** The fold, a pack's module, read as the page reads it: untyped. */
const { folded, foldsOf, homeOf } = await import(pathToFileURL(join(import.meta.dirname, '..', 'packs/core/layouts/map/fold.js')).href);

const house = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'packs/core/pack.json'), 'utf8')).styles.find((s: any) => s.id === 'core.house').props;
const measure = (text: string, px: number) => text.length * px * 0.55;
const item = (id: string, island: string, found = false) => ({ id, type: 'task', title: `Step ${id}`, open: true, island, ...(found && { found: ['in'] }) });
const link = (type: string, from: string, to: string) => ({ id: `${type}:${from}:${to}`, type, from, to });

/** A home island H of four, each reading two findings on each of five company islands C0..C4 of `size` each. */
function study(size = 3) {
  const home = ['h0', 'h1', 'h2', 'h3'].map((id) => item(id, 'H', true));
  const far = Array.from({ length: 5 }, (_, k) => Array.from({ length: size }, (__, j) => item(`c${k}_${j}`, `C${k}`))).flat();
  const links = [...home.flatMap((h) => [0, 1, 2, 3, 4].flatMap((k) => [link('reads', h.id, `c${k}_0`), link('reads', h.id, `c${k}_1`)])), link('depends_on', 'c0_1', 'c0_0'), link('depends_on', 'h1', 'h0')];
  return { items: [...home, ...far], links, islands: [{ id: 'H', title: 'Home' }, ...[0, 1, 2, 3, 4].map((k) => ({ id: `C${k}`, title: `Company ${k}` }))] };
}
const sized = (most: number, whole: number) => ({ ...house.sizes, flow_fold_most: most, flow_fold_whole: whole });

test('home: the lens’s from, its island, else where most seeds live', () => {
  const answer = study();
  assert.equal(homeOf(answer), 'H', 'most of what was found lives on H');
  assert.equal(homeOf({ ...answer, lens: { from: 'C2' } }), 'C2', 'a from that is an island');
  assert.equal(homeOf({ ...answer, lens: { from: 'c3_1' } }), 'C3', 'a from that lives on an island');
});

test('what folds: the smallest kept whole first, within the whole and the most', () => {
  const items = [...study().items, item('c9_0', 'C9')];
  assert.deepEqual([...foldsOf(items, 'H', { most: 100, whole: 6 }).folds], [], 'all fits: nothing folds');
  assert.deepEqual([...foldsOf(items, 'H', { most: 100, whole: 1 }).folds].sort(), ['C0', 'C1', 'C2', 'C3', 'C4'], 'the one-item island is kept, the rest fold');
  assert.deepEqual([...foldsOf(items, 'H', { most: 10, whole: 6 }).folds].sort(), ['C0', 'C1', 'C2', 'C3', 'C4'], 'past the most: only what fits stays whole');
  assert.ok(!foldsOf(items, 'H', { most: 0, whole: 0 }).folds.has('H'), 'home never folds');
});

test('a folded island: one step of its count that opens it, the links on it, one per type and way', () => {
  const answer = study(), out = folded(answer, sized(100, 0));
  assert.deepEqual(out.folds.sort(), ['C0', 'C1', 'C2', 'C3', 'C4']);
  const shape = out.items.find((i: any) => i.opens === 'C2');
  assert.equal(shape.title, 'Company 2 · 3');
  assert.equal(shape.island, 'C2', 'it stands on its island, framed and named as one');
  assert.equal(out.items.filter((i: any) => i.island === 'C2').length, 1);
  assert.equal(out.links.filter((l: any) => l.to === shape.id).length, 4, 'two reads from each home step are one wire');
  assert.ok(!out.links.some((l: any) => l.from === l.to), 'a link within a folded island goes');
  assert.ok(out.links.some((l: any) => l.from === 'h1' && l.to === 'h0'), 'home links stay as they were');
  assert.equal(folded(answer, sized(100, 9)), answer, 'nothing to fold: the answer as it was');
  assert.throws(() => folded(answer, { ...house.sizes, flow_fold_most: undefined }), /flow_fold_most/);
});

test('the Map draws a folded island as one step that opens it, with no legend of its own', async () => {
  const answer = study(), style = { ...house, sizes: sized(100, 0) };
  const out = await setOut(drawings.find((d) => d.id === 'core.map')!, async (url) => (await import(url('index.js'))).picture({ answer, style, width: 1200, height: 750 }, { measure }));
  const text = JSON.stringify(out.scene.svg);
  for (let k = 0; k < 5; k++) assert.ok(text.includes(`#/e/C${k}`), `C${k} opens from its step`);
  assert.ok(!text.includes('#/e/c1_0'), 'a folded island’s items are not drawn');
  assert.ok(text.includes('#/e/h0'), 'home stays whole');
  assert.equal((text.match(/lf-folded/g) ?? []).length, 5);
});
