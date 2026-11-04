// Claude Code's adapter: what its hooks are given and what its transcript holds, as the events of docs/sessions.md.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const SCRIPTS = join(import.meta.dirname, '..', 'scripts');
// A plain script with no types: what it answers is checked here, by value.
const ev: any = await import(pathToFileURL(join(SCRIPTS, 'pelago-events.mjs')).href);

let clock = 0;
const at = () => new Date(Date.UTC(2026, 10, 4, 0, 0, clock++)).toISOString();
const prompt = (promptId: string, text: string) => ({ type: 'user', uuid: `u-${promptId}`, promptId, timestamp: at(), message: { role: 'user', content: text } });
const use = (promptId: string, id: string, name: string, input: unknown, usage?: Record<string, number>) => ({
  type: 'assistant', promptId, timestamp: at(), message: { id: `m-${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name, input }], ...(usage && { usage }) },
});
const result = (promptId: string, id: string, content: string, is_error = false) => ({ type: 'user', promptId, timestamp: at(), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error }] } });
const say = (promptId: string, text: string, usage?: Record<string, number>) => ({ type: 'assistant', promptId, timestamp: at(), message: { id: `m-say-${clock}`, role: 'assistant', content: [{ type: 'text', text }], ...(usage && { usage }) } });
const jsonl = (lines: unknown[]) => lines.map((l) => JSON.stringify(l)).join('\n') + '\n';

test('who a prompt is from: its person, another session, or an event', () => {
  assert.deepEqual(ev.promptedBy('<system-reminder>\nLinked sessions now\n</system-reminder>\nFix the build. Then push it.'), { by: 'person', gist: 'Fix the build.' }, 'a reminder the app put in is not what the person said');
  assert.deepEqual(ev.promptedBy('Another Claude session sent a message:\n<cross-session-message from="local_abc" name="x">\nDone.'), { by: 'session', from: 'local_abc' });
  assert.deepEqual(ev.promptedBy('<cross-session-message from="local_def" name="y">\nBlocked.</cross-session-message>'), { by: 'session', from: 'local_def' });
  assert.deepEqual(ev.promptedBy('Background (from the session that started this one):\nThe plan is...'), { by: 'session' });
  assert.deepEqual(ev.promptedBy('Task (from the session that started this one):\nBuild it.'), { by: 'session' });
  for (const tag of ['side-sessions-event', 'ci-monitor-event', 'task-notification', 'scheduled-task']) assert.deepEqual(ev.promptedBy(`<${tag}>something happened</${tag}>`), { by: 'event', from: tag }, tag);
  assert.deepEqual(ev.promptedBy('Another Claude session sent a message:\n<agent-message from="a12">\n[Subagent hand-back] ...'), { by: 'event', from: 'agent-message' });
  assert.equal(ev.promptedBy('x'.repeat(400)).gist.length, 200, 'a gist is cut to 200');
});

test('a turn read off the transcript: its tools, tests and commits, each at its own time', () => {
  const lines = [
    prompt('p1', 'Before.'),
    use('p1', 'a0', 'Read', { file_path: 'old.ts' }),
    result('p1', 'a0', 'text'),
    prompt('p2', 'Make it so.'),
    use('p2', 'a1', 'Read', { file_path: 'a.ts' }),
    result('p2', 'a1', 'file text'),
    use('p2', 'a2', 'Edit', { file_path: 'a.ts', old_string: 'a', new_string: 'b' }),
    result('p2', 'a2', 'ok'),
    use('p2', 'a3', 'Bash', { command: 'npm test -- test/a.test.ts' }),
    result('p2', 'a3', 'ℹ tests 5\nℹ pass 4\nℹ fail 1', true),
    use('p2', 'a4', 'Bash', { command: 'git -C x commit -m "A change"' }),
    result('p2', 'a4', '[claude/x 1a2b3c4] A change\n 1 file changed'),
    use('p2', 'a5', 'mcp__pelago__change', { ops: [{ op: 'update', id: 'e_abcdefgh' }] }),
    result('p2', 'a5', '{"applied":["e_made1234"]}'),
    use('p2', 'a6', 'mcp__Claude_Browser__navigate', { url: 'x' }),
    result('p2', 'a6', 'ok'),
    use('p2', 'a7', 'Bash', { command: 'npx vitest run' }),
    result('p2', 'a7', 'Tests  3 passed (3)'),
    use('p2', 'a8', 'Glob', { pattern: '*' }),
  ];
  const events = ev.turnEvents(jsonl(lines));
  assert.ok(events.every((e: any) => e.turn === 'p2'), 'only the last turn, named by its prompt');
  assert.deepEqual(events.map((e: any) => e.kind + (e.tool ? `:${e.tool}` : '')), ['tool.end:read', 'tool.end:edit', 'tool.end:shell', 'test.run', 'tool.end:shell', 'commit', 'tool.end:map', 'tool.end:web', 'tool.end:shell', 'test.run'], 'a call not yet answered is not ended');
  assert.deepEqual(events[1].files, ['a.ts'], 'a file edited is named');
  assert.equal(events[0].files, undefined, 'a file read is not');
  assert.deepEqual(events[3], { at: lines[9].timestamp, kind: 'test.run', turn: 'p2', ok: false, passed: 4, failed: 1, command: 'npm test -- test/a.test.ts' });
  assert.equal(events[2].ok, false);
  assert.deepEqual(events[5], { at: lines[11].timestamp, kind: 'commit', turn: 'p2', sha: '1a2b3c4', subject: 'A change' });
  assert.deepEqual(events[6].items, ['e_abcdefgh', 'e_made1234'], 'a change names what it sent and what it made');
  assert.deepEqual([events[9].ok, events[9].passed, events[9].failed], [true, 3, undefined]);
  assert.deepEqual(ev.turnEvents(jsonl(lines)), events, 'read again, the same events: a resend changes nothing');
  assert.deepEqual(ev.turnEvents(''), []);
});

test('a turn its person stopped is ended by the next prompt', () => {
  const lines = [
    prompt('p1', 'Do a long thing.'),
    use('p1', 'b1', 'Bash', { command: 'sleep 100' }),
    result('p1', 'b1', 'interrupted', true),
    { type: 'user', promptId: 'p1', timestamp: at(), message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } },
  ];
  const before = ev.turnEvents(jsonl(lines), { prompt_id: 'p2', prompt: 'Stop that.' });
  assert.deepEqual(before.at(-1), { at: lines[3].timestamp, kind: 'turn.end', turn: 'p1', ended: 'stopped' }, 'the prompt is not on the transcript yet');
  const written = ev.turnEvents(jsonl([...lines, prompt('p2', 'Stop that.')]), { prompt_id: 'p2', prompt: 'Stop that.' });
  assert.deepEqual(written, before, 'or it is: the turn before it is read either way');
  assert.equal(ev.turnEvents(jsonl(lines)).some((e: any) => e.kind === 'turn.end'), false, 'at a Stop the end is the Stop’s');
});

test('how a reply ended: on a question, or done, with its gist and what it used', () => {
  const lines = [prompt('p1', 'Go.'), say('p1', 'Working on it.', { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 }), say('p1', 'It is built. The tests pass.\n\nShall I push it?', { input_tokens: 2, output_tokens: 3 })];
  const end = ev.turnEnd(jsonl(lines), {});
  assert.deepEqual({ ...end, at: undefined }, { at: undefined, kind: 'turn.end', turn: 'p1', ended: 'asked', question: 'Shall I push it?', gist: 'It is built.', tokens: { input: 12, output: 8, cache_read: 100, cache_write: 0 } });
  assert.equal(ev.turnEnd(jsonl(lines), { last_assistant_message: 'Done. Pushed.', prompt_id: 'p9' }).ended, 'done', 'what the Stop hook says the reply was wins');
  assert.equal(ev.turnEnd(jsonl(lines), { last_assistant_message: 'Done.', prompt_id: 'p9' }).turn, 'p9');
  const boxed = [...lines.slice(0, 2), use('p1', 'w1', 'mcp__ccd_turn__wrap_up', { recap: 'Built.', ask: 'Push to main?' }), say('p1', 'Built and tested.')];
  assert.deepEqual([ev.turnEnd(jsonl(boxed), {}).ended, ev.turnEnd(jsonl(boxed), {}).question], ['asked', 'Push to main?'], 'a question in the next-step box is one');
  assert.equal(ev.turnEnd(jsonl(lines), { last_assistant_message: 'x'.repeat(700) + '?' }).question.length, 500, 'a question whole up to 500');
});

test('what a session waits on, and a turn that failed', () => {
  assert.deepEqual(ev.waitStart({ notification_type: 'permission_prompt', message: 'Claude needs your permission to use Bash', prompt_id: 'p1' }, 'T'), { at: 'T', kind: 'wait.start', turn: 'p1', for: 'permission', gist: 'Claude needs your permission to use Bash' });
  assert.equal(ev.waitStart({ notification_type: 'elicitation_dialog', message: 'Pick one' }, 'T').for, 'input');
  assert.equal(ev.waitStart({ notification_type: 'idle_prompt', message: 'Claude is waiting for your input' }), null, 'idle after a reply is not a wait: the turn has ended');
  assert.equal(ev.waitStart({ message: 'Claude needs your permission to use Edit' }, 'T').for, 'permission', 'an older Claude Code says it only in words');
  assert.deepEqual(ev.failedEnd({ error: 'rate_limit', prompt_id: 'p1' }, 'T'), { at: 'T', kind: 'turn.end', turn: 'p1', ended: 'failed', gist: 'rate_limit' });
});

/** The hook, run as Claude Code runs it, against a server that keeps what it is sent. */
async function hooked(steps: { name: string; input: unknown; answer?: unknown }[]) {
  const heard: { url: string; body: any }[] = [];
  let answer: unknown = {};
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => (heard.push({ url: req.url!, body: JSON.parse(body) }), res.end(JSON.stringify(req.url === '/hooks/events' ? {} : answer))));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  for (const step of steps) {
    answer = step.answer ?? {};
    await new Promise<void>((done) => {
      const child = spawn(process.execPath, [join(SCRIPTS, 'pelago-hook.mjs'), step.name], { env: { ...process.env, PELAGO_URL: `http://127.0.0.1:${port}`, PELAGO_AGENT_TOKEN: '' }, stdio: ['pipe', 'ignore', 'ignore'] });
      child.on('close', () => done());
      child.stdin.end(JSON.stringify(step.input));
    });
  }
  server.close();
  return heard;
}

test('the hook sends its events beside its own call, and a turn the server sends on has not ended', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-events-'));
  const transcript = join(dir, 'session.jsonl');
  const session_id = `ev-${process.pid}-${Date.now()}`;
  writeFileSync(transcript, jsonl([prompt('p1', 'Build it.'), use('p1', 'c1', 'Edit', { file_path: 'b.ts' }), result('p1', 'c1', 'ok'), say('p1', 'Built. Push it?')]));
  const base = { session_id, transcript_path: transcript, cwd: dir };
  const heard = await hooked([
    { name: 'prompt', input: { ...base, prompt_id: 'p1', prompt: 'Build it.' } },
    { name: 'notification', input: { ...base, prompt_id: 'p1', notification_type: 'permission_prompt', message: 'Claude needs your permission to use Edit' } },
    { name: 'tool-used', input: { ...base, prompt_id: 'p1', tool_name: 'Edit' } },
    { name: 'tool-used', input: { ...base, prompt_id: 'p1', tool_name: 'Read' } },
    { name: 'stop', input: { ...base, prompt_id: 'p1' }, answer: { decision: 'block', reason: 'show it' } },
    { name: 'stop', input: { ...base, prompt_id: 'p1', stop_hook_active: true } },
    { name: 'session-end', input: { ...base, reason: 'prompt_input_exit' } },
  ]);
  const told = heard.filter((h) => h.url === '/hooks/events');
  assert.ok(told.every((h) => h.body.session_id === session_id && h.body.source === 'claude-code'));
  assert.deepEqual(heard.filter((h) => h.url !== '/hooks/events').map((h) => h.url), ['/hooks/prompt', '/hooks/stop', '/hooks/stop', '/hooks/session-end'], 'the hooks that only tell events call nothing else');
  const kinds = told.map((h) => h.body.events.map((e: any) => e.kind));
  assert.deepEqual(kinds, [['turn.start'], ['wait.start'], ['wait.end'], ['tool.end'], ['tool.end', 'turn.end'], ['session.end']], 'a wait ends once, at the next tool; a reply sent on has no end');
  assert.deepEqual(told[0].body.events[0].turn, 'p1');
  assert.deepEqual([told[0].body.events[0].by, told[0].body.events[0].gist], ['person', 'Build it.']);
  assert.equal(told[2].body.events[0].for, 'permission');
  assert.deepEqual(told[4].body.events[1].question, 'Built. Push it?');
  assert.equal(told[5].body.events[0].reason, 'prompt_input_exit');
});
