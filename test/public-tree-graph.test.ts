// What a reader with no login gets of a published tree and a published graph (bug e_xruzayxv): the picture frozen
// when it was shared, read through the public functions alone, with every item, what holds each and every link's id,
// as on main before the kernel's views were packs. The map itself is not read as anyone: the reads a view makes of
// it (region, kinds, links) give a reader with no login nothing, as the database refused it before.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Actor } from '../packs/write/kernel/pelago.ts';
import { answerRead } from '../packs/surface/kernel/packreads.ts';
import { publicView } from '../packs/surface/kernel/public-views.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { fresh, make } from './map.ts';

type Pictured = { lenses: Record<string, { items: { id: string; inside: string | null }[]; links: { id: string; kind: string; from: string; to: string }[]; hidden?: number }> };

async function shared() {
  const l = await fresh();
  const owner: Actor = { kind: 'human', name: 'owner', admin: true };
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'aim', title: 'Ship the reader', visibility: 'shared' },
    { op: 'create', ref: 'a', type: 'task', title: 'Draw the page', visibility: 'shared' },
    { op: 'create', ref: 'b', type: 'task', title: 'Freeze the data', visibility: 'shared' },
    { op: 'create', ref: 'x', type: 'task', title: 'A private step', visibility: 'private' },
    { op: 'link', type: 'part_of', from: 'a', to: 'p' },
    { op: 'link', type: 'part_of', from: 'b', to: 'p' },
    { op: 'link', type: 'part_of', from: 'x', to: 'p' },
    { op: 'link', type: 'depends_on', from: 'a', to: 'b' },
    { op: 'link', type: 'depends_on', from: 'x', to: 'b' },
  ]);
  Object.assign(made, await make(l, [
    { op: 'create', ref: 'tree', type: 'lens', title: 'The reader, as a tree', visibility: 'shared', props: { filter: { find: [`id ${made.p}`], not: [] }, walk: { over: ['part_of<'], steps: 2 } } },
    { op: 'create', ref: 'graph', type: 'lens', title: 'What waits', visibility: 'shared', props: { filter: { find: ['type task'], not: [] }, walk: { over: [], steps: 0 } } },
  ]));
  for (const id of [made.tree, made.graph]) await callTool(l, owner, 'share_create', { id });
  return { l, made };
}

test('a published tree is read by anyone whole: its items and what holds each, nothing private', async () => {
  const { l, made } = await shared();
  const read = (await publicView(l, made.tree)) as Pictured;
  const tree = read.lenses[made.tree];
  assert.deepEqual(tree.items.map((i) => i.id).sort(), [made.p, made.a, made.b].sort());
  assert.deepEqual(Object.fromEntries(tree.items.map((i) => [i.id, i.inside])), { [made.p]: null, [made.a]: made.p, [made.b]: made.p });
  assert.equal(tree.hidden, 1, 'the private part is counted, not shown');
  assert.ok(!JSON.stringify(read).includes(made.x));
});

test('a published graph is read by anyone with every link and its id', async () => {
  const { l, made } = await shared();
  const graph = ((await publicView(l, made.graph)) as Pictured).lenses[made.graph];
  assert.deepEqual(graph.items.map((i) => i.id).sort(), [made.a, made.b].sort());
  const { rows } = await l.db.query<{ id: string }>(`select id from relation where type = 'depends_on' and from_id = $1 and to_id = $2 and valid_to is null`, [made.a, made.b]);
  assert.deepEqual(graph.links.map((k) => [k.id, k.kind, k.from, k.to]), [[rows[0].id, 'depends_on', made.a, made.b]]);
  assert.ok(!JSON.stringify(graph).includes(made.x));
});

test('anyone reads no region, kinds or links of the map itself: a picture is read only as it was published', async () => {
  const { l, made } = await shared();
  const anyone = l.forAnyone();
  await assert.rejects(answerRead(anyone, { region: { starts: [made.p], by: ['part_of'], over: null, waits: [] } }), /no login/);
  await assert.rejects(answerRead(anyone, { kinds: { types: ['task'], fold: [], by: 'part_of', over: null } }), /no login/);
  await assert.rejects(answerRead(anyone, { links: { among: [made.a, made.b] } }));
  // The one sharing reads them as before.
  const links = (await answerRead(l, { links: { among: [made.a, made.b], types: ['depends_on'] } })) as { id: string | null }[];
  assert.equal(links.length, 1);
  assert.ok(links[0].id);
});
