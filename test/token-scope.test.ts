// A token's scope: within an item (it writes only what is part of it), and may report, propose or change. Checked on
// the write path, whatever tool sends the change; what the token reads is its person's view, as before.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createToken, verifyToken } from '../src/auth.ts';
import { TOKEN_SCOPE } from '../src/schema.ts';
import { serve } from './serve.ts';

/** Kuma's webhook body, as its notification posts it. */
const beat = (status: number, monitor: Record<string, unknown>, msg = '') => ({ heartbeat: { monitorID: 3, status, msg }, monitor, msg: `[${monitor.name}] ${msg}` });

async function setUp() {
  const { workspaces, call } = await serve('tokens');
  const db = (await workspaces.get('default')).pelago.db;
  const admin = (await createToken(db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const made = (
    await call('/api/change', admin, {
      reason: 'x',
      ops: [
        { op: 'create', ref: 'env', type: 'software.environment', title: 'archipelago-1' },
        { op: 'create', ref: 'blue', type: 'software.component', title: 'App, blue', status: 'up', props: { url: 'http://app-blue:3100/health' } },
        { op: 'create', ref: 'green', type: 'software.component', title: 'App, green', status: 'planned', props: { url: 'http://app-green:3100/health' } },
        { op: 'create', ref: 'llm', type: 'software.component', title: 'LiteLLM', status: 'up', props: { url: 'http://litellm:4000/health' } },
        { op: 'create', ref: 'other', type: 'software.component', title: 'Laptop proxy', status: 'up', props: { url: 'http://laptop:8080' } },
        { op: 'create', ref: 'task', type: 'work.task', title: 'Paint the fence' },
        { op: 'link', type: 'part_of', from: 'blue', to: 'env' },
        { op: 'link', type: 'part_of', from: 'green', to: 'env' },
        { op: 'link', type: 'part_of', from: 'llm', to: 'env' },
      ],
    })
  ).result.created;
  const token = async (body: Record<string, unknown>) => (await call('/api/token_create', admin, { kind: 'agent', ...body })).result.token as string;
  const status = async (ref: string) => (await call('/api/get', admin, { id: made[ref] })).result.entity.status;
  return { db, call, admin, made, token, status };
}

test('a token that may only report sends readings about what it is within, applied at once, and nothing else', async () => {
  const { call, admin, made, token, status } = await setUp();
  const kuma = await token({ name: 'Uptime Kuma', within: [made.env], may: 'report' });
  // Everything but the report tool is refused: it cannot change, read or speak for a session.
  assert.match((await call('/agent/change', kuma, { reason: 'x', ops: [{ op: 'update', id: made.llm, status: 'down' }] })).error, /may only report/);
  assert.match((await call('/agent/search', kuma, {})).error, /may only report: it cannot call search/);
  assert.equal((await call('/hooks/session-start', kuma, { session_id: 's', cwd: '/x' })).hookSpecificOutput, undefined, 'it registers no session');
  // Kuma's body as it is, under the old name too: the part within its environment goes down, without a proposal.
  const down = (await call('/agent/health_report', kuma, beat(0, { name: 'LiteLLM', type: 'http', url: 'http://litellm:4000/health' }, 'ECONNREFUSED'))).result;
  assert.deepEqual(down.changed.map((c: any) => c.to), ['down']);
  assert.equal(await status('llm'), 'down');
  assert.equal((await call('/agent/report', kuma, beat(1, { name: 'LiteLLM', type: 'http', url: 'http://litellm:4000/health/' }, 'OK'))).result.changed[0].to, 'up');
  assert.deepEqual((await call('/api/proposals', admin)).result, []);
  // A part outside what it is within is not its to report on.
  assert.match((await call('/agent/report', kuma, beat(0, { name: 'Laptop proxy', type: 'http', url: 'http://laptop:8080' }))).error, /limited to the work of archipelago-1\. "Laptop proxy" is not part of it/);
  assert.equal(await status('other'), 'up');
});

test('a deploy says which part is live at which commit by its address, and the one it stopped rests', async () => {
  const { call, made, token, status } = await setUp();
  const deploy = await token({ name: 'deploy', within: [made.env], may: 'report' });
  const live = (await call('/agent/report', deploy, { live: { at: 'http://app-green:3100/health', commit: 'abcdef1234567' }, idle: ['http://app-blue:3100/health'], said: 'deploy.sh switched Caddy' })).result;
  assert.deepEqual(live.changed.map((c: any) => [c.title, c.to, c.commit]), [['App, green', 'up', 'abcdef1234567'], ['App, blue', 'standby', undefined]]);
  assert.deepEqual([await status('green'), await status('blue')], ['up', 'standby']);
  const reason = (await call('/agent/events', deploy, { target: made.green, limit: 1 })).error;
  assert.match(reason, /may only report/, 'it reads nothing back');
  // Kuma leaves the stopped colour alone; the same deploy said again changes nothing.
  assert.deepEqual((await call('/agent/report', deploy, { live: { at: 'http://app-green:3100/health', commit: 'abcdef1234567' }, idle: ['http://app-blue:3100/health'] })).result.changed, []);
  assert.match((await call('/agent/report', deploy, { live: { at: 'http://app-green:3100/health', commit: 'not a commit' } })).error, /commit/);
});

test('a token that may propose has every change wait, even where agents’ changes are applied as made', async () => {
  const { call, admin, made, token } = await setUp();
  await call('/api/workspace_set', admin, { agent_changes: 'apply' });
  const free = await token({ name: 'free' });
  const careful = await token({ name: 'careful', may: 'propose' });
  const change = (t: string) => call('/agent/change', t, { reason: 'x', ops: [{ op: 'update', id: made.task, status: 'doing' }] });
  assert.equal((await change(careful)).result.status, 'proposed');
  assert.equal((await change(free)).result.status, 'applied');
});

test('a token is within any item, and writes only what is part of it', async () => {
  const { call, made, token } = await setUp();
  const env = await token({ name: 'env', within: [made.env] });
  assert.equal((await call('/agent/change', env, { reason: 'x', ops: [{ op: 'update', id: made.blue, props: { host: 'app-blue' } }] })).result.status, 'proposed');
  assert.match((await call('/agent/change', env, { reason: 'x', ops: [{ op: 'update', id: made.task, status: 'doing' }] })).error, /limited to the work of archipelago-1\. "Paint the fence" is not part of it/);
  assert.equal((await call('/agent/get', env, { id: made.task })).result.entity.title, 'Paint the fence', 'it reads what its person reads');
});

test('a token limited to repositories before is within them', async () => {
  const { db } = await setUp();
  const made = await createToken(db, 'default', { kind: 'agent', name: 'old' });
  await db.query(`update token set within = null, repos = '["e_repo0001"]'::jsonb where id = $1`, [made.id]);
  for (const statement of TOKEN_SCOPE.split(';').filter((q) => q.trim())) await db.query(statement);
  const who = await verifyToken(db, made.token);
  assert.deepEqual([who?.actor.within, who?.actor.may], [['e_repo0001'], undefined]);
});
