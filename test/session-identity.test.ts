import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sessionStart } from '../src/sessions.ts';
import { mintName, sessionNames } from '../src/session-name.ts';
import { pageStyle } from '../src/styles.ts';
import { callTool } from '../src/tools.ts';
import { agent, fresh, human } from './map.ts';

test('each session is named by a word its type gives, none another open one holds, its hue apart from theirs', async () => {
  const l = await fresh();
  const names = sessionNames(l);
  const hues = ((await pageStyle(l, {}, false)).style.hues as string[]).length;
  assert.ok(names.length >= hues, 'more names than hues, so each hue has a name');
  const started = [];
  for (let i = 0; i < hues; i++) started.push(await sessionStart(l, agent, { session_id: `s${i}`, cwd: '/tmp/x' }));
  const named = started.map((s) => s.name!);
  assert.equal(new Set(named).size, hues, 'no two open sessions share a name');
  assert.equal(new Set(named.map((n) => names.indexOf(n) % hues)).size, hues, 'nor a hue, while there are hues to go round');
  for (const s of started) {
    const run = (await l.entity(s.run))!;
    assert.deepEqual([run.title, run.props.name], [`Session ${s.name}`, s.name], 'its title says it is a session, by its name');
  }
  // A launcher's own words for it are its note, not its name.
  const launched = await sessionStart(l, agent, { title: 'Headless (plan): Tune the solver' });
  assert.equal((await l.entity(launched.run))!.body, 'Headless (plan): Tune the solver');
  // Past every hue, still a free name; past every name, any.
  assert.ok(!named.includes((await mintName(l, () => 0))!));
});

test('a change says the session it was made in, and the log and its events name that session', async () => {
  const l = await fresh();
  const one = await sessionStart(l, agent, { session_id: 'abc' });
  const held = (await callTool(l, agent, 'change', { ops: [{ op: 'create', type: 'task', title: 'Tried', status: 'todo' }], reason: 'test', run: 'abc' })) as any;
  assert.equal(held.status, 'proposed', 'an agent’s change waits here');
  const { rows: pending } = await l.db.query<{ head: Record<string, unknown> }>(`select head from log_entry where id = $1`, [held.proposal]);
  assert.equal(pending[0].head.run, one.run, 'the session id resolves to its run, kept in the held entry');
  const queue = (await callTool(l, human, 'proposals', {})) as any[];
  assert.equal(queue.find((p) => p.id === held.proposal).run_name, `Session ${one.name}`, 'the review queue names the session too');
  // Approved by the owner, it is still the session's: the run goes with it into the facts.
  const made = (await l.decide(human, { proposal: held.proposal, approve: true })) as any;
  const { rows } = await l.db.query<{ head: Record<string, unknown> }>(`select head from log_entry where id = $1`, [made.changeset]);
  assert.equal(rows[0].head.run, one.run);
  const events = (await callTool(l, human, 'events', { limit: 5 })) as any;
  const ev = (Array.isArray(events) ? events : events.events).find((e: any) => e.changeset === made.changeset && e.action === 'entity.create');
  assert.equal(ev.detail.run_name, `Session ${one.name}`, 'an event names the session by its name');
  await assert.rejects(callTool(l, agent, 'change', { ops: [{ op: 'create', type: 'task', title: 'Nope', status: 'todo' }], reason: 'test', run: 'nobody' }), /no open session "nobody"/);
});
