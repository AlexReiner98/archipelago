// One read of an island's findings, for both (src/findings.ts, task e_p27ddjqt): the brief of an island lists its open
// findings, one row each (claim, value with its unit, how sure, as of, how many read it), as data the island's page
// draws and as one line each in its text, in place of the traps and reporting a task's brief gives.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setIslands } from '../src/packstate.ts';
import { callTool } from '../src/tools.ts';
import { fresh, human, make } from './map.ts';

type Brief = { text: string; findings?: { id: string; title: string; value?: string; confidence: number; as_of?: string; readers: number }[]; traps?: unknown };

test('the brief of an island is its findings, one line each, most read first', async () => {
  const l = await fresh();
  await setIslands(l, human, true);
  const { a, b } = await make(l, [
    { op: 'create', ref: 'a', type: 'island', title: 'Costs', props: { pack: 'core' } },
    { op: 'create', ref: 'b', type: 'island', title: 'Plans', props: { pack: 'core' } },
  ]);
  const { host, dark, gone, budget } = await make(l, [
    { op: 'create', ref: 'host', type: 'finding', title: 'Hosting costs 400 a month', confidence: 0.8, props: { value: 400, value_type: 'number', as_of: '2026-11-04', island: a } },
    { op: 'create', ref: 'dark', type: 'finding', title: 'Dark mode ships', props: { value: true, value_type: 'boolean', as_of: '2026-11-01', island: a } },
    { op: 'create', ref: 'gone', type: 'finding', title: 'An old claim', props: { value: 'x', value_type: 'text', island: a } },
    { op: 'create', ref: 'budget', type: 'task', title: 'Set the budget', props: { island: b } },
    { op: 'link', type: 'reads', from: 'budget', to: 'host' },
  ]);
  await make(l, [{ op: 'update', id: gone, status: 'withdrawn' }]);

  const brief = (await callTool(l, human, 'view', { name: 'brief', params: { task: a } })) as Brief;
  assert.deepEqual(brief.findings, [
    { id: host, title: 'Hosting costs 400 a month', value: '400', confidence: 0.8, as_of: '2026-11-04', readers: 1 },
    { id: dark, title: 'Dark mode ships', value: 'yes', confidence: 1, as_of: '2026-11-01', readers: 0 },
  ], 'open findings only, most read first, a boolean as yes or no');
  assert.match(brief.text, /## Findings \(2\)\n- Hosting costs 400 a month: 400 · sure 0\.8 · as of 2026-11-04 · 1 read · e_\w+\n- Dark mode ships: yes/);
  assert.equal(brief.traps, undefined, 'no traps for an island');
  assert.doesNotMatch(brief.text, /## Reporting/);

  // An island with none says so; a task's brief has no findings at all.
  const none = (await callTool(l, human, 'view', { name: 'brief', params: { task: b } })) as Brief;
  assert.deepEqual(none.findings, []);
  assert.match(none.text, /## Findings \(0\)\nNone published\./);
  const task = (await callTool(l, human, 'view', { name: 'brief', params: { task: budget } })) as Brief;
  assert.equal(task.findings, undefined);
  assert.match(task.text, /## Reporting/);
});
