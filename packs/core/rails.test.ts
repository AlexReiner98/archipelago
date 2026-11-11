// The rails (core.rails, decision e_btxq2nzq): the shipped map's picture, mark for mark, walked stop by stop in the
// view's order. Answer in, marks and stops out: no database. The modules are set out under the names pack.json gives
// them, as the page loads them.

import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8'));
const house = pack.styles.find((s: any) => s.id === 'core.house').props;
const laidOut = async (id: string) => {
  const laid = mkdtempSync(join(tmpdir(), `pelago-${id.replace('.', '-')}-`));
  for (const [name, file] of Object.entries(pack.layouts.find((d: any) => d.id === id).modules)) copyFileSync(join(import.meta.dirname, file as string), join(laid, name));
  return laid;
};
const railsAt = await laidOut('core.rails'), mapAt = await laidOut('core.map');
const { picture } = await import(pathToFileURL(join(railsAt, 'index.js')).href);
const { picture: map } = await import(pathToFileURL(join(mapAt, 'index.js')).href);
const { readingOrder } = await import(pathToFileURL(join(railsAt, 'walk.js')).href);
const measure = (t: string, px: number) => t.length * px * 0.55;
const tools = { measure, patch: () => {}, frame: () => Promise.resolve(0), open: () => {} };
const state = { blocked: false, waits_on: [], sessions: 0, needs_you: false };
const item = (id: string, body?: string) => ({ id, type: 'task', is: ['work'], title: `Stop ${id}`, open: true, status: 'todo', state, ...(body && { body }), fields: {} });
const link = (type: string, from: string, to: string) => ({ id: `r_${type}_${from}_${to}`, type, from, to });
const answer = {
  items: [item('e_aaaaaaaa', '## Why\nskip\n\nThe point of a.\n\nMore.'), item('e_bbbbbbbb'), item('e_cccccccc'), item('e_dddddddd')],
  links: [link('depends_on', 'e_aaaaaaaa', 'e_cccccccc'), link('relates_to', 'e_bbbbbbbb', 'e_dddddddd')],
};
const draw = (a: any, style: any = house) => picture({ answer: a, style, reduced: true }, tools).scene;

/** Every mark of a tree, depth first. */
const marks = (mark: any): any[] => (!Array.isArray(mark) ? [] : typeof mark[0] === 'string' ? [mark, ...mark.slice(2).flatMap(marks)] : mark.flatMap(marks));
/** A tree with the `item` the rails add taken off again. */
const bare = (mark: any): any => (!Array.isArray(mark) ? mark : typeof mark[0] === 'string' ? [mark[0], Object.fromEntries(Object.entries(mark[1] ?? {}).filter(([k]) => k !== 'item')), ...mark.slice(2).map(bare)] : mark.map(bare));

test('the walk reads what an item rests on before it, else as the answer gives them; an order field first', () => {
  assert.deepEqual(readingOrder(answer.items, answer.links).map((i: any) => i.id), ['e_cccccccc', 'e_aaaaaaaa', 'e_bbbbbbbb', 'e_dddddddd']);
  const ranked = answer.items.slice(0, 3).map((i, k) => ({ ...i, fields: { order: 3 - k } }));
  assert.deepEqual(readingOrder(ranked, []).map((i: any) => i.id), ['e_cccccccc', 'e_bbbbbbbb', 'e_aaaaaaaa']);
});

test('the picture is the shipped map\'s, mark for mark, its look and key too', () => {
  const ours = draw(answer), theirs = map({ answer, style: house, reduced: true }, tools).scene;
  assert.deepEqual(bare(ours.svg), theirs.svg);
  assert.equal(ours.css, theirs.css);
  assert.deepEqual(ours.key, theirs.key);
  assert.deepEqual(ours.size, theirs.size);
});

test('each item\'s mark says its item, for the page to light the stop it stands at', () => {
  const said = marks(draw(answer).svg).filter((k) => k[1]?.item).map((k) => k[1].item).sort();
  assert.deepEqual(said, answer.items.map((i) => i.id).sort());
});

test('a stop is the camera on its item\'s place in the map, in the walk\'s order', () => {
  const scene = draw(answer), at = new Map(scene.places.map((p: any) => [p.id, p]));
  assert.deepEqual(scene.stops.map((s: any) => s.id), ['e_cccccccc', 'e_aaaaaaaa', 'e_bbbbbbbb', 'e_dddddddd']);
  for (const s of scene.stops) {
    const p: any = at.get(s.id);
    assert.deepEqual([s.x, s.y], [p.x, p.y]);
    assert.equal(s.span, Math.max(house.sizes.rails_stop_span, p.w + 2 * house.sizes.rails_stop_room));
    assert.equal(s.zoom, scene.size.width / s.span);
  }
  assert.equal(scene.stops[1].note, 'The point of a.');
  assert.deepEqual(scene.whole, { x: scene.size.width / 2, y: scene.size.height / 2, span: scene.size.width, zoom: 1 });
});

test('the camera\'s lengths are the style\'s', () => {
  const wide = draw(answer, { ...house, sizes: { ...house.sizes, rails_stop_span: 5000 } });
  assert.ok(wide.stops.every((s: any) => s.span === 5000));
});

test('an empty answer says so, as the map does', () => {
  assert.deepEqual(draw({ items: [], links: [] }), { message: 'Nothing here yet.' });
});
