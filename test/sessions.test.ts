import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as sessionsPack from '../packs/sessions/kernel/sessions.ts';
import { HOOK_ACTOR } from '../packs/claude_code/kernel/session-hook.ts';
import * as sessionHookPack from '../packs/sessions/kernel/session-hook.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { bypassingRls } from '../packs/identity/kernel/outbox.ts';
import * as presencePack from '../packs/presence/kernel/presence.ts';
import { VIEWS } from '../packs/query/kernel/views.ts';
import * as askviewPack from '../packs/query/kernel/askview.ts';
import { join } from 'node:path';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { human, agent, fresh, freshWith, attend, make, PACKS } from './map.ts';
import { getItem, proposals } from '../packs/surface/kernel/map-reads.ts';
import { readEvents } from '../packs/log/kernel/eventlog.ts';
import { kernelContext, ownContext } from '../packs/loader/kernel/kernel-context.ts';
import type { Archipelago } from '../packs/write/kernel/pelago.ts';

/** A map with core and a type of repository found by its folder or its remote (test/packs/checkout), and no other pack. */
const laneMap = () => freshWith(new Registry([PACKS, join(import.meta.dirname, 'packs')], ['core', 'checkout']));

/** Work in a repository, with one task that needs the live lane and one that does not. */
async function laneSetup(l: Parameters<typeof make>[0]) {
  return make(l, [
    { op: 'create', ref: 'tree', type: 'checkout', title: 'Apex repo', props: { path: 'C:\\code\\Apex' } },
    { op: 'create', ref: 'proj', type: 'work', title: 'Apex' },
    { op: 'create', ref: 'lane', type: 'place', props: { exclusive: true }, title: 'Live lane' },
    { op: 'create', ref: 'rule', type: 'decision', title: 'One live lane.', status: 'decided', props: { outcome: 'Only one session drives the CAD app.' } },
    { op: 'create', ref: 'live', type: 'task', title: 'Capture probe' },
    { op: 'create', ref: 'offline', type: 'task', title: 'Write unit tests' },
    { op: 'create', ref: 'q', type: 'decision', title: 'Which target?' },
    { op: 'create', ref: 'gated', type: 'task', title: 'Tune the solver' },
    { op: 'link', type: 'lives_in', from: 'proj', to: 'tree' },
    { op: 'link', type: 'part_of', from: 'live', to: 'proj' },
    { op: 'link', type: 'part_of', from: 'offline', to: 'proj' },
    { op: 'link', type: 'part_of', from: 'gated', to: 'proj' },
    { op: 'link', type: 'depends_on', from: 'gated', to: 'q' },
    { op: 'link', type: 'needs', from: 'live', to: 'lane' },
    { op: 'link', type: 'about', from: 'lane', to: 'rule' },
  ]);
}

/** A view asked by its name, as the view tool asks it. */
const ask = (l: Archipelago, name: string, params: Record<string, unknown> = {}) => askviewPack.askView(kernelContext(l, 'query'), ({ kind: 'human', name: 'test' }) as Parameters<typeof askviewPack.askView>[1], name, params);

test('a session registers, takes the lane its task needs, and gives it back when it ends', async () => {
  const l = await laneMap();
  const made = await laneSetup(l);

  const one = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ task: made.live, cwd: 'c:/code/apex/src', session_id: 's1' }));
  assert.equal(one.status, 'running');
  assert.deepEqual(one.claimed, ['Live lane']);
  assert.equal(one.repo?.title, 'Apex repo', 'found by a subfolder, whatever the slashes or case');
  assert.equal((await proposals(l)).length, 0, 'operational state needs no approval');
  assert.equal((await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ session_id: 's1' }))).resumed, true, 'announcing twice is safe');

  // A second session wanting the same lane is told who has it, and waits.
  const two = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ task: made.live, session_id: 's2' }));
  assert.equal(two.status, 'waiting');
  assert.match(two.blocked![0].why, /held by "Capture probe"/, 'named by what it works on, its chat having no title');

  await sessionsPack.sessionUpdate(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ run: 's1', note: 'Probe captured; parity is off by 2 px' }));
  let view = (await VIEWS.sessions.run(kernelContext(l, 'query'), {})) as any;
  const first = view.open.find((r: any) => r.id === one.run);
  assert.deepEqual(first.holds.map((h: any) => h.title), ['Live lane']);
  assert.deepEqual(first.working_on.map((w: any) => w.title), ['Capture probe']);
  assert.equal(first.stale, false);
  assert.match((await l.entity(one.run))!.body, /parity is off by 2 px/);

  const ended = await sessionsPack.sessionEnd(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ run: 's1', summary: 'Done' }));
  assert.deepEqual([ended.status, ended.released], ['finished', 1]);
  assert.equal((await sessionsPack.sessionEnd(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ run: one.run }))).already_ended, true);
  view = (await VIEWS.sessions.run(kernelContext(l, 'query'), {})) as any;
  assert.deepEqual(view.open.map((r: any) => r.id), [two.run]);
  assert.equal((await l.claim(agent, { resource: made.lane, holder: two.run, reason: 'My turn' })).status, 'claimed');
  await assert.rejects(sessionsPack.sessionUpdate(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ run: one.run, note: 'late' })), /already ended/);
});

test('one chat is one session: its agent saying it is done keeps it open, and only the chat ends it', async () => {
  const l = await fresh();
  const { run, name } = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ title: 'Chat', session_id: 'chat', surface: 'claude-code' }));
  const said = (await callTool(l, agent, 'session_end', { run, summary: 'The project is open' })) as any;
  assert.equal(said.status, 'waiting');
  assert.equal((await l.entity(run))!.is_open, true, 'still there to follow');
  assert.deepEqual(((await VIEWS.sessions.run(kernelContext(l, 'query'), {})) as any).open.map((r: any) => r.id), [run]);

  await sessionsPack.sessionPrompted(ownContext(l, 'sessions'), 'chat', HOOK_ACTOR as sessionsPack.Actor);
  assert.equal((await l.entity(run))!.status, 'running', 'the next message puts it back to work');
  await sessionsPack.sessionUpdate(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ run, note: 'Going on' }));

  await callTool(l, agent, 'session_end', { run, summary: 'All done' });
  await sessionHookPack.hookSessionEnd(ownContext(l, 'sessions'), ({ session_id: 'chat', reason: 'exit' }));
  const closed = (await l.entity(run))!;
  assert.deepEqual([closed.status, closed.is_open], ['finished', false], 'the chat ending ends it');
  assert.match(closed.body, /finished: All done$/, 'what the session said stands as its last word');

  // Ended for it after going quiet, the same chat comes back under its own name.
  await sessionsPack.sessionPrompted(ownContext(l, 'sessions'), 'chat', HOOK_ACTOR as sessionsPack.Actor);
  const back = (await l.entity(run))!;
  assert.deepEqual([back.status, back.is_open, back.props.name], ['running', true, name]);
});

test('a session opens a tab once, on what it works on, and what it takes on is shown there', async () => {
  const l = await fresh();
  const made = await make(l, [{ op: 'create', ref: 'task', type: 'task', title: 'Some work' }]);
  const shows = async () => (await presencePack.presence(kernelContext(l, 'presence'), l)).steps.filter((s) => s.kind === 'show');
  const { run } = (await callTool(l, agent, 'session_start', { session_id: 'tabbed', surface: 'claude-code', task: made.task })) as any;
  assert.deepEqual((await shows()).map((s) => [s.hash, s.opens, s.run]), [[`e/${made.task}`, true, run]]);
  await callTool(l, agent, 'session_start', { session_id: 'tabbed', surface: 'claude-code' });
  assert.equal((await shows()).length, 1, 'taken up again, it has its tab');
  await callTool(l, agent, 'session_update', { run, note: 'A word' });
  assert.equal((await shows()).length, 1, 'a word moves nothing');
  await callTool(l, agent, 'session_update', { run, task: made.task });
  assert.deepEqual((await shows()).at(-1)!.hash, `e/${made.task}`);
  assert.equal((await shows()).at(-1)!.opens, undefined);
});

test('a run with no chat is ended by its agent, and a person ends a chat’s run from its page', async () => {
  const l = await fresh();
  const { run } = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ title: 'No chat' }));
  await callTool(l, agent, 'session_end', { run, summary: 'Done' });
  assert.equal((await l.entity(run))!.is_open, false);
  await sessionsPack.sessionPrompted(ownContext(l, 'sessions'), undefined, HOOK_ACTOR as sessionsPack.Actor);

  const headless = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ session_id: 'head', surface: 'claude-headless' }));
  await callTool(l, agent, 'session_end', { run: headless.run, summary: 'Done' });
  assert.equal((await l.entity(headless.run))!.is_open, false, 'a launched run is not a chat');
  await sessionsPack.sessionPrompted(ownContext(l, 'sessions'), 'head', HOOK_ACTOR as sessionsPack.Actor);
  assert.equal((await l.entity(headless.run))!.is_open, false);

  const chat = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ session_id: 'mine', surface: 'claude-code' }));
  await callTool(l, human, 'session_end', { run: chat.run, summary: 'Stopped from the page' });
  assert.equal((await l.entity(chat.run))!.is_open, false);
});

test('a project’s open questions are what needs the owner in it', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'work', title: 'Shadows', status: 'doing' },
    { op: 'create', ref: 'q', type: 'decision', title: 'Which licence?', status: 'open', props: { options: ['MIT', 'Apache'] } },
    { op: 'link', type: 'part_of', from: 'q', to: 'p' },
    { op: 'create', ref: 'a', type: 'task', title: 'Write the installer', status: 'todo' },
    { op: 'create', ref: 'b', type: 'task', title: 'Sign the package', status: 'done' },
    { op: 'link', type: 'part_of', from: 'a', to: 'p' },
    { op: 'link', type: 'part_of', from: 'b', to: 'p' },
    { op: 'link', type: 'depends_on', from: 'a', to: 'q' },
    { op: 'create', ref: 'quiet', type: 'work', title: 'Quiet one', status: 'doing' },
  ]);
  const asked = await attend(l, { reasons: ['unsettled'], within: made.p });
  assert.deepEqual(asked.items.map((q: any) => [q.title, q.reasons[0].by, q.top.title]), [['Which licence?', 'word', 'Shadows']]);
  assert.deepEqual((await attend(l, { reasons: ['unsettled'], within: made.quiet })).items, []);
});

test('a session tells the story of its work, beat by beat, and can take a beat back', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'a', type: 'task', title: 'Fix the halo' },
    { op: 'create', ref: 'b', type: 'task', title: 'Labels clip' },
    { op: 'link', type: 'depends_on', from: 'a', to: 'b' },
    { op: 'create', ref: 'c', type: 'task', title: 'Unrelated' },
  ]);
  const { run } = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ title: 'Storyteller', session_id: 's-story' }));
  const one = await sessionsPack.tell(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ run: 's-story', said: 'The halo is blocked by the clipping: fix that first.', links: [{ from: made.b, to: made.a, says: 'is why' }] }));
  assert.deepEqual([one.run, one.beat, one.standing], [run, 1, 1]);
  await sessionsPack.tell(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ run, said: 'The unrelated task matters after all.', about: [made.c] }));
  const three = await sessionsPack.tell(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ run, said: 'No: it does not.', replaces: 2 }));
  assert.equal(three.standing, 2);
  assert.equal((await proposals(l)).length, 0, 'a story needs no approval');
  assert.equal(((await readEvents(l.db, { target: run })) as any[]).length, 1, 'and logs no event: only the session starting');

  const told = (await VIEWS.story.run(kernelContext(l, 'query'), { run })) as any;
  assert.deepEqual(told.beats.map((b: any) => [b.n, b.replaced_by ?? null]), [[1, null], [2, 3], [3, null]]);
  // The page opens on the finding: the latest that stands, else the latest beat.
  assert.equal(told.finding, 3);
  await assert.rejects(sessionsPack.tell(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ run, said: 'Found nothing about anything', finding: true })), /names the items/);
  const found = await sessionsPack.tell(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ run, said: `The halo waits on ${made.b} only; fix that and ${made.a} can go.`, about: [made.a, made.b], finding: true }));
  await sessionsPack.tell(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ run, said: 'A later note on the side.', about: [made.c] }));
  assert.equal(((await VIEWS.story.run(kernelContext(l, 'query'), { run })) as any).finding, found.beat, 'a later beat is history under the finding');
  // Its picture is a flat lens of what the finding is about (ui/query.js, storyPart).
  const alone = (await ask(l, 'flat', { filter: { find: [`id ${made.a}`, `id ${made.b}`], not: [] } })) as any;
  assert.deepEqual(alone.items.map((i: any) => i.title).sort(), ['Fix the halo', 'Labels clip']);

  await assert.rejects(sessionsPack.tell(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ run, said: 'x'.repeat(281) })), /280 characters/);
  await assert.rejects(sessionsPack.tell(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ run, said: 'About nothing real', about: ['e_nothere1'] })), /No item "e_nothere1"/);
  await assert.rejects(sessionsPack.tell(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ run, said: 'Again', replaces: 2 })), /already taken back/);
  await sessionsPack.sessionEnd(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ run }));
  await assert.rejects(sessionsPack.tell(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ run, said: 'Too late' })), /already ended/);
  assert.equal(((await VIEWS.story.run(kernelContext(l, 'query'), { run })) as any).beats.length, 5, 'the story is still read after the session ends');
});

test('a session that goes quiet is shown as stale', async () => {
  const l = await fresh();
  const { run } = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ title: 'Quiet one' }));
  await l.db.query(`update entity set props = props || '{"last_seen":"2020-01-01T00:00:00Z"}' where id = $1`, [run]);
  assert.equal(((await VIEWS.sessions.run(kernelContext(l, 'query'), {})) as any).open[0].stale, true);
  await sessionsPack.sessionUpdate(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ run }));
  assert.equal(((await VIEWS.sessions.run(kernelContext(l, 'query'), {})) as any).open[0].stale, false, 'a heartbeat clears it');
  assert.equal(((await readEvents(l.db, { target: run })) as any[]).length, 1, 'and leaves no event');
});

test('a brief gathers a task\'s context, blockers, needs and rules', async () => {
  const l = await laneMap();
  const made = await laneSetup(l);
  const holder = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ title: 'Other session' }));
  await l.claim(agent, { resource: made.lane, holder: holder.run, reason: 'busy' });

  const brief = (await ask(l, 'brief', { task: made.live })) as any;
  assert.equal(brief.repo.path, 'C:\\code\\Apex');
  assert.deepEqual(brief.needs.map((n: any) => [n.title, n.held_by]), [['Live lane', 'Other session']]);
  assert.deepEqual(brief.ties.map((r: any) => [r.relation, r.title]), [['about', 'One live lane.']]);
  for (const part of ['# Capture probe', 'Part of: Apex', 'held by Other session', 'Only one session drives the CAD app.']) {
    assert.ok(brief.text.includes(part), `expected "${part}" in:\n${brief.text}`);
  }
  const gated = (await ask(l, 'brief', { task: made.gated })) as any;
  assert.deepEqual(gated.root_blockers.map((b: any) => b.title), ['Which target?']);
});

test('the session-start hook registers the session and names its repository and the lane state', async () => {
  const l = await laneMap();
  const made = await laneSetup(l);
  const text = await sessionHookPack.hookSessionStart(ownContext(l, 'sessions'), ({ session_id: 'abc', cwd: 'C:\\code\\Apex' }));
  assert.match(text, /registered in Archipelago/);
  assert.ok(text.includes(`Name an item to a person as [its name](http://127.0.0.1:3100/i/${l.workspace}/{id}), never a bare id`), 'it is told how to link to an item');
  const repoId = /Repository: Apex repo \((e_\w+)\)/.exec(text)?.[1];
  assert.ok(repoId, 'the repository comes with its id');
  assert.match(await sessionHookPack.hookSessionStart(ownContext(l, 'sessions'), ({ session_id: 'abc', cwd: 'C:\\code\\Apex' })), new RegExp(`Repository: Apex repo \\(${repoId}\\)`), 'a session that is resumed is told its repository again');
  assert.match(text, /"Live lane" .* is free/);

  const other = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ title: 'Lane holder' }));
  await l.claim(agent, { resource: made.lane, holder: other.run, reason: 'busy' });
  assert.match(await sessionHookPack.hookSessionStart(ownContext(l, 'sessions'), ({ session_id: 'def', cwd: 'C:\\elsewhere' })), /does not know a (?:repository|checkout).*HELD by Lane holder: do not use it/s);

  // On another machine the folder is somewhere else: the repository is known by the address it was cloned from, however that is written.
  await make(l, [{ op: 'update', id: repoId!, props: { remote: 'https://github.com/Acme/Apex' } }]);
  const far = await sessionHookPack.hookSessionStart(ownContext(l, 'sessions'), ({ session_id: 'far', cwd: '/home/someone/work/apex', remote: 'git@github.com:acme/apex.git' }));
  assert.match(far, new RegExp(`Repository: Apex repo \\(${repoId}\\)`));
  assert.equal(((await VIEWS.sessions.run(kernelContext(l, 'query'), {})) as any).open.find((r: any) => r.cwd === '/home/someone/work/apex').repo.id, repoId);
  assert.match(await sessionHookPack.hookSessionStart(ownContext(l, 'sessions'), ({ session_id: 'stranger', cwd: '/tmp/x', remote: 'https://github.com/acme/other' })), /does not know a (?:repository|checkout) for this folder \(a checkout of https:\/\/github\.com\/acme\/other\)/);
  for (const id of ['far', 'stranger']) await sessionHookPack.hookSessionEnd(ownContext(l, 'sessions'), ({ session_id: id }));

  await sessionHookPack.hookSessionEnd(ownContext(l, 'sessions'), ({ session_id: 'abc', reason: 'logout' }));
  const open = ((await VIEWS.sessions.run(kernelContext(l, 'query'), {})) as any).open.map((r: any) => r.id);
  assert.ok(!open.includes((await sessionsPack.resolveRun(ownContext(l, 'sessions'), 'abc', false))!.id));
  await sessionHookPack.hookSessionEnd(ownContext(l, 'sessions'), ({ session_id: 'never-seen' }));
});

test('a session that finishes says where the repository\'s open work stands', async () => {
  const l = await laneMap();
  const made = await laneSetup(l);
  const { run } = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ cwd: 'C:\\code\\Apex', session_id: 'r1' }));

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
  const vouch = (await proposals(l)).at(-1)!;
  assert.deepEqual(vouch.ops, [{ op: 'update', id: made.live }, { op: 'update', id: made.gated }]);
  assert.match(vouch.reason, /still true as written/);
  await l.decide({ kind: 'human', name: 'owner' }, { proposal: vouch.id, approve: true });
  const said = ((await readEvents(l.db, { target: made.live })) as any[])[0];
  assert.deepEqual([said.action, said.detail.changes], ['entity.update', {}]);

  // What nobody has changed or confirmed for longest comes first, with its age; the session is told of it at the start.
  await l.db.query(`update entity set updated_at = now() - interval '40 days' where id = $1`, [made.gated]);
  await l.db.query(`update entity set updated_at = now() - interval '20 days' where id = $1`, [made.live]);
  const old = await attend(l, { reasons: ['stale'], within: made.tree });
  assert.deepEqual(old.items.map((i: any) => [i.title, i.reasons[0].days]).sort(), [['Capture probe', 20], ['Tune the solver', 40]]);
  assert.equal((await attend(l, { reasons: ['stale'], stale_days: 30, within: made.tree })).items.length, 1, 'only those older than asked for');
  // Saying it is still true takes it off the list.
  await make(l, [{ op: 'update', id: made.gated }]);
  assert.deepEqual((await attend(l, { reasons: ['stale'], within: made.tree })).items.map((i: any) => i.title), ['Capture probe']);

  // New open work in the repository is asked about at the end.
  const { leak } = await make(l, [
    { op: 'create', ref: 'leak', type: 'task', title: 'The probe leaks handles' },
    { op: 'link', type: 'part_of', from: 'leak', to: made.proj },
  ]);
  await sessionHookPack.hookSessionStart(ownContext(l, 'sessions'), ({ session_id: 'r5', cwd: 'C:\\code\\Apex' }));
  assert.ok(((await callTool(l, agent, 'session_end', { run: 'r5' })) as any).unreconciled.some((i: any) => i.id === leak));
  await callTool(l, { kind: 'human', name: 'owner' }, 'session_end', { run: 'r5', outcome: 'cancelled' });
  await make(l, [{ op: 'archive', id: leak }]);

  // A session closed over its head (the hook, a crash) is recorded as not having said.
  await sessionHookPack.hookSessionStart(ownContext(l, 'sessions'), ({ session_id: 'r2', cwd: 'C:\\code\\Apex' }));
  await sessionHookPack.hookSessionEnd(ownContext(l, 'sessions'), ({ session_id: 'r2', reason: 'exit' }));
  const { rows } = await l.db.query<{ body: string }>(`select body from entity where props->>'session_id' = 'r2'`);
  assert.match(rows[0].body, /Session ended \(exit\)\nNot reconciled, open and left unsaid: .*Capture probe/);

  // The human ending one from the UI is not asked, and neither is a session that failed.
  const third = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ cwd: 'C:\\code\\Apex' }));
  assert.equal(((await callTool(l, { kind: 'human', name: 'owner' }, 'session_end', { run: third.run, outcome: 'cancelled' })) as any).status, 'cancelled');
  const fourth = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ cwd: 'C:\\code\\Apex' }));
  assert.equal(((await callTool(l, agent, 'session_end', { run: fourth.run, outcome: 'failed' })) as any).status, 'failed');
});

test('work that waits on a person is blocked by them, needs them, and is not asked of a session; a session can say it cannot tell', async () => {
  const l = await laneMap();
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
  const offline = (await attend(l, { within: made.tree })).items.find((b: any) => b.id === made.offline);
  assert.deepEqual(offline.reasons.map((r: any) => [r.why, r.who ?? r.by]), [['waits_on', 'Owner'], ['blocked', ['Owner']]]);
  assert.deepEqual((await attend(l, { person: 'me', reasons: ['waits_on'] })).items.map((e: any) => e.title), ['Write unit tests']);
  assert.deepEqual((await attend(l, { person: sam, reasons: ['blocked'] })).items.map((r: any) => r.reasons[0].by), [['Owner']]);
  assert.ok(!(await attend(l, { reasons: ['ready'], within: made.tree })).items.some((t: any) => t.id === made.offline), 'what waits on a person is not ready');

  // A session ending there is not asked about it: nothing it did could have settled it.
  const { run } = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ cwd: 'C:\\code\\Apex', session_id: 'w1' }));
  const asked = (await callTool(l, agent, 'session_end', { run })) as any;
  assert.deepEqual(asked.unreconciled.map((i: any) => i.title).sort(), ['Capture probe', 'Tune the solver']);
  // What it never looked at it says it cannot tell: that ends it, and the item is left as it was, not marked as checked.
  const before = (await l.entity(made.gated))!.updated_at;
  const ended = (await callTool(l, agent, 'session_end', { run, summary: 'Probe looked at', still_true: [made.live], cannot_tell: [made.gated] })) as any;
  assert.equal(ended.status, 'finished');
  assert.match((await l.entity(run))!.body, /Said still true: Capture probe .*\nCould not tell from here, left as found: Tune the solver/);
  assert.deepEqual((await proposals(l)).at(-1)!.ops, [{ op: 'update', id: made.live }], 'only what was vouched for is said to be checked');
  assert.deepEqual((await l.entity(made.gated))!.updated_at, before);

  // The next session is not asked about what has a change waiting for the owner (the vouching above is one, held),
  // and answers for all it never looked at in one word.
  const next = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ cwd: 'C:\\code\\Apex', session_id: 'w2' }));
  const again = (await callTool(l, agent, 'session_end', { run: next.run })) as any;
  assert.deepEqual(again.unreconciled.map((i: any) => i.title), ['Tune the solver']);
  assert.equal(((await callTool(l, agent, 'session_end', { run: next.run, cannot_tell_rest: true })) as any).status, 'finished');
  assert.match((await l.entity(next.run))!.body, /Could not tell from here, left as found: 1 item it did not look at\./);

  // Once they have answered, the link is removed and the work is free again.
  const link = (await getItem(l, made.offline)).outgoing.find((r: any) => r.type === 'waits_on') as any;
  await make(l, [{ op: 'unlink', relation: link.relation }]);
  assert.ok((await attend(l, { reasons: ['ready'], within: made.tree })).items.some((t: any) => t.id === made.offline));
});


test('a session is called what its chat is called, kept live as it is renamed, never by its word', async () => {
  const { sessionTitle } = await import('../packs/sessions/kernel/session-name.ts');
  const sessionNamePack = await import('../packs/sessions/kernel/session-name.ts');
  assert.equal(sessionTitle({ task: 'Tune the solver' }), 'Tune the solver');
  assert.equal(sessionTitle({ place: 'Apex repo' }), 'Session in Apex repo');
  const l = await fresh();
  const started = await sessionsPack.sessionStart(ownContext(l, 'sessions'), ({ kind: 'agent', name: 'claude-code' }) as sessionsPack.Actor, ({ session_id: 'titled', title: 'Session tabs' }));
  let run = (await l.entity(started.run))!;
  assert.deepEqual([run.title, run.props.label], ['Session tabs', 'Session tabs'], 'named by its chat from the start');
  assert.ok(run.props.name && !run.title.includes(String(run.props.name)), 'its word is its hue, not its name');
  await sessionNamePack.sessionLabelled(kernelContext(l, 'sessions'), run, '  Agent   popup  ', 'agent:claude-code');
  run = (await l.entity(started.run))!;
  assert.deepEqual([run.title, run.props.label], ['Agent popup', 'Agent popup'], 'a rename is its title');
  await callTool(l, agent, 'session_update', { run: run.id, title: 'x'.repeat(80) });
  run = (await l.entity(started.run))!;
  assert.equal(run.title.length, 60, 'cut to a name');
  const before = (await l.db.query<{ n: number }>('select count(*)::int as n from log_entry')).rows[0].n;
  await sessionNamePack.sessionLabelled(kernelContext(l, 'sessions'), run, ('x'.repeat(80)), 'agent:claude-code');
  await sessionNamePack.sessionLabelled(kernelContext(l, 'sessions'), run, 42, 'agent:claude-code');
  assert.equal((await l.db.query<{ n: number }>('select count(*)::int as n from log_entry')).rows[0].n, before, 'the same title again writes nothing');
  // With no title, what it works on.
  const untitled = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ session_id: 'untitled', cwd: '/nowhere' }));
  assert.equal((await l.entity(untitled.run))!.title, 'Session in /nowhere');
});

test('a chat that ends ends its session, and after a clear the next one in its folder takes over its tab', async () => {
  const l = await fresh();
  const one = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ session_id: 'c1', cwd: '/w', surface: 'codex', title: 'Fix it' }));
  // Its agent saying it is done leaves a chat's session open; the chat ending, said with a reason, closes it.
  await callTool(l, agent, 'session_end', { run: one.run, cannot_tell_rest: true });
  assert.equal((await l.entity(one.run))!.is_open, true, 'the chat goes on');
  await callTool(l, agent, 'session_end', { run: one.run, reason: 'clear', cannot_tell_rest: true });
  const ended = (await l.entity(one.run))!;
  assert.deepEqual([ended.is_open, ended.props.ended_by], [false, 'clear']);
  const next = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ session_id: 'c2', cwd: '/w', surface: 'codex', source: 'clear' }));
  const run = (await l.entity(next.run))!;
  assert.deepEqual([next.took_over, run.props.took_over, run.title], [one.run, one.run, 'Fix it'], "it goes on under the chat's title");
  assert.equal((await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ session_id: 'c3', cwd: '/w', source: 'clear' }))).took_over, undefined, 'taken over once');
});

test('a session that says it is done or succeeded has finished', async () => {
  const l = await fresh();
  for (const [n, outcome] of ['done', 'success'].entries()) {
    const { run } = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ session_id: `said-${n}` }));
    assert.equal(((await callTool(l, agent, 'session_end', { run, outcome })) as any).status, 'finished');
  }
});

test('a session announced again after it ended takes up its own run, with no second one beside it', async () => {
  const l = await fresh();
  const { run, name } = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ session_id: 'back' }));
  await sessionsPack.sessionEnd(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ run: run!, outcome: 'finished' }));
  const again = await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, ({ session_id: 'back' }));
  assert.deepEqual([again.run, again.name, again.status, again.resumed], [run, name, 'running', true]);
  assert.equal((await l.entity(run!))?.is_open, true);
});

test('a held change says what it would make', async () => {
  const l = await fresh();
  const held = (await callTool(l, agent, 'change', { reason: 'test', hold: true, ops: [{ op: 'create', ref: 'it', type: 'task', title: 'Held' }] })) as any;
  assert.equal(held.status, 'proposed');
  assert.match(held.would_make.it, /^e_/);
  assert.ok(!(await l.entity(held.would_make.it)), 'and it does not exist yet');
});

test('a list tells an agent of a long field and a hub\'s links without reading them whole', async () => {
  const l = await fresh();
  const ops = [{ op: 'create', ref: 'hub', type: 'work', title: 'Hub' }, { op: 'create', ref: 'look', type: 'layout', title: 'Long look', props: { code: 'x'.repeat(3000) } }, ...Array.from({ length: 25 }, (_, k) => ({ op: 'create', ref: `t${k}`, type: 'task', title: `Task ${k}` })), ...Array.from({ length: 25 }, (_, k) => ({ op: 'link', type: 'part_of', from: `t${k}`, to: 'hub' }))];
  const { created } = (await callTool(l, human, 'change', { reason: 'test', ops })) as any;
  const [found] = (await callTool(l, agent, 'search', { q: 'Long look', type: 'layout' })) as any[];
  assert.match(String(found.props.code), /3000 characters/);
  assert.equal(((await callTool(l, agent, 'search', { q: 'Long look', type: 'layout', full: true })) as any[])[0].props.code.length, 3000);
  const got = (await callTool(l, agent, 'get', { id: created.hub })) as any;
  assert.equal(got.incoming.length, 20);
  assert.equal(got.links_cut.incoming.by_type.part_of, 25);
  assert.equal(((await callTool(l, agent, 'get', { id: created.hub, full: true })) as any).incoming.length, 25);
});

test("Claude Code's hooks name a session by its chat, end it with the reason, and a clear goes on in the same tab", async () => {
  const l = await fresh();
  await sessionHookPack.hookSessionStart(ownContext(l, 'sessions'), ({ session_id: 'cc1', cwd: '/x', title: 'Hooked chat', source: 'startup' }));
  const run = (await sessionsPack.resolveRun(ownContext(l, 'sessions'), 'cc1', false))!;
  assert.equal(run.title, 'Hooked chat');
  await sessionHookPack.hookSessionEnd(ownContext(l, 'sessions'), ({ session_id: 'cc1', reason: 'clear' }));
  assert.deepEqual([(await l.entity(run.id))!.is_open, (await l.entity(run.id))!.props.ended_by], [false, 'clear']);
  await sessionHookPack.hookSessionStart(ownContext(l, 'sessions'), ({ session_id: 'cc2', cwd: '/x', source: 'clear' }));
  const next = (await sessionsPack.resolveRun(ownContext(l, 'sessions'), 'cc2', false))!;
  assert.deepEqual([next.props.took_over, next.title], [run.id, 'Hooked chat']);
  // A resume of an ended chat takes up its own run again.
  await sessionHookPack.hookSessionEnd(ownContext(l, 'sessions'), ({ session_id: 'cc2', reason: 'prompt_input_exit' }));
  await sessionHookPack.hookSessionStart(ownContext(l, 'sessions'), ({ session_id: 'cc2', cwd: '/x', source: 'resume', title: 'Renamed while away' }));
  const back = (await l.entity(next.id))!;
  assert.deepEqual([back.is_open, back.title], [true, 'Renamed while away']);
});
