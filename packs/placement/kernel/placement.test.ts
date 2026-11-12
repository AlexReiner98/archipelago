// Placement run without a database: a context whose reads answer from a few items and links in memory, the ops out.
// The whole of it against a real map is test/subject.test.ts and test/island-items.test.ts, through the shims.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KernelContext } from '#pelago/kernel';
import { placeOnIslands } from './island-place.ts';
import type { Op, Reg, Type } from './ops.ts';
import { placeWithSubject, subjectRefusals } from './subject.ts';

const item = (id: string, type: string, props: Record<string, unknown> = {}, visibility = 'shared') => ({ id, type, title: id.toUpperCase(), visibility, archived_at: null, props });
const items = new Map([item('i1', 'island', { pack: 'work' }), item('t1', 'task', { island: 'i1' }, 'private'), item('a1', 'automation', { island: 'i1' })].map((e) => [e.id, e]));
const links = [{ id: 'r1', type: 'about', from_id: 'a1', to_id: 't1' }];

const types = new Map<string, Type>([
  ['island', { id: 'island', pack: 'core', system: false, lineage: ['island'], capabilities: {} }],
  ['task', { id: 'task', pack: 'work', system: false, lineage: ['task'], capabilities: {} }],
  ['automation', { id: 'automation', pack: 'core', system: false, lineage: ['automation'], capabilities: { subject: { link: 'about' } } }],
]);
const reg = (onIslands = true): Reg => ({
  onIslands, types, relations: new Map([['about', { id: 'about' }], ['part_of', { id: 'part_of' }]]), packs: [{ id: 'core', shared: ['automation'] }],
  type: (id) => types.get(id), isA: (t, k) => t === k, relationFamily: (...r) => r,
});

/** A context whose reads answer the few the placement pack asks, from the items and links above. */
function context(): KernelContext {
  const reads = async (q: Record<string, unknown>) => {
    if (q.ids) return (q.ids as string[]).flatMap((id) => (items.has(id) ? [items.get(id)] : []));
    if (q.links) { const { from, types: kinds } = q.links as { from?: string[]; types: string[] }; return links.filter((l) => kinds.includes(l.type) && (!from || from.includes(l.from_id))); }
    if (q.items) return { rows: [...items.values()].filter((e) => e.type === (q.items as { type: string }).type) };
    throw new Error(`not read here: ${Object.keys(q)[0]}`);
  };
  return { pack: { id: 'placement', version: '0', hash: '' }, workspace: 'w', reads } as unknown as KernelContext;
}

test('an item that lives with its subject takes its island and visibility', async () => {
  const ops: Op[] = [{ op: 'create', ref: 'a', type: 'automation', title: 'A' }, { op: 'link', type: 'about', from: 'a', to: 't1' }];
  await placeWithSubject(context(), reg(), ops);
  assert.deepEqual(ops[0], { op: 'create', ref: 'a', type: 'automation', title: 'A', visibility: 'private', props: { island: 'i1' } });
});

test('one made with no subject, or the last tie taken away, is refused', async () => {
  const none = await subjectRefusals(context(), reg(), [{ op: 'create', ref: 'a', type: 'automation', title: 'A' }]);
  assert.match(none[0], /lives with what it is about: give it a ref/);
  const cut = await subjectRefusals(context(), reg(), [{ op: 'unlink', relation: 'r1' }]);
  assert.match(cut[0], /"A1" lives with what it is about/);
  assert.deepEqual(await subjectRefusals(context(), reg(), [{ op: 'unlink', relation: 'r1' }, { op: 'archive', id: 'a1' }]), []);
});

test('a new item naming no island goes to what it is part of, else the lone island it fits', async () => {
  const tied: Op[] = [{ op: 'create', ref: 'x', type: 'task', title: 'X' }, { op: 'link', type: 'part_of', from: 'x', to: 't1' }];
  await placeOnIslands(context(), reg(), tied);
  assert.equal((tied[0] as { props?: { island?: string } }).props?.island, 'i1');
  const alone: Op[] = [{ op: 'create', type: 'task', title: 'Y' }];
  await placeOnIslands(context(), reg(), alone);
  assert.equal((alone[0] as { props?: { island?: string } }).props?.island, 'i1');
  const off: Op[] = [{ op: 'create', type: 'task', title: 'Z' }];
  await placeOnIslands(context(), reg(false), off);
  assert.equal((off[0] as { props?: unknown }).props, undefined);
});
