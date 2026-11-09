// Rules on a session's reply ending: declared as data, asking the agent once a turn, kept as a step, turned off by the owner.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { answerHook } from '../src/hook-answers.ts';
import { Archipelago, type Actor } from '../src/pelago.ts';
import { Registry, type PackFile } from '../src/packs.ts';
import { checkRules, type RuleDef } from '../src/rules.ts';
import { sessionStart, story } from '../src/sessions.ts';
import { hookSessionStart } from '../src/session-hook.ts';
import { callTool } from '../src/tools.ts';
import { freshWith } from './map.ts';

const owner: Actor = { kind: 'human', name: 'owner', admin: true };
const agent: Actor = { kind: 'agent', name: 'test' };

/** The one rule these tests ship: a reply that changed the map and showed nothing is asked to show it. */
const SHOW: RuleDef = {
  id: 'show_changes',
  on: 'reply_ended',
  when: { reply: { changed: true, showed: false } },
  then: 'ask',
  say: 'You changed the map and showed the owner nothing: show them what changed.',
  lifted: 'reply_show_changes',
};
const CHECKS: PackFile = { id: 'checks', version: '1', title: 'Checks', requires: ['core'], rules: [SHOW] };

async function map() {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-replies-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), dir, { recursive: true });
  mkdirSync(join(dir, 'checks'));
  writeFileSync(join(dir, 'checks', 'pack.json'), JSON.stringify(CHECKS));
  return freshWith(new Registry(dir), { create: 'auto', update: 'auto', link: 'auto' });
}

const stop = (l: Archipelago, body: Record<string, unknown>) =>
  answerHook('stop', { whole: l.db, pelago: l, within: [], body, running: { started: new Date().toISOString() }, origin: 'http://127.0.0.1' });

test('a rule on a reply ending is checked as data', () => {
  const reg = { types: new Map() };
  assert.deepEqual(checkRules([SHOW], reg), []);
  const problems = checkRules([{ ...SHOW, then: 'hold', when: { reply: { drew: true }, op: 'create' }, say: 'one\ntwo', lifted: 'agent_changes' }], reg);
  for (const said of [/asks \(then: "ask"\)/, /reads only when.reply/, /no fact "drew"/, /one line/, /reply_<name>/]) assert.ok(problems.some((p) => said.test(p)), `${said}: ${problems.join(' | ')}`);
  assert.deepEqual(checkRules([{ ...SHOW, when: { reply: { worked: 3, told: false } } }], reg), [], 'a number is how often at least');
  assert.ok(checkRules([{ ...SHOW, when: { reply: { worked: 0.5 } } }], reg).some((p) => /how many times at least/.test(p)));
  const other = checkRules([{ on: 'turn_began', then: 'ask', when: { reply: { read: true } }, say: 'x', lifted: 'reply_x' }], reg);
  assert.ok(other.some((p) => /has an id/.test(p)) && other.some((p) => /on is "reply_ended"/.test(p)), other.join(' | '));
});

test('a rule on a reply ending has no say over a change', async () => {
  const l = await map();
  const made = await l.change(agent, { reason: 'test', ops: [{ op: 'create', type: 'task', title: 'Untouched by the check' }] });
  assert.equal(made.status, 'applied');
});

test('a reply that did what a rule names is asked once a turn, the asking kept in its story, until the owner turns it off', async () => {
  const l = await map();
  const { run } = await sessionStart(l, agent, { session_id: 's1' });
  const changed = { changed: 1, showed: 0, read: 2 };

  const asked = (await stop(l, { session_id: 's1', turn: 'u1', reply: changed })) as any;
  assert.deepEqual(asked, { decision: 'block', reason: SHOW.say });
  const beats = (await story(l, { run })).beats;
  assert.deepEqual(beats.map((b) => [b.said, b.asked]), [[SHOW.say, 'checks.show_changes']], 'kept as a step the owner sees');

  assert.deepEqual(await stop(l, { session_id: 's1', turn: 'u1', reply: changed, stop_hook_active: true }), {}, 'never while the agent goes on because it was asked');
  assert.deepEqual(await stop(l, { session_id: 's1', turn: 'u1', reply: changed }), {}, 'never twice in one turn');
  assert.deepEqual(await stop(l, { session_id: 's1', turn: 'u2', reply: { changed: 1, showed: 1 } }), {}, 'its when does not hold');
  assert.deepEqual(await stop(l, { session_id: 's1', reply: changed }), {}, 'an older hook says no turn');
  assert.deepEqual(await stop(l, { session_id: 'nobody', turn: 'u3', reply: changed }), {}, 'a session not registered has no story to keep it in');
  assert.equal(((await stop(l, { session_id: 's1', turn: 'u3', reply: changed })) as any).decision, 'block', 'the next turn is asked again');

  await assert.rejects(callTool(l, owner, 'workspace_set', { lifted: { reply_nothing: true } }), /No rule here is turned off by "reply_nothing"/);
  await callTool(l, owner, 'workspace_set', { lifted: { reply_show_changes: true } });
  const info = (await callTool(l, owner, 'workspace_info', {})) as any;
  assert.deepEqual(info.lifted, { reply_draw_answers: false, reply_record_findings: false, reply_show_changes: true, reply_account_commits: false });
  assert.deepEqual(info.reply_rules.find((r: any) => r.rule === 'checks.show_changes'), { rule: 'checks.show_changes', say: SHOW.say, lifted: 'reply_show_changes', off: true, asked: 2 }, 'the owner’s switch, with how often it asked this week');
  assert.deepEqual(await stop(l, { session_id: 's1', turn: 'u4', reply: changed }), {}, 'turned off');
  await callTool(l, owner, 'workspace_set', { lifted: { reply_show_changes: false } });
  assert.equal(((await stop(l, { session_id: 's1', turn: 'u5', reply: changed })) as any).decision, 'block', 'and on again');
  assert.equal((await story(l, { run })).beats.length, 3);
});

test('the hook counts what the reply did since the owner’s last message', async () => {
  const use = (id: string, name: string, input: unknown) => ({ type: 'assistant', message: { id, content: [{ type: 'tool_use', id, name, input }] } });
  const lines = [
    { type: 'user', uuid: 'p1', message: { role: 'user', content: 'First, change something' } },
    use('a1', 'mcp__pelago__change', { reason: 'r', ops: [] }),
    use('a2', 'Bash', { command: 'git push' }),
    { type: 'user', uuid: 'p2', message: { role: 'user', content: [{ type: 'text', text: 'Now the second turn' }] } },
    { type: 'user', uuid: 'meta', isMeta: true, message: { role: 'user', content: 'Put in by Claude Code' } },
    use('b1', 'mcp__pelago__query', { name: 'get', params: { id: 'e_readitem' } }),
    { type: 'user', uuid: 'r1', message: { content: [{ type: 'tool_result', tool_use_id: 'b1', content: 'ok' }] } },
    use('b2', 'mcp__pelago__change', { reason: 'r', ops: [] }),
    use('b3', 'mcp__pelago__report', { action: 'show', params: { entity: 'e_readitem' } }),
    use('b4', 'mcp__pelago__report', { action: 'tell', params: { run: 'x', said: 'y' } }),
    use('b5', 'Bash', { command: 'cd x && git -C "a b" commit -m "Closes: e_readitem"' }),
    use('b6', 'Bash', { command: 'git log --grep commit; git commit-tree x' }),
    use('b7', 'mcp__pelago__query', { name: 'flat', params: { filter: { find: ['text open work'] } } }),
    use('b8', 'mcp__pelago__query', { name: 'actions', params: { verb: 'report' } }),
    use('b9', 'Edit', { file_path: 'a.ts', old_string: 'a', new_string: 'b' }),
    use('b10', 'Grep', { pattern: 'x' }),
    use('b11', 'mcp__pelago-site__change', { reason: 'r', ops: [{ op: 'update', id: 'e_elsewhre' }] }),
    use('b12', 'mcp__pelago-site__report', { action: 'tell', params: { run: 'z', said: 'y' } }),
  ];
  const dir = mkdtempSync(join(tmpdir(), 'pelago-reply-'));
  const transcript = join(dir, 'session.jsonl');
  writeFileSync(transcript, lines.map((x) => JSON.stringify(x)).join('\n') + '\n');
  let got: any;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => (req.url === '/hooks/events' ? res.end('{}') : ((got = JSON.parse(body)), res.end(JSON.stringify({ decision: 'block', reason: 'asked' })))));
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const port = (server.address() as { port: number }).port;
  let out = '';
  await new Promise<void>((done) => {
    const child = spawn(process.execPath, [join(import.meta.dirname, '..', 'scripts', 'pelago-hook.mjs'), 'stop'], { env: { ...process.env, PELAGO_URL: `http://127.0.0.1:${port}`, PELAGO_AGENT_TOKEN: '' } });
    child.stdout.on('data', (d) => (out += d));
    child.on('close', () => done());
    child.stdin.end(JSON.stringify({ session_id: 'h1', transcript_path: transcript, stop_hook_active: false }));
  });
  server.close();
  assert.equal(got.turn, 'p2');
  assert.deepEqual(got.reply, { read: 3, surveyed: 1, showed: 1, changed: 2, told: 2, worked: 4, edited: 1, committed: 1, pushed: 0 }, 'a get and a read of the tools are not surveys; every tool but a map’s is work, and another workspace’s server is a map’s');
  assert.ok(!got.touched.includes('e_elsewhre'), 'an item named on another workspace is not this map’s');
  assert.equal(got.stop_hook_active, false, 'what Claude Code said goes through');
  assert.deepEqual(JSON.parse(out), { decision: 'block', reason: 'asked' }, 'and the answer comes back to Claude Code');
});

test('core asks a reply that answered from the map and drew nothing to draw it, and the owner can turn that off', async () => {
  const l = await map();
  const draw = l.registry.rules.find((r) => r.pack === 'core' && r.id === 'draw_answers')!;
  assert.ok(draw && checkRules([draw], { types: new Map() }).length === 0, 'core ships it, checked as data');
  await callTool(l, owner, 'workspace_set', { lifted: { reply_show_changes: true } });
  const { run } = await sessionStart(l, agent, { session_id: 'd1' });
  const answered = { read: 2, surveyed: 1, showed: 0, changed: 0, edited: 0, committed: 0, pushed: 0 };
  const asked = (await stop(l, { session_id: 'd1', turn: 't1', reply: answered })) as any;
  assert.deepEqual(asked, { decision: 'block', reason: draw.say });
  assert.deepEqual((await story(l, { run })).beats.map((b) => b.asked), ['core.draw_answers']);
  // Not an answer to draw: what it read was only to then change the map, or to write code; one item, or nothing but a line.
  const not: [string, Record<string, number>][] = [
    ['read to change', { ...answered, changed: 1 }],
    ['read to write code', { ...answered, edited: 2 }],
    ['read to commit', { ...answered, committed: 1 }],
    ['one item, or the tools', { ...answered, surveyed: 0 }],
    ['drawn', { ...answered, showed: 1 }],
  ];
  for (const [why, reply] of not) assert.deepEqual(await stop(l, { session_id: 'd1', turn: `t-${why}`, reply }), {}, why);
  await callTool(l, owner, 'workspace_set', { lifted: { reply_draw_answers: true } });
  assert.deepEqual(await stop(l, { session_id: 'd1', turn: 't2', reply: answered }), {}, 'turned off');
});

test('the session-start text tells an agent to answer the owner with a drawing', async () => {
  const l = await map();
  const text = await hookSessionStart(l, { session_id: 'd2', cwd: tmpdir() });
  assert.match(text, /report, action show/);
  assert.match(text, /A yes, a number or one item is a line in chat/);
});

test('core asks a reply that worked and put nothing on the map to tell what it found, at a number the owner sets, until they turn it off', async () => {
  const l = await map();
  const record = l.registry.rules.find((r) => r.pack === 'core' && r.id === 'record_findings')!;
  assert.ok(record && checkRules([record], { types: new Map() }).length === 0, 'core ships it, checked as data');
  await callTool(l, owner, 'workspace_set', { lifted: { reply_show_changes: true } });
  const { run } = await sessionStart(l, agent, { session_id: 'f1' });
  const worked = { read: 1, worked: 12, edited: 3, changed: 0, told: 0 };
  assert.deepEqual(await stop(l, { session_id: 'f1', turn: 't1', reply: worked }), { decision: 'block', reason: record.say });
  assert.deepEqual((await story(l, { run })).beats.map((b) => b.asked), ['core.record_findings']);
  const not: [string, Record<string, number>][] = [
    ['told', { ...worked, told: 1 }],
    ['an item changed, a note as much as a new one', { ...worked, changed: 1 }],
    ['a short reply', { ...worked, worked: 5 }],
  ];
  for (const [why, reply] of not) assert.deepEqual(await stop(l, { session_id: 'f1', turn: `t-${why}`, reply }), {}, why);

  const row = async () => ((await callTool(l, owner, 'workspace_info', {})) as any).reply_rules.find((r: any) => r.rule === 'core.record_findings');
  assert.deepEqual([(await row()).counts, (await row()).at], ['worked', 6], 'the pack’s number, and what it counts');
  await assert.rejects(callTool(l, owner, 'workspace_set', { asks_at: { reply_draw_answers: 3 } }), /No rule here that counts/);
  await callTool(l, owner, 'workspace_set', { asks_at: { reply_record_findings: 20 } });
  assert.equal((await row()).at, 20, 'the owner’s number');
  assert.deepEqual(await stop(l, { session_id: 'f1', turn: 't-under', reply: worked }), {}, 'under the owner’s number');
  assert.equal(((await stop(l, { session_id: 'f1', turn: 't-over', reply: { ...worked, worked: 20 } })) as any).decision, 'block', 'at it');

  await callTool(l, owner, 'workspace_set', { lifted: { reply_record_findings: true } });
  assert.deepEqual(await stop(l, { session_id: 'f1', turn: 't2', reply: { ...worked, worked: 30 } }), {}, 'turned off');
});

test('the session-start text says the map, not the chat, is the record, and that telling is checked', async () => {
  const l = await map();
  const text = await hookSessionStart(l, { session_id: 'f2', cwd: tmpdir() });
  assert.match(text, /The map is the record of this work, not the chat/);
  assert.match(text, /a reply that worked and told nothing is asked to/);
});
