// The sheet root's walled parts, without a browser or a database (task e_zhxd9bhb): what each draws from what it is
// handed, checked by the host's own mark checker, and what each gesture comes to.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-ignore: a module of the page, plain JavaScript
import { checkMarks, MARKS } from '../packs/walls/page/part-check.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import page, { pageMarks } from '../packs/sheet/parts/page/index.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { fieldEvent, fieldMarks, fieldsMarks } from '../packs/sheet/parts/page/fields.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { saveOps, unsaved } from '../packs/sheet/parts/page/draft.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { linkEvent } from '../packs/sheet/parts/page/links.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import follow, { followTo } from '../packs/sheet/parts/follow/index.js';

const words = {
  types: {
    task: { title: 'Task', open: ['todo', 'doing'], closed: ['done', 'dropped'], fields: { size: { type: 'enum', values: ['s', 'm', 'l'] }, due: { type: 'date' }, tags: { type: 'json' }, note_link: { type: 'url' }, made_by: { type: 'string', system: true } } },
    decision: { title: 'Decision', open: ['open'], closed: ['decided'], fields: { options: { type: 'json' }, outcome: { type: 'string' }, rationale: { type: 'string' } }, capabilities: { settles: { choices: 'options', chosen: 'outcome', why: 'rationale' } } },
  },
  links: {},
};
const task = { id: 'e_aaaaaaaa', type: 'task', title: 'Try it', body: 'The point.\n\n- [ ] one', status: 'todo', visibility: 'private', props: { size: 'm', tags: ['x', 'y'], made_by: 'agent' }, created_at: '2026-11-13T10:00:00Z', updated_at: '2026-11-13T10:00:00Z' };

/** Marks without the slots the runtime fills, as the host's checker reads them until it draws slots. */
const noSlots = (m: unknown): unknown => (Array.isArray(m) ? (m[0] === 'slot' ? ['box'] : m.map(noSlots)) : m);
const kinds = Object.keys(MARKS);

test('the page draws its head, note, fields, source and history as marks the host draws', () => {
  const marks = pageMarks({ item: task, words, views: { item: { outgoing: [{ type: 'depends_on' }] }, history: { events: [{ changeset: 'c_aaaa', actor: 'agent:x', reason: 'Made', ts: '2026-11-13T10:00:00Z' }] } } }, { draft: { fields: {} }, open: new Set() });
  assert.doesNotThrow(() => checkMarks(noSlots(marks), { kinds }));
  const text = JSON.stringify(marks);
  for (const s of ['HEAD', 'NOTE', 'FIELDS', 'SOURCE', 'HISTORY', 'Walk from it', 'Link']) assert.ok(text.includes(s), s);
  // Other packs' sections stand below the source and above history (decision e_axz9au5f).
  assert.ok(text.indexOf('section:source') < text.indexOf('sheet.sections') && text.indexOf('sheet.sections') < text.indexOf('section:history'));
});

test('a field is drawn by its kind: a pick for its values, a box for words, nothing to change for the system', () => {
  assert.equal(fieldMarks('size', 'm', words.types.task.fields.size, { writes: true })[1].kind, 'pick');
  assert.equal(fieldMarks('due', null, words.types.task.fields.due, { writes: true })[1].kind, 'date');
  assert.equal(fieldMarks('note', 'words', { type: 'string' }, { writes: true, open: true })[1].kind, 'text');
  const fields = JSON.stringify(fieldsMarks(task, words.types.task.fields, { writes: true }));
  assert.ok(!fields.includes('field:made_by'), 'a field the system keeps is only read');
  assert.ok(fields.includes('empty'), 'the fields that hold nothing are folded');
});

test('a pick is a change at once; words wait for Save, as one update', () => {
  assert.deepEqual(fieldEvent({ key: 'field:size', name: 'pick', value: 'l' }, task, words.types.task.fields), { pick: ['size', 'l'] });
  const kept = fieldEvent({ key: 'field:tags', name: 'edit', value: '["z"]' }, task, words.types.task.fields);
  assert.deepEqual(kept, { keep: ['tags', ['z']] });
  const draft = { title: 'Tried it', body: undefined, fields: { tags: ['z'] } };
  assert.ok(unsaved(draft, task));
  assert.deepEqual(saveOps(draft, task)?.ops, [{ op: 'update', id: task.id, title: 'Tried it', props: { tags: ['z'] } }]);
  assert.equal(saveOps({ title: undefined, body: undefined, fields: {} }, task), null);
});

test('a link picked with one way is made; with more, the way is asked', () => {
  const one = linkEvent({ key: 'link-start', name: 'picked', value: { id: 'e_bbbbbbbb', title: 'B', ways: [{ type: 'depends_on', from: task.id, to: 'e_bbbbbbbb' }] } }, task, null);
  assert.deepEqual(one?.ops, [{ op: 'link', type: 'depends_on', from: task.id, to: 'e_bbbbbbbb' }]);
  const two = linkEvent({ key: 'link-name', name: 'pick', value: { id: 'e_bbbbbbbb', ways: [{ type: 'depends_on', from: task.id, to: 'e_bbbbbbbb' }, { type: 'serves', from: task.id, to: 'e_bbbbbbbb' }] } }, task, null);
  assert.equal(two?.choose?.ways.length, 2);
  assert.deepEqual(linkEvent({ key: 'link-way', name: 'pick', value: '1' }, task, two!.choose)?.ops, [{ op: 'link', type: 'serves', from: task.id, to: 'e_bbbbbbbb' }]);
});

test('settling a question by a choice: asked, then one change with what was chosen, why and its closed status', async () => {
  const q = { ...task, id: 'e_cccccccc', type: 'decision', status: 'open', is_open: true, props: { options: ['Yes', 'No'] } };
  const sent: unknown[] = [];
  const p = page({ item: q, words, views: {} }, { change: async (ops: unknown, reason: string) => (sent.push({ ops, reason }), { status: 'applied' }), keep: () => {}, state: () => {} });
  await p.on({ key: 'choice:0', name: 'press' });
  await p.on({ key: 'choice-why', name: 'edit', value: 'Because' });
  await p.on({ key: 'choice-settle', name: 'press' });
  assert.deepEqual((sent[0] as { ops: unknown[] }).ops, [{ op: 'update', id: q.id, status: 'decided', props: { outcome: 'Yes', rationale: 'Because' } }]);
});

test('Save sends the note and the fields written as one change, and lets the kept words go', async () => {
  const sent: { ops: unknown[] }[] = [];
  const keeps: unknown[] = [], states: unknown[] = [];
  const p = page({ item: task, words, views: {} }, { change: async (ops: unknown[]) => (sent.push({ ops }), { status: 'applied' }), keep: (v: unknown) => keeps.push(v), state: (_n: string, v: unknown) => states.push(v) });
  await p.on({ key: 'draft:write', name: 'press' });
  await p.on({ key: 'draft:body', name: 'edit', value: 'New words' });
  assert.equal(states.at(-1), 'unsaved');
  await p.on({ key: 'draft:save', name: 'press' });
  assert.deepEqual(sent[0].ops, [{ op: 'update', id: task.id, body: 'New words' }]);
  assert.equal(keeps.at(-1), null);
  assert.equal(states.at(-1), null);
});

test('the follow goes to the item in sight, never while it is held or words are unsaved', () => {
  assert.deepEqual(followTo({ open: 'e_aaaaaaaa', item: 'e_bbbbbbbb' }), { item: 'e_bbbbbbbb', replace: true });
  assert.equal(followTo({ open: 'e_aaaaaaaa', item: 'e_aaaaaaaa' }), null);
  assert.equal(followTo({ open: 'e_aaaaaaaa', item: 'e_bbbbbbbb', unsaved: true }), null);
  assert.equal(followTo({ open: 'e_aaaaaaaa', item: 'e_bbbbbbbb', held: true }), null);
  assert.equal(followTo({ item: 'e_bbbbbbbb' }), null);
});

test('told the page scrolled, the follow names the page', () => {
  const went: unknown[] = [];
  const f = follow({}, { go: (a: unknown) => went.push(a) });
  f.on({ name: 'scrolled', reading: { open: 'e_aaaaaaaa', item: 'e_bbbbbbbb' } });
  f.on({ name: 'press', key: 'x' });
  assert.deepEqual(went, [{ item: 'e_bbbbbbbb', replace: true }]);
});
