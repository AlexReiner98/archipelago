// An automation's weekly trigger: the days it names, and that it fires once on each, at its time.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkAutomation, weekdays } from '../src/automation-rules.ts';
import { Automations } from '../src/automations.ts';
import { fresh, make } from './map.ts';

test('a weekly trigger names its days and fires once on each, at its time', async () => {
  assert.deepEqual(weekdays(['monday', 'Fri', 7]), [1, 5, 7]);
  assert.deepEqual(weekdays('mon'), [1]);
  assert.equal(weekdays(['mo']), undefined, 'two letters name no day for sure');
  assert.equal(weekdays([8]), undefined);
  assert.equal(weekdays([]), undefined);
  assert.deepEqual(checkAutomation({ trigger: 'weekly', days: ['monday'], at: '09:00', action: 'notify' }), []);
  assert.match(checkAutomation({ trigger: 'weekly', at: '9:00', action: 'notify' }).join('; '), /needs days[\s\S]*needs at as "HH:MM"/);

  const l = await fresh();
  const made = await make(l, [{ op: 'create', ref: 'w', type: 'automation', title: 'Weekly posting', status: 'enabled', props: { trigger: 'weekly', days: ['monday'], at: '09:00', action: 'notify' } }]);
  const autos = new Automations(l);
  const fired = async (when: Date) => (await autos.tick(when)).map((f) => f.automation);
  // 2 Nov 2026 is a Monday.
  assert.deepEqual(await fired(new Date(2026, 10, 2, 8, 59)), [], 'not before its time');
  assert.deepEqual(await fired(new Date(2026, 10, 2, 9, 0)), [made.w]);
  assert.deepEqual(await fired(new Date(2026, 10, 2, 15, 0)), [], 'once on its day');
  assert.deepEqual(await fired(new Date(2026, 10, 3, 9, 0)), [], 'not on a Tuesday');
  assert.deepEqual(await fired(new Date(2026, 10, 9, 9, 30)), [made.w], 'and again the next Monday');
});
