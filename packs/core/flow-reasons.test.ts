// Why a step needs attention (layouts/flow/reasons.js) is read into where it stands (layouts/flow/state.js), never
// drawn as a word on the step: an answer's reasons in, each item's state and its tip's lines out.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { statesOf } from './layouts/flow/state.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { reasonLines } from './layouts/flow/reasons.js';

test('a reason adds to the state the dot and tint draw', () => {
  const items = [
    { id: 'a', reasons: [{ why: 'to_confirm' }] },
    { id: 'b', reasons: [{ why: 'blocked' }] },
    { id: 'c', reasons: [{ why: 'under_way' }] },
    { id: 'd', reasons: [{ why: 'left' }, { why: 'nonsense' }] },
    { id: 'e' },
  ];
  const s = statesOf({ items });
  assert.equal(s.get('a').you, true, 'what the person acts on waits on them');
  assert.equal(s.get('b').blocked, true);
  assert.equal(s.get('c').phase, 'under_way', 'under way fills the dot by half');
  assert.deepEqual(s.get('d'), { phase: 'not_started', you: false, blocked: false, working: false }, 'a reason with no state draws nothing');
  assert.deepEqual(s.get('e'), s.get('d'));
});

test("a step's reasons are its tip's lines, in their own words where they have them", () => {
  assert.deepEqual(reasonLines({ reasons: [{ why: 'left', said: 'Left doing by a session' }, { why: 'due' }, { why: 'nonsense' }] }), ['Left doing by a session', 'Due']);
});
