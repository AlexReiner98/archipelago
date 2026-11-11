// A pack's action for a person only (humanOnly in its pack file, as the kernel's own human-only tools): left out of
// what agents are offered, so it costs no request, and refused whole when an agent calls it, by its verb or by name.
// The refine pack's replay actions are such (they start sessions).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callTool, offeredActions } from '../src/tools.ts';
import { agent, fresh } from './map.ts';

test('a pack action for a person is not in the agents’ list, and an agent calling it is refused', async () => {
  const l = await fresh();
  const offered = offeredActions(l.registry);
  assert.ok(offered.includes('capture session_start'), 'the list as it is otherwise');
  assert.ok(!offered.some((a) => /refine\.replay/.test(a)), offered.filter((a) => /refine/.test(a)).join(', '));
  const capture = (await callTool(l, agent, 'query', { name: 'actions', params: { verb: 'capture' } })) as { action: string }[];
  assert.ok(!capture.some((a) => a.action === 'refine.replay_freeze'), 'nor in what query actions lists to an agent');

  await assert.rejects(callTool(l, agent, 'assign', { action: 'refine.replay', params: { set: 'e_aaaaaaaa', version: 'core@0.1.0' } }), /No action|for humans only/);
  await assert.rejects(callTool(l, agent, 'refine_replay_freeze', { tasks: ['e_aaaaaaaa'] }), /for humans only/);
});
