// An item lives on one island (src/island-items.ts, task e_xgpnmgp6): on a map with islands on, every item but the
// kernel's own and actors names its island, its type is the island's pack's or of the shared set, and no link joins
// two islands. The query term `island <island>` is what lives on one. With islands off, nothing changes.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDb } from '../src/db.ts';
import { Registry } from '../src/packs.ts';
import { setIslands } from '../src/packstate.ts';
import { Archipelago, type Op } from '../src/pelago.ts';
import { linkOnLegend, typeOnLegend } from '../src/island-items.ts';
import { flatRead } from '../src/query-flat.ts';
import { syncTypes } from '../src/typetable.ts';
import { human, make } from './map.ts';

/** A pack of the island shape: one type of its own on work, a link type marked crosses (a stand-in for core's reading of a finding), and an instruction. */
const pack = (id: string) => ({
  id, version: '1', title: id, requires: ['core'],
  types: [{ id: `${id}_thing`, title: 'Thing', extends: 'work' }],
  links: [{ id: `${id}_reads`, extends: 'uses', crosses: true, title: 'reads', inverse: 'is read by', from: ['*'], to: ['*'], description: 'Relies on it, from any island.' }],
  styles: [{ id: `${id}.tending`, type: 'instruction', title: 'Tending', body: 'Keep things true.', props: {} }],
});

async function islandMap(on = true) {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-island-items-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), dir, { recursive: true });
  for (const id of ['plain', 'other']) (mkdirSync(join(dir, id)), writeFileSync(join(dir, id, 'pack.json'), JSON.stringify(pack(id))));
  const l = new Archipelago(await openDb(), new Registry(dir));
  await syncTypes(l);
  if (on) await setIslands(l, human, true);
  return l;
}

const refused = (l: Archipelago, ops: Op[], said: RegExp) => assert.rejects(l.change(human, { reason: 'test', ops }), said);
const titles = (answer: { items: { title: string }[] }) => answer.items.map((i) => i.title).sort();

test('an item names its island, and its type is the island’s pack’s or of the shared set', async () => {
  const l = await islandMap();
  const { a, b, c } = await make(l, [
    { op: 'create', ref: 'a', type: 'island', title: 'Billing', props: { pack: 'plain' } },
    { op: 'create', ref: 'b', type: 'island', title: 'Hiring', props: { pack: 'other' } },
    { op: 'create', ref: 'c', type: 'island', title: 'Plans', props: { pack: 'core' } },
  ]);
  assert.equal((await l.entity(a))!.props.pack, 'plain', 'an island is the kernel’s own: it lives on none');
  await refused(l, [{ op: 'create', type: 'plain_thing', title: 'Nowhere' }], /a plain_thing lives on an island here: name it in props\.island/);
  await refused(l, [{ op: 'create', type: 'plain_thing', title: 'Abroad', props: { island: b } }], /plain_thing is plain’s, and the island .* speaks other/);
  await refused(l, [{ op: 'create', type: 'event', title: 'Not shared', props: { island: a } }], /event is core’s/);
  await refused(l, [{ op: 'create', type: 'plain_thing', title: 'On a task', props: { island: 'e_nothere' } }], /"e_nothere" is no island/);
  await refused(l, [{ op: 'create', type: 'island', title: 'Of nothing', props: { pack: 'nope' } }], /an island speaks a pack active here/);
  const { t, s, g, p } = await make(l, [
    { op: 'create', ref: 't', type: 'plain_thing', title: 'Invoice run', props: { island: a } },
    { op: 'create', ref: 's', type: 'task', title: 'Shared task', props: { island: b } },
    { op: 'create', ref: 'g', type: 'event', title: 'Core event', props: { island: c } },
    { op: 'create', ref: 'p', type: 'person', title: 'Ann' },
  ]);
  assert.equal((await l.entity(t))!.props.island, a);
  assert.ok(s && g, 'a shared type lives on any island; a core island speaks core');
  await make(l, [{ op: 'update', id: t, owner: p }]); // an actor is linked from any island
  await refused(l, [{ op: 'update', id: a, props: { pack: 'other' } }], /an island’s pack is fixed once it is made/);
  await refused(l, [{ op: 'update', id: t, props: { island: null } }], /lives on an island here/);
});

test('no link joins items on two islands, by link, move or merge', async () => {
  const l = await islandMap();
  const { a, b, a2 } = await make(l, [
    { op: 'create', ref: 'a', type: 'island', title: 'Billing', props: { pack: 'plain' } },
    { op: 'create', ref: 'a2', type: 'island', title: 'Billing again', props: { pack: 'plain' } },
    { op: 'create', ref: 'b', type: 'island', title: 'Hiring', props: { pack: 'other' } },
  ]);
  const { x, y, z } = await make(l, [
    { op: 'create', ref: 'x', type: 'task', title: 'Here', props: { island: a } },
    { op: 'create', ref: 'y', type: 'task', title: 'There', props: { island: b } },
    { op: 'create', ref: 'z', type: 'task', title: 'Beside', props: { island: a } },
    { op: 'link', type: 'depends_on', from: 'x', to: 'z' },
  ]);
  await refused(l, [{ op: 'link', type: 'depends_on', from: x, to: y }], /lives on the island .* no link joins two islands; publish a finding instead/);
  await refused(l, [{ op: 'create', ref: 'n', type: 'task', title: 'New', props: { island: b } }, { op: 'link', type: 'depends_on', from: 'n', to: x }], /no link joins two islands/);
  await refused(l, [{ op: 'merge', keep: x, drop: y }], /no link joins two islands/);
  await refused(l, [{ op: 'update', id: z, props: { island: a2 } }], /no link joins two islands/);
  await make(l, [{ op: 'link', type: 'plain_reads', from: x, to: y }]); // a link type marked crosses joins two islands
  await make(l, [{ op: 'link', type: 'about', from: x, to: a }]); // the island itself is on none: a view's or a note’s about it may be
  await make(l, [{ op: 'unlink', relation: (await l.db.query<{ id: string }>(`select id from relation where from_id = $1 and to_id = $2`, [x, z])).rows[0].id }, { op: 'update', id: z, props: { island: a2 } }]);
  assert.equal((await l.entity(z))!.props.island, a2, 'with nothing tying it, an item moves');
});

test('an island made in the same change is named {ref}, and linked items move together (issue e_cctzam6z)', async () => {
  const l = await islandMap();
  await refused(l, [{ op: 'create', ref: 'h', type: 'island', title: 'Billing', props: { pack: 'plain' } }, { op: 'create', type: 'task', title: 'Bare', props: { island: 'h' } }], /names the island made in this change as \{h\}, not h/);
  const { h, t } = await make(l, [
    { op: 'create', ref: 'h', type: 'island', title: 'Billing', props: { pack: 'plain' } },
    { op: 'create', ref: 't', type: 'task', title: 'Braced', props: { island: '{h}' } },
  ]);
  assert.equal((await l.entity(t))!.props.island, h, 'kept as the island’s id');
  const { a, b } = await make(l, [
    { op: 'create', ref: 'a', type: 'island', title: 'From', props: { pack: 'plain' } },
    { op: 'create', ref: 'b', type: 'island', title: 'To', props: { pack: 'plain' } },
  ]);
  const { x, y, z, w } = await make(l, [
    { op: 'create', ref: 'x', type: 'task', title: 'One', props: { island: a } },
    { op: 'create', ref: 'y', type: 'task', title: 'Two', props: { island: a } },
    { op: 'create', ref: 'z', type: 'task', title: 'Three', props: { island: a } },
    { op: 'create', ref: 'w', type: 'task', title: 'Stays', props: { island: a } },
    { op: 'link', type: 'depends_on', from: 'x', to: 'y' },
    { op: 'link', type: 'depends_on', from: 'y', to: 'z' },
    { op: 'link', type: 'depends_on', from: 'z', to: 'w' },
  ]);
  await refused(l, [{ op: 'update', id: x, props: { island: b } }, { op: 'update', id: y, props: { island: b } }, { op: 'update', id: z, props: { island: b } }], /"Three" lives on the island .* and "Stays"/);
  await make(l, [{ op: 'update', id: w, props: { island: b } }, { op: 'update', id: x, props: { island: b } }, { op: 'update', id: y, props: { island: b } }, { op: 'update', id: z, props: { island: b } }]);
  for (const id of [x, y, z, w]) assert.equal((await l.entity(id))!.props.island, b, 'moved together, ties and all');
  const { n } = await make(l, [{ op: 'create', ref: 'n', type: 'island', title: 'New', props: { pack: 'plain' } }, { op: 'update', id: x, props: { island: '{n}' } }, { op: 'update', id: y, props: { island: '{n}' } }, { op: 'unlink', relation: (await l.db.query<{ id: string }>(`select id from relation where from_id = $1 and to_id = $2`, [y, z])).rows[0].id }]);
  assert.equal((await l.entity(y))!.props.island, n, 'onto an island made in the same change');
});

test('the term island <island> is what lives on it, by id or name', async () => {
  const l = await islandMap();
  const { a, b } = await make(l, [
    { op: 'create', ref: 'a', type: 'island', title: 'Billing', props: { pack: 'plain' } },
    { op: 'create', ref: 'b', type: 'island', title: 'Hiring', props: { pack: 'other' } },
  ]);
  await make(l, [
    { op: 'create', type: 'plain_thing', title: 'Invoice run', props: { island: a } },
    { op: 'create', type: 'task', title: 'Pay the rent', props: { island: a } },
    { op: 'create', type: 'other_thing', title: 'Interview', props: { island: b } },
    { op: 'create', type: 'task', title: 'Billing', props: { island: b } }, // shares the island's name: the term reads islands only
  ]);
  assert.deepEqual(titles(await flatRead(l, { filter: { find: [`island ${a}`] } })), ['Invoice run', 'Pay the rent']);
  assert.deepEqual(titles(await flatRead(l, { filter: { find: ['island Billing'] } })), ['Invoice run', 'Pay the rent'], 'by its name');
  assert.deepEqual(titles(await flatRead(l, { filter: { find: [`island ${a}`, `island ${b}`] } })), ['Billing', 'Interview', 'Invoice run', 'Pay the rent'], 'a view of several');
  assert.deepEqual(titles(await flatRead(l, { filter: { find: ['task'], only: [`island ${b}`] } })), ['Billing'], 'in Only');
  assert.deepEqual(titles(await flatRead(l, { filter: { find: ['task'], not: [`island ${b}`] } })), ['Pay the rent'], 'and in Not');
  // The answer hands on where each lives and each island's name, for a drawing to draw their borders (task e_auw7hb3v).
  const both = await flatRead(l, { filter: { find: [`island ${a}`, `island ${b}`] } });
  assert.deepEqual(Object.fromEntries(both.items.map((i) => [i.title, i.island])), { Billing: b, Interview: b, 'Invoice run': a, 'Pay the rent': a });
  assert.deepEqual([...(both.islands ?? [])].sort((p, q) => p.title!.localeCompare(q.title!)).map(({ id, title }) => ({ id, title })), [{ id: a, title: 'Billing' }, { id: b, title: 'Hiring' }]);
  assert.ok(!('fields' in both.items[0] && 'island' in (both.items[0].fields ?? {})), 'kept on the item, not among its shown fields');
});

test('with islands off, nothing is asked and no item has an island', async () => {
  const l = await islandMap(false);
  await make(l, [{ op: 'create', type: 'plain_thing', title: 'Anywhere' }]);
  await refused(l, [{ op: 'create', type: 'task', title: 'Placed', props: { island: 'e_whatever' } }], /task has no field "island"/);
});

test('a flat answer says the pack each island speaks, and all of its vocabulary', async () => {
  const l = await islandMap();
  const { a } = await make(l, [{ op: 'create', ref: 'a', type: 'island', title: 'Billing', props: { pack: 'plain' } }]);
  await make(l, [{ op: 'create', type: 'plain_thing', title: 'Invoice run', props: { island: a } }]);
  const answer = await flatRead(l, { filter: { find: [`island ${a}`] } });
  const pack = answer.islands?.find((i: { id: string }) => i.id === a)?.pack;
  assert.equal(pack?.id, 'plain');
  assert.ok(pack.types.some((t: { id: string }) => t.id === 'plain_thing'), 'its own types');
  assert.ok(!pack.types.some((t: { id: string }) => t.id === 'task'), 'and none of another pack’s');
});

test('a flat answer names, after its pack, every other type and link type in use on the island (the owner, 7 Nov 2026)', async () => {
  const l = await islandMap();
  const { a } = await make(l, [{ op: 'create', ref: 'a', type: 'island', title: 'Billing', props: { pack: 'plain' } }]);
  const { t, p } = await make(l, [
    { op: 'create', ref: 'p', type: 'plain_thing', title: 'Invoice run', props: { island: a } },
    { op: 'create', ref: 't', type: 'task', title: 'Send the invoices', props: { island: a } },
  ]);
  await make(l, [{ op: 'link', type: 'depends_on', from: t, to: p }]);
  const pack = (await flatRead(l, { filter: { find: [`island ${a}`] } })).islands?.find((i: { id: string }) => i.id === a)?.pack;
  assert.ok(pack, 'the island says its pack');
  const types = pack.types.map((x: { id: string }) => x.id), links = pack.links.map((x: { id: string }) => x.id);
  assert.equal(types[0], 'plain_thing', 'its pack’s own come first');
  assert.ok(types.includes('task'), `core’s task, in use on it: ${types.join(', ')}`);
  assert.ok(!types.includes('decision'), 'what no item on it is, is not named');
  assert.ok(links.includes('depends_on'), `the link in use within it: ${links.join(', ')}`);
});

test("core's legend on an island is task, decision, finding and event, and the links an island's work is drawn with", () => {
  const reg = new Registry(join(import.meta.dirname, '..', 'packs'));
  const types = [...reg.types.values()].filter((t) => t.pack === 'core' && typeOnLegend(t)).map((t) => t.id).sort();
  const links = [...reg.relations.values()].filter((r) => r.pack === 'core' && linkOnLegend(r)).map((r) => r.id).sort();
  assert.deepEqual(types, ['decision', 'event', 'finding', 'task']);
  assert.deepEqual(links, ['about', 'bears_on', 'depends_on', 'involves', 'link', 'lives_in', 'needs', 'owned_by', 'part_of', 'produced', 'reads', 'serves', 'uses', 'waits_on']);
});
