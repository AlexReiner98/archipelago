// The lenses pack run without a database: a context whose reads answer from a few items in memory. The whole of it
// against a real map is test/view-life.test.ts, test/roadmap.test.ts and test/query-saved.test.ts, through the shims.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KernelContext } from '#pelago/kernel';
import { hubs, keptOf, pictureOf } from './query-kept.ts';
import { renamedQuery } from './query-names.ts';
import { twinsOf } from './view-twins.ts';
import { moveLives } from './view-life.ts';
import { termQueries, viewQuery } from './query-saved.ts';

type Item = { id: string; type: string; title: string; is_open: boolean; updated_at: string; archived_at: string | null; props: Record<string, unknown> };
const item = (id: string, type: string, title: string, updated: string, props: Record<string, unknown> = {}, open = true): Item => ({ id, type, title, is_open: open, updated_at: `2026-11-0${updated}T00:00:00Z`, archived_at: null, props });

/** A context whose reads answer the few the lenses pack asks, from these items and links. */
function context(items: Item[], links: { type: string; from_id: string; to_id: string }[], ancestors: Record<string, { at: string; depth: number }[]> = {}): KernelContext {
  const types = new Map([['lens', { id: 'lens' }], ['style', { id: 'style' }], ['layout', { id: 'layout' }], ['task', { id: 'task' }], ['run', { id: 'run', system: true }]]);
  const registry = { types, family: (t: string) => [t], isA: (t: string, k: string) => t === k };
  const reads = async (q: Record<string, unknown>) => {
    if (q.items) {
      // Two at a time, so a read that stops at the first page is caught.
      const all = items.filter((e) => e.type === (q.items as { type: string }).type && !e.archived_at);
      const at = (q.page as { after?: string }).after ? Number((q.page as { after: string }).after) : 0;
      return { rows: all.slice(at, at + 2), ...(at + 2 < all.length && { next: String(at + 2) }) };
    }
    if (q.ids) return items.filter((e) => (q.ids as string[]).includes(e.id));
    if (q.links) {
      const { from, among, types: kinds, limit } = q.links as { from?: string[]; among?: string[]; types: string[]; limit?: number };
      const found = links.filter((r) => kinds.includes(r.type) && (!from || from.includes(r.from_id)) && (!among || (among.includes(r.from_id) && among.includes(r.to_id))));
      return limit ? found.slice(0, limit) : found;
    }
    if (q.within) return items.filter((e) => e.is_open && e.id !== (q.within as { id: string }).id).map((e) => e.id);
    if (q.ancestors) return (ancestors[(q.ancestors as string[])[0]] ?? []).map((a) => ({ id: (q.ancestors as string[])[0], ...a }));
    throw new Error(`not read here: ${Object.keys(q)[0]}`);
  };
  return { pack: { id: 'lenses', version: '0', hash: '' }, workspace: 'w', reads, registry } as unknown as KernelContext;
}

test('the views kept are read whole, oldest change first, with what each is about; one named and closed is there too', async () => {
  const items = [item('e_c', 'lens', 'C', '3'), item('e_a', 'lens', 'A', '1'), item('e_b', 'lens', 'B', '1'), item('e_d', 'lens', 'D', '2', {}, false), item('e_s', 'style', 'S', '1')];
  const ctx = context(items, [{ type: 'about', from_id: 'e_a', to_id: 'e_t' }]);
  assert.deepEqual((await keptOf(ctx, 'lens', undefined)).map((k) => [k.id, k.about]), [['e_a', ['e_t']], ['e_b', []], ['e_c', []]]);
  assert.deepEqual((await keptOf(ctx, 'lens', 'e_d')).map((k) => k.id), ['e_a', 'e_b', 'e_d', 'e_c']);
  await assert.rejects(keptOf(ctx, 'lens', 'e_never'), /No lens "e_never"/);
});

test('a hub holds as much as its nearest project says, and a lens about it is counted', async () => {
  const items = [item('e_p', 'task', 'P', '1', { hub_at: 2 }), item('e_x', 'task', 'X', '1'), item('e_y', 'task', 'Y', '1'), item('e_r', 'run', 'R', '1'), item('e_v', 'lens', 'V', '1')];
  const links = [{ type: 'part_of', from_id: 'e_x', to_id: 'e_p' }, { type: 'part_of', from_id: 'e_y', to_id: 'e_p' }, { type: 'part_of', from_id: 'e_r', to_id: 'e_p' }, { type: 'about', from_id: 'e_v', to_id: 'e_p' }];
  assert.deepEqual(await hubs(context(items, links), 'e_w'), [{ id: 'e_p', type: 'task', title: 'P', inside: 2, at: 2, views: 1 }]);
  // Above it, nothing says less than twelve.
  assert.deepEqual(await hubs(context(items.map((e) => ({ ...e, props: {} })), links), 'e_w'), []);
  await assert.rejects(hubs(context(items, links)), /across the whole map/);
});

test('a view is seen at work as itself; a style where what it is about is drawn', async () => {
  const ctx = context([item('e_v', 'lens', 'V', '1'), item('e_s', 'style', 'S', '1'), item('e_l', 'layout', 'L', '1'), item('e_t', 'task', 'T', '1')], [{ type: 'about', from_id: 'e_s', to_id: 'e_t' }]);
  assert.deepEqual([await pictureOf(ctx, 'e_v'), await pictureOf(ctx, 'e_s'), await pictureOf(ctx, 'e_l'), await pictureOf(ctx, 'e_t')], ['v?canvas=e_v', 'graph?from=e_t', 'graph?lens', undefined]);
});

test('a view made twice is named: the same name or query about the same items', async () => {
  const ctx = context([item('e_v', 'lens', 'What is left?', '1', { filter: { find: ['id e_t'] } })], [{ type: 'about', from_id: 'e_v', to_id: 'e_t' }]);
  const view = (title: string, props: Record<string, unknown>) => ({ op: 'create', ref: 'n', type: 'lens', title, props });
  const about = { op: 'link', type: 'about', from: 'n', to: 'e_t' };
  assert.match((await twinsOf(ctx, [view('Another', { filter: { find: ['id e_t'] } }), about]))[0], /"What is left\?" \(e_v\) is that view already, about the same item/);
  assert.equal((await twinsOf(ctx, [view('what is left?', { filter: { find: ['type task'] } }), about])).length, 1);
  assert.deepEqual(await twinsOf(ctx, [view('What is left?', { filter: { find: ['id e_t'] } })]), []); // of the workspace: its own
});

test('a renamed type or link is renamed in the views that name it', () => {
  assert.deepEqual(renamedQuery({ filter: { find: ['type old', 'id e_x'] } }, 'old', 'new', 'entity'), { filter: { find: ['type new', 'id e_x'] } });
  assert.deepEqual(renamedQuery({ filter: { find: ['old e_x'] }, walk: { over: ['old>'], steps: 1 } }, 'old', 'new', 'relation'), { walk: { over: ['new>'], steps: 1 }, filter: { find: ['new e_x'] } });
  assert.deepEqual(renamedQuery({ filter: { find: ['type other'] } }, 'old', 'new', 'entity'), {});
});

test('views and layouts still current take their life once, in one move: pinned or a layout kept, about what closed retired', async () => {
  const marked = [{ id: 'e_v1', type: 'lens', props: { pinned: true } }, { id: 'e_v2', type: 'lens', props: {} }, { id: 'e_v3', type: 'lens', props: {} }, { id: 'e_l1', type: 'layout', props: {} }];
  const moves: unknown[] = [];
  const base = context([item('e_done', 'task', 'Done', '1', {}, false), item('e_open', 'task', 'Open', '1')], [{ type: 'about', from_id: 'e_v2', to_id: 'e_done' }, { type: 'about', from_id: 'e_v3', to_id: 'e_open' }]);
  const ctx = {
    ...base,
    reads: async (q: Record<string, unknown>) => (q.marked ? marked : base.reads(q as never)),
    move: async (action: string, _reason: string, facts: unknown[]) => void moves.push([action, facts]),
  } as unknown as KernelContext;
  assert.deepEqual(await moveLives(ctx), { kept: 2, retired: 1, working: 1 });
  assert.deepEqual(moves, [['lens.lived', [['+', 'e_v1', 'status', 'kept'], ['+', 'e_v2', 'status', 'retired'], ['+', 'e_v3', 'status', 'working'], ['+', 'e_l1', 'status', 'kept']]]]);
});

test('a view kept in the words before its three lists is said in them, and a kept view draws what its steps name too', async () => {
  const moves: unknown[][] = [];
  const views = [{ id: 'e_old', type: 'lens', props: { filter: { ids: ['e_t'], exclude: ['closed'] } } }, { id: 'e_new', type: 'lens', props: { filter: { find: ['id e_t'] } } }];
  const ctx = { registry: { family: (t: string) => [t] }, reads: async (q: { marked: { types: string[] } }) => (q.marked.types[0] === 'lens' ? views : []), move: async (...a: unknown[]) => void moves.push(a) } as unknown as KernelContext;
  assert.equal(await termQueries(ctx), 1);
  assert.deepEqual(moves[0][2], [['+', 'e_old', 'filter', { find: ['id e_t'], only: [], not: ['done'] }]]);
  assert.deepEqual(viewQuery({ filter: { find: ['type task'] }, steps: [{ add: ['e_x'] }] }).filter, { find: ['type task', 'id e_x'] });
});
