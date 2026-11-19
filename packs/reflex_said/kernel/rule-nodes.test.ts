import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectOf, firingsOf, placeOf, ruleNodes, rulesRead } from './rule-nodes.ts';

test("a rule's place is read off its when, its effect off its then", () => {
  assert.equal(placeOf({ when: { op: 'update', type: 'task', fields: ['status'] } }), 'tool:change:task:status');
  assert.equal(placeOf({ when: { op: ['create', 'update'], capability: 'promised' } }), 'tool:change:has.promised');
  assert.equal(placeOf({ when: { type: 'task' } }), 'tool:change:task');
  assert.equal(placeOf({ on: 'reply_ended', when: { reply: { missed: 1 } } }), 'reply_ended:missed');
  assert.equal(placeOf({ on: 'push' }), 'push');
  assert.equal(placeOf({ when: { actor: 'agent', fields: ['code'] } }), 'tool:change', 'fields with no type: any type');
  assert.deepEqual(['hold', { require: ['x'] }, { carry: {} }, undefined].map(effectOf), ['hold', 'requires', 'carry', 'other']);
});

test('the rules in force as nodes: what guards, by pack; a retention rule is none', () => {
  const nodes = ruleNodes([
    { id: 'agent_changes', pack: 'core', then: 'hold', say: 'An agent\'s change waits. For the owner.', when: { actor: 'agent' } },
    { id: 'said', pack: 'reflex_said', stream: 'pack:reflex_said', when: {} },
    { id: 'write_node', pack: 'reflex_said', on: 'reply_ended', then: 'ask', say: 'A refusal no reflex covers came up: write one', when: { reply: { missed: 1 } } },
  ]);
  assert.deepEqual(nodes, [
    { id: 'core.agent_changes', kind: 'rule', pack: 'core', tier: 'core', effect: 'hold', for: ['tool:change'], title: "An agent's change waits" },
    { id: 'reflex_said.write_node', kind: 'rule', pack: 'reflex_said', tier: 'pack', effect: 'ask', for: ['reply_ended:missed'], title: 'A refusal no reflex covers came up' },
  ]);
});

test('firings are the uses counts of these rules, by day and effect, in the window', () => {
  const entries = [
    { facts: [['+', 'key:held:core.agent_changes', '2026-11-18', 2], ['+', 'key:refused:core.agent_changes', '2026-11-18', 1], ['+', 'key:told:core.estimate', '2026-11-18', 4]] },
    { facts: [['+', 'key:held:core.agent_changes', '2026-11-18', 3], ['+', 'key:held:core.agent_changes', '2026-10-01', 9], ['+', 'key:held:other.rule', '2026-11-18', 1], ['+', 'key:refused:build.build.lane_branch', '2026-11-19', 2]] },
  ];
  assert.deepEqual(firingsOf(entries, new Set(['core.agent_changes', 'build.lane_branch']), ['2026-11-01', '2026-11-30']), [
    { id: 'core.agent_changes', day: '2026-11-18', effect: 'held', n: 5 },
    { id: 'core.agent_changes', day: '2026-11-18', effect: 'refused', n: 1 },
    { id: 'build.lane_branch', day: '2026-11-19', effect: 'refused', n: 2 },
  ]);
  const lane = ruleNodes([{ id: 'build.lane_branch', pack: 'build', then: 'refuse', when: { type: 'task' } }]);
  assert.equal(lane[0].id, 'build.lane_branch', "a hosted pack's rule named once");
  assert.deepEqual(rulesRead(lane, [{ id: 'build.lane_branch', day: '2026-11-19', effect: 'refused', n: 2 }]), [
    { id: 'build.lane_branch', title: 'build.lane_branch', pack: 'build', effect: 'refuse', where: 'tool:change:task', fired: ['2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z'] },
  ]);
});
