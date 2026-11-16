// Real canvases keep their pictures (task e_kp7cyrfg): each answer in corpus/ is a canvas of the live map, made anonymous,
// with the hash of the picture core.map draws for it. A change to the layout that moves no picture passes; one that moves
// any fails, naming each canvas and its new hash. A picture that changes is shown to the owner before its hash is.
//
// The answers are made anonymous keeping all the layout reads: ids renumbered in their sort order (the layout breaks
// ties by id), every text replaced by filler of the same length with its spaces kept (the layout measures text by its
// length and wraps at spaces), and each item cut to its type, kind, status, phase, island and the like. Each was drawn
// against the real answer it came from: the same picture, point for point. Input in, marks out: no database.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8'));
const house = { ...pack.styles.find((s: any) => s.id === 'core.house').props, shape: 'flow' };
const laid = mkdtempSync(join(tmpdir(), 'pelago-map-corpus-'));
for (const [name, file] of Object.entries(pack.layouts.find((d: any) => d.id === 'core.map').modules)) copyFileSync(join(import.meta.dirname, file as string), join(laid, name));
const { layout } = await import(pathToFileURL(join(laid, 'layout.js')).href);
const measure = (t: string, px: number) => t.length * px * 0.55;

const corpus = join(import.meta.dirname, 'corpus');
const canvases = readdirSync(corpus).filter((f) => f.endsWith('.json')).sort();

/** The picture's hash: every place and every wire's points. */
const pictureOf = (answer: { items: any[]; links: any[] }) => {
  const g = layout({ items: answer.items, links: answer.links, undrawn: house.undrawn, measure, sizes: house.sizes });
  return createHash('sha1').update(JSON.stringify([[...g.x], [...g.y], g.chains.map((p: any) => p.points), g.ties.map((p: any) => p.points)])).digest('hex').slice(0, 12);
};

test('the corpus holds real canvases of every size', () => {
  assert.ok(canvases.length >= 12, `${canvases.length} canvases`);
  const sizes = canvases.map((f) => JSON.parse(readFileSync(join(corpus, f), 'utf8')).items.length);
  assert.ok(Math.min(...sizes) < 20 && Math.max(...sizes) >= 150, `sizes ${sizes.join(', ')}`);
});

test('each canvas is drawn as it was', () => {
  const moved = [];
  for (const f of canvases) {
    const { picture, ...answer } = JSON.parse(readFileSync(join(corpus, f), 'utf8'));
    const now = pictureOf(answer);
    if (now !== picture) moved.push(`${f}: ${picture} → ${now}`);
  }
  assert.deepEqual(moved, [], `pictures moved:\n${moved.join('\n')}`);
});
