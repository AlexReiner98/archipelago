// The software pack's roadmap: a project's features in order as a tree, progress rolled up, and where work is happening.

import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { test } from 'node:test';
import { agent, call, human, make, mapWith, type Archipelago, type Op } from '#pelago/test';

/** A fresh in-memory map with the packs beside this one. */
const fresh = () => mapWith(dirname(import.meta.dirname));
/** A view asked by its name, as the view tool asks it. */
const ask = (l: Archipelago, name: string, params: Record<string, unknown> = {}) => call(l, human, 'view', { name, params });

test('the roadmap tree orders a project\'s features, rolls up progress, and shows where work is happening', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'Proj' },
    { op: 'create', ref: 'other', type: 'project', title: 'Other' },
    { op: 'create', ref: 'late', type: 'feature', title: 'Late', props: { order: 2 } },
    { op: 'create', ref: 'early', type: 'feature', title: 'Early', status: 'building', props: { order: 1 } },
    { op: 'create', ref: 'unplaced', type: 'feature', title: 'No place yet' },
    { op: 'create', ref: 'sub', type: 'feature', title: 'Sub' },
    { op: 'create', ref: 't1', type: 'task', title: 'T1', status: 'done' },
    { op: 'create', ref: 't2', type: 'task', title: 'T2', status: 'doing' },
    { op: 'create', ref: 't3', type: 'bug', title: 'T3' },
    { op: 'create', ref: 'loose', type: 'task', title: 'Loose' },
    { op: 'create', ref: 'note', type: 'note', title: 'Not work' },
    ...['late', 'early', 'unplaced', 'loose'].map((from): Op => ({ op: 'link', type: 'part_of', from, to: 'p' })),
    { op: 'link', type: 'part_of', from: 'sub', to: 'early' },
    { op: 'link', type: 'part_of', from: 't1', to: 'early' },
    { op: 'link', type: 'part_of', from: 'note', to: 'early' },
    { op: 'link', type: 'part_of', from: 't2', to: 'sub' },
    { op: 'link', type: 'part_of', from: 't3', to: 'late' },
  ]);

  const roots = (await ask(l, 'tree', {})) as any;
  assert.deepEqual(roots.roots.map((r: any) => [r.title, r.branches]), [['Proj', 3], ['Other', 0]], 'without a root, the projects to choose from');

  const tree = (await ask(l, 'tree', { root: made.p })) as any;
  assert.deepEqual(tree.branches.map((b: any) => b.title), ['Early', 'Late', 'No place yet'], 'placed features in order, the rest after');
  const early = tree.branches[0];
  assert.deepEqual(early.progress, { done: 1, total: 2 }, 'a feature counts the work under its sub-features; a note is not work');
  assert.deepEqual([early.status, early.active, early.branches[0].title], ['building', true, 'Sub']);
  assert.deepEqual(tree.progress, { done: 1, total: 4 }, 'the project counts all of it, placed or not');
  assert.deepEqual(tree.unplaced.map((w: any) => w.title), ['Loose']);
  assert.deepEqual(tree.depends, [], 'no dependencies yet');
  assert.deepEqual(tree.by_status, { building: 1, planned: 3 });
  assert.deepEqual(tree.now.map((n: any) => [n.title, n.path.join(' > ')]), [['Early', ''], ['T2', 'Early > Sub']], 'what is being built, and under what');

  const session = await call<{ run: string }>(l, agent, 'session_start', { task: made.t3, title: 'Fixing T3' });
  await make(l, [
    { op: 'link', type: 'depends_on', from: made.late, to: made.early },
    { op: 'link', type: 'depends_on', from: made.t1, to: made.other },
  ]);
  const withSession = (await ask(l, 'tree', { root: made.p })) as any;
  assert.deepEqual(withSession.depends, [{ from: made.late, to: made.early }], 'only dependencies between things in the tree');
  const late = withSession.branches[1];
  assert.deepEqual([late.active, late.work[0].sessions[0].id], [true, session.run], 'an open session marks its task and the feature above it');

  await make(l, [{ op: 'link', type: 'part_of', from: made.loose, to: made.late }]);
  const placed = (await ask(l, 'tree', { root: made.p })) as any;
  assert.deepEqual([placed.unplaced.length, placed.branches[1].work.map((w: any) => w.title).sort()], [0, ['Loose', 'T3']], 'work given a feature sits under it, though still part of the project');
});
