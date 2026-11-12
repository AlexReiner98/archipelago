// The clocks pack without a database (docs/kernel-packs.md, "Tests"): a fake context answers the reads and the calls
// from a few rows in memory. The whole of it against a real map is test/due.test.ts, through the shim.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KernelContext } from '#pelago/kernel';
import { dueBetween, duePass } from './due.ts';
import { dayStart, occurs } from './when.ts';

const types = new Map([
  ['chime', { id: 'chime', capabilities: { when: { repeat: { from: 'hour', days: 'days' } } } }],
  ['event', { id: 'event', capabilities: { when: { at: 'at' } } }],
  ['task', { id: 'task', capabilities: {} }],
]);
const registry = { types, type: (id: string) => types.get(id) } as unknown as KernelContext['registry'];
// Monday 7 January 2030, 08:00 in Toronto (EST) is 13:00 UTC.
const AT = Date.parse('2030-01-07T13:00:00Z');
const MIN = 60_000;
const made = new Date('2030-01-01T00:00:00Z');
const items = [
  { id: 'e_weekdays', type: 'chime', title: 'Morning', props: { hour: '08:00', days: [1, 2, 3, 4, 5] }, created_at: made },
  { id: 'e_sundays0', type: 'chime', title: 'Sunday', props: { hour: '08:00', days: [7] }, created_at: made },
  { id: 'e_meeting0', type: 'event', title: 'Board meeting', props: { at: '2030-01-07T13:00:30Z' }, created_at: made },
];

test('what begins in the window comes due, in the zone, on its days only', () => {
  assert.deepEqual(dueBetween({ registry }, items, AT - 2 * MIN, AT + 2 * MIN, 'America/Toronto').map((d) => [d.title, d.at]), [['Morning', '2030-01-07T13:00:00.000Z'], ['Board meeting', '2030-01-07T13:00:30.000Z']]);
  assert.deepEqual(dueBetween({ registry }, items, AT, AT + 2 * MIN, 'America/Toronto').map((d) => d.title), ['Board meeting'], "what began at the window's first instant was the pass before's");
  assert.deepEqual(dueBetween({ registry }, items, AT - 2 * MIN, AT + 2 * MIN, 'UTC').map((d) => d.title), ['Board meeting'], '08:00 in UTC is another instant');
});

test("a repeat's day and a day's start are the time axis's", () => {
  assert.equal(dayStart('2030-01-07', 'America/Toronto'), Date.parse('2030-01-07T05:00:00Z'));
  assert.deepEqual(occurs({ from: 'hour', days: 'days' }, { hour: '08:00', days: ['mon'] }, '2030-01-07'), [8, 8]);
  assert.equal(occurs({ from: 'hour', days: 'days' }, { hour: '08:00', days: ['mon'] }, '2030-01-08'), undefined);
});

test('a pass moves the clock, records each occurrence through root.due with its version, and adds what watched queries met', async () => {
  let cursor: number | undefined = AT - 2 * MIN;
  const recorded: unknown[] = [];
  const ctx = {
    registry,
    reads: async (q: Record<string, unknown>) => {
      if (q.clock) {
        const last = cursor;
        cursor = (q.clock as { now: number }).now;
        return { last, zone: null };
      }
      if (q.timed) return items.filter((i) => (q.timed as string[]).includes(i.type));
      if (q.due_of) return { version: 7, packs: [{ id: 'internal' }] };
      throw new Error(`no read ${JSON.stringify(q)}`);
    },
    call: async (name: string, input: Record<string, unknown>) => {
      if (name === 'root.due') return void recorded.push(input);
      if (name === 'act.report.due_on') return [{ met: { item: 'e_auto0000', type: 'automation', title: 'Watch', at: new Date(input.now as number).toISOString(), edge: 'first' }, told: { target: 'e_auto0000', reason: 'met', detail: { type: 'automation' } } }];
      throw new Error(`no service ${name}`);
    },
  } as unknown as KernelContext;
  const due = await duePass(ctx, AT + MIN);
  assert.equal(cursor, AT + MIN, 'the clock stands where this pass did');
  assert.deepEqual(due.map((d) => d.item), ['e_weekdays', 'e_meeting0', 'e_auto0000']);
  assert.deepEqual(recorded[0], { target: 'e_weekdays', reason: '"Morning" is due', detail: { type: 'chime', at: '2030-01-07T13:00:00.000Z', version: 7, packs: [{ id: 'internal' }] } });
  assert.equal(recorded.length, 3, 'each told once, the watched query last');
  cursor = undefined;
  assert.deepEqual((await duePass(ctx, AT + 2 * MIN)).map((d) => d.item), ['e_auto0000'], 'the first pass ever only sets where the clock starts');
});
