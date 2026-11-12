// The sessions pack on its context, without a database: a context whose reads answer from a few rows in memory and
// whose root services are recorded, its answers out. The whole of each against a real map is in test/ (sessions,
// touched, session-join, session-events, close-offer), through the shims at src/.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KernelContext } from '#pelago/kernel';
import { hookRunHere, isChat, sessionPrompted } from './chat-run.ts';
import { closeOffers } from './close-offer.ts';
import { unreconciled } from './reconcile.ts';
import { takeEvents } from './session-events.ts';
import { addTouched, touchedBy } from './touched.ts';

const NOW = new Date('2026-11-12T12:00:00Z');

/** A context whose reads answer from the rows given by read, and whose calls are kept; what else it asks is refused. */
function context(rows: Record<string, unknown>, called: Record<string, (input: never) => unknown> = {}) {
  const calls: [string, unknown][] = [];
  const types = new Map<string, unknown>([
    ['task', { id: 'task', lineage: ['task'], fields: { tokens_estimated: {} }, capabilities: {}, statuses: { closed: ['done'] } }],
    ['issue', { id: 'issue', lineage: ['issue'], fields: {}, capabilities: {}, statuses: { closed: ['fixed', 'wontfix'] } }],
  ]);
  const relations = new Map([['lives_in', { id: 'lives_in', to: ['*'] }], ['addresses', { id: 'addresses', offers_close: true }]]);
  const registry = { types, relations, type: (id: string) => types.get(id), isA: (t: string, k: string) => t === k, family: (t: string) => [t], relationFamily: (...r: string[]) => r };
  const reads = async (q: Record<string, unknown>) => {
    const key = Object.keys(q)[0];
    if (key in rows) return typeof rows[key] === 'function' ? (rows[key] as (v: unknown) => unknown)(q[key]) : rows[key];
    throw new Error(`not read here: ${key}`);
  };
  const call = async (name: string, input: unknown) => {
    calls.push([name, input]);
    if (name in called) return called[name](input as never);
    throw new Error(`not called here: ${name}`);
  };
  return { ctx: { pack: { id: 'sessions', version: '0', hash: '' }, workspace: 'w', reads, registry, call, now: () => NOW } as unknown as KernelContext, calls };
}

const chat = (id: string, props: Record<string, unknown>) => ({ id, type: 'run', title: id, status: 'running', is_open: true, props: { session_id: id, surface: 'claude-code', ...props } });

test('the chat a hook registered is found by its folder and branch, and the one mid-turn of several', async () => {
  const { ctx } = context({ chat_runs_since: [chat('a', { cwd: 'C:\\code\\Apex', branch: 'main' }), chat('b', { cwd: 'c:/code/apex/', branch: 'side', busy: true }), chat('c', { cwd: '/elsewhere' })] });
  assert.equal((await hookRunHere(ctx, { cwd: 'C:/code/apex', branch: 'side' }))?.id, 'b');
  assert.equal((await hookRunHere(ctx, { cwd: 'C:/code/apex' }))?.id, 'b', 'of two here, the one mid-turn');
  assert.equal(await hookRunHere(ctx, {}), undefined);
  assert.ok(!isChat({ props: { session_id: 'x', surface: 'pack:claude_code' } }), 'a launched run is the server\'s');
});

test('a prompt to an ended chat takes it up, after asking for room, as the hook\'s actor', async () => {
  const ended = { ...chat('e', {}), is_open: false, status: 'finished' };
  const { ctx, calls } = context({ run_of: ended }, { 'root.sessions': () => null, 'root.bookkeep': () => ({ created: {} }) });
  await sessionPrompted(ctx, 'e', { kind: 'agent', name: 'claude-code' });
  assert.deepEqual(calls, [
    ['root.sessions', { room: true }],
    ['root.bookkeep', { apply: { actor: 'agent:claude-code', input: { ops: [{ op: 'update', id: 'e', status: 'running' }], reason: 'Session taken up again' } } }],
  ]);
});

test('what a run touched is kept in the whole workspace\'s store, ids only, a week', async () => {
  const store = new Map<string, unknown>();
  const { ctx } = context({}, { 'root.transient': (ask: { kept?: string; keep?: { key: string; value: unknown; ms: number } }) => (ask.keep ? void store.set(ask.keep.key, ask.keep.value) : store.get(ask.kept!)) });
  await addTouched(ctx, 'e_run00001', ['e_aaaaaaaa', 'not an id', 42]);
  await addTouched(ctx, 'e_run00001', ['e_bbbbbbbb', 'e_aaaaaaaa']);
  assert.deepEqual(await touchedBy(ctx, 'e_run00001'), ['e_aaaaaaaa', 'e_bbbbbbbb']);
  assert.deepEqual(await touchedBy(ctx, 'e_other001'), []);
});

test('what a session leaves unsaid: its place\'s open work and what it touched, less what waits on a person or a change', async () => {
  const work = [
    { id: 'e_t1', type: 'task', title: 'Touched', status: 'todo' },
    { id: 'e_t2', type: 'task', title: 'Left', status: 'todo' },
    { id: 'e_t3', type: 'task', title: 'Waits', status: 'todo' },
    { id: 'e_t4', type: 'task', title: 'Held', status: 'todo' },
  ];
  const { ctx } = context(
    { links: [{ to_id: 'e_repo' }], within: ['e_t2', 'e_t3', 'e_t4'], open_work: work, blocked: { e_t3: { waits_on_someone: true } }, pending_ids: ['e_t4'], untouched: (q: { ids: string[] }) => q.ids },
    { 'root.transient': () => ['e_t1'] },
  );
  const left = await unreconciled(ctx, { id: 'e_run', created_at: NOW });
  assert.deepEqual(left, [{ id: 'e_t1', type: 'task', title: 'Touched', status: 'todo', touched: true }, { id: 'e_t2', type: 'task', title: 'Left', status: 'todo' }]);
});

test('closing a task offers to close the open issues it addresses, but not one the change already set', async () => {
  const { ctx } = context({
    ids: [{ id: 'e_task', type: 'task' }],
    offer_targets: [{ id: 'e_bug', title: 'Bug', status: 'open', type: 'issue', by: 'e_task', link: 'addresses' }, { id: 'e_other', title: 'Other', status: 'open', type: 'issue', by: 'e_task', link: 'addresses' }],
  });
  const offered = await closeOffers(ctx, [{ op: 'update', id: 'e_task', status: 'done' }, { op: 'update', id: 'e_other', status: 'wontfix' }]);
  assert.deepEqual(offered?.ops, [{ op: 'update', id: 'e_bug', status: 'fixed' }]);
  assert.equal(await closeOffers(ctx, [{ op: 'update', id: 'e_task', title: 'renamed' }] as never), undefined);
});

test('a batch of events is checked here and kept by the write path under its lock, the same ones dropped there', async () => {
  const { ctx, calls } = context({ run_of: { ...chat('s', {}), created_at: NOW } }, { 'root.bookkeep': () => 1 });
  const answer = await takeEvents(ctx, { session_id: 's', source: 'claude-code', events: [{ at: '2026-11-12T11:00:00Z', kind: 'turn.start', by: 'person' }, { kind: 'nope' }] });
  assert.equal(answer.kept, 1);
  assert.equal(answer.refused?.[0].at, 1);
  const [, ask] = calls[0] as [string, { events: { actor: string; field: string; same: string[]; values: unknown[] } }];
  assert.deepEqual([ask.events.actor, ask.events.field, ask.events.same, ask.events.values.length], ['agent:claude-code', 'event', ['at', 'kind', 'turn'], 1]);
});
