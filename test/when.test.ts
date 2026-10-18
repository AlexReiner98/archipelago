// The view every item with dated things in it has: when what is in it happens, by day, each person a lane.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDb } from '../src/db.ts';
import '../src/views.ts';
import { lens } from '../src/lens.ts';
import { IN, WHEN, thisWeek } from '../src/lens-when.ts';
import { Archipelago, type Actor } from '../src/pelago.ts';
import { Registry } from '../src/packs.ts';

const human: Actor = { kind: 'human', name: 'test' };

async function map() {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-when-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), dir, { recursive: true });
  return new Archipelago(await openDb(), new Registry(dir));
}

type Answer = { items: { id: string; lane?: string | null; time?: unknown[] }[]; lanes?: { key: string | null; title: string }[]; views: { id: string }[]; view: string | null; style: Record<string, unknown>; controls: string[]; lens: { time?: { from: string; to: string } } };

test('the week holds today, Monday to Sunday', () => {
  // Saturday 17 Oct 2026, noon in Toronto.
  assert.deepEqual(thisWeek('America/Toronto', Date.parse('2026-10-17T16:00:00Z')), { from: '2026-10-12', to: '2026-10-18' });
  // Monday stays Monday.
  assert.deepEqual(thisWeek('America/Toronto', Date.parse('2026-10-12T16:00:00Z')), { from: '2026-10-12', to: '2026-10-18' });
});

test('an item with dated things in it has a When view: what is in it in a week, each person a lane', async () => {
  const l = await map();
  const { from, to } = thisWeek('America/Toronto');
  const { created: c } = (await l.change(human, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'alex', type: 'person', title: 'Alex' },
      { op: 'create', ref: 'p', type: 'work.project', title: 'Product' },
      { op: 'create', ref: 'due', type: 'work.task', title: 'Due this week', owner: 'alex', props: { due: from } },
      { op: 'create', ref: 'later', type: 'work.task', title: 'Due next year', props: { due: '2027-09-01' } },
      { op: 'create', ref: 'loose', type: 'work.task', title: 'No date' },
      { op: 'create', ref: 'meet', type: 'event', title: 'Review', props: { at: `${to}T15:00:00Z`, ends: `${to}T16:00:00Z` } },
      { op: 'create', ref: 'bare', type: 'work.project', title: 'Nothing dated' },
      { op: 'create', ref: 'idle', type: 'work.task', title: 'Undated' },
      ...['due', 'later', 'loose', 'meet'].map((from) => ({ op: 'link' as const, type: 'part_of', from, to: 'p' })),
      { op: 'link', type: 'part_of', from: 'idle', to: 'bare' },
    ],
  })) as { created: Record<string, string> };

  // Offered, not opened on: the project still opens on what is in it.
  const opened = (await lens(l, { from: c.p })) as Answer;
  assert.ok(opened.views.some((v) => v.id === WHEN));
  assert.equal(opened.view, null);
  assert.ok(!((await lens(l, { from: c.bare })) as Answer).views.some((v) => v.id === WHEN), 'nothing in it is dated');

  const when = (await lens(l, { from: c.p, lens: WHEN })) as Answer;
  assert.equal(when.view, WHEN);
  assert.deepEqual(when.lens.time, { from, to });
  assert.deepEqual([when.style.shape, when.style.layout], ['time', 'calendar']);
  assert.deepEqual(when.controls, ['time']);
  const ids = new Set(when.items.map((i) => i.id));
  assert.ok(ids.has(c.due) && ids.has(c.meet), 'what falls in the week');
  assert.ok(!ids.has(c.later) && !ids.has(c.loose), 'not what falls outside it or has no date');
  assert.equal(when.items.find((i) => i.id === c.due)!.lane, c.alex);
  assert.deepEqual(when.lanes, [{ key: c.alex, title: 'Alex' }, { key: null, title: 'No one' }], 'people by name, then what no one holds');

  // Another week, asked for by the page.
  const next = (await lens(l, { from: c.p, lens: WHEN, time: { from: '2027-08-30', to: '2027-09-05' } })) as Answer;
  assert.deepEqual(next.items.filter((i) => i.id !== c.p).map((i) => i.id), [c.later]);

  // What is in it, asked for by name, is the picture with no view: no time axis, no lanes.
  const inside = (await lens(l, { from: c.p, lens: IN })) as Answer;
  assert.equal(inside.view, null);
  assert.equal(inside.lens.time, undefined);
  assert.ok(inside.items.some((i) => i.id === c.loose));
});
