// The sheet root's walled parts, without a browser or a database (task e_zhxd9bhb): what each draws from what it is
// handed, checked by the host's own mark checker, and what each gesture comes to.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-ignore: a module of the page, plain JavaScript
import { checkMarks, MARKS } from '../packs/walls/page/part-check.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import page, { along, pageMarks, pageTold } from '../packs/sheet/parts/page/index.js';
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

test('the page draws its head, note, fields and source as marks the host draws, and no history (e_de2sh7gc)', () => {
  const marks = pageMarks({ item: task, words, views: { item: { outgoing: [{ type: 'depends_on' }] }, history: { events: [{ changeset: 'c_aaaa', actor: 'agent:x', reason: 'Made', ts: '2026-11-13T10:00:00Z' }] } } }, { draft: { fields: {} }, open: new Set() });
  assert.doesNotThrow(() => checkMarks(noSlots(marks), { kinds }));
  const text = JSON.stringify(marks);
  for (const s of ['section:head', 'NOTE', 'FIELDS', 'SOURCE', 'Walk from it', 'Link']) assert.ok(text.includes(s), s);
  assert.ok(!text.includes('HISTORY') && !text.includes('c_aaaa') && !text.includes('undo:'), 'its history stays in the background: no list, no Undo');
  // Other packs' sections stand below the source (decision e_axz9au5f).
  assert.ok(text.indexOf('section:source') < text.indexOf('sheet.sections'));
});

test('a part its style folds is one quiet row, opened with a click; the note stays (page.head, fields, source)', async () => {
  const folds = ['head', 'fields', 'source'];
  const input = { item: task, words, piece: { folds }, views: { item: {} } };
  const marks = pageMarks(input, { draft: { fields: {} }, open: new Set() });
  assert.doesNotThrow(() => checkMarks(noSlots(marks), { kinds }));
  const text = JSON.stringify(marks);
  for (const part of folds) assert.ok(text.includes(`unfold:${part}`) && !text.includes(`section:${part}`), part);
  assert.ok(text.includes('section:note'), 'the note is drawn');
  // Told what the item page read of its style, the part keeps it; with none, nothing folds.
  assert.deepEqual(pageTold({}, { name: 'page', item: task, folds: ['head'] }).piece.folds, ['head']);
  assert.deepEqual(pageTold({}, { name: 'page', item: task }).piece.folds, []);
  const opened = pageMarks(input, { draft: { fields: {} }, open: new Set(['part:source']) });
  assert.ok(JSON.stringify(opened).includes('section:source'), 'opened, it is drawn whole');
});

test('a field is drawn by its kind: a pick for its values, a box for words, nothing to change for the system', () => {
  assert.equal(fieldMarks('size', 'm', words.types.task.fields.size, { writes: true })[1].kind, 'pick');
  assert.equal(fieldMarks('due', null, words.types.task.fields.due, { writes: true })[1].kind, 'date');
  assert.equal(fieldMarks('note', 'words', { type: 'string' }, { writes: true, open: true })[1].kind, 'text');
  const fields = JSON.stringify(fieldsMarks(task, words.types.task.fields, { writes: true }));
  assert.ok(!fields.includes('field:made_by'), 'a field the system keeps is only read');
  assert.ok(fields.includes('empty'), 'the fields that hold nothing are folded');
});

test('a value with parts stays one short line: entries set apart, a long set of names cut to a few', () => {
  const cell = JSON.stringify(fieldMarks('cell', [1, 0], { type: 'json' }));
  assert.ok(cell.includes('·'), '[1, 0] is not read as ten');
  const settings = Object.fromEntries(['dt', 'hud', 'bend_k', 'dim_ms', 'flow_k', 'w_flow'].map((k, i) => [k, i]));
  const line = fieldMarks('settings', settings, { type: 'json' })[2];
  assert.equal(line, 'Dt, Hud, Bend k +3');
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

test('a page opens on the band its type declares: choices, answer, measure, alert, timeline, or none', () => {
  const lw = { ...words, types: { ...words.types,
    finding: { title: 'Finding', open: ['current'], closed: ['superseded'], fields: { value: { type: 'json' }, unit: { type: 'string' }, as_of: { type: 'date' } }, capabilities: { lead: { form: 'measure', value: 'value', unit: 'unit', as_of: 'as_of' } } },
    work: { title: 'Work', open: ['todo'], closed: ['done'], fields: { seen_working: { type: 'boolean' }, to_see: { type: 'string' } }, capabilities: { lead: { form: 'alert', unless: 'seen_working', says: 'to_see' } } },
    run: { title: 'Run', open: ['running'], closed: ['finished'], fields: { story: { type: 'json' } }, capabilities: { lead: { form: 'timeline', beats: 'story' } } } } };
  const marks = (item: object) => pageMarks({ item: { ...task, ...item }, words: lw, views: {} }, { draft: { fields: {} }, open: new Set() });
  const lead = (item: object) => JSON.stringify(marks(item)).includes('"key":"lead"');
  const open = marks({ type: 'decision', is_open: true, props: { options: [{ title: 'Named', says: 'A short list' }, { title: 'Module', says: 'Code' }] } });
  assert.doesNotThrow(() => checkMarks(noSlots(open), { kinds }));
  assert.ok(JSON.stringify(open).includes('choice:1') && JSON.stringify(open).includes('A short list'), 'choices given as { title, says } are each a press, with what they mean');
  const settled = JSON.stringify(marks({ type: 'decision', status: 'decided', is_open: false, props: { options: ['A: refresh + four', 'B: refresh only'], outcome: 'A: refresh the weights' } }));
  assert.ok(settled.includes('A: refresh the weights') && settled.includes('B: refresh only') && !settled.includes('"A: refresh + four"'), 'the answer, and only the choice not taken set aside, matched by its label');
  const measured = marks({ type: 'finding', props: { value: 147, unit: 's', as_of: '2026-11-17' } });
  assert.doesNotThrow(() => checkMarks(noSlots(measured), { kinds }));
  assert.ok(JSON.stringify(measured).includes('"size":9') && !JSON.stringify(measured).includes('field-row:value'), 'the number large, and not again among the fields');
  assert.ok(lead({ type: 'work', props: { seen_working: false, to_see: 'Open the page' } }), 'built and not seen working');
  assert.ok(!lead({ type: 'work', props: { seen_working: true } }) && !lead({ type: 'work', props: {} }), 'seen, or nothing said: no band');
  const told = marks({ type: 'run', props: { story: Array.from({ length: 8 }, (_, i) => ({ n: i + 1, at: '2026-11-17T21:00:00Z', said: `Beat ${i + 1}` })) } });
  assert.doesNotThrow(() => checkMarks(noSlots(told), { kinds }));
  assert.ok(JSON.stringify(told).includes('2 earlier') && JSON.stringify(told).includes('Beat 8') && !JSON.stringify(told).includes('Beat 2"'), 'the latest beats, the rest counted');
  assert.ok(!lead({ type: 'task', props: {} }), 'a type that declares no lead opens as before');
});

test('the head is one line of marks: type, status to pick, age, who may see it; how sure only when not sure', () => {
  const line = (item: object) => (pageMarks({ item: { ...task, ...item }, words, views: {} }, { draft: { fields: {} }, open: new Set() }) as unknown[]).find((m) => Array.isArray(m) && (m[1] as { key?: string })?.key === 'section:head');
  const sure = JSON.stringify(line({ confidence: 1 }));
  assert.ok(sure.includes('head:status') && sure.includes('head:visibility') && sure.includes('"Task"'), 'type, status and who may see it, in one row');
  assert.ok(!sure.includes('sure') && !sure.includes('HEAD'), 'no heading, and how sure is not said when sure');
  assert.ok(JSON.stringify(line({ confidence: 0.6 })).includes('60% sure'));
});

test('an item that waits on the person looking says so in its band, with what for; on another, nothing', () => {
  const marks = (me: string) => JSON.stringify(pageMarks({ item: { ...task, is_open: true }, words, views: { item: { waits: [{ id: 'e_pppppppp', title: 'Alex', for: 'choosing a layout' }], me } } }, { draft: { fields: {} }, open: new Set() }));
  assert.ok(marks('e_pppppppp').includes('Waits on you') && marks('e_pppppppp').includes('choosing a layout'));
  assert.ok(!marks('e_qqqqqqqq').includes('Waits on you'), 'it waits on someone else: their wire, not a line here');
});

test('the alert\'s press makes its field true, as one change', async () => {
  const lw = { ...words, types: { ...words.types, work: { title: 'Work', open: ['todo'], closed: ['done'], fields: { seen_working: { type: 'boolean' } }, capabilities: { lead: { form: 'alert', unless: 'seen_working' } } } } };
  const w = { ...task, type: 'work', props: { seen_working: false } };
  const sent: { ops: unknown[] }[] = [];
  const p = page({ item: w, words: lw, views: {} }, { change: async (ops: unknown[]) => (sent.push({ ops }), { status: 'applied' }), keep: () => {}, state: () => {} });
  await p.on({ key: 'lead-yes', name: 'press' });
  assert.deepEqual(sent[0].ops, [{ op: 'update', id: w.id, props: { seen_working: true } }]);
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

test('the frame tells the page part the item and its links, and it draws them without being mounted again', async () => {
  const p = page({ item: { id: task.id, type: 'task' }, words, views: {} }, { change: async () => ({ status: 'applied' }), keep: () => {}, state: () => {} });
  const marks = await p.on({ name: 'page', item: task, views: { item: { outgoing: [{ type: 'depends_on', root: 'depends_on' }], source: { title: 'A talk', uri: 'https://example.com' } } } });
  const text = JSON.stringify(marks);
  for (const s of ['Try it', 'A talk', 'Walk from it']) assert.ok(text.includes(s), s);
  assert.equal(pageTold({ item: { id: 'x' } }, { name: 'scrolled' }).item.id, 'x', 'a scroll is not the page');
  assert.ok(!text.includes('field-row:status'), 'what the head says is not a field again');
});

test('what holds others walks part_of down only', () => {
  assert.deepEqual(along({ outgoing: [{ type: 'serves' }], incoming: [{ type: 'part_of', root: 'part_of' }] }), ['serves', 'part_of<']);
});

test('a refresh by the runtime keeps what the frame told of the page', async () => {
  const p = page({ item: { id: task.id, type: 'task', title: 'Old', status: 'todo' }, words, views: {} }, { change: async () => ({ status: 'applied' }), keep: () => {}, state: () => {} });
  await p.on({ name: 'page', item: { ...task, status: 'doing' }, views: { item: { outgoing: [{ type: 'depends_on' }] } } });
  const again = JSON.stringify(p.update({ item: { id: task.id, type: 'task', title: 'Old', status: 'todo' }, words, views: {}, told: { name: 'scrolled' } }));
  assert.ok(again.includes('Try it') && again.includes('doing') && again.includes('Walk from it'));
});

test('the note is marked in its author\'s voice, a person\'s or an agent\'s, and checked as marks (rule e_t9t7ag3d)', () => {
  const noteOf = (voice?: string) => {
    const marks = pageMarks({ item: task, words, views: { item: { outgoing: [], ...(voice && { voice }) } } }, { draft: { fields: {} }, open: new Set() });
    assert.doesNotThrow(() => checkMarks(noSlots(marks), { kinds }));
    const find = (m: unknown): unknown[] | undefined => (Array.isArray(m) ? (m[0] === 'note' ? m : m.map(find).find(Boolean)) : undefined);
    return (find(marks)?.[1] as { voice?: string }).voice;
  };
  assert.equal(noteOf('human'), 'human');
  assert.equal(noteOf('agent'), 'agent');
  assert.equal(noteOf(), undefined, 'with no author known, the plain face');
  assert.equal(noteOf('system'), undefined);
  assert.throws(() => checkMarks(['note', { voice: 'loud' }, 'x'], { kinds }), 'a voice is a person\'s or an agent\'s');
});
