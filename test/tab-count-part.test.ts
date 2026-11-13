// The sessions pack's part sessions.tab_count (packs/sessions/parts/tab_count), run as its worker runs it: a tab's
// session state in words in, the mark the host's check takes out (packs/walls/page/part-check.js).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// @ts-ignore: a module of the page, plain JavaScript
const { checkMarks } = await import('../packs/walls/page/part-check.js');
// @ts-expect-error: a plain module of the pack, with no types of its own.
const { default: part } = await import('../packs/sessions/parts/tab_count/index.js');
const kinds = JSON.parse(readFileSync(new URL('../packs/sessions/pack.json', import.meta.url), 'utf8')).parts.find((p: { id: string }) => p.id === 'sessions.tab_count').marks;

test('the part marks a tab by its session’s state, handed in words as the slot’s piece', () => {
  const draw = (piece: object) => {
    const marks = part({ piece }).marks;
    checkMarks(marks, { kinds });
    return marks;
  };
  assert.deepEqual(draw({ tab: 't1', current: 't0', state: 'waiting', for: 'approval' }), ['text', { look: 'mark', tone: 'accent', tip: 'waits on you: approval' }, '?']);
  assert.deepEqual(draw({ tab: 't1', current: 't0', state: 'your_move' }), ['text', { look: 'mark', tone: 'accent', tip: 'your move' }, '↩']);
  assert.deepEqual(draw({ tab: 't2', current: 't0', state: 'blocked' }), ['text', { look: 'mark', tone: 'bad', tip: 'blocked' }, '⊘']);
  assert.deepEqual(draw({ tab: 't3', state: 'working' }), ['box', {}], 'working draws no mark');
  assert.deepEqual(draw({ tab: 't4' }), ['box', {}], 'the owner’s own tab draws none');
  assert.deepEqual(part({ piece: { tab: 't4' } }).update({ piece: { tab: 't4', state: 'waiting' } }).at(-1), '?', 'drawn again as its state changes');
});
