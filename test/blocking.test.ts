import assert from 'node:assert/strict';
import { test } from 'node:test';
import { heldResources } from '../src/blocking.ts';
import { callTool } from '../src/tools.ts';
import { agent, fresh, attend, human, make } from './map.ts';

/** Attention is read for a person: the workspace's owner, whose is what nobody owns. */
const owned = async (l: Awaited<ReturnType<typeof fresh>>) => callTool(l, human, 'init', { name: 'Owner' });

test('blockers are derived, and roots are what has to move first', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'me', type: 'person', title: 'Me' },
    { op: 'create', ref: 'sam', type: 'person', title: 'Sam' },
    { op: 'create', ref: 'ship', type: 'work.task', title: 'Ship release', owner: 'me' },
    { op: 'create', ref: 'sign', type: 'work.task', title: 'Sign installer', owner: 'me' },
    { op: 'create', ref: 'cert', type: 'work.decision', title: 'Which certificate?', owner: 'sam' },
    { op: 'create', ref: 'free', type: 'work.task', title: 'Write notes', owner: 'me' },
    { op: 'link', type: 'depends_on', from: 'ship', to: 'sign' },
    { op: 'link', type: 'depends_on', from: 'sign', to: 'cert' },
  ]);

  const ship = (await attend(l, { person: made.me, reasons: ['blocked'] })).items.find((i: any) => i.id === made.ship);
  assert.deepEqual(ship.reasons[0].by, ['Which certificate?'], 'what has to move first, at the root of the chain');

  assert.deepEqual((await attend(l, { person: made.me, reasons: ['ready'] })).items.map((t: any) => t.title), ['Write notes']);
  assert.equal((await attend(l, { person: made.me, reasons: ['blocked'] })).items.length, 2);
  assert.equal((await attend(l, { person: made.sam, reasons: ['holding_up'] })).items[0].reasons[0].count, 2);

  // Closing the decision unblocks the next task in the chain, with nothing else to update.
  await make(l, [{ op: 'update', id: made.cert, status: 'decided', props: { outcome: 'EV cert' } }]);
  const after = await attend(l, { person: made.me, reasons: ['ready'] });
  assert.deepEqual(after.items.map((t: any) => t.title).sort(), ['Sign installer', 'Write notes']);
  await assert.rejects(attend(l, { person: 'me' }), /pelago init/);
});

test('a dependency cycle does not hang the views', async () => {
  const l = await fresh();
  await make(l, [
    { op: 'create', ref: 'a', type: 'work.task', title: 'A' },
    { op: 'create', ref: 'b', type: 'work.task', title: 'B' },
    { op: 'link', type: 'depends_on', from: 'a', to: 'b' },
    { op: 'link', type: 'depends_on', from: 'b', to: 'a' },
  ]);
  await owned(l);
  assert.equal((await attend(l, { person: 'me', reasons: ['blocked'] })).items.length, 2);
});

test('an exclusive resource has one holder, and blocks other work that needs it', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'lane', type: 'resource', title: 'Live CAD lane' },
    { op: 'create', ref: 'run1', type: 'sys.run', title: 'Session one' },
    { op: 'create', ref: 'run2', type: 'sys.run', title: 'Session two' },
    { op: 'create', ref: 'live1', type: 'work.task', title: 'Capture parity probe' },
    { op: 'create', ref: 'live2', type: 'work.task', title: 'Debug conduit' },
    { op: 'create', ref: 'offline', type: 'work.task', title: 'Write unit tests' },
    { op: 'link', type: 'needs', from: 'live1', to: 'lane' },
    { op: 'link', type: 'needs', from: 'live2', to: 'lane' },
  ]);
  await owned(l);
  assert.equal((await attend(l, { person: 'me', reasons: ['ready'] })).items.length, 3);

  // Agents claim directly: no proposal.
  const claimed = await l.claim(agent, { resource: made.lane, holder: made.run1, for: made.live1, reason: 'Running the probe' });
  assert.equal(claimed.status, 'claimed');
  await assert.rejects(l.claim(agent, { resource: made.lane, holder: made.run2, reason: 'Me too' }), /held by "Session one"/);

  const during = await attend(l, { person: 'me', reasons: ['ready', 'blocked'] });
  assert.deepEqual(during.items.filter((t: any) => t.reasons[0].why === 'ready').map((t: any) => t.title).sort(), ['Capture parity probe', 'Write unit tests']);
  assert.deepEqual(during.items.filter((t: any) => t.reasons[0].why === 'blocked').map((t: any) => [t.title, t.reasons[0].by]), [['Debug conduit', ['Live CAD lane']]]);
  assert.equal((await heldResources(l))[0].held_by_title, 'Session one');

  assert.deepEqual(await l.release(agent, { resource: made.lane, holder: made.run1, reason: 'Done' }), { released: 1 });
  assert.equal((await l.claim(agent, { resource: made.lane, holder: made.run2, reason: 'My turn' })).status, 'claimed');
});

test('overdue work is due, and what is far off is not', async () => {
  const l = await fresh();
  await make(l, [
    { op: 'create', type: 'work.task', title: 'File return', props: { due: '2020-01-01' } },
    { op: 'create', type: 'work.task', title: 'Far off', props: { due: '2999-01-01' } },
  ]);
  // Work resting on a refuted hypothesis is the inquiry pack's to show, not the kernel's.
  await owned(l);
  const due = await attend(l, { person: 'me', reasons: ['due'] });
  assert.deepEqual(due.items.map((t: any) => [t.title, t.reasons[0].overdue]), [['File return', true]]);
});
