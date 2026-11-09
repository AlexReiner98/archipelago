// The measures a layout's picture is scored by (scripts/measures/, task e_tgmq6ffu), without a database: small scenes
// of marks in, as flow's scene draws them, a picture and its numbers out.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bends, detour, moved, names, ribbon, through, upward } from '../scripts/measures/measures.ts';
import { pathPoints, readScene, type Picture } from '../scripts/measures/read.ts';
import { table } from '../scripts/measures/page.ts';
import { markup } from '../scripts/measures/render.ts';

const m = (tag: string, attrs: Record<string, unknown> = {}, ...kids: unknown[]) => [tag, attrs, ...kids];
/** A step as flow's scene draws it: a link holding its outline and its name. */
const step = (id: string, x: number, y: number, w = 100, h = 40, title = `Step ${id}`) =>
  m('a', { key: `s:${id}`, class: 'lf-step' }, m('title', {}, `${title}\nIts note`), m('rect', { x, y, width: w, height: h, class: 'lf-shape' }), m('text', { x: x + 8, y: y + h / 2 }, title));
const wire = (n: number, d: string, order = true) => m('path', { key: `${order ? 'w' : 'n'}:${n}`, d, class: order ? 'lf-wire' : 'lf-tie near' });
const scene = (...kids: unknown[]) => ({ svg: m('svg', { viewBox: '0 0 800 600' }, ...kids), size: { width: 800, height: 600 } });
const px = { text: 13, stub: 12 };

test('a path is read as its points, a curve and an arc by their ends', () => {
  assert.deepEqual(pathPoints('M0 0H10V5L20 5Z').points, [[0, 0], [10, 0], [10, 5], [20, 5], [0, 0]]);
  assert.deepEqual(pathPoints('M0 0C1 1 2 2 3 3A4 4 0 0 0 5 6').points, [[0, 0], [3, 3], [5, 6]]);
});

test('steps, names and wires are read off the marks, a wire broken where it passes under read whole', () => {
  const pic = readScene(scene(step('a', 0, 0), step('b', 0, 200), wire(0, 'M50 40L50 100M50 110L50 200')), px);
  assert.deepEqual(pic.boxes.map((b) => b.id), ['a', 'b']);
  assert.deepEqual(pic.names[0], { id: 'a', text: 'Step a', cut: false, px: 13 });
  assert.equal(pic.wires.length, 1);
  assert.deepEqual(pic.wires[0], { order: true, part: false, points: [[50, 40], [50, 200]], a: 'a', b: 'b' });
});

const pic = (boxes: [string, number, number][], wires: { points: number[][]; a: string; b: string; order?: boolean }[], size = [800, 600]): Picture => ({
  width: size[0], height: size[1],
  boxes: boxes.map(([id, x, y]) => ({ id, l: x, r: x + 100, t: y, u: y + 40 })),
  names: boxes.map(([id]) => ({ id, text: id, cut: false, px: 13 })),
  wires: wires.map((w) => ({ order: w.order ?? true, part: false, ...w })),
});

test('an order wire running up is counted, with the side it comes back on', () => {
  const down = pic([['a', 0, 0], ['b', 0, 200]], [{ a: 'a', b: 'b', points: [[50, 40], [50, 200]] }]);
  assert.deepEqual(upward(down), { order: 1, up: 0, left: 0, right: 0, oneSide: true });
  const back = pic([['a', 0, 200], ['b', 0, 0], ['c', 300, 200], ['d', 300, 0]], [
    { a: 'a', b: 'b', points: [[0, 220], [-20, 220], [-20, 20], [0, 20]] },
    { a: 'c', b: 'd', points: [[400, 220], [420, 220], [420, 20], [400, 20]] },
  ]);
  assert.deepEqual(upward(back), { order: 2, up: 2, left: 1, right: 1, oneSide: false });
});

test('bends, slants and detour are read per wire', () => {
  const p = pic([['a', 0, 0], ['b', 200, 200]], [{ a: 'a', b: 'b', points: [[50, 40], [50, 120], [250, 120], [250, 200]] }, { a: 'a', b: 'b', points: [[100, 20], [200, 220]] }]);
  assert.deepEqual(bends(p), { mean: 1, most: 2, slanted: 1 });
  const wander = pic([['a', 0, 0], ['b', 0, 200]], [{ a: 'a', b: 'b', points: [[50, 40], [50, 60], [300, 60], [300, 180], [50, 180], [50, 200]] }]);
  assert.equal(detour(wander).mean, (20 + 250 + 120 + 250 + 20) / 160);
});

test('a ribbon is wires side by side, each within the gap of the next; one trunk is one', () => {
  const run = (x: number) => ({ a: 'a', b: 'b', points: [[x, 100], [x, 400]] });
  const p = pic([['a', 0, 0], ['b', 0, 500]], [run(10), run(20), run(30), run(30), run(90)]);
  assert.equal(ribbon(p, 12).most, 3);
});

test('a wire through a step that is not its end is counted', () => {
  const p = pic([['a', 0, 0], ['b', 0, 100], ['c', 0, 200]], [{ a: 'a', b: 'c', points: [[50, 40], [50, 200]] }]);
  assert.equal(through(p), 1);
});

test('names are readable when a whole view fits the screen at a size the eye reads', () => {
  assert.equal(names(pic([['a', 0, 0]], [], [800, 600])).share, 1);
  const big = names(pic([['a', 0, 0]], [], [3200, 1000]));
  assert.equal(big.scale, 0.5);
  assert.equal(big.share, 0);
});

test('a picture that only shifts has not moved; an item that jumps has', () => {
  const before = pic([['a', 0, 0], ['b', 0, 100], ['c', 0, 200]], []);
  assert.deepEqual(moved(before, pic([['a', 40, 0], ['b', 40, 100], ['c', 40, 200], ['n', 0, 300]], [])), { mean: 0, share: 0, items: 3 });
  assert.equal(moved(before, pic([['a', 0, 0], ['b', 300, 100], ['c', 0, 200]], [])).share, 1 / 3);
});

test('a view is a table with the layouts as columns; a failed one says so', () => {
  const t = table({ name: 'v', lens: 'e_x', layouts: { 'core.flow': { error: 'broke' } } });
  assert.match(t, /\| \| flow \| better \|/);
  assert.match(t, /flow failed: broke/);
  assert.equal(markup(m('svg', { key: 'k' }, [m('g', {}, 'a<b')])), '<svg xmlns="http://www.w3.org/2000/svg"><g>a&lt;b</g></svg>');
});
