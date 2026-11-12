// The alerts pack without a database (docs/kernel-packs.md, "Tests"): a fake context answers its calls. Against a real
// map and a mailbox, test/alert.test.ts, through the shim.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KernelContext } from '#pelago/kernel';
import { alertAct, alertOwner, mailOwner, resetAlerts } from './alert.ts';

const fake = (workspace: string, mail: (input: unknown) => unknown = () => ({ sent: true })) => {
  const asked: [string, unknown][] = [];
  const ctx = {
    workspace,
    call: async (name: string, input: unknown) => {
      asked.push([name, input]);
      return name === 'root.mail' ? mail(input) : { notification: 'e_made0000' };
    },
  } as unknown as KernelContext;
  return { ctx, asked };
};
const said = (body: string) => `${body}\n\nSaid once an hour at most; the server's log has each one.`;

test("on the server's own map the owner is mailed through the walls and told on the map, once an hour for each key", async () => {
  resetAlerts();
  const { ctx, asked } = fake('default');
  const alert = { key: 'clock', title: 'The clock failed', body: 'boom', from: 'pelago', about: 'e_item0000' };
  await alertOwner(ctx, alert);
  await alertOwner(ctx, alert);
  assert.deepEqual(asked, [
    ['root.mail', { subject: 'Archipelago: The clock failed', text: said('boom') }],
    ['act.report.notify', { actor: { kind: 'agent', name: 'pelago' }, title: 'The clock failed', body: said('boom'), level: 'urgent', about: 'e_item0000' }],
  ]);
});

test("another map's owner is told on their map alone, and another pack alerts by the pack's name", async () => {
  resetAlerts();
  const { ctx, asked } = fake('customer');
  await alertAct(ctx, { key: 'k', title: 'Theirs broke', body: 'x', level: 'warning', from: 'pack:p' });
  assert.deepEqual(asked.map(([name]) => name), ['act.report.notify']);
  assert.equal((asked[0][1] as { level: string }).level, 'warning');
});

test('a mail that fails is said, never thrown', async () => {
  const { ctx } = fake('default', () => { throw new Error('no route'); });
  assert.equal(await mailOwner(ctx, 'x', 'y'), false);
  assert.equal(await mailOwner(fake('default', () => ({ sent: false })).ctx, 'x', 'y'), false, 'no address: not sent');
});
