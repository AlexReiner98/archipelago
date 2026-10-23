import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hookSessionEnd, hookSessionStart, sessionEnd, sessionStart, sessionUpdate, tell } from '../src/sessions.ts';
import { callTool } from '../src/tools.ts';
import { VIEWS } from '../src/views.ts';
import { askView } from '../src/askview.ts';
import { human, agent, fresh, attend, make, laneSetup } from './map.ts';

/** A view asked by its name, as the view tool asks it. */
const ask = (l: Parameters<typeof askView>[0], name: string, params: Record<string, unknown> = {}) => askView(l, { kind: 'human', name: 'test' }, name, params);

test('a session registers, takes the lane its task needs, and gives it back when it ends', async () => {
  const l = await fresh();
  const made = await laneSetup(l);

  const one = await sessionStart(l, agent, { task: made.live, cwd: 'c:/code/apex/src', session_id: 's1' });
  assert.equal(one.status, 'running');
  assert.deepEqual(one.claimed, ['Live lane']);
  assert.equal(one.repo?.title, 'Apex repo', 'found by a subfolder, whatever the slashes or case');
  assert.equal((await l.proposals()).length, 0, 'operational state needs no approval');
  assert.equal((await sessionStart(l, agent, { session_id: 's1' })).resumed, true, 'announcing twice is safe');

  // A second session wanting the same lane is told who has it, and waits.
  const two = await sessionStart(l, agent, { task: made.live, session_id: 's2' });
  assert.equal(two.status, 'waiting');
  assert.match(two.blocked![0].why, /held by "Session: Capture probe"/);

  await sessionUpdate(l, agent, { run: 's1', note: 'Probe captured; parity is off by 2 px' });
  let view = (await VIEWS.sessions.run(l, {})) as any;
  const first = view.open.find((r: any) => r.id === one.run);
  assert.deepEqual(first.holds.map((h: any) => h.title), ['Live lane']);
  assert.deepEqual(first.working_on.map((w: any) => w.title), ['Capture probe']);
  assert.equal(first.stale, false);
  assert.match((await l.entity(one.run))!.body, /parity is off by 2 px/);

  const ended = await sessionEnd(l, agent, { run: 's1', summary: 'Done' });
  assert.deepEqual([ended.status, ended.released], ['finished', 1]);
  assert.equal((await sessionEnd(l, agent, { run: one.run })).already_ended, true);
  view = (await VIEWS.sessions.run(l, {})) as any;
  assert.deepEqual(view.open.map((r: any) => r.id), [two.run]);
  assert.equal((await l.claim(agent, { resource: made.lane, holder: two.run, reason: 'My turn' })).status, 'claimed');
  await assert.rejects(sessionUpdate(l, agent, { run: one.run, note: 'late' }), /already ended/);
});

test('a project’s open questions are what needs the owner in it, and its next release says where it stands', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'work.project', title: 'Shadows', status: 'active' },
    { op: 'create', ref: 'q', type: 'work.decision', title: 'Which licence?', status: 'open', props: { options: ['MIT', 'Apache'] } },
    { op: 'link', type: 'part_of', from: 'q', to: 'p' },
    { op: 'create', ref: 'a', type: 'work.task', title: 'Write the installer', status: 'todo' },
    { op: 'create', ref: 'b', type: 'work.task', title: 'Sign the package', status: 'done' },
    { op: 'link', type: 'part_of', from: 'a', to: 'p' },
    { op: 'link', type: 'part_of', from: 'b', to: 'p' },
    { op: 'link', type: 'depends_on', from: 'a', to: 'q' },
    { op: 'create', ref: 'r', type: 'software.release', title: 'First release', status: 'upcoming' },
    { op: 'link', type: 'part_of', from: 'r', to: 'p' },
    { op: 'link', type: 'depends_on', from: 'r', to: 'a' },
    { op: 'link', type: 'depends_on', from: 'r', to: 'b' },
    { op: 'create', ref: 'quiet', type: 'work.project', title: 'Quiet one', status: 'active' },
  ]);
  const asked = await attend(l, { reasons: ['unsettled'], within: made.p });
  assert.deepEqual(asked.items.map((q: any) => [q.title, q.reasons[0].by, q.top.title]), [['Which licence?', 'word', 'Shadows']]);
  assert.deepEqual((await attend(l, { reasons: ['unsettled'], within: made.quiet })).items, []);
  const gate = (await ask(l, 'gate', { event: made.r })) as any;
  const items = gate.streams.flatMap((s: any) => s.items);
  assert.deepEqual([items.filter((i: any) => i.done).length, items.length, items.filter((i: any) => i.blocked).map((i: any) => i.title)], [1, 2, ['Write the installer']]);
});

test('a session tells the story of its work, beat by beat, and can take a beat back', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'a', type: 'work.task', title: 'Fix the halo' },
    { op: 'create', ref: 'b', type: 'work.issue', title: 'Labels clip' },
    { op: 'link', type: 'depends_on', from: 'a', to: 'b' },
    { op: 'create', ref: 'c', type: 'work.task', title: 'Unrelated' },
  ]);
  const { run } = await sessionStart(l, agent, { title: 'Storyteller', session_id: 's-story' });
  const one = await tell(l, agent, { run: 's-story', said: 'The halo is blocked by the clipping: fix that first.', links: [{ from: made.b, to: made.a, says: 'is why' }] });
  assert.deepEqual([one.run, one.beat, one.standing], [run, 1, 1]);
  await tell(l, agent, { run, said: 'The unrelated task matters after all.', about: [made.c] });
  const three = await tell(l, agent, { run, said: 'No: it does not.', replaces: 2 });
  assert.equal(three.standing, 2);
  assert.equal((await l.proposals()).length, 0, 'a story needs no approval');
  assert.equal(((await l.events({ target: run })) as any[]).length, 1, 'and logs no event: only the session starting');

  const told = (await VIEWS.story.run(l, { run })) as any;
  assert.deepEqual(told.beats.map((b: any) => [b.n, b.replaced_by ?? null]), [[1, null], [2, 3], [3, null]]);
  // The picture of it is a lens started from the story, the same answer every style draws.
  const drawn = (await ask(l, 'lens', { story: 's-story' })) as any;
  assert.deepEqual(drawn.items.map((i: any) => i.title), ['Labels clip', 'Fix the halo'], 'what only a beat taken back was about drops out; the rest in the order told');
  assert.deepEqual(drawn.items.map((i: any) => i.told), [[1], [1]]);
  assert.deepEqual(drawn.links.map((k: any) => [k.kind, k.says ?? null]), [['said', 'is why']], 'the map’s own link between the two is said by the session’s words');
  assert.deepEqual(drawn.views, [], 'a story is drawn under no view of the workspace');
  assert.match(drawn.said, /What "Storyteller" told of/);
  assert.deepEqual(drawn.controls, [], 'nothing to light it by but what it says');

  // The page opens on the finding: the latest that stands, else the latest beat; its picture is that beat alone.
  assert.equal(told.finding, 3);
  await assert.rejects(tell(l, agent, { run, said: 'Found nothing about anything', finding: true }), /names the items/);
  const found = await tell(l, agent, { run, said: `The halo waits on ${made.b} only; fix that and ${made.a} can go.`, about: [made.a, made.b], finding: true });
  await tell(l, agent, { run, said: 'A later note on the side.', about: [made.c] });
  assert.equal(((await VIEWS.story.run(l, { run })) as any).finding, found.beat, 'a later beat is history under the finding');
  const alone = (await ask(l, 'lens', { story: run, beat: found.beat })) as any;
  assert.deepEqual(alone.items.map((i: any) => i.title).sort(), ['Fix the halo', 'Labels clip']);
  await assert.rejects(ask(l, 'lens', { story: run, beat: 2 }), /No beat 2 stands/);

  await assert.rejects(tell(l, agent, { run, said: 'x'.repeat(281) }), /280 characters/);
  await assert.rejects(tell(l, agent, { run, said: 'About nothing real', about: ['e_nothere1'] }), /No item "e_nothere1"/);
  await assert.rejects(tell(l, agent, { run, said: 'Again', replaces: 2 }), /already taken back/);
  await sessionEnd(l, agent, { run });
  await assert.rejects(tell(l, agent, { run, said: 'Too late' }), /already ended/);
  assert.equal(((await VIEWS.story.run(l, { run })) as any).beats.length, 5, 'the story is still read after the session ends');
});

test('a session that goes quiet is shown as stale', async () => {
  const l = await fresh();
  const { run } = await sessionStart(l, agent, { title: 'Quiet one' });
  await l.db.query(`update entity set props = props || '{"last_seen":"2020-01-01T00:00:00Z"}' where id = $1`, [run]);
  assert.equal(((await VIEWS.sessions.run(l, {})) as any).open[0].stale, true);
  await sessionUpdate(l, agent, { run });
  assert.equal(((await VIEWS.sessions.run(l, {})) as any).open[0].stale, false, 'a heartbeat clears it');
  assert.equal(((await l.events({ target: run })) as any[]).length, 1, 'and leaves no event');
});

test('a brief gathers a task\'s context, blockers, needs and rules', async () => {
  const l = await fresh();
  const made = await laneSetup(l);
  const holder = await sessionStart(l, agent, { title: 'Other session' });
  await l.claim(agent, { resource: made.lane, holder: holder.run, reason: 'busy' });

  const brief = (await VIEWS.brief.run(l, { task: made.live })) as any;
  assert.equal(brief.repo.path, 'C:\\code\\Apex');
  assert.deepEqual(brief.needs.map((n: any) => [n.title, n.held_by]), [['Live lane', 'Other session']]);
  assert.deepEqual(brief.ties.map((r: any) => [r.relation, r.title]), [['work.governed_by', 'One live lane.']]);
  for (const part of ['# Capture probe', 'Part of: Apex', 'held by Other session', 'Only one session drives the CAD app.']) {
    assert.ok(brief.text.includes(part), `expected "${part}" in:\n${brief.text}`);
  }
  const gated = (await VIEWS.brief.run(l, { task: made.gated })) as any;
  assert.deepEqual(gated.root_blockers.map((b: any) => b.title), ['Which target?']);
});

test('the session-start hook registers the session and hands it the repo\'s work and the lane state', async () => {
  const l = await fresh();
  const made = await laneSetup(l);
  const text = await hookSessionStart(l, { session_id: 'abc', cwd: 'C:\\code\\Apex' });
  assert.match(text, /registered in Archipelago/);
  const repoId = /Repository: Apex repo \((e_\w+)\)/.exec(text)?.[1];
  assert.ok(repoId, 'the repository comes with its id');
  assert.match(await hookSessionStart(l, { session_id: 'abc', cwd: 'C:\\code\\Apex' }), new RegExp(`Repository: Apex repo \\(${repoId}\\)`), 'a session that is resumed is told its repository again');
  // What the session was told is enough to ask for the repository's work; asked for none, the view says which there are.
  for (const repo of [repoId, 'apex repo']) assert.equal(((await callTool(l, human, 'view', { name: 'repo_work', params: { repo } })) as any).repo.id, repoId);
  await assert.rejects(async () => callTool(l, human, 'view', { name: 'repo_work', params: {} }), new RegExp(`repo_work needs "repo".*Repositories here: Apex repo \\(${repoId}\\)`));
  assert.match(text, new RegExp(`Write unit tests \\(${made.offline}\\)`));
  assert.match(text, /Tune the solver .* waiting on: Which target\?/);
  assert.match(text, /"Live lane" .* is free/);

  const other = await sessionStart(l, agent, { title: 'Lane holder' });
  await l.claim(agent, { resource: made.lane, holder: other.run, reason: 'busy' });
  assert.match(await hookSessionStart(l, { session_id: 'def', cwd: 'C:\\elsewhere' }), /does not know a repository[\s\S]*HELD by Lane holder: do not use it/);

  // On another machine the folder is somewhere else: the repository is known by the address it was cloned from, however that is written.
  await make(l, [{ op: 'update', id: repoId!, props: { remote: 'https://github.com/Acme/Apex' } }]);
  const far = await hookSessionStart(l, { session_id: 'far', cwd: '/home/someone/work/apex', remote: 'git@github.com:acme/apex.git' });
  assert.match(far, new RegExp(`Repository: Apex repo \\(${repoId}\\)`));
  assert.match(far, new RegExp(`Write unit tests \\(${made.offline}\\)`));
  assert.equal(((await VIEWS.sessions.run(l, {})) as any).open.find((r: any) => r.cwd === '/home/someone/work/apex').repo.id, repoId);
  assert.match(await hookSessionStart(l, { session_id: 'stranger', cwd: '/tmp/x', remote: 'https://github.com/acme/other' }), /does not know a repository for this folder \(a checkout of https:\/\/github\.com\/acme\/other\)/);
  for (const id of ['far', 'stranger']) await hookSessionEnd(l, { session_id: id });

  await hookSessionEnd(l, { session_id: 'abc', reason: 'logout' });
  const open = ((await VIEWS.sessions.run(l, {})) as any).open.map((r: any) => r.title);
  assert.ok(!open.includes('Session in Apex repo'));
  await hookSessionEnd(l, { session_id: 'never-seen' });
});

test('a session that finishes says where the repository\'s open work stands', async () => {
  const l = await fresh();
  const made = await laneSetup(l);
  const { run } = await sessionStart(l, agent, { cwd: 'C:\\code\\Apex', session_id: 'r1' });

  // It did one task and closed it; the other two it has not said a word about.
  await make(l, [{ op: 'update', id: made.offline, status: 'done' }]);
  const asked = (await callTool(l, agent, 'session_end', { run, summary: 'Tests written' })) as any;
  assert.equal(asked.ended, false);
  assert.deepEqual(asked.unreconciled.map((i: any) => i.title).sort(), ['Capture probe', 'Tune the solver'], 'what it changed is not asked about');
  assert.equal((await l.entity(run))!.is_open, true, 'and the session is still open');

  // Vouching for one is not enough; for both, it ends and the run keeps what was said.
  assert.equal(((await callTool(l, agent, 'session_end', { run, still_true: [made.live] })) as any).unreconciled.length, 1);
  const ended = (await callTool(l, agent, 'session_end', { run, summary: 'Tests written', still_true: [made.live, made.gated] })) as any;
  assert.equal(ended.status, 'finished');
  assert.match((await l.entity(run))!.body, /Tests written\nSaid still true: .*Capture probe.*Tune the solver/);
  // Vouching is said on the item as well: an update that changes nothing, which moves when it was last known true.
  // It is the agent's word like any other, so here, where agents' changes are held, it waits for the owner.
  const vouch = (await l.proposals()).at(-1)!;
  assert.deepEqual(vouch.ops, [{ op: 'update', id: made.live }, { op: 'update', id: made.gated }]);
  assert.match(vouch.reason, /still true as written/);
  await l.decide({ kind: 'human', name: 'owner' }, { proposal: vouch.id, approve: true });
  const said = ((await l.events({ target: made.live })) as any[])[0];
  assert.deepEqual([said.action, said.detail.changes], ['entity.update', {}]);

  // What nobody has changed or confirmed for longest comes first, with its age; the session is told of it at the start.
  await l.db.query(`update entity set updated_at = now() - interval '40 days' where id = $1`, [made.gated]);
  await l.db.query(`update entity set updated_at = now() - interval '20 days' where id = $1`, [made.live]);
  const old = await attend(l, { reasons: ['stale'], within: made.repo });
  assert.deepEqual(old.items.map((i: any) => [i.title, i.reasons[0].days]).sort(), [['Capture probe', 20], ['Tune the solver', 40]]);
  assert.equal((await attend(l, { reasons: ['stale'], stale_days: 30 })).items.length, 1, 'only those older than asked for');
  const told = await hookSessionStart(l, { session_id: 'r0', cwd: 'C:\\code\\Apex' });
  assert.match(told, /Capture probe \(e_\w+\), not confirmed for 20 days/);
  assert.doesNotMatch(told, /Write unit tests.*not confirmed/);
  // Saying it is still true takes it off the list.
  await make(l, [{ op: 'update', id: made.gated }]);
  assert.deepEqual((await attend(l, { reasons: ['stale'] })).items.map((i: any) => i.title), ['Capture probe']);
  await callTool(l, { kind: 'human', name: 'owner' }, 'session_end', { run: 'r0', outcome: 'cancelled' });

  // A scheduled re-check asks what is due: a project says how often, weekly when it does not.
  let due = (await callTool(l, human, 'view', { name: 'recheck', params: { repo: made.repo } })) as any;
  assert.deepEqual([due.due, due.projects[0].every_days, due.projects[0].items.map((i: any) => i.title)], [true, 7, ['Capture probe']]);
  await make(l, [{ op: 'update', id: made.proj, props: { recheck_days: 30 } }]);
  assert.equal(((await callTool(l, human, 'view', { name: 'recheck', params: { repo: made.repo } })) as any).due, false, 'nothing here has gone 30 days');
  await make(l, [{ op: 'update', id: made.proj, props: { recheck_days: 0 } }]);
  assert.equal(((await callTool(l, human, 'view', { name: 'recheck', params: { repo: made.repo } })) as any).due, false, '0 turns it off');
  // Once done, the project waits out its interval again, even with old items left.
  await make(l, [{ op: 'update', id: made.proj, props: { recheck_days: 7 } }]);
  const done = (await callTool(l, agent, 'rechecked', { repo: made.repo, summary: 'One left for the owner' })) as any;
  assert.deepEqual(done.rechecked.map((p: any) => p.title), ['Apex']);
  due = (await callTool(l, human, 'view', { name: 'recheck', params: { repo: made.repo } })) as any;
  assert.deepEqual([due.due, typeof due.projects[0].rechecked_at], [false, 'string']);
  await l.db.query(`update entity set props = props || '{"rechecked_at":"2020-01-01T00:00:00Z"}' where id = $1`, [made.proj]);
  assert.equal(((await callTool(l, human, 'view', { name: 'recheck', params: { repo: made.repo } })) as any).due, true, 'and is due again when it has');
  // Asked for now, it does not wait: the interval and the items' age are set aside.
  await callTool(l, agent, 'rechecked', { repo: made.repo });
  const atOnce = (await callTool(l, human, 'view', { name: 'recheck', params: { repo: made.repo, now: true } })) as any;
  assert.deepEqual([atOnce.due, atOnce.projects[0].items.length], [true, 2]);
  // An issue filed as about a project, not as part of it, is the repository's work all the same.
  const { drift } = await make(l, [
    { op: 'create', ref: 'drift', type: 'work.issue', title: 'The carve reads origins' },
    { op: 'link', type: 'about', from: 'drift', to: made.proj },
  ]);
  assert.ok(((await callTool(l, human, 'view', { name: 'repo_work', params: { repo: made.repo } })) as any).ready.some((i: any) => i.id === drift));

  // An open issue in the repository is its work too: shown at the start, asked about at the end.
  const { leak } = await make(l, [
    { op: 'create', ref: 'leak', type: 'work.issue', title: 'The probe leaks handles' },
    { op: 'link', type: 'part_of', from: 'leak', to: made.proj },
  ]);
  assert.match(await hookSessionStart(l, { session_id: 'r5', cwd: 'C:\\code\\Apex' }), new RegExp(`- Issue: The probe leaks handles \\(${leak}\\)`));
  assert.ok(((await callTool(l, agent, 'session_end', { run: 'r5' })) as any).unreconciled.some((i: any) => i.id === leak));
  await callTool(l, { kind: 'human', name: 'owner' }, 'session_end', { run: 'r5', outcome: 'cancelled' });
  await make(l, [{ op: 'archive', id: leak }]);

  // A session closed over its head (the hook, a crash) is recorded as not having said.
  await hookSessionStart(l, { session_id: 'r2', cwd: 'C:\\code\\Apex' });
  await hookSessionEnd(l, { session_id: 'r2', reason: 'exit' });
  const { rows } = await l.db.query<{ body: string }>(`select body from entity where props->>'session_id' = 'r2'`);
  assert.match(rows[0].body, /Session ended \(exit\)\nNot reconciled, open and left unsaid: .*Capture probe/);

  // The human ending one from the UI is not asked, and neither is a session that failed.
  const third = await sessionStart(l, agent, { cwd: 'C:\\code\\Apex' });
  assert.equal(((await callTool(l, { kind: 'human', name: 'owner' }, 'session_end', { run: third.run, outcome: 'cancelled' })) as any).status, 'cancelled');
  const fourth = await sessionStart(l, agent, { cwd: 'C:\\code\\Apex' });
  assert.equal(((await callTool(l, agent, 'session_end', { run: fourth.run, outcome: 'failed' })) as any).status, 'failed');
});

test('work that waits on a person is blocked by them, needs them, and is not asked of a session; a session can say it cannot tell', async () => {
  const l = await fresh();
  const made = await laneSetup(l);
  const { me, sam } = await make(l, [
    { op: 'create', ref: 'me', type: 'person', title: 'Owner' },
    { op: 'create', ref: 'sam', type: 'person', title: 'Sam' },
  ]);
  await l.db.query(`insert into setting (key, value) values ('me', $1::jsonb)`, [JSON.stringify(me)]);
  // Only a person, company or agent can be waited on: other work is depended on.
  await assert.rejects(l.change(human, { ops: [{ op: 'link', type: 'waits_on', from: made.offline, to: made.live }], reason: 'test' }), /waits_on/);
  await make(l, [
    { op: 'update', id: made.offline, status: 'waiting', owner: sam },
    { op: 'link', type: 'waits_on', from: made.offline, to: me, props: { for: 'saying which framework' } },
  ]);

  // It is blocked, by the person; it needs them though it is not theirs; and its owner is waiting on them.
  const offline = (await attend(l, {})).items.find((b: any) => b.id === made.offline);
  assert.deepEqual(offline.reasons.map((r: any) => [r.why, r.who ?? r.by]), [['waits_on', 'Owner'], ['blocked', ['Owner']]]);
  assert.deepEqual((await attend(l, { person: 'me', reasons: ['waits_on'] })).items.map((e: any) => e.title), ['Write unit tests']);
  assert.deepEqual((await attend(l, { person: sam, reasons: ['blocked'] })).items.map((r: any) => r.reasons[0].by), [['Owner']]);
  assert.ok(!(await attend(l, { reasons: ['ready'] })).items.some((t: any) => t.id === made.offline), 'what waits on a person is not ready');
  const work = (await callTool(l, human, 'view', { name: 'repo_work', params: { repo: made.repo } })) as any;
  assert.deepEqual(work.blocked.find((b: any) => b.id === made.offline).waiting_on, ['Owner']);

  // A session ending there is not asked about it: nothing it did could have settled it.
  const { run } = await sessionStart(l, agent, { cwd: 'C:\\code\\Apex', session_id: 'w1' });
  const asked = (await callTool(l, agent, 'session_end', { run })) as any;
  assert.deepEqual(asked.unreconciled.map((i: any) => i.title).sort(), ['Capture probe', 'Tune the solver']);
  // What it never looked at it says it cannot tell: that ends it, and the item is left as it was, not marked as checked.
  const before = (await l.entity(made.gated))!.updated_at;
  const ended = (await callTool(l, agent, 'session_end', { run, summary: 'Probe looked at', still_true: [made.live], cannot_tell: [made.gated] })) as any;
  assert.equal(ended.status, 'finished');
  assert.match((await l.entity(run))!.body, /Said still true: Capture probe .*\nCould not tell from here, left as found: Tune the solver/);
  assert.deepEqual((await l.proposals()).at(-1)!.ops, [{ op: 'update', id: made.live }], 'only what was vouched for is said to be checked');
  assert.deepEqual((await l.entity(made.gated))!.updated_at, before);

  // The next session is not asked about what has a change waiting for the owner (the vouching above is one, held),
  // and answers for all it never looked at in one word.
  const next = await sessionStart(l, agent, { cwd: 'C:\\code\\Apex', session_id: 'w2' });
  const again = (await callTool(l, agent, 'session_end', { run: next.run })) as any;
  assert.deepEqual(again.unreconciled.map((i: any) => i.title), ['Tune the solver']);
  assert.equal(((await callTool(l, agent, 'session_end', { run: next.run, cannot_tell_rest: true })) as any).status, 'finished');
  assert.match((await l.entity(next.run))!.body, /Could not tell from here, left as found: 1 item it did not look at\./);

  // Once they have answered, the link is removed and the work is free again.
  const link = (await l.get(made.offline)).outgoing.find((r: any) => r.type === 'waits_on') as any;
  await make(l, [{ op: 'unlink', relation: link.relation }]);
  assert.ok(((await callTool(l, human, 'view', { name: 'repo_work', params: { repo: made.repo } })) as any).ready.some((i: any) => i.id === made.offline));
});

