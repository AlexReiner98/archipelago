import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMiss, records, sayingFacts, sayingsOf, tierOf, type Beat, type Saying } from './record.ts';

const said = (id: string, run: string, at: string, where = 'session_start'): Saying => ({ id, run, where, at });
const refused = (at: string, words: string, about: string[] = []): Beat => ({ at, said: words, about, did: 'refused' });

test('a miss is a refusal holding a phrase the instruction names, or one about what it answers', () => {
  const a = { id: 'e_one', misses: ['Title too long'], answers: ['e_bump'] };
  assert.equal(isMiss(refused('t', 'Change refused (x): title too long, 72 characters'), a), true);
  assert.equal(isMiss(refused('t', 'Change refused (x): no run'), a), false);
  assert.equal(isMiss(refused('t', 'Change refused', ['e_bump']), a), true);
  assert.equal(isMiss({ at: 't', said: 'title too long', did: undefined }, a), false, 'a beat the session told is no refusal');
  assert.equal(isMiss(refused('t', 'title too long'), undefined), false);
});

test('per run: a miss after it was said failed, one only before was held, none is quiet', () => {
  const sayings = [said('e_one', 'r1', '2026-11-19T10:00:00Z'), said('e_one', 'r1', '2026-11-19T11:00:00Z', 'file:src/a.ts'), said('e_one', 'r2', '2026-11-19T10:00:00Z'), said('e_one', 'r3', '2026-11-19T10:00:00Z')];
  const stories = {
    r1: [refused('2026-11-19T10:30:00Z', 'title too long')],
    r2: [refused('2026-11-19T09:00:00Z', 'title too long'), refused('2026-11-19T10:30:00Z', 'something else')],
    r3: [],
  };
  const [one, never] = records(['e_one', 'e_never'], sayings, stories, [{ id: 'e_one', misses: ['title too long'], answers: [] }]);
  assert.deepEqual({ said: one.said, runs: one.runs, places: one.places, last: one.last }, { said: 4, runs: 3, places: { session_start: 3, 'file:src/a.ts': 1 }, last: '2026-11-19T11:00:00Z' });
  assert.deepEqual({ failed: one.failed, held: one.held, quiet: one.quiet }, { failed: 1, held: 1, quiet: 1 });
  assert.deepEqual(one.per_run.find((r) => r.run === 'r1'), { run: 'r1', said_at: '2026-11-19T10:00:00Z', said: 2, before: 0, after: 1, verdict: 'failed' });
  assert.deepEqual(never, { id: 'e_never', said: 0, runs: 0, places: {}, failed: 0, held: 0, quiet: 0, per_run: [] });
});

test('sayings go in as one fact per instruction and come back out', () => {
  const facts = sayingFacts(['e_one', 'core.estimate', 'e_one'], 'e_run', 'session_start');
  assert.deepEqual(facts, [['+', 'e_one', 'said', { run: 'e_run', where: 'session_start' }], ['+', 'core.estimate', 'said', { run: 'e_run', where: 'session_start' }]]);
  const back = sayingsOf([{ at: '2026-11-19T10:00:00Z', facts: [...facts, ['+', 'e_x', 'other', {}], ['-', 'e_one', 'said']] }]);
  assert.deepEqual(back, [said('e_one', 'e_run', '2026-11-19T10:00:00Z'), said('core.estimate', 'e_run', '2026-11-19T10:00:00Z')]);
  assert.deepEqual(sayingsOf([{ at: '2026-11-19T10:00:00Z', facts }], 'e_one'), [said('e_one', 'e_run', '2026-11-19T10:00:00Z')], 'read for one, the others said with it are not its');
});

test("a node's tier: core's, a pack's, the owner's or learned", () => {
  assert.equal(tierOf('core.report_in', undefined, 'sessions'), 'core', "core's name, split into sessions");
  assert.equal(tierOf('core.flat', undefined, 'core'), 'core');
  assert.equal(tierOf('canvas.look', undefined, 'canvas'), 'pack');
  assert.equal(tierOf('e_mine', { type: 'instruction' }, undefined), 'owner');
  assert.equal(tierOf('e_node', { type: 'reflex' }, undefined), 'learned');
});
