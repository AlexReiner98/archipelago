// A layout's code baked once (task e_kcbzmp2g): it paints on a canvas that keeps shapes (packs/walls/page/draw-record.js),
// here with a stand-in for the browser's canvas. Baked through its frame in a real browser: test/bake-frame.test.ts.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

type Recorder = { Canvas: new (w?: number, h?: number) => { getContext(k: '2d'): Record<string, any>; width: number }; shapes: (c: unknown) => { width: number; clips: { d: unknown[]; up: number }[]; shapes: Record<string, any>[] } };
const record = new Function(`${readFileSync('packs/walls/page/draw-record.js', 'utf8')}; return record;`)() as (real: unknown) => Recorder;
// The browser's canvas, as far as the recorder asks it: a colour read back as it was said, and a width per letter.
const real = { fillStyle: '#000000', font: '10px sans-serif', letterSpacing: '0px', measureText: (s: string) => ({ width: s.length * 5 }) };

test('a canvas that records keeps each fill, stroke and text where it lands, as numbers and colours', () => {
  const rec = record(real);
  const canvas = new rec.Canvas(200, 100);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.translate(5, 0);
  ctx.fillStyle = '#ff0000';
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(10, 0); ctx.lineTo(10, 10); ctx.closePath(); ctx.fill();
  ctx.lineWidth = 1.5; ctx.strokeStyle = '#ffffff'; ctx.stroke();
  ctx.fillText('Archipelago', 1, 2);
  assert.equal(ctx.measureText('abc').width, 15, 'text is measured by the real canvas');
  const { shapes } = rec.shapes(canvas);
  assert.deepEqual(shapes[0], { k: 'fill', d: [['M', [10, 0]], ['L', [30, 0]], ['L', [30, 20]], ['Z']], c: '#ff0000', a: 1, clip: 0 });
  assert.equal(shapes[1].k, 'stroke');
  assert.equal(shapes[1].w, 3, 'a line is as wide as it is drawn');
  assert.deepEqual(shapes[2].m, [2, 0, 0, 2, 12, 4]);
  assert.equal(shapes[2].s, 'Archipelago');
  ctx.clearRect(-5, 0, 100, 50);
  assert.equal(rec.shapes(canvas).shapes.length, 0, 'cleared whole, it starts again');
});

test('a picture painted aside and drawn in is kept as its shapes, under the clip it is drawn in', () => {
  const rec = record(real);
  const aside = new rec.Canvas(100, 50);
  const a = aside.getContext('2d');
  a.fillStyle = '#0000ff';
  a.fillRect(10, 10, 20, 20);
  const canvas = new rec.Canvas(200, 100);
  const ctx = canvas.getContext('2d');
  ctx.beginPath(); ctx.rect(0, 0, 150, 100); ctx.clip();
  ctx.drawImage(aside, 0, 0, 200, 100);
  const { clips, shapes } = rec.shapes(canvas);
  assert.equal(clips.length, 1);
  assert.deepEqual(shapes[0].d, [['M', [20, 20]], ['L', [60, 20]], ['L', [60, 60]], ['L', [20, 60]], ['Z']]);
  assert.equal(shapes[0].clip, 1);
  assert.throws(() => ctx.getImageData(0, 0, 1, 1), /outlines/);
});
