// The push reader's handler, tested without a database or a network: a stand-in context answers its reads of the
// map, its connection and its reads of GitHub through the App, and records what it asked for.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { within, sought } from './github.js';
import handler from './handler.js';
import { alike, unread } from './history.js';
import { ON_PUSH } from './push.js';
import { nearness, shortlist, shows, wordsOf } from './shortlist.js';

const REPO = { id: 'e_repo0001', type: 'software.repo', title: 'Tools repo', props: { remote: 'https://github.com/acme/tools.git' } };
const A = 'a'.repeat(40);
const B = 'b'.repeat(40);
const link = (sha: string) => `https://github.com/Acme/Tools/commit/${sha}`;

/**
 * The map as the stand-in answers it, by the kind of read: the open work (one task), its statuses, the pushes and
 * runs heard so far, who made each item and who changed it since, what search finds, and what waits for the owner.
 */
interface Map {
  work?: { id: string; type: string; status: string; title: string }[];
  pushes?: { detail: Record<string, unknown> }[];
  runs?: { status: string; props: { link: string } }[];
  made?: Record<string, { actor: string; detail?: Record<string, unknown> }>;
  changed?: Record<string, { actor: string; detail?: Record<string, unknown> }[]>;
  found?: { id: string; type: string; status: string; title: string }[];
  waiting?: string[];
  item?: { id: string; type: string; status: string; title: string };
  due?: (q: any) => unknown;
}
const TASK = { id: 'e_task0001', type: 'work.task', status: 'todo', title: 'Oil the whetstone' };

function ctxOver({ github = {} as Record<string, unknown>, connected = true, map = {} as Map, now = '2026-10-22T12:00:00.000Z' } = {}) {
  const asked: string[] = [];
  const reads: any[] = [];
  const ctx = {
    now,
    actor: { kind: 'agent', name: 'pack:reader' },
    request: async (r: { via: string; host: string; path: string }) => {
      assert.deepEqual([r.via, r.host], ['github_app', 'api'], 'only through the App’s API host');
      asked.push(r.path);
      return r.path in github ? { status: 200, body: structuredClone(github[r.path]) } : { status: 404, body: { message: 'Not Found' } };
    },
    read: async (q: any) => {
      reads.push(q);
      if ('connection' in q) return connected ? { id: '42', account: 'acme' } : null;
      if (q.items?.type === 'software.repo') return [REPO];
      if (q.items?.type === 'sys.run') return (map.runs ?? []).filter((r) => r.props.link === q.items.where.link);
      if (q.view === 'repo_work') return { ready: map.work ?? [TASK], blocked: [] };
      if (q.view === 'recheck') return map.due?.(q);
      if (q.type_info) return { statuses: { open: ['todo', 'doing'], closed: ['done', 'dropped'] }, lives_in: 'software.lives_in' };
      if (q.related) return map.runs ?? [];
      if (q.events?.action === 'repo.push') return map.pushes ?? [];
      if (q.events?.action === 'entity.create') return map.made?.[q.events.target] ? [map.made[q.events.target]] : [{ actor: 'human:owner' }];
      if (q.events?.action === 'entity.update') return map.changed?.[q.events.target] ?? [];
      if (q.tool === 'search') return map.found ?? [];
      if (q.tool === 'get') return { entity: map.item ?? TASK, outgoing: [], incoming: [] };
      if ('proposed' in q) return (map.waiting ?? []).includes(q.proposed.title);
      if (q.tool === 'proposals') return (map.waiting ?? []).map((title) => ({ ops: [{ op: 'create', title }, { op: 'link' }] }));
      if (q.get) return map.item ?? TASK;
      throw new Error(`Not read here: ${JSON.stringify(q)}`);
    },
  };
  return { ctx, asked, reads };
}

const github = {
  '/installation/repositories?per_page=100&page=1': { repositories: [{ full_name: 'Acme/Tools' }, { full_name: 'Acme/Site' }] },
  '/repos/Acme/Tools': { default_branch: 'main' },
  [`/repos/Acme/Tools/compare/${A}...${B}?per_page=100`]: { commits: [{ sha: B, commit: { message: 'Sharpen the tools\n\nThe whetstone still needs oiling.' } }], files: [{ filename: 'tools/sharpen.ts', status: 'modified', additions: 4, deletions: 1, patch: '+  oil()' }] },
};
const pushEvent = (detail: Record<string, unknown>) => ({ event: { action: 'repo.push', target: REPO.id, pack: 'github', detail: { repo: 'acme/tools', branch: 'main', before: A, after: B, commits: [{ sha: 'bbbbbbb', subject: 'Sharpen the tools' }], ...detail } } });
const pushContext = (branch = 'main', own: string[] = []) => ({ kind: 'push', repo: { name: 'Acme/Tools', entity: { id: REPO.id, title: 'Tools repo', type: 'software.repo' } }, push: { branch, default_branch: 'main', before: A, after: B }, own });

test('the reader asks GitHub only about the one repository, whatever the text it read there tells it to ask', () => {
  // A path or a ref is part of an address under the repository: a step up would land in another one.
  assert.equal(within('src/a file.ts'), 'src/a%20file.ts');
  assert.equal(within('feature/x'), 'feature/x');
  assert.equal(within(undefined), '');
  for (const path of ['../../other/contents/secrets.txt', 'src/../../../other', './x', '..']) assert.throws(() => within(path), /steps outside the repository/);
  // An encoded step is a name like any other to GitHub, and stays encoded.
  assert.equal(within('%2e%2e/x'), '%252e%252e/x');
  // A search is of this repository: words that say where to search are dropped.
  assert.equal(sought('api key repo:someone/private'), 'api key');
  assert.equal(sought('ORG:acme user: me token'), 'token');
  assert.equal(sought('reporter: is a word'), 'reporter: is a word');
});

test('a push the GitHub pack recorded is read once: one run, held to its repository, with what changed handed over first', async () => {
  const { ctx } = ctxOver({ github });
  const { runs } = await handler['repo.push'](pushEvent({}), ctx);
  assert.equal(runs.length, 1);
  const [run] = runs;
  assert.deepEqual([run.title, run.within, run.by, run.link, run.map_tools], ['Read the push to main (bbbbbbb)', [REPO.id], 'a push to main', link(B), undefined]);
  // Claimed by repository and head: the two servers of a deploy, or a catch-up, do not read it again.
  assert.equal(run.once, `push:acme/tools@${B}`);
  assert.deepEqual(run.tools.map((t: any) => t.name), ['decide', 'update', 'create', 'look', 'find', 'diff', 'file']);
  assert.ok(JSON.stringify(run.tools).length < 3000, 'small enough to send every turn');
  // The item the push is near is asked about by itself, with the part of the diff that touches it.
  assert.match(run.task, /Branch "main"[\s\S]*a{40}\.\.b{40}[\s\S]*whetstone still needs oiling[\s\S]*Candidates \(1\): decide on each\.\n## e_task0001 work\.task \[todo\] Oil the whetstone\nWhy asked: its words are in the push\.[\s\S]*Other open items of this repository \(0\)[\s\S]*work\.task: open todo, doing; closed done, dropped/);
  assert.deepEqual(run.context.repo, { name: 'Acme/Tools', entity: { id: REPO.id, title: 'Tools repo', type: 'software.repo' } });
});

test('its brief asks only for what a commit shows: nothing is moved for having been started', () => {
  assert.doesNotMatch(ON_PUSH, /visibly started|status that says so/);
  assert.match(ON_PUSH, /Never set an open status such as doing/);
  assert.match(ON_PUSH, /finished is false when the push only touches\s+the same subject, does part of it, or prepares for it/);
});

test('a tag, a branch deleted, a push of no commits, or a workspace that has not connected the App, is not read', async () => {
  for (const detail of [{ tag: 'v1', branch: undefined }, { deleted: true }, { commits: [] }]) assert.deepEqual(await handler['repo.push'](pushEvent(detail), ctxOver({ github }).ctx), {});
  const { ctx, asked } = ctxOver({ github, connected: false });
  assert.deepEqual(await handler['repo.push'](pushEvent({}), ctx), {});
  assert.deepEqual(asked, [], 'and GitHub is not asked');
  // A repository the App was not given is not read either.
  const other = { ...pushEvent({}), event: { ...pushEvent({}).event, target: 'e_elsewhere' } };
  assert.deepEqual(await handler['repo.push'](other, ctxOver({ github }).ctx), {});
});

test('a commit is read once, however many branches carry it: the merge of a branch read before is not read again', async () => {
  // The branch was pushed and read (its run finished); then the same commit reaches main with a merge commit.
  const map: Map = { pushes: [{ detail: { branch: 'feat', after: 'c'.repeat(40), commits: [{ sha: 'bbbbbbb' }] } }], runs: [{ status: 'finished', props: { link: link('c'.repeat(40)) } }] };
  const merged = pushEvent({ commits: [{ sha: 'bbbbbbb', subject: 'Sharpen the tools' }, { sha: 'ddddddd', subject: 'Merge pull request #7 from acme/feat' }] });
  const { ctx, asked } = ctxOver({ github, map });
  assert.deepEqual(await handler['repo.push'](merged, ctx), { answer: { reason: 'Every commit of this push was read already.' } });
  assert.ok(!asked.some((p) => p.includes('/compare/')), 'nothing is gathered for it');
  // A reading that broke covers nothing: the commit is read again.
  const broke = { ...map, runs: [{ status: 'failed', props: { link: link('c'.repeat(40)) } }] };
  assert.equal((await handler['repo.push'](merged, ctxOver({ github, map: broke }).ctx)).runs.length, 1);
  // With a new commit beside it, only the new one is listed; the other is said to be read.
  const both = { ...github, [`/repos/Acme/Tools/compare/${A}...${B}?per_page=100`]: { commits: [{ sha: 'b'.repeat(40), commit: { message: 'Sharpen the tools' } }, { sha: 'e'.repeat(40), commit: { message: 'Strop the blade' } }], files: [] } };
  const { runs } = await handler['repo.push'](pushEvent({ commits: [{ sha: 'bbbbbbb' }, { sha: 'eeeeeee', subject: 'Strop the blade' }] }), ctxOver({ github: both, map }).ctx);
  assert.match(runs[0].task, /\(1 more were read before, on another branch[\s\S]*- eeeeeee Strop the blade/);
  assert.doesNotMatch(runs[0].task, /- bbbbbbb/);
  assert.deepEqual(unread([{ sha: 'fffffff', subject: 'Merge branch main into feat' }], new Set()), [], 'a merge alone says nothing of its own');
});

test('what it made itself and nobody has reviewed is marked as its own guess, and left alone', async () => {
  const guess = { id: 'e_guess001', type: 'work.task', status: 'todo', title: 'Server reads no commit in a git worktree' };
  const reviewed = { id: 'e_guess002', type: 'work.task', status: 'todo', title: 'Approved since' };
  const changed = { id: 'e_guess003', type: 'work.task', status: 'todo', title: 'Retitled by the owner' };
  const map: Map = {
    work: [TASK, guess, reviewed, changed],
    made: { e_guess001: { actor: 'agent:reader' }, e_guess002: { actor: 'agent:reader', detail: { approved_by: 'human:owner' } }, e_guess003: { actor: 'agent:reader' } },
    changed: { e_guess003: [{ actor: 'human:owner' }] },
  };
  const { runs } = await handler['repo.push'](pushEvent({}), ctxOver({ github, map }).ctx);
  assert.match(runs[0].task, /e_guess001 work\.task \[todo\] Server reads no commit in a git worktree \(unreviewed\)/);
  assert.match(runs[0].task, /e_task0001 work\.task \[todo\] Oil the whetstone\n/);
  assert.match(runs[0].task, /Approved since\n[\s\S]*Retitled by the owner\n/, 'what the owner approved or changed is theirs');
  assert.deepEqual(runs[0].context.own, ['e_guess001']);
  const decide = handler.tool({ name: 'decide', input: { id: 'e_guess001', finished: true, quote: 'Sharpen the tools', why: 'x' }, context: runs[0].context }, ctxOver({ github, map: { item: guess } }).ctx);
  await assert.rejects(decide, /your own guess from an earlier push, not yet reviewed/);
});

test('decide closes only what the push shows, word for word, on the default branch; update only corrects', async () => {
  const { ctx } = ctxOver({ github });
  const call = (name: string, input: Record<string, unknown>, context = pushContext()) => handler.tool({ name, input, context }, ctx);
  assert.deepEqual(await call('decide', { id: 'e_task0001', finished: false, why: 'Not this one' }), { answer: 'e_task0001 left as it is.' });
  await assert.rejects(call('decide', { id: 'e_task0001', finished: true, quote: 'The whetstone is oiled now', why: 'x' }), /That quote is not in this push/, 'a line the push does not have');
  await assert.rejects(call('decide', { id: 'e_task0001', finished: true, quote: 'oil', why: 'x' }), /That quote is not in this push/, 'too short to show anything');
  await assert.rejects(call('decide', { id: 'e_task0001', finished: true, quote: '+  oil()', why: 'x' }, pushContext('feat')), /"feat" is not the default branch/);
  const done = await call('decide', { id: 'e_task0001', finished: true, quote: 'The whetstone still needs oiling.', why: 'The commit oils it' });
  assert.deepEqual(done.changes, [{ ops: [{ op: 'update', id: 'e_task0001', status: 'done' }], reason: 'The commit oils it ("The whetstone still needs oiling.")', authority: { of: 'agent', basis: 'The commit oils it ("The whetstone still needs oiling.")' }, source: { uri: link(B), kind: 'commit' } }]);
  assert.deepEqual((await handler.tool({ name: 'decide', input: { id: 'e_task0001', finished: true, quote: 'still needs oiling', why: 'x' }, context: pushContext() }, ctxOver({ github, map: { waiting: [] } }).ctx)).changes[0].ops, [{ op: 'update', id: 'e_task0001', status: 'done' }], 'spacing and case aside, part of a line will do');
  await assert.rejects(call('update', { id: 'e_task0001', status: 'done', why: 'x' }), /To close an item, decide/);
  await assert.rejects(call('update', { id: 'e_task0001', title: 'Oil the whetstone', why: 'x' }), /Nothing to change: e_task0001 is already "Oil the whetstone" \[todo\]/);
  await assert.rejects(call('update', { id: 'e_task0001', why: 'x' }), /Say what to change/);
  assert.deepEqual((await call('update', { id: 'e_task0001', append: 'Oiled in bbbbbbb.', why: 'x' }, pushContext('feat'))).changes[0].ops, [{ op: 'update', id: 'e_task0001', append: 'Oiled in bbbbbbb.' }], 'a line added is always a change, on any branch');
  await assert.rejects(call('rm', {}), /No tool "rm"/);
});

test('the items asked about are found without a model: named, worked on from the branch, or near by their words', () => {
  const items = [TASK, { id: 'e_far00001', type: 'work.task', status: 'todo', title: 'Write the invoice export' }, { id: 'e_named001', type: 'work.task', status: 'todo', title: 'Anything at all' }, { id: 'e_work0001', type: 'work.issue', status: 'open', title: 'Unrelated words here' }];
  const pushed = { messages: ['Sharpen the tools\n\nThe whetstone still needs oiling. Closes: e_named001'], files: [{ filename: 'tools/sharpen.ts', patch: '+  oil()' }] };
  assert.deepEqual(shortlist(items, pushed, { named: ['e_named001'], worked: ['e_work0001'] }).map((c) => [c.item.id, c.why]), [
    ['e_named001', 'a commit names it'],
    ['e_work0001', 'the session that pushed this branch was working on it'],
    ['e_task0001', 'its words are in the push'],
  ]);
  assert.equal(nearness('Write the invoice export', wordsOf(pushed.messages[0]), wordsOf('tools/sharpen.ts oil()')), 0, 'nothing of it is in the push');
  assert.equal(shows('  THE whetstone   still needs oiling ', pushed), true);
  assert.equal(shows('oil()', pushed), false, 'under twelve characters shows nothing');
  assert.equal(shows('-  removed line here', { messages: [], files: [{ filename: 'x', patch: '-  removed line here' }] }), false, 'a removed line finishes nothing');
});

test('create makes no copies: what is open already, near enough by its title, or waiting for the owner, is named back', async () => {
  const context = pushContext();
  const create = (title: string, map: Map = {}, extra = {}) => handler.tool({ name: 'create', input: { type: 'work.task', title, why: 'The commit says so', ...extra }, context }, ctxOver({ map }).ctx);
  const found = [{ id: 'e_open0001', type: 'work.issue', status: 'open', title: 'Server reads no commit in a git worktree' }];
  await assert.rejects(create('Server reads no commit in a Git worktree.', { found }), /Already there: e_open0001 work\.issue \[open\] "Server reads no commit in a git worktree"\. Change that one/);
  await assert.rejects(create('The server reads no commit in a git worktree', { found }), /Already there: e_open0001/, 'a word more or less');
  await assert.rejects(create('Strop the blade', { waiting: ['Strop the blade'] }), /waiting for the owner already/);
  await assert.rejects(create('Strop blade', { waiting: ['Strop the blade'] }), /Making "Strop the blade" is waiting for the owner already: that is this one/, 'made twice in one read, worded twice');
  await assert.rejects(create('Evaluate open models', { found: [{ id: 'e_open0002', type: 'work.task', status: 'todo', title: 'Evaluate open models through LiteLLM' }] }), /Already there: e_open0002/, 'every word of it is in one already there');
  // Something new lives in the repository by the link its type says, or is part of what it is given.
  const made = await create('Strop the blade', { found });
  assert.deepEqual(made.changes[0].ops, [{ op: 'create', ref: 'n', type: 'work.task', title: 'Strop the blade' }, { op: 'link', type: 'software.lives_in', from: 'n', to: REPO.id }]);
  const under = await create('Hone', {}, { part_of: 'e_feat0001' });
  assert.deepEqual(under.changes[0].ops[1], { op: 'link', type: 'part_of', from: 'n', to: 'e_feat0001' });
  assert.equal(alike('Server reads no commit', 'Server reads every commit in a worktree'), false, 'different things are not taken for one');
});

test('what it looks up in the map goes through the map’s own reads, as the run’s agent', async () => {
  const looked = ctxOver({ map: { found: [TASK] } });
  assert.equal((await handler.tool({ name: 'find', input: { words: 'whetstone' }, context: pushContext() }, looked.ctx)).answer, 'e_task0001 work.task [todo] Oil the whetstone');
  assert.deepEqual(looked.reads.at(-1), { tool: 'search', input: { q: 'whetstone', limit: 10 } });
});

test('what is gathered is not there: the run still starts, told to look for itself', async () => {
  const gone: Record<string, unknown> = { ...github };
  delete gone[`/repos/Acme/Tools/compare/${A}...${B}?per_page=100`];
  const { runs } = await handler['repo.push'](pushEvent({}), ctxOver({ github: gone }).ctx);
  assert.match(runs[0].task, /could not be gathered \(GitHub answered 404: Not Found[\s\S]*use `diff` on b{40}/);
});

test('catching up reads, for each branch, everything since the last push that was read, as one; and once', async () => {
  const pushes = [
    { seq: 3, detail: { branch: 'main', before: 'c'.repeat(40), after: 'd'.repeat(40), commits: [{ sha: 'ddddddd' }] } },
    { seq: 2, detail: { branch: 'main', before: B, after: 'c'.repeat(40), commits: [{ sha: 'ccccccc' }] } },
    { seq: 1, detail: { branch: 'main', before: A, after: B, commits: [{ sha: 'bbbbbbb' }] } },
    { seq: 0, detail: { branch: 'gone', deleted: true, after: '0'.repeat(40) } },
  ];
  const map: Map = { pushes, runs: [{ status: 'finished', props: { link: link(B) } }] };
  const { runs } = await handler.catch_up({}, ctxOver({ github: { ...github, [`/repos/Acme/Tools/compare/${B}...${'d'.repeat(40)}?per_page=100`]: { commits: [], files: [] } }, map }).ctx);
  assert.deepEqual(runs.map((r: any) => [r.title, r.context.push.before, r.context.push.after, r.once]), [['Read the push to main (ddddddd)', B, 'd'.repeat(40), `push:acme/tools@${'d'.repeat(40)}`]]);
  map.runs!.push({ status: 'finished', props: { link: link('d'.repeat(40)) } });
  assert.deepEqual((await handler.catch_up({}, ctxOver({ github, map }).ctx)).runs, []);
});

test('a re-check is asked for when one is due, with the map’s tools and the repository’s; asked for now, it does not wait', async () => {
  const due = (q: any) => ({ due: q.params.now, projects: [{ id: 'e_proj0001', due: true, items: [] }, { id: 'e_proj0002', due: false }] });
  assert.deepEqual((await handler.recheck({}, ctxOver({ github, map: { due } }).ctx)).runs, [], 'an hour when nothing is due costs no run');
  const hourly = (await handler.recheck({}, ctxOver({ github, map: { due: () => due({ params: { now: true } }) } }).ctx)).runs[0];
  assert.equal(hourly.once, `recheck:${REPO.id}@2026-10-22T12`, 'one scheduled re-check of a repository in an hour, whichever server leads');
  const { runs } = await handler['reader.recheck']({ repo: REPO.id }, ctxOver({ github, map: { due } }).ctx);
  const [run] = runs;
  assert.deepEqual([run.title, run.within, run.then, run.link, run.once], ['Re-check asked for by hand', [REPO.id], 'rechecked', 'https://github.com/Acme/Tools#recheck-2026-10-22T12:00:00', undefined]);
  assert.deepEqual(run.map_tools, ['view', 'search', 'get', 'events', 'schema', 'proposals', 'change', 'notify', 'rechecked']);
  assert.deepEqual(run.tools.map((t: any) => t.name), ['commits', 'diff', 'file', 'list', 'log', 'find']);
  assert.match(run.task, /re-check the owner asked for[\s\S]*e_proj0001/);
  assert.doesNotMatch(run.task, /e_proj0002/, 'only the projects that are due');
  await assert.rejects(handler['reader.recheck']({ repo: 'e_notarepo' }, ctxOver({ github, map: { due } }).ctx), /not a repository the GitHub App was given/);
  await assert.rejects(handler['reader.recheck']({ repo: REPO.id }, ctxOver({ github, connected: false }).ctx), /has not connected GitHub/);
  // Over, it starts the wait again, saying so when it did not finish.
  const context = run.context;
  assert.deepEqual(handler.rechecked({ ok: true, context }), { calls: [{ tool: 'rechecked', input: { repo: REPO.id } }] });
  assert.deepEqual(handler.rechecked({ ok: false, context }), { calls: [{ tool: 'rechecked', input: { repo: REPO.id, summary: 'The re-check did not finish.' } }] });
});

test('the re-check reads the repository with no step outside it', async () => {
  const context = { kind: 'recheck', repo: { name: 'Acme/Tools', entity: { id: REPO.id } }, ref: 'main' };
  const { ctx, asked } = ctxOver({ github: { '/repos/Acme/Tools/contents/src?ref=main': [{ name: 'a.ts', type: 'file', size: 3 }, { name: 'lib', type: 'dir', size: 0 }], '/search/code?per_page=20&q=api%20key%20repo%3AAcme%2FTools': { items: [{ path: 'src/a.ts' }] } } });
  assert.deepEqual((await handler.tool({ name: 'list', input: { path: 'src' }, context }, ctx)).answer, ['a.ts (3 bytes)', 'lib/']);
  assert.deepEqual((await handler.tool({ name: 'find', input: { query: 'api key repo:someone/private' }, context }, ctx)).answer, ['src/a.ts']);
  await assert.rejects(handler.tool({ name: 'file', input: { path: '../other/x' }, context }, ctx), /steps outside the repository/);
  assert.deepEqual(asked, ['/repos/Acme/Tools/contents/src?ref=main', '/search/code?per_page=20&q=api%20key%20repo%3AAcme%2FTools']);
});
