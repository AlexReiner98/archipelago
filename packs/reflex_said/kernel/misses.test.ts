import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bumps, missesOf, placeOf, refusals, traps, uncoveredSince, type Node } from './misses.ts';

const node = (id: string, over: Partial<Node> = {}): Node => ({ id, open: true, for: ['tool:change'], misses: [], answers: [], ...over });
const refused = (n: number, at: string, said: string, by = 'write') => ({ n, at, said, did: 'refused', by, about: [] as string[] });

test('a refusal is placed where it happened: a change, a claim, a push', () => {
  assert.equal(placeOf(refused(1, 't', 'Change refused (x): title too long')), 'tool:change');
  assert.equal(placeOf(refused(1, 't', 'Could not claim the live lane', 'surface.claim')), 'tool:assign');
  assert.equal(placeOf(refused(1, 't', 'Refused git push to main: CI is red', 'software')), 'push');
});

test('each miss says what covers it: a phrase, an answers link, a trap itself; a closed node covers nothing', () => {
  const nodes = [node('e_short', { misses: ['title too long'] }), node('e_old', { misses: ['no run'], open: false }), node('e_bumped', { answers: ['e_bump'] }), node('e_trap', { for: ['file:ui/*.js'] })];
  const r = refusals({ e_run: [refused(1, '2026-11-19T10:00:00Z', 'Change refused: title too long'), refused(2, '2026-11-19T11:00:00Z', 'Change refused: no run'), { n: 3, at: '2026-11-19T12:00:00Z', said: 'told', about: [] }] }, nodes);
  assert.deepEqual(r.map((m) => [m.key, m.where, m.covered_by]), [['1', 'tool:change', ['e_short']], ['2', 'tool:change', []]]);
  const b = bumps([{ id: 'e_bump', title: 'Slow look', at: '2026-11-19T09:00:00Z', run: 'e_run' }, { id: 'e_other', title: 'Odd', at: '2026-11-19T08:00:00Z' }], nodes);
  assert.deepEqual(b.map((m) => [m.where, m.covered_by]), [['bump', ['e_bumped']], ['bump', []]]);
  const t = traps([{ id: 'e_trap', title: 'Restart after a new page module', at: '2026-11-19T13:00:00Z', for: ['file:ui/*.js'] }], nodes);
  assert.deepEqual(t.map((m) => [m.kind, m.where, m.covered_by]), [['trap', 'file:ui/*.js', ['e_trap']]]);
  assert.deepEqual(missesOf([r, b, t]).map((m) => m.kind), ['trap', 'refusal', 'refusal', 'bump', 'bump'], 'the newest first');
});

test('missed counts the uncovered refusals since the rule last asked in the run', () => {
  const nodes = [node('e_short', { misses: ['title too long'] })];
  const story = [refused(1, 'a', 'no run'), { n: 2, at: 'b', said: 'write one', asked: 'reflex_said.write_node' }, refused(3, 'c', 'title too long'), refused(4, 'd', 'unknown type')];
  assert.deepEqual(uncoveredSince('e_run', story, 'reflex_said.write_node', nodes).map((m) => [m.run, m.key]), [['e_run', '4']]);
  assert.equal(uncoveredSince('e_run', story.slice(0, 1), 'reflex_said.write_node', nodes).length, 1, 'never asked, all of them');
});
