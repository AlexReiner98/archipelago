// A band's one likely press (task e_mgu5nw8b): on a person, Light them (what waits on them, drawn on the canvas); on an
// aim nothing serves, Add work (named in place, one change on the person's word). Each at the end of the line it acts
// on, and only one in sight. Input in, marks and what a press comes to out.
import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { leadMarks, pressEvent } from '../packs/sheet/parts/page/lead.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { checkMarks } from '../packs/walls/page/part-check.js';

type Marks = unknown[] | null;
const said = (m: unknown) => JSON.stringify(m);
const valid = (m: Marks) => assert.doesNotThrow(() => checkMarks(m), said(m));
/** Every mark under one, depth first. */
const all = (m: unknown): unknown[][] => (Array.isArray(m) && typeof m[0] === 'string' ? [m as unknown[], ...m.slice(2).flatMap(all)] : []);
const keyed = (m: Marks, key: string) => all(m).filter((x) => (x[1] as { key?: string })?.key === key);

const person = { capabilities: { lead: { form: 'actor', link: 'waits_on' } } };
const aim = { capabilities: { lead: { form: 'aim', link: 'serves' } } };
const words = { types: { 'build.lane': { of: 'work', title: 'Lane', fields: { tokens_estimated: { type: 'number' } } }, work: { title: 'Work', capabilities: { plannable: true } }, task: { of: 'work', title: 'Task', fields: { tokens_estimated: { type: 'number' } } }, aim: { title: 'Aim', capabilities: aim.capabilities } } };
const ties = (type: string, ...open: boolean[]) => open.map((o, i) => ({ type, root: type, id: `e_tie0000${i}`, title: `T${i}`, open: o }));

test('a person: Light them at the end of the count, lighting what waits on them while pointed at', () => {
  const m = leadMarks({ id: 'e_p', props: {} }, person, null, { links: ties('waits_on', true, false, true) });
  valid(m);
  const [box] = keyed(m, 'lead-press');
  assert.ok(box, said(m));
  const [press] = keyed(m, 'lead-light');
  assert.equal(press[2], 'Light them');
  assert.deepEqual((press[1] as { lights: string[] }).lights, ['e_tie00000', 'e_tie00002'], 'the open ones');
  assert.match(said((m as unknown[])[2]), /lead-figure.*lead-light/, 'on the line it acts on');
  // Pressed, the canvas draws the person and what waits on them, still open.
  const p = pressEvent({ key: 'lead-light', name: 'press' }, { id: 'e_p' }, person, {});
  assert.deepEqual(p.go.query.filter.find, ['id e_p', 'waits_on e_p']);
  assert.ok(p.go.query.filter.not.includes('done'));
  assert.equal(p.ops, undefined, 'moving the canvas changes nothing on the map');
});

test('a person no open thing waits on has no band, and so no press', () => {
  assert.equal(leadMarks({ id: 'e_p', props: {} }, person, null, { links: ties('waits_on', false) }), null);
});

test('an aim nothing serves: Add work, for a person who may write', () => {
  const m = leadMarks({ id: 'e_a', props: {} }, aim, null, { writes: true, links: [], words });
  valid(m);
  assert.match(said(m), /Nothing serves it yet.*lead-add/);
  assert.equal(keyed(m, 'lead-press').length, 1);
  assert.equal(keyed(leadMarks({ id: 'e_a', props: {} }, aim, null, { links: [], words }), 'lead-add').length, 0, 'not for a reader');
  assert.equal(keyed(leadMarks({ id: 'e_a', props: {} }, aim, null, { writes: true, links: ties('serves', true), words }), 'lead-add').length, 0, 'not once work serves it');
});

test('Add work names the work in place, then makes it serve the aim in one change', () => {
  const item = { id: 'e_a', title: 'Recover', props: { island: 'e_i' } };
  assert.deepEqual(pressEvent({ key: 'lead-add', name: 'press' }, item, aim, { words }), { adding: '' });
  const asking = leadMarks(item, aim, null, { writes: true, links: [], words, adding: 'Undo a change' });
  valid(asking);
  assert.equal(keyed(asking, 'lead-add-title').length, 1);
  assert.equal(keyed(asking, 'lead-add').length, 0, 'the press gives way to the words');
  assert.ok((asking as unknown[]).length - 2 <= 3, 'still three lines at most');
  assert.deepEqual(pressEvent({ key: 'lead-add-title', name: 'edit', value: 'Undo a change' }, item, aim, { words, adding: '' }), { adding: 'Undo a change' });
  assert.deepEqual(pressEvent({ key: 'lead-add-go', name: 'press' }, item, aim, { words, adding: '  ' }), { adding: '  ' }, 'nothing named, nothing made');
  const made = pressEvent({ key: 'lead-add-go', name: 'press' }, item, aim, { words, adding: 'Undo a change' });
  assert.deepEqual(made.ops, [
    { op: 'create', ref: 'work', type: 'task', title: 'Undo a change', props: { island: 'e_i' } },
    { op: 'link', type: 'serves', from: 'work', to: 'e_a' },
  ]);
  assert.equal(pressEvent({ key: 'lead-add-title', name: 'submit', value: 'Undo it' }, item, aim, { words, adding: 'Undo it' }).ops[0].title, 'Undo it');
  assert.deepEqual(pressEvent({ key: 'lead-add-cancel', name: 'press' }, item, aim, { words, adding: 'x' }), { adding: undefined });
});

test("work added to an aim is of the aim's own pack, so its island speaks it", () => {
  const made = pressEvent({ key: 'lead-add-go', name: 'press' }, { id: 'e_a', type: 'aim', props: {} }, aim, { words, adding: 'Undo it' });
  assert.equal(made.ops[0].type, 'task', "core's aim gets core's task, never another pack's lane");
  const lane = pressEvent({ key: 'lead-add-go', name: 'press' }, { id: 'e_a', type: 'build.goal', props: {} }, aim, { words, adding: 'Undo it' });
  assert.equal(lane.ops[0].type, 'build.lane');
});

test("a press is only its own form's: another type's band answers nothing to it", () => {
  assert.equal(pressEvent({ key: 'lead-light', name: 'press' }, { id: 'e_a' }, aim, {}), null);
  assert.equal(pressEvent({ key: 'lead-add', name: 'press' }, { id: 'e_p' }, person, {}), null);
  assert.equal(pressEvent({ key: 'walk', name: 'press' }, { id: 'e_p' }, person, {}), null);
});
