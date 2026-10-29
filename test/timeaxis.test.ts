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
import { flatLens } from '../src/lens-flat.ts';
import { dayStart, resolveAxis } from '../src/timeaxis.ts';

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
      { op: 'create', ref: 'task', type: 'task', title: 'Send the forms', props: { due: '2026-10-15' } },
      { op: 'create', ref: 'meet', type: 'event', title: 'Board meeting', props: { at: '2026-10-14T14:00:00Z', ends: '2026-10-14T15:30:00Z' } },
      { op: 'create', ref: 'later', type: 'event', title: 'Next year', props: { at: '2027-03-01T14:00:00Z' } },
      { op: 'create', ref: 'gym', type: 'routine', title: 'Gym', props: { from_time: '07:00', to_time: '08:00', days: [1, 3, 5], starts: '2026-10-01' } },
      { op: 'create', ref: 'loose', type: 'task', title: 'No date' },
    ],
  })) as { created: Record<string, string> };
  const kinds = ['task', 'event', 'routine'];
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

test('a window may be said from today, worked out in the zone', () => {
  const now = Date.parse('2026-10-29T02:00:00Z'); // still the 28th in Toronto
  assert.deepEqual(resolveAxis({ from: '-6d', to: '7d' }, 'America/Toronto', now), { from: '2026-10-22', to: '2026-11-04', zone: 'America/Toronto' });
  assert.deepEqual(resolveAxis({ from: 'today', to: '+0d' }, 'UTC', now), { from: '2026-10-29', to: '2026-10-29', zone: 'UTC' });
  assert.throws(() => resolveAxis({ from: '3d', to: '-3d' }, 'UTC', now), /comes after/);
});

test('a flat lens on a time axis places each item it sends, and says its window as dates', async () => {
  const l = await map();
  const made = (await l.change(human, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'gym', type: 'routine', title: 'Gym', props: { from_time: '07:00', to_time: '08:00', days: [1, 3, 5], starts: '2026-10-01' } },
      { op: 'create', ref: 'meet', type: 'event', title: 'Board meeting', props: { at: '2026-10-14T14:00:00Z', ends: '2026-10-14T15:30:00Z' } },
    ],
  })) as { created: Record<string, string> };
  const answer = (await flatLens(l, { filter: { types: ['routine', 'event'] }, time: { from: '2026-10-12', to: '2026-10-18' } })) as unknown as { lens: { time: unknown }; items: Item[] };
  const of = (ref: string) => answer.items.find((i) => i.id === made.created[ref]);
  assert.deepEqual(answer.lens.time, { from: '2026-10-12', to: '2026-10-18', zone: 'America/Toronto' }, 'its days counted in the workspace’s zone');
  assert.equal(of('gym')!.time!.length, 3, 'a repeat on each of its days');
  assert.deepEqual(of('meet')!.time, [{ start: '2026-10-14T14:00:00.000Z', end: '2026-10-14T15:30:00.000Z', by: 'when' }]);


  // Filed by who each is for: what no one holds is the workspace owner's, and the agents' sessions a lane of their own.
  const lanes = (await flatLens(l, { filter: { types: ['routine', 'event'] }, time: { from: '2026-10-12', to: '2026-10-18' } })) as unknown as { lanes: { key: string | null; title: string }[]; items: (Item & { lane?: string | null })[] };
  assert.deepEqual(lanes.lanes, [{ key: null, title: 'No one' }], 'with no owner set, what no one holds is no one’s');
  assert.ok(lanes.items.every((i) => i.lane === null));
  const alex = ((await l.change(human, { reason: 'test', ops: [{ op: 'create', type: 'person', title: 'Alex' }] })) as { created: Record<string, string> }).created['#1'];
  await l.db.query(`insert into setting (key, value) values ('me', $1::jsonb)`, [JSON.stringify(alex)]);
  const mine = (await flatLens(l, { filter: { types: ['routine'] }, time: { from: '2026-10-12', to: '2026-10-18' } })) as unknown as { lanes: unknown[]; items: { lane?: string }[] };
  assert.deepEqual([mine.lanes, mine.items[0].lane], [[{ key: alex, title: 'Alex' }], alex], 'the owner’s lane, by name');

  // Coloured by what it counts toward: the group it sits in just under the outermost item, named in streams.
  const set = ((await l.change(human, { reason: 'test', ops: [
    { op: 'create', ref: 'p', type: 'project', title: 'Launch' },
    { op: 'create', ref: 't', type: 'task', title: 'Rehearse' },
    { op: 'create', ref: 'e', type: 'event', title: 'Dress rehearsal', props: { at: '2026-10-15T14:00:00Z' } },
    { op: 'link', type: 'part_of', from: 't', to: 'p' },
    { op: 'link', type: 'part_of', from: 'e', to: 't' },
  ] })) as { created: Record<string, string> }).created;
  const coloured = (await flatLens(l, { filter: { types: ['event'] }, time: { from: '2026-10-12', to: '2026-10-18' } })) as unknown as { streams: { key: string; title: string }[]; items: { id: string; stream?: string | null }[] };
  assert.deepEqual(coloured.streams, [{ key: set.t, title: 'Rehearse' }]);
  assert.deepEqual([coloured.items.find((i) => i.id === set.e)!.stream, coloured.items.find((i) => i.id === made.created.meet)!.stream], [set.t, null], 'what sits in nothing counts toward nothing');

  const plain = (await flatLens(l, { filter: { types: ['routine'] } })) as unknown as { lens: { time?: unknown }; items: Item[] };
  assert.equal(plain.lens.time, undefined, 'no window, no axis');
  assert.equal(plain.items[0].time, undefined);
  await assert.rejects(flatLens(l, { filter: { types: ['routine'] }, time: { from: 'soon', to: '7d' } }), /time is/);
});
