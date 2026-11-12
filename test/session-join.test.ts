import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as sessionsPack from '../packs/sessions/kernel/sessions.ts';
import * as sessionHookPack from '../packs/sessions/kernel/session-hook.ts';
import * as chatRunPack from '../packs/sessions/kernel/chat-run.ts';
import { agent, fresh, make } from './map.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { kernelContext, ownContext } from '../packs/loader/kernel/kernel-context.ts';

test('a chat its hook registered, told to register itself, gets the hook’s run back with the task and title it sent', async () => {
  const l = await fresh();
  const { task } = await make(l, [{ op: 'create', ref: 'task', type: 'task', title: 'One run per session' }]);
  await sessionHookPack.hookSessionStart(ownContext(l, 'sessions'), ({ session_id: 'cc-1', cwd: 'C:\\code\\apex\\.claude\\worktrees\\one', source: 'startup' }));
  const hooked = (await chatRunPack.resolveRun(kernelContext(l, 'sessions'), 'cc-1', false))!;
  await sessionsPack.sessionHeard(ownContext(l, 'sessions'), 'cc-1', 'begin');

  // The brief's call: no session id, the folder as the agent spells it, its branch, its task and a title.
  const again = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ cwd: 'C:/code/apex/.claude/worktrees/one/', branch: 'claude/one', task, title: 'One run per session' }));
  assert.deepEqual([again.run, again.joined], [hooked.id, true], 'the hook’s run, not a second');
  const run = (await l.entity(hooked.id))!;
  assert.deepEqual([run.title, run.props.branch], ['One run per session', 'claude/one']);
  const { rows } = await l.db.query(`select 1 from relation where type = 'works_on' and from_id = $1 and to_id = $2 and valid_to is null`, [run.id, task]);
  assert.equal(rows.length, 1, 'and it works on the task');

  // Elsewhere, or on another branch than the one the hook's run is on, it is a session of its own.
  assert.notEqual((await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ cwd: 'C:/code/other' }))).run, hooked.id);
  assert.notEqual((await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ cwd: 'C:/code/apex/.claude/worktrees/one', branch: 'claude/two' }))).run, hooked.id);
});

test('of two chats in one folder, a call to register joins the one mid-turn, and neither when it cannot tell', async () => {
  const l = await fresh();
  await sessionHookPack.hookSessionStart(ownContext(l, 'sessions'), ({ session_id: 'a', cwd: '/w', source: 'startup' }));
  await sessionHookPack.hookSessionStart(ownContext(l, 'sessions'), ({ session_id: 'b', cwd: '/w', source: 'startup' }));
  const [a, b] = [(await chatRunPack.resolveRun(kernelContext(l, 'sessions'), 'a', false))!, (await chatRunPack.resolveRun(kernelContext(l, 'sessions'), 'b', false))!];
  const own = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ cwd: '/w' }));
  assert.ok(![a.id, b.id].includes(own.run), 'two chats here, neither at work: a run of its own');
  await sessionsPack.sessionHeard(ownContext(l, 'sessions'), 'b', 'begin');
  assert.equal((await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ cwd: '/w' }))).run, b.id, 'the one mid-turn is the one asking');
  // A call that names its own session id is that session, found by it or made.
  assert.notEqual((await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ cwd: '/w', session_id: 'c' }))).run, b.id);
});

test('a session that joins its hook’s run is told what every session is told as it begins', async () => {
  const l = await fresh();
  await sessionHookPack.hookSessionStart(ownContext(l, 'sessions'), ({ session_id: 'cc-2', cwd: '/joined', source: 'startup' }));
  await sessionsPack.sessionHeard(ownContext(l, 'sessions'), 'cc-2', 'begin');
  const again = (await callTool(l, agent, 'capture', { action: 'session_start', params: { cwd: '/joined' } })) as { joined?: boolean; instructions?: string[] };
  assert.equal(again.joined, true);
  assert.ok(again.instructions?.some((one) => /report, action tell/.test(one)), 'how to report in, among the rest');
  assert.ok(again.instructions?.every((one) => !one.includes('{run}')), 'with its run filled in');
});
