// The Software vocabulary (this pack) on a workspace with the island rules on: a product living in its repository,
// a feature with the tasks that build it, a bug fixed by one of them, a release gated on the feature, and a commit
// that settles a task. Its roadmap tree and the views it ships read what was made. Through the tools alone
// (#pelago/test), so it runs wherever the pack lives.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { call, human, make, mapWith, type Actor, type Archipelago } from '#pelago/test';

/** The folder this pack lives in, with the packs beside it. */
const HERE = join(import.meta.dirname, '..');
const owner = { ...human, admin: true } as Actor;

/** The query of a view the pack ships, as the bar's picker runs it. */
const lensOf = (id: string) => {
  const { filter, walk } = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8')).styles.find((s: { id: string }) => s.id === id).props;
  return { filter, walk };
};

type Pack = { id: string; state: string; why?: unknown };
const states = async (l: Archipelago) => new Map((await call<Pack[]>(l, human, 'packs', {})).map((p) => [p.id, p]));
const schema = (l: Archipelago, type: string) => call<{ types: any[]; relations: any[] }>(l, human, 'schema', { type });

/** A map with the packs beside this one, held to the island rules. */
const island = async () => {
  const l = await mapWith(HERE);
  await call(l, owner, 'workspace_set', { islands: true });
  return l;
};

test('the island rules take it, and each type comes from a starter as the work it is', async () => {
  const l = await island();
  const packs = await states(l);
  assert.equal(packs.get('code')?.state, 'active', String(packs.get('code')?.why));
  for (const id of ['software', 'work']) if (packs.has(id)) assert.equal(packs.get(id)?.state, 'off', `${id} is not on an island map`);
  const own = ['product', 'feature', 'bug', 'release', 'repo', 'commit', 'component', 'environment', 'pull_request'];
  const types = await Promise.all(own.map(async (id) => (await schema(l, id)).types[0]));
  assert.deepEqual(types.map((t) => t?.starter), ['work', 'work', 'work', 'occurrence', 'place', 'record', 'place', 'place', 'work']);
  assert.ok(types.every((t) => t?.pack === 'code'), 'each is the code pack’s');
  assert.ok(types[4].capabilities.where?.address, 'a repository is found by its remote');
  const roots = await Promise.all(['settles', 'fixes', 'calls', 'ships', 'defers'].map(async (id) => (await schema(l, id)).relations[0]?.root));
  assert.deepEqual(roots, ['about', 'about', 'uses', 'produced', 'about']);
});

test('on a map without islands the software pack runs over its words, and declares none of its own', async () => {
  const l = await mapWith(HERE);
  const packs = await states(l);
  for (const id of ['code', 'software', 'proof']) if (packs.has(id)) assert.equal(packs.get(id)?.state, 'active', id);
  assert.equal((await schema(l, 'feature')).types[0]?.pack, 'code');
  assert.equal((await schema(l, 'settles')).relations[0]?.pack, 'code');
  if (packs.has('software')) {
    const all = await call<{ types: { id: string; pack: string }[] }>(l, human, 'schema', {});
    assert.deepEqual(all.types.filter((t) => t.pack === 'software').map((t) => t.id), ['diagram']);
  }
});

test('a software island holds a product, a feature, its tasks and a release', async () => {
  const l = await island();
  assert.equal((await states(l)).get('code')?.state, 'active');

  const { isle } = await make(l, [{ op: 'create', ref: 'isle', type: 'island', title: 'Apex', props: { pack: 'code' } }]);
  const on = (ops: any[]) => ops.map((op) => (op.op === 'create' ? { ...op, props: { ...op.props, island: isle } } : op));
  const ids = await make(l, on([
    { op: 'create', ref: 'repo', type: 'repo', title: 'Apex repo', props: { remote: 'https://github.com/example/apex' } },
    { op: 'create', ref: 'prod', type: 'product', title: 'Apex', status: 'active' },
    { op: 'create', ref: 'feat', type: 'feature', title: 'Sun study', status: 'building', props: { order: 1 } },
    { op: 'create', ref: 'later', type: 'feature', title: 'Shadow export', status: 'planned', props: { order: 2 } },
    { op: 'create', ref: 'calc', type: 'task', title: 'Compute the sun path', status: 'done' },
    { op: 'create', ref: 'draw', type: 'task', title: 'Draw the shadows', status: 'doing' },
    { op: 'create', ref: 'bug', type: 'bug', title: 'Noon is off by an hour', props: { repro: 'Toronto, 21 June' } },
    { op: 'create', ref: 'rel', type: 'release', title: 'Apex 0.2', props: { version: '0.2.0' } },
    { op: 'link', type: 'lives_in', from: 'prod', to: 'repo' },
    { op: 'link', type: 'part_of', from: 'feat', to: 'prod' },
    { op: 'link', type: 'part_of', from: 'later', to: 'prod' },
    { op: 'link', type: 'part_of', from: 'calc', to: 'feat' },
    { op: 'link', type: 'part_of', from: 'draw', to: 'feat' },
    { op: 'link', type: 'part_of', from: 'bug', to: 'feat' },
    { op: 'link', type: 'fixes', from: 'draw', to: 'bug' },
    { op: 'link', type: 'depends_on', from: 'rel', to: 'feat' },
    { op: 'link', type: 'defers', from: 'rel', to: 'later' },
  ]));
  // A commit accounted for as the instructions say: in its repository, settling what it did.
  const { c } = await make(l, on([
    { op: 'create', ref: 'c', type: 'commit', title: 'Compute the sun path', props: { sha: 'a'.repeat(40) } },
    { op: 'link', type: 'lives_in', from: 'c', to: ids.repo },
    { op: 'link', type: 'settles', from: 'c', to: ids.calc },
  ]));
  assert.equal((await call<any>(l, human, 'get', { id: c })).entity.props.sha, 'a'.repeat(40));

  // The work pack is off here, so its project is no type to make on the island.
  await assert.rejects(l.change(human, { reason: 'test', ops: on([{ op: 'create', type: 'project', title: 'Old vocabulary' }]) }), /project/);

  const tree = await call<any>(l, human, 'view', { name: 'tree', params: { root: ids.prod, tree: 'code.roadmap' } });
  const text = JSON.stringify(tree);
  for (const title of ['Sun study', 'Shadow export', 'Draw the shadows', 'Noon is off by an hour']) assert.ok(text.includes(title), `the roadmap holds ${title}`);
  assert.ok(text.indexOf('Sun study') < text.indexOf('Shadow export'), 'features in their order');

  const titles = async (id: string) => new Set((await call<any>(l, human, 'view', { name: 'flat', params: lensOf(id) })).items.map((i: { title: string }) => i.title));
  assert.deepEqual([...(await titles('code.releases'))].sort(), ['Apex 0.2', 'Shadow export', 'Sun study'], 'the gate: the release, what it waits for and what it defers');
  assert.deepEqual([...(await titles('code.roadmap_flow'))].sort(), ['Shadow export', 'Sun study'], 'the roadmap: open features');
});
