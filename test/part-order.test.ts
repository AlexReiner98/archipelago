// The order a part hears the page in, without a page (packs/surface/page/part-order.js, packs/walls/page/part-echo.js):
// hands delivered in the order begun, a field's words never taken by an answer behind them, and a press that lands on
// what was pressed though the part has moved its marks since.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-ignore: modules of the page, plain JavaScript
import { inOrder, pressedIn, pressesHeld } from '../packs/surface/page/part-order.js';
// @ts-ignore
import { setsField } from '../packs/walls/page/part-echo.js';
// @ts-ignore
import { checkMarks } from '../packs/walls/page/part-check.js';

const later = <T>(value: T, ms: number) => new Promise<T>((r) => setTimeout(() => r(value), ms));

test('a hand begun later is never followed by one begun before it', async () => {
  const got: [string, boolean][] = [];
  const hand = inOrder((value: string, first: boolean) => void got.push([value, first]));
  // The older lens is slow to read and finishes last: it is dropped, not delivered after the newer.
  const older = hand(() => later('old', 40));
  const newer = hand(() => later('new', 5));
  assert.deepEqual(await Promise.all([older, newer]), [false, true]);
  assert.deepEqual(got, [['new', true]], 'the newer goes first, as the mount, and the older never');
  // In order, each is delivered, only the first as the mount.
  await hand(() => later('a', 1));
  await hand(() => later('b', 1));
  assert.deepEqual(got.map(([v, f]) => `${v}${f ? '!' : ''}`), ['new!', 'a', 'b']);
  // One that could not be sent (its place left the page) delivers nothing, and an older may still follow the last sent.
  const refused = inOrder(() => false);
  assert.equal(await refused(() => later('x', 1)), false);
});

test("a field's words are set only by an answer that had heard them", () => {
  // Typed, sent as message 7; the part answers with what it drew at 5, before it heard them: let be, focused or not.
  assert.equal(setsField('', 'gutters', 7, 5), false, 'a stale answer never empties what was typed');
  assert.equal(setsField('gut', 'gutters', 7, 6), false, 'nor sets an earlier word');
  // Once it had heard them, its value is its own: the field emptied once its words were taken, even in focus.
  assert.equal(setsField('', 'only ', 7, 7), true, 'cleared on purpose');
  assert.equal(setsField('', 'only ', 7, 9), true);
  assert.equal(setsField('only ', 'only ', 7, 9), false, 'the same words, nothing to set');
  // A field that sent nothing, or a page with no part numbering (a page drawn as it was kept), takes what it is told.
  assert.equal(setsField('x', 'y', undefined, 3), true);
  assert.equal(setsField('x', 'y', 4, undefined), true);
});

test('a press lands on what was pressed, though the part drew it under another key since', () => {
  const row = (terms: string[]) => checkMarks(['box', { flow: 'row' }, ...terms.map((t, i) => ['box', { key: `t${i}` }, ['text', {}, t], ['button', { key: `x:find:${i}`, label: `Take out ${t}` }, '×']])]);
  const before = row(['walls', 'gutters']);
  const pressed = before.kids[1].kids[1];
  assert.equal(pressed.key, 'x:find:1');
  // Unmoved: its own key.
  assert.equal(pressedIn(row(['walls', 'gutters']), pressed), 'x:find:1');
  // Walls taken out before the press reached the part: gutters is now the first, and the press goes there.
  assert.equal(pressedIn(row(['gutters']), pressed), 'x:find:0');
  // Gone: the press is taken for nothing else.
  assert.equal(pressedIn(row(['walls']), pressed), null);
  // A tip or a tone that changed is the same thing.
  const toned = checkMarks(['box', {}, ['button', { key: 'save', label: 'Save', tip: 'Save 3 changes' }, 'Save']]);
  const pressedSave = checkMarks(['box', {}, ['button', { key: 'save', label: 'Save', tip: 'Save 2 changes' }, 'Save']]).kids[0];
  assert.equal(pressedIn(toned, pressedSave), 'save');
});

test('a press made on marks the part has moved past waits for its answer, then goes where what was pressed now is', async () => {
  const sent: { key: string }[] = [];
  let n = 0;
  const held = pressesHeld((event: { key: string }) => (sent.push(event), ++n));
  const row = (terms: string[]) => checkMarks(['box', {}, ...terms.map((t, i) => ['button', { key: `x:${i}`, label: `Take out ${t}` }, '×'])]);
  const drawn = row(['walls', 'gutters']);
  held.heard(1, drawn);
  // Caught up: a press goes at once.
  held.tell({ key: 'x:1', name: 'press' }, drawn.kids[1]);
  assert.deepEqual(sent.map((e) => e.key), ['x:1']);
  // Handed a newer page (message 5) the part has not answered: the press waits, then goes to gutters' new key.
  held.handed(5);
  held.tell({ key: 'x:1', name: 'press' }, drawn.kids[1]);
  assert.equal(sent.length, 1, 'held');
  held.heard(5, row(['gutters']));
  assert.deepEqual(sent.map((e) => e.key), ['x:1', 'x:0']);
  // A field's words never wait, and are answered with their number.
  held.handed(9);
  assert.equal(held.tell({ key: 'q', name: 'edit', value: 'a' }), 3);
  // A part that drew nothing new for the page still says it heard it, and the press goes.
  held.tell({ key: 'x:0', name: 'press' }, row(['gutters']).kids[0]);
  held.heard(9);
  assert.deepEqual(sent.map((e) => e.key).slice(-1), ['x:0']);
});
