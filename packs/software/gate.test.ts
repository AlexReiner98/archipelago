// The gate, tested without a database: fixtures stand where the kernel answers its reads.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gate } from './gate.js';

type Item = { id: string; type: string; title: string; status?: string; is_open?: boolean; owner?: string | null; props?: Record<string, unknown> };

const LINEAGE: Record<string, string[]> = {
  'software.release': ['software.release', 'event', 'occurrence'],
  event: ['event', 'occurrence'],
  'work.project': ['work.project', 'work'],
  'software.feature': ['software.feature', 'work'],
  'work.task': ['work.task', 'work'],
  'work.decision': ['work.decision', 'question'],
  'work.note': ['work.note', 'record'],
  person: ['person', 'actor'],
};
const TYPES: Record<string, { estimated: boolean; settles: boolean; settled_by: string | null }> = {
  'work.task': { estimated: true, settles: false, settled_by: null },
  'software.feature': { estimated: true, settles: false, settled_by: null },
  'work.project': { estimated: false, settles: false, settled_by: null },
  'work.decision': { estimated: false, settles: true, settled_by: 'word' },
  'work.note': { estimated: false, settles: false, settled_by: null },
};

/** A map of items and links, read as the kernel would answer: what the lens from an item reads, links out of an item by kind (flavours included), what is part of what, and what blocks what. */
function ctxOver(items: Item[], links: [string, string, string][], blocked: Record<string, string[]> = {}, me = 'e_me') {
  const byId = new Map(items.map((e) => [e.id, { status: 'todo', is_open: true, owner: null, props: {}, ...e, is: LINEAGE[e.type] ?? [e.type] }]));
  const kinds: Record<string, string[]> = { ships: ['ships', 'software.ships'] };
  const out = (id: string, kind: string) => links.flatMap(([from, k, to], i) => (from === id && (kinds[kind] ?? [kind]).includes(k) && byId.has(to) ? [{ ...byId.get(to)!, link: `r${i}` }] : []));
  const parts = (id: string): string[] => links.filter(([, k, to]) => k === 'part_of' && to === id).flatMap(([from]) => [from, ...parts(from)]);
  return {
    read: async (q: Record<string, any>) => {
      if (q.me) return me;
      // What the lens from the event reads: here, all of the map.
      if (q.lens) return { items: [...byId.values()], links: links.map(([from, type, to], i) => ({ id: `r${i}`, type, from, to, is: type === 'software.ships' ? ['software.ships', 'ships', 'relates_to'] : [type] })) };
      if (q.parts_of) return [...new Set(q.parts_of.flatMap((id: string) => [id, ...parts(id)]))].map((id) => byId.get(id as string)!);
      if (q.get) return byId.get(q.get) ?? null;
      if (q.items) return [...byId.values()].filter((e) => e.is.includes(q.items.type));
      if (q.related) return out(q.related, q.relation);
      if (q.scope) return [q.scope, ...parts(q.scope)].map((id) => byId.get(id)!);
      if (q.type_info) return { id: q.type_info, is: LINEAGE[q.type_info], ...TYPES[q.type_info] };
      if (q.blocked) return Object.fromEntries(q.blocked.map((id: string) => [id, { blocked: Boolean(blocked[id]?.length), roots: (blocked[id] ?? []).map((r) => ({ ...byId.get(r)! })) }]));
      if (q.items === undefined && q.related === undefined) return [];
      throw new Error(`no read ${JSON.stringify(q)}`);
    },
  };
}

const MAP: Item[] = [
  { id: 'rel', type: 'software.release', title: 'First release', status: 'upcoming', props: { at: '2026-11-01' } },
  { id: 'launch', type: 'event', title: 'A launch with nothing on it' },
  { id: 'proj', type: 'work.project', title: 'Product', status: 'active' },
  { id: 'feat', type: 'software.feature', title: 'Export', status: 'building' },
  { id: 't1', type: 'work.task', title: 'Write the exporter', status: 'done', is_open: false },
  { id: 't2', type: 'work.task', title: 'Test the exporter' },
  { id: 'd1', type: 'work.decision', title: 'Which format', owner: 'e_me' },
  { id: 'loose', type: 'work.task', title: 'Fix the icon' },
  { id: 'later', type: 'work.task', title: 'Dark mode' },
  { id: 'unsorted', type: 'work.task', title: 'Write the docs' },
  { id: 'note', type: 'work.note', title: 'Notes on export' },
];
const LINKS: [string, string, string][] = [
  ['feat', 'part_of', 'proj'],
  ['t1', 'part_of', 'feat'],
  ['t2', 'part_of', 'feat'],
  ['d1', 'part_of', 'feat'],
  ['loose', 'part_of', 'proj'],
  ['later', 'part_of', 'proj'],
  ['unsorted', 'part_of', 'proj'],
  ['note', 'part_of', 'proj'],
  ['rel', 'depends_on', 'feat'],
  ['rel', 'depends_on', 'loose'],
  ['rel', 'defers', 'later'],
  ['rel', 'software.ships', 'proj'],
];

test('without an event, the gate names the open events that have one', async () => {
  const { events } = (await gate({}, ctxOver(MAP, LINKS))) as any;
  assert.deepEqual(events, [{ id: 'rel', type: 'software.release', title: 'First release', status: 'upcoming', at: '2026-11-01', holding: 2 }]);
});

test('a gate groups what it waits for by stream, with what is the owner’s, what can follow and what is not sorted', async () => {
  const answer = (await gate({ event: 'rel' }, ctxOver(MAP, LINKS, { t2: ['d1'] }))) as any;
  // The feature brings its work; the task held on its own is in the stream of the project it is part of.
  assert.deepEqual(answer.streams.map((s: any) => [s.title, s.items.map((i: any) => i.title)]), [
    ['Export', ['Test the exporter', 'Which format', 'Write the exporter']],
    ['Product', ['Fix the icon']],
  ]);
  const t2 = answer.streams[0].items[0];
  assert.equal(t2.blocked, true);
  assert.equal(t2.yours, true, 'it waits on a decision the owner settles by their word');
  assert.deepEqual(t2.waiting_on.map((w: any) => w.id), ['d1']);
  assert.equal(answer.streams[1].items[0].relation, 'r9', 'held by a link of its own: the link is given, to move it across');
  assert.deepEqual(answer.counts, { holding: 4, open: 3, yours: 2, to_sort: 1, can_follow: 1 });
  assert.deepEqual(answer.to_sort.map((x: any) => [x.id, x.stream?.id]), [['unsorted', 'proj']], 'a note is not work to sort');
  assert.deepEqual(answer.can_follow.map((x: any) => [x.id, x.relation]), [['later', 'r10']]);
  assert.equal(answer.clear, false);
  assert.equal(answer.proof, null);
});

test('the gate asks for an event', async () => {
  await assert.rejects(gate({ event: 'proj' }, ctxOver(MAP, LINKS)), /gate needs an event/);
  await assert.rejects(gate({ event: 'nope' }, ctxOver(MAP, LINKS)), /No item "nope"/);
});
