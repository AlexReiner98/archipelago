// A layout kept on the map is published with its code: freezing keeps it as a drawing by its hash, the page is given
// the address it is fetched from, and the code is served by that hash (packs/publish/kernel/published-pictures.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { codeDrawing, freezeQuery } from '../packs/publish/kernel/published-pictures.ts';
import { layoutCode, pageData } from '../packs/publish/kernel/published-data.ts';

const code = 'export default function draw({ canvas }) { canvas.getContext("2d") }';

test('a layout kept on the map is frozen as a drawing of its code, by hash', () => {
  const frozen = freezeQuery({ items: [], links: [], lens: {}, style: { shape: 'flow', code } }, new Map());
  const drawing = frozen.style.drawing as { hash: string; modules: Record<string, string>; coded: boolean };
  assert.equal((frozen.style as Record<string, unknown>).code, undefined, 'its code is not left in the style');
  assert.equal(drawing.coded, true);
  assert.deepEqual(drawing.modules, { 'index.js': code });
  assert.match(drawing.hash, /^[0-9a-f]{64}$/);
  // Files by path keep their paths, and the same files give the same hash whatever their order.
  const files = codeDrawing({ 'util.js': 'export const x = 1', 'index.js': code });
  assert.equal(files?.hash, codeDrawing({ 'index.js': code, 'util.js': 'export const x = 1' })?.hash);
  assert.equal(codeDrawing(''), undefined, 'no code, no drawing');
  assert.equal(codeDrawing({ 'util.js': 'x' }), undefined, 'files need their index.js');
});

test('a published page fetches that code by its hash', () => {
  const frozen = freezeQuery({ items: [], links: [], lens: {}, style: { code } }, new Map());
  const doc = { title: 'Home', parts: [], lenses: { e_aaaaaaaa: frozen } };
  const hash = (frozen.style.drawing as { hash: string }).hash;
  const given = pageData(doc as never, '/p/default/e_bbbbbbbb') as { lenses: Record<string, { style: { drawing: Record<string, unknown> } }> };
  assert.equal(given.lenses.e_aaaaaaaa.style.drawing.modules, undefined, 'the code is not in the page');
  assert.equal(given.lenses.e_aaaaaaaa.style.drawing.src, `/p/default/e_bbbbbbbb/drawing/${hash}`);
  assert.equal(given.lenses.e_aaaaaaaa.style.drawing.coded, true);
  assert.deepEqual(layoutCode(doc as never, hash), { 'index.js': code });
});
