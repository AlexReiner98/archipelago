// The fact of a firing, without a database: the automation and the item.due it heard in, the answer with its
// automation.fired entry out. That the kernel fills in what was made is test/automation-fired.test.ts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { answerDue } from './fire.js';
import { failedFiring, FIRED, withFiring } from './firing.js';
import handler from './handler.js';

const A = 'e_auto0001', S = 'e_subject1';
/** The packs the clock says it came due under (src/pack-versions.ts), copied into the fact. */
const PACKS = [{ id: 'automations', version: '0.1.0', manifest: 'abc123' }];
const auto = (props: Record<string, unknown> = {}, status = 'enabled') => ({ id: A, type: 'automation', is: ['automation', 'system'], title: 'Morning', status, props: { action: 'notify', ...props } });
const due = { action: 'item.due', pack: 'kernel', target: A, seq: 41, detail: { type: 'automation', at: '2030-01-07T13:00:00.000Z', version: 7, packs: PACKS } };
const at = { at: '2030-01-07T13:00:00.000Z', due_seq: 41, version: 7, packs: PACKS };

test('a firing that launches records the fact, naming the session by its run', () => {
  const done = withFiring(auto({ action: 'launch' }), due, { launch: { task: 'e_task0001', mode: 'plan' }, reason: 'Morning: launched' });
  assert.deepEqual(done.log, [{
    action: FIRED, target: A, reason: 'Morning: launched',
    detail: { ...at, ok: true, result: 'launched', made: ['{run}'] },
    otherwise: { reason: 'Morning: failed', detail: { ok: false, result: 'session not started: {error}' } },
  }]);
});

test('a firing that notifies records the fact, naming the notification by its ref', () => {
  const done = withFiring(auto(), due, answerDue(auto({ message: 'Hi' }), S));
  assert.deepEqual(done.notify, [{ title: 'Hi', level: 'info', about: S, ref: 'notice' }]);
  assert.deepEqual(done.log, [{
    action: FIRED, target: A, reason: 'Morning: notified',
    detail: { ...at, ok: true, result: 'notified', made: ['{notice}'] },
    otherwise: { reason: 'Morning: failed', detail: { ok: false, result: 'notification not made: {error}' } },
  }]);
  assert.equal(done.reason, 'Morning: notified');
});

test('what fired nothing records nothing, and an event without its seq or version says null', () => {
  assert.deepEqual(withFiring(auto({}, 'paused'), due, {}), {});
  assert.deepEqual(withFiring(auto({ action: 'launch' }), due, {}), {});
  const done = withFiring(auto(), { target: A, detail: { at: '2030-01-07T13:00:00.000Z' } }, answerDue(auto(), S));
  assert.deepEqual([done.log[0].detail.due_seq, done.log[0].detail.version], [null, null]);
});

test('a firing that fails before it answers is a fact too: nothing made, and why', () => {
  assert.deepEqual(failedFiring(auto(), due, new Error('read refused')), {
    reason: 'Morning: failed',
    notify: [{ title: 'The automation "Morning" failed', body: 'read refused', level: 'warning', about: A }],
    log: [{ action: FIRED, target: A, reason: 'Morning: failed', detail: { ...at, ok: false, result: 'read refused', made: [] } }],
  });
  assert.equal(failedFiring(auto(), due, new Error('x'.repeat(500))).log[0].detail.result.length, 200, 'its reason kept short');
});

test('the handler records a failure of its own reads as a failed firing', async () => {
  const ctx = { read: async (q: { get?: string }) => { if (q.get) return auto(); throw new Error('no related reads today'); } };
  const done = await handler['item.due']({ event: due }, ctx);
  assert.deepEqual(done.log.map((e: { detail: { ok: boolean; result: string } }) => [e.detail.ok, e.detail.result]), [[false, 'no related reads today']]);
  assert.deepEqual(done.notify.map((n: { title: string; level: string }) => [n.title, n.level]), [['The automation "Morning" failed', 'warning']], 'the person is warned, about the automation');
});
