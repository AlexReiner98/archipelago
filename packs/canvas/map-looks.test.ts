// An island drawn by its own look (packs/canvas/layouts/map/looks.js; feature e_6efhubbz, decisions e_3c3wr7jv and
// e_r4emvndv): the look places what its island holds and paints it, the island's frame grows to hold it, the other
// islands are drawn as before, and a look that throws or answers nothing usable leaves its island drawn as any other.

import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8'));
const house = pack.styles.find((s: any) => s.id === 'core.house').props;
const laid = mkdtempSync(join(tmpdir(), 'pelago-map-looks-'));
for (const [name, file] of Object.entries(pack.layouts.find((d: any) => d.id === 'core.map').modules)) copyFileSync(join(import.meta.dirname, file as string), join(laid, name));
const load = (name: string) => import(pathToFileURL(join(laid, name)).href);
const [{ layout }, { compose, islandModels }, { m }, { draw }] = await Promise.all([load('layout.js'), load('archipelago.js'), load('marks.js'), load('index.js')]);
const measure = (t: string, px: number) => String(t).length * px * 0.55;

const item = (id: string, island: string, cell?: number[]) => ({ id, type: 'task', title: id, open: true, status: 'todo', island, fields: cell ? { cell } : {} });
const items = [item('e_aaaaaaaa', 'e_islandaa', [0, 0]), item('e_bbbbbbbb', 'e_islandaa', [1, 0]), item('e_cccccccc', 'e_islandaa'), item('e_dddddddd', 'e_islandbb', [0, 0])];
const placed = { e_islandaa: [0, 0], e_islandbb: [6, 0] };

/** A look that stands what it holds down one column, far apart, and paints a ring under it. */
const column = {
  island: ({ items: held }: any, { m: mk }: any) => ({
    width: 300, height: 100 * held.length,
    places: Object.fromEntries(held.filter((i: any) => i.id !== 'e_cccccccc').map((i: any, k: number) => [i.id, [150, 50 + 100 * k]])),
    paint: [mk('circle', { cx: 150, cy: 150, r: 140 })],
    items: { e_aaaaaaaa: [mk('circle', { cx: 0, cy: 0, r: 20 })] },
  }),
};

function laidWith(looks: Map<string, any>) {
  const run = (part: any) => layout({ ...part, undrawn: [], headless: house.headless, measure, sizes: house.sizes, aspect: 1.6, shapes: { type: {} }, placed, looks });
  return compose(islandModels({ items, links: [], run }), { legends: new Map(), names: new Map(), sizes: house.sizes });
}
const entry = (look: any) => new Map([['e_islandaa', { look, island: { id: 'e_islandaa', title: 'Here', pack: null }, links: [], numbers: house.numbers, m }]]);

test('a look places what its island holds, and what it leaves stands beside, by cell', () => {
  const g = laidWith(entry(column));
  const [ax, ay, bx, by] = ['e_aaaaaaaa', 'e_bbbbbbbb'].flatMap((id) => [g.x.get(id), g.y.get(id)]);
  assert.equal(ax, bx, 'one column');
  assert.equal(by - ay, 100, 'as far apart as the look says');
  assert.ok(g.x.get('e_cccccccc') > ax + 150, 'what the look left unplaced stands beside what it placed');
  const isle = g.islands.find((i: any) => i.id === 'e_islandaa');
  assert.ok(isle.land[0].r - isle.land[0].l >= 300, 'its frame holds the look');
  assert.equal(isle.look.paint.length, 1, 'what the look paints rides with the island');
});

test('a look that throws or says no size leaves its island drawn by cell', () => {
  const plain = laidWith(new Map());
  for (const look of [{ island: () => { throw new Error('no'); } }, { island: () => ({ places: {} }) }, {}]) {
    const g = laidWith(entry(look));
    assert.deepEqual([...g.x], [...plain.x], 'the same places as with no look');
    assert.equal(g.islands.find((i: any) => i.id === 'e_islandaa').look, undefined);
  }
});

test('the drawing paints the look under its island and draws the items it gives as it says, links kept', () => {
  const style = { ...house, placed };
  const answer = { items, links: [], islands: [{ id: 'e_islandaa', title: 'Here', look: { id: 'e_look0000', kind: 'layout', title: 'Column' } }, { id: 'e_islandbb', title: 'There' }] };
  const tools = { measure, looks: new Map([['e_islandaa', column]]), gestures: () => ({ on: () => [] }) };
  const { scene } = draw({ answer, style, reduced: true, width: 1200, height: 800 }, tools);
  const text = JSON.stringify(scene.svg);
  assert.ok(text.includes('"lf-look"'), 'the paint is drawn');
  assert.ok(text.includes('"lf-look-item"'), 'the item the look draws is drawn as it says');
  assert.ok(text.includes('#/e/e_aaaaaaaa'), 'and still links to its page');
});

test('an island’s own style gives its items their outline there alone', () => {
  const style = { ...house, placed };
  const two = [item('e_aaaaaaaa', 'e_islandaa', [0, 0]), item('e_dddddddd', 'e_islandbb', [0, 0])];
  const answer = { items: two, links: [], islands: [{ id: 'e_islandaa', title: 'Here', style: { type_shapes: { task: 'diamond' } } }, { id: 'e_islandbb', title: 'There' }] };
  const { scene } = draw({ answer, style, reduced: true, width: 1200, height: 800 }, { measure, gestures: () => ({ on: () => [] }) });
  const step = (id: string) => JSON.stringify(find(scene.svg, (k: any) => k[1]?.href === `#/e/${id}`));
  assert.match(step('e_aaaaaaaa'), /"path"/, 'a diamond on the island whose pack says so');
  assert.doesNotMatch(step('e_dddddddd'), /"path"/, 'a box on the other');
});

/** The first mark in a scene that `test` holds of. */
function find(mark: any, test: (k: any) => boolean): any {
  if (!Array.isArray(mark)) return null;
  if (typeof mark[0] === 'string' && test(mark)) return mark;
  for (const kid of mark.slice(typeof mark[0] === 'string' ? 2 : 0)) { const f = find(kid, test); if (f) return f; }
  return null;
}

test('an island’s style says where its focus stands, its outline and size', () => {
  const focusItem = { ...item('e_islandaa', 'e_islandaa'), title: 'The island itself' };
  const held = [focusItem, item('e_aaaaaaaa', 'e_islandaa', [0, 0]), item('e_bbbbbbbb', 'e_islandaa', [1, 0])];
  const drawFocus = (focus: Record<string, unknown> | undefined) => {
    const answer = { items: held, links: [], islands: [{ id: 'e_islandaa', title: 'Here', focus: true, ...(focus && { style: { focus } }) }] };
    return draw({ answer, style: { ...house, placed: { e_islandaa: [0, 0] } }, reduced: true, width: 1200, height: 800 }, { measure, gestures: () => ({ on: () => [] }) }).scene;
  };
  const box = (scene: any, id: string) => find(scene.svg, (k: any) => k[1]?.href === `#/e/${id}`)?.[3];
  const rect = (b: any) => (b?.[0] === 'rect' ? b[1] : null);
  // At the top: over the two others, which now stand lower than it.
  const top = drawFocus({ at: 'top' });
  assert.ok(Number(rect(box(top, 'e_islandaa'))?.y) < Number(rect(box(top, 'e_aaaaaaaa'))?.y), 'the focus stands over the rest');
  // In the corner: left of the rest, on their row.
  const corner = drawFocus({ at: 'corner' });
  assert.ok(Number(rect(box(corner, 'e_islandaa'))?.x) < Number(rect(box(corner, 'e_aaaaaaaa'))?.x), 'the focus stands first');
  // Its outline and size.
  const shaped = drawFocus({ shape: 'hexagon', scale: 2 });
  assert.equal(box(shaped, 'e_islandaa')?.[0], 'path', 'drawn as the outline it says');
  const plain = drawFocus(undefined);
  assert.ok(Number(rect(box(plain, 'e_aaaaaaaa'))?.height) * 2 <= Number(rect(box(drawFocus({ scale: 2 }), 'e_islandaa'))?.height) + 1, 'twice as big');
});

test('a view that says its islands are plain draws none by its own look or layer', () => {
  const answer = { items, links: [], islands: [{ id: 'e_islandaa', title: 'Here', look: { id: 'e_look0000', kind: 'layout' }, style: { type_shapes: { task: 'diamond' } } }, { id: 'e_islandbb', title: 'There' }] };
  const tools = { measure, looks: new Map([['e_islandaa', column]]), gestures: () => ({ on: () => [] }) };
  const own = JSON.stringify(draw({ answer, style: { ...house, placed }, reduced: true, width: 1200, height: 800 }, tools).scene.svg);
  const plain = JSON.stringify(draw({ answer, style: { ...house, placed, island_looks: 'plain' }, reduced: true, width: 1200, height: 800 }, tools).scene.svg);
  assert.ok(own.includes('"lf-look"'));
  assert.ok(!plain.includes('"lf-look"') && !plain.includes('"lf-look-item"'), 'no look drawn');
  assert.doesNotMatch(JSON.stringify(find(JSON.parse(plain), (k: any) => k[1]?.href === '#/e/e_bbbbbbbb')), /"path"/, 'nor the island’s outlines');
});

test('a look that paints is given its island’s frame and a surface, its items marked where it hands their places', async () => {
  (globalThis as any).OffscreenCanvas ??= class { width: number; height: number; constructor(w: number, h: number) { this.width = w; this.height = h; } getContext() { return {}; } };
  const links = [{ from: 'e_dddddddd', to: 'e_aaaaaaaa', type: 'depends_on' }, { from: 'e_aaaaaaaa', to: 'e_bbbbbbbb', type: 'bears_on' }];
  let handed: any = null;
  // A look that settles at once and hands two of its items' places.
  const field = { default: ({ hand }: any) => (handed = hand)({ places: { e_aaaaaaaa: [20, 30, 6], e_bbbbbbbb: [80, 30, 6] } }) };
  const answer = { items, links, islands: [{ id: 'e_islandaa', title: 'Here', look: { id: 'e_look0000', kind: 'layout', coded: true } }, { id: 'e_islandbb', title: 'There' }] };
  const patches: any[] = [];
  const surface = { canvas: { width: 1, height: 1, getContext: () => ({ clearRect() {}, drawImage() {} }) }, size: { width: 1200, height: 800, dpr: 1 }, colours: {}, show() {} };
  const tools = { measure, looks: new Map([['e_islandaa', field]]), gestures: () => ({ on: () => [] }), frame: () => new Promise(() => {}), surface: async () => surface, patch: (list: any[]) => patches.push(...list) };
  const out = draw({ answer, style: { ...house, placed }, reduced: true, width: 1200, height: 800 }, tools);
  assert.deepEqual(out.scene.surface, { key: 'islands-painted' }, 'the scene asks for a surface');
  const svg = JSON.stringify(out.scene.svg);
  assert.match(svg, /"key":"s:e_aaaaaaaa"[^}]*"class":"lf-step[^"]*painted unplaced/, 'its items are marked, hidden until placed');
  assert.ok(svg.includes('#/e/e_dddddddd'), 'the other island’s are drawn as steps');
  out.viewport({ x: 0, y: 0, width: 1200, height: 800 });
  for (let k = 0; k < 5 && !handed; k++) await new Promise((r) => setTimeout(r));
  const at = patches.find((p) => p.key === 'at:e_aaaaaaaa')?.set.transform.match(/[\d.]+/g).map(Number);
  assert.ok(at, 'the item stands where the look handed it');
  assert.ok(patches.some((p) => p.key === 's:e_aaaaaaaa' && p.toggle.unplaced === false), 'and is shown');
  assert.doesNotMatch(svg, /"key":"n:/, 'the link between its own items is its look’s, not the map’s');
  const wires = patches.filter((p) => /^[wn]:/.test(p.key));
  assert.equal(wires.length, 1, 'the wire in from the other island');
  const into = wires.find((p) => p.key.startsWith('w:')).set.d.match(/-?[\d.]+/g).map(Number);
  const off = (x: number, y: number) => Math.abs(Math.hypot(x - at[0], y - at[1]) - 6);
  assert.ok(Math.min(off(into[0], into[1]), off(into.at(-2), into.at(-1))) < 0.01, `the wire in ends on the item’s edge, where the look draws it: ${into} at ${at}`);
  out.end?.();
});
