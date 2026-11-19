import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, moveOf, movesOf, thresholdsOf } from './promote.ts';

const now = new Date('2026-11-19T12:00:00Z');
const trial = { id: 'e_t', status: 'trial', created_at: '2026-11-15T00:00:00Z' };

test('held often enough with no failure, a trial becomes current', () => {
  assert.deepEqual(moveOf(trial, { failed: 0, held: 1, quiet: 2, last: '2026-11-19T00:00:00Z' }, DEFAULTS, now)?.status, 'current');
  assert.equal(moveOf(trial, { failed: 1, held: 3, quiet: 0, last: '2026-11-19T00:00:00Z' }, DEFAULTS, now), undefined, 'one failure keeps it on trial');
  assert.equal(moveOf(trial, { failed: 0, held: 1, quiet: 0, last: '2026-11-19T00:00:00Z' }, DEFAULTS, now), undefined, 'not yet often enough');
  assert.equal(moveOf({ ...trial, status: 'current' }, { failed: 0, held: 9, quiet: 0, last: '2026-11-19T00:00:00Z' }, DEFAULTS, now), undefined, 'current stays');
});

test('failing more than it holds, unsaid too long, or past its until, it retires', () => {
  assert.match(moveOf({ ...trial, status: 'current' }, { failed: 3, held: 1, quiet: 0, last: '2026-11-19T00:00:00Z' }, DEFAULTS, now)!.why, /came back in 3 runs/);
  assert.equal(moveOf(trial, undefined, DEFAULTS, new Date('2027-01-01T00:00:00Z'))?.status, 'retired', 'never said since it was made');
  assert.match(moveOf({ ...trial, until: '2026-11-18' }, { failed: 0, held: 0, quiet: 0 }, DEFAULTS, now)!.why, /situation ended/);
  assert.equal(moveOf({ ...trial, status: 'retired' }, undefined, DEFAULTS, new Date('2027-01-01T00:00:00Z')), undefined, 'retired stays');
});

test("the owner's thresholds over the defaults, whole numbers only", () => {
  assert.deepEqual(thresholdsOf({ promote_held: 5, retire_failed: 0, retire_unsaid_days: 'x' }), { ...DEFAULTS, promote_held: 5 });
  assert.deepEqual(movesOf([trial, { ...trial, id: 'e_u' }], new Map([['e_t', { failed: 0, held: 5, quiet: 0, last: '2026-11-19T00:00:00Z' }]]), thresholdsOf({ promote_held: 5 }), now).map((m) => [m.id, m.status]), [['e_t', 'current']]);
});
