// The flat lens: a filter picks the seeds, the walk goes out from them along the links named, the exclusions apply to
// everything, the limit caps it; the answer is items and links and nothing of containment, places or views.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { flatLens } from '../src/lens-flat.ts';
import { callTool } from '../src/tools.ts';
import { agent, fresh, human, make } from './map.ts';

const titles = (answer: { items: { title: string }[] }) => answer.items.map((i) => i.title).sort();

async function chain() {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'work.project', title: 'Rework' },
    { op: 'create', ref: 'a', type: 'work.task', title: 'Flat lens', body: 'A filter, a walk and a limit.' },
    { op: 'create', ref: 'b', type: 'work.task', title: 'Tags' },
    { op: 'create', ref: 'c', type: 'work.task', title: 'Query bar' },
    { op: 'create', ref: 'd', type: 'work.task', title: 'Saved canvases' },
    { op: 'create', ref: 'x', type: 'work.task', title: 'Done already', status: 'done' },
    { op: 'create', ref: 'n', type: 'work.note', title: 'A note on it' },
    { op: 'create', ref: 'bo', type: 'person', title: 'Bo' },
    { op: 'link', type: 'part_of', from: 'a', to: 'p' },
    { op: 'link', type: 'part_of', from: 'b', to: 'p' },
    { op: 'link', type: 'depends_on', from: 'b', to: 'a' },
    { op: 'link', type: 'depends_on', from: 'c', to: 'b' },
    { op: 'link', type: 'depends_on', from: 'd', to: 'c' },
    { op: 'link', type: 'depends_on', from: 'x', to: 'a' },
    { op: 'link', type: 'relates_to', from: 'n', to: 'a' },
    { op: 'link', type: 'waits_on', from: 'c', to: 'bo', props: { for: 'Choose the words' } },
  ]);
  return { l, made };
}

test('a filter that includes nothing is refused', async () => {
  const { l } = await chain();
  await assert.rejects(flatLens(l, {}), /includes something/);
  await assert.rejects(flatLens(l, { filter: { exclude: ['closed'] } }), /includes something/, 'excluding alone includes nothing');
  await assert.rejects(flatLens(l, { filter: { text: '  ' } }), /includes something/);
  await assert.rejects(flatLens(l, { filter: { types: ['no.such'] } }), /unknown type/);
  await assert.rejects(flatLens(l, { filter: { links: ['nope e_x'] } }), /unknown link type/);
  await assert.rejects(flatLens(l, { filter: { ids: ['e_x'] }, walk: { over: ['depends_on'], steps: 9 } }), /steps/);
});

test('the seeds are what any term includes: ids, text, types and links', async () => {
  const { l, made } = await chain();
  assert.deepEqual(titles(await flatLens(l, { filter: { ids: [made.a] } })), ['Flat lens']);
  assert.deepEqual(titles(await flatLens(l, { filter: { text: 'canvases' } })), ['Saved canvases']);
  assert.deepEqual(titles(await flatLens(l, { filter: { types: ['work.note'] } })), ['A note on it']);
  assert.deepEqual(titles(await flatLens(l, { filter: { links: [`part_of ${made.p}`] } })), ['Flat lens', 'Tags'], 'what is part of the project, not the project');
  assert.deepEqual(titles(await flatLens(l, { filter: { links: [{ link: 'depends_on', from: made.c }] } })), ['Tags'], 'what an item links to');
  assert.deepEqual(titles(await flatLens(l, { filter: { links: [`waits_on ${made.bo}`] } })), ['Query bar']);
  // Terms are merged: each adds its seeds.
  assert.deepEqual(titles(await flatLens(l, { filter: { ids: [made.p], text: 'canvases' } })), ['Rework', 'Saved canvases']);
});

test('the walk goes either way along the links named, for the steps asked', async () => {
  const { l, made } = await chain();
  const one = await flatLens(l, { filter: { ids: [made.b] }, walk: { over: ['depends_on'], steps: 1 } });
  assert.deepEqual(titles(one), ['Flat lens', 'Query bar', 'Tags'], 'one step out and in; what depends on what it reached is a second step');
  const two = await flatLens(l, { filter: { ids: [made.b] }, walk: { over: ['depends_on'], steps: 2 } });
  assert.deepEqual(titles(two), ['Done already', 'Flat lens', 'Query bar', 'Saved canvases', 'Tags']);
  // Every link type: the note and the project too.
  assert.deepEqual(titles(await flatLens(l, { filter: { ids: [made.a] }, walk: { over: 'all', steps: 1 } })), ['A note on it', 'Done already', 'Flat lens', 'Rework', 'Tags']);
  assert.deepEqual(titles(await flatLens(l, { filter: { ids: [made.a] }, walk: { over: [], steps: 3 } })), ['Flat lens'], 'naming no links walks nowhere');
});

test('what is excluded is left out of everything the walk reaches, and is not walked through', async () => {
  const { l, made } = await chain();
  const open = await flatLens(l, { filter: { ids: [made.a, made.x], exclude: ['closed'] }, walk: { over: ['depends_on'], steps: 1 } });
  assert.deepEqual(titles(open), ['Flat lens', 'Tags'], 'a closed seed and a closed neighbour alike');
  const noTasks = await flatLens(l, { filter: { ids: [made.n], exclude: ['work.task'] }, walk: { over: 'all', steps: 3 } });
  assert.deepEqual(titles(noTasks), ['A note on it'], 'the walk stops at the task it may not send');
});

test('the limit caps what is sent, seeds first, and says it cut', async () => {
  const { l, made } = await chain();
  const capped = await flatLens(l, { filter: { ids: [made.d] }, walk: { over: ['depends_on'], steps: 6 }, limit: 2 });
  assert.deepEqual([titles(capped), capped.cut], [['Query bar', 'Saved canvases'], true]);
  assert.equal((await flatLens(l, { filter: { ids: [made.d] }, limit: 2 })).cut, undefined);
});

test('the answer is items and links, and nothing of the old lens', async () => {
  const { l, made } = await chain();
  await make(l, [{ op: 'define_type', type: { id: 'local.thing', title: 'Thing', description: 'A thing.', extends: 'work', fields: { colour: { type: 'string', shown: true }, secret: { type: 'string' } } } }]);
  const { t } = await make(l, [{ op: 'create', ref: 't', type: 'local.thing', title: 'Red thing', props: { colour: 'red', secret: 'kept' } }, { op: 'link', type: 'relates_to', from: 't', to: made.a }]);
  const answer = await flatLens(l, { filter: { ids: [t, made.a, made.c, made.bo] } });
  assert.deepEqual(Object.keys(answer).sort(), ['items', 'lens', 'links']);
  const thing = answer.items.find((i) => i.id === t)!;
  assert.deepEqual(thing.fields, { colour: 'red' }, 'only the fields its type marks shown');
  assert.equal(answer.items.find((i) => i.id === made.a)!.body, 'A filter, a walk and a limit.');
  for (const item of answer.items) for (const gone of ['inside', 'place', 'within', 'size', 'state']) assert.ok(!(gone in item), `no ${gone}`);
  const waits = answer.links.find((k) => k.type === 'waits_on')!;
  assert.deepEqual([waits.from, waits.to, waits.props], [made.c, made.bo, { for: 'Choose the words' }]);
  assert.deepEqual(answer.links.map((k) => k.type).sort(), ['relates_to', 'waits_on'], 'every link among what is sent, and only those');
});

test('an agent asks it by name, and sees only what the viewer may', async () => {
  const { l, made } = await chain();
  const asked = (await callTool(l, agent, 'view', { name: 'flat', params: { filter: { links: [`part_of ${made.p}`] } } })) as { items: { title: string }[] };
  assert.deepEqual(titles(asked), ['Flat lens', 'Tags']);
  const { bo } = made;
  await l.as(bo).change({ kind: 'human', name: 'bo', person: bo }, { ops: [{ op: 'create', ref: 's', type: 'work.task', title: 'Bo private', visibility: 'private' }, { op: 'link', type: 'depends_on', from: 's', to: made.a }], reason: 'test' });
  const walk = { filter: { ids: [made.a] }, walk: { over: ['depends_on'], steps: 1 } };
  assert.ok(titles(await flatLens(l.as(bo), walk)).includes('Bo private'));
  assert.ok(!titles(await flatLens(l.as('e_someone'), walk)).includes('Bo private'), "someone else's private item is not reached");
  assert.ok(!titles(await flatLens(l.as('e_someone'), { filter: { text: 'Bo private' } })).includes('Bo private'), 'nor found by its text');
});

test('tags: an item is tagged with any number of tags, and the filter selects by a tag by its id or its name', async () => {
  const { l, made } = await chain();
  const tags = await make(l, [
    { op: 'create', ref: 'canvas', type: 'tag', title: 'Canvas' },
    { op: 'create', ref: 'soon', type: 'tag', title: 'Needs doing soon' },
    { op: 'link', type: 'tagged', from: made.a, to: 'canvas' },
    { op: 'link', type: 'tagged', from: made.a, to: 'soon' },
    { op: 'link', type: 'tagged', from: made.n, to: 'canvas' },
    { op: 'link', type: 'tagged', from: made.p, to: 'soon' },
  ]);
  await assert.rejects(l.change(human, { ops: [{ op: 'link', type: 'tagged', from: made.a, to: made.b }], reason: 'test' }), /tag/, 'a tag is an item of type tag');
  assert.deepEqual(titles(await flatLens(l, { filter: { links: [`tagged ${tags.canvas}`] } })), ['A note on it', 'Flat lens'], 'by its id');
  assert.deepEqual(titles(await flatLens(l, { filter: { links: ['tagged canvas'] } })), ['A note on it', 'Flat lens'], 'by its name, in any case');
  assert.deepEqual(titles(await flatLens(l, { filter: { links: ['tagged Needs doing soon'] } })), ['Flat lens', 'Rework'], 'a name of several words');
  assert.deepEqual(titles(await flatLens(l, { filter: { links: [{ link: 'tagged', from: made.a }] } })), ['Canvas', 'Needs doing soon'], 'the tags of an item');
  assert.deepEqual(titles(await flatLens(l, { filter: { links: ['tagged Flat lens'] } })), [], 'a name is looked for only among tags');
  const asked = (await callTool(l, agent, 'view', { name: 'flat', params: { filter: { links: ['tagged Canvas'], exclude: ['work.note'] } } })) as { items: { title: string }[] };
  assert.deepEqual(titles(asked), ['Flat lens']);
});

test('the text is the search read: ranked as it ranks, near-misses when nothing matches, and how many it found', async () => {
  const { l } = await chain();
  await make(l, [
    { op: 'create', type: 'work.task', title: 'Roof', body: 'The whole of it.' },
    { op: 'create', type: 'work.task', title: 'Walls', body: 'Before the roof goes on, and the roof drains.' },
    { op: 'create', type: 'work.task', title: 'A roof for the shed, and its gutters' },
  ]);
  // The newest only mentions it in its note: what has the word in its title comes first all the same.
  const roof = await flatLens(l, { filter: { text: 'roof' } });
  assert.deepEqual(roof.items.map((i) => i.title), ['Roof', 'A roof for the shed, and its gutters', 'Walls']);
  assert.equal(roof.matched, 3);
  const found = (await callTool(l, agent, 'search', { q: 'roof' })) as { title: string }[];
  assert.deepEqual(roof.items.map((i) => i.title), found.map((i) => i.title), 'in the order search gives');
  assert.deepEqual((await flatLens(l, { filter: { text: 'roof' }, limit: 1 })).matched, 3, 'counted past the limit');
  assert.deepEqual(titles(await flatLens(l, { filter: { text: 'canvasses' } })), ['Saved canvases'], 'a slip of the keys finds the near title');
  assert.deepEqual(((await callTool(l, agent, 'search', { q: 'canvasses' })) as { title: string }[]).map((i) => i.title), ['Saved canvases'], 'as search does');
  const none = await flatLens(l, { filter: { text: 'zzqx' } });
  assert.equal(none.matched, 0);
  assert.equal(none.items.length, 0);
});

test('narrowing: only and within must all hold of every seed, not of what the walk reaches', async () => {
  const { l, made } = await chain();
  const deep = await make(l, [
    { op: 'create', ref: 'f', type: 'software.feature', title: 'Canvas' },
    { op: 'create', ref: 'q', type: 'question', title: 'Which words?' },
    { op: 'create', ref: 'o', type: 'question', title: 'Elsewhere?' },
    { op: 'link', type: 'part_of', from: 'f', to: made.p },
    { op: 'link', type: 'part_of', from: 'q', to: 'f' },
    { op: 'link', type: 'depends_on', from: 'q', to: made.c },
  ]);
  // A type within an item: at any depth, and nothing of that type elsewhere.
  assert.deepEqual(titles(await flatLens(l, { filter: { types: ['question'], within: [made.p] } })), ['Which words?']);
  assert.deepEqual(titles(await flatLens(l, { filter: { types: ['work.task'], within: [made.p] } })), ['Flat lens', 'Tags'], 'not the tasks outside it');
  // Every seed is narrowed, whichever term found it; within each item named.
  assert.deepEqual(titles(await flatLens(l, { filter: { ids: [made.a, made.c, deep.q], only: ['work.task'] } })), ['Flat lens', 'Query bar']);
  assert.deepEqual(titles(await flatLens(l, { filter: { text: 'words', within: [made.p, deep.f] } })), ['Which words?']);
  assert.deepEqual(titles(await flatLens(l, { filter: { links: [`part_of ${made.p}`], only: ['software.feature'] } })), ['Canvas']);
  assert.deepEqual(titles(await flatLens(l, { filter: { types: ['question'], within: [made.a] } })), [], 'within something nothing is in');
  // The walk goes on from the narrowed seeds unnarrowed.
  assert.deepEqual(titles(await flatLens(l, { filter: { types: ['question'], within: [made.p] }, walk: { over: ['depends_on'], steps: 1 } })), ['Query bar', 'Which words?']);
  // Narrowing alone narrows nothing: refused, as including nothing is.
  await assert.rejects(flatLens(l, { filter: { within: [made.p] } }), /only and within to narrow/);
  await assert.rejects(flatLens(l, { filter: { only: ['question'], exclude: [] } }), /includes something/);
  await assert.rejects(flatLens(l, { filter: { ids: [made.a], only: ['no.such'] } }), /filter.only: unknown type/);
  const asked = (await callTool(l, agent, 'view', { name: 'flat', params: { filter: { types: ['question'], within: [deep.f] } } })) as { lens: { narrow: unknown }; items: { title: string }[] };
  assert.deepEqual([titles(asked), asked.lens.narrow], [['Which words?'], { within: [deep.f] }]);
});

test('within an item the viewer cannot see, nothing is', async () => {
  const { l, made } = await chain();
  const { bo } = made;
  const { s } = await l.as(bo).change({ kind: 'human', name: 'bo', person: bo }, { ops: [{ op: 'create', ref: 's', type: 'work.project', title: 'Bo private', visibility: 'private' }, { op: 'link', type: 'part_of', from: made.d, to: 's' }], reason: 'test' }).then((r) => (r as { created: Record<string, string> }).created);
  assert.deepEqual(titles(await flatLens(l.as(bo), { filter: { types: ['work.task'], within: [s] } })), ['Saved canvases']);
  assert.deepEqual(titles(await flatLens(l.as('e_someone'), { filter: { types: ['work.task'], within: [s] } })), [], 'what is in it is not told');
});
