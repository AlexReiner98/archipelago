// Scrolling moves along the rails (public/rails.js): where the camera stands for a place on the page, and how a
// camera is framed in the room the cards leave. Plain functions, run without a page.

import assert from 'node:assert/strict';
import test from 'node:test';
// @ts-expect-error a page's script is plain JavaScript
import { cameraAt, framing, wholeIn } from './public/rails.js';

const cameras = [{ x: 500, y: 300, span: 1000 }, { x: 100, y: 100, span: 250 }, { x: 400, y: 100, span: 250 }];
const marks = [0, 1000, 2000];

test('the camera is on the whole before the walk, on each stop at its mark, and on the last after', () => {
  assert.deepEqual(cameraAt(cameras, marks, -50), cameras[0]);
  assert.deepEqual(cameraAt(cameras, marks, 1000), { ...cameras[1], k: 1 });
  assert.deepEqual(cameraAt(cameras, marks, 9000), { ...cameras[2], k: 2 });
});

test('between two stops it moves straight across and zooms evenly, eased at both ends', () => {
  const half = cameraAt(cameras, marks, 1500, 1);
  assert.deepEqual([half.x, half.y, half.span], [250, 100, 250]);
  const straight = cameraAt(cameras, marks, 250, 0), eased = cameraAt(cameras, marks, 250, 1);
  assert.equal(straight.x, 400);
  assert.equal(straight.span, 1000 * (250 / 1000) ** 0.25);
  assert.ok(eased.x > straight.x, 'eased, it leaves slowly');
  assert.equal(cameraAt(cameras, marks, 400).k, 0);
  assert.equal(cameraAt(cameras, marks, 600).k, 1, 'the stop nearer is the one lit');
});

test('a camera is centred in the room right of the cards, its span across that room', () => {
  const f = framing({ x: 100, y: 50, span: 400 }, { left: 400, width: 1200, height: 800 });
  assert.equal(f.scale, 2);
  assert.equal(f.x + 100 * f.scale, 800, 'centre of 400..1200');
  assert.equal(f.y + 50 * f.scale, 400);
});

test('the whole is framed wide enough for all of a tall picture to fit', () => {
  assert.equal(wholeIn({ x: 0, y: 0, span: 600 }, { height: 300 }, 800, 800).span, 600);
  assert.equal(wholeIn({ x: 0, y: 0, span: 600 }, { height: 1600 }, 800, 800).span, 1600);
});
