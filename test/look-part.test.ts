// look_draw's part of the page in look mode (packs/look_draw/parts/page), run as its worker runs it: the canvas's word
// on its drawing in, as its piece's settings, the page state the runtime writes on the root out, and nothing drawn.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import page, { lookOf } from '../packs/look_draw/parts/page/index.js';

const manifest = JSON.parse(readFileSync(new URL('../packs/look_draw/pack.json', import.meta.url), 'utf8'));
const part = manifest.parts.find((p: { id: string }) => p.id === 'look_draw.page');

/** The part mounted with what it is handed, and the page state it published, in order. */
function mounted(input: unknown) {
  const said: [string, unknown][] = [];
  const made = page(input, { state: (name: string, value: unknown) => said.push([name, value]) });
  return { made, said };
}

test('the part fills the slot look, declares only the page state it publishes, and draws nothing', () => {
  assert.equal(part.slot, 'look');
  assert.deepEqual(part.state, ['look', 'look_why']);
  assert.deepEqual(part.marks, []);
  const { made, said } = mounted({ piece: {} });
  assert.equal(made.marks, undefined);
  assert.deepEqual(said, []);
});

test('the word it is handed is said at once, why before the state, and only the first', () => {
  const { made, said } = mounted({ piece: { drawn: 'empty', why: 'The lens found nothing.' } });
  assert.equal(made.update({ piece: { drawn: 'error', why: 'later' } }), undefined);
  assert.deepEqual(said, [['look_why', 'The lens found nothing.'], ['look', 'empty']]);
  assert.deepEqual(mounted({ piece: { drawn: 'drawn' } }).said, [['look', 'drawn']]);
});

test('a state it does not know is drawn, and why is cut short', () => {
  assert.deepEqual(lookOf({ state: 'painted' }), { state: 'drawn', why: null });
  assert.equal(lookOf({ state: 'error', why: 'x'.repeat(400) }).why.length, 300);
  assert.equal(lookOf(undefined), null);
});
