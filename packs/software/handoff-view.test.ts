// The software pack's repository views: the handoff read off the map, the re-check, what nobody has seen working and
// what a session left unpushed. Through the tools (#pelago/test), so it runs wherever the pack lives.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { agent, call, human, make, mapWith, type Archipelago } from '#pelago/test';

const fresh = () => mapWith(join(import.meta.dirname, '..'));
const view = (l: Archipelago, name: string, params: Record<string, unknown> = {}) => call(l, human, 'view', { name, params });
/** A session starting in the checkout, as Claude Code's hook starts it: its run. */
const starter = (l: Archipelago) => async (session_id: string) => (await call<{ run: string }>(l, agent, 'capture', { action: 'session_start', params: { session_id, cwd: String.raw`C:\code\Apex` } })).run;
/** A session ending, as the chat does. */
const ender = (l: Archipelago) => (run: string, reason: string) => call(l, agent, 'report', { action: 'session_end', params: { run, outcome: 'finished', summary: `Session ended (${reason})`, reason, cannot_tell_rest: true } });

/** A project in a repo, with one task that needs the live lane and one that does not. */
async function laneSetup(l: Archipelago) {
  return make(l, [
    { op: 'create', ref: 'repo', type: 'repo', title: 'Apex repo', props: { path: 'C:\\code\\Apex' } },
    { op: 'create', ref: 'proj', type: 'project', title: 'Apex' },
    { op: 'create', ref: 'lane', type: 'place', props: { exclusive: true }, title: 'Live lane' },
    { op: 'create', ref: 'rule', type: 'decision', title: 'One live lane.', status: 'decided', props: { outcome: 'Only one session drives the CAD app.' } },
    { op: 'create', ref: 'live', type: 'task', title: 'Capture probe' },
    { op: 'create', ref: 'offline', type: 'task', title: 'Write unit tests' },
    { op: 'create', ref: 'q', type: 'decision', title: 'Which target?' },
    { op: 'create', ref: 'gated', type: 'task', title: 'Tune the solver' },
    { op: 'link', type: 'lives_in', from: 'proj', to: 'repo' },
    { op: 'link', type: 'part_of', from: 'live', to: 'proj' },
    { op: 'link', type: 'part_of', from: 'offline', to: 'proj' },
    { op: 'link', type: 'part_of', from: 'gated', to: 'proj' },
    { op: 'link', type: 'depends_on', from: 'gated', to: 'q' },
    { op: 'link', type: 'needs', from: 'live', to: 'lane' },
    { op: 'link', type: 'about', from: 'lane', to: 'rule' },
  ]);
}

test('a handoff is read off the map, and nobody writes it down: the open work and what has happened lately', async () => {
  const l = await fresh();
  const [start, end] = [starter(l), ender(l)];
  const made = await laneSetup(l);
  const bare = (await call(l, human, 'view', { name: 'handoff', params: { repo: made.repo } })) as any;
  assert.equal('note' in bare, false, 'there is no note to read or write');
  assert.match(bare.how, /^Everything here is read off the map as it is now, and nothing is written down for the next session\./);
  assert.deepEqual(bare.open.ready.map((i: any) => i.title).sort(), ['Capture probe', 'Write unit tests']);
  assert.deepEqual(bare.open.blocked.map((i: any) => [i.title, i.waiting_on]), [['Tune the solver', ['Which target?']]]);
  const h0 = await start('h0');

  // Everything from here on happened after this moment.
  const mark = new Date(Date.now() - 1000).toISOString();
  await l.db.query(`update entity set created_at = now() - interval '2 hours' where id = any($1::text[])`, [[made.live, made.offline, made.gated]]);
  await l.log(l.db, { actor: 'github:someone', action: 'repo.push', target: made.repo, origin: 'github', reason: '1 commit to main: Tests for the solver', detail: { branch: 'main', after: 'abcdef0123456789' } });
  await make(l, [
    { op: 'update', id: made.offline, status: 'done' },
    { op: 'create', ref: 'new', type: 'issue', title: 'The solver diverges on thin walls' },
    { op: 'link', type: 'about', from: 'new', to: made.proj },
  ]);
  await end(h0, 'exit');
  // A note kept as a handoff before there were none is not read.
  await make(l, [{ op: 'create', ref: 'old', type: 'note', title: 'Apex handoff', body: 'Next\nRun the probe.' }, { op: 'link', type: 'lives_in', from: 'old', to: made.repo }]);

  const stand = (await call(l, human, 'view', { name: 'handoff', params: { repo: 'apex repo', since: mark } })) as any;
  assert.equal('note' in stand, false);
  // An agent is given a view without what it does not read: no empty fields on a row, and what blocks at the root by name.
  const forPerson = (await call(l, human, 'view', { name: 'repo_work', params: { repo: made.repo } })) as any;
  const forAgent = (await call(l, agent, 'view', { name: 'repo_work', params: { repo: made.repo } })) as any;
  assert.deepEqual([forPerson.ready[0].due, 'due' in forAgent.ready[0], forAgent.ready[0].id], [null, false, forPerson.ready[0].id]);
  assert.equal(((await call(l, agent, 'view', { name: 'repo_work', params: { repo: made.repo, full: true } })) as any).ready[0].due, null, 'whole when asked');
  const blocked = (await call(l, agent, 'view', { name: 'attention', params: { reasons: ['blocked'], within: made.repo } })) as any;
  assert.deepEqual([blocked.items[0].reasons[0].why, 'due' in blocked.items[0], 'owner' in blocked.items[0]], ['blocked', false, false], 'an agent is given no empty fields');
  const told = (await call(l, agent, 'view', { name: 'handoff', params: { repo: made.repo } })) as any;
  assert.deepEqual([told.open.ready.length, 'ready_count' in told.open], [stand.open.ready.length, false], 'a short list is given whole');
  assert.deepEqual(stand.last_push.head, 'abcdef0');
  assert.deepEqual(stand.since_then.pushes.map((p: any) => [p.branch, p.head, p.subject]), [['main', 'abcdef0', '1 commit to main: Tests for the solver']]);
  assert.deepEqual(stand.since_then.settled.map((i: any) => [i.title, i.status]), [['Write unit tests', 'done']]);
  assert.deepEqual(stand.since_then.opened.map((i: any) => i.title), ['The solver diverges on thin walls']);
  assert.deepEqual(stand.since_then.sessions.map((s: any) => [s.status, /^finished: Session ended \(exit\)/.test(s.said) || /Not reconciled/.test(s.said)]), [['finished', true]]);
  assert.ok(!stand.open.ready.some((i: any) => i.title === 'Write unit tests'), 'what is open is as the map has it now');
  // The next session is told how much has moved since the last session here to end began, and what is left, unseen or bites here.
  await make(l, [{ op: 'update', id: made.offline, props: { seen_working: false } }]);
  assert.equal(((await call(l, human, 'view', { name: 'handoff', params: { repo: made.repo, since: new Date(Date.now() + 60_000).toISOString() } })) as any).since_then.settled.length, 0, 'counted from another moment when asked');

});

test('a re-check takes a feature that lives in a repository on its own, at its project\'s interval, and leaves out what waits on a person', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'home', type: 'repo', title: 'Main repo', props: { path: 'C:\\code\\main' } },
    { op: 'create', ref: 'side', type: 'repo', title: 'Add-in repo', props: { path: 'C:\\code\\addin' } },
    { op: 'create', ref: 'proj', type: 'project', title: 'Product', props: { recheck_days: 3 } },
    { op: 'create', ref: 'inside', type: 'feature', title: 'Core' },
    { op: 'create', ref: 'addin', type: 'feature', title: 'The add-in' },
    { op: 'create', ref: 'old', type: 'task', title: 'Port the ribbon' },
    { op: 'create', ref: 'chore', type: 'task', title: 'Ask for the certificate' },
    { op: 'create', ref: 'me', type: 'person', title: 'Owner' },
    { op: 'link', type: 'lives_in', from: 'proj', to: 'home' },
    { op: 'link', type: 'lives_in', from: 'inside', to: 'home' },
    { op: 'link', type: 'lives_in', from: 'addin', to: 'side' },
    { op: 'link', type: 'part_of', from: 'inside', to: 'proj' },
    { op: 'link', type: 'part_of', from: 'addin', to: 'proj' },
    { op: 'link', type: 'part_of', from: 'old', to: 'addin' },
    { op: 'link', type: 'part_of', from: 'chore', to: 'addin' },
  ]);
  await l.db.query(`update entity set updated_at = now() - interval '5 days' where id = any($1::text[])`, [[made.old, made.chore]]);
  // In the repository where only the feature lives, it is what is re-checked, as often as its project says.
  let due = (await call(l, human, 'view', { name: 'recheck', params: { repo: made.side } })) as any;
  assert.deepEqual(due.projects.map((p: any) => [p.title, p.every_days, p.items.map((i: any) => i.title).sort()]), [['The add-in', 3, ['Ask for the certificate', 'Port the ribbon']]]);
  // Where its project lives too, a feature is that project's and is not listed beside it.
  assert.deepEqual(((await call(l, human, 'view', { name: 'recheck', params: { repo: made.home } })) as any).projects.map((p: any) => p.title), ['Product']);
  // What the code cannot tell is said to wait on someone, and is not asked of a re-check again.
  await make(l, [{ op: 'link', type: 'waits_on', from: made.chore, to: made.me, props: { for: 'the certificate' } }]);
  due = (await call(l, human, 'view', { name: 'recheck', params: { repo: made.side } })) as any;
  assert.deepEqual(due.projects[0].items.map((i: any) => i.title), ['Port the ribbon']);
  assert.deepEqual(((await call(l, agent, 'rechecked', { repo: made.side })) as any).rechecked.map((p: any) => p.title), ['The add-in']);
  assert.equal(((await call(l, human, 'view', { name: 'recheck', params: { repo: made.side } })) as any).due, false);
});

test('what nobody has seen working is said on the item and listed in the handoff; a trap is said for the file it names', async () => {
  const l = await fresh();
  const made = await laneSetup(l);
  await make(l, [{ op: 'update', id: made.offline, status: 'done', props: { seen_working: false, to_see: 'a run on a real model' } }]);
  const unseen = ((await view(l, 'handoff', { repo: made.repo })) as any).unseen;
  assert.deepEqual(unseen.map((i: any) => [i.id, i.status, i.to_see]), [[made.offline, 'done', 'a run on a real model']]);
  await make(l, [{ op: 'update', id: made.offline, props: { seen_working: true } }]);
  assert.equal(((await view(l, 'handoff', { repo: made.repo })) as any).unseen, undefined, 'seen, it leaves the list');
  const { trap } = await make(l, [
    { op: 'create', ref: 'trap', type: 'instruction', title: 'The pane cannot load draw.html', body: 'Drawings stay on Loading… in the browser pane: start with PELAGO_UNSANDBOXED=1.', props: { for: ['file:ui/draw.*'] } },
    { op: 'link', type: 'about', from: 'trap', to: made.repo },
  ]);
  const said = async (path: string) => ((await view(l, 'instructions', { for: `file:${path}`, about: made.repo })) as any).said.map((s: any) => s.id);
  assert.deepEqual(await said(String.raw`C:\code\Apex\ui\draw.html`), [trap]);
  assert.deepEqual(await said('ui/canvas.js'), []);
  // A brief for work in the repository names every trap there, by the files it names, before any file is opened.
  const brief = (await view(l, 'brief', { task: made.offline })) as any;
  assert.deepEqual(brief.traps, [{ id: trap, title: 'The pane cannot load draw.html', files: ['ui/draw.*'] }]);
  assert.match(brief.text, /## Where it bites\n- ui\/draw\.\*: The pane cannot load draw\.html\. Drawings stay/);
  // A task that names its files is told the way round only for the traps in them: the rest by name, said whole when opened.
  const { other } = await make(l, [{ op: 'create', ref: 'other', type: 'task', title: 'Tidy the plan', body: '## Files\n- src/plan.ts' }, { op: 'link', type: 'part_of', from: 'other', to: made.repo }]);
  const elsewhere = (await view(l, 'brief', { task: other })) as any;
  assert.match(elsewhere.text, /## Where it bites\n- ui\/draw\.\*: The pane cannot load draw\.html\.\n/);
  assert.doesNotMatch(elsewhere.text, /Drawings stay/);
  await make(l, [{ op: 'update', id: other, body: 'Fix the frame in ui/draw.html.' }]);
  assert.match(((await view(l, 'brief', { task: other })) as any).text, /draw\.html\. Drawings stay/, 'its own file, whole');
  // A task part of the repository itself, with nothing between, has it as its repository too.
  const { direct } = await make(l, [{ op: 'create', ref: 'direct', type: 'task', title: 'Tidy the probe' }, { op: 'link', type: 'part_of', from: 'direct', to: made.repo }]);
  const near = (await view(l, 'brief', { task: direct })) as any;
  assert.deepEqual([near.repo?.id, near.traps?.length], [made.repo, 1]);
  assert.match(near.text, /^Repository: Apex repo \(/m);
});

test('where a session left its checkout is kept on its run at each turn and at its end, and the handoff says what is on no remote', async () => {
  const l = await fresh();
  const [start, end] = [starter(l), ender(l)];
  const made = await laneSetup(l);
  const g1 = await start('g1');
  const git = { branch: 'claude/probe', head: 'b'.repeat(40), worktree: 'C:/code/Apex', unpushed: 2, dirty: 1 };
  // Where the checkout stands is kept on the run (the kernel's hook does it at each turn; here, as a change).
  await make(l, [{ op: 'update', id: g1, props: { git } }]);
  const run = { id: g1 };
  assert.equal(((await view(l, 'handoff', { repo: made.repo })) as any).left, undefined, 'a session still at work has left nothing');
  await make(l, [{ op: 'update', id: g1, props: { git: { ...git, unpushed: 3 } } }]);
  await end(g1, 'exit');
  const left = ((await view(l, 'handoff', { repo: made.repo })) as any).left;
  assert.deepEqual(left.map((x: any) => [x.id, x.branch, x.unpushed, x.dirty]), [[run.id, 'claude/probe', 3, 1]], 'its last word, said as it ended');
  await l.log(l.db, { actor: 'github:someone', action: 'repo.push', target: made.repo, origin: 'github', reason: '3 commits to claude/probe', detail: { branch: 'claude/probe', after: 'b'.repeat(40) } });
  assert.equal(((await view(l, 'handoff', { repo: made.repo })) as any).left, undefined, 'pushed since, it is no longer left');
});

test('the repository adds up what agents used by where they ran: a run in GitHub Actions and a session on a machine', async () => {
  const l = await fresh();
  await make(l, [{ op: 'create', ref: 'repo', type: 'repo', title: 'Site repo', props: { remote: 'https://github.com/acme/site.git', path: 'C:\code\site' } }]);
  await call(l, agent, 'run_report', { repo: 'acme/site', title: 'Read the push to main (abc1234)', tokens: 42_000.4, cost_usd: 0.31337, turns: 9, link: 'https://github.com/acme/site/actions/runs/1', summary: 'Closed one task.' });
  await call(l, agent, 'run_report', { repo: 'acme/site', title: 'Scheduled re-check', ok: false, tokens: 8_000, link: 'https://github.com/acme/site/actions/runs/2' });
  // A session on a machine in the same repository is counted beside it, apart.
  const run = (await call<{ run: string }>(l, agent, 'capture', { action: 'session_start', params: { session_id: 'local', cwd: 'C:\code\site', surface: 'claude-code' } })).run;
  await make(l, [{ op: 'update', id: run, props: { tokens_used: 100_000 } }]);
  const usage = (await view(l, 'agent_usage', { repo: 'Site repo' })) as any;
  assert.deepEqual(usage.week, { 'claude-code': { runs: 1, tokens: 100_000, cost_usd: 0 }, 'github-actions': { runs: 2, tokens: 50_000, cost_usd: 0.3134 } });
  assert.deepEqual(usage.runs.map((x: any) => [x.title, x.status, x.tokens]).sort(), [['Read the push to main (abc1234)', 'finished', 42_000], ['Scheduled re-check', 'failed', 8_000], ['Session in Site repo', 'running', 100_000]].sort());
});
