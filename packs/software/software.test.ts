// The software pack's handler, tested without a database: fixtures stand where the kernel answers its reads.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from './handler.js';
import { repoName } from './repo.js';

type Item = { id: string; type: string; title: string; status?: string; is_open?: boolean; props?: Record<string, unknown>; body?: string; created_at?: string; updated_at?: string };

const LINEAGE: Record<string, string[]> = {
  'repo': ['repo', 'place'],
  'project': ['project', 'work'],
  'task': ['task', 'work'],
  'issue': ['issue', 'work'],
  'handoff': ['handoff', 'note', 'record'],
  'run': ['run'],
};

/** What the kernel answers: items in a repository's scope, its pushes, what blocks what, and two of its own views. */
function ctxOver(items: Item[], opts: { scope?: Record<string, string[]>; lives?: Record<string, string[]>; parts?: Record<string, string>; blocked?: Record<string, { roots: string[]; waits?: boolean }>; pushes?: unknown[]; traps?: unknown[] } = {}) {
  const byId = new Map(items.map((e) => [e.id, { status: 'active', is_open: true, props: {}, body: '', created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z', ...e, is: LINEAGE[e.type] ?? [e.type] }]));
  const of = (ids: string[], types?: string[]) => ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])).filter((e) => !types || types.some((t) => e.is.includes(t)));
  return {
    now: '2026-10-16T12:00:00Z',
    zone: 'America/Toronto',
    read: async (q: Record<string, any>) => {
      if (q.get) return byId.get(q.get) ?? null;
      if (q.items) return [...byId.values()].filter((e) => e.is.includes(q.items.type) && Object.entries(q.items.where ?? {}).every(([k, v]) => e.props[k] === v));
      if (q.scope) return of(opts.scope?.[q.scope] ?? [], q.types).filter((e) => q.open === undefined || e.is_open === q.open).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      if (q.related && q.relation === 'lives_in' && q.direction === 'in') return of(opts.lives?.[q.related] ?? [], q.types);
      if (q.related && q.relation === 'lives_in') return Object.entries(opts.lives ?? {}).filter(([, ids]) => ids.includes(q.related)).map(([place]) => byId.get(place));
      if (q.related && q.relation === 'part_of') return opts.parts?.[q.related] ? [byId.get(opts.parts[q.related])] : [];
      if (q.events) return opts.pushes ?? [];
      if (q.blocked) return Object.fromEntries(q.blocked.map((id: string) => [id, { blocked: Boolean(opts.blocked?.[id]), waits_on_someone: Boolean(opts.blocked?.[id]?.waits), roots: (opts.blocked?.[id]?.roots ?? []).map((r) => ({ id: r, title: byId.get(r)?.title })) }]));
      if (q.view === 'attention') return { items: [], counts: {} };
      if (q.view === 'hubs') return { hubs: [] };
      if (q.view === 'instructions') return { said: opts.traps ?? [] };
      throw new Error(`no read ${JSON.stringify(q)}`);
    },
  };
}

const ITEMS: Item[] = [
  { id: 'repo', type: 'repo', title: 'Apex repo', props: { remote: 'https://github.com/acme/apex.git' } },
  { id: 'proj', type: 'project', title: 'Apex', props: { recheck_days: 7 } },
  { id: 'a', type: 'task', title: 'Write the probe', props: { due: '2026-10-20' }, updated_at: '2026-09-01T00:00:00Z' },
  { id: 'b', type: 'task', title: 'Tune the solver', updated_at: '2026-10-15T00:00:00Z' },
  { id: 'c', type: 'issue', title: 'Thin walls diverge', updated_at: '2026-10-10T00:00:00Z' },
  { id: 'gone', type: 'task', title: 'Old chore', status: 'done', is_open: false, updated_at: '2026-10-14T00:00:00Z' },
  { id: 'who', type: 'person', title: 'Alex' },
  { id: 'note', type: 'handoff', title: 'Apex handoff', body: 'Next\nRun the probe.', updated_at: '2026-10-12T00:00:00Z' },
  { id: 'run', type: 'run', title: 'Read the push', status: 'finished', is_open: false, body: '[2026-10-13T10:00:00Z] finished: all good', updated_at: '2026-10-13T10:00:00Z', created_at: '2026-10-13T09:00:00Z', props: { tokens_used: 1200, surface: 'github-actions', cost_usd: 0.25 } },
];
const OPTS = {
  scope: { repo: ['proj', 'a', 'b', 'c', 'gone', 'note', 'run'], proj: ['proj', 'a', 'b', 'c', 'gone'] },
  lives: { repo: ['proj', 'run', 'note'] },
  blocked: { b: { roots: ['who'], waits: true } },
  pushes: [{ ts: '2026-10-14T00:00:00Z', reason: '1 commit to main: Probe', detail: { branch: 'main', after: 'abcdef0123' } }, { ts: '2026-10-13T00:00:00Z', reason: 'tag', detail: { branch: '' } }],
};

test('a repository is found by its id, its GitHub name in any form, or its title, and says which there are when not', async () => {
  assert.equal(repoName('git@github.com:acme/apex.git'), 'acme/apex');
  assert.equal(repoName('https://github.com/acme/apex/tree/main'), 'acme/apex');
  const ctx = ctxOver(ITEMS, OPTS);
  for (const repo of ['repo', 'acme/apex', 'apex repo']) assert.equal((await handler['software.repo_work']({ repo }, ctx)).answer.repo.id, 'repo');
  await assert.rejects(handler['software.repo_work']({}, ctx), /repo_work needs "repo".*Repositories here: Apex repo \(repo\)/);
});

test('a repository’s work is split by what blocks it, due first, and its last push is a push to a branch', async () => {
  const { answer } = await handler['software.repo_work']({ repo: 'repo' }, ctxOver(ITEMS, OPTS));
  assert.deepEqual(answer.ready.map((i: { id: string }) => i.id), ['a', 'c'], 'what is due first, then the most recently confirmed');
  assert.deepEqual(answer.blocked.map((i: { id: string; waiting_on: string[] }) => [i.id, i.waiting_on]), [['b', ['Alex']]]);
  assert.deepEqual(answer.last_push, { at: '2026-10-14T00:00:00Z', branch: 'main', head: 'abcdef0', subject: '1 commit to main: Probe' });
});

test('a handoff counts the last week: what was settled, what opened, the pushes and what each session said as it ended', async () => {
  const { answer } = await handler['software.handoff']({ repo: 'repo' }, ctxOver(ITEMS, OPTS));
  assert.deepEqual(['note' in answer, answer.since], [false, '2026-10-09T12:00:00.000Z'], 'a week back, and a note kept as a handoff is not read');
  assert.deepEqual(answer.since_then.settled.map((i: { id: string }) => i.id), ['gone']);
  assert.deepEqual(answer.since_then.pushes.map((p: { head: string }) => p.head), ['abcdef0'], 'a tag is no push');
  assert.deepEqual(answer.since_then.sessions.map((s: { id: string; said: string }) => [s.id, s.said]), [['run', 'finished: all good']]);
  assert.deepEqual([answer.open.ready.length, answer.open.blocked[0].waiting_on], [2, ['Alex']]);
  assert.match(answer.how, /^Everything here is read off the map/);
  assert.equal(answer.unseen, undefined, 'nothing said to be unseen, no list');
  assert.equal(answer.traps, undefined, 'no instruction for files, no traps');
  const trapped = (await handler['software.handoff']({ repo: 'repo' }, ctxOver(ITEMS, { ...OPTS, traps: [{ id: 'i1', title: 'The pane cannot load draw.html', text: 'Start unsandboxed.', files: ['ui/draw.*'] }] }))).answer;
  assert.deepEqual(trapped.traps, [{ id: 'i1', title: 'The pane cannot load draw.html', files: ['ui/draw.*'] }], 'by name and files, not their words');
  // Done and not yet seen working, here and in another repository: only this one's is listed, with what would show it.
  const unseenItems = [...ITEMS, { id: 'u', type: 'task', title: 'Rules on a reply', status: 'done', is_open: false, props: { seen_working: false, to_see: 'a real session' } }, { id: 'far', type: 'task', title: 'Elsewhere', props: { seen_working: false } }, { id: 'seen', type: 'task', title: 'Seen', props: { seen_working: true } }];
  const seen = (await handler['software.handoff']({ repo: 'repo' }, ctxOver(unseenItems, { ...OPTS, scope: { ...OPTS.scope, repo: [...OPTS.scope.repo, 'u', 'seen'] } }))).answer;
  assert.deepEqual(seen.unseen, [{ id: 'u', type: 'task', title: 'Rules on a reply', status: 'done', to_see: 'a real session' }]);
  assert.equal(answer.left, undefined, 'no session said where its checkout stood, nothing left');
  // What sessions left: the newest word of each checkout, when it ended with work on no remote and no push to its branch came since.
  const git = (branch: string, worktree: string, unpushed: number, dirty = 0) => ({ branch, worktree, head: 'a'.repeat(40), unpushed, dirty });
  const runs: Item[] = [
    { id: 'wip', type: 'run', title: 'Iona', status: 'finished', is_open: false, updated_at: '2026-10-15T00:00:00Z', props: { git: git('wip', '/w/a', 2) } },
    { id: 'old', type: 'run', title: 'Jura', status: 'finished', is_open: false, updated_at: '2026-10-11T00:00:00Z', props: { git: git('wip', '/w/a', 5) } },
    { id: 'clean', type: 'run', title: 'Eigg', status: 'finished', is_open: false, updated_at: '2026-10-15T01:00:00Z', props: { git: git('main', '/w/b', 0, 0) } },
    { id: 'dirty', type: 'run', title: 'Rum', status: 'finished', is_open: false, updated_at: '2026-10-14T00:00:00Z', props: { git: git('main', '/w/b', 0, 3) } },
    { id: 'shipped', type: 'run', title: 'Coll', status: 'finished', is_open: false, updated_at: '2026-10-13T00:00:00Z', props: { git: git('main', '/w/c', 1) } },
    { id: 'busy', type: 'run', title: 'Hoy', status: 'running', is_open: true, updated_at: '2026-10-16T00:00:00Z', props: { git: git('lens', '/w/d', 4) } },
  ];
  const left = (await handler['software.handoff']({ repo: 'repo' }, ctxOver([...ITEMS, ...runs], { ...OPTS, lives: { repo: [...OPTS.lives.repo, ...runs.map((r) => r.id)] } }))).answer.left;
  assert.deepEqual(left.map((l: any) => [l.id, l.branch, l.unpushed, l.dirty, l.head]), [['wip', 'wip', 2, 0, 'aaaaaaa']], 'an older word of the same checkout, a clean one since, a push to main since and an open session are not');
});

test('a re-check gives each project that has waited its oldest items, leaving out what waits on a person', async () => {
  const ctx = ctxOver(ITEMS, OPTS);
  const due = (await handler['software.recheck']({ repo: 'repo' }, ctx)).answer;
  assert.deepEqual(due.projects.map((p: { id: string; waited: boolean; every_days: number }) => [p.id, p.waited, p.every_days]), [['proj', true, 7]]);
  assert.deepEqual(due.projects[0].items.map((i: { id: string; days: number }) => [i.id, i.days]), [['a', 45]], 'only what is older than its interval, and not what waits on someone');
  const asked = (await handler['software.recheck']({ repo: 'repo', now: true }, ctx)).answer;
  assert.deepEqual(asked.projects[0].items.map((i: { id: string }) => i.id), ['a', 'c'], 'asked for now, whatever is oldest');
  const done = ctxOver([...ITEMS.filter((i) => i.id !== 'proj'), { ...ITEMS[1], props: { recheck_days: 7, rechecked_at: '2026-10-15T00:00:00Z' } }], OPTS);
  assert.deepEqual((await handler['software.recheck']({ repo: 'repo' }, done)).answer.projects.map((p: { waited: boolean; due: boolean }) => [p.waited, p.due]), [[false, false]]);
});

test('what agents used in a repository is summed by where they ran', async () => {
  const { answer } = await handler['software.agent_usage']({ repo: 'repo' }, ctxOver(ITEMS, OPTS));
  assert.deepEqual([answer.week, answer.runs.map((r: { id: string; tokens: number }) => [r.id, r.tokens])], [{ 'github-actions': { runs: 1, tokens: 1200, cost_usd: 0.25 } }, [['run', 1200]]]);
});
