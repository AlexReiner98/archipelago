// The notifications pack without a database (docs/kernel-packs.md, "Tests"): a fake context answers its one call. The
// whole of it against a real map, what reaches the log and as whom, is test/notices-log.test.ts, through the shim.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KernelContext } from '#pelago/kernel';
import { notify, notifyAct } from './notify.ts';

const fake = () => {
  const asked: [string, unknown][] = [];
  const ctx = { call: async (name: string, input: unknown) => (asked.push([name, input]), { notification: 'e_made0000' }) } as unknown as KernelContext;
  return { ctx, asked };
};

test('a notification is made by the write root, as the one who sends it, with only what it says', async () => {
  const { ctx, asked } = fake();
  assert.deepEqual(await notify(ctx, { kind: 'agent', name: 'claude', person: 'e_person00' } as never, { title: 'The build broke', level: 'urgent' }), { notification: 'e_made0000' });
  assert.deepEqual(asked, [['root.notify', { actor: { kind: 'agent', name: 'claude' }, title: 'The build broke', level: 'urgent' }]], 'the sender by kind and name alone, nothing left undefined');
});

test('another pack notifies by its name, as the sender it names', async () => {
  const { ctx, asked } = fake();
  await notifyAct(ctx, { actor: { kind: 'agent', name: 'pelago' }, title: 'The clock failed', body: 'x', about: 'e_item0000' });
  assert.deepEqual(asked, [['root.notify', { actor: { kind: 'agent', name: 'pelago' }, title: 'The clock failed', body: 'x', about: 'e_item0000' }]]);
});
