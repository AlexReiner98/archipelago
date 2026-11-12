// What a notification, an alert and an agent's ask put on the log, and as whom, now that each is made by a pack on
// its context (packs/notifications, packs/alerts, packs/publish) and the write root's root.notify: the same entry as
// when the kernel applied it itself, as the sender, past the rules, private, for the sender's person or the owner.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resetAlerts } from '../packs/alerts/kernel/alert.ts';
import * as alertPack from '../packs/alerts/kernel/alert.ts';
import * as notifyPack from '../packs/notifications/kernel/notify.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { agent, fresh, human, make } from './map.ts';
import type { Archipelago } from '../packs/write/kernel/pelago.ts';
import { kernelContext } from '../packs/loader/kernel/kernel-context.ts';

/** The entry that made an item, as the log keeps its header: who, on whose authority, by which rule. */
async function madeBy(l: Archipelago, id: string) {
  const { rows } = await l.db.query<{ head: Record<string, unknown> }>(
    `select e.head from log_entry e join log_fact f using (stream, pos) where f.id = $1 and f.field = 'type' order by e.pos limit 1`,
    [id],
  );
  const head = rows[0]?.head ?? {};
  // The reason is sealed with the item's key (packs/seal/kernel/seal.ts): what it was given is pinned by the fields it has.
  return { action: head.action, actor: head.actor, authority: head.authority, rule: head.rule, fields: Object.keys(head).sort() };
}
const HEAD = ['action', 'actor', 'authority', 'id', 'keys', 'reason', 'rule', 'source', 'undoes', 'v', 'ws'];
const SENT = (id: string) => ({ action: null, actor: { id }, authority: null, rule: { outcome: 'apply', spared: [] }, fields: HEAD });
const row = async (l: Archipelago, id: string) =>
  (await l.db.query<{ type: string; visibility: string; private_to: string | null; props: Record<string, unknown> }>(`select type, visibility, private_to, props from entity where id = $1`, [id])).rows[0];
const latest = async (l: Archipelago, title: string) =>
  (await l.db.query<{ id: string }>(`select id from entity where type = 'notification' and title = $1 order by created_at desc limit 1`, [title])).rows[0]?.id;

test('a notification is applied as its sender, past the rules, private, and names who sent it', async () => {
  const l = await fresh();
  const { task } = await make(l, [{ op: 'create', ref: 'task', type: 'task', title: 'Ship it' }]);
  const { notification } = await notifyPack.notify(kernelContext(l, 'notifications'), ({ kind: 'agent', name: 'claude' }), ({ title: 'The build broke', body: 'main is red', level: 'urgent', about: task }));
  assert.deepEqual(await madeBy(l, notification), SENT('agent:claude'));
  const made = await row(l, notification);
  assert.deepEqual([made.type, made.visibility, made.props.level, made.props.from], ['notification', 'private', 'urgent', 'agent:claude']);
  await assert.rejects(notifyPack.notify(kernelContext(l, 'notifications'), agent, ({ title: 'x', about: 'e_nothere0' })), /No item "e_nothere0"/);
});

test("an alert is the scheduler's notification on the map it broke in", async () => {
  resetAlerts();
  const l = await fresh();
  await alertPack.alertOwner(kernelContext((Object.assign(Object.create(l), { workspace: 'customer' })), 'alerts'), ({ key: 'k', title: 'Theirs broke', body: 'Details', level: 'warning', from: 'pelago' }));
  const id = await latest(l, 'Theirs broke');
  assert.ok(id, 'told on the map');
  assert.deepEqual(await madeBy(l, id!), SENT('agent:pelago'));
  assert.deepEqual((await row(l, id!)).props, { level: 'warning', from: 'agent:pelago' });
});

test("an agent's ask to share or publish is a notification made as that agent", async () => {
  const l = await fresh();
  await l.init(human, { name: 'Owner' });
  const { doc } = await make(l, [{ op: 'create', ref: 'doc', type: 'task', title: 'Guide', visibility: 'shared' }]);
  const asker = { kind: 'agent' as const, name: 'helper' };
  assert.deepEqual(await callTool(l, asker, 'share_ask', { id: doc, reason: 'For the launch' }), { asked: true, note: 'The person is notified; making it public is theirs.' });
  const asked = await latest(l, 'Make "Guide" public');
  assert.deepEqual(await madeBy(l, asked!), SENT('agent:helper'));
  await assert.rejects(callTool(l, asker, 'share_ask', { id: 'e_nothere0' }), /is not an item of this workspace you can read/);
});
