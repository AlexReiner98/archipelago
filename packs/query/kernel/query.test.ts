// The query pack run without a database: its modules read no map, so input in, answer out. Against a real map:
// test/layouts-sent.test.ts, through the shims in src/ (an altitude is the loader's: test/altitude.test.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readSteps, stepIds, stepsShown, stepsWrong } from './query-steps.ts';
import { countBy, summed } from './summary.ts';
import { flat, flatCheck } from './answers.ts';
import type { KernelContext } from '#pelago/kernel';

test('what changed is summed: few enough given whole, else counted with the newest', () => {
  assert.deepEqual(summed([1, 2], String), { newest: [1, 2] });
  const many = ['a', 'b', 'a', 'c', 'a', 'b', 'a'];
  assert.deepEqual(summed(many, (x) => x, 3), { counts: { a: 4, b: 2, c: 1 }, newest: ['a', 'b', 'a'], more: 4 });
  assert.deepEqual(Object.keys(countBy(many, (x) => x)), ['a', 'b', 'c'], 'the most first');
});

test("a lens's steps are checked, name their items, and show a reader only what the picture does", () => {
  const steps = readSteps([{ add: ['a', 'b'], titles: { c: 'Then' }, lit: [['a', 'b']] }, { remove: ['b'], card: { title: 'End' } }]);
  assert.deepEqual(stepIds(steps).sort(), ['a', 'b', 'c']);
  assert.match(stepsWrong([{ add: 'a' }])!, /add and remove are lists of ids/);
  assert.equal(stepsWrong(steps), undefined);
  assert.deepEqual(stepsShown(steps, new Set(['a'])), [{ add: ['a'], titles: {}, lit: [] }, { card: { title: 'End' }, remove: [] }]);
});

/** A context whose map holds one type, one link type and the term near, its reads answered from what it is given. */
function fake(answer: (q: Record<string, unknown>) => unknown = () => undefined) {
  const asked: Record<string, unknown>[] = [];
  const types = new Map([['task', { id: 'task', lineage: ['task'], fields: {}, statuses: {} }]]);
  const relations = new Map([['part_of', { id: 'part_of', from: ['*'], to: ['*'] }]]);
  const registry = { types, relations, canonical: (x: string) => x, type: (id: string) => types.get(id), isA: () => false, family: (t: string) => [t], relationFamily: (...r: string[]) => r };
  // What other packs answer by name: the sessions on an item (the runs pack's answer.sessions_on), one on e_a.
  const call = async (name: string) => (name === 'answer.sessions_on' ? { on: { e_a: [{ run: 'e_r', state: 'working', hue: '#2f5fb3' }] } } : {});
  const ctx = { registry, provided: () => ['near'], call, reads: async (q: Record<string, unknown>) => (asked.push(q), answer(q)) } as unknown as KernelContext;
  return { ctx, asked };
}

test('a lens is checked by reading it, nothing asked of the map; the check says what is wrong', async () => {
  const { ctx, asked } = fake();
  assert.deepEqual(await flatCheck(ctx, { filter: { find: ['type task'], only: ['near x'] }, walk: { over: ['part_of<'] }, limit: 50 }), {});
  assert.deepEqual(asked, [], 'a check reads nothing');
  assert.match((await flatCheck(ctx, { filter: { find: ['type task'], only: ['far x'] } })).problem!, /"far x" is no term/);
  assert.match((await flatCheck(ctx, { filter: { find: ['type task'] }, limit: 9000 })).problem!, /from 1 to 2000/);
  assert.match((await flatCheck(ctx, { filter: { only: ['done'] } })).problem!, /for only to narrow/);
});

test('the flat lens by name reads its seeds through the reads API as the asker, and counts no use of a view', async () => {
  const row = { id: 'e_a', type: 'task', title: 'A', body: '', visibility: 'shared', status: 'todo', is_open: true, owner: null, props: {}, created_at: new Date(0), updated_at: new Date(0) };
  const { ctx, asked } = fake((q) => (q.me ? null : q.flat ? { items: [row], links: [], whole: [], found: { e_a: ['type'] }, terms: { e_a: ['type task'] }, step: {}, on_islands: false, islands: [] } : undefined));
  const answer = (await flat(ctx, { filter: { find: ['type task'] } })) as { lens: { not: string[] }; items: { id: string; found: string[]; sessions?: { run: string }[] }[] };
  assert.deepEqual(answer.items.map((i) => [i.id, i.found]), [['e_a', ['type']]]);
  assert.deepEqual(answer.items[0].sessions?.map((s) => s.run), ['e_r'], 'the sessions on an item ride on it, a mark every drawing is handed');
  assert.deepEqual(answer.lens.not, ['kind system'], 'the default Not');
  assert.ok(asked.every((q) => q.view === undefined), 'no view is asked, so no use is counted');
  const seeds = asked.find((q) => q.flat)!.flat as { find: { as: string }[]; said_not: boolean; limit: number };
  assert.deepEqual([seeds.find.map((t) => t.as), seeds.said_not, seeds.limit], [['type task'], false, 500]);
});

test('an island reaches the flat answer whole: a field set at the source arrives, its decl folded into its pack', async () => {
  const row = { id: 'e_a', type: 'task', title: 'A', body: '', visibility: 'shared', status: 'todo', is_open: true, owner: null, props: { island: 'e_i' }, created_at: new Date(0), updated_at: new Date(0) };
  const island = { id: 'e_i', title: 'Isle', pack: 'design', focus: true, packs_off: ['design'], decl: { state: 'off', requires: [] } };
  const { ctx } = fake((q) => (q.me ? null : q.flat ? { items: [row], links: [], whole: [], found: { e_a: ['type'] }, terms: { e_a: ['type task'] }, step: {}, on_islands: true, islands: [island] } : undefined));
  (ctx.registry as unknown as { packs: unknown[] }).packs = [];
  const answer = (await flat(ctx, { filter: { find: ['type task'] } })) as { islands: Record<string, unknown>[] };
  assert.deepEqual(answer.islands, [{ id: 'e_i', title: 'Isle', focus: true, packs_off: ['design'], pack: { id: 'design', title: 'design', types: [], links: [], state: 'off', requires: [] } }]);
});
