// The schedule that makes items for pushed commits nobody accounted for, tested without a database: fixtures stand
// where the kernel answers its reads.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from './handler.js';
import { GRACE_MINUTES, pushedBefore } from './heard.js';

type Item = { id: string; type: string; props: Record<string, unknown> };

const NOW = '2026-10-26T12:00:00.000Z';
const ago = (minutes: number) => new Date(Date.parse(NOW) - minutes * 60_000).toISOString();
const sha = (c: string) => c.repeat(40);
const pushed = (minutes: number, commits: Record<string, unknown>[], detail: Record<string, unknown> = {}) => ({
  ts: ago(minutes),
  action: 'repo.push',
  target_id: 'e_repo0001',
  detail: { branch: 'main', pusher: 'ann', commits, ...detail },
});
const commit = (c: string, subject = `Change ${c}`, more: Record<string, unknown> = {}) => ({ sha: c.repeat(7), id: sha(c), subject, author: 'Ann', url: `https://github.com/Acme/Shop/commit/${sha(c)}`, ...more });

/** What the kernel answers: the pushes heard (newest first), the commit items, their settles links, what is held. */
function ctxOver(heard: unknown[], items: Item[] = [], settles: Record<string, string[]> = {}, proposed: string[] = []) {
  const reads: Record<string, unknown>[] = [];
  return {
    reads,
    now: NOW,
    read: async (q: Record<string, any>) => {
      reads.push(q);
      if (q.events) return heard;
      if (q.items) return items.filter((e) => e.type === q.items.type && Object.entries(q.items.where ?? {}).every(([k, v]) => e.props[k] === v));
      if (q.proposed) return proposed.includes(q.proposed.props.sha);
      if (q.related) return (settles[q.related] ?? []).map((id) => ({ id }));
      throw new Error(`unexpected read ${JSON.stringify(q)}`);
    },
  };
}

test('a commit pushed past the grace period with no item is made one, accounted false, in its repository', async () => {
  const ctx = ctxOver([pushed(GRACE_MINUTES + 5, [commit('a', 'Fix the checkout', { run: 'e_run00001' })])]);
  const done = await handler['github.commits']({}, ctx);
  assert.equal(done.changes.length, 1);
  const [create, link] = done.changes[0].ops;
  assert.equal(create.type, 'commit');
  assert.equal(create.title, 'Fix the checkout');
  assert.deepEqual(create.props, { sha: sha('a'), accounted: false });
  assert.match(create.body, /by Ann, in run e_run00001/);
  assert.equal(create.source.kind, 'commit');
  assert.deepEqual(link, { op: 'link', type: 'lives_in', from: create.ref, to: 'e_repo0001' });
  assert.equal(done.changes[0].authority.of, 'agent');
  assert.equal(done.answer.made, 1);
  assert.equal(ctx.reads[0].events.action, 'repo.push');
});

test('a commit still in its grace period, or already accounted for, or held for a person, is left alone', async () => {
  const heard = [pushed(5, [commit('a')]), pushed(GRACE_MINUTES + 1, [commit('b'), commit('c')])];
  const done = await handler['github.commits']({}, ctxOver(heard, [{ id: 'e_comm0001', type: 'commit', props: { sha: sha('b') } }], {}, [sha('c')]));
  assert.deepEqual(done.changes, []);
  assert.equal(done.answer.made, 0);
});

test('each commit once, oldest push first; merges, tags, deleted branches and short ids are not commits to account for', () => {
  const heard = [
    pushed(70, [commit('b'), commit('a')]),
    pushed(80, [commit('a'), commit('m', 'Merge pull request #110 from AlexReiner98/claude/x')]),
    pushed(90, [commit('t')], { tag: 'v1' }),
    pushed(95, [commit('d')], { deleted: true }),
    pushed(99, [{ sha: 'eeeeeee', subject: 'Old push' }]),
  ];
  const owed = pushedBefore(heard, Date.parse(NOW) - GRACE_MINUTES * 60_000);
  assert.deepEqual(owed.map((c) => c.id), [sha('a'), sha('b')]);
  assert.equal(owed[0].pushed, ago(80));
});

test('a long subject is cut to a title', async () => {
  const done = await handler['github.commits']({}, ctxOver([pushed(GRACE_MINUTES + 5, [commit('a', 'x'.repeat(80))])]));
  assert.equal(done.changes[0].ops[0].title.length, 60);
});

test('a pushed commit someone has since given settles links is accounted for; one beside an accounted item is merged into it', async () => {
  const items = [
    { id: 'e_heard001', type: 'commit', props: { sha: sha('a'), accounted: false } },
    { id: 'e_heard002', type: 'commit', props: { sha: sha('b'), accounted: false } },
    { id: 'e_made0001', type: 'commit', props: { sha: sha('b') } },
    { id: 'e_heard003', type: 'commit', props: { sha: sha('c'), accounted: false } },
  ];
  const done = await handler['github.commits']({}, ctxOver([], items, { e_heard001: ['e_task0001'] }));
  assert.deepEqual(
    done.changes.map((c: { ops: unknown[] }) => c.ops),
    [[{ op: 'update', id: 'e_heard001', props: { accounted: true } }], [{ op: 'merge', keep: 'e_made0001', drop: 'e_heard002' }]],
    'the third has no links and nothing else accounts for it: it stays before the owner',
  );
  assert.equal(done.answer.tidied, 2);
});
