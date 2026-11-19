// Where a painted island's look paints (packs/canvas/layouts/flow/painted-tiles.js; task e_cr98zz2g, one scene, one
// renderer): a tile of the map's own world, laid by the page's camera with the marks. A pan never changes it; a zoom
// only once the density is far enough off the screen's; an island too big to paint whole is painted for what is in view.
import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-ignore: a pack's drawing code, plain JavaScript
import { camOf, sizeOf, stepOf, tileFor } from '../packs/canvas/layouts/flow/painted-tiles.js';

const isle = { at: [100, 50], size: [400, 250] };
const room = { most: 4_194_304, side: 4096, margin: 0.5 };
const view = (x: number, y: number, scale: number, w = 1200, h = 800) => ({ x, y, width: w / scale, height: h / scale, scale });

test('densities come in steps of √2, never softer than the screen', () => {
  assert.equal(stepOf(1), 1);
  assert.equal(stepOf(2), 2);
  assert.ok(Math.abs(stepOf(1.2) - Math.SQRT2) < 1e-9);
  for (const s of [0.13, 0.7, 1.01, 3.3]) assert.ok(stepOf(s) >= s && stepOf(s) <= s * Math.SQRT2 + 1e-9, `${s} → ${stepOf(s)}`);
});

test('an island that fits is painted whole, and a pan keeps the very same tile', () => {
  const t = tileFor(isle, view(0, 0, 1), 2, null, room);
  assert.deepEqual(t.rect, { x: 100, y: 50, width: 400, height: 250 });
  assert.equal(t.k, 1);
  assert.equal(t.whole, true);
  assert.equal(tileFor(isle, view(-300, 120, 1), 2, t, room), t, 'panned, nothing to paint again');
  assert.equal(tileFor(isle, view(0, 0, 0.8), 2, t, room), t, 'zoomed out a little, the density it has is kept');
  assert.notEqual(tileFor(isle, view(0, 0, 1.1), 2, t, room), t, 'zoomed in past it, a sharper one');
  assert.notEqual(tileFor(isle, view(0, 0, 0.4), 2, t, room), t, 'zoomed out to under half, a lighter one');
});

test('an island out of sight has no tile', () => {
  assert.equal(tileFor(isle, view(5000, 5000, 1), 1, null, room), null);
});

test('an island too big to paint whole is painted for what is in view and its margin, kept until the view leaves it', () => {
  const big = { at: [0, 0], size: [20000, 20000] };
  const t = tileFor(big, view(5000, 5000, 1), 1, null, room);
  assert.equal(t.whole, false);
  assert.ok(t.rect.width * t.rect.height * t.k ** 2 <= 4_194_304, 'within the pixels a tile may hold');
  assert.ok(t.rect.x <= 5000 && t.rect.x + t.rect.width >= 5000 + 1200, 'holds the view across');
  assert.equal(tileFor(big, view(5100, 5050, 1), 1, t, room), t, 'a short pan stays inside it');
  assert.notEqual(tileFor(big, view(9000, 5000, 1), 1, t, room), t, 'a long one paints the new part');
});

test('a look is told where its frame lands on its tile, and its canvas is the tile at its density', () => {
  const t = { rect: { x: 80, y: 40, width: 500, height: 300 }, k: 2, step: 2, whole: false };
  assert.deepEqual(camOf(isle, t), { width: 400, height: 250, k: 2, tx: 40, ty: 20 });
  assert.deepEqual(sizeOf(t, 1.5), { width: 1000, height: 600, dpr: 1.5 });
});
