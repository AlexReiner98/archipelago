// The connections tool on the connect pack's context: what a workspace's admin sees of the server packs it may
// connect, where to go to connect one, and ending one, the server's side answered by root.connections. Ending one is
// logged on the map as the admin who ended it, as when the kernel ran the tool itself.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configureConnections } from '../packs/surface/kernel/root-connections.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { fresh } from './map.ts';

const admin = { kind: 'human' as const, name: 'test', admin: true };
const member = { kind: 'human' as const, name: 'other' };

/** One server pack that connects, its control database and its entries answered from memory. */
function server() {
  const asked: string[] = [];
  const control = {
    query: async (sql: string, params: unknown[]) => {
      asked.push(sql.trim().split(/\s+/).slice(0, 3).join(' '));
      if (sql.includes('delete from control_value')) return { rows: [{ key: `${params[0]}42`, value: { workspace: 'default', account: 'acme' } }] };
      return { rows: [] };
    },
  };
  const file = { id: 'github_app', title: 'GitHub', reach: { server: { connect: { status: 'status', start: 'start', setup: 'setup' } } } };
  const packs = {
    packs: [{ file }, { file: { id: 'quiet', title: 'Quiet', reach: { server: {} } } }],
    control: async () => control,
    connectionOf: async (_pack: string, workspace: string) => (workspace === 'default' ? { id: '42', workspace, account: 'acme' } : undefined),
    call: async (_pack: string, _kind: string, entry: string, input: Record<string, unknown>) => (entry === 'status' ? { ready: true, name: 'GitHub App' } : { url: `https://example.com/go?state=${input.state}&for=${input.purpose}` }),
  };
  configureConnections(packs as never);
  return { asked };
}

test('an admin sees what connects, is told where to go to connect it, and ends it, logged as themself', async (t) => {
  t.after(() => configureConnections(undefined));
  server();
  const l = await fresh();
  const listed = await callTool(l, admin, 'connections', {});
  assert.deepEqual(listed, { packs: [{ pack: 'github_app', title: 'GitHub', ready: true, name: 'GitHub App', can_setup: false, connected: { id: '42', account: 'acme' } }] });

  await assert.rejects(callTool(l, member, 'connections', { pack: 'github_app', start: true }), /Only a workspace admin can connect what this server offers\./);
  await assert.rejects(callTool(l, admin, 'connections', { pack: 'nope', start: true }), /Nothing here connects by the name "nope"\./);
  await assert.rejects(callTool(l, { ...admin, kind: 'agent' }, 'connections', {}), /for humans only/);

  const started = (await callTool(l, admin, 'connections', { pack: 'github_app', start: true })) as { url: string; packs: unknown[] };
  assert.match(started.url, /^https:\/\/example\.com\/go\?state=default\.[0-9a-f]{48}&for=connect$/);
  assert.equal(started.packs.length, 1);

  await callTool(l, admin, 'connections', { pack: 'github_app', end: true });
  const { rows } = await l.db.query<{ head: Record<string, unknown>; facts: unknown }>(`select head, facts from log_op where stream = 'activity' order by pos desc limit 1`);
  assert.deepEqual(rows[0].facts, [['+', 'workspace', 'connection.ended', { detail: { pack: 'github_app', connection: '42' } }]]);
  const { actor, rule } = rows[0].head;
  assert.deepEqual({ actor, rule }, { actor: { id: 'human:test' }, rule: 'activity' }, 'ended as the admin');
});
