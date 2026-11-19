import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countsOf, countsRow, rowsOf, RUNS_SHOWN } from './rows.js';

const item = { id: 'e_one', type: 'reflex', title: 'Short titles', status: 'trial' };
const record = {
  id: 'e_one', said: 3, runs: 2, places: { session_start: 2, 'file:src/a.ts': 1 }, last: '2026-11-19T11:00:00Z', failed: 1, held: 1, quiet: 0, tier: 'learned',
  per_run: [
    { run: 'e_r1', said_at: '2026-11-19T10:00:00Z', said: 2, before: 0, after: 1, verdict: 'failed' },
    { run: 'e_r2', said_at: '2026-11-19T11:00:00Z', said: 1, before: 1, after: 0, verdict: 'held' },
  ],
};

test('the counts row is the instruction with how often it was said and how its runs went', () => {
  const row = countsRow(item, record);
  assert.equal(row.id, 'e_one');
  assert.deepEqual(row.marks.map((m: { text?: string }) => m.text), ['3×', '↺ 1', '✓ 1', undefined]);
  assert.match(row.marks[0].tip, /Said 3 times to 2 runs: session_start 2, file:src\/a.ts 1/);
  assert.deepEqual(countsRow(item, undefined).marks.map((m: { text?: string }) => m.text), ['0×'], 'one never said reads as such');
});

test('then each run, the newest first, named, with what became of its miss', () => {
  const rows = rowsOf(item, record, [{ id: 'e_r1', type: 'run', title: 'Session one' }]);
  assert.deepEqual(rows.slice(1).map((r: { id: string; title: string }) => [r.id, r.title]), [['e_r2', 'e_r2'], ['e_r1', 'Session one']]);
  assert.deepEqual(rows[2].marks.map((m: { text?: string }) => m.text), ['↺', '2×', undefined]);
  const many = { ...record, per_run: Array.from({ length: RUNS_SHOWN + 5 }, (_, i) => ({ ...record.per_run[0], run: `e_r${i}`, said_at: `2026-11-${String(i + 1).padStart(2, '0')}T00:00:00Z` })) };
  assert.equal(rowsOf(item, many, []).length, RUNS_SHOWN + 1);
});

test("counts for the drawing: one per id asked, an owner's version under its preset's id, none read as zeros", async () => {
  const asked: string[][] = [];
  const read = async (ids: string[]) => (asked.push(ids), [{ ...record, id: 'core.estimate' }]);
  const counts = await countsOf(['e_mine', 'e_never'], [{ id: 'e_mine', status: 'current', props: { preset: 'core.estimate', for: ['file:packs/*/page/*.js'] } }], read);
  assert.deepEqual(asked, [['core.estimate', 'e_never']]);
  assert.deepEqual(counts, [
    { id: 'e_mine', said: 3, runs: 2, places: record.places, last: record.last, failed: 1, held: 1, quiet: 0, tier: 'learned', status: 'current', for: ['file:packs/*/page/*.js'], per_run: [{ said_at: '2026-11-19T10:00:00Z', verdict: 'failed' }, { said_at: '2026-11-19T11:00:00Z', verdict: 'held' }] },
    { id: 'e_never', said: 0, runs: 0, places: {}, failed: 0, held: 0, quiet: 0, per_run: [] },
  ]);
});
