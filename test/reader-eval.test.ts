// The push reader's evaluation (scripts/reader-eval): labels read from history, a push replayed on a scripted model
// against the stand-in GitHub, and the replay scored.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commitCloses, readerLabels, rewind, settle, type Ev, type Now } from '../scripts/reader-eval/history.ts';
import { standIn } from '../scripts/reader-eval/github.ts';
import { countCalls, replay } from '../scripts/reader-eval/replay.ts';
import { choose, judge, summarise, type Fixture, type Sent } from '../scripts/reader-eval/score.ts';
import type { Answer, Params } from '../src/model.ts';

const closed = (type: string) => (type === 'work.issue' ? ['resolved', 'wontfix'] : ['done', 'dropped']);
const ev = (seq: number, ts: string, actor: string, action: string, target: string, detail: Record<string, unknown> = {}, reason?: string): Ev => ({ seq, ts, actor, action, target_id: target, detail, reason });

test('the items as they stood: what was made since is left out, what was closed or renamed since is put back', () => {
  const now: Now[] = [
    { id: 'e_a', type: 'work.task', title: 'Oil the hinge', status: 'done', created_at: '2026-10-01', archived: false },
    { id: 'e_b', type: 'work.task', title: 'Later', status: 'todo', created_at: '2026-10-21T12:00', archived: false },
    { id: 'e_c', type: 'work.issue', title: 'Squeak gone', status: 'open', created_at: '2026-10-01', archived: true },
  ];
  const events = [
    ev(1, '2026-10-21T10:00', 'human:x', 'entity.update', 'e_a', { changes: { status: { from: 'todo', to: 'done' }, title: { from: 'Oil hinge', to: 'Oil the hinge' } } }),
    ev(2, '2026-10-21T11:00', 'human:x', 'entity.archive', 'e_c'),
  ];
  assert.deepEqual(rewind(now, events, '2026-10-21T09:00', closed), [
    { id: 'e_a', type: 'work.task', title: 'Oil hinge', status: 'todo' },
    { id: 'e_c', type: 'work.issue', title: 'Squeak gone', status: 'open' },
  ]);
  assert.deepEqual(rewind(now, events, '2026-10-21T13:00', closed).map((i) => i.id), ['e_b']);
});

test('labels: the owner’s word first, then what was taken back, what is a copy, and what still stands', () => {
  const open = [{ id: 'e_a', type: 'work.task', title: 'Oil the hinge', status: 'todo' }, { id: 'e_d', type: 'work.task', title: 'Paint the door', status: 'todo' }];
  const now = new Map<string, Now>([
    ['e_a', { ...open[0], status: 'todo', created_at: '2026-10-01', archived: false }],
    ['e_d', { ...open[1], status: 'done', created_at: '2026-10-01', archived: false }],
    ['e_n', { id: 'e_n', type: 'work.task', title: 'Fit a new lock', status: 'todo', created_at: '2026-10-21', archived: false }],
  ]);
  const changes = [
    { from: 'p_1', ts: '2026-10-21T10:00', status: 'rejected' as const, ops: [{ op: 'update', id: 'e_a', status: 'doing' }] },
    { from: 'c_1', ts: '2026-10-21T10:00', status: 'applied' as const, ops: [{ op: 'update', id: 'e_a', status: 'done' }] },
    { from: 'c_2', ts: '2026-10-21T10:00', status: 'applied' as const, ops: [{ op: 'create', title: 'Oil the hinge again', made: 'e_x' }, { op: 'link' }] },
    { from: 'c_3', ts: '2026-10-21T10:00', status: 'applied' as const, ops: [{ op: 'create', title: 'Fit a new lock', made: 'e_n' }] },
    { from: 'p_2', ts: '2026-10-21T10:00', status: 'approved' as const, ops: [{ op: 'update', id: 'e_d', status: 'done' }] },
  ];
  const later = [ev(9, '2026-10-21T12:00', 'human:x', 'entity.update', 'e_a', { changes: { status: { from: 'done', to: 'todo' } } })];
  const labels = settle(readerLabels(changes, later, open, now, closed));
  assert.deepEqual(labels.map((l) => [l.change, l.item ?? l.title, l.verdict, l.basis, Boolean(l.weak)]), [
    ['status', 'e_a', 'bad', 'rejected', false],
    ['close', 'e_a', 'bad', 'taken back', false],
    ['create', 'Oil the hinge again', 'bad', 'copy of "Oil the hinge"', false],
    ['create', 'Fit a new lock', 'good', 'kept', true],
    ['close', 'e_d', 'good', 'approved', false],
  ]);
  // A close someone else made, citing a commit of the push, and that stands: one the reader should make.
  const closes = commitCloses([ev(5, '2026-10-21T11:00', 'agent:claude-code', 'entity.update', 'e_d', { changes: { status: { from: 'todo', to: 'done' } } }, 'Done in 1a2b3c4d')], ['1a2b3c4d5e6f'], open, now, closed);
  assert.deepEqual(closes, [{ change: 'close', item: 'e_d', to: 'done', verdict: 'good', basis: 'closed citing a commit of the push' }]);
});

const fixture: Fixture = {
  id: 'main@bbbbbbb',
  repo: { name: 'Acme/Tools', entity: { id: 'e_repo', title: 'Tools repo', type: 'software.repo' } },
  push: { branch: 'main', default_branch: 'main', before: 'a'.repeat(40), after: 'b'.repeat(40), ts: '2026-10-21T10:00:00Z' },
  commits: ['b'.repeat(40)],
  items: [
    { id: 'e_hinge', type: 'work.task', title: 'Oil the hinge', status: 'todo' },
    { id: 'e_door', type: 'work.task', title: 'Paint the door', status: 'todo' },
  ],
  labels: [
    { change: 'close', item: 'e_hinge', to: 'done', verdict: 'good', basis: 'approved' },
    { change: 'status', item: 'e_door', to: 'doing', verdict: 'bad', basis: 'rejected' },
  ],
};
const answers = {
  '/repos/Acme/Tools': { default_branch: 'main' },
  [`/repos/Acme/Tools/compare/${'a'.repeat(40)}...${'b'.repeat(40)}?per_page=100`]: {
    commits: [{ sha: 'b'.repeat(40), commit: { message: 'Oil the hinge (fixes the squeak)' } }],
    files: [{ filename: 'hinge.txt', status: 'modified', additions: 1, deletions: 0, patch: '+oiled' }],
  },
};

test('a push replayed on a scripted model, against the stand-in GitHub, and scored', async () => {
  const asked: Params[] = [];
  countCalls(() => async (params): Promise<Answer> => {
    asked.push(params);
    const brief = String(params.messages[0].content);
    const id = (title: string) => new RegExp(`(e_\\w+) work\\.task \\[todo\\] ${title}`).exec(brief)![1];
    const usage = { input_tokens: 1000, output_tokens: 100 };
    if (params.messages.length > 1) return { content: [{ type: 'text', text: 'Closed the hinge.' }], stop_reason: 'end_turn', usage };
    // A reader that closes by decide is answered with a quote from the push; one that closes by update, as it was.
    const close = params.tools?.some((t) => t.name === 'decide')
      ? { name: 'decide', input: { id: id('Oil the hinge'), finished: true, quote: 'Oil the hinge (fixes the squeak)', why: 'bbbbbbb oils it' } }
      : { name: 'update', input: { id: id('Oil the hinge'), status: 'done', why: 'bbbbbbb oils it' } };
    return {
      content: [
        { type: 'tool_use', id: 't1', ...close },
        { type: 'tool_use', id: 't2', name: 'update', input: { id: id('Paint the door'), status: 'doing', why: 'near it' } },
        { type: 'tool_use', id: 't3', name: 'create', input: { type: 'work.task', title: 'Oil the hinge', why: 'a copy' } },
      ],
      stop_reason: 'tool_use',
      usage,
    };
  });
  const github = standIn(answers);
  const judged = (sent: Sent[]) => judge(fixture, sent, closed);
  const done = await replay(fixture, { model: 'scripted', provider: 'anthropic', key: 'k', price: { input: 1, output: 5 }, currency: 'USD' }, github);
  assert.equal(done.ok, true, done.summary);
  assert.match(String(asked[0].messages[0].content), /Oil the hinge \(fixes the squeak\)[\s\S]*\+oiled[\s\S]*Open items of this repository \(2\)/);
  assert.equal(asked[0].model, 'scripted');
  assert.deepEqual(done.usage, { input: 2000, output: 200, cache_read: 0, cache_write: 0 });
  assert.equal(done.usd, (2000 * 1 + 200 * 5) / 1e6);
  // The reader pack refuses what the push does not show (a start) and a copy of an open item: only the close is held.
  assert.deepEqual(done.sent, [{ op: 'update', id: 'e_hinge', status: 'done' }]);
  assert.deepEqual([judged(done.sent).good, judged(done.sent).bad, judged(done.sent).closes], [1, 0, { due: 1, made: 1 }]);
  // What it would have been scored had it sent them: the start refused, the copy a copy.
  const all = judged([...done.sent, { op: 'update', id: 'e_door', status: 'doing' }, { op: 'create', title: 'Oil the hinge' }]);
  assert.deepEqual([all.good, all.bad, all.unjudged, all.copies], [1, 2, 0, 1]);
  // Not recorded and not allowed online: said as GitHub would, as an error the model reads.
  await assert.rejects(github.asInstallation('eval', '/repos/Acme/Tools/commits/abc'), /was not recorded/);
});

test('the default is the cheapest model close to the best; the fallback the next', () => {
  const tally = (model: string, good: number, bad: number, usd: number) => summarise({ model, currency: 'USD', runs: 10, failed: 0, good, bad, unjudged: 0, copies: 0, closes: { due: 4, made: 4 }, closesAll: { due: 4, made: 4 }, tokens: 0, usd, ms: 0 });
  const small = tally('small', 5, 5, 0.01);
  const mid = tally('mid', 9, 0, 0.1);
  const large = tally('large', 10, 0, 1);
  const chosen = choose([large, small, mid]);
  assert.equal(chosen.default?.model, 'mid');
  assert.equal(chosen.fallback?.model, 'large');
  assert.match(chosen.why, /^mid is the cheapest whose quality/);
});

test('candidates: Scaleway by name or as a spread, priced in euros; one without a key is skipped and said', async () => {
  const { candidate, expand } = await import('../scripts/reader-eval/candidates.ts');
  assert.deepEqual(expand('none,scaleway').slice(0, 3), ['none', 'scw:mistral-small-3.2-24b-instruct-2506', 'scw:gpt-oss-120b']);
  assert.match(String(candidate('scw:gpt-oss-120b', {}, 'x.env')), /^gpt-oss-120b: no key \(set SCW_SECRET_KEY, or put it in x\.env\)$/);
  assert.deepEqual(candidate('scw:gpt-oss-120b', { SCW_SECRET_KEY: 's' }, ''), { model: 'gpt-oss-120b', provider: 'compatible', price: { input: 0.15, output: 0.6 }, currency: 'EUR', key: 's', url: 'https://api.scaleway.ai/v1' });
  assert.match(String(candidate('scw:some-new-model', { SCW_SECRET_KEY: 's' }, '')), /no price known/);
  assert.match(String(candidate('opus', {}, 'x.env')), /^claude-opus-5-5: no key \(set ANTHROPIC_API_KEY/);
  assert.throws(() => candidate('gpt-9', {}, ''), /is no candidate/);
});

test('no fallback is named that does no good: the best of the rest, or none', () => {
  const tally = (model: string, good: number, bad: number, made: number, usd: number) => summarise({ model, currency: 'EUR', runs: 10, failed: 0, good, bad, unjudged: 0, copies: 0, closes: { due: 8, made }, closesAll: { due: 8, made }, tokens: 0, usd, ms: 0 });
  const chosen = choose([tally('big', 5, 0, 5, 1), tally('tiny', 0, 1, 0, 0.01), tally('mid', 1, 0, 1, 0.2)]);
  assert.deepEqual([chosen.default?.model, chosen.fallback?.model], ['big', 'mid']);
  assert.match(chosen.why, /mid .* is the best of the rest/);
  assert.equal(choose([tally('big', 5, 0, 5, 1), tally('tiny', 0, 1, 0, 0.01)]).fallback, undefined);
});

test('a close the reader made that someone else later confirmed, and that still stands, is right; one nobody touched stays weak', () => {
  const open = [{ id: 'e_a', type: 'work.task', title: 'Serve the site', status: 'doing' }, { id: 'e_b', type: 'work.task', title: 'Rank search', status: 'todo' }];
  const now = new Map<string, Now>(open.map((i) => [i.id, { ...i, status: 'done', created_at: '2026-10-01', archived: false }]));
  const changes = [{ from: 'c_1', ts: '2026-10-21T10:00', status: 'applied' as const, ops: [{ op: 'update', id: 'e_a', status: 'done' }, { op: 'update', id: 'e_b', status: 'done' }] }];
  const later = [ev(9, '2026-10-21T12:00', 'agent:claude-code', 'entity.update', 'e_a', { changes: {} })];
  assert.deepEqual(readerLabels(changes, later, open, now, closed).map((l) => [l.item, l.verdict, l.basis, Boolean(l.weak)]), [
    ['e_a', 'good', 'confirmed by agent:claude-code', false],
    ['e_b', 'good', 'kept', true],
  ]);
});
