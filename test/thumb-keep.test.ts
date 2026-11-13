// When a view's thumbnail is drawn again (ui/thumb-keep.js): only once the view asks for something else or the log
// after the position it was drawn at touches what its answer held.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error a page module, plain JavaScript
import { keyOf, movedOn, readOn } from '../ui/thumb-keep.js';

const asked = 'find=type+task';
const thumb = { key: keyOf('e_view0001', false), asked, pos: 10, ids: ['e_aaaaaaaa', 'e_bbbbbbbb', 'r_link0001', 'e_view0001'], image: 'data:image/svg+xml,' };
const beat = (entries: unknown[], more = {}) => ({ pos: 20, entries, gone: [], made: 0, ...more });
const at = (pos: number, ...facts: unknown[]) => ({ pos, at: '', facts });

test('a thumbnail is kept by its view and scheme', () => {
  assert.notEqual(keyOf('e_view0001', false), keyOf('e_view0001', true));
  assert.notEqual(keyOf('e_view0001', false), keyOf('e_view0002', false));
});

test('it stands while nothing after its position touches what it held, and moves on with the log', () => {
  assert.equal(movedOn(thumb, asked, beat([])), false);
  assert.deepEqual(readOn(thumb, asked, beat([])), { ...thumb, pos: 20 });
  // A fact on something it did not hold, or on what it held from before its position (read from further back for another view).
  assert.equal(movedOn(thumb, asked, beat([at(12, ['+', 'e_cccccccc', 'title', 'x']), at(9, ['+', 'e_aaaaaaaa', 'title', 'x'])])), false);
});

test('it is drawn again once the log touches what it held', () => {
  assert.equal(movedOn(thumb, asked, beat([at(11, ['+', 'e_aaaaaaaa', 'status', 'done'])])), true);
  assert.equal(movedOn(thumb, asked, beat([at(11, ['-', 'r_link0001', 'link', null])])), true);
  // A link made to what it held, from something it did not.
  assert.equal(movedOn(thumb, asked, beat([at(11, ['+', 'r_link0002', 'link', ['depends_on', 'e_cccccccc', 'e_bbbbbbbb']])])), true);
  // The view itself changed: its own item is among what it held.
  assert.equal(movedOn(thumb, asked, beat([at(11, ['+', 'e_view0001', 'props', {}])])), true);
  assert.equal(movedOn(thumb, asked, beat([], { gone: ['e_bbbbbbbb'] })), true);
  assert.equal(readOn(thumb, asked, beat([at(11, ['+', 'e_aaaaaaaa', 'status', 'done'])])), null);
});

test('it is drawn again when it cannot be sure', () => {
  assert.equal(movedOn(null, asked, beat([])), true, 'nothing kept');
  assert.equal(movedOn(thumb, 'find=type+decision', beat([])), true, 'another query or layout');
  assert.equal(movedOn({ ...thumb, pos: null }, asked, beat([])), true, 'an answer not read from the log');
  assert.equal(movedOn(thumb, asked, null), true, 'the log not read');
  assert.equal(movedOn(thumb, asked, beat([], { more: true })), true, 'a read that stopped short');
});
