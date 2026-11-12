// One read of an island's findings, for both (packs/views/kernel/findings.ts, task e_p27ddjqt): the brief of an island lists the open
// findings it stands by (marked published), one row each (claim, value with its unit, how sure, as of, how many read
// it), as data the island's page and shore draw and as one line each in its text, then its working findings apart; in
// place of the traps and reporting a task's brief gives.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setIslands } from '../packs/loader/kernel/packstate.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { fresh, human, make } from './map.ts';

type Row = { id: string; title: string; value?: string; confidence: number; as_of?: string; readers: number };
type Brief = { text: string; findings?: Row[]; working?: Row[]; traps?: unknown };

test('the brief of an island is what it publishes, most read first, its working findings apart', async () => {
  const l = await fresh();
  await setIslands(l, human, true);
  const { a, b } = await make(l, [
    { op: 'create', ref: 'a', type: 'island', title: 'Costs', props: { pack: 'core' } },
    { op: 'create', ref: 'b', type: 'island', title: 'Plans', props: { pack: 'core' } },
  ]);
  const { host, dark, draft, gone, budget } = await make(l, [
    { op: 'create', ref: 'host', type: 'finding', title: 'Hosting costs 400 a month', confidence: 0.8, props: { value: 400, value_type: 'number', unit: 'EUR', as_of: '2026-11-04', published: true, island: a } },
    { op: 'create', ref: 'dark', type: 'finding', title: 'Dark mode ships', props: { value: true, value_type: 'boolean', as_of: '2026-11-01', published: true, island: a } },
    { op: 'create', ref: 'draft', type: 'finding', title: 'Peak load is 42 kW', confidence: 0.5, props: { value: 42, value_type: 'number', unit: 'kW', as_of: '2026-11-08', island: a } },
    { op: 'create', ref: 'gone', type: 'finding', title: 'An old claim is x', props: { value: 'x', value_type: 'text', published: true, island: a } },
    { op: 'create', ref: 'budget', type: 'task', title: 'Set the budget', props: { island: b } },
    { op: 'link', type: 'reads', from: 'budget', to: 'host' },
  ]);
  await make(l, [{ op: 'update', id: gone, status: 'withdrawn' }]);

  const brief = (await callTool(l, human, 'view', { name: 'brief', params: { task: a } })) as Brief;
  assert.deepEqual(brief.findings, [
    { id: host, title: 'Hosting costs 400 a month', value: '400 EUR', confidence: 0.8, as_of: '2026-11-04', readers: 1 },
    { id: dark, title: 'Dark mode ships', value: 'yes', confidence: 1, as_of: '2026-11-01', readers: 0 },
  ], 'published and open only, most read first, a number with its unit, a boolean as yes or no');
  assert.deepEqual(brief.working, [{ id: draft, title: 'Peak load is 42 kW', value: '42 kW', confidence: 0.5, as_of: '2026-11-08', readers: 0 }], 'a working finding apart');
  assert.match(brief.text, /## Published \(2\)\n- Hosting costs 400 a month: 400 EUR · sure 0\.8 · as of 2026-11-04 · 1 read · e_\w+\n- Dark mode ships: yes · as of/);
  assert.match(brief.text, /## Working, read here only \(1\)\n- Peak load is 42 kW: 42 kW · sure 0\.5/);
  assert.ok(brief.text.indexOf('## Published') < brief.text.indexOf('## Working'), 'what it stands by first');
  assert.equal(brief.traps, undefined, 'no traps for an island');
  assert.doesNotMatch(brief.text, /## Reporting/);

  // An island with none says so; a task's brief has no findings at all.
  const none = (await callTool(l, human, 'view', { name: 'brief', params: { task: b } })) as Brief;
  assert.deepEqual(none.findings, []);
  assert.equal(none.working, undefined);
  assert.match(none.text, /## Published \(0\)\nNone/);
  const task = (await callTool(l, human, 'view', { name: 'brief', params: { task: budget } })) as Brief;
  assert.equal(task.findings, undefined);
  assert.match(task.text, /## Reporting/);
});
