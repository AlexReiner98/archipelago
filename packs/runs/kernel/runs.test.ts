// The runs pack without a database: a context whose reads answer from a few rows in memory, its answers out. The whole
// of each against a real map is in test/ (frontier, session-state, session-measures, session-turns, places), through
// the shims at src/.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KernelContext } from '#pelago/kernel';
import { addressKey, placeFor, sameAddress } from './places.ts';
import { frontier, marks, spent, turns } from './answers.ts';
import { runSpans } from './sessiontime.ts';

const NOW = new Date('2026-11-12T12:00:00Z');
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

/** A context whose reads answer what the runs pack asks, from the rows given by read; what else it asks is refused. */
function context(rows: Record<string, unknown>, called: Record<string, unknown> = {}): KernelContext & { asked: string[] } {
  const asked: string[] = [];
  const types = new Map<string, unknown>([
    ['task', { id: 'task', lineage: ['task'], fields: {}, capabilities: { actionable: {} }, statuses: { phases: { doing: 'under_way' } } }],
    ['repo', { id: 'repo', lineage: ['repo'], fields: {}, capabilities: { where: { address: 'remote', folder: 'folder' } }, statuses: {} }],
    ['run', { id: 'run', lineage: ['run'], fields: {}, capabilities: {}, statuses: {}, system: true }],
  ]);
  const relations = new Map([['lives_in', { id: 'lives_in', to: ['*'] }]]);
  const registry = {
    types, relations, packs: [], rules: [], trees: new Map(),
    type: (id: string) => types.get(id), isA: (t: string, k: string) => t === k, family: (t: string) => [t], relationFamily: (...r: string[]) => r,
    having: () => [], ancestry: (t: string) => ({ root: t, starter: t }), capacity: () => undefined,
  };
  const reads = async (q: Record<string, unknown>) => {
    const key = Object.keys(q)[0];
    asked.push(key);
    if (key in rows) return typeof rows[key] === 'function' ? (rows[key] as (v: unknown) => unknown)(q[key]) : rows[key];
    throw new Error(`not read here: ${key}`);
  };
  const call = async (name: string) => {
    if (name in called) return called[name];
    throw new Error(`not called here: ${name}`);
  };
  return { pack: { id: 'runs', version: '0', hash: '' }, workspace: 'w', reads, registry, call, now: () => NOW, asked } as unknown as KernelContext & { asked: string[] };
}

test('an address is one key however it was written', () => {
  assert.equal(addressKey('git@github.com:Owner/Name.git'), 'github.com/owner/name');
  assert.equal(addressKey('https://github.com/owner/name/'), 'github.com/owner/name');
  assert.ok(sameAddress('ssh://git@github.com/owner/name', 'owner/name'));
  assert.ok(!sameAddress('github.com/owner/name', 'github.com/owner/other'));
});

test('a place is found by its address, else by the nearest folder holding the one given', async () => {
  const repo = (id: string, props: Record<string, unknown>) => ({ id, type: 'repo', title: id, props });
  const ctx = context({ places_of: [repo('a', { remote: 'github.com/o/a', folder: 'C:/code' }), repo('b', { folder: 'C:/code/b' })] });
  assert.equal((await placeFor(ctx, { remote: 'git@github.com:o/a.git' }))?.id, 'a');
  assert.equal((await placeFor(ctx, { cwd: 'c:\\code\\b\\src' }))?.id, 'b');
  assert.equal(await placeFor(ctx, { cwd: 'D:/elsewhere' }), undefined);
  assert.deepEqual(ctx.asked, ['places_of', 'places_of', 'places_of']);
});

test('the frontier: what earlier sessions here worked on, each with why it needs attention, said in a few words', async () => {
  const run = { id: 'r1', title: 'Before', props: { cwd: 'C:/code/b' }, created_at: ago(120), updated_at: ago(60) };
  const item = (id: string, status: string, props: Record<string, unknown> = {}) => ({ id, type: 'task', title: id.toUpperCase(), status, is_open: true, props });
  const ctx = context(
    {
      places_of: [],
      runs_lately: [run],
      worked_on: ['t1', 't2'],
      part_around: (ids: string[]) => [...ids, 't3'],
      run_items: [item('t1', 'doing'), item('t2', 'open', { seen_working: false, to_see: 'the page' }), item('t3', 'open')],
      corrections: [],
      hubs_among: [],
    },
    { 'answer.attention': { items: [{ id: 't3', type: 'task', title: 'T3', status: 'open', reasons: [{ why: 'waits_on', who: 'Alex' }] }] } },
  );
  const f = await frontier(ctx, { cwd: 'C:/code/b/.claude/worktrees/x', said: true, lines: true });
  assert.deepEqual(f.before, { sessions: 1, last: { id: 'r1', title: 'Before', at: ago(60) } });
  const why = Object.fromEntries(f.items.map((i) => [i.id, i.reasons.map((r) => r.why)]));
  assert.deepEqual(why, { t3: ['waits_on'], t1: ['left'], t2: ['unseen'] });
  assert.equal(f.items[0].reasons[0].said, 'waits on Alex');
  assert.ok(f.lines?.[1].includes('T3 (t3)'));
  assert.ok(ctx.asked.includes('corrections'), 'what the owner corrected is read');
});

test("runs' marks by run, and the order they ask for attention in", async () => {
  const row = (id: string, busy: boolean) => ({ id, status: 'running', is_open: true, created_at: ago(30), updated_at: ago(1), story: [], last_seen: ago(1).toISOString(), busy });
  const ctx = context({ run_rows: [row('a', true), row('b', false)], run_works: [], run_events: { a: [], b: [] } }, { 'answer.view_style': { style: { numbers: { quiet_after: 20 } } } });
  const m = await marks(ctx, { runs: ['a', 'b'] });
  assert.deepEqual(Object.keys(m.marks).sort(), ['a', 'b']);
  assert.equal(m.marks.a.state, 'working');
  assert.deepEqual(m.order.length, 2);
});

test("a run's turns, newest first, by its id or its session id", async () => {
  const run = { id: 'r1', title: 'A run', status: 'running', is_open: true, created_at: ago(30) };
  const ctx = context({
    run_of: (q: { key: string }) => (q.key === 'sess-1' ? run : null),
    run_events: { r1: [{ at: ago(20).toISOString(), kind: 'turn.start', turn: 't1', by: 'person' }, { at: ago(10).toISOString(), kind: 'turn.start', turn: 't2', by: 'person' }] },
  });
  const t = await turns(ctx, { run: 'sess-1' });
  assert.equal(t.run.id, 'r1');
  assert.deepEqual(t.turns.map((x: { turn: string }) => x.turn), ['t2', 't1']);
  await assert.rejects(turns(ctx, { run: 'nobody' }), /No session "nobody"/);
});

test('what agents spent, by where they ran, dollars where a run says them', async () => {
  const ctx = context({ runs_made: [{ id: 'a', props: { tokens_used: 100, cost_usd: 1.234, surface: 'x' } }, { id: 'b', props: { tokens_used: 50, surface: 'y' } }, { id: 'c', props: {} }] });
  const s = await spent(ctx, { days: 7 });
  assert.equal(s.cost_usd, 1.23);
  assert.equal(s.tokens, 150);
  assert.equal(s.unpriced_tokens, 50);
});

test('a session falls in the window where it was at work, on what it worked on', async () => {
  const run = { id: 'r1', is_open: false, props: { active: [[ago(50).toISOString(), ago(40).toISOString()]] }, created_at: ago(60), updated_at: ago(30) };
  const ctx = context({ run_tasks: [{ run: 'r1', task: 't1', valid_from: ago(55), valid_to: null }], links: [], run_signs: [] });
  const spans = await runSpans(ctx, [run], ago(120).getTime(), NOW.getTime());
  assert.deepEqual(spans.get('r1'), [{ start: ago(50).toISOString(), end: ago(40).toISOString(), by: 'when', on: 't1' }]);
});
