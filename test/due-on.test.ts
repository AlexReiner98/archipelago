// The clock's query triggers (src/due-on.ts): an automation whose `on` names a query comes due when that query starts
// to match, by its edge, once: what matched when it was set does not fire, and a second pass or a restart fires nothing
// again. A bad `on` is refused on write (src/automation-rules.ts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkOn } from '../src/automation-rules.ts';
import { duePass } from '../src/due.ts';
import { readEvents } from '../src/eventlog.ts';
import { Registry } from '../src/packs.ts';
import type { Archipelago } from '../src/pelago.ts';
import { freshWith, human, make, packsWith } from './map.ts';

const SIGNUPS = {
  id: 'signups', version: '0.1.0', title: 'Sign-ups', description: 'Made-up sign-ups for testing query triggers.', requires: ['core'],
  types: [{ id: 'signup', title: 'Sign-up', description: 'Someone who signed up.', extends: 'record', fields: { region: { type: 'string' } } }],
};
const map = () => freshWith(new Registry(packsWith(SIGNUPS as never)));
const NOW = Date.parse('2030-01-07T13:00:00Z');
const signups = { query: { filter: { find: ['type signup'] } } };
const pass = async (l: Archipelago, i: number) => (await duePass(l, NOW + i * 60_000)).filter((d) => d.edge);
// An automation lives with what it is about (src/subject.ts): each is made about a task.
const ABOUT = [{ op: 'create', ref: 'subject', type: 'task', title: 'Regulated regions' }, { op: 'link', type: 'about', from: 'auto', to: 'subject' }] as never[];
const automation = (on: unknown) => ({ op: 'create', ref: 'auto', type: 'automation', title: 'Watch', status: 'enabled', props: { on, action: 'notify', message: 'Started to match' } });

test('a bad on is refused on write, and a good one taken', async () => {
  assert.deepEqual(checkOn({ ...signups, edge: 'first' }), []);
  assert.deepEqual(checkOn({ ...signups, edge: 'crosses:10000', field: 'value' }), []);
  assert.match(checkOn({ query: { filter: { find: [] } }, edge: 'first' }).join(), /finds something/);
  assert.match(checkOn({ ...signups, edge: 'sometimes' }).join(), /on.edge must be/);
  assert.match(checkOn({ ...signups, edge: 'first_per:' }).join(), /field name/);
  assert.match(checkOn({ ...signups, edge: 'crosses:lots', field: 'value' }).join(), /a number/);
  assert.match(checkOn({ ...signups, edge: 'crosses:5' }).join(), /on.field/);
  assert.match(checkOn({ query: { ...signups.query, limit: 100000 }, edge: 'each' }).join(), /limit/);

  const l = await map();
  await assert.rejects(l.change(human, { reason: 'test', ops: [automation({ ...signups, edge: 'never' }) as never, ...ABOUT] }), /on.edge must be/);
  const ids = await make(l, [automation({ ...signups, edge: 'each' }) as never, ...ABOUT]);
  await assert.rejects(l.change(human, { reason: 'test', ops: [{ op: 'update', id: ids.auto, props: { on: { edge: 'each' } } }] }), /filter.find/, 'an on changed is checked whole, as on a create');
});

test('each: each item that starts to match fires once, and what matched before it was set does not', async () => {
  const l = await map();
  await make(l, [{ op: 'create', type: 'signup', title: 'Ada', props: { region: 'EU' } }]);
  const ids = await make(l, [automation({ ...signups, edge: 'each' }) as never, ...ABOUT]);
  assert.deepEqual(await pass(l, 0), [], 'the first pass only learns what already matches');
  const b = await make(l, [{ op: 'create', ref: 'b', type: 'signup', title: 'Ben', props: { region: 'UK' } }]);
  const met = await pass(l, 1);
  assert.deepEqual(met.map((m) => [m.item, m.edge, m.matched]), [[ids.auto, 'each', [b.b]]]);
  assert.deepEqual(await pass(l, 2), [], 'not twice');
  const c = await make(l, [{ op: 'create', ref: 'c', type: 'signup', title: 'Cy' }, { op: 'create', ref: 'd', type: 'signup', title: 'Di' }]);
  assert.deepEqual((await pass(l, 3)).map((m) => m.matched?.[0]).sort(), [c.c, c.d].sort(), 'one firing for each');

  const due = (await readEvents(l.db, { target: ids.auto, limit: 20 })).filter((e) => e.action === 'item.due');
  assert.equal(due.length, 3, 'each firing is an item.due fact on the automation');
  assert.deepEqual((due.find((e) => (e.detail as { on?: { matched: string[] } }).on?.matched[0] === b.b)?.detail as { on: unknown }).on, { edge: 'each', matched: [b.b] });

  // The pack hears it as it hears a time: a notification made.
  let told: string[] = [];
  for (let i = 0; i < 100 && told.length < 3; i++) {
    await new Promise((r) => setTimeout(r, 50));
    told = (await l.db.query<{ title: string }>(`select title from entity where type = 'notification' and title = $1 limit 5`, ['Started to match'])).rows.map((r) => r.title);
  }
  assert.equal(told.length, 3, 'the automations pack acted on each firing');
});

test('first: fires the first time the query matches, never again', async () => {
  const l = await map();
  await make(l, [automation({ ...signups, edge: 'first' }) as never, ...ABOUT]);
  assert.deepEqual(await pass(l, 0), []);
  const a = await make(l, [{ op: 'create', ref: 'a', type: 'signup', title: 'Ada' }]);
  assert.deepEqual((await pass(l, 1)).map((m) => [m.edge, m.matched]), [['first', [a.a]]]);
  await make(l, [{ op: 'create', type: 'signup', title: 'Ben' }]);
  assert.deepEqual(await pass(l, 2), [], 'only the first');

  const late = await map();
  await make(late, [{ op: 'create', type: 'signup', title: 'Ada' }, automation({ ...signups, edge: 'first' }) as never, ...ABOUT]);
  await pass(late, 0);
  await make(late, [{ op: 'create', type: 'signup', title: 'Ben' }]);
  assert.deepEqual(await pass(late, 1), [], 'already matching when it was set: it never starts to');
});

test('first_per: once for each value of a field, ever', async () => {
  const l = await map();
  await make(l, [{ op: 'create', type: 'signup', title: 'Old', props: { region: 'CA' } }, automation({ ...signups, edge: 'first_per:region' }) as never, ...ABOUT]);
  await pass(l, 0);
  const eu = await make(l, [{ op: 'create', ref: 'a', type: 'signup', title: 'Ada', props: { region: 'EU' } }, { op: 'create', type: 'signup', title: 'Ann', props: { region: 'CA' } }]);
  assert.deepEqual((await pass(l, 1)).map((m) => [m.edge, m.value, m.matched]), [['first_per:region', 'EU', [eu.a]]], 'CA was met before');
  await make(l, [{ op: 'create', type: 'signup', title: 'Eve', props: { region: 'EU' } }, { op: 'create', type: 'signup', title: 'Nobody' }]);
  assert.deepEqual(await pass(l, 2), [], 'a second EU sign-up, and one with no region, meet nothing');
  await l.change(human, { reason: 'test', ops: [{ op: 'archive', id: eu.a }] });
  await pass(l, 3);
  await make(l, [{ op: 'create', type: 'signup', title: 'Uma', props: { region: 'UK' } }]);
  assert.deepEqual((await pass(l, 4)).map((m) => m.value), ['UK']);
  assert.deepEqual(await pass(l, 5), []);
});

test('crosses: an item reaching n from under it fires, and again only after it falls back under', async () => {
  const l = await map();
  const on = { query: { filter: { find: ['type finding'] } }, edge: 'crosses:10000', field: 'value' };
  const f = await make(l, [{ op: 'create', ref: 'f', type: 'finding', title: 'Monthly profit', props: { value: 8000, value_type: 'number', unit: 'EUR' } }, automation(on) as never, ...ABOUT]);
  await pass(l, 0);
  const set = (value: number) => l.change(human, { reason: 'test', ops: [{ op: 'update', id: f.f, props: { value } }] });
  await set(9000);
  assert.deepEqual(await pass(l, 1), [], 'still under');
  await set(12000);
  assert.deepEqual((await pass(l, 2)).map((m) => [m.edge, m.value, m.matched]), [['crosses:10000', 12000, [f.f]]]);
  await set(13000);
  assert.deepEqual(await pass(l, 3), [], 'over and still over: not twice');
  await set(9500);
  await pass(l, 4);
  await set(10000);
  assert.deepEqual((await pass(l, 5)).map((m) => m.value), [10000], 'back under, then at n: a crossing again');
});

test('what an edge met is remembered across a restart, and a changed on starts again', async () => {
  const l = await map();
  const ids = await make(l, [automation({ ...signups, edge: 'each' }) as never, ...ABOUT]);
  await pass(l, 0);
  await make(l, [{ op: 'create', type: 'signup', title: 'Ada' }]);
  assert.equal((await pass(l, 1)).length, 1);
  // A restart: the same database, a new pass from nothing in memory but what the settings keep.
  await l.change(human, { reason: 'test', ops: [{ op: 'update', id: ids.auto, title: 'Watch sign-ups' }] });
  assert.deepEqual(await pass(l, 2), [], 'the log moved, the query asked again: nothing new matched');
  await l.change(human, { reason: 'test', ops: [{ op: 'update', id: ids.auto, props: { on: { ...signups, edge: 'first' } } }] });
  assert.deepEqual(await pass(l, 3), [], 'another on: what matches now is learned, not fired');
  await l.change(human, { reason: 'test', ops: [{ op: 'update', id: ids.auto, status: 'paused' }] });
  await make(l, [{ op: 'create', type: 'signup', title: 'Ben' }]);
  assert.deepEqual(await pass(l, 4), [], 'a paused automation is not asked');
});
