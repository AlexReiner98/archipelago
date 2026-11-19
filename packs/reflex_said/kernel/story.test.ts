import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storyOf } from './story.ts';

const miss = (at: string, covered_by: string[], where = 'tool:change') => ({ kind: 'refusal' as const, key: at, run: 'e_r', at, where, said: 'refused', covered_by });

test("the story: asked nodes and the presets said beside them, the misses no settled node covers, each saying's verdict", () => {
  const story = storyOf({
    from: '2026-11-01T00:00:00Z', to: '2026-11-30T00:00:00Z',
    asked: [{ id: 'e_trial', kind: 'instruction', pack: 'reflex', tier: 'learned', status: 'trial', for: ['tool:change'] }],
    others: [{ id: 'core.report_in', kind: 'instruction', pack: 'sessions', tier: 'core', for: ['session_start'], title: 'Report in' }, { id: 'canvas.never', kind: 'instruction', pack: 'canvas', tier: 'pack', for: ['tool:x'] }],
    rules: [{ id: 'core.agent_changes', kind: 'rule', pack: 'core', tier: 'core', effect: 'hold', for: ['change'], title: 'Agents wait' }],
    fired: [{ id: 'core.agent_changes', day: '2026-11-18', effect: 'held', n: 2 }],
    sayings: [
      { id: 'e_trial', run: 'e_r', where: 'tool:change', at: '2026-11-19T10:00:00Z' },
      { id: 'core.report_in', run: 'e_r', where: 'session_start', at: '2026-11-19T09:00:00Z' },
      { id: 'e_trial', run: 'e_old', where: 'tool:change', at: '2026-10-01T00:00:00Z' },
    ],
    records: [{ id: 'e_trial', per_run: [{ run: 'e_r', said_at: '2026-11-19T10:00:00Z', said: 1, before: 1, after: 1, verdict: 'failed' }] }],
    misses: [miss('2026-11-19T08:00:00Z', ['e_trial']), miss('2026-11-19T11:00:00Z', []), miss('2026-11-19T12:00:00Z', ['e_current']), miss('2026-10-01T00:00:00Z', [])],
    trials: new Set(['e_trial']),
  });
  assert.deepEqual(story.nodes.map((n) => n.id), ['e_trial', 'core.report_in', 'core.agent_changes'], 'a preset never said in the window is not drawn; every rule is');
  assert.deepEqual(story.fired, [{ id: 'core.agent_changes', day: '2026-11-18', effect: 'held', n: 2 }]);
  assert.deepEqual(story.misses, [{ at: '2026-11-19T08:00:00Z', where: 'tool:change', kind: 'refusal', grew: 'e_trial' }, { at: '2026-11-19T11:00:00Z', where: 'tool:change', kind: 'refusal' }]);
  assert.deepEqual(story.said, [{ id: 'core.report_in', at: '2026-11-19T09:00:00Z', verdict: 'quiet' }, { id: 'e_trial', at: '2026-11-19T10:00:00Z', verdict: 'failed' }]);
});
