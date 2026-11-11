// The automations pack, run without a database: an item come due and what it is about go in, a notification or
// nothing comes out. That the clock tells it is the kernel's (test/due.test.ts, test/weekly-trigger.test.ts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerDue, fires, launchOf, noticeOf } from './fire.js';
import handler from './handler.js';

const A = 'e_auto0001', S = 'e_subject1';
const auto = (props: Record<string, unknown> = {}, status = 'enabled') => ({ id: A, type: 'automation', is: ['automation', 'system'], title: 'Morning', status, props: { action: 'notify', ...props } });
const due = { action: 'item.due', pack: 'kernel', target: A, detail: { type: 'automation', at: '2030-01-07T13:00:00.000Z' } };

test('only an enabled automation fires', () => {
  assert.equal(fires(auto()), true);
  assert.equal(fires(auto({}, 'paused')), false);
  assert.equal(fires(auto({}, 'retired')), false);
  assert.equal(fires({ id: 'e_task0001', type: 'task', is: ['task', 'work'], status: 'enabled' }), false, 'what is not an automation');
  assert.equal(fires({ ...auto(), type: 'nudge', is: ['nudge', 'automation', 'system'] }), true, 'a flavour of it');
});

test('a notification is about the automation\'s subject, its message its title', () => {
  assert.deepEqual(noticeOf(auto({ message: 'Your priority', level: 'warning' }), S), { title: 'Your priority', level: 'warning', about: S });
  assert.deepEqual(noticeOf(auto({ message: '  ' }), S), { title: 'Morning', level: 'info', about: S }, 'no message: its name');
  assert.deepEqual(noticeOf(auto({ level: 'loud' }), undefined), { title: 'Morning', level: 'info', about: A }, 'about nothing: about itself');
});

test('notify answers one notification; launch the session its input says, not while its last is open', () => {
  assert.deepEqual(answerDue(auto({ message: 'Hi' }), S), { notify: [{ title: 'Hi', level: 'info', about: S }], reason: 'Morning: notified' });
  const launching = auto({ action: 'launch', input: { task: 'e_task0001', instructions: 'Refine.' } });
  assert.deepEqual(answerDue(launching, S), { launch: { task: 'e_task0001', mode: 'plan', instructions: 'Refine.' }, reason: 'Morning: launched' });
  assert.deepEqual(answerDue(launching, S, true), {}, 'its last session still open');
  assert.deepEqual(launchOf(auto({ action: 'launch', input: { task: 'e_task0001', mode: 'acceptEdits', instructions: '' } })), { task: 'e_task0001', mode: 'acceptEdits' });
  assert.deepEqual(answerDue(auto({ action: 'tool' }), S), {});
  assert.deepEqual(answerDue(auto({}, 'paused'), S), {});
});

test('the handler reads the last session an automation that launches started', async () => {
  const launching = auto({ action: 'launch', input: { task: 'e_task0001' }, last_run: 'e_run00001' });
  const ctx = (open: boolean) => ({ read: async (q: { get?: string }) => (q.get === A ? launching : q.get === 'e_run00001' ? { id: 'e_run00001', is_open: open } : []) });
  assert.deepEqual((await handler['item.due']({ event: due }, ctx(false))).launch, { task: 'e_task0001', mode: 'plan' });
  assert.deepEqual(await handler['item.due']({ event: due }, ctx(true)), {});
});

test('the handler reads the item and what it is about', async () => {
  const asked: unknown[] = [];
  const ctx = (item: unknown, about: unknown[]) => ({ read: async (q: { get?: string }) => (asked.push(q), q.get ? item : about) });
  const done = await handler['item.due']({ event: due }, ctx(auto({ message: 'Hi' }), [{ id: S, type: 'feature' }]));
  assert.deepEqual(done.notify, [{ title: 'Hi', level: 'info', about: S, ref: 'notice' }]);
  assert.equal(done.log[0].action, 'automation.fired', 'with the fact of its firing (firing.test.ts)');
  assert.deepEqual(asked, [{ get: A }, { related: A, relation: 'about', direction: 'out' }]);
  assert.deepEqual(await handler['item.due']({ event: { ...due, target: 'e_task0001' } }, ctx({ id: 'e_task0001', type: 'task', is: ['task'] }, [])), {}, 'another item come due is not this pack\'s');
  assert.deepEqual(await handler['item.due']({ event: { ...due, target: undefined } }, ctx(null, [])), {});
});
