// The attention pack's part (packs/attention/parts/attention), run as its worker runs it: rows in, marks the host's check takes out
// (packs/walls/page/part-check.js), for you on Home and on an item's page, and Pressing or Latest on a press.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-ignore: a module of the page, plain JavaScript
import { checkMarks as checkAny } from '../packs/walls/page/part-check.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import attention from '../packs/attention/parts/attention/index.js';
import { readFileSync } from 'node:fs';

/** The marks the part names in its manifest: the host refuses any other it answers with. */
const kinds = JSON.parse(readFileSync(new URL('../packs/attention/pack.json', import.meta.url), 'utf8')).parts[0].marks;
const checkMarks = (marks: unknown) => checkAny(marks, { kinds });

const top = { id: 'e_top00001', title: 'Build the UI as packs' };
const items = [
  { id: 'e_aaaaaaaa', type: 'task', title: 'Pick a colour', changed: '2026-11-10T00:00:00Z', top, reasons: [{ why: 'waits_on', who: 'Alex', for: 'choose one' }] },
  { id: 'e_bbbbbbbb', type: 'decision', title: 'Which layout', changed: '2026-11-12T00:00:00Z', top, reasons: [{ why: 'to_confirm', answer: 'flow', basis: 'it reads best' }] },
  { id: 'e_cccccccc', type: 'task', title: 'Ship it', changed: '2026-11-11T00:00:00Z', top: null, reasons: [{ why: 'holding_up', count: 3 }, { why: 'stale', days: 20 }] },
];
const text = (m: unknown) => JSON.stringify(m);

test('for you, what is yours to do is banded by what it asks, under the piece’s title and limit', () => {
  const part = attention({ item: null, piece: { title: 'Your move', person: 'me', limit: 2 }, views: { attention: { items } } });
  checkMarks(part.marks);
  assert.match(text(part.marks), /Your move/);
  assert.match(text(part.marks), /"Do"/, 'a band for what waits on you');
  assert.match(text(part.marks), /"Confirm"/);
  const alone = attention({ item: null, piece: { person: 'me' }, views: { attention: { items: [items[0]] } } });
  assert.match(text(checkMarks(alone.marks) && alone.marks), /For: choose one/, 'one kind: its verb carries the reasons’ tips');
  assert.match(text(part.marks), /"item":"e_top00001"/, 'what it sits in opens its page');
});

test('on an item’s page its reasons are marks, and nothing to show is nothing drawn', () => {
  const on = { item: { id: 'e_top00001', type: 'task' }, piece: { title: 'Needs attention' } };
  const part = attention({ ...on, views: { attention: { items } } });
  checkMarks(part.marks);
  assert.match(text(part.marks), /holds up 3/);
  assert.match(text(part.marks), /20 d untouched/);
  assert.match(text(part.marks), /For: choose one/, 'a reason’s tip is said');
  assert.deepEqual(part.update({ ...on, views: { attention: { items: [] } } }), ['box', {}]);
  assert.match(text(part.update({ ...on, views: { attention: null } })), /Could not read/, 'a read that failed is said');
});

test('Latest puts what changed most recently first; another press is no order', () => {
  const part = attention({ item: { id: 'e_top00001', type: 'task' }, piece: {}, views: { attention: { items } } });
  const latest = checkMarks(part.on({ name: 'press', key: 'order:latest' }));
  assert.ok(latest);
  const order = (m: unknown) => [...text(m).matchAll(/"item":"(e_[a-c]{8})"/g)].map((x) => x[1]);
  assert.deepEqual(order(part.on({ name: 'press', key: 'order:latest' })), ['e_bbbbbbbb', 'e_cccccccc', 'e_aaaaaaaa']);
  assert.deepEqual(order(part.on({ name: 'press', key: 'order:pressing' })), ['e_aaaaaaaa', 'e_bbbbbbbb', 'e_cccccccc']);
  assert.equal(part.on({ name: 'press', key: 'order:nonsense' }), undefined);
});

