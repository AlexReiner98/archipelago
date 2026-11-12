// The hook tool, without a database: it declares its input as a JSON shape and hands the hook to root.hook, naming
// the server pack whose adapter translates it (this pack's id less `_hooks`) and who called.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KernelContext } from '#pelago/kernel';
import { tools } from './hook-tool.ts';

test('the hook tool asks root.hook for the hook of the pack its id names, as its caller', async () => {
  const asked: [string, unknown][] = [];
  const ctx = { pack: { id: 'claude_code_hooks', version: '0.1.0', hash: '' }, call: async (name: string, input: unknown) => (asked.push([name, input]), { told: true }) } as unknown as KernelContext;
  const { hook } = tools();
  assert.deepEqual(hook.input, { event: ['session-start', 'prompt', 'stop'], session_id: 'nonempty', 'cwd?': 'string', 'prompt?': 'string', 'source?': 'string', 'stop_hook_active?': ['boolean', 'string'] });
  assert.deepEqual(await hook.run(ctx, { within: ['e_aaaaaaaa'], may: 'write' }, { event: 'stop', session_id: 's1', stop_hook_active: 'true' }), { told: true });
  assert.deepEqual(await hook.run(ctx, {}, { event: 'prompt', session_id: 's2' }), { told: true });
  assert.deepEqual(asked, [
    ['root.hook', { event: 'stop', session_id: 's1', stop_hook_active: 'true', pack: 'claude_code', within: ['e_aaaaaaaa'], may: 'write' }],
    ['root.hook', { event: 'prompt', session_id: 's2', pack: 'claude_code', within: [] }],
  ]);
});
