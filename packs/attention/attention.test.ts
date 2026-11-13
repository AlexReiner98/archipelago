// The attention pack's code, tested without a database: what an item asks of you, and how long ago a time was. The
// part's marks are checked in test/attention-part.test.ts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { askOf, ago, reasonOf } from './parts/attention/rows.js';

test('what an item asks of you, and how long ago', () => {
  assert.equal(askOf({ reasons: [{ why: 'to_confirm', answer: 'flow' }] }).verb, 'Confirm');
  assert.equal(askOf({ reasons: [{ why: 'stale', days: 3 }] }).verb, 'Look');
  assert.equal(askOf({ reasons: [{ why: 'pack.thing', ask: 'Review' }] }).verb, 'Review');
  assert.deepEqual(reasonOf({ why: 'pack.own', mark: 'odd', tip: 'its own' }), ['odd', 'warn', 'its own'], 'a pack’s reason says its own words');
  const now = Date.parse('2026-11-12T12:00:00Z');
  assert.equal(ago('2026-11-12T11:59:30Z', now), 'now');
  assert.equal(ago('2026-11-10T12:00:00Z', now), '2 d');
});
