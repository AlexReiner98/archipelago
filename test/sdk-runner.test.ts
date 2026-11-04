// The Agent SDK's adapter: the SDK's messages, as a runner receives them, turned into the events of docs/sessions.md.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { checkEvent } from '../src/session-events.ts';

const SCRIPTS = join(import.meta.dirname, '..', 'scripts');
// Plain scripts with no types: what they answer is checked here, by value.
const sdk: any = await import(pathToFileURL(join(SCRIPTS, 'pelago-sdk-runner.mjs')).href);
const ev: any = await import(pathToFileURL(join(SCRIPTS, 'pelago-events.mjs')).href);

// Messages shaped as @anthropic-ai/claude-agent-sdk 0.3 sends them (SDKSystemMessage, SDKAssistantMessage, ...).
const S = 'sess-1';
let clock = 0;
const got = (message: Record<string, unknown>) => ({ at: new Date(Date.UTC(2026, 10, 4, 1, 0, clock++)).toISOString(), message: { session_id: S, uuid: `u${clock}`, ...message } });
const init = () => got({ type: 'system', subtype: 'init', cwd: '/repo', model: 'claude-opus-5-5', tools: ['Bash', 'Edit'], permissionMode: 'default' });
const uses = (...calls: [string, string, unknown][]) => got({ type: 'assistant', parent_tool_use_id: null, message: { id: `m${clock}`, role: 'assistant', content: calls.map(([id, name, input]) => ({ type: 'tool_use', id, name, input })) } });
const says = (text: string, parent: string | null = null) => got({ type: 'assistant', parent_tool_use_id: parent, message: { id: `m${clock}`, role: 'assistant', content: [{ type: 'text', text }] } });
const results = (...rs: [string, string, boolean?][]) => got({ type: 'user', parent_tool_use_id: null, message: { role: 'user', content: rs.map(([id, content, is_error]) => ({ type: 'tool_result', tool_use_id: id, content, ...(is_error && { is_error }) })) } });
const usage = { input_tokens: 120, output_tokens: 40, cache_read_input_tokens: 9000, cache_creation_input_tokens: 300 };
const result = (more: Record<string, unknown>) => got({ type: 'result', subtype: 'success', is_error: false, num_turns: 3, result: '', stop_reason: 'end_turn', total_cost_usd: 0.1, usage, ...more });

test('a prompt run on the SDK: the session, its turn, tools, tests, commit and end', () => {
  const received = [
    init(),
    uses(['a1', 'Edit', { file_path: 'src/a.ts', old_string: 'a', new_string: 'b' }], ['a2', 'Bash', { command: 'npm test -- test/a.test.ts' }]),
    results(['a1', 'ok'], ['a2', 'ℹ tests 3\nℹ pass 3\nℹ fail 0']),
    uses(['a3', 'Bash', { command: 'git commit -m "Make it so"' }]),
    results(['a3', '[claude/x 1a2b3c4] Make it so\n 1 file changed']),
    says('A subagent says this.', 'a9'),
    says('Done. It passes.'),
    result({ result: 'Done. It passes.' }),
  ];
  const events = sdk.sdkEvents(received, { prompt: 'Make it so. Then commit.', turn: 'p1', title: 'Make it', branch: 'claude/x', ended: 'exit' });
  assert.deepEqual(events.map((e: any) => e.kind + (e.tool ? `:${e.tool}` : '')), ['session.start', 'turn.start', 'tool.end:edit', 'tool.end:shell', 'test.run', 'tool.end:shell', 'commit', 'turn.end', 'session.end']);
  assert.deepEqual(events[0], { at: received[0].at, kind: 'session.start', title: 'Make it', branch: 'claude/x' });
  assert.deepEqual(events[1], { at: received[0].at, kind: 'turn.start', turn: 'p1', by: 'person', gist: 'Make it so.' });
  assert.deepEqual(events[2].files, ['src/a.ts']);
  assert.notEqual(events[2].at, events[3].at, 'two calls answered in one message are not the same event');
  assert.deepEqual([events[4].ok, events[4].passed, events[4].failed], [true, 3, 0]);
  assert.deepEqual(events[6], { at: received[4].at, kind: 'commit', turn: 'p1', sha: '1a2b3c4', subject: 'Make it so' });
  assert.deepEqual(events[7], { at: received[7].at, kind: 'turn.end', turn: 'p1', ended: 'done', gist: 'Done.', tokens: { input: 120, output: 40, cache_read: 9000, cache_write: 300 } });
  assert.deepEqual(events[8], { at: received[7].at, kind: 'session.end', reason: 'exit' });
  for (const e of events) assert.ok('event' in checkEvent(e, 'agent-sdk'), `the server keeps ${e.kind}: ${JSON.stringify(checkEvent(e, 'agent-sdk'))}`);
  assert.deepEqual(sdk.sdkEvents(received.slice(0, 3), { prompt: 'Make it so.', turn: 'p1' }), events.slice(0, 5).map((e: any, i: number) => (i === 0 ? { at: e.at, kind: e.kind } : e)), 'read with fewer messages, the start of the same list: the runner sends what is new');
});

test('how a turn ends: on a question, failed, cut off, or stopped by the runner', () => {
  const asked = sdk.sdkEvents([init(), says('Done.\n\nShall I push it?'), result({ result: 'Done.\n\nShall I push it?' })], { prompt: 'x' }).at(-1);
  assert.deepEqual([asked.ended, asked.question], ['asked', 'Shall I push it?']);
  const failed = sdk.sdkEvents([init(), result({ subtype: 'error_max_turns', is_error: true, errors: ['Reached the most turns.'], terminal_reason: 'max_turns' })], { prompt: 'x' }).at(-1);
  assert.deepEqual([failed.ended, failed.gist], ['failed', 'Reached the most turns.']);
  const cut = sdk.sdkEvents([init(), result({ subtype: 'error_during_execution', is_error: true, terminal_reason: 'aborted_tools' })], { prompt: 'x' }).at(-1);
  assert.equal(cut.ended, 'stopped');
  const aborted = sdk.sdkEvents([init(), uses(['b1', 'Bash', { command: 'sleep 100' }])], { prompt: 'x', stopped: { ended: 'stopped' }, ended: 'other' });
  assert.deepEqual(aborted.slice(-2).map((e: any) => [e.kind, e.ended ?? e.reason]), [['turn.end', 'stopped'], ['session.end', 'other']], 'no result: the runner says how it ended');
  assert.deepEqual(sdk.sdkEvents([], { prompt: 'x', stopped: { ended: 'failed' }, ended: 'exit' }), [], 'nothing received, nothing to tell');
});

test('a permission waited on, and a prompt from another session', () => {
  const state = (s: string) => got({ type: 'system', subtype: 'session_state_changed', state: s });
  const events = sdk.sdkEvents([init(), state('running'), state('requires_action'), state('requires_action'), state('running'), result({ result: 'Done.' })], { prompt: 'x', by: 'session', from: 'local_abc', turn: 't9' });
  assert.deepEqual(events.map((e: any) => e.kind), ['session.start', 'turn.start', 'wait.start', 'wait.end', 'turn.end']);
  assert.deepEqual(events[1], { at: events[1].at, kind: 'turn.start', turn: 't9', by: 'session', from: 'local_abc' }, 'only a person has its prompt kept as a gist');
  assert.equal(events[2].for, 'permission');
});

test('what the SDK says before its init opens no turn', () => {
  const events = sdk.sdkEvents([got({ type: 'system', subtype: 'hook_started' }), got({ type: 'system', subtype: 'status', status: null }), init(), result({ result: 'Done.' })], { prompt: 'x' });
  assert.deepEqual(events.map((e: any) => e.kind), ['session.start', 'turn.start', 'turn.end']);
});

test('the request every adapter sends its events with', () => {
  const [url, init_] = ev.eventsPost({ base: 'http://x:3100/', token: 'k', session_id: S, source: 'agent-sdk', events: [{ kind: 'turn.start' }] });
  assert.equal(url, 'http://x:3100/hooks/events');
  assert.equal(init_.headers.authorization, 'Bearer k');
  assert.deepEqual(JSON.parse(init_.body), { session_id: S, source: 'agent-sdk', events: [{ kind: 'turn.start' }] });
  assert.equal(ev.eventsPost({ base: 'http://x', events: [] })[1].headers.authorization, undefined, 'no token, no header');
});
