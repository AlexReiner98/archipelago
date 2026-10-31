// The flat lens's newer terms (the query trial, 28 Oct 2026, feature e_tpz9yd7f): Find in an item, at any depth; the
// walk's ways; Only's plain words. Each is read the same by the server, the page's address and an agent.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flatLens } from '../src/lens-flat.ts';
import { Archipelago } from '../src/pelago.ts';
import { callTool } from '../src/tools.ts';
import { viewAddress } from '../src/view-address.ts';
import { agent, fresh, human, make } from './map.ts';

const titles = (answer: { items: { title: string }[] }) => answer.items.map((i) => i.title).sort();

async function project() {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'Rework' },
    { op: 'create', ref: 'f', type: 'feature', title: 'The bar' },
    { op: 'create', ref: 'a', type: 'task', title: 'Find in' },
    { op: 'create', ref: 'q', type: 'decision', title: 'Which words?' },
    { op: 'create', ref: 'x', type: 'task', title: 'Done already', status: 'done' },
    { op: 'create', ref: 'o', type: 'task', title: 'Elsewhere' },
    { op: 'link', type: 'part_of', from: 'f', to: 'p' },
    { op: 'link', type: 'part_of', from: 'a', to: 'f' },
    { op: 'link', type: 'part_of', from: 'q', to: 'f' },
    { op: 'link', type: 'part_of', from: 'x', to: 'p' },
    { op: 'link', type: 'depends_on', from: 'a', to: 'o' },
  ]);
  return { l, made };
}

test('Find in an item: all that is part of it at any depth, of any type, not the item itself', async () => {
  const { l, made } = await project();
  const answer = await flatLens(l, { filter: { find: [`in ${made.p}`] } });
  assert.deepEqual(titles(answer), ['Done already', 'Find in', 'The bar', 'Which words?']);
  assert.ok(answer.items.every((i) => 'found' in i && i.found?.includes('in')), 'each says it was found in the item');
  assert.deepEqual(titles(await flatLens(l, { filter: { find: [`in ${made.p}`], not: ['done'] } })), ['Find in', 'The bar', 'Which words?'], 'Not applies');
  assert.deepEqual(titles(await flatLens(l, { filter: { find: [`in ${made.p}`], only: ['task'] } })), ['Done already', 'Find in'], 'Only narrows it');
  assert.deepEqual(titles(await flatLens(l, { filter: { find: [`in ${made.f}`] }, walk: { over: ['depends_on'], steps: 1 } })), ['Elsewhere', 'Find in', 'Which words?'], 'and the walk goes on from it');
  const capped = await flatLens(l, { filter: { find: [`in ${made.p}`] }, limit: 2 });
  assert.deepEqual([capped.items.length, capped.cut], [2, true], 'bounded by the limit');
  assert.deepEqual(titles(await flatLens(l, { filter: { find: ['in e_nothing0'] } })), [], 'in nothing, nothing');
  assert.equal(await viewAddress(l, { lens: { filter: { find: [`in ${made.p}`] } } }), `v?find=in+${made.p}`, 'the address carries it');
  await assert.rejects(viewAddress(l, { lens: { filter: { find: ['in e_nothing0'] } } }), /No item/);
});

test('the walk follows each link out, in or either way, as it is named', async () => {
  const { l, made } = await project();
  const walk = async (from: string, over: string[] | 'all', steps = 1) => titles(await flatLens(l, { filter: { find: [`id ${from}`] }, walk: { over, steps } }));
  assert.deepEqual(await walk(made.a, ['depends_on>']), ['Elsewhere', 'Find in'], 'out: what it depends on');
  assert.deepEqual(await walk(made.o, ['depends_on>']), ['Elsewhere'], 'nothing it depends on');
  assert.deepEqual(await walk(made.o, ['depends_on<']), ['Elsewhere', 'Find in'], 'in: what depends on it');
  assert.deepEqual(await walk(made.a, ['part_of>'], 6), ['Find in', 'Rework', 'The bar'], 'part of, upward, all the way');
  assert.deepEqual(await walk(made.f, ['part_of<'], 6), ['Find in', 'The bar', 'Which words?'], 'what is in it, downward');
  assert.deepEqual(await walk(made.f, ['part_of']), ['Find in', 'Rework', 'The bar', 'Which words?'], 'either way, as a lens kept before ways were said');
  assert.deepEqual(await walk(made.a, ['part_of>', 'depends_on>'], 2), ['Elsewhere', 'Find in', 'Rework', 'The bar'], 'each link its own way');
  await assert.rejects(flatLens(l, { filter: { find: [`id ${made.a}`] }, walk: { over: ['nope>'] } }), /unknown link type "nope"/);
  assert.equal(await viewAddress(l, { lens: { filter: { find: [`id ${made.a}`] }, walk: { over: ['depends_on>', 'part_of<'], steps: 2 } } }), `v?find=id+${made.a}&over=depends_on%3E%2Cpart_of%3C&steps=2`, 'the address carries the ways');
  assert.equal(await viewAddress(l, { lens: { filter: { find: [`id ${made.a}`] }, time: { from: '-5d', to: '1d' } }, style: { shape: 'time' } }), `v?find=id+${made.a}&time=-5d%2C1d&shape=time`, 'and its window of time, as it was said');
});

test("Only's plain words: each must hold of every seed, and the walk is not narrowed", async () => {
  const { l, made } = await project();
  const me = ((await callTool(l, human, 'init', { name: 'Alex' })) as { me: string }).me;
  const more = await make(l, [
    { op: 'create', ref: 'sam', type: 'person', title: 'Sam' },
    { op: 'create', ref: 'mine', type: 'task', title: 'Mine', owner: me, status: 'doing', props: { tokens_estimated: 100, tokens_used: 500 } },
    { op: 'create', ref: 'hers', type: 'task', title: 'Sams', owner: 'sam', props: { tokens_estimated: 100, tokens_used: 50 } },
    { op: 'create', ref: 'lane', type: 'resource', title: 'Lane', status: 'unavailable' },
    { op: 'create', ref: 'live', type: 'task', title: 'Needs the lane' },
    { op: 'link', type: 'part_of', from: 'mine', to: made.p },
    { op: 'link', type: 'part_of', from: 'hers', to: made.p },
    { op: 'link', type: 'part_of', from: 'live', to: made.p },
    { op: 'link', type: 'needs', from: 'live', to: 'lane' },
  ]);
  const only = async (...words: string[]) => titles(await flatLens(l, { filter: { find: [`in ${made.p}`], only: words } }));
  assert.deepEqual(await only('done'), ['Done already']);
  assert.deepEqual(await only('blocked'), ['Find in', 'Needs the lane'], 'depends on something open, or needs a resource that is not free: as attention says it');
  assert.deepEqual(await only('status doing'), ['Mine']);
  assert.deepEqual(await only('owner me'), ['Mine']);
  assert.deepEqual(await only('owner Sam'), ['Sams'], 'a person by name');
  assert.deepEqual(await only(`owner ${more.sam}`), ['Sams'], 'or by id');
  assert.deepEqual(await only('no owner', 'task'), ['Done already', 'Find in', 'Needs the lane'], 'a word and a type together');
  assert.deepEqual(await only('over estimate'), ['Mine']);
  await l.db.query(`update entity set updated_at = now() - interval '10 days', created_at = now() - interval '10 days' where id = $1`, [made.a]);
  assert.ok(!(await only('changed since 7d')).includes('Find in') && (await only('changed since 7d')).includes('Mine'), 'changed since so many days');
  assert.ok(!(await only('made since 3d')).includes('Find in') && (await only('made since 2020-01-01')).includes('Find in'), 'made since days or a date');
  // Who last set its status: the owner, or an agent on its own judgment.
  const loose = new Archipelago(l.db, l.registry, { create: 'auto', update: 'auto', archive: 'auto', restore: 'auto', link: 'auto' });
  assert.equal((await loose.change(agent, { reason: 'test', authority: { of: 'agent', basis: 'It is done' }, ops: [{ op: 'update', id: more.hers, status: 'done' }] })).status, 'applied');
  assert.deepEqual(await only('done', 'by agent'), ['Sams']);
  assert.deepEqual(await only('done', 'by owner'), ['Done already']);
  // The walk from what Only keeps is not narrowed.
  assert.deepEqual(titles(await flatLens(l, { filter: { find: [`in ${made.f}`], only: ['blocked'] }, walk: { over: ['depends_on>'], steps: 1 } })), ['Elsewhere', 'Find in']);
  // Written wrong, a word is refused; the address carries it.
  await assert.rejects(flatLens(l, { filter: { find: [`in ${made.p}`], only: ['changed since then'] } }), /a time is/);
  await assert.rejects(flatLens(l, { filter: { find: [`in ${made.p}`], only: ['status'] } }), /needs what follows/);
  await assert.rejects(flatLens(l, { filter: { find: [`in ${made.p}`], only: ['nope'] } }), /"nope" is no term/);
  assert.equal(await viewAddress(l, { lens: { filter: { find: [`in ${made.p}`], only: ['task', 'owner me'] } } }), `v?find=in+${made.p}&only=type+task&only=owner+me`);
});

test('a name is never guessed: one item so named is answered by its id, two are refused', async () => {
  const { l, made } = await project();
  const more = await make(l, [
    { op: 'create', ref: 'u', type: 'tag', title: 'Urgent' },
    { op: 'create', ref: 'sam', type: 'person', title: 'Sam' },
    { op: 'create', ref: 'sam2', type: 'person', title: 'sam' },
    { op: 'create', ref: 'bo', type: 'person', title: 'Bo' },
    { op: 'link', type: 'tagged', from: made.a, to: 'u' },
  ]);
  await make(l, [{ op: 'update', id: made.o, owner: more.bo }]);
  const tagged = await flatLens(l, { filter: { find: ['tagged urgent'] } });
  assert.deepEqual([titles(tagged), tagged.lens.find], [['Find in'], [`tagged ${more.u}`]], 'the end named is said back by its id');
  const owned = await flatLens(l, { filter: { find: [`id ${made.o}`, `id ${made.a}`], only: ['owner Bo'] } });
  assert.deepEqual([titles(owned), owned.lens.only], [['Elsewhere'], [`owner ${more.bo}`]]);
  await make(l, [{ op: 'create', type: 'tag', title: 'URGENT' }]);
  await assert.rejects(flatLens(l, { filter: { find: ['tagged Urgent'] } }), /2 items are named "Urgent".*by its id/);
  await assert.rejects(flatLens(l, { filter: { find: [`in ${made.p}`], only: ['owner Sam'] } }), /2 items are named "Sam".*by its id/);
  assert.deepEqual(titles(await flatLens(l, { filter: { find: [`in ${made.p}`], only: [`owner ${more.sam}`] } })), [], 'by its id, the one meant');
});

test('the same terms in every part: Find adds, Only keeps, Not takes away', async () => {
  const { l, made } = await project();
  const more = await make(l, [
    { op: 'create', ref: 'ann', type: 'person', title: 'Ann' },
    { op: 'create', ref: 't', type: 'tag', title: 'Urgent' },
    { op: 'link', type: 'waits_on', from: made.a, to: 'ann' },
    { op: 'link', type: 'tagged', from: made.o, to: 't' },
    { op: 'update', id: made.o, owner: 'ann' },
  ]);
  const all = 'type task';
  assert.deepEqual(titles(await flatLens(l, { filter: { find: ['related Ann'] } })), ['Elsewhere', 'Find in'], 'related in Find: any link, the owner\'s too');
  assert.deepEqual(titles(await flatLens(l, { filter: { find: [all], only: ['related Ann'] } })), ['Elsewhere', 'Find in'], 'in Only');
  assert.ok(!titles(await flatLens(l, { filter: { find: [all], not: ['related Ann'] } })).includes('Find in'), 'in Not');
  assert.deepEqual(titles(await flatLens(l, { filter: { find: [all], only: ['tagged Urgent'] } })), ['Elsewhere'], 'a link in Only');
  assert.deepEqual(titles(await flatLens(l, { filter: { find: [all], only: ['text elsewhere'] } })), ['Elsewhere'], 'words in Only');
  assert.ok(!titles(await flatLens(l, { filter: { find: [all], not: ['text elsewhere'] } })).includes('Elsewhere'), 'words in Not');
  assert.ok(!titles(await flatLens(l, { filter: { find: [all], not: ['owner Ann'] } })).includes('Elsewhere'), 'an owner in Not');
  assert.deepEqual(titles(await flatLens(l, { filter: { find: [`id ${made.a}`, `id ${made.o}`], not: ['blocked'] } })), ['Elsewhere'], 'what can only be checked, in Not');
  await assert.rejects(flatLens(l, { filter: { find: ['done'] } }), /finds nothing itself/);
  await assert.rejects(flatLens(l, { filter: { find: ['kind work'] } }), /finds nothing itself/);
  void more;
});

test('a preview says what a term would change, reading nothing else', async () => {
  const { l, made } = await project();
  const drawn = (await flatLens(l, { filter: { find: ['type task'] } })).items.map((i) => i.id);
  const ask = (part: string, terms: string[]) => flatLens(l, { filter: { find: ['type task'] }, preview: { part, terms, ids: drawn } }) as unknown as Promise<{ preview: Record<string, string[]> }>;
  const { preview: found } = await ask('find', ['type project', `id ${made.p}`]);
  assert.deepEqual([found['type project'], found[`id ${made.p}`]], [[made.p], [made.p]], 'what it would find');
  const { preview: only } = await ask('only', ['done']);
  assert.ok(!only.done.some((id) => id === made.x) && only.done.length === drawn.length - 1, 'only says which it would leave out');
  const { preview: not } = await ask('not', ['done', 'blocked']);
  assert.deepEqual(not.done, [made.x], 'not says which it would take away');
  assert.ok(not.blocked.includes(made.a), 'one that can only be checked, too');
  assert.deepEqual((await (flatLens(l, { filter: {}, preview: { part: 'find', terms: ['type project'] } }) as unknown as Promise<{ preview: Record<string, string[]> }>)).preview['type project'], [made.p], 'an empty canvas may ask');
  await assert.rejects(flatLens(l, { filter: {}, preview: { part: 'nope', terms: [] } }), /preview\.part/);
});

test('words keep to Not, however many terms it has', async () => {
  const { l } = await project();
  await make(l, [{ op: 'create', type: 'lens', title: 'Find in a view', status: 'current', props: { filter: { find: ['type task'] } } }]);
  const titled = async (not?: string[]) => titles(await flatLens(l, { filter: { find: ['text find'], ...(not && { not }) } }));
  assert.ok(!(await titled()).includes('Find in a view'), 'the default Not leaves out what the system keeps');
  assert.ok((await titled([])).includes('Find in a view'), 'with nothing left out, it is found');
  assert.deepEqual(await titled(['kind system', 'status doing', 'done']), ['Find in'], 'three terms of Not, each a parameter of its own');
  const two = await flatLens(l, { filter: { find: ['text find', 'text already'], not: ['kind system', 'status doing'] } });
  assert.deepEqual(titles(two), ['Done already', 'Find in'], 'and with two sets of words');
});

test('Find held: the items a change held for the viewer would touch, and one step of what they are tied to', async () => {
  const { l, made } = await project();
  assert.deepEqual(titles(await flatLens(l, { filter: { find: ['held'] } })), [], 'nothing is held');
  await l.change(agent, { reason: 'Finish it', hold: true, ops: [{ op: 'update', id: made.a, status: 'done' }, { op: 'create', ref: 'n', type: 'task', title: 'Loose new' }] });
  const held = await flatLens(l, { filter: { find: ['held'] } });
  assert.deepEqual(titles(held), ['Find in'], 'the item it edits; what it would make is no item yet');
  assert.ok(held.items.every((i) => 'found' in i), 'found, so the page can say why it is there');
  assert.deepEqual(titles(await flatLens(l, { filter: { find: ['held'] }, walk: { over: 'all', steps: 1 } })), ['Elsewhere', 'Find in', 'The bar']);
  assert.deepEqual(titles(await flatLens(l, { filter: { find: [`in ${made.p}`], only: ['held'] } })), ['Find in'], 'and Only takes it as a set');
});
