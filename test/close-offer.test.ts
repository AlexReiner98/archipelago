// Closing work offers to close what it addresses, still open (packs/sessions/kernel/close-offer.ts): the change's answer names each
// with the op that closes it, and the line a commit closes its task by names them too. Nothing is closed unasked.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Registry, type PackFile } from '../packs/loader/kernel/packs.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { agent, freshWith, human, make, packsWith } from './map.ts';

// A link that offers to close what it runs to, and a type for it to run to: a pack's, as any such link is.
const MENDS = {
  id: 'mending', version: '1', title: 'Mending', requires: ['core'],
  types: [{ id: 'bump', extends: 'work', title: 'Bump', description: 'A problem met.', statuses: { open: ['open', 'investigating'], closed: ['resolved', 'wontfix'] } }],
  links: [{ id: 'mends', extends: 'about', title: 'mends', inverse: 'is mended by', from: ['*'], to: ['bump'], offers_close: true, description: 'Work meant to fix the bump.' }],
} as PackFile;
const registry = new Registry(packsWith(MENDS));

async function setup() {
  const l = await freshWith(registry);
  const made = await make(l, [
    { op: 'create', ref: 'task', type: 'task', title: 'Fix the bumps' },
    { op: 'create', ref: 'a', type: 'bump', title: 'Bump A' },
    { op: 'create', ref: 'b', type: 'bump', title: 'Bump B' },
    { op: 'create', ref: 'c', type: 'bump', title: 'Bump C', status: 'resolved' },
    { op: 'create', ref: 'd', type: 'bump', title: 'Bump D' },
    { op: 'link', type: 'mends', from: 'task', to: 'a' },
    { op: 'link', type: 'mends', from: 'task', to: 'b' },
    { op: 'link', type: 'mends', from: 'task', to: 'c' },
    { op: 'link', type: 'about', from: 'task', to: 'd' },
  ]);
  return { l, task: made.task, a: made.a, b: made.b };
}

test('closing a task names the open bumps it mends, with the ops that close them, and closes none', async () => {
  const { l, task, a, b } = await setup();
  const answer = (await callTool(l, human, 'change', { reason: 'done', ops: [{ op: 'update', id: task, status: 'done' }] })) as any;
  assert.equal(answer.status, 'applied');
  assert.deepEqual(answer.still_open.items.map((i: any) => i.id).sort(), [a, b].sort(), 'not the one already resolved, nor what it is only about');
  assert.deepEqual(answer.still_open.ops.find((o: any) => o.id === a), { op: 'update', id: a, status: 'resolved' });
  assert.match(answer.still_open.say, /2 items still open/);
  assert.equal((await l.entity(a))!.status, 'open', 'the issue is left for whoever closed the task to say');
  // Sent back, the ops close them.
  const closed = (await callTool(l, human, 'change', { reason: 'fixed', ops: answer.still_open.ops })) as any;
  assert.equal(closed.still_open, undefined);
  assert.equal((await l.entity(b))!.status, 'resolved');
});

test('what the same change closes or keeps open is not offered again, and a change that closes nothing offers nothing', async () => {
  const { l, task, a, b } = await setup();
  const answer = (await callTool(l, human, 'change', { reason: 'done', ops: [{ op: 'update', id: task, status: 'done' }, { op: 'update', id: a, status: 'investigating' }] })) as any;
  assert.deepEqual(answer.still_open.items.map((i: any) => i.id), [b]);
  const retitle = (await callTool(l, human, 'change', { reason: 'name', ops: [{ op: 'update', id: b, title: 'Bump B, again' }] })) as any;
  assert.equal(retitle.still_open, undefined);
});

test('a held close offers them too', async () => {
  const { l, task, a, b } = await setup();
  const held = (await callTool(l, agent, 'change', { reason: 'done', hold: true, ops: [{ op: 'update', id: task, status: 'done' }] })) as any;
  assert.equal(held.status, 'proposed');
  assert.equal(held.still_open.items.length, 2);
});
