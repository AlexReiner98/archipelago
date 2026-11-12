import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as sessionsPack from '../packs/sessions/kernel/sessions.ts';
import * as sessionNamePack from '../packs/sessions/kernel/session-name.ts';
import * as stylesPack from '../packs/styles/kernel/styles.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { agent, fresh, human } from './map.ts';
import { kernelContext, ownContext } from '../packs/loader/kernel/kernel-context.ts';

test('each session is named by a word its type gives, none another open one holds, its hue apart from theirs', async () => {
  const l = await fresh();
  const names = sessionNamePack.sessionNames(l);
  const hues = ((await stylesPack.pageStyle(kernelContext(l, 'styles'), {}, false)).style.hues as string[]).length;
  assert.ok(names.length >= hues, 'more names than hues, so each hue has a name');
  const started = [];
  for (let i = 0; i < hues; i++) started.push(await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ session_id: `s${i}`, cwd: '/tmp/x' })));
  const named = started.map((s) => s.name!);
  assert.equal(new Set(named).size, hues, 'no two open sessions share a name');
  assert.equal(new Set(named.map((n) => names.indexOf(n) % hues)).size, hues, 'nor a hue, while there are hues to go round');
  for (const s of started) {
    const run = (await l.entity(s.run))!;
    assert.deepEqual([run.title, run.props.name], ['Session in /tmp/x', s.name], 'called where it runs until its chat has a title; its word is its hue');
  }
  // A launcher's own words for it are its title, as a chat's are.
  const launched = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ title: 'Headless (plan): Tune the solver' }));
  assert.equal((await l.entity(launched.run))!.title, 'Headless (plan): Tune the solver');
  // Past every hue, still a free name; past every name, any.
  assert.ok(!named.includes((await sessionNamePack.mintName(kernelContext(l, 'sessions'), (() => 0)))!));
});

test('a change says the session it was made in, and the log and its events name that session', async () => {
  const l = await fresh();
  const one = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ session_id: 'abc', title: 'Try it' }));
  const held = (await callTool(l, agent, 'change', { ops: [{ op: 'create', type: 'task', title: 'Tried', status: 'todo' }], reason: 'test', run: 'abc' })) as any;
  assert.equal(held.status, 'proposed', 'an agent’s change waits here');
  const { rows: pending } = await l.db.query<{ head: Record<string, unknown> }>(`select head from log_entry where id = $1`, [held.proposal]);
  assert.equal(pending[0].head.run, one.run, 'the session id resolves to its run, kept in the held entry');
  const queue = (await callTool(l, human, 'proposals', {})) as any[];
  assert.equal(queue.find((p) => p.id === held.proposal).run_name, 'Try it', 'the review queue names the session too, by its chat'); 
  // Approved by the owner, it is still the session's: the run goes with it into the facts.
  const made = (await l.decide(human, { proposal: held.proposal, approve: true })) as any;
  const { rows } = await l.db.query<{ head: Record<string, unknown> }>(`select head from log_entry where id = $1`, [made.changeset]);
  assert.equal(rows[0].head.run, one.run);
  const events = (await callTool(l, human, 'events', { limit: 5 })) as any;
  const ev = (Array.isArray(events) ? events : events.events).find((e: any) => e.changeset === made.changeset && e.action === 'entity.create');
  assert.equal(ev.detail.run_name, 'Try it', 'an event names the session by its chat');
  await assert.rejects(callTool(l, agent, 'change', { ops: [{ op: 'create', type: 'task', title: 'Nope', status: 'todo' }], reason: 'test', run: 'nobody' }), /no open session "nobody"/);
});
