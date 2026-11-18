// The band an item's page opens on, in the minimal shape (decision e_65cnpc2b): three lines at most, nothing the
// title and marks already say, and no band at all when there is nothing to add. Input in, marks out.
import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { leadEvent, leadFields, leadMarks } from '../packs/sheet/parts/page/lead.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { checkMarks } from '../packs/walls/page/part-check.js';

type Marks = unknown[] | null;
const said = (m: Marks) => JSON.stringify(m);
/** The lines of a band: the marks its box holds. */
const lines = (m: Marks) => (m ? (m as unknown[]).slice(2) : []);
const valid = (m: Marks) => assert.doesNotThrow(() => checkMarks(m), said(m));

const work = { capabilities: { lead: { form: 'done', link: 'part_of', unless: 'seen_working', says: 'to_see' } } };
const ties = (type: string, ...open: boolean[]) => open.map((o, i) => ({ type, root: type, title: `T${i}`, open: o }));

test('a type that says none, or holds nothing to add, opens with no band', () => {
  assert.equal(leadMarks({ id: 'e_1', props: {} }, { capabilities: { lead: 'none' } }, null), null);
  assert.equal(leadMarks({ id: 'e_1', props: { seen_working: true } }, work, null, { links: [] }), null, 'no parts and seen working');
  assert.equal(leadMarks({ id: 'e_1', props: {} }, { capabilities: { lead: { form: 'actor', link: 'waits_on' } } }, null, { links: ties('waits_on', false) }), null, 'nothing open waits on them');
});

test("work's done: its parts as a count and a bar, then whether it is seen working, with the press at the line's end", () => {
  const m = leadMarks({ id: 'e_1', props: { seen_working: false, to_see: 'Open a sheet' } }, work, null, { writes: true, links: [...ties('part_of', false, false, true), ...ties('depends_on', false)] });
  valid(m);
  assert.equal(lines(m).length, 2);
  assert.match(said(m), /2 of 3 done/);
  assert.match(said(m), /"key":"lead-bar"/);
  assert.match(said(m), /Not yet seen working/);
  assert.match(said(m), /"key":"lead-yes"/);
  assert.deepEqual(leadEvent({ key: 'lead-yes', name: 'press' }, { id: 'e_1' }, work)?.ops, [{ op: 'update', id: 'e_1', props: { seen_working: true } }]);
  assert.deepEqual(leadFields({ props: { seen_working: false } }, work, null), ['unless', 'says'].map((k) => (work.capabilities.lead as Record<string, string>)[k]));
  assert.deepEqual(leadFields({ props: { seen_working: true } }, work, null), [], 'once seen, it stays among the fields');
});

test('a band is never more than three lines, the line that it waits on you first', () => {
  const run = { capabilities: { lead: { form: 'timeline', beats: 'story' } } };
  const story = Array.from({ length: 6 }, (_, i) => ({ said: `beat ${i}`, at: '2026-11-18T10:00:00Z' }));
  const m = leadMarks({ id: 'e_1', props: { story } }, run, null, { waits: [{ id: 'e_me', for: 'a look' }], me: 'e_me' });
  valid(m);
  assert.equal(lines(m).length, 3);
  assert.match(said(lines(m)[0] as Marks), /Waits on you/);
  assert.match(said(m), /beat 5/);
  assert.doesNotMatch(said(m), /beat 3/);
});

test('an aim: what serves it and how much is done, or that nothing does yet', () => {
  const aim = { capabilities: { lead: { form: 'aim', link: 'serves' } } };
  assert.match(said(leadMarks({ id: 'e_1', props: {} }, aim, null, { links: [] })), /Nothing serves it yet/);
  const m = leadMarks({ id: 'e_1', props: {} }, aim, null, { links: ties('serves', false, true) });
  valid(m);
  assert.match(said(m), /1 of 2 done/);
});

test('a place: who holds it and how many need it; an actor: how many wait on them, large', () => {
  const place = { capabilities: { lead: { form: 'place', link: 'holds', waits: 'needs' } } };
  const p = leadMarks({ id: 'e_1', props: {} }, place, null, { links: [...ties('holds', true), ...ties('needs', true, true, false)] });
  valid(p);
  assert.match(said(p), /Held by.*T0/);
  assert.match(said(p), /2 need it/);
  assert.equal(leadMarks({ id: 'e_1', props: {} }, place, null, { links: ties('needs', true) }), null, 'not held: its status says it');
  const actor = { capabilities: { lead: { form: 'actor', link: 'waits_on' } } };
  const a = leadMarks({ id: 'e_me', props: {} }, actor, null, { links: ties('waits_on', true, true, false), me: 'e_me' });
  valid(a);
  assert.match(said(a), /"key":"lead-figure".*"2"/);
  assert.match(said(a), /wait on you/);
  assert.match(said(a), /"tone":"warn"/);
});

test('an occurrence: the day it happens large, from its when', () => {
  const occ = { capabilities: { lead: { form: 'occurrence' }, when: { at: 'at' } } };
  const m = leadMarks({ id: 'e_1', props: { at: '2026-11-23T10:00:00Z' } }, occ, null, { now: Date.parse('2026-11-18T10:00:00Z') });
  valid(m);
  assert.match(said(m), /in 5 d/);
  assert.equal(leadMarks({ id: 'e_1', props: {} }, occ, null), null, 'no time: no band');
  assert.equal(leadMarks({ id: 'e_1', props: { at: 'x' } }, { capabilities: { lead: { form: 'occurrence' } } }, null), null, 'no when: no band');
});

test('a measure: its number and unit large, when it was true muted', () => {
  const m = leadMarks({ id: 'e_1', props: { value: 147, unit: 's', as_of: '2026-11-17' } }, { capabilities: { lead: { form: 'measure', value: 'value', unit: 'unit', as_of: 'as_of' } } }, null);
  valid(m);
  assert.match(said(m), /"147 s"/);
  assert.match(said(m), /as of 2026-11-17/);
});

test('the alert fires when its field is unset, not only false, and says it until it is true', () => {
  const m = leadMarks({ id: 'e_1', props: {} }, work, null, { writes: true, links: [] });
  valid(m);
  assert.equal(lines(m).length, 1);
  assert.match(said(m), /Not yet seen working/);
  assert.deepEqual(leadFields({ props: {} }, work, null), ['seen_working', 'to_see'], 'unset: the band says it, the fields do not');
});

test('a line: one field as one line, named and cut; a link into it by its far ends; absent when empty', () => {
  const instr = { capabilities: { lead: { form: 'line', value: 'for' } } };
  const m = leadMarks({ id: 'e_1', props: { for: ['session_start', 'file:src/**'] } }, instr, null);
  valid(m);
  assert.equal(lines(m).length, 1);
  assert.match(said(m), /"For"/);
  assert.match(said(m), /session_start, file:src\/\*\*/);
  assert.match(said(m), /"grow":true/, 'the words take the room left, cut with an ellipsis');
  assert.deepEqual(leadFields({ props: { for: ['x'] } }, instr, null), ['for']);
  for (const v of [undefined, '', '  ', [], null]) assert.equal(leadMarks({ id: 'e_1', props: { for: v } }, instr, null), null, JSON.stringify(v));
  assert.deepEqual(leadFields({ props: {} }, instr, null), [], 'empty: it stays among the fields');
  const from = { capabilities: { lead: { form: 'line', value: 'from_workspace' } } };
  assert.match(said(leadMarks({ id: 'e_1', props: { from_workspace: 'focus' } }, from, null)), /From workspace.*focus/);
  const about = { capabilities: { lead: { form: 'line', link: 'about' } } };
  const a = leadMarks({ id: 'e_1', props: {} }, about, null, { links: [...ties('about', true, false), ...ties('serves', true)] });
  valid(a);
  assert.match(said(a), /"About".*T0, T1/);
  assert.equal(leadMarks({ id: 'e_1', props: {} }, about, null, { links: ties('serves', true) }), null);
});

test("an open decision: one line per option, its says in the tooltip, the recommended one marked, three in sight", () => {
  const decision = { capabilities: { lead: { form: 'choices' } } };
  const options = [
    { title: 'Count the island', says: 'A bar of its island. Recommended.' },
    { title: 'No bar', says: 'Only part_of counts.' },
  ];
  const c = (list: { title: string; says?: string; recommended?: boolean }[]) => ({ field: 'options', list: list.map((x) => x.title), says: list.map((x) => x.says) });
  const two = leadMarks({ id: 'e_1', is_open: true, props: { options } }, decision, c(options), { writes: true });
  valid(two);
  assert.equal(lines(two).length, 2, 'one line each, not two');
  assert.match(said(lines(two)[0] as Marks), /★/);
  assert.doesNotMatch(said(lines(two)[1] as Marks), /★/);
  assert.match(said(two), /"tip":"No bar: Only part_of counts."/);
  assert.doesNotMatch(said(two), /"look":"muted"[^\]]*Only part_of/, 'what it says is in the tooltip, not a line of its own');
  const five = ['A', 'B', 'C', 'D', 'E'].map((t) => ({ title: t, ...(t === 'E' && { recommended: true }) }));
  const m = leadMarks({ id: 'e_1', is_open: true, props: { options: five } }, decision, c(five), { writes: true });
  valid(m);
  assert.equal(lines(m).length, 3);
  assert.match(said(lines(m)[2] as Marks), /★.*"E".*"key":"choices-more","label":"\+2"/, 'the recommended one in sight, the rest behind a count');
  assert.match(said(m), /"key":"choice:2"/, 'a hidden one is still pressed from the count');
  const mine = leadMarks({ id: 'e_1', is_open: true, props: { options: five } }, decision, c(five), { waits: [{ id: 'e_me' }], me: 'e_me' });
  valid(mine);
  assert.equal(lines(mine).length, 3, 'the line that it waits on you takes one of the three');
  assert.match(said(lines(mine)[2] as Marks), /"\+3"/);
});
