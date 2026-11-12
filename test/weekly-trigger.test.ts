// An automation's weekly trigger: the days it names, and that it comes due once on each, at its time, by the clock
// (src/due.ts); the automations pack hears it and tells the person, about what the automation is about.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkAutomation, weekdays } from '../packs/automation_triggers/kernel/automation-rules.ts';
import * as duePack from '../packs/clocks/kernel/due.ts';
import { dayStart } from '../packs/query/kernel/timeaxis.ts';
import { fresh, make } from './map.ts';
import { kernelContext } from '../packs/loader/kernel/kernel-context.ts';

// 7 Jan 2030 is a Monday, after anything the test makes; times are in Toronto, the workspace zone.
const at = (day: string, h: number, m = 0) => dayStart(day, 'America/Toronto') + (h * 60 + m) * 60_000;

test('a weekly trigger names its days', () => {
  assert.deepEqual(weekdays(['monday', 'Fri', 7]), [1, 5, 7]);
  assert.deepEqual(weekdays('mon'), [1]);
  assert.equal(weekdays(['mo']), undefined, 'two letters name no day for sure');
  assert.equal(weekdays([8]), undefined);
  assert.equal(weekdays([]), undefined);
  assert.deepEqual(checkAutomation({ trigger: 'weekly', days: ['monday'], at: '09:00', action: 'notify' }), []);
  assert.match(checkAutomation({ trigger: 'weekly', at: '9:00', action: 'notify' }).join('; '), /needs days[\s\S]*needs at as "HH:MM"/);
});

test('it comes due once on each of its days, at its time, and the person is told about its subject', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'loop', type: 'task', title: 'The refinement loop' },
    { op: 'create', ref: 'w', type: 'automation', title: 'Weekly posting', status: 'enabled', props: { trigger: 'weekly', days: [1], at: '09:00', action: 'notify', message: 'Post today' } },
    { op: 'create', ref: 'off', type: 'automation', title: 'Paused one', status: 'paused', props: { trigger: 'weekly', days: [1], at: '09:00', action: 'notify' } },
    { op: 'link', type: 'about', from: 'w', to: 'loop' }, { op: 'link', type: 'about', from: 'off', to: 'loop' },
  ]);
  const due = async (when: number) => (await duePack.duePass(kernelContext(l, 'clocks'), when)).map((d) => d.item);
  assert.deepEqual(await due(at('2030-01-07', 8)), [], 'the first pass only sets where the clock starts');
  assert.deepEqual(await due(at('2030-01-07', 8, 59)), [], 'not before its time');
  assert.deepEqual((await due(at('2030-01-07', 9))).sort(), [made.w, made.off].sort(), 'at its time: the clock decides nothing, so a paused one is due too, and the pack lets it be');
  assert.deepEqual(await due(at('2030-01-07', 15)), [], 'once on its day');
  assert.deepEqual(await due(at('2030-01-08', 9)), [], 'not on a Tuesday');

  // The pack hears it in its own process: wait for the notification it answers.
  let told: { title: string; about: string | null }[] = [];
  for (let i = 0; i < 100 && !told.length; i++) {
    await new Promise((r) => setTimeout(r, 100));
    told = (await l.db.query<{ title: string; about: string | null }>(
      `select n.title, r.to_id as about from entity n left join relation r on r.from_id = n.id and r.type = 'about' where n.type = 'notification' and n.title = 'Post today'`,
    )).rows;
  }
  assert.deepEqual(told, [{ title: 'Post today', about: made.loop }], 'told once, about what it is about');
});
