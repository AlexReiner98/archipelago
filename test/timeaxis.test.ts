// A time axis for lenses: items placed by when and bound, repeats as their occurrences, sessions where they ran.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDb } from '../src/db.ts';
import '../src/views.ts';
import { lens } from '../src/lens.ts';
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

test('a lens on a time axis places what falls in its window, repeats as their days', async () => {
  const l = await map();
  const made = (await l.change(human, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'task', type: 'task', title: 'Send the forms', props: { due: '2026-10-15' } },
      { op: 'create', ref: 'meet', type: 'event', title: 'Board meeting', props: { at: '2026-10-14T14:00:00Z', ends: '2026-10-14T15:30:00Z' } },
      { op: 'create', ref: 'later', type: 'event', title: 'Next year', props: { at: '2027-03-01T14:00:00Z' } },
      { op: 'create', ref: 'gym', type: 'time.routine', title: 'Gym', props: { from_time: '07:00', to_time: '08:00', days: [1, 3, 5], starts: '2026-10-01' } },
      { op: 'create', ref: 'loose', type: 'task', title: 'No date' },
    ],
  })) as { created: Record<string, string> };
  const answer = (await lens(l, { time: { from: '2026-10-12', to: '2026-10-18' }, fold: [] })) as { items: Item[]; rest: { time: number }; said: string };
  const of = (ref: string) => answer.items.find((i) => i.id === made.created[ref]);
  assert.deepEqual(of('task')!.time!.map((s) => [s.by, s.start]), [['bound', '2026-10-15T04:00:00.000Z']], 'a due date is a whole day in Toronto');
  assert.deepEqual(of('meet')!.time, [{ start: '2026-10-14T14:00:00.000Z', end: '2026-10-14T15:30:00.000Z', by: 'when' }]);
  assert.deepEqual(of('gym')!.time!.map((s) => s.start), ['2026-10-12T11:00:00.000Z', '2026-10-14T11:00:00.000Z', '2026-10-16T11:00:00.000Z'], 'Monday, Wednesday and Friday at 07:00');
  assert.equal(of('later'), undefined, 'outside the window');
  assert.equal(of('loose'), undefined, 'with no time');
  assert.ok(answer.rest.time >= 2);
  assert.match(answer.said, /placed in time from 2026-10-12 to 2026-10-18/);

  const deadlines = (await lens(l, { time: { from: '2026-10-12', to: '2026-10-18', by: ['bound'] }, fold: [] })) as { items: Item[] };
  assert.deepEqual(deadlines.items.map((i) => i.title), ['Send the forms'], 'only by bound');
  await assert.rejects(lens(l, { time: { from: '2026-10-18', to: '2026-10-12' } }), /comes after/);
});

test('a time axis kept on a lens item is read like its other fields', async () => {
  const l = await map();
  const made = (await l.change(human, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'meet', type: 'event', title: 'Standup', props: { at: '2026-10-14T13:00:00Z' } },
      { op: 'create', ref: 'week', type: 'lens', title: 'This week', props: { time: { from: '2026-10-12', to: '2026-10-18' }, fold: [] } },
    ],
  })) as { created: Record<string, string> };
  const answer = (await lens(l, { lens: made.created.week })) as { items: Item[] };
  assert.deepEqual(answer.items.map((i) => i.title), ['Standup']);
});
