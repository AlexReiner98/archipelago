// A layout kept on the map, baked as its document is published (packs/publish/kernel/published-baked.ts): the page's
// baking is kept as an SVG by its hash only for the code that was frozen, a reader is given its address and never the
// SVG in the page, the reader serves it as an image, and the draft does not read as changed for it.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { freezeQuery } from '../packs/publish/kernel/published-pictures.ts';
import { layoutCode, pageData } from '../packs/publish/kernel/published-data.ts';
import { unbaked, withBaked } from '../packs/publish/kernel/published-baked.ts';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { pageOf } from '../packs/reader/reader.js';

const code = 'export default function draw({ canvas }) { canvas.getContext("2d") }';
const square = (c: string) => ({
  width: 120,
  height: 63,
  clips: [],
  shapes: [{ k: 'fill', d: [['M', [10, 10]], ['L', [30, 10]], ['L', [30, 30]], ['Z']], c, a: 1, clip: 0 }],
});
const baking = { ...square('#ff0000'), looks: { red: ['#ff0000'], blue: ['#0000ff'] }, timing: { every: 1 } };

test('a baking is kept as its SVG, by hash, only for the code that was frozen', () => {
  const lens = freezeQuery({ items: [], links: [], lens: {}, style: { code } }, new Map());
  const frozen = { title: 'Home', parts: [], lenses: { e_aaaaaaaa: lens } };
  const hash = (lens.style.drawing as { hash: string }).hash;
  assert.equal((withBaked(frozen, { e_aaaaaaaa: { hash: 'f'.repeat(64), baking } }) as { svgs?: unknown }).svgs, undefined, 'baked from other code, it is not taken');
  const kept = withBaked(frozen, { e_aaaaaaaa: { hash, baking } }) as typeof frozen & { svgs: Record<string, string> };
  const [svgHash] = Object.keys(kept.svgs);
  const drawing = kept.lenses.e_aaaaaaaa.style.drawing as { baked: { hash: string; width: number; height: number } };
  assert.deepEqual(drawing.baked, { hash: svgHash, width: 120, height: 63 });
  assert.match(kept.svgs[svgHash], /^<svg /);
  assert.deepEqual(unbaked(kept), frozen, 'the draft reads as what was published, baked or not');
  // A reader is given its address and not the SVG; the SVG is read by its hash.
  const given = pageData(kept as never, '/p/default/e_bbbbbbbb') as { svgs?: unknown; lenses: Record<string, { style: { drawing: { baked: { src: string } } } }> };
  assert.equal(given.svgs, undefined);
  assert.equal(given.lenses.e_aaaaaaaa.style.drawing.baked.src, `/p/default/e_bbbbbbbb/drawing/${svgHash}`);
  assert.deepEqual(layoutCode(kept as never, svgHash), { svg: kept.svgs[svgHash] });
  assert.throws(() => withBaked(frozen, { e_aaaaaaaa: { hash, baking: { ...baking, looks: { red: ['red'] } } } }), /colour/);
});

test('the reader serves a baked drawing as an image, kept for good', async () => {
  const D = 'e_dddddddd', H = 'a'.repeat(64);
  const act = async (name: string) => (name === 'public.read' ? { id: D, title: 'Home', parts: [] } : name === 'public.drawing' ? { svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' } : null);
  const got = (await pageOf({ workspace: 'acme', id: D, what: 'drawing', extra: H }, act, '')) as { text: string; type: string; cache: number };
  assert.equal(got.type, 'image/svg+xml');
  assert.match(got.text, /^<svg /);
  assert.ok(got.cache > 86400);
});
