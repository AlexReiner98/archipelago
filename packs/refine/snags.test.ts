// Snags grouped by what they touched (snags.js), tested without a database: open snags and the runs that wrote
// them in, groups out. What a touches value reads as, then the grouping, its order and counts, then the runs.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { TOUCHES, TOUCH_KINDS, snagsOf, touchesOf } from './snags.js';

test('a touches value reads as its kind:ref parts, each once, the malformed left out', () => {
  assert.deepEqual(touchesOf('tool:change rule:finding_note'), ['tool:change', 'rule:finding_note']);
  assert.deepEqual(touchesOf('pack:core, tool:query,pack:core'), ['pack:core', 'tool:query']);
  assert.deepEqual(touchesOf(['tool:change', 'nonsense', 'tool:', ':x', 'colour:red']), ['tool:change']);
  assert.deepEqual(touchesOf(undefined), []);
  assert.deepEqual(touchesOf(42), []);
  assert.ok(TOUCH_KINDS.includes('instruction'));
});

test('the form the rule holds a value to is the one touchesOf reads', () => {
  for (const ok of ['pack:core', 'tool:change rule:finding_note', 'pack:core, tool:query', ' hook:Stop ']) assert.ok(TOUCHES.test(ok), ok);
  for (const bad of ['', 'bad', 'tool:', 'pack:core junk', 'colour:red']) assert.ok(!TOUCHES.test(bad), bad);
});

test('open snags are grouped by what they touched, the most first, a snag in each group it names', () => {
  const answer = snagsOf([
    { id: 'a', title: 'Change refused a finding note', type: 'issue', status: 'open', severity: 'medium', touches: 'tool:change rule:finding_note' },
    { id: 'b', title: 'Change resends a whole body', type: 'issue', status: 'open', severity: 'high', touches: 'tool:change' },
    { id: 'c', title: 'Handoff is too large', type: 'finding', status: 'current', severity: 'low', touches: 'view:handoff' },
    { id: 'd', title: 'Something vague', type: 'issue', status: 'open' },
  ]);
  assert.equal(answer.open, 4);
  assert.deepEqual(answer.groups.map((g: { touches: string; count: number }) => [g.touches, g.count]), [['tool:change', 2], ['rule:finding_note', 1], ['view:handoff', 1]]);
  const change = answer.groups[0];
  assert.equal(change.kind, 'tool');
  assert.equal(change.ref, 'change');
  assert.equal(change.severity, 'high', 'a group carries its heaviest snag');
  assert.deepEqual(change.snags.map((s: { id: string }) => s.id), ['b', 'a'], 'the heaviest first');
  assert.deepEqual(answer.kinds, { tool: 2, rule: 1, view: 1 });
  assert.deepEqual(answer.untouched, { count: 1, snags: [{ id: 'd', title: 'Something vague', type: 'issue', status: 'open' }] });
});

test('a group names the runs that wrote its snags, each once, with the packs they ran under', () => {
  const answer = snagsOf(
    [
      { id: 'a', title: 'A', type: 'issue', status: 'open', touches: 'tool:change' },
      { id: 'b', title: 'B', type: 'issue', status: 'open', touches: 'tool:change pack:core' },
    ],
    [
      { snag: 'a', id: 'r1', title: 'First session', packs: { core: '0.4.0' } },
      { snag: 'a', id: 'r1', title: 'First session' },
      { snag: 'b', id: 'r1', title: 'First session' },
      { snag: 'b', id: 'r2', title: 'Second session' },
      { snag: 'gone', id: 'r3' },
    ],
  );
  const by = Object.fromEntries(answer.groups.map((g: { touches: string; runs: { id: string }[] }) => [g.touches, g.runs]));
  assert.deepEqual(by['tool:change'], [{ id: 'r1', title: 'First session', packs: { core: '0.4.0' } }, { id: 'r2', title: 'Second session' }]);
  assert.deepEqual(by['pack:core'].map((r: { id: string }) => r.id), ['r1', 'r2']);
});

test('nothing open is an empty answer', () => {
  assert.deepEqual(snagsOf([], []), { open: 0, kinds: {}, groups: [], untouched: { count: 0, snags: [] } });
});

test('the view reads open snags of its types, keeps those that name what they touched, and asks who wrote them', async () => {
  // @ts-expect-error: the pack's handler, a plain module.
  const { default: handler } = await import('./handler.js');
  const asked: unknown[] = [];
  const read = async (q: Record<string, any>) => {
    asked.push(q);
    if (q.with_field) return q.with_field === 'touches' ? ['issue'] : [];
    if (q.type_info) return q.type_info === 'issue' ? { statuses: { open: ['open', 'investigating'], closed: ['resolved'] } } : null;
    if (q.items) return [
      { id: 'a', title: 'A', type: 'issue', status: 'open', props: { touches: 'tool:change', severity: 'high' } },
      { id: 'b', title: 'B', type: 'issue', status: 'open', props: {} },
    ];
    if (q.scope) return [
      { id: 'hub', title: 'Friction', type: 'feature', status: 'building', props: {} },
      { id: 'a', title: 'A', type: 'issue', status: 'open', props: { touches: 'tool:change' } },
      { id: 'b', title: 'B', type: 'issue', status: 'open', props: {} },
    ];
    if (q.writers) return q.writers.map((item: string) => ({ item, run: 'r1', title: 'A session', packs: [{ id: 'refine', version: '0.1.0' }] }));
    throw new Error(`unexpected read ${JSON.stringify(q)}`);
  };
  const { answer } = await handler['refine.snags']({}, { read });
  assert.deepEqual(answer.groups.map((g: { touches: string; count: number }) => [g.touches, g.count]), [['tool:change', 1]]);
  assert.deepEqual(answer.groups[0].runs, [{ id: 'r1', title: 'A session', packs: [{ id: 'refine', version: '0.1.0' }] }]);
  assert.deepEqual(asked.find((q: any) => q.items), { items: { type: 'issue', status: ['open', 'investigating'] }, fields: ['touches', 'severity'] });
  assert.deepEqual(asked.find((q: any) => q.writers), { writers: ['a'] }, 'only the snags kept are asked about');

  const inside = (await handler['refine.snags']({ within: 'hub', types: ['issue'] }, { read })).answer;
  assert.equal(inside.within, 'hub');
  assert.equal(inside.open, 2, 'the item asked within is not a snag of itself');
  assert.deepEqual(inside.untouched.snags.map((s: { id: string }) => s.id), ['b']);
});
