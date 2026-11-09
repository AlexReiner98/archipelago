// A hypothesis is a question the science pack settles by evidence: it is unsettled in its project until it is, and an
// agent only proposes settling it.

import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { test } from 'node:test';
import { agent, call, human, make, mapWith, type Archipelago } from '#pelago/test';

/** A fresh in-memory map with the packs beside this one. */
const fresh = () => mapWith(dirname(import.meta.dirname));
const attend = async (l: Archipelago, params: Record<string, unknown>) => (await call(l, human, 'view', { name: 'attention', params })) as { items: { title: string; reasons: { why: string; by?: string }[] }[] };

test('a hypothesis work assumes is unsettled in its project by evidence, beside a decision unsettled by word', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'Proj' },
    { op: 'create', ref: 't', type: 'task', title: 'Task' },
    { op: 'create', ref: 'd', type: 'decision', title: 'Which way?' },
    { op: 'create', ref: 'hyp', type: 'hypothesis', title: 'Hyp' },
    { op: 'create', ref: 'exp', type: 'experiment', title: 'Try it' },
    { op: 'link', type: 'part_of', from: 't', to: 'p' },
    { op: 'link', type: 'part_of', from: 'd', to: 'p' },
    { op: 'link', type: 'part_of', from: 'hyp', to: 'p' },
    { op: 'link', type: 'assumes', from: 't', to: 'hyp' },
    { op: 'link', type: 'tests', from: 'exp', to: 'hyp' },
  ]);
  const unsettled = (await attend(l, { within: made.p, reasons: ['unsettled'] })).items;
  assert.deepEqual(unsettled.map((x) => x.title).sort(), ['Hyp', 'Which way?']);
  assert.deepEqual(unsettled.find((x) => x.title === 'Hyp')!.reasons, [{ why: 'unsettled', by: 'evidence' }]);
  assert.deepEqual(unsettled.find((x) => x.title === 'Which way?')!.reasons, [{ why: 'unsettled', by: 'word' }]);
});

test('an agent only proposes settling a hypothesis; the human settles it', async () => {
  const l = await fresh();
  const made = await make(l, [{ op: 'create', ref: 'h', type: 'hypothesis', title: 'Hooks run in the desktop app' }]);
  const settled = l.registry.type('hypothesis')!.statuses.closed[0];
  assert.equal((await l.change(agent, { reason: 'seen twice', ops: [{ op: 'update', id: made.h, status: settled }] })).status, 'proposed');
  assert.equal((await l.change(human, { reason: 'mine to settle', ops: [{ op: 'update', id: made.h, status: settled }] })).status, 'applied');
});
