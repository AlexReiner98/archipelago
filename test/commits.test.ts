// A commit updates what it settles: a reply that committed or pushed commits the map does not account for is asked
// once to account for them, in one change, and a session's end lists those still unaccounted for.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { answerHook } from '../src/hook-answers.ts';
import type { Archipelago } from '../src/pelago.ts';
import { checkRules } from '../src/rules.ts';
import { sessionStart, story } from '../src/sessions.ts';
import { callTool } from '../src/tools.ts';
import { agent, fresh, make } from './map.ts';

const hook = (l: Archipelago, event: string, body: Record<string, unknown>) => answerHook(event, { whole: l.db, pelago: l, within: [], body, running: { started: new Date().toISOString() }, origin: 'http://127.0.0.1' });
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
/** The one change that accounts for commits: a commit record each, with what each settles. */
const account = (l: Archipelago, settles: Record<string, string[]>) =>
  make(
    l,
    Object.entries(settles).flatMap(([sha, items]) => [
      { op: 'create' as const, ref: sha, type: 'software.commit', title: `Commit ${sha.slice(0, 7)}`, props: { sha } },
      ...items.map((to) => ({ op: 'link' as const, type: 'software.settles', from: sha, to })),
    ]),
  );

test('a rule on unaccounted commits names the record that accounts for one', () => {
  const rule = { id: 'x', on: 'reply_ended', when: { reply: { unaccounted: true } }, then: 'ask' as const, say: 'Account for them.', lifted: 'reply_x' };
  assert.ok(checkRules([rule], { types: new Map() }).some((p) => /names their record/.test(p)));
  assert.ok(checkRules([{ ...rule, record: { type: 'nowhere.commit', field: 'sha' } }], { types: new Map() }).some((p) => /not known/.test(p)));
});

test('a reply that committed and did not account for it is asked once, naming the commits, until one change accounts for them', async () => {
  const l = await fresh();
  const made = await make(l, [{ op: 'create', ref: 'task', type: 'work.task', title: 'Settled by a commit' }]);
  const { run } = await sessionStart(l, agent, { session_id: 'c1' });
  const reply = { committed: 1, pushed: 0 };

  const asked = (await hook(l, 'stop', { session_id: 'c1', turn: 'u1', reply, commits: [A, B], turn_commits: [B] })) as any;
  assert.equal(asked.decision, 'block');
  assert.match(asked.reason, /does not account for/);
  assert.ok(asked.reason.includes(B) && !asked.reason.includes(A), 'only what this reply made: ' + asked.reason);
  assert.equal((await story(l, { run })).beats.at(-1)?.asked, 'software.account_commits', 'kept as a step');
  assert.deepEqual(await hook(l, 'stop', { session_id: 'c1', turn: 'u1', reply, commits: [A, B], turn_commits: [B] }), {}, 'once a turn');

  await account(l, { [B]: [made.task] });
  assert.deepEqual(await hook(l, 'stop', { session_id: 'c1', turn: 'u2', reply, commits: [A, B], turn_commits: [B] }), {}, 'accounted for');
  const pushed = (await hook(l, 'stop', { session_id: 'c1', turn: 'u3', reply: { pushed: 1 }, commits: [A, B], turn_commits: [A, B] })) as any;
  assert.ok(pushed.reason.includes(A) && !pushed.reason.includes(B), 'a push asks about the session’s commits still unaccounted for');
  assert.deepEqual(await hook(l, 'stop', { session_id: 'c1', turn: 'u4', reply: { committed: 1 }, turn_commits: [] }), {}, 'a commit git did not name is not asked about');
});

test('a session’s end lists its commits not accounted for, and ends once they are', async () => {
  const l = await fresh();
  const { run } = await sessionStart(l, agent, { session_id: 'c2' });
  await hook(l, 'stop', { session_id: 'c2', commits: [A, 'not a sha', B.slice(0, 7)] });
  await hook(l, 'stop', { session_id: 'c2', commits: [B] });
  const asked = (await callTool(l, agent, 'session_end', { run, cannot_tell_rest: true })) as any;
  assert.equal(asked.ended, false);
  assert.deepEqual(asked.unaccounted_commits, [A, B]);
  assert.match(asked.note, /unaccounted_commits/);
  await account(l, { [A]: [] });
  // A record waiting for the owner is said: the session ends, and the check on main waits for it to apply.
  await l.change(agent, { reason: 'test', hold: true, ops: [{ op: 'create', type: 'software.commit', title: 'Held', props: { sha: B } }] });
  const ended = (await callTool(l, agent, 'session_end', { run, cannot_tell_rest: true })) as any;
  assert.equal(ended.status, 'finished');
  assert.equal(ended.unaccounted_commits, undefined);
});

test('the hook reads the session’s commits from what git answered, by their full ids', async () => {
  const repo = mkdtempSync(join(tmpdir(), 'pelago-commits-'));
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { encoding: 'utf8' }).trim();
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'One');
  const one = git('rev-parse', 'HEAD');
  git('commit', '-q', '--allow-empty', '-m', 'Two');
  const two = git('rev-parse', 'HEAD');
  // A quiet commit answers nothing: what it made is in the HEAD log, at the time the command ran.
  await new Promise((done) => setTimeout(done, 2500));
  const before = new Date().toISOString();
  git('commit', '-q', '--allow-empty', '-m', 'Three');
  const three = git('rev-parse', 'HEAD');
  const after = new Date().toISOString();
  const use = (id: string, command: string) => ({ type: 'assistant', message: { id, content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } });
  const result = (id: string, content: unknown) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } });
  const lines = [
    { type: 'user', uuid: 'p1', message: { role: 'user', content: 'Commit the first' } },
    use('a1', 'git commit -m One'),
    result('a1', `[main (root-commit) ${one.slice(0, 7)}] One\n 1 file changed`),
    { type: 'user', uuid: 'p2', message: { role: 'user', content: 'And the second' } },
    use('b1', 'git add . && git commit -m Two'),
    result('b1', [{ type: 'text', text: `[detached HEAD ${two.slice(0, 7)}] Two` }]),
    use('b2', 'echo "[main 1234567] not a commit"'),
    result('b2', '[main 1234567] not a commit'),
    use('b3', 'git commit -m Gone'),
    result('b3', '[main fedcba9] Gone'),
    { ...use('b4', 'git commit -q -m Three'), timestamp: before },
    { ...result('b4', ''), timestamp: after },
  ];
  const transcript = join(repo, 'session.jsonl');
  writeFileSync(transcript, lines.map((x) => JSON.stringify(x)).join('\n') + '\n');
  const sent = async (extra: object[]) => {
    writeFileSync(transcript, [...lines, ...extra].map((x) => JSON.stringify(x)).join('\n') + '\n');
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
      child.stdin.end(JSON.stringify({ session_id: 'h1', transcript_path: transcript, cwd: repo }));
    });
    server.close();
    return got;
  };
  const got = await sent([]);
  assert.deepEqual(got.commits, [one, two, three], 'every commit of the session, and only what the checkout holds');
  assert.deepEqual(got.turn_commits, [two, three], 'the reply’s own');
  assert.equal(got.reply.committed, 3);
  const pushed = await sent([use('c1', 'git push origin main')]);
  assert.deepEqual(pushed.turn_commits, [one, two, three], 'a push is asked about every commit the session made');
});
