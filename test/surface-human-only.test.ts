// A pack's action for a person only (humanOnly in its pack file, as the kernel's own human-only tools): left out of
// what agents are offered, so it costs no request, and refused whole when an agent calls it, by its verb or by name.
// A test pack's launch action stands for one (an action that starts sessions is such).

import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { Registry, type PackFile } from '../packs/loader/kernel/packs.ts';
import { callTool, offeredActions } from '../packs/surface/kernel/tools.ts';
import { agent, freshWith, packsWith } from './map.ts';

const LAUNCHER = {
  id: 'launcher',
  version: '0.1.0',
  title: 'Launcher',
  description: 'A test pack whose actions start sessions: a person’s alone.',
  actions: [
    { id: 'launcher.hold', title: 'Hold briefs', description: 'Hold briefs to run again.', verb: 'capture', humanOnly: true, input: { type: 'object', properties: { tasks: { type: 'array', items: { type: 'string' }, minItems: 1 } }, required: ['tasks'], additionalProperties: false } },
    { id: 'launcher.run', title: 'Run a set', description: 'Run a set again.', verb: 'assign', humanOnly: true, input: { type: 'object', properties: { set: { type: 'string' } }, required: ['set'], additionalProperties: false } },
  ],
} as unknown as PackFile;

test('a pack action for a person is not in the agents’ list, and an agent calling it is refused', async () => {
  const dir = packsWith(LAUNCHER);
  writeFileSync(join(dir, 'launcher', 'handler.js'), 'export default {};\n');
  const l = await freshWith(new Registry(dir));
  assert.equal(l.registry.states.get('launcher')?.state, 'active', String(l.registry.states.get('launcher')?.why));
  const offered = offeredActions(l.registry);
  assert.ok(offered.includes('capture session_start'), 'the list as it is otherwise');
  assert.ok(!offered.some((a) => /launcher\./.test(a)), offered.filter((a) => /launcher/.test(a)).join(', '));
  const capture = (await callTool(l, agent, 'query', { name: 'actions', params: { verb: 'capture' } })) as { action: string }[];
  assert.ok(!capture.some((a) => a.action === 'launcher.hold'), 'nor in what query actions lists to an agent');

  await assert.rejects(callTool(l, agent, 'assign', { action: 'launcher.run', params: { set: 'e_aaaaaaaa' } }), /No action|for humans only/);
  await assert.rejects(callTool(l, agent, 'launcher_hold', { tasks: ['e_aaaaaaaa'] }), /for humans only/);
});
