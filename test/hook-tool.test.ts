// A session's hooks called over MCP (report, action hook, src/hook-tool.ts): what the plugin directory's build calls
// from its mcp_tool hooks, answered as /hooks/<event> is, in Claude Code's shape; a session it has not heard of starts
// at its first prompt, since Claude Code runs no mcp_tool hook at launch.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { serve } from './serve.ts';

test('a hook called over the tools is answered as /hooks/ answers it, and a session unheard of starts at its first prompt', async () => {
  const { call } = await serve('off');
  const hook = async (params: Record<string, unknown>) => {
    const answered = await call('/agent/report', undefined, { action: 'hook', params });
    assert.equal(answered.status, 200, answered.error);
    return answered.result;
  };

  const first = await hook({ event: 'prompt', session_id: 'mcp-hook-1', cwd: process.cwd(), prompt: 'Where do things stand?' });
  assert.equal(first.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(first.hookSpecificOutput.additionalContext, /\S/, 'the session was told where it stands');
  assert.match(first.hookSpecificOutput.additionalContext, /## Before you finish/, 'and handed the working rules, with no file read');
  assert.doesNotMatch(first.hookSpecificOutput.additionalContext, /pelago-bump/, 'without the bump skill, which ships with no plugin');
  const run = await call('/agent/report', undefined, { action: 'session_update', params: { run: 'mcp-hook-1' } });
  assert.equal(run.status, 200, run.error);
  assert.match(run.result.run, /^e_/, 'the session is registered as a run');

  // Its next prompt does not start it again: a prompt is a prompt.
  const again = await hook({ event: 'prompt', session_id: 'mcp-hook-1', cwd: process.cwd(), prompt: 'And now?' });
  assert.ok(!JSON.stringify(again).includes(first.hookSpecificOutput.additionalContext.slice(0, 80)), 'not told its start twice');

  // A turn's end with no rule asking to go on is answered with nothing, in Claude Code's shape; stop_hook_active as a string is read.
  const stopped = await hook({ event: 'stop', session_id: 'mcp-hook-1', stop_hook_active: 'false' });
  assert.equal(stopped.hookSpecificOutput, undefined);

  // An event it does not answer is refused before anything runs.
  assert.notEqual((await call('/agent/report', undefined, { action: 'hook', params: { event: 'session-end', session_id: 'mcp-hook-1' } })).status, 200);
});
