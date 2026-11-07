// Views and layouts have a life (task e_gkv58kqb): working, an agent's; kept, only on the owner's word; retired.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callTool } from '../src/tools.ts';
import { lifeOf, moveLives } from '../src/view-life.ts';
import { agent, fresh, human, make } from './map.ts';

test('a view or layout is made working, and only the owner’s word keeps it or retires a kept one', async () => {
  const l = await fresh();
  const { mine } = await make(l, [{ op: 'create', ref: 'mine', type: 'lens', title: 'Mine', status: 'kept', props: { filter: { find: ['type task'] } } }]);
  assert.equal((await l.entity(mine))?.status, 'kept');
  const theirs = await l.change(agent, { ops: [{ op: 'create', ref: 'v', type: 'lens', title: 'An agent’s', props: { filter: { find: ['type task'] } } }], reason: 'test' });
  assert.equal((theirs as { status: string }).status, 'proposed'); // held for the owner, as any agent's change here, not refused
  await assert.rejects(l.change(agent, { ops: [{ op: 'create', type: 'lens', title: 'Kept unasked', status: 'kept', props: { filter: { find: ['type task'] } } }], reason: 'test' }), /kept only on the owner's word/);
  await assert.rejects(l.change(agent, { ops: [{ op: 'create', type: 'layout', title: 'Kept unasked', status: 'kept', props: { code: 'export default () => {}' } }], reason: 'test', authority: { of: 'agent', basis: 'I like it' } }), /kept only on the owner's word/);
  await assert.rejects(l.change(agent, { ops: [{ op: 'update', id: mine, status: 'retired' }], reason: 'test' }), /retires it only on their word/);
  const told = await l.change(agent, { ops: [{ op: 'create', type: 'lens', title: 'Kept as told', status: 'kept', props: { filter: { find: ['type task'] } } }], reason: 'test', authority: { of: 'human', basis: 'Alex, in chat: keep it' } });
  assert.notEqual((told as { status: string }).status, 'rejected');
});

test('a working view is retired with what it is about, and a kept one outlives it', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 't', type: 'task', title: 'A task' },
    { op: 'create', ref: 'w', type: 'lens', title: 'Working on it', props: { filter: { find: ['id {t}'] } } },
    { op: 'create', ref: 'k', type: 'lens', title: 'Kept of it', status: 'kept', props: { filter: { find: ['id {t}'] } } },
    { op: 'link', type: 'about', from: 'w', to: 't' },
    { op: 'link', type: 'about', from: 'k', to: 't' },
  ]);
  const read = async () => (await callTool(l, human, 'view', { name: 'saved_views', params: {} })) as { pictures: { lens: string; life: string }[]; ended?: string[] };
  assert.deepEqual((await read()).pictures.map((p) => [p.lens, p.life]), [[made.k, 'kept'], [made.w, 'working']]);
  await make(l, [{ op: 'update', id: made.t, status: 'done' }]);
  const after = await read();
  assert.deepEqual(after.pictures.map((p) => p.lens), [made.k]);
  assert.deepEqual(after.ended, [made.w]);
});

test('the views kept before their life are sorted once: pinned or a layout kept, about a closed item retired, the rest working', async () => {
  assert.equal(lifeOf({ id: 'a', view: true, pinned: true, ended: true }), 'kept');
  assert.equal(lifeOf({ id: 'b', view: false, pinned: false, ended: true }), 'kept');
  assert.equal(lifeOf({ id: 'c', view: true, pinned: false, ended: true }), 'retired');
  assert.equal(lifeOf({ id: 'd', view: true, pinned: false, ended: false }), 'working');
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'open', type: 'task', title: 'Open' },
    { op: 'create', ref: 'shut', type: 'task', title: 'Shut', status: 'done' },
    { op: 'create', ref: 'p', type: 'lens', title: 'Pinned', props: { pinned: true, filter: { find: ['type task'] } } },
    { op: 'create', ref: 'o', type: 'lens', title: 'Of the open', props: { filter: { find: ['type task'] } } },
    { op: 'create', ref: 's', type: 'lens', title: 'Of the shut', props: { filter: { find: ['type task'] } } },
    { op: 'create', ref: 'n', type: 'lens', title: 'Of nothing', props: { filter: { find: ['type task'] } } },
    { op: 'create', ref: 'y', type: 'layout', title: 'A layout', props: { code: 'export default () => {}' } },
    { op: 'link', type: 'about', from: 'o', to: 'open' },
    { op: 'link', type: 'about', from: 's', to: 'shut' },
  ]);
  const ids = [made.p, made.o, made.s, made.n, made.y];
  // As a workspace kept them before: each current (the status they had, set in place to stand for that past).
  await l.db.query(`update entity set status = 'current' where id = any($1::text[])`, [ids]);
  assert.deepEqual(await moveLives(l), { kept: 2, working: 2, retired: 1 });
  const status = async (id: string) => (await l.entity(id))?.status;
  assert.deepEqual(await Promise.all(ids.map(status)), ['kept', 'working', 'retired', 'working', 'kept']);
  assert.deepEqual(await moveLives(l), {}); // once
});
