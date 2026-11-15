// A layout kept on the map, baked as its document is published (packs/publish/kernel/published-baked.ts): the page's
// baking is kept as an SVG by its hash only for the code that was frozen, a reader is given its address and never the
// SVG in the page, the reader serves it as an image, and the draft does not read as changed for it.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { freezeQuery } from '../packs/publish/kernel/published-pictures.ts';
import { layoutCode, pageData } from '../packs/publish/kernel/published-data.ts';
import { keepBaked, takeBaked, unbaked, withBaked } from '../packs/publish/kernel/published-baked.ts';
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
  const act = async (name: string) => (name === 'public.read' ? { id: D, title: 'Home', parts: [] } : name === 'public.drawing' ? { content_type: 'image/svg+xml', base64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64') } : null);
  const got = (await pageOf({ workspace: 'acme', id: D, what: 'drawing', extra: H }, act, '')) as { picture: { content_type: string; base64: string }; cache: number };
  assert.equal(got.picture.content_type, 'image/svg+xml');
  assert.match(Buffer.from(got.picture.base64, 'base64').toString(), /^<svg /);
  assert.ok(got.cache > 86400);
});

test('a page frame keeps each width as its top, its margins and its foot, cut on channels, each read at its own address', () => {
  const lens = freezeQuery({ items: [], links: [], lens: {}, style: { code } }, new Map());
  const frozen = { title: 'Home', parts: [], lenses: { e_aaaaaaaa: lens } };
  const hash = (lens.style.drawing as { hash: string }).hash;
  const tall = (y: number) => ({ k: 'fill', d: [['M', [10, y]], ['L', [30, y]], ['L', [30, y + 20]], ['Z']], c: '#ff0000', a: 1, clip: 0 });
  const page = { width: 420, height: 1000, clips: [], shapes: [tall(50), tall(400), tall(900)], looks: { red: ['#ff0000', '#ff0000', '#ff0000'] } };
  const kept = withBaked(frozen, { e_aaaaaaaa: { hash, page: [{ width: 420, top: 200, period: 200, foot: 800, baking: page }] } }) as typeof frozen & { svgs: Record<string, string> };
  const frame = (kept.lenses.e_aaaaaaaa.style.drawing as { baked: { page: { svg: Record<string, string>; top: number; foot: number }[] } }).baked.page[0];
  assert.deepEqual([frame.top, frame.foot], [200, 800]);
  assert.match(kept.svgs[frame.svg.top], /viewBox="0 0 420 200"/);
  assert.match(kept.svgs[frame.svg.strip], /viewBox="0 200 420 600"/);
  assert.match(kept.svgs[frame.svg.foot], /viewBox="0 800 420 200"/);
  assert.equal((kept.svgs[frame.svg.top].match(/<path /g) ?? []).length, 1, 'a band keeps only the shapes that reach into it');
  const given = pageData(kept as never, '/p/default/e_bbbbbbbb') as { lenses: Record<string, { style: { drawing: { baked: { page: { src: Record<string, string> }[] } } } }> };
  assert.equal(given.lenses.e_aaaaaaaa.style.drawing.baked.page[0].src.strip, `/p/default/e_bbbbbbbb/drawing/${frame.svg.strip}`);
  assert.throws(() => withBaked(frozen, { e_aaaaaaaa: { hash, page: [{ width: 420, top: 200, period: 250, foot: 800, baking: page }] } }), /whole periods/);
});

test('what was baked may come gzipped, as the page sends it', async () => {
  const { gzipSync } = await import('node:zlib');
  const lens = freezeQuery({ items: [], links: [], lens: {}, style: { code } }, new Map());
  const frozen = { title: 'Home', parts: [], lenses: { e_aaaaaaaa: lens } };
  const hash = (lens.style.drawing as { hash: string }).hash;
  const sent = gzipSync(JSON.stringify({ e_aaaaaaaa: { hash, baking } })).toString('base64');
  assert.equal(Object.keys((withBaked(frozen, sent) as unknown as { svgs: object }).svgs).length, 1);
  assert.throws(() => withBaked(frozen, 'not gzip'), /could not be opened/);
});

test('what a page baked is kept for the publish that follows, once, in its own workspace', () => {
  keepBaked({ workspace: 'default' } as never, 'e_aaaaaaaa', 'packed');
  assert.equal(takeBaked('other', 'e_aaaaaaaa'), undefined, 'another workspace takes nothing');
  assert.equal(takeBaked('default', 'e_aaaaaaaa'), 'packed');
  assert.equal(takeBaked('default', 'e_aaaaaaaa'), undefined, 'taken once');
  assert.throws(() => keepBaked({ workspace: 'default' } as never, 'nope', 'x'), /named by its id/);
});
