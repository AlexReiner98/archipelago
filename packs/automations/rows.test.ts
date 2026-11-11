// Automations as rows, run without a database: the automations, their spans and firings in, one row of marks each out.
// How the page draws a row's marks is the kernel's (ui/screens.js).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lastOf, nextOf, rowsOf, shortWhen, windowFrom } from './rows.js';
import handler from './handler.js';

const ZONE = 'America/Toronto';
// Wednesday 11 Nov 2026, 10:00 in Toronto.
const NOW = Date.parse('2026-11-11T15:00:00Z');
const span = (start) => ({ start, end: start, by: 'repeat' });
const auto = (id, title, status = 'enabled', props = {}) => ({ id, type: 'automation', title, status, props });

test('next run is the first occurrence ahead, said as its weekday and hour in the zone', () => {
  const spans = [span('2026-11-11T13:00:00Z'), span('2026-11-12T13:00:00Z'), span('2026-11-13T13:00:00Z')];
  assert.equal(nextOf(spans, NOW), Date.parse('2026-11-12T13:00:00Z'), 'today at 08:00 has passed');
  assert.equal(shortWhen(Date.parse('2026-11-12T13:00:00Z'), ZONE), 'Thu 08:00');
  assert.equal(nextOf([], NOW), undefined);
  assert.deepEqual(windowFrom(NOW, ZONE), { from: '2026-11-11', to: '2026-11-19' });
});

test('the last firing is the kept fact, else what the old runner wrote', () => {
  const fact = { ts: '2026-11-11T13:00:05Z', reason: 'Morning: failed', detail: { at: '2026-11-11T13:00:00Z', ok: false, result: 'no subject' } };
  assert.deepEqual(lastOf(auto('e_a', 'A'), [fact]), { at: '2026-11-11T13:00:00Z', ok: false, said: 'no subject' });
  const old = auto('e_a', 'A', 'enabled', { last_fired: '2026-11-10T13:00:00Z', last_result: 'ok: notified' });
  assert.deepEqual(lastOf(old, []), { at: '2026-11-10T13:00:00Z', ok: true, said: 'notified' });
  assert.equal(lastOf(old, [fact]).ok, false, 'the fact wins over the props');
  assert.equal(lastOf({ ...old, props: { last_fired: old.props.last_fired, last_result: 'failed: timed out' } }, []).ok, false);
  assert.equal(lastOf(auto('e_a', 'A'), []), undefined, 'never fired');
});

test('each row is its head and three marks: next, last, what it does; soonest first, paused and retired apart', () => {
  const items = [
    auto('e_late', 'Weekly review', 'enabled', { action: 'launch' }),
    auto('e_pause', 'Paused one', 'paused'),
    auto('e_soon', 'Morning', 'enabled', { action: 'notify', last_fired: '2026-11-11T13:00:00Z', last_result: 'ok: notified' }),
    auto('e_gone', 'Retired', 'retired'),
  ];
  const spans = new Map([
    ['e_soon', [span('2026-11-12T13:00:00Z')]],
    ['e_late', [span('2026-11-16T14:30:00Z')]],
    ['e_pause', [span('2026-11-12T13:00:00Z')]],
  ]);
  const rows = rowsOf(items, { spans, fired: new Map(), now: NOW, zone: ZONE });
  assert.deepEqual(rows.map((r) => r.id), ['e_soon', 'e_late', 'e_pause']);
  const [soon, late, paused] = rows;
  assert.deepEqual(soon.marks.map((m) => m.text), ['Thu 08:00', '✓', '✉ notify']);
  assert.equal(soon.marks[1].ago, '2026-11-11T13:00:00Z');
  assert.equal(soon.marks[1].tone, 'ok');
  assert.deepEqual(late.marks.map((m) => m.text), ['Mon 09:30', '·', '▶ launch']);
  assert.equal(paused.marks[0].text, '—', 'a paused one has no next run');
  assert.equal(paused.status, 'paused');
});

test('the view reads what the automations are about, and answers nothing for an item with none', async () => {
  const asked = [];
  const ctx = (found) => ({
    now: new Date(NOW).toISOString(),
    zone: ZONE,
    read: async (q) => (asked.push(q), q.related || q.items ? found : q.placed ? [{ id: 'e_soon', time: [span('2026-11-12T13:00:00Z')] }] : []),
  });
  assert.deepEqual((await handler['automations.rows']({ about: 'e_task' }, ctx([]))).answer, []);
  assert.equal(asked[0].related, 'e_task');
  assert.equal(asked.length, 1, 'nothing more is read');
  const { answer } = await handler['automations.rows']({}, ctx([auto('e_soon', 'Morning')]));
  assert.deepEqual(answer.map((r) => [r.id, r.marks[0].text]), [['e_soon', 'Thu 08:00']]);
  assert.ok(asked.some((q) => q.events?.action === 'automation.fired' && q.events.target === 'e_soon'));
});
