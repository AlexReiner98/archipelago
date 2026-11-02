// The science pack's views, tested without a database: the refuted hypotheses and what assumes them are fixtures.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from './handler.js';

type Item = { id: string; type: string; title: string; status: string; is_open: boolean };

function ctxOver(hypotheses: Item[], assuming: Record<string, Item[]>) {
  const asked: Record<string, unknown>[] = [];
  return {
    asked,
    ctx: {
      now: '2026-10-17T12:00:00Z',
      zone: 'America/Toronto',
      read: async (q: Record<string, any>) => {
        asked.push(q);
        if (q.items?.type === 'hypothesis') return hypotheses.filter((h) => h.status === q.items.status);
        if (q.related && q.relation === 'assumes' && q.direction === 'in') return assuming[q.related] ?? [];
        throw new Error(`no read ${JSON.stringify(q)}`);
      },
    },
  };
}

test('open work resting on a refuted hypothesis, once each, named with what it assumed', async () => {
  const h = (id: string, title: string, status: string): Item => ({ id, type: 'hypothesis', title, status, is_open: status === 'untested' });
  const t = (id: string, title: string, is_open = true): Item => ({ id, type: 'task', title, status: is_open ? 'todo' : 'done', is_open });
  const { ctx } = ctxOver(
    [h('h1', 'People read the blog', 'refuted'), h('h2', 'Gas is cheaper', 'refuted'), h('h3', 'Still open', 'untested')],
    { h1: [t('a', 'Write a post'), t('b', 'Old post', false)], h2: [t('a', 'Write a post'), t('c', 'Buy the van')], h3: [t('d', 'Not at risk')] },
  );
  const { answer } = await handler['science.undermined']({}, ctx);
  assert.deepEqual(
    answer.map((r: { id: string; title: string }) => [r.id, r.title]),
    [
      ['a', 'Write a post · assumes People read the blog'],
      ['c', 'Buy the van · assumes Gas is cheaper'],
    ],
  );
});

/** A small map: items by id (each with what it is), and links as [type, from, to]. */
function mapCtx(items: Record<string, any>[], links: [string, string, string][], runs: Record<string, any>[] = []) {
  const byId = new Map(items.map((i) => [i.id, { is_open: true, created_at: '2026-03-01T00:00:00Z', props: {}, ...i, is: i.is ?? [i.type] }]));
  const under = (ids: string[]) => {
    const out = new Set(ids);
    for (let grew = true; grew; ) {
      grew = false;
      for (const [type, from, to] of links) if (type === 'part_of' && out.has(to) && !out.has(from)) (out.add(from), (grew = true));
    }
    return [...out].map((id) => byId.get(id)).filter(Boolean);
  };
  return {
    now: '2026-11-02T12:00:00Z',
    zone: 'America/Toronto',
    read: async (q: Record<string, any>) => {
      if (q.get) return byId.get(q.get) ?? null;
      if (q.items) return [...byId.values()].filter((i) => i.is.includes(q.items.type));
      if (q.placed) return runs.map((r) => ({ ...r, time: r.time.filter((s: any) => s.start >= q.placed.from && s.start < q.placed.to) }));
      if (q.parts_of) return under(q.parts_of);
      if (q.related) {
        const ends = links.filter(([type, from, to]) => type === q.relation && (q.direction === 'in' ? to === q.related : from === q.related)).map(([, from, to]) => (q.direction === 'in' ? from : to));
        return ends.map((id) => byId.get(id)).filter((i) => i && (!q.types || q.types.some((t: string) => i.is.includes(t))));
      }
      throw new Error(`no read ${JSON.stringify(q)}`);
    },
  };
}

const seeded = () =>
  mapCtx(
    [
      { id: 'inv', type: 'investigation', is: ['investigation', 'project', 'work'], title: 'Replay a log fast', props: { baseline: 'Event stores replay in minutes. None fits a laptop.' } },
      { id: 'h1', type: 'hypothesis', title: 'Facts replay in under a second', status: 'supported', props: { prediction: 'A 100k-fact log rebuilds in < 1 s.' } },
      { id: 'x1', type: 'experiment', is: ['experiment', 'task', 'work'], title: 'Replay 100k facts', status: 'done', props: { method: 'Rebuild from an empty database, ten times.' } },
      { id: 'x2', type: 'experiment', is: ['experiment', 'task', 'work'], title: 'Replay on Postgres', status: 'todo' },
      { id: 't1', type: 'time_entry', status: 'logged', owner: 'alex', props: { date: '2026-04-02', hours: 3 } },
      { id: 't2', type: 'time_entry', status: 'logged', owner: 'alex', props: { start: '2026-04-03T13:00:00Z', end: '2026-04-03T14:30:00Z' } },
      { id: 't3', type: 'time_entry', status: 'logged', owner: 'alex', props: { date: '2025-12-30', hours: 9 } },
      { id: 't4', type: 'time_entry', status: 'planned', owner: 'alex', props: { date: '2026-04-04', hours: 9 } },
      { id: 't5', type: 'time_entry', status: 'logged', owner: 'alex', props: { date: '2026-05-01', hours: 1 } },
      { id: 'r1', type: 'result', title: 'Rebuilt in 0.4 s', status: 'recorded', props: { value: '0.4 s for 100k facts', measured_on: '2026-04-03' } },
      { id: 'c1', type: 'commit', is: ['commit', 'record'], title: 'Replay in batches', created_at: '2026-04-03T15:00:00Z', props: { sha: 'abc123' } },
      { id: 'alex', type: 'person', title: 'Alex' },
    ],
    [
      ['part_of', 'h1', 'inv'], ['part_of', 'x1', 'inv'], ['tests', 'x1', 'h1'], ['tests', 'x2', 'h1'], ['part_of', 'r1', 'x1'], ['supports', 'r1', 'h1'],
      ['part_of', 't1', 'x1'], ['part_of', 't2', 'x1'], ['part_of', 't3', 'x1'], ['part_of', 't4', 'x1'], ['part_of', 't5', 'inv'], ['settles', 'c1', 'x1'],
    ],
    [{ id: 'run1', type: 'run', time: [{ start: '2026-04-03T10:00:00Z', end: '2026-04-03T12:00:00Z', on: 'x1' }, { start: '2026-04-03T12:00:00Z', end: '2026-04-03T12:30:00Z', on: 'elsewhere' }] }],
  );

test('a record over a year: what was uncertain, what was done with its hours and commits, what was learned', async () => {
  const { answer } = await handler['science.record']({ year: '2026' }, seeded());
  assert.equal(answer.year, '2026');
  const [inv] = answer.investigations;
  assert.equal(inv.baseline, 'Event stores replay in minutes.');
  assert.deepEqual(inv.uncertain.map((h: any) => [h.title, h.prediction]), [['Facts replay in under a second', 'A 100k-fact log rebuilds in < 1 s.']]);
  const [x1, x2] = inv.done;
  assert.deepEqual([x1.id, x1.hours, x1.commits.map((c: any) => c.sha), x1.tests], ['x1', { people: { Alex: 4.5 }, agents: 2 }, ['abc123'], ['h1']], 'logged hours in the year by person, planned and last year left out; the session on it');
  assert.equal(x1.method, 'Rebuild from an empty database, ten times.');
  assert.deepEqual([x2.id, x2.hours], ['x2', { people: {}, agents: 0 }], 'an experiment that tests one of its hypotheses, part of it or not');
  assert.deepEqual(inv.outside, { people: { Alex: 1 }, agents: 0 }, 'what was logged on the investigation itself');
  assert.deepEqual(inv.hours, { people: { Alex: 5.5 }, agents: 2, people_total: 5.5 });
  assert.equal(inv.commits, 1);
  assert.deepEqual(inv.learned.map((r: any) => [r.value, r.supports, r.refutes]), [['0.4 s for 100k facts', ['h1'], []]]);
  assert.deepEqual(inv.unlogged, ['x2']);
});

test('a year with nothing done in it leaves the investigation out; all of it counts the year before', async () => {
  assert.deepEqual((await handler['science.record']({ year: '2024' }, seeded())).answer.investigations, []);
  const [all] = (await handler['science.record']({}, seeded())).answer.investigations;
  assert.equal(all.hours.people_total, 14.5);
  await assert.rejects(handler['science.record']({ year: 'last' }, seeded()), /year is a year/);
  await assert.rejects(handler['science.record']({ of: 'x1' }, seeded()), /not an investigation/);
});

test('the record as rows: each investigation with its totals, then each hypothesis, experiment and result, one line each', async () => {
  const { answer } = await handler['science.record_rows']({}, seeded());
  assert.deepEqual(answer, [
    { id: 'inv', type: 'investigation', title: 'Replay a log fast · 5.5 h · agents 2 h · 1 commit · 1 unlogged', status: undefined },
    { id: 'h1', type: 'hypothesis', title: 'Facts replay in under a second', status: 'supported' },
    { id: 'x1', type: 'experiment', title: 'Replay 100k facts · 4.5 h · agents 2 h · 1 commit', status: 'done' },
    { id: 'x2', type: 'experiment', title: 'Replay on Postgres', status: 'todo' },
    { id: 'r1', type: 'result', title: '0.4 s for 100k facts · supports Facts replay in under a second', status: 'recorded' },
  ], "this year's, without a year");
  const all = (await handler['science.record_rows']({ of: 'inv' }, seeded())).answer;
  assert.equal(all[0].title, 'Replay a log fast · 14.5 h · agents 2 h · 1 commit · 1 unlogged', 'one investigation, all of it');
});
