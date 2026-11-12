// Attention run without a database: a context whose reads answer from a few items in memory, the reasons out.
// The whole of it against a real map is test/attention.test.ts, through the shim at src/attention.ts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KernelContext } from '#pelago/kernel';
import { attention } from './attention.ts';
import { BlockGraph } from './blocks.ts';
import { contains } from './rows.ts';

const at = new Date('2026-11-01T00:00:00Z');
const item = (id: string, owner: string | null, type = 'task') => ({ id, type, title: id.toUpperCase(), status: 'open', owner, is_open: true, created_at: at, updated_at: at, archived_at: null, props: {} });
const items = new Map([item('a', 'p'), item('b', 'p'), item('c', 'q'), item('p', null, 'person')].map((e) => [e.id, e]));

/** A context whose reads answer the few the attention pack asks, from the items above. */
function context(): KernelContext & { asked: string[] } {
  const asked: string[] = [];
  const types = new Map([['task', { id: 'task', fields: {}, capabilities: { actionable: {} } }], ['person', { id: 'person', fields: {}, capabilities: {} }]]);
  const registry = {
    types, relations: new Map(), packs: [], rules: [], trees: new Map(),
    type: (id: string) => types.get(id), isA: (t: string, k: string) => t === k, family: (t: string) => [t], relationFamily: (...r: string[]) => r,
    having: (cap: string) => [...types.values()].filter((t) => cap in t.capabilities).map((t) => t.id), ancestry: (t: string) => ({ root: t, starter: t }), capacity: () => undefined,
  };
  const reads = async (q: Record<string, unknown>) => {
    const key = Object.keys(q)[0];
    asked.push(key);
    if (q.owner || q.me) return 'p';
    if (q.owned) return [items.get('a'), items.get('b')];
    if (q.ids) return (q.ids as string[]).flatMap((id) => (items.has(id) ? [items.get(id)] : []));
    if (q.links) {
      const { to, types } = q.links as { to?: string[]; types: string[] };
      return types.includes('waits_on') && (!to || to.includes('p')) ? [{ id: 'r1', type: 'waits_on', from_id: 'c', to_id: 'p', props: { for: 'a word' } }] : [];
    }
    if (q.blocks) return [{ x: 'a', y: 'b', why: 'depends_on' }];
    if (q.holds) return [];
    if (q.bounds) return { due: [{ id: 'a', type: 'task', title: 'A', status: 'open', owner: 'p', due: '2026-01-01', overdue: true }], under: [] };
    if (q.tops) return [];
    if (q.confirm) return { count: 0, on_agents_judgment: 0, on_owners_word: 0, upto: 0, questions: [] };
    throw new Error(`not read here: ${key}`);
  };
  return { pack: { id: 'attention', version: '0', hash: '' }, workspace: 'w', reads, registry, asked } as unknown as KernelContext & { asked: string[] };
}

test("a person's attention: what waits on them, what is blocked, what holds it up, what is due", async () => {
  const ctx = context();
  const answer = await attention(ctx, { person: 'me', reasons: ['waits_on', 'blocked', 'holding_up', 'due'] });
  const why = Object.fromEntries(answer.items.map((i) => [i.id, i.reasons.map((r) => r.why).sort()]));
  assert.deepEqual(why, { a: ['blocked', 'due'], b: ['holding_up'], c: ['waits_on'] });
  assert.deepEqual(answer.items.find((i) => i.id === 'c')!.reasons[0], { why: 'waits_on', who: 'P', for: 'a word' });
  assert.equal(answer.person, 'p');
  assert.ok(!ctx.asked.includes('sql'), 'every read is one the reads API answers');
});

test('for everyone across the map, only what the log answers', async () => {
  await assert.rejects(attention(context(), { reasons: ['stale'] }), /weighing every open item would read the whole map/);
});

test('a value holds another as the database says @>', () => {
  assert.ok(contains({ a: 1, b: { c: [1, 2] } }, { b: { c: [2] } }));
  assert.ok(!contains({ a: 1 }, { a: 2 }));
  assert.ok(!contains([1], { a: 1 }));
  assert.ok(contains({ tags: ['x', 'y'] }, { tags: ['y'] }));
});

test('what blocks what ends at the roots of every chain', () => {
  const g = new BlockGraph([{ x: 'a', y: 'b', why: 'depends_on' }, { x: 'b', y: 'c', why: 'needs' }, { x: 'a', y: 'd', why: 'waits_on' }]);
  assert.deepEqual(g.roots('a').sort(), ['c', 'd']);
  assert.ok(g.isBlocked('b') && !g.isBlocked('c'));
});
