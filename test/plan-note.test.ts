// A structure (a plan, findings, options) written as one long note on an item with few parts is said back in the
// change's answer (issues e_mesewchn, e_sm2sa75h).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sections, structureAsText } from '../src/plan-note.ts';
import { WRITE_TOOLS } from '../src/tool-change.ts';
import { fresh, make } from './map.ts';

const plan = 'Why.\n\n## One\nx\n## Two\ny\n## Three\nz\n## Four\nw';

test('a note of four sections with fewer items tied to it is a structure as text; with as many tied or fewer sections, it is not', () => {
  assert.equal(sections(plan), 4);
  assert.equal(sections('# Title\n### Sub\nnot ## here'), 0);
  assert.match(structureAsText([{ at: 1, op: 'create', body: plan, ties: 0 }])!, /op 1 \(create\): 4 sections, 0 items.*bears_on.*view/);
  assert.match(structureAsText([{ at: 1, op: 'update', body: plan, ties: 3 }])!, /3 items tied/);
  assert.equal(structureAsText([{ at: 1, op: 'create', body: plan, ties: 4 }]), undefined);
  assert.equal(structureAsText([{ at: 1, op: 'create', body: '## One\n## Two', ties: 0 }]), undefined);
});

test('change says it back to an agent on a plan and on findings, and not when the pieces are made as items', async () => {
  const l = await fresh();
  const agent = { kind: 'agent', name: 'tester' } as never;
  const run = (ops: unknown[]) => WRITE_TOOLS.change.run(l, agent, { reason: 'test', ops }) as Promise<{ structure?: string }>;
  assert.match((await run([{ op: 'create', ref: 't', type: 'task', title: 'Build it', body: plan }])).structure ?? '', /0 items tied/);
  const steps = [1, 2, 3, 4].flatMap((n) => [{ op: 'create', ref: `s${n}`, type: 'task', title: `Step ${n}` }, { op: 'link', type: 'part_of', from: `s${n}`, to: 't' }]);
  assert.equal((await run([{ op: 'create', ref: 't', type: 'task', title: 'Build it', body: plan }, ...steps])).structure, undefined);

  // Findings appended to a question, not a work item: said back, and not once its options bear on it.
  const { q } = await make(l, [{ op: 'create', ref: 'q', type: 'question', title: 'Which way?' }]);
  assert.match((await run([{ op: 'update', id: q!, append: plan }])).structure ?? '', /op 1 \(update\): 4 sections/);
  const { q: q2 } = await make(l, [{ op: 'create', ref: 'q', type: 'question', title: 'Which other way?' }]);
  await make(l, [1, 2, 3, 4].flatMap((n) => [{ op: 'create', ref: `o${n}`, type: 'finding', title: `Option ${n}` }, { op: 'link', type: 'bears_on', from: `o${n}`, to: q2! }]) as never);
  assert.equal((await run([{ op: 'update', id: q2!, append: plan }])).structure, undefined);
});
