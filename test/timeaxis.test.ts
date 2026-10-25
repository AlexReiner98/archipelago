// A time axis, read by packs (placed): items placed by when and bound, repeats as their occurrences, sessions where they ran.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDb } from '../src/db.ts';
import '../src/views.ts';
import { answerRead } from '../src/packreads.ts';
import { Archipelago, type Actor } from '../src/pelago.ts';
import { Registry } from '../src/packs.ts';
import { dayStart } from '../src/timeaxis.ts';

const human: Actor = { kind: 'human', name: 'test' };

async function map() {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-axis-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), dir, { recursive: true });
  return new Archipelago(await openDb(), new Registry(dir));
}

type Item = { id: string; title: string; time?: { start: string; end: string; by: string }[] };

test('a day starts at midnight in the zone it is counted in', () => {
  assert.equal(new Date(dayStart('2026-10-14', 'America/Toronto')).toISOString(), '2026-10-14T04:00:00.000Z');
  assert.equal(new Date(dayStart('2026-12-14', 'America/Toronto')).toISOString(), '2026-12-14T05:00:00.000Z');
  assert.equal(new Date(dayStart('2026-10-14', 'UTC')).toISOString(), '2026-10-14T00:00:00.000Z');
});

test('a read placed in time places what falls in its window, repeats as their days', async () => {
  const l = await map();
  const made = (await l.change(human, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'task', type: 'work.task', title: 'Send the forms', props: { due: '2026-10-15' } },
      { op: 'create', ref: 'meet', type: 'event', title: 'Board meeting', props: { at: '2026-10-14T14:00:00Z', ends: '2026-10-14T15:30:00Z' } },
      { op: 'create', ref: 'later', type: 'event', title: 'Next year', props: { at: '2027-03-01T14:00:00Z' } },
      { op: 'create', ref: 'gym', type: 'time.routine', title: 'Gym', props: { from_time: '07:00', to_time: '08:00', days: [1, 3, 5], starts: '2026-10-01' } },
      { op: 'create', ref: 'loose', type: 'work.task', title: 'No date' },
    ],
  })) as { created: Record<string, string> };
  const kinds = ['work.task', 'event', 'time.routine'];
  const placed = (time: Record<string, unknown>) => answerRead(l, { placed: { types: kinds, ...time } as never }) as Promise<Item[]>;
  const items = await placed({ from: '2026-10-12', to: '2026-10-18' });
  const of = (ref: string) => items.find((i) => i.id === made.created[ref]);
  assert.deepEqual(of('task')!.time!.map((s) => [s.by, s.start]), [['bound', '2026-10-15T04:00:00.000Z']], 'a due date is a whole day in Toronto');
  assert.deepEqual(of('meet')!.time, [{ start: '2026-10-14T14:00:00.000Z', end: '2026-10-14T15:30:00.000Z', by: 'when' }]);
  assert.deepEqual(of('gym')!.time!.map((s) => s.start), ['2026-10-12T11:00:00.000Z', '2026-10-14T11:00:00.000Z', '2026-10-16T11:00:00.000Z'], 'Monday, Wednesday and Friday at 07:00');
  assert.equal(of('later'), undefined, 'outside the window');
  assert.equal(of('loose'), undefined, 'with no time');

  const deadlines = await placed({ from: '2026-10-12', to: '2026-10-18', by: ['bound'] });
  assert.deepEqual(deadlines.map((i) => i.title), ['Send the forms'], 'only by bound');
  await assert.rejects(placed({ from: '2026-10-18', to: '2026-10-12' }), /comes after/);
});
