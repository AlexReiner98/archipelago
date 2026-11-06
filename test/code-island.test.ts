// The Software vocabulary (packs/code) on a workspace with the island rules on: a product living in its repository,
// a feature with the tasks that build it, a bug fixed by one of them, a release gated on the feature, and a commit
// that settles a task. Its roadmap tree and the views it ships read what was made.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDb } from '../src/db.ts';
import { Registry } from '../src/packs.ts';
import { setIslands } from '../src/packstate.ts';
import { Archipelago } from '../src/pelago.ts';
import { callTool } from '../src/tools.ts';
import { syncTypes } from '../src/typetable.ts';
import { human, make, PACKS } from './map.ts';

/** The query of a view the pack ships, as the bar's picker runs it. */
const lensOf = (id: string) => {
  const { filter, walk } = JSON.parse(readFileSync(join(PACKS, 'code', 'pack.json'), 'utf8')).styles.find((s: { id: string }) => s.id === id).props;
  return { filter, walk };
};

/** Every pack, held to the island rules. */
const island = () => {
  const reg = new Registry(PACKS);
  reg.turnOff([], true);
  return reg;
};

test('the island rules take it, and each type comes from a starter as the work it is', () => {
  const reg = island();
  assert.equal(reg.states.get('code')?.state, 'active', String(reg.states.get('code')?.why));
  for (const id of ['software', 'work']) assert.equal(reg.states.get(id)?.state, 'off', `${id} is not on an island map`);
  const own = ['code_product', 'code_feature', 'code_bug', 'code_release', 'code_repository', 'code_commit', 'code_component', 'code_part', 'code_environment'];
  assert.deepEqual(own.map((id) => reg.type(id)?.starter), ['work', 'work', 'work', 'occurrence', 'place', 'record', 'place', 'place', 'place']);
  assert.ok(reg.type('code_repository')!.capabilities.where?.address, 'a repository is found by its remote');
  assert.equal(reg.type('code_commit')!.capabilities.accounts?.field, 'sha');
  const root = (id: string) => reg.relations.get(id)?.root;
  assert.deepEqual(['code_settles', 'code_fixes', 'code_calls'].map(root), ['about', 'about', 'uses']);
  assert.ok(reg.trees.has('code.roadmap'));
});

test('beside the software pack, on a map without islands, both are active and never clash', () => {
  const reg = new Registry(PACKS);
  for (const id of ['code', 'software']) assert.equal(reg.states.get(id)?.state, 'active', id);
  assert.ok(reg.types.has('code_feature') && reg.types.has('feature') && reg.relations.has('code_settles') && reg.relations.has('settles'));
});

test('a software island holds a product, a feature, its tasks and a release', async () => {
  const reg = new Registry(PACKS);
  const l = new Archipelago(await openDb(), reg);
  await syncTypes(l);
  await setIslands(l, human, true);
  assert.equal(reg.states.get('code')?.state, 'active');
  assert.equal(reg.states.get('software')?.state, 'off');

  const { isle } = await make(l, [{ op: 'create', ref: 'isle', type: 'island', title: 'Apex', props: { pack: 'code' } }]);
  const on = (ops: any[]) => ops.map((op) => (op.op === 'create' ? { ...op, props: { ...op.props, island: isle } } : op));
  const ids = await make(l, on([
    { op: 'create', ref: 'repo', type: 'code_repository', title: 'Apex repo', props: { remote: 'https://github.com/example/apex' } },
    { op: 'create', ref: 'prod', type: 'code_product', title: 'Apex', status: 'active' },
    { op: 'create', ref: 'feat', type: 'code_feature', title: 'Sun study', status: 'building', props: { order: 1 } },
    { op: 'create', ref: 'later', type: 'code_feature', title: 'Shadow export', status: 'planned', props: { order: 2 } },
    { op: 'create', ref: 'calc', type: 'task', title: 'Compute the sun path', status: 'done' },
    { op: 'create', ref: 'draw', type: 'task', title: 'Draw the shadows', status: 'doing' },
    { op: 'create', ref: 'bug', type: 'code_bug', title: 'Noon is off by an hour', props: { repro: 'Toronto, 21 June' } },
    { op: 'create', ref: 'rel', type: 'code_release', title: 'Apex 0.2', props: { version: '0.2.0' } },
    { op: 'link', type: 'lives_in', from: 'prod', to: 'repo' },
    { op: 'link', type: 'part_of', from: 'feat', to: 'prod' },
    { op: 'link', type: 'part_of', from: 'later', to: 'prod' },
    { op: 'link', type: 'part_of', from: 'calc', to: 'feat' },
    { op: 'link', type: 'part_of', from: 'draw', to: 'feat' },
    { op: 'link', type: 'part_of', from: 'bug', to: 'feat' },
    { op: 'link', type: 'code_fixes', from: 'draw', to: 'bug' },
    { op: 'link', type: 'depends_on', from: 'rel', to: 'feat' },
    { op: 'link', type: 'defers', from: 'rel', to: 'later' },
  ]));
  // A commit accounted for as the instructions say: in its repository, settling what it did.
  const { c } = await make(l, on([
    { op: 'create', ref: 'c', type: 'code_commit', title: 'Compute the sun path', props: { sha: 'a'.repeat(40) } },
    { op: 'link', type: 'lives_in', from: 'c', to: ids.repo },
    { op: 'link', type: 'code_settles', from: 'c', to: ids.calc },
  ]));
  assert.equal((await l.entity(c))!.props.sha, 'a'.repeat(40));

  // The software pack is off here, so its feature is no type to make.
  await assert.rejects(l.change(human, { reason: 'test', ops: on([{ op: 'create', type: 'feature', title: 'Old vocabulary' }]) }), /feature/);

  const tree = (await callTool(l, human, 'view', { name: 'tree', params: { root: ids.prod, tree: 'code.roadmap' } })) as any;
  const text = JSON.stringify(tree);
  for (const title of ['Sun study', 'Shadow export', 'Draw the shadows', 'Noon is off by an hour']) assert.ok(text.includes(title), `the roadmap holds ${title}`);
  assert.ok(text.indexOf('Sun study') < text.indexOf('Shadow export'), 'features in their order');

  const titles = async (id: string) => new Set(((await callTool(l, human, 'view', { name: 'flat', params: lensOf(id) })) as any).items.map((i: { title: string }) => i.title));
  assert.deepEqual([...(await titles('code.releases'))].sort(), ['Apex 0.2', 'Shadow export', 'Sun study'], 'the gate: the release, what it waits for and what it defers');
  assert.deepEqual([...(await titles('code.roadmap_flow'))].sort(), ['Shadow export', 'Sun study'], 'the roadmap: open features');
});
