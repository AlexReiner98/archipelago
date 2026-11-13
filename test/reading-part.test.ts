// The publish pack's reading part (packs/publish/parts/reading): a document read whole in, the marks it answers with out,
// each checked as the host checks them (packs/walls/page/part-check.js).

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import reading from '../packs/publish/parts/reading/index.js';
// @ts-ignore: a module of the page, plain JavaScript
import { checkMarks } from '../packs/walls/page/part-check.js';

const doc = {
  parts: [
    { text: 'The point, then e_bbbbbbbb and [its own](e_bbbbbbbb).' },
    { section: { id: 'e_bbbbbbbb', title: 'Where it stands', body: 'A section note.' } },
    { section: { id: 'e_cccccccc', title: 'A figure', body: '', picture: true } },
  ],
  lenses: { e_bbbbbbbb: { items: [], style: {} } },
  links: { e_dddddddd: 'Another page' },
};
const input = (d: unknown, notes?: string) => ({ item: { id: 'e_aaaaaaaa', type: 'document' }, views: { reading: d }, piece: notes ? { notes } : {}, style: { numbers: {}, page: {} } });
/** Every mark of a kind, through the tree. */
const all = (m: any, kind: string): any[] => (Array.isArray(m) ? [...(m[0] === kind ? [m] : []), ...m.slice(1).flatMap((k: unknown) => all(k, kind))] : []);

test('a document reads as its text, and each section folded under its title', () => {
  const part = reading(input(doc));
  checkMarks(part.marks);
  const [note] = all(part.marks, 'note');
  assert.equal(note[2], 'The point, then [Where it stands](e_bbbbbbbb) and [its own](e_bbbbbbbb).', 'a bare id is its name, a named link is left as it is');
  assert.deepEqual(all(part.marks, 'button').map((b) => b[2]), ['▸ Where it stands', '▸ A figure']);
  assert.equal(all(part.marks, 'picture').length, 0, 'folded, a section shows no picture');
});

test('a fold pressed opens its picture and its note; the style may open them all', () => {
  const part = reading(input(doc));
  const open = part.on({ key: 'open:e_bbbbbbbb', name: 'press' });
  checkMarks(open);
  assert.deepEqual(all(open, 'picture').map((p) => p[1].item), ['e_bbbbbbbb']);
  assert.ok(all(open, 'note').some((n) => n[2] === 'A section note.'));
  const whole = reading(input(doc, 'whole')).marks;
  assert.deepEqual(all(whole, 'picture').map((p) => p[1].item), ['e_bbbbbbbb', 'e_cccccccc'], 'a lens and a figure are both pictures');
  assert.equal(part.on({ key: 'open:nothing', name: 'press' }), undefined);
});

test('a document that could not be read says so', () => {
  const part = reading(input(null));
  assert.deepEqual(checkMarks(part.marks).mark, 'text');
  assert.equal(part.update(input(doc))[0], 'box', 'read again, it reads');
});
