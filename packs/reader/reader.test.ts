// The push reader's handler, tested without a database or a network: a stand-in context answers its reads of the
// map, its connection and its reads of GitHub through the App, and records what it asked for.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { within, sought } from './github.js';
import handler from './handler.js';

const REPO = { id: 'e_repo0001', type: 'software.repo', title: 'Tools repo', props: { remote: 'https://github.com/acme/tools.git' } };
const B = 'b'.repeat(40);

/** A context over a GitHub that answers `github` by path, and a map that answers `map` by the kind of read. */
function ctxOver({ github = {} as Record<string, unknown>, connected = true, map = {} as Record<string, (q: any) => unknown>, now = '2026-10-22T12:00:00.000Z' } = {}) {
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
      const kind = Object.keys(q).find((k) => k in map);
      if (kind) return map[kind](q);
      if (q.items?.type === 'sys.run') return [];
      throw new Error(`Not read here: ${JSON.stringify(q)}`);
    },
  };
  return { ctx, asked, reads };
}

const github = {
  '/installation/repositories?per_page=100&page=1': { repositories: [{ full_name: 'Acme/Tools' }, { full_name: 'Acme/Site' }] },
  '/repos/Acme/Tools': { default_branch: 'main' },
  [`/repos/Acme/Tools/compare/${'a'.repeat(40)}...${B}?per_page=100`]: { commits: [{ sha: B, commit: { message: 'Sharpen the tools\n\nThe whetstone still needs oiling.' } }], files: [{ filename: 'tools/sharpen.ts', status: 'modified', additions: 4, deletions: 1, patch: '+  oil()' }] },
};
const pushEvent = (detail: Record<string, unknown>) => ({ event: { action: 'repo.push', target: REPO.id, pack: 'github', detail: { repo: 'acme/tools', branch: 'main', before: 'a'.repeat(40), after: B, commits: [{ sha: 'bbbbbbb' }], ...detail } } });
const work = { view: () => ({ ready: [{ id: 'e_task0001', type: 'work.task', status: 'todo', title: 'Oil the whetstone' }], blocked: [] }), type_info: () => ({ statuses: { open: ['todo', 'doing'], closed: ['done'] }, lives_in: 'software.lives_in' }) };

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

test('a push the GitHub pack recorded is read: one run, held to its repository, with what changed handed over first', async () => {
  const { ctx } = ctxOver({ github, map: work });
  const { runs } = await handler['repo.push'](pushEvent({}), ctx);
  assert.equal(runs.length, 1);
  const [run] = runs;
  assert.deepEqual([run.title, run.within, run.by, run.link, run.map_tools], ['Read the push to main (bbbbbbb)', [REPO.id], 'a push to main', `https://github.com/Acme/Tools/commit/${B}`, undefined]);
  assert.deepEqual(run.tools.map((t: any) => t.name), ['update', 'create', 'look', 'find', 'diff', 'file']);
  assert.ok(JSON.stringify(run.tools).length < 3000, 'small enough to send every turn');
  assert.match(run.task, /Branch "main"[\s\S]*a{40}\.\.b{40}[\s\S]*whetstone still needs oiling[\s\S]*tools\/sharpen\.ts[\s\S]*e_task0001 work\.task \[todo\] Oil the whetstone[\s\S]*work\.task: open todo, doing; closed done/);
  assert.deepEqual(run.context.repo, { name: 'Acme/Tools', entity: { id: REPO.id, title: 'Tools repo', type: 'software.repo' } });
});

test('a tag, a branch deleted, a push of no commits, or a workspace that has not connected the App, is not read', async () => {
  for (const detail of [{ tag: 'v1', branch: undefined }, { deleted: true }, { commits: [] }]) assert.deepEqual(await handler['repo.push'](pushEvent(detail), ctxOver({ github, map: work }).ctx), {});
  const { ctx, asked } = ctxOver({ github, map: work, connected: false });
  assert.deepEqual(await handler['repo.push'](pushEvent({}), ctx), {});
  assert.deepEqual(asked, [], 'and GitHub is not asked');
  // A repository the App was not given is not read either.
  const other = { ...pushEvent({}), event: { ...pushEvent({}).event, target: 'e_elsewhere' } };
  assert.deepEqual(await handler['repo.push'](other, ctxOver({ github, map: work }).ctx), {});
});

test('what is gathered is not there: the run still starts, told to look for itself', async () => {
  const gone: Record<string, unknown> = { ...github };
  delete gone[`/repos/Acme/Tools/compare/${'a'.repeat(40)}...${B}?per_page=100`];
  const { ctx } = ctxOver({ github: gone, map: work });
  const { runs } = await handler['repo.push'](pushEvent({}), ctx);
  assert.match(runs[0].task, /could not be gathered \(GitHub answered 404: Not Found[\s\S]*use `diff` on b{40}/);
});

test('update sends only what changes, as a change of the run’s own, and refuses an update that changes nothing', async () => {
  const { ctx } = ctxOver({ map: { get: () => ({ id: 'e_task0001', status: 'todo', title: 'Oil the whetstone' }) } });
  const context = { kind: 'push', repo: { name: 'Acme/Tools', entity: { id: REPO.id, title: 'Tools repo', type: 'software.repo' } }, push: { branch: 'main', default_branch: 'main', before: 'a'.repeat(40), after: B } };
  const call = (name: string, input: Record<string, unknown>) => handler.tool({ name, input, context }, ctx);
  await assert.rejects(call('update', { id: 'e_task0001', title: 'Oil the whetstone', status: 'todo', why: 'x' }), /Nothing to change: e_task0001 is already "Oil the whetstone" \[todo\]/);
  await assert.rejects(call('update', { id: 'e_task0001', why: 'x' }), /Say what to change/);
  const done = await call('update', { id: 'e_task0001', title: 'Oil the whetstone', status: 'done', why: 'The commit oils it' });
  assert.deepEqual(done.changes, [{ ops: [{ op: 'update', id: 'e_task0001', status: 'done' }], reason: 'The commit oils it', authority: { of: 'agent', basis: 'The commit oils it' }, source: { uri: `https://github.com/Acme/Tools/commit/${B}`, kind: 'commit' } }]);
  assert.deepEqual((await call('update', { id: 'e_task0001', append: 'Oiled in bbbbbbb.', why: 'x' })).changes[0].ops, [{ op: 'update', id: 'e_task0001', append: 'Oiled in bbbbbbb.' }], 'a line added is always a change');
  // Something new lives in the repository by the link its type says, or is part of what it is given.
  const made = await handler.tool({ name: 'create', input: { type: 'work.task', title: 'Strop the blade', why: 'The commit says so' }, context }, ctxOver({ map: work }).ctx);
  assert.deepEqual(made.changes[0].ops, [{ op: 'create', ref: 'n', type: 'work.task', title: 'Strop the blade' }, { op: 'link', type: 'software.lives_in', from: 'n', to: REPO.id }]);
  const under = await handler.tool({ name: 'create', input: { type: 'work.task', title: 'Hone', part_of: 'e_feat0001', why: 'x' }, context }, ctxOver({ map: work }).ctx);
  assert.deepEqual(under.changes[0].ops[1], { op: 'link', type: 'part_of', from: 'n', to: 'e_feat0001' });
  // What it looks up in the map goes through the map's own reads, as the run's agent.
  const looked = ctxOver({ map: { tool: (q) => (q.tool === 'search' ? [{ id: 'e_task0001', type: 'work.task', status: 'todo', title: 'Oil the whetstone' }] : null) } });
  assert.equal((await handler.tool({ name: 'find', input: { words: 'whetstone' }, context }, looked.ctx)).answer, 'e_task0001 work.task [todo] Oil the whetstone');
  assert.deepEqual(looked.reads.at(-1), { tool: 'search', input: { q: 'whetstone', limit: 10 } });
  await assert.rejects(call('rm', {}), /No tool "rm"/);
});

test('catching up reads, for each branch, everything since the last push that was read, as one; and once', async () => {
  const pushes = [
    { seq: 3, detail: { branch: 'main', before: 'c'.repeat(40), after: 'd'.repeat(40), commits: [{ sha: 'ddddddd' }] } },
    { seq: 2, detail: { branch: 'main', before: B, after: 'c'.repeat(40), commits: [{ sha: 'ccccccc' }] } },
    { seq: 1, detail: { branch: 'main', before: 'a'.repeat(40), after: B, commits: [{ sha: 'bbbbbbb' }] } },
    { seq: 0, detail: { branch: 'gone', deleted: true, after: '0'.repeat(40) } },
  ];
  const read = new Set([`https://github.com/Acme/Tools/commit/${B}`]);
  const map = { ...work, events: (q: any) => (assert.equal(q.events.since, '2026-10-22T09:00:00.000Z'), pushes), items: (q: any) => (read.has(q.items.where.link) ? [{ id: 'e_run' }] : []) };
  const { runs } = await handler.catch_up({}, ctxOver({ github: { ...github, [`/repos/Acme/Tools/compare/${B}...${'d'.repeat(40)}?per_page=100`]: { commits: [], files: [] } }, map }).ctx);
  assert.deepEqual(runs.map((r: any) => [r.title, r.context.push.before, r.context.push.after]), [['Read the push to main (ddddddd)', B, 'd'.repeat(40)]]);
  read.add(`https://github.com/Acme/Tools/commit/${'d'.repeat(40)}`);
  assert.deepEqual((await handler.catch_up({}, ctxOver({ github, map }).ctx)).runs, []);
});

test('a re-check is asked for when one is due, with the map’s tools and the repository’s; asked for now, it does not wait', async () => {
  const due = (q: any) => ({ due: q.params.now || q.params.repo === 'never', projects: [{ id: 'e_proj0001', due: true, items: [] }, { id: 'e_proj0002', due: false }] });
  assert.deepEqual((await handler.recheck({}, ctxOver({ github, map: { view: due } }).ctx)).runs, [], 'an hour when nothing is due costs no run');
  const { runs } = await handler['reader.recheck']({ repo: REPO.id }, ctxOver({ github, map: { view: due } }).ctx);
  const [run] = runs;
  assert.deepEqual([run.title, run.within, run.then, run.link], ['Re-check asked for by hand', [REPO.id], 'rechecked', 'https://github.com/Acme/Tools#recheck-2026-10-22T12:00:00']);
  assert.deepEqual(run.map_tools, ['view', 'search', 'get', 'events', 'schema', 'proposals', 'change', 'notify', 'rechecked']);
  assert.deepEqual(run.tools.map((t: any) => t.name), ['commits', 'diff', 'file', 'list', 'log', 'find']);
  assert.match(run.task, /re-check the owner asked for[\s\S]*e_proj0001/);
  assert.doesNotMatch(run.task, /e_proj0002/, 'only the projects that are due');
  await assert.rejects(handler['reader.recheck']({ repo: 'e_notarepo' }, ctxOver({ github, map: { view: due } }).ctx), /not a repository the GitHub App was given/);
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
