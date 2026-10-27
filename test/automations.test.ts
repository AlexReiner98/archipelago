import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Automations } from '../src/automations.ts';
import { heldResources } from '../src/blocking.ts';
import { Archipelago, type Op } from '../src/pelago.ts';
import { sessionStart, sessionUpdate } from '../src/sessions.ts';
import { callTool } from '../src/tools.ts';
import { VIEWS } from '../src/views.ts';
import { askView } from '../src/askview.ts';
import { human, agent, fresh, make } from './map.ts';

/** A view asked by its name, as the view tool asks it. */
const ask = (l: Parameters<typeof askView>[0], name: string, params: Record<string, unknown> = {}) => askView(l, { kind: 'human', name: 'test' }, name, params);

test('an agent can notify the human; a stale session raises one notification', async () => {
  const l = await fresh();
  const made = await make(l, [{ op: 'create', ref: 't', type: 'task', title: 'Ship it' }]);
  await callTool(l, agent, 'notify', { title: 'Blocked on a certificate', level: 'warning', about: made.t });
  assert.equal((await l.proposals()).length, 0);
  let unread = (await VIEWS.notifications.run(l, {})) as any[];
  assert.deepEqual([unread[0].title, unread[0].level, unread[0].from, unread[0].about_title], ['Blocked on a certificate', 'warning', 'agent:test', 'Ship it']);

  const lane = (await make(l, [{ op: 'create', ref: 'lane', type: 'resource', title: 'Live lane' }])).lane;
  const { run } = await sessionStart(l, agent, { title: 'Quiet one' });
  await l.claim(agent, { resource: lane, holder: run, reason: 'busy' });
  const silent = (id: string, hours: number) => l.db.query(`update entity set props = props || jsonb_build_object('last_seen', $2::text) where id = $1`, [id, new Date(Date.now() - hours * 3_600_000).toISOString()]);
  await silent(run, 1);
  // One that holds nothing is not worth a notice: it ends by itself.
  const idle = (await sessionStart(l, agent, { title: 'Idle one' })).run;
  await silent(idle, 1);
  const autos = new Automations(l);
  await autos.tick();
  await autos.tick();
  unread = (await VIEWS.notifications.run(l, {})) as any[];
  const stale = unread.filter((n) => n.title.includes('gone quiet'));
  assert.equal(stale.length, 1, 'told once, not every pass');
  assert.match(stale[0].body, /still holds: Live lane/);

  // Heard from again, the notice is no longer true and leaves what there is to read; quiet again, it is told again; ended, it leaves again.
  const quiet = async () => ((await VIEWS.notifications.run(l, {})) as any[]).filter((n) => n.title.includes('gone quiet')).length;
  await sessionUpdate(l, agent, { run });
  assert.equal(await quiet(), 0, 'withdrawn when the session reports in');
  await silent(run, 1);
  await autos.tick();
  assert.equal(await quiet(), 1, 'told again when it goes quiet again');
  // Half a day without a word, a session is ended for it: the notice goes, and what it held is given back.
  assert.equal((await l.entity(idle))!.is_open, true, 'an hour is not half a day');
  await silent(run, 13);
  await silent(idle, 13);
  await autos.tick();
  const gone = (await l.entity(run))!;
  assert.deepEqual([gone.status, (await l.entity(idle))!.status], ['finished', 'finished']);
  assert.match(gone.body, /Not heard from for over 12 hours: ended for it/);
  assert.equal(await quiet(), 0, 'withdrawn when the session ends');
  assert.equal((await heldResources(l)).length, 0, 'the lane is free');
  assert.equal(((await VIEWS.notifications.run(l, {})) as any[]).length, 1, 'other notifications are left alone');
});

test('automations fire on a schedule and on events, are logged, and cannot trigger each other', async () => {
  const l = await fresh();
  await assert.rejects(
    make(l, [{ op: 'create', type: 'automation', title: 'Half-made', status: 'enabled', props: { trigger: 'every', action: 'tool', tool: 'decide' } }]),
    /needs every_minutes[\s\S]*tool to be one of: check_connections, import_audit/,
  );
  // An agent can only propose one.
  const proposed = await l.change(agent, { reason: 'test', ops: [{ op: 'create', type: 'automation', title: 'Sneaky', status: 'enabled', props: { trigger: 'every', every_minutes: 1, action: 'notify' } }] });
  assert.equal(proposed.status, 'proposed');

  const made = await make(l, [
    { op: 'create', ref: 'hourly', type: 'automation', title: 'Check connections', status: 'enabled', props: { trigger: 'every', every_minutes: 60, action: 'tool', tool: 'check_connections' } },
    { op: 'create', ref: 'morning', type: 'automation', title: 'Morning nudge', status: 'enabled', props: { trigger: 'daily', at: '09:00', action: 'notify', message: 'Review the map' } },
    { op: 'create', ref: 'review', type: 'automation', title: 'New proposal', status: 'enabled', props: { trigger: 'event', on_action: 'proposal.create', action: 'notify', message: 'Proposal from {actor}: {reason}', level: 'warning' } },
    { op: 'create', ref: 'any', type: 'automation', title: 'Everything', status: 'paused', props: { trigger: 'event', on_action: 'entity.*', action: 'notify' } },
  ]);
  // Nor where agents' other changes are applied as made: an automation acts later with a human's authority, so
  // making one, changing one or bringing one back waits for the human.
  const loose = new Archipelago(l.db, l.registry, { create: 'auto', update: 'auto', archive: 'auto', restore: 'auto', link: 'auto' });
  const launches = { trigger: 'every', every_minutes: 1, action: 'launch', input: { task: made.hourly, mode: 'acceptEdits', instructions: 'anything' } };
  assert.equal((await loose.change(agent, { reason: 'x', ops: [{ op: 'create', type: 'task', title: 'An ordinary thing' }] })).status, 'applied');
  assert.equal((await loose.change(agent, { reason: 'x', ops: [{ op: 'create', type: 'automation', title: 'Launches', status: 'enabled', props: launches }] })).status, 'proposed');
  assert.equal((await loose.change(agent, { reason: 'x', ops: [{ op: 'update', id: made.morning, props: launches }] })).status, 'proposed');
  assert.equal((await loose.change(agent, { reason: 'x', ops: [{ op: 'update', id: made.any, status: 'enabled' }] })).status, 'proposed');
  const autos = new Automations(l);
  const at = (h: number, m = 0) => new Date(2026, 9, 7, h, m);
  const fired = async (when: Date) => (await autos.tick(when)).map((f) => f.automation).sort();

  assert.deepEqual(await fired(at(8)), [made.hourly], 'interval fires at once; daily waits for its time; events start from now');
  assert.deepEqual(await fired(at(8, 30)), []);
  assert.deepEqual(await fired(at(9, 1)), [made.hourly, made.morning].sort());
  assert.deepEqual(await fired(at(9, 30)), [], 'daily fires once a day');
  assert.deepEqual(await fired(new Date(2026, 9, 8, 9, 0)), [made.hourly, made.morning].sort());

  await l.change(agent, { reason: 'Found a bug', ops: [{ op: 'create', type: 'bug', title: 'Crash' }] });
  assert.deepEqual(await fired(new Date(2026, 9, 8, 9, 5)), [made.review]);
  const unread = (await VIEWS.notifications.run(l, {})) as any[];
  assert.ok(unread.some((n) => n.title === 'Proposal from agent:test: Found a bug' && n.level === 'warning'));

  // Unpause the catch-all: the notifications automations create must not set it off.
  await make(l, [{ op: 'update', id: made.any, status: 'enabled' }]);
  await autos.tick(new Date(2026, 9, 8, 9, 6));
  const before = ((await VIEWS.notifications.run(l, {})) as any[]).length;
  assert.deepEqual(await fired(new Date(2026, 9, 8, 9, 7)), []);
  assert.equal(((await VIEWS.notifications.run(l, {})) as any[]).length, before);

  const hourly = (await l.entity(made.hourly))!;
  assert.match(hourly.props.last_result as string, /^ok: \[\]/);
  const log = (await l.events({ target: made.hourly })) as any[];
  assert.equal(log.filter((e) => e.action === 'automation.fire').length, 3);
  assert.equal(log[0].actor, `agent:automation:${made.hourly}`);
});

test('a note is added to, or one passage of it replaced, without sending it again', async () => {
  const { undo } = await import('../src/undo.ts');
  const l = await fresh();
  const note = 'Seen\n- once, on Monday.\n\nWhat would help\nA smaller answer.';
  const { t } = await make(l, [{ op: 'create', ref: 't', type: 'task', title: 'Trim the answer', body: note }]);
  const body = async () => (await l.entity(t))!.body;

  const added = await l.change(human, { reason: 'test', ops: [{ op: 'update', id: t, status: 'done', append: 'Outcome\nTrimmed to a tenth.\n' }] });
  assert.equal(await body(), `${note}\n\nOutcome\nTrimmed to a tenth.`, 'after a blank line, the rest untouched');

  await make(l, [{ op: 'update', id: t, replace: { find: '- once, on Monday.', with: '- twice: Monday and $& Tuesday.' }, append: 'Checked again.' }]);
  assert.equal(await body(), `${note.replace('once, on Monday', () => 'twice: Monday and $& Tuesday')}\n\nOutcome\nTrimmed to a tenth.\n\nChecked again.`, 'what replaces it is taken as written');

  const before = await body();
  const refused = (ops: Op[], why: RegExp) => assert.rejects(l.change(human, { reason: 'test', ops }), why);
  await refused([{ op: 'update', id: t, replace: { find: 'not in the note', with: 'x' } }], /"Trim the answer": replace\.find must be in the note exactly once, and is there not at all/);
  await refused([{ op: 'update', id: t, replace: { find: '\n\n', with: 'x' } }], /is there 3 times/);
  await refused([{ op: 'update', id: t, body: 'All new', append: 'and more' }], /not both/);
  assert.equal(await body(), before, 'a refused change leaves the note alone');

  // A part of a note held for review is checked again when it is approved: the note may have moved on.
  const held = await l.change(agent, { reason: 'test', ops: [{ op: 'update', id: t, replace: { find: 'Checked again.', with: 'Checked twice.' } }] });
  assert.equal(held.status, 'proposed');
  await make(l, [{ op: 'update', id: t, replace: { find: 'Checked again.', with: 'Checked.' } }]);
  await assert.rejects(l.decide(human, { proposal: (held as { proposal: string }).proposal, approve: true }), /is there not at all/);

  await undo(l, human, { changeset: (added as { changeset: string }).changeset });
  assert.equal((await l.entity(t))!.status, 'todo', 'undone like any other edit');

  // An item's history is the last few changes, a long note cut to its start and its length, for anyone: the item says
  // what it is now. The whole record is the log's: an agent asks events for all of it, and a person is given it whole.
  const long = 'A long note. '.repeat(100);
  await make(l, [{ op: 'update', id: t, body: long }]);
  const to = (answer: any) => (answer.recent_events ?? answer)[0].detail.changes.body.to as string;
  for (const who of [agent, human]) assert.match(to(await callTool(l, who, 'get', { id: t, history: true, full: true })), /^A long note\. .{180,200}… \(1300 characters; query events, with full: true, has all of it\)$/, who.kind);
  for (let i = 0; i < 10; i++) await make(l, [{ op: 'update', id: t, props: { priority: i % 2 ? 'high' : 'low' } }]);
  assert.equal(((await callTool(l, human, 'get', { id: t })) as any).recent_events.length, 8, 'only the last few');
  const bodyIn = async (who: typeof agent, full?: boolean) => ((await callTool(l, who, 'events', { target: t, limit: 20, full })) as any[]).find((e) => e.detail?.changes?.body).detail.changes.body.to as string;
  assert.match(await bodyIn(agent), /^A long note\. .{180,200}… \(1300 characters; ask again with full: true for all of it\)$/, 'events, for an agent');
  assert.equal(await bodyIn(agent, true), long, 'events, in full');
  assert.equal(await bodyIn(human), long, 'events, for a person');
  assert.equal(((await callTool(l, agent, 'get', { id: t })) as any).entity.body, long, 'the note itself is always whole');
  // An agent that asks for an item is given the item: its history comes when asked for.
  assert.equal(((await callTool(l, agent, 'get', { id: t })) as any).recent_events, undefined);
  assert.ok(((await callTool(l, human, 'get', { id: t })) as any).recent_events.length);
});

test('a refused change is kept and corrected by its one wrong op; history says a change set’s reason once', async () => {
  const l = await fresh();
  const ops = [
    { op: 'create', ref: 'a', type: 'task', title: 'Draw the plan' },
    { op: 'create', ref: 'b', type: 'issue', title: 'The plan is drawn twice', props: { repro: 'Open it twice' } },
    { op: 'link', type: 'depends_on', from: 'a', to: 'b' },
  ];
  // The refusal names the flavour that has the field, and the name the change is kept under.
  const said = await callTool(l, agent, 'change', { ops, reason: 'A plan to draw' }).then(
    () => assert.fail('an issue has no repro'),
    (e: Error) => e.message,
  );
  assert.match(said, /op 2 \(create\): issue has no field "repro".*bug, a flavour of issue, has it/);
  const name = /kept for 10 minutes as "(k_\w+)"/.exec(said)![1];
  // A fix that is wrong again is refused again, under the same name.
  await assert.rejects(callTool(l, agent, 'change', { retry: name, fixes: [{ at: 2, op: { ...ops[1], title: 'x'.repeat(61) } }] }), new RegExp(`the title is 61 characters[^]*as "${name}"`));
  await assert.rejects(callTool(l, agent, 'change', { retry: name, fixes: [{ at: 9, op: null }] }), /no op 9/);
  // The name finds it, whatever the session calls itself this time.
  const sent = (await callTool(l, { ...agent, name: 'test/claude-code:elsewhere' }, 'change', { retry: name, fixes: [{ at: 2, op: { ...ops[1], type: 'bug' } }] })) as any;
  assert.equal(sent.status, 'proposed');
  const held = (await l.proposals()).at(-1)!;
  assert.equal(held.reason, 'A plan to draw');
  assert.deepEqual(held.ops.map((o: any) => o.type), ['task', 'bug', 'depends_on']);
  // Once it has gone through it is no longer kept; nor is it anyone else's to send.
  await assert.rejects(callTool(l, agent, 'change', { retry: name }), /No refused change is kept/);
  await assert.rejects(callTool(l, agent, 'change', { reason: 'nothing' }), /needs ops/);

  // What changed since: one change set says its reason and authority on the first of its events, and long notes are cut.
  const long = 'A long note. '.repeat(100);
  const made = await make(l, [
    { op: 'create', ref: 'x', type: 'task', title: 'First', body: long },
    { op: 'create', ref: 'y', type: 'task', title: 'Second' },
  ]);
  await make(l, [{ op: 'update', id: made.x, body: `${long}More.` }]);
  const since = { name: 'changed_since', params: { since: '2000-01-01' } };
  const events = ((await callTool(l, agent, 'view', since)) as any).events as any[];
  assert.match(events[0].detail.changes.body.to, /ask again with full: true/);
  const set = events.filter((e) => e.changeset === events.at(-1).changeset || e.target_id === made.y || e.target_id === made.x).filter((e) => e.action === 'entity.create');
  assert.deepEqual(set.map((e) => typeof e.reason), ['string', 'undefined'], 'the reason once');
  const whole = ((await callTool(l, agent, 'view', { ...since, params: { ...since.params, full: true } })) as any).events as any[];
  assert.ok(whole.every((e) => typeof e.reason === 'string'));
  assert.equal(whole[0].detail.changes.body.to, `${long}More.`);
});

test('undo reverses a change set as a new change, and leaves later edits alone', async () => {
  const { undo } = await import('../src/undo.ts');
  const l = await fresh();
  const base = await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'Proj' },
    { op: 'create', ref: 'old', type: 'task', title: 'Old task', body: 'x'.repeat(500), props: { priority: 'low' } },
    { op: 'link', type: 'part_of', from: 'old', to: 'p' },
  ]);
  const rel = (await l.get(base.old)).outgoing[0] as any;
  const second = await l.change(human, {
    reason: 'Reshuffle',
    ops: [
      { op: 'create', ref: 'n', type: 'task', title: 'New task' },
      { op: 'link', type: 'part_of', from: 'n', to: base.p },
      { op: 'update', id: base.old, status: 'doing', body: 'short', props: { priority: 'high', due: '2026-12-01' } },
      { op: 'unlink', relation: rel.relation },
      { op: 'archive', id: base.p },
    ],
  });
  const set = (second as { changeset: string }).changeset;
  // Someone changes one of those fields again before the undo.
  await make(l, [{ op: 'update', id: base.old, props: { priority: 'urgent' } }]);

  // An agent's undo is a proposal like any other change.
  assert.equal((await undo(l, agent, { changeset: set })).status, 'proposed');

  const result = await undo(l, human, { changeset: set });
  assert.equal(result.status, 'applied');
  assert.deepEqual(result.skipped, ['"Old task": priority has changed again since, so it was left as it is']);
  const old = (await l.entity(base.old))!;
  assert.deepEqual([old.status, old.body.length, old.props.priority, old.props.due], ['todo', 500, 'urgent', undefined], 'long text comes back whole');
  assert.equal((await l.entity(base.p))!.archived_at, null, 'the archived project is restored');
  assert.deepEqual((await l.get(base.old)).outgoing.map((r: any) => r.title), ['Proj'], 'the removed link is back');
  assert.deepEqual((await l.search({ type: 'task' })).map((t) => t.title), ['Old task'], 'the created task is archived');

  await assert.rejects(undo(l, human, { changeset: set }), /already been undone/);
  await assert.rejects(undo(l, human, { changeset: 'c_nope' }), /No change set/);
  // Undoing the undo puts the second change back.
  await undo(l, human, { changeset: (result as { changeset: string }).changeset });
  assert.equal((await l.entity(base.old))!.status, 'doing');
});

test('the graph view returns a preset of the whole map, or one entity\'s neighbourhood', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'Proj' },
    { op: 'create', ref: 'a', type: 'task', title: 'A' },
    { op: 'create', ref: 'b', type: 'bug', title: 'B' },
    { op: 'create', ref: 'c', type: 'task', title: 'C', status: 'done' },
    { op: 'create', ref: 'lonely', type: 'note', title: 'Lonely' },
    { op: 'create', ref: 'far', type: 'task', title: 'Far' },
    { op: 'link', type: 'part_of', from: 'a', to: 'p' },
    { op: 'link', type: 'part_of', from: 'far', to: 'p' },
    { op: 'link', type: 'depends_on', from: 'a', to: 'b' },
    { op: 'link', type: 'depends_on', from: 'b', to: 'c' },
  ]);
  const titles = (g: any) => g.nodes.map((n: any) => n.title).sort();

  const blocking = (await ask(l, 'graph', {})) as any;
  assert.deepEqual(titles(blocking), ['A', 'B'], 'only what blocking relations connect; finished work left out');
  assert.deepEqual(blocking.edges.map((e: any) => e.type), ['depends_on']);
  const a = blocking.nodes.find((n: any) => n.title === 'A');
  assert.deepEqual([a.blocked, a.root], [true, 'task']);
  assert.equal(blocking.nodes.find((n: any) => n.title === 'B').root, 'issue', 'a flavour reports its root type');

  assert.deepEqual(titles(await ask(l, 'graph', { relations: 'all', include_closed: true })), ['A', 'B', 'C', 'Far', 'Proj']);
  assert.deepEqual(titles(await ask(l, 'graph', { focus: made.far, depth: 1 })), ['Far', 'Proj']);
  assert.deepEqual(titles(await ask(l, 'graph', { focus: made.far, depth: 2 })), ['A', 'Far', 'Proj']);
  assert.deepEqual(titles(await ask(l, 'graph', { focus: made.lonely })), ['Lonely'], 'a focus is shown even with no relations');
  await assert.rejects(ask(l, 'graph', { relations: 'everything' }), /must be one of/);
});

