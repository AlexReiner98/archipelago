// A plan written as one long note on a work item with no parts is said back in the change's answer (issue e_mesewchn).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planAsText, sections } from '../src/plan-note.ts';
import { WRITE_TOOLS } from '../src/tool-change.ts';
import { fresh } from './map.ts';

const plan = 'Why.\n\n## One\nx\n## Two\ny\n## Three\nz\n## Four\nw';

test('a work note of four sections with no parts is a plan as text; with parts, fewer sections or not work, it is not', () => {
  assert.equal(sections(plan), 4);
  assert.equal(sections('# Title\n### Sub\nnot ## here'), 0);
  assert.match(planAsText([{ at: 1, op: 'create', body: plan, work: true, parts: false }])!, /op 1 \(create\): 4 sections.*depends_on.*flow view/);
  assert.equal(planAsText([{ at: 1, op: 'create', body: plan, work: true, parts: true }]), undefined);
  assert.equal(planAsText([{ at: 1, op: 'create', body: plan, work: false, parts: false }]), undefined);
  assert.equal(planAsText([{ at: 1, op: 'create', body: '## One\n## Two', work: true, parts: false }]), undefined);
});

test('change says it back to an agent, and not when the steps are made as parts', async () => {
  const l = await fresh();
  const agent = { kind: 'agent', name: 'tester' } as never;
  const alone = (await WRITE_TOOLS.change.run(l, agent, { reason: 'test', ops: [{ op: 'create', ref: 't', type: 'task', title: 'Build it', body: plan }] })) as { plan?: string };
  assert.match(alone.plan ?? '', /no parts/);
  const laid = (await WRITE_TOOLS.change.run(l, agent, {
    reason: 'test',
    ops: [{ op: 'create', ref: 't', type: 'task', title: 'Build it', body: plan }, { op: 'create', ref: 's', type: 'task', title: 'Step one' }, { op: 'link', type: 'part_of', from: 's', to: 't' }],
  })) as { plan?: string };
  assert.equal(laid.plan, undefined);
});
