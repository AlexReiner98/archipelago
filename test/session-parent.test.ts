import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sessionStart, sessionUpdate } from '../src/sessions.ts';
import { hookSessionStart } from '../src/session-hook.ts';
import { callTool } from '../src/tools.ts';
import { VIEWS } from '../src/views.ts';
import { agent, fresh } from './map.ts';

/** The runs a run was started from, as the map links them. */
const parentsOf = async (l: Awaited<ReturnType<typeof fresh>>, run: string) =>
  (await l.db.query<{ to_id: string }>(`select to_id from relation where from_id = $1 and type = 'started_from' and valid_to is null`, [run])).rows.map((r) => r.to_id);

test('a session started by another is linked to it, by its run id or its session id', async () => {
  const l = await fresh();
  const top = await sessionStart(l, agent, { session_id: 'top', surface: 'claude-code', title: 'Top' });
  const byId = await sessionStart(l, agent, { session_id: 'side-1', surface: 'claude-code', parent: top.run });
  const bySession = (await callTool(l, agent, 'session_start', { session_id: 'side-2', surface: 'claude-code', parent: 'top' })) as { run: string };
  assert.deepEqual(await parentsOf(l, byId.run), [top.run]);
  assert.deepEqual(await parentsOf(l, bySession.run), [top.run], 'a session id is resolved as any run is');
  assert.deepEqual(await parentsOf(l, top.run), [], 'one no session started has none');
  assert.equal((await l.proposals()).length, 0, 'a session’s own state needs no approval');
  // Announced again, with the same parent, it keeps its one link.
  await sessionStart(l, agent, { session_id: 'side-1', parent: 'top' });
  assert.deepEqual(await parentsOf(l, byId.run), [top.run]);
});

test('a session that learns its parent later says so, and the link follows', async () => {
  const l = await fresh();
  const [a, b] = [await sessionStart(l, agent, { session_id: 'a' }), await sessionStart(l, agent, { session_id: 'b' })];
  const side = await sessionStart(l, agent, { session_id: 'side' });
  await callTool(l, agent, 'session_update', { run: side.run, parent: 'a' });
  assert.deepEqual(await parentsOf(l, side.run), [a.run]);
  await sessionUpdate(l, agent, { run: 'side', parent: b.run });
  assert.deepEqual(await parentsOf(l, side.run), [b.run], 'a run has one parent: a new one replaces the old');
  await assert.rejects(sessionUpdate(l, agent, { run: 'side', parent: 'side' }), /started from itself/);
  await assert.rejects(sessionUpdate(l, agent, { run: 'b', parent: 'side' }), /was itself started from this one/, 'a tree has no loops');
});

test('an unknown parent is refused clearly, and nothing is made', async () => {
  const l = await fresh();
  await assert.rejects(sessionStart(l, agent, { session_id: 'orphan', parent: 'nobody' }), /No session "nobody" to have been started from/);
  assert.equal((await VIEWS.sessions.run(l, {}) as { open: unknown[] }).open.length, 0, 'the session was not registered');
  const run = (await sessionStart(l, agent, { session_id: 'later' })).run;
  await assert.rejects(sessionUpdate(l, agent, { run, parent: 'e_nothere' }), /No session "e_nothere"/);
  // A hook still registers its session when the parent it names is not on the map.
  await hookSessionStart(l, { session_id: 'hooked', cwd: 'c:/elsewhere', parent: 'nobody' });
  assert.equal((await VIEWS.sessions.run(l, {}) as { open: unknown[] }).open.length, 2);
});

test('the sessions view gives each open run its parent', async () => {
  const l = await fresh();
  const top = await sessionStart(l, agent, { session_id: 'top', title: 'Top' });
  const side = await sessionStart(l, agent, { session_id: 'side', parent: 'top' });
  await hookSessionStart(l, { session_id: 'hooked', cwd: 'c:/elsewhere', parent: 'top' });
  const open = ((await VIEWS.sessions.run(l, {})) as { open: { id: string; parent?: { id: string; title: string } }[] }).open;
  const at = (id: string) => open.find((r) => r.id === id)!;
  assert.deepEqual(at(side.run).parent, { id: top.run, title: 'Top', type: 'run' });
  assert.equal(at(top.run).parent, undefined);
  assert.equal(open.find((r) => r.id !== top.run && r.id !== side.run)!.parent?.id, top.run, 'a hook can say it too');
});
