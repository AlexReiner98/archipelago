// The flow drawing honours the style's undrawn: a link type it names (core's house style names tagged) draws no tie,
// so an item tagged and nothing else is a step on its own, apart from its tag; a style can turn it back on.

import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8'));
const house = { ...pack.styles.find((s: any) => s.id === 'core.house').props, shape: 'flow' };
const laid = mkdtempSync(join(tmpdir(), 'flow-undrawn-'));
for (const [name, file] of Object.entries(pack.layouts.find((d: any) => d.id === 'core.flow').modules)) copyFileSync(join(import.meta.dirname, file as string), join(laid, name));
const { picture } = await import(pathToFileURL(join(laid, 'index.js')).href);
const measure = (t: string, px: number) => t.length * px * 0.55;
const state = { blocked: false, waits_on: [], sessions: 0, needs_you: false };
const ROOT = 'e_rootzzzz';
const item = (id: string, title: string, inside: string | null = ROOT) => ({ id, kind: 'work', type: 'task', inside, title, place: 0, open: true, status: 'todo', state, within: { items: 0 }, fields: {} });
const answer = {
  lens: { from: ROOT },
  items: [{ ...item(ROOT, 'A process', null), kind: 'aim' }, item('e_askzzzzz', 'Ask'), item('e_planzzzz', 'Plan'), item('e_loosezzz', 'Tagged only', null), { ...item('e_tagzzzzz', 'A tag', null), kind: 'aim', type: 'tag' }],
  links: [
    { kind: 'depends_on', from: 'e_planzzzz', to: 'e_askzzzzz' },
    { kind: 'tagged', from: 'e_loosezzz', to: 'e_tagzzzzz' },
  ],
};
const drawn = (style: any) => JSON.stringify(picture({ answer, style, reduced: true }, { measure, patch: () => {}, frame: () => Promise.resolve(0), open: () => {} }).scene.svg);
const steps = (style: any) => drawn(style).match(/"key":"s:e_[a-z]+"/g)!.map((k) => k.slice(9, -1)).sort();
const ties = (style: any) => (drawn(style).match(/"key":"n:\d+"/g) ?? []).length;

test('the house style draws no tagged tie: what is tagged and nothing else is a step on its own', () => {
  assert.deepEqual(house.undrawn, ['tagged']);
  assert.ok(steps(house).includes('e_loosezzz') && steps(house).includes('e_tagzzzzz'), 'the tagged item and its tag are steps');
  assert.equal(ties(house), 2, 'what is part of the process is tied to it; the tag ties nothing');
});

test('a style that draws every link ties the tagged item to its tag', () => {
  assert.equal(ties({ ...house, undrawn: [] }), 3);
});

test("the key is data the page draws: a row for every link type drawn, in its colour, and no legend of the drawing's own", () => {
  const scene = picture({ answer, style: { ...house, undrawn: [] }, reduced: true }, { measure, patch: () => {}, frame: () => Promise.resolve(0), open: () => {} }).scene;
  assert.equal(scene.legend, undefined, 'the page draws the key');
  assert.ok(Array.isArray(scene.key) && scene.key.every((e: any) => typeof e.label === 'string' && e.glyph?.[0] === 'svg'), 'each row a glyph and its words');
  const labels = scene.key.map((e: any) => e.label);
  for (const label of ['Work', 'Leads to', 'Part of', 'Tagged']) assert.ok(labels.includes(label), `the key says ${label}: ${labels.join(', ')}`);
  // Each link type's row carries the class its wires are drawn in, so the key and the picture cannot disagree.
  const tagged = scene.key.find((e: any) => e.label === 'Tagged');
  const cls = JSON.stringify(tagged.glyph).match(/lf-k-[0-9a-f]+/)?.[0];
  assert.ok(cls && JSON.stringify(scene.svg).includes(cls), 'the tagged tie is drawn in the colour its row shows');
});
