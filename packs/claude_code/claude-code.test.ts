// The claude_code pack, without a database: Claude Code's hooks in and out, the lines of `claude -p` read, and the
// setup it hands out made from this repository's scripts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
// @ts-expect-error A pack's handler is plain JavaScript.
import handler, { hookIn, hookOut, read } from './handler.js';
// @ts-expect-error The same.
import { made, OUT } from './sync.mjs';

test('a hook comes in as the kernel’s event and body; one the kernel does not answer is not asked', () => {
  assert.deepEqual(hookIn({ event: 'prompt', body: { session_id: 's1', prompt: 'hi' } }), { event: 'prompt', body: { session_id: 's1', prompt: 'hi' } });
  assert.deepEqual(hookIn({ event: 'session-start', body: null }), { event: 'session-start', body: { surface: 'claude-code' } }, 'a session starts recorded under its surface');
  assert.deepEqual(hookIn({ event: 'session-start', body: { session_id: 's1', surface: 'other' } }), { event: 'session-start', body: { session_id: 's1', surface: 'claude-code' } }, 'whatever the body says');
  assert.deepEqual(hookIn({ event: 'tool-used', body: {} }), {});
  assert.deepEqual(handler.hook_in({ event: 'stop', body: {} }), { answer: { event: 'stop', body: {} } }, 'the sandbox is answered under answer');
});

test('a neutral answer goes out in Claude Code’s shape: told as additional context, go_on as a block, the rest beside', () => {
  assert.deepEqual(hookOut({ event: 'prompt', answer: { told: 'x', said: ['e_1'] } }), { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'x' }, said: ['e_1'] });
  assert.deepEqual(hookOut({ event: 'session-start', answer: { told: 'y' } }).hookSpecificOutput.hookEventName, 'SessionStart');
  assert.deepEqual(hookOut({ event: 'file-used', answer: { told: 'z' } }).hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.deepEqual(hookOut({ event: 'stop', answer: { go_on: 'why' } }), { decision: 'block', reason: 'why' });
  assert.deepEqual(hookOut({ event: 'events', answer: { run: 'e_r', kept: 2 } }), { run: 'e_r', kept: 2 });
  assert.deepEqual(hookOut({ event: 'session-end', answer: {} }), {});
  assert.deepEqual(hookOut({ event: 'tool-used' }), {});
});

const line = (m: unknown) => read({ line: JSON.stringify(m) });

test('the lines of claude -p are read into what its run records', () => {
  assert.equal(read({ line: 'not json' }), null);
  assert.equal(line({ type: 'system', subtype: 'init' }), null);
  assert.deepEqual(line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Looking' }, { type: 'text', text: 'Found it' }] } }), { said: 'Found it' });
  assert.deepEqual(line({ type: 'assistant', message: { content: [{ type: 'text', text: 'Here' }, { type: 'tool_use', name: 'ExitPlanMode', input: { plan: 'The plan' } }] } }), { said: 'The plan' }, 'a plan before what was said');
  assert.equal(line({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: {} }] } }), null);
  assert.deepEqual(line({ type: 'result', is_error: false, result: 'Done', usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 9999 } }), { done: true, outcome: 'finished', said: 'Done', tokens: 1200 });
  assert.deepEqual(line({ type: 'result', is_error: true, result: '' }), { done: true, outcome: 'failed' }, 'an empty result leaves what was said before as the run’s');
});

test('the launcher names only what the kernel fills', () => {
  const pack = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8'));
  const [headless] = pack.reach.server.launchers;
  const fills = headless.argv.flatMap((a: string) => [...a.matchAll(/\{([a-z_]+)\}/g)].map((m) => m[1]));
  assert.deepEqual(fills, ['mode', 'session_id', 'mcp_config', 'tools', 'model']);
  assert.ok(!headless.argv.some((a: string) => a.includes('{prompt}')), 'the prompt goes on its standard input');
});

test('the setup handed out is made from this repository’s scripts (node packs/claude_code/sync.mjs)', () => {
  assert.equal(readFileSync(OUT, 'utf8'), made(), 'Run node packs/claude_code/sync.mjs and commit files/setup.mjs.');
});

test('the setup, filled, gives the hook its server and its version', async () => {
  const fill: Record<string, unknown> = { origin: 'https://example.test', tokens: true, version: 'abc123def456', rules: '# Rules' };
  const text = (made() as string).replace(/\{(origin|tokens|version|rules)\}/g, (_, n: string) => JSON.stringify(fill[n]));
  // Everything before the setup's own code: what it is handed.
  const head = text.slice(0, text.indexOf('\n// Connect the project'));
  const files = new Function(`${head}\nreturn { FILES, TOKENS };`)() as { FILES: Record<string, string>; TOKENS: boolean };
  assert.equal(files.TOKENS, true);
  assert.match(files.FILES.hook, /const SETUP = 'abc123def456';/);
  assert.match(files.FILES.hook, /process\.env\.PELAGO_URL \|\| "https:\/\/example\.test"/);
  assert.equal(files.FILES.rules, '# Rules');
  assert.match(files.FILES.home, /Workspace: https:\/\/example\.test\./);
  assert.match(files.FILES.skill, /^---\nname: pelago-bump/);
});
