// The clock (packs/clocks/kernel/due.ts): what has a when comes due once per occurrence, in the workspace's zone, and the packs that
// hear item.due are told.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dueBetween } from '../packs/clocks/kernel/due.ts';
import * as duePack from '../packs/clocks/kernel/due.ts';
import { readEvents } from '../packs/log/kernel/eventlog.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { freshWith, human, make, packsWith } from './map.ts';
import { kernelContext } from '../packs/loader/kernel/kernel-context.ts';

// Monday 7 January 2030, 08:00 in Toronto (EST) is 13:00 UTC; far enough ahead that every item is made before it.
const AT = Date.parse('2030-01-07T13:00:00Z');
const MIN = 60_000;

const map = () => freshWith(new Registry(packsWith('chime')));

test('a repeat comes due at its hour in the zone, on its days only', async () => {
  const l = await map();
  const ids = await make(l, [
    { op: 'create', ref: 'weekdays', type: 'chime', title: 'Morning', status: 'on', props: { hour: '08:00', days: [1, 2, 3, 4, 5] } },
    { op: 'create', ref: 'sundays', type: 'chime', title: 'Sunday', status: 'on', props: { hour: '08:00', days: [7] } },
    { op: 'create', ref: 'meet', type: 'event', title: 'Board meeting', props: { at: '2030-01-07T13:00:30Z' } },
  ]);
  const items = (await l.db.query(`select * from entity where id = any($1::text[])`, [Object.values(ids)])).rows as never[];
  const due = dueBetween(l, items, AT - 2 * MIN, AT + 2 * MIN, 'America/Toronto');
  assert.deepEqual(due.map((d) => [d.title, d.at]), [['Morning', '2030-01-07T13:00:00.000Z'], ['Board meeting', '2030-01-07T13:00:30.000Z']]);
  assert.deepEqual(dueBetween(l, items, AT, AT + 2 * MIN, 'America/Toronto').map((d) => d.title), ['Board meeting'], 'what began at the window\'s first instant was the pass before\'s');
  assert.deepEqual(dueBetween(l, items, AT - 2 * MIN, AT + 2 * MIN, 'UTC').map((d) => d.title), ['Board meeting'], '08:00 in UTC is another instant');
});

test('a pass records each occurrence once, and a pack that hears item.due acts on it', async () => {
  const l = await map();
  const ids = await make(l, [{ op: 'create', ref: 'c', type: 'chime', title: 'Morning', status: 'on', props: { hour: '08:00', days: [1] } }]);
  assert.deepEqual(await duePack.duePass(kernelContext(l, 'clocks'), (AT - 5 * MIN)), [], 'the first pass ever only sets where the clock starts');
  assert.deepEqual((await duePack.duePass(kernelContext(l, 'clocks'), (AT + MIN))).map((d) => d.item), [ids.c]);
  assert.deepEqual(await duePack.duePass(kernelContext(l, 'clocks'), (AT + 2 * MIN)), [], 'not twice');

  const logged = (await readEvents(l.db, { target: ids.c, limit: 20 })).filter((e) => e.action === 'item.due');
  assert.equal(logged.length, 1, 'the occurrence is in the log, once');

  let told: { title: string }[] = [];
  for (let i = 0; i < 100 && !told.length; i++) {
    await new Promise((r) => setTimeout(r, 100));
    told = (await l.db.query<{ title: string }>(`select title from entity where type = 'notification' and title like $1 limit 5`, ['Rang:%'])).rows;
  }
  assert.deepEqual(told.map((n) => n.title), ['Rang: "Morning" is due'], 'the chime pack heard it and told the owner');

  await l.change(human, { reason: 'test', ops: [{ op: 'update', id: ids.c, status: 'off' }] });
  assert.deepEqual(await duePack.duePass(kernelContext(l, 'clocks'), (AT + 7 * 24 * 60 * MIN + MIN)), [], 'a closed item is not due');
});
