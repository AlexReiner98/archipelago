// The GitHub pack's handler, tested without a database: fixtures stand where the kernel answers its reads.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from './handler.js';
import { deliveryPayload, finishedBy, repoName } from './push.js';

type Item = { id: string; type: string; title: string; is_open?: boolean; archived_at?: string | null; props?: Record<string, unknown> };
type Heard = { detail: Record<string, unknown> };

const TYPES: Record<string, { statuses: { open: string[]; closed: string[] }; settles: boolean }> = {
  'software.repo': { statuses: { open: ['active'], closed: ['archived'] }, settles: false },
  'work.task': { statuses: { open: ['todo', 'doing'], closed: ['done', 'dropped'] }, settles: false },
  'work.decision': { statuses: { open: ['open'], closed: ['decided'] }, settles: true },
};

/** What the kernel answers: the items, the pushes heard on the repository, what is already proposed. */
function ctxOver(items: Item[], heard: Heard[] = [], proposed: string[] = []) {
  const byId = new Map(items.map((e) => [e.id, { is_open: true, archived_at: null, props: {}, ...e }]));
  return {
    read: async (q: Record<string, any>) => {
      if (q.get) return byId.get(q.get) ?? null;
      if (q.items) return [...byId.values()].filter((e) => e.type === q.items.type);
      if (q.events) return heard;
      if (q.type_info) return TYPES[q.type_info] ?? null;
      if (q.proposed) return proposed.includes(q.proposed.id);
      throw new Error(`unexpected read ${JSON.stringify(q)}`);
    },
  };
}

const repo: Item = { id: 'e_repo0001', type: 'software.repo', title: 'Shop', props: { remote: 'git@github.com:Acme/Shop.git' } };
const task: Item = { id: 'e_task0001', type: 'work.task', title: 'Fix checkout' };
const other: Item = { id: 'e_task0002', type: 'work.task', title: 'Done already', is_open: false };
const question: Item = { id: 'e_dec00001', type: 'work.decision', title: 'Which card processor?' };
const push = (over: Record<string, unknown> = {}) => ({
  ref: 'refs/heads/main',
  before: 'a'.repeat(40),
  after: 'b'.repeat(40),
  repository: { full_name: 'Acme/Shop', default_branch: 'main' },
  pusher: { name: 'ann' },
  commits: [{ id: 'c'.repeat(40), message: `Fixes ${task.id}, ${other.id} and closes ${question.id}`, url: 'https://github.com/Acme/Shop/commit/ccc', author: { name: 'Ann' } }],
  ...over,
});
const deliver = (payload: unknown, headers: Record<string, string> = { 'x-github-event': 'push', 'x-github-delivery': 'd1' }) => ({ payload, headers });

test('a push to the default branch is recorded and proposes closing only the open work it says it finished', async () => {
  const done = await handler['github.push'](deliver(push()), ctxOver([repo, task, other, question]));
  assert.equal(done.log.length, 1);
  assert.equal(done.log[0].action, 'repo.push');
  assert.equal(done.log[0].target, repo.id);
  assert.match(done.log[0].reason, /^1 commit to main: Fixes/);
  assert.equal(done.log[0].detail.pusher, 'ann');
  assert.deepEqual(done.changes.map((c: { ops: unknown[] }) => c.ops), [[{ op: 'update', id: task.id, status: 'done' }]], 'not what is closed, and not a question: a commit cannot say what was decided');
  assert.deepEqual(done.changes[0].authority, { of: 'human', basis: 'Commit ccccccc by Ann says so' });
  assert.equal(done.changes[0].source.kind, 'commit');
  assert.deepEqual(done.notify, []);
  assert.equal(done.answer.recorded, true);
});

test('a push to another branch closes only what a commit names; a tag or a deletion settles nothing', async () => {
  const ctx = ctxOver([repo, task]);
  const branch = await handler['github.push'](deliver(push({ ref: 'refs/heads/wip' })), ctx);
  assert.deepEqual(branch.changes.map((c: { ops: unknown[] }) => c.ops), [[{ op: 'update', id: task.id, status: 'done' }]]);
  const unnamed = await handler['github.push'](deliver(push({ ref: 'refs/heads/wip', commits: [{ id: 'd'.repeat(40), message: 'Checkout fixed at last', author: { name: 'Ann' } }] })), ctx);
  assert.deepEqual(unnamed.changes, []);
  const tag = await handler['github.push'](deliver(push({ ref: 'refs/tags/v1', commits: [] })), ctx);
  assert.equal(tag.log[0].reason, 'tag v1 pushed');
  const gone = await handler['github.push'](deliver(push({ ref: 'refs/heads/wip', deleted: true, after: '0'.repeat(40), commits: [] })), ctx);
  assert.equal(gone.log[0].reason, 'branch wip deleted');
});

test('a delivery heard before, or the same push arriving another way, is taken in once', async () => {
  const again = await handler['github.push'](deliver(push()), ctxOver([repo, task], [{ detail: { delivery: 'd1' } }]));
  assert.equal(again.answer.reason, 'This delivery was already taken in.');
  assert.equal(again.log, undefined);
  const twice = await handler['github.push'](deliver(push(), { 'x-github-event': 'push', 'x-github-delivery': 'd2' }), ctxOver([repo, task], [{ detail: { branch: 'main', after: 'b'.repeat(40) } }]));
  assert.match(twice.answer.reason, /arrived another way too/);
});

test('a push that starts where the last one heard did not end records the gap and tells the owner', async () => {
  const done = await handler['github.push'](deliver(push()), ctxOver([repo, task], [{ detail: { branch: 'main', after: '9'.repeat(40) } }]));
  assert.deepEqual(done.log[0].detail.missed, { from: '9'.repeat(40), to: 'a'.repeat(40) });
  assert.equal(done.notify.length, 1);
  assert.match(done.notify[0].body, /git log 9999999\.\.aaaaaaa/);
  assert.equal(done.notify[0].level, 'warning');
});

test('what is already waiting to be closed is not proposed twice', async () => {
  const done = await handler['github.push'](deliver(push()), ctxOver([repo, task], [], [task.id]));
  assert.deepEqual(done.changes, []);
  assert.equal(done.answer.settled[0].result, 'already proposed');
});

test('a ping, another event, an unknown repository and a body that is not JSON are answered, not recorded', async () => {
  const ctx = ctxOver([repo]);
  assert.equal((await handler['github.push'](deliver({}, { 'x-github-event': 'ping' }), ctx)).answer.reason, 'pong');
  assert.match((await handler['github.push'](deliver({}, { 'x-github-event': 'issues' }), ctx)).answer.reason, /Only pushes/);
  assert.match((await handler['github.push'](deliver(push({ repository: { full_name: 'acme/other' } })), ctx)).answer.reason, /No repository in this map/);
  assert.match((await handler['github.push'](deliver('{not json'), ctx)).answer.reason, /not JSON/);
});

test("a form-encoded delivery is read from its payload field", () => {
  const form = `payload=${encodeURIComponent(JSON.stringify({ ref: 'refs/heads/main' }))}`;
  assert.deepEqual(deliveryPayload(form, 'application/x-www-form-urlencoded'), { ref: 'refs/heads/main' });
  assert.equal(deliveryPayload('payload=nope', 'application/x-www-form-urlencoded'), undefined);
});

test('a commit says what it finished in its own words only', () => {
  assert.deepEqual(finishedBy('Fix the cart\n\ncloses e_aaaaaaaa and e_bbbbbbbb'), ['e_aaaaaaaa', 'e_bbbbbbbb']);
  assert.deepEqual(finishedBy('This does not fix e_aaaaaaaa yet'), []);
  assert.deepEqual(finishedBy('Revert "Fixes e_aaaaaaaa"'), []);
  assert.deepEqual(finishedBy('> fixes e_aaaaaaaa\nquoted'), []);
});

test("a repository's name from any way of writing its address", () => {
  assert.equal(repoName('git@github.com:Acme/Shop.git'), 'acme/shop');
  assert.equal(repoName('https://github.com/acme/shop/tree/main'), 'acme/shop');
  assert.equal(repoName('acme/shop'), 'acme/shop');
  assert.equal(repoName('https://gitlab.com/x'), undefined);
});
