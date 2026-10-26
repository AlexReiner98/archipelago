import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { answerHook } from '../src/hook-answers.ts';
import type { Archipelago } from '../src/pelago.ts';
import { sessionStart } from '../src/sessions.ts';
import { callTool } from '../src/tools.ts';
import { touchedBy } from '../src/touched.ts';
import { agent, fresh, laneSetup, make } from './map.ts';

/** A hook as Claude Code sends it, answered by this map. */
const hook = (l: Archipelago, event: string, body: Record<string, unknown>) => answerHook(event, { whole: l.db, pelago: l, within: [], body, running: { started: new Date().toISOString() }, origin: 'http://127.0.0.1' });

test('what a session touched is kept with its run, apart from another session of the same agent', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'mine', type: 'work.task', title: 'Read and left' },
    { op: 'create', ref: 'theirs', type: 'work.task', title: 'Read by the other' },
  ]);
  const one = await sessionStart(l, agent, { session_id: 't1' });
  const two = await sessionStart(l, agent, { session_id: 't2' });
  await hook(l, 'stop', { session_id: 't1', touched: [made.mine, 'not an id', 42] });
  await hook(l, 'prompt', { session_id: 't2', touched: [made.theirs] });
  await hook(l, 'stop', { session_id: 't1', touched: [made.mine] });
  assert.deepEqual(await touchedBy(l, one.run), [made.mine], 'by run, not by actor, and only ids');
  assert.deepEqual(await touchedBy(l, two.run), [made.theirs]);
  await hook(l, 'stop', { session_id: 't2' });
  assert.deepEqual(await touchedBy(l, two.run), [made.theirs], 'an older hook that sends none leaves the set as it was');

  // Its end names what it touched and left as it was, though it is in no repository; one word does not answer for it.
  const asked = (await callTool(l, agent, 'session_end', { run: one.run, cannot_tell_rest: true })) as any;
  assert.equal(asked.ended, false);
  assert.deepEqual(asked.unreconciled, [{ id: made.mine, type: 'work.task', title: 'Read and left', status: 'todo', touched: true }]);
  assert.equal(((await callTool(l, agent, 'session_end', { run: one.run, still_true: [made.mine] })) as any).status, 'finished');

  // The set is kept a week after the session ended, in the store that lets it go then, and no longer.
  const { rows } = await l.db.query<{ days: number }>(`select extract(epoch from until - now()) / 86400 as days from transient where key = $1`, [`touched:${one.run}`]);
  assert.ok(rows[0].days > 6.9 && rows[0].days <= 7, String(rows[0].days));
});

test('in a repository, what the session touched is asked about first', async () => {
  const l = await fresh();
  const made = await laneSetup(l);
  const { run } = await sessionStart(l, agent, { cwd: 'C:\\code\\Apex', session_id: 'r1' });
  await hook(l, 'stop', { session_id: 'r1', touched: [made.gated, made.repo] });
  const asked = (await callTool(l, agent, 'session_end', { run })) as any;
  assert.deepEqual(asked.unreconciled.map((i: any) => [i.title, Boolean(i.touched)]), [['Tune the solver', true], ['Capture probe', false], ['Write unit tests', false]]);
  assert.match(asked.note, /marked touched/);
  // cannot_tell_rest answers for what it never looked at, and the touched one still waits for its word.
  const rest = (await callTool(l, agent, 'session_end', { run, cannot_tell_rest: true })) as any;
  assert.deepEqual(rest.unreconciled.map((i: any) => i.title), ['Tune the solver']);
  assert.equal(((await callTool(l, agent, 'session_end', { run, cannot_tell_rest: true, cannot_tell: [made.gated] })) as any).status, 'finished');
});

test('the hook reads from the transcript the items the session’s calls to the map named', async () => {
  const lines = [
    { type: 'user', message: { role: 'user', content: 'Look at e_userword please' } },
    { type: 'assistant', message: { id: 'm1', usage: { input_tokens: 10, output_tokens: 5 }, content: [{ type: 'tool_use', id: 'q1', name: 'mcp__pelago__query', input: { name: 'get', params: { id: 'e_readitem' } } }] } },
    { type: 'assistant', message: { id: 'm2', usage: { input_tokens: 3, output_tokens: 2 }, content: [{ type: 'tool_use', id: 'c1', name: 'mcp__pelago__change', input: { reason: 'r', ops: [{ op: 'update', id: 'e_changed1' }, { op: 'create', ref: 'x', type: 'work.task', title: 't' }] } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'q1', content: [{ type: 'text', text: '{"outgoing":[{"id":"e_onlyseen"}]}' }] }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'c1', content: [{ type: 'text', text: '{"created":{"x":"e_madeitem"}}' }] }] } },
    { type: 'assistant', message: { id: 'm3', content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: { command: 'echo e_notamapc' } }, { type: 'tool_use', id: 's1', name: 'mcp__pelago__report', input: { action: 'show', params: { entity: 'e_shownnow' } } }] } },
  ];
  const dir = mkdtempSync(join(tmpdir(), 'pelago-transcript-'));
  const transcript = join(dir, 'session.jsonl');
  writeFileSync(transcript, lines.map((x) => JSON.stringify(x)).join('\n') + '\n{"type":"assist');
  let got: any;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => ((got = JSON.parse(body)), res.end('{}')));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  await new Promise<void>((done) => {
    const child = spawn(process.execPath, [join(import.meta.dirname, '..', 'scripts', 'pelago-hook.mjs'), 'stop'], { env: { ...process.env, PELAGO_URL: `http://127.0.0.1:${port}`, PELAGO_AGENT_TOKEN: '' } });
    child.on('close', () => done());
    child.stdin.end(JSON.stringify({ session_id: 'h1', transcript_path: transcript }));
  });
  server.close();
  assert.equal(got.tokens, 20);
  assert.deepEqual(got.touched.sort(), ['e_changed1', 'e_madeitem', 'e_readitem', 'e_shownnow'], 'what it sent, and what a change made; not what an answer only mentioned');
});
