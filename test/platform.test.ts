import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { createToken, OPERATOR_RESET_FILE, workspaceOf } from '../src/auth.ts';
import { dump } from '../src/backup.ts';
import { loadConfig } from '../src/config.ts';
import { DEFAULT_AGENT_POLICY } from '../src/lattice.ts';
import { createHttpServer } from '../src/server.ts';
import { configureRestart } from '../src/tools.ts';
import { Workspaces } from '../src/workspaces.ts';

const closers: (() => Promise<void>)[] = [];
after(async () => {
  for (const close of closers) await close();
});

/** A server on its own port with in-memory databases and its own copy of the packs. */
async function serve(auth: 'off' | 'tokens') {
  const root = mkdtempSync(join(tmpdir(), 'lattice-platform-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), join(root, 'packs'), { recursive: true });
  const workspaces = new Workspaces({ dataDir: null, rootDir: join(root, 'workspaces'), packsDir: join(root, 'packs') });
  // The server checks the Host header against its port, so the port must be known first.
  const probe = createHttpServer(workspaces, 0);
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise((r) => probe.close(r));
  const server = createHttpServer(workspaces, port, { auth });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', r));
  closers.push(async () => {
    server.close();
    await workspaces.closeAll();
  });

  const base = `http://127.0.0.1:${port}`;
  const call = async (path: string, token?: string, body?: unknown, method = 'POST') => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(method === 'POST' && { 'content-type': 'application/json' }), ...(token && { authorization: `Bearer ${token}` }) },
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    });
    const text = await res.text();
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = { text };
    }
    return { status: res.status, ...json };
  };
  return { workspaces, call, base };
}

test('with auth off, one workspace and the surface decides who is calling', async () => {
  const { call } = await serve('off');
  assert.equal((await call('/api/workspace_info')).result.owner, null, 'a new workspace has no owner');
  assert.equal((await call('/api/init', undefined, { name: 'Alex' })).status, 200, '/api is the human');
  assert.equal((await call('/api/workspace_info')).result.owner.title, 'Alex');
  const proposed = await call('/agent/change', undefined, { actor: 'script-a', reason: 'x', ops: [{ op: 'create', type: 'note', title: 'N' }] });
  assert.equal(proposed.result.status, 'proposed', '/agent is an agent');
  assert.match((await call('/agent/decide', undefined, { proposal: proposed.result.proposal, approve: true })).error, /humans only/);
  const who = await call('/whoami', undefined, undefined, 'GET');
  assert.deepEqual([who.auth, who.workspace.id, who.actor.kind], ['off', 'default', 'human']);
  assert.equal((await call('/operator/workspaces', 'anything', undefined, 'GET')).status, 404, 'no operator surface without tokens');
});

test('with tokens on, nothing but the UI files and health answers without one', async () => {
  const { call } = await serve('tokens');
  for (const [path, method] of [['/api/search', 'POST'], ['/agent/search', 'POST'], ['/mcp', 'POST'], ['/hooks/session-start', 'POST'], ['/whoami', 'GET']]) {
    assert.equal((await call(path, undefined, {}, method)).status, 401, `${path} needs a token`);
    assert.equal((await call(path, 'lat_default_' + '0'.repeat(40), {}, method)).status, 401, `${path} rejects an unknown token`);
    assert.equal((await call(path, 'lat_nowhere_' + '0'.repeat(40), {}, method)).status, 401, `${path} gives nothing away about workspaces`);
  }
  assert.equal((await call('/health', undefined, undefined, 'GET')).status, 200);
  assert.equal((await call('/', undefined, undefined, 'GET')).status, 200);
});

test('a token fixes identity and authority, whichever surface is used', async () => {
  const { workspaces, call, base } = await serve('tokens');
  const db = (await workspaces.get('default')).lattice.db;
  const owner = (await createToken(db, 'default', { kind: 'human', name: 'alex', admin: true })).token;

  const who = await call('/whoami', owner, undefined, 'GET');
  assert.deepEqual([who.auth, who.actor.kind, who.actor.name], ['tokens', 'human', 'alex']);

  const made = await call('/api/token_create', owner, { kind: 'agent', name: 'claude-code' });
  const agent = made.result.token as string;
  assert.equal(workspaceOf(agent), 'default');
  assert.match(made.result.note, /cannot be shown again/);

  // An agent token is an agent on every surface, including the one the CLI uses.
  const proposed = await call('/api/change', agent, { reason: 'x', ops: [{ op: 'create', type: 'note', title: 'From the agent' }] });
  assert.equal(proposed.result.status, 'proposed');
  assert.match((await call('/api/decide', agent, { proposal: proposed.result.proposal, approve: true })).error, /humans only/);
  assert.match((await call('/api/token_create', agent, { kind: 'human', name: 'sneaky' })).error, /humans only/);
  // And a human token is a human on the agent surface.
  assert.equal((await call('/agent/decide', owner, { proposal: proposed.result.proposal, approve: true })).result.status, 'approved');

  // The log names the token's identity; an agent may add a session label, not replace it.
  await call('/agent/notify', agent, { actor: 'session-7', title: 'Hello' });
  const events = (await call('/api/events', owner, { limit: 20 })).result as any[];
  assert.ok(events.some((e) => e.actor === 'agent:claude-code' && e.action === 'proposal.create'));
  assert.ok(events.some((e) => e.actor === 'agent:claude-code/session-7'));

  // MCP with the agent token.
  const mcp = await fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${agent}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  const listed = await mcp.text();
  assert.ok(listed.includes('"name":"change"') && !listed.includes('"name":"decide"'));

  // Revoked and expired tokens stop working at once.
  const list = (await call('/api/token_list', owner)).result as any[];
  assert.ok(list.every((t) => !('hash' in t) && !('token' in t)), 'secrets are never listed');
  await call('/api/token_revoke', owner, { id: list.find((t) => t.name === 'claude-code').id });
  assert.equal((await call('/api/search', agent)).status, 401);
  const brief = (await createToken(db, 'default', { kind: 'agent', name: 'brief', expires_days: 1 })).token;
  assert.equal((await call('/api/search', brief)).status, 200);
  await db.query(`update token set expires_at = now() - interval '1 minute' where name = 'brief'`);
  assert.equal((await call('/api/search', brief)).status, 401);
});

test('each workspace is its own database: tokens, data and local types do not cross', async () => {
  const { workspaces, call } = await serve('tokens');
  const operator = workspaces.ensureOperator()!;
  assert.equal(workspaces.ensureOperator(), undefined, 'the operator secret is made once');
  const mine = (await createToken((await workspaces.get('default')).lattice.db, 'default', { kind: 'human', name: 'alex' })).token;

  assert.equal((await call('/operator/workspaces', mine, { id: 'acme', name: 'Acme' })).status, 401, 'a workspace token is not the operator');
  assert.match((await call('/operator/workspaces', operator, { id: 'Bad Id', name: 'x' })).error, /lowercase letters/);
  const created = await call('/operator/workspaces', operator, { id: 'acme', name: 'Acme Architects' });
  const theirs = created.result.owner_token as string;
  assert.equal(workspaceOf(theirs), 'acme');
  assert.match((await call('/operator/workspaces', operator, { id: 'acme', name: 'Again' })).error, /already exists/);
  assert.deepEqual((await call('/operator/workspaces', operator, undefined, 'GET')).result.map((w: any) => w.id), ['default', 'acme']);
  assert.equal((await call('/api/search', operator)).status, 401, 'the operator cannot read any map');

  await call('/api/change', mine, { reason: 'x', ops: [{ op: 'create', type: 'note', title: 'My secret plan' }] });
  await call('/api/change', theirs, { reason: 'x', ops: [{ op: 'create', type: 'note', title: 'Acme bid' }] });
  const titles = async (token: string) => ((await call('/api/search', token)).result as any[]).map((e) => e.title);
  assert.deepEqual(await titles(mine), ['My secret plan']);
  assert.deepEqual(await titles(theirs), ['Acme bid']);
  assert.equal((await call('/whoami', theirs, undefined, 'GET')).workspace.name, 'Acme Architects');

  // A token is only good in the workspace that issued it, whatever its prefix says.
  const forged = theirs.replace('lat_acme_', 'lat_default_');
  assert.equal((await call('/api/search', forged)).status, 401);

  // A type one workspace defines is not offered to another.
  await call('/api/change', theirs, { reason: 'x', ops: [{ op: 'define_type', type: { id: 'local.site_visit', title: 'Site visit', description: 'A visit.', extends: 'event' } }] });
  const typeIds = async (token: string) => ((await call('/api/schema', token)).result.types as any[]).map((t) => t.id);
  assert.ok((await typeIds(theirs)).includes('local.site_visit'));
  assert.ok(!(await typeIds(mine)).includes('local.site_visit'));
});

test('inside a workspace, private things are hidden from other members by the database', async () => {
  const { workspaces, call } = await serve('tokens');
  const db = (await workspaces.get('default')).lattice.db;
  const alex = (await createToken(db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const api = async (token: string, tool: string, body: unknown = {}) => {
    const r = await call(`/api/${tool}`, token, body);
    if (r.status !== 200) throw new Error(r.error);
    return r.result;
  };
  const titles = async (token: string, type = 'task') => ((await api(token, 'search', { type })) as any[]).map((e) => e.title).sort();

  // The first admin becomes a person; then adds a colleague.
  const me = (await api(alex, 'init', { name: 'Alex' })).me;
  const added = await api(alex, 'member_add', { name: 'Sam' });
  const sam = added.token as string;
  assert.deepEqual(await titles(sam, 'person'), ['Alex', 'Sam'], 'people are shared so colleagues can refer to each other');

  // New things are private to their author unless they say otherwise.
  const mine = await api(alex, 'change', { reason: 'x', ops: [
    { op: 'create', ref: 'p', type: 'project', title: 'Launch', visibility: 'shared' },
    { op: 'create', ref: 's', type: 'task', title: 'Shared task', visibility: 'shared', owner: me },
    { op: 'create', ref: 'x', type: 'task', title: 'Alex private', owner: me },
    { op: 'link', type: 'part_of', from: 's', to: 'p' },
    { op: 'link', type: 'part_of', from: 'x', to: 'p' },
  ] });
  await api(sam, 'change', { reason: 'x', ops: [{ op: 'create', type: 'task', title: 'Sam private', owner: added.person }] });
  assert.deepEqual(await titles(alex), ['Alex private', 'Shared task']);
  assert.deepEqual(await titles(sam), ['Sam private', 'Shared task']);

  // Hidden means hidden everywhere: by id, in relations, the graph, the log and the views.
  assert.match((await call('/api/get', sam, { id: mine.created.x })).error, /No entity/);
  const project = await api(sam, 'get', { id: mine.created.p });
  assert.deepEqual(project.incoming.map((r: any) => r.title), ['Shared task']);
  const graph = await api(sam, 'view', { name: 'graph', params: { relations: 'all' } });
  assert.ok(!graph.nodes.some((n: any) => n.title === 'Alex private'));
  const log = (await api(sam, 'events', { limit: 100 })) as any[];
  assert.ok(!JSON.stringify(log).includes('Alex private'));
  assert.match((await call('/api/change', sam, { reason: 'x', ops: [{ op: 'update', id: mine.created.x, title: 'Hijacked' }] })).error, /no entity/);
  assert.match((await call('/api/change', sam, { reason: 'x', ops: [{ op: 'link', type: 'depends_on', from: mine.created.s, to: mine.created.x }] })).error, /no entity or ref/);

  // Each person's views are their own.
  assert.deepEqual((await api(sam, 'view', { name: 'needs_me' })).actionable.map((t: any) => t.title), ['Sam private']);
  assert.deepEqual((await api(alex, 'view', { name: 'needs_me' })).actionable.map((t: any) => t.title).sort(), ['Alex private', 'Shared task']);

  // Sharing is an explicit edit, and it works both ways.
  await api(alex, 'change', { reason: 'x', ops: [{ op: 'update', id: mine.created.x, visibility: 'shared' }] });
  assert.deepEqual(await titles(sam), ['Alex private', 'Sam private', 'Shared task']);
  await api(alex, 'change', { reason: 'x', ops: [{ op: 'update', id: mine.created.x, visibility: 'private' }] });
  assert.deepEqual(await titles(sam), ['Sam private', 'Shared task']);

  // Someone's agent acts for them: it sees what they see and proposes to them alone.
  const samAgent = (await api(sam, 'token_create', { kind: 'agent', name: 'sam-claude' })).token as string;
  assert.deepEqual(await titles(samAgent), ['Sam private', 'Shared task']);
  const proposed = await api(samAgent, 'change', { reason: 'From Sam\'s inbox', ops: [{ op: 'create', type: 'task', title: 'Reply to the client' }] });
  assert.equal((await api(alex, 'proposals')).length, 0, 'not Alex\'s to review');
  assert.equal((await api(sam, 'proposals')).length, 1);
  assert.match((await call('/api/decide', alex, { proposal: proposed.proposal, approve: true })).error, /No proposal/);
  await api(sam, 'decide', { proposal: proposed.proposal, approve: true });
  assert.ok((await titles(sam)).includes('Reply to the client'));
  assert.ok(!(await titles(alex)).includes('Reply to the client'));
  await api(samAgent, 'notify', { title: 'Sam, your build failed' });
  assert.equal((await api(sam, 'view', { name: 'notifications' })).length, 1);
  assert.equal((await api(alex, 'view', { name: 'notifications' })).length, 0);

  // Only an admin manages people, other people's tokens and settings.
  for (const [tool, body] of [['member_add', { name: 'Eve' }], ['token_create', { kind: 'human', name: 'eve' }], ['token_create', { kind: 'agent', name: 'x', entity: me }], ['workspace_set', { default_visibility: 'shared' }]] as const) {
    assert.match((await call(`/api/${tool}`, sam, body)).error, /Only a workspace admin/, tool);
  }
  assert.deepEqual((await api(sam, 'token_list')).map((t: any) => t.name).sort(), ['Sam', 'sam-claude']);
  assert.ok((await api(alex, 'token_list')).length >= 3);
  const alexTokenId = (await api(alex, 'token_list')).find((t: any) => t.name === 'alex').id;
  assert.match((await call('/api/token_revoke', sam, { id: alexTokenId })).error, /No active token/);

  // A team that prefers openness can flip the default.
  await api(alex, 'workspace_set', { default_visibility: 'shared' });
  await api(alex, 'change', { reason: 'x', ops: [{ op: 'create', type: 'task', title: 'Open by default' }] });
  assert.ok((await titles(sam)).includes('Open by default'));
});

test('nothing can depend on a private item from outside it, and a held resource is held for everyone', async () => {
  const { workspaces, call } = await serve('tokens');
  const db = (await workspaces.get('default')).lattice.db;
  const alex = (await createToken(db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const api = async (token: string, tool: string, body: unknown = {}) => {
    const r = await call(`/api/${tool}`, token, body);
    if (r.status !== 200) throw new Error(r.error);
    return r.result;
  };
  const refused = async (token: string, ops: unknown[]) => (await call('/api/change', token, { reason: 'x', ops })).error as string;
  await api(alex, 'init', { name: 'Alex' });
  const sam = (await api(alex, 'member_add', { name: 'Sam' })).token as string;

  const made = (await api(alex, 'change', { reason: 'x', ops: [
    { op: 'create', ref: 'pub', type: 'task', title: 'Public task', visibility: 'shared' },
    { op: 'create', ref: 'priv', type: 'task', title: 'Private prep' },
    { op: 'create', ref: 'priv2', type: 'task', title: 'Private follow-up' },
    { op: 'create', ref: 'base', type: 'task', title: 'Shared base', visibility: 'shared' },
    { op: 'create', ref: 'lane', type: 'resource', title: 'Live lane', visibility: 'shared' },
    { op: 'create', ref: 'live', type: 'task', title: 'Live work', visibility: 'shared' },
    { op: 'link', type: 'depends_on', from: 'priv2', to: 'priv' },
    { op: 'link', type: 'depends_on', from: 'priv', to: 'base' },
    { op: 'create', ref: 'other', type: 'task', title: 'Other live work', visibility: 'shared' },
    { op: 'link', type: 'needs', from: 'live', to: 'lane' },
    { op: 'link', type: 'needs', from: 'other', to: 'lane' },
  ] })).created;

  // A shared item cannot wait on a private one: colleagues would see it as ready.
  assert.match(await refused(alex, [{ op: 'link', type: 'depends_on', from: made.pub, to: made.priv }]), /"Public task" is shared, so it cannot depend on "Private prep", which is private/);
  assert.match(await refused(alex, [{ op: 'create', ref: 'n', type: 'task', title: 'New shared', visibility: 'shared' }, { op: 'link', type: 'depends_on', from: 'n', to: made.priv }]), /cannot depend on "Private prep"/);
  // Private on private (same person) and private on shared are both fine: they were created above.
  // A looser relation is not a dependency, so it is allowed.
  await api(alex, 'change', { reason: 'x', ops: [{ op: 'link', type: 'relates_to', from: made.pub, to: made.priv }] });

  // Sharing something that waits on a private item needs that item shared too.
  assert.match(await refused(alex, [{ op: 'update', id: made.priv2, visibility: 'shared' }]), /cannot be shared while it depends on private items: "Private prep"/);
  await api(alex, 'change', { reason: 'x', ops: [{ op: 'update', id: made.priv2, visibility: 'shared' }, { op: 'update', id: made.priv, visibility: 'shared' }] });

  // Something others depend on cannot be made private, even when the dependent is hidden from you.
  assert.match(await refused(alex, [{ op: 'update', id: made.priv, visibility: 'private' }]), /cannot be made private while other work depends on it: "Private follow-up"/);
  await api(sam, 'change', { reason: 'x', ops: [{ op: 'create', ref: 'mine', type: 'task', title: 'Sam secret' }, { op: 'link', type: 'depends_on', from: 'mine', to: made.base }] });
  const hidden = await refused(alex, [{ op: 'update', id: made.base, visibility: 'private' }]);
  assert.match(hidden, /"Private prep", 1 item private to someone else/);
  assert.ok(!hidden.includes('Sam secret'), 'the hidden dependent is counted, not named');

  // Sam's session is private to Sam, but the lane it holds is held for everyone.
  const session = await api(sam, 'session_start', { task: made.live, title: 'Sam debugging' });
  assert.deepEqual(session.claimed, ['Live lane']);
  assert.ok(!((await api(alex, 'search', { type: 'sys.run' })) as any[]).length, 'Alex cannot see the session itself');
  const alexRun = await api(alex, 'session_start', { title: 'Alex wants the lane', task: made.live });
  assert.equal(alexRun.status, 'waiting');
  assert.match(alexRun.blocked[0].why, /"Live lane" is held by "someone's private session"/);
  const now = await api(alex, 'view', { name: 'available_now' });
  assert.equal(now.held_resources[0].held_by_title, "someone's private session");
  assert.ok(!now.ready.some((t: any) => t.title === 'Other live work'), 'other work needing the lane is not shown as ready');
  assert.deepEqual(now.waiting_on_resource.map((t: any) => t.title), ['Other live work']);
  assert.equal((await api(sam, 'view', { name: 'available_now' })).held_resources[0].held_by_title, 'Sam debugging');
});

test('a workspace receives notifications only from workspaces its admin accepts', async () => {
  const { workspaces, call } = await serve('tokens');
  const operator = workspaces.ensureOperator()!;
  const mine = (await createToken((await workspaces.get('default')).lattice.db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const theirs = (await call('/operator/workspaces', operator, { id: 'acme', name: 'Acme' })).result.owner_token as string;
  const send = (token: string, workspace: string) => call('/api/notify_workspace', token, { workspace, title: 'The shadow study is ready', level: 'warning' });

  // Refused the same way whether the workspace is closed to us or does not exist.
  assert.match((await send(mine, 'acme')).error, /does not accept notifications from "default"/);
  assert.match((await send(mine, 'nowhere')).error, /does not accept notifications from "default"/);

  const agent = (await call('/api/token_create', mine, { kind: 'agent', name: 'bot' })).result.token;
  assert.match((await call('/api/notify_workspace', agent, { workspace: 'acme', title: 'x' })).error, /humans only/);

  const set = await call('/api/workspace_set', theirs, { accepts_from: ['default'] });
  assert.deepEqual(set.result, { id: 'acme', default_visibility: 'private', agent_changes: 'hold', accepts_from: ['default'] });
  assert.deepEqual((await send(mine, 'acme')).result, { delivered_to: 'acme' });

  const inbox = (await call('/api/view', theirs, { name: 'notifications' })).result as any[];
  assert.deepEqual([inbox[0].title, inbox[0].level, inbox[0].from], ['The shadow study is ready', 'warning', 'agent:workspace:default/alex']);
  assert.equal(((await call('/api/view', mine, { name: 'notifications' })).result as any[]).length, 0, 'nothing lands in the sender\'s own inbox');
  // Accepting is one-way: Acme cannot write back until the other side accepts it.
  assert.match((await send(theirs, 'default')).error, /does not accept notifications from "acme"/);
  const sent = (await call('/api/events', mine, { limit: 5 })).result as any[];
  assert.ok(sent.some((e) => e.action === 'workspace.notify' && e.detail.to === 'acme'), 'the sender\'s log records it');
});

test('dev mode turns review off and offers agents a restart; without it neither holds', async () => {
  const { call } = await serve('off');
  assert.match((await call('/agent/restart')).error, /only in dev mode/);

  let restarts = 0;
  configureRestart(() => restarts++);
  after(() => configureRestart(undefined));
  assert.deepEqual((await call('/agent/restart')).result.restarting, true, 'an agent may restart');
  assert.equal(restarts, 1);
  assert.equal((await call('/whoami', undefined, undefined, 'GET')).dev, true);

  const before = [process.env.LATTICE_DEV, process.env.LATTICE_AUTH];
  after(() => {
    for (const [i, key] of ['LATTICE_DEV', 'LATTICE_AUTH'].entries()) {
      if (before[i] === undefined) delete process.env[key];
      else process.env[key] = before[i];
    }
  });
  process.env.LATTICE_DEV = '1';
  delete process.env.LATTICE_AUTH;
  const dev = loadConfig();
  assert.equal(dev.dev, true);
  assert.ok(Object.values({ ...DEFAULT_AGENT_POLICY, ...dev.policy }).every((level) => level === 'auto'), 'every op applies without review');
  process.env.LATTICE_AUTH = 'tokens';
  assert.throws(() => loadConfig(), /does not run with auth "tokens"/);
  process.env.LATTICE_DEV = '0';
  assert.equal(loadConfig().dev, false);
});

test('an agent can point the human\'s screen, and its changes point it too', async () => {
  const { call } = await serve('off');
  assert.match((await call('/agent/show', undefined, {})).error, /needs "entity" or "screen"/);

  await call('/agent/show', undefined, { actor: 'robot', screen: 'roadmap', of: 'e_x', note: 'Look here' });
  const shown = (await call('/api/pulse')).result.focus;
  assert.deepEqual([shown.hash, shown.actor, shown.note], ['roadmap/e_x', 'robot', 'Look here']);

  await call('/agent/change', undefined, { actor: 'robot', reason: 'A note', ops: [{ op: 'create', type: 'note', title: 'N' }] });
  const proposed = (await call('/api/pulse')).result.focus;
  assert.deepEqual([proposed.hash, proposed.note], ['review', 'A note'], 'a change that waits for review points at Review');
  assert.ok(proposed.at >= shown.at);

  await call('/api/change', undefined, { reason: 'mine', ops: [{ op: 'create', type: 'note', title: 'M' }] });
  assert.equal((await call('/api/pulse')).result.focus.hash, 'review', 'the human\'s own changes do not move their screen');
});

test('an agent hears what the human does: by waiting for it, and with the owner\'s next message', async () => {
  const { call } = await serve('off');
  const made = await call('/api/change', undefined, { reason: 'seed', ops: [{ op: 'create', type: 'decision', title: 'Which?' }] });
  const id = made.result.created['#1'];
  const { latest } = (await call('/agent/watch')).result;
  assert.deepEqual((await call('/agent/watch', undefined, { after: latest })).result.changes, [], 'nothing yet, and no waiting when none is asked for');
  await call('/hooks/session-start', undefined, { session_id: 's1', cwd: '/nowhere' });
  assert.deepEqual(await call('/hooks/prompt', undefined, { session_id: 's1' }), { status: 200 }, 'nothing to tell');

  const waiting = call('/agent/watch', undefined, { after: latest, wait_seconds: 20 });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((await call('/api/pulse')).result.listening, 1, 'the UI can see someone is listening');
  await call('/agent/change', undefined, { actor: 'robot', reason: 'noise', ops: [{ op: 'create', type: 'note', title: 'An agent\'s own change' }] });
  await call('/api/change', undefined, { reason: 'Decided in the UI', ops: [{ op: 'update', id, status: 'decided', props: { outcome: 'This one' } }] });
  const heard = (await waiting).result;
  assert.deepEqual([heard.changes.length, heard.changes[0].target.title, heard.changes[0].changes['props.outcome'].to], [1, 'Which?', 'This one'], 'woken by the human\'s change, not the agent\'s');
  assert.equal((await call('/api/pulse')).result.listening, 0);

  const told = await call('/hooks/prompt', undefined, { session_id: 's1' });
  assert.match(told.hookSpecificOutput.additionalContext, /entity\.update decision "Which\?".*props\.outcome: nothing -> "This one"/s);
  assert.deepEqual(await call('/hooks/prompt', undefined, { session_id: 's1' }), { status: 200 }, 'told once');
});

test('beyond this machine the server needs tokens, and answers only to the names it is given', async () => {
  const before = { ...process.env };
  after(() => {
    for (const key of ['LATTICE_HOST', 'LATTICE_AUTH', 'LATTICE_DEV', 'LATTICE_PUBLIC_HOST', 'PORT', 'LATTICE_PORT']) {
      if (before[key] === undefined) delete process.env[key];
      else process.env[key] = before[key];
    }
  });
  for (const key of ['LATTICE_AUTH', 'LATTICE_DEV', 'LATTICE_PORT']) delete process.env[key];
  process.env.LATTICE_HOST = '0.0.0.0';
  assert.throws(() => loadConfig(), /needs auth "tokens"/);
  process.env.LATTICE_AUTH = 'tokens';
  process.env.LATTICE_PUBLIC_HOST = 'Lattice.Example.com, other.example.com';
  process.env.PORT = '10000';
  const hosted = loadConfig();
  assert.deepEqual([hosted.host, hosted.port, hosted.publicHosts, hosted.launch], ['0.0.0.0', 10000, ['lattice.example.com', 'other.example.com'], false], 'and it does not launch sessions');

  const workspaces = new Workspaces({ dataDir: null, rootDir: join(mkdtempSync(join(tmpdir(), 'lattice-public-')), 'workspaces'), packsDir: join(import.meta.dirname, '..', 'packs') });
  const server = createHttpServer(workspaces, 0, { auth: 'tokens', publicHosts: hosted.publicHosts });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  closers.push(async () => {
    server.close();
    await workspaces.closeAll();
  });
  const port = (server.address() as AddressInfo).port;
  const owner = await createToken((await workspaces.get('default')).lattice.db, 'default', { kind: 'human', name: 'owner', admin: true });
  const ask = (host: string) =>
    new Promise<number>((done) => {
      const req = request({ port, host: '127.0.0.1', path: '/api/schema', method: 'POST', headers: { host, 'content-type': 'application/json', authorization: `Bearer ${owner.token}` } }, (res) => {
        res.resume();
        done(res.statusCode ?? 0);
      });
      req.end('{}');
    });
  assert.equal(await ask('lattice.example.com'), 200, 'its public name');
  assert.equal(await ask('evil.example.net'), 403, 'any other name');
});

test('the operator can issue a workspace a new owner token, and nobody else can', async () => {
  const { workspaces, call } = await serve('tokens');
  const operator = workspaces.ensureOperator()!;
  const made = await call('/operator/workspaces', operator, { id: 'acme', name: 'Acme' });
  assert.equal((await call('/operator/workspaces/acme/owner-token', made.result.owner_token)).status, 401, 'not the workspace\'s own owner');
  assert.equal((await call('/operator/workspaces/nope/owner-token', operator)).status, 404);
  const again = await call('/operator/workspaces/acme/owner-token', operator);
  assert.notEqual(again.result.owner_token, made.result.owner_token);
  const who = await call('/whoami', again.result.owner_token, undefined, 'GET');
  assert.deepEqual([who.workspace.id, who.actor.kind, who.actor.admin], ['acme', 'human', true]);
  assert.equal((await call('/whoami', made.result.owner_token, undefined, 'GET')).workspace.id, 'acme', 'the first token still works');
});

test('the operator can create a workspace from a backup file: the map, its types and its owner arrive', async () => {
  const { workspaces, call } = await serve('tokens');
  const operator = workspaces.ensureOperator()!;
  const main = await workspaces.get('default');
  const old = (await createToken(main.lattice.db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const me = (await call('/api/init', old, { name: 'Alex' })).result.me as string;
  await call('/api/change', old, { reason: 'x', ops: [{ op: 'define_type', type: { id: 'local.site_visit', title: 'Site visit', description: 'A visit.', extends: 'event' } }] });
  await call('/api/change', old, { reason: 'x', ops: [{ op: 'create', type: 'local.site_visit', title: 'Visit the quarry' }] });

  const taken = await dump(main.lattice.db, { id: 'default', name: 'Default' }, JSON.parse(readFileSync(join(workspaces.config.packsDir, 'local', 'pack.json'), 'utf8')));
  const backup = gzipSync(JSON.stringify(taken)).toString('base64');
  assert.equal((await call('/operator/workspaces', old, { id: 'moved', backup })).status, 401, 'only the operator');
  assert.match((await call('/operator/workspaces', operator, { id: 'moved', backup: 'bm90IGEgYmFja3Vw' })).error, /not a Lattice backup/);
  assert.match((await call('/operator/workspaces', operator, { id: 'moved', backup: gzipSync(JSON.stringify({ ...taken, tables: { ...taken.tables, relation: [{ id: 'r_x', type: 'part_of', from_id: 'e_nobody', to_id: 'e_nowhere' }] } })).toString('base64') })).error, /./, 'a backup that does not go in');
  assert.deepEqual((await call('/operator/workspaces', operator, undefined, 'GET')).result.map((w: any) => w.id), ['default'], 'a failed one leaves no workspace behind');
  assert.equal(existsSync(join(workspaces.config.rootDir, 'moved')), false);

  const made = (await call('/operator/workspaces', operator, { id: 'moved', name: 'Alex, moved', backup })).result;
  assert.deepEqual([made.restored.entities, made.restored.events, made.restored.from.id], [taken.tables.entity.length, taken.tables.event.length, 'default']);
  const who = await call('/whoami', made.owner_token, undefined, 'GET');
  assert.deepEqual([who.workspace.id, who.workspace.name, who.actor.admin, who.actor.person], ['moved', 'Alex, moved', true, me], 'the new token is the owner\'s own');
  assert.equal((await call('/api/workspace_info', made.owner_token)).result.owner.title, 'Alex');
  const found = (await call('/api/search', made.owner_token, { type: 'local.site_visit' })).result as any[];
  assert.deepEqual(found.map((e) => e.title), ['Visit the quarry'], 'with the types it defined for itself');
  assert.equal((await call('/whoami', old.replace('lat_default_', 'lat_moved_'), undefined, 'GET')).status, 401, 'tokens from where it came from do not work here');
  const tokens = (await call('/api/token_list', made.owner_token)).result as any[];
  assert.deepEqual(tokens.filter((t) => !t.revoked_at).map((t) => t.name), ['owner']);

  // It carries on from there, and the original is untouched.
  await call('/api/change', made.owner_token, { reason: 'x', ops: [{ op: 'create', type: 'note', title: 'Written after the move' }] });
  assert.equal(((await call('/api/search', old, { q: 'Written after the move' })).result as any[]).length, 0);
  assert.match((await call('/operator/workspaces', operator, { id: 'moved', backup })).error, /already exists/);
});

test('a lost operator secret is replaced by whoever can write on the server\'s disk, and by nobody else', async () => {
  const { workspaces, call } = await serve('tokens');
  const lost = workspaces.ensureOperator()!;
  const file = join(workspaces.config.rootDir, OPERATOR_RESET_FILE);
  const proof = 'reset_' + 'a'.repeat(48);
  assert.equal((await call('/operator/reset', undefined, { proof })).status, 401, 'nothing was prepared');
  writeFileSync(file, proof);
  assert.equal((await call('/operator/reset', undefined, { proof: 'reset_' + 'b'.repeat(48) })).status, 401, 'a wrong proof');
  assert.equal(existsSync(file), false, 'and the file is good for one try');
  assert.equal((await call('/operator/reset', undefined, { proof })).status, 401);
  writeFileSync(file, 'short');
  assert.equal((await call('/operator/reset', undefined, { proof: 'short' })).status, 401, 'a guessable proof is not one');

  mkdirSync(workspaces.config.rootDir, { recursive: true });
  writeFileSync(file, proof);
  const fresh = (await call('/operator/reset', undefined, { proof })).result.operator_secret as string;
  assert.equal((await call('/operator/workspaces', lost, undefined, 'GET')).status, 401, 'the old secret is finished');
  assert.equal((await call('/operator/workspaces', fresh, undefined, 'GET')).status, 200);
  assert.equal((await (await serve('off')).call('/operator/reset', undefined, { proof })).status, 404, 'no operator without tokens');
});

test('a workspace admin merges a backup into their map; nobody else can, and listeners hear of the import, not of its history', async () => {
  const { workspaces, call } = await serve('tokens');
  const operator = workspaces.ensureOperator()!;
  // Where the file comes from: another map, with a type of its own and things its owner did.
  const there = (await call('/operator/workspaces', operator, { id: 'laptop', name: 'Laptop' })).result.owner_token as string;
  await call('/api/change', there, { reason: 'x', ops: [{ op: 'define_type', type: { id: 'local.site_visit', title: 'Site visit', description: 'A visit.', extends: 'event' } }] });
  await call('/api/change', there, { reason: 'x', ops: [{ op: 'create', type: 'local.site_visit', title: 'Visit the quarry' }, { op: 'create', type: 'task', title: 'Order the stone' }] });
  const laptop = await workspaces.get('laptop');
  const taken = await dump(laptop.lattice.db, { id: 'laptop', name: 'Laptop' }, JSON.parse(readFileSync(join(workspaces.config.rootDir, 'laptop', 'local-pack', 'pack.json'), 'utf8')));
  const backup = gzipSync(JSON.stringify(taken)).toString('base64');

  const main = await workspaces.get('default');
  const admin = (await createToken(main.lattice.db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const member = (await call('/api/member_add', admin, { name: 'Sam' })).result.token as string;
  const robot = (await createToken(main.lattice.db, 'default', { kind: 'agent', name: 'robot' })).token;
  await call('/api/change', admin, { reason: 'x', ops: [{ op: 'create', type: 'note', title: 'Already here', visibility: 'shared' }] });
  assert.match((await call('/api/import_backup', member, { backup })).error, /Only a workspace admin/);
  assert.match((await call('/agent/import_backup', robot, { backup })).error, /humans only/);
  assert.match((await call('/api/import_backup', admin, { backup: 'bm90IGEgYmFja3Vw' })).error, /not a Lattice backup/);

  const { latest } = (await call('/agent/watch', robot)).result;
  const preview = (await call('/api/import_backup', admin, { backup })).result;
  assert.deepEqual([preview.applied, preview.entities.added, preview.types_added], [false, 2, ['local.site_visit']]);
  const titles = async () => ((await call('/api/search', admin)).result as any[]).map((e) => e.title).sort();
  assert.ok(!(await titles()).includes('Order the stone'), 'looking changes nothing');
  const done = (await call('/api/import_backup', admin, { backup, apply: true })).result;
  assert.deepEqual([done.applied, done.entities.added], [true, 2]);
  assert.deepEqual((await titles()).filter((t) => ['Already here', 'Order the stone', 'Visit the quarry'].includes(t)), ['Already here', 'Order the stone', 'Visit the quarry']);
  assert.equal(((await call('/api/search', admin, { type: 'local.site_visit' })).result as any[]).length, 1, 'with the type it needed');

  const heard = (await call('/agent/watch', robot, { after: latest })).result.changes as any[];
  assert.deepEqual(heard.map((c) => c.action), ['workspace.import'], "what the laptop's owner did there long ago is not news here");
  assert.equal((await call('/api/import_backup', admin, { backup, apply: true })).result.events.added, 0);
});

test('an import can make the owner in the file and the owner here one person, and they keep their token and what is theirs', async () => {
  const { workspaces, call } = await serve('tokens');
  const operator = workspaces.ensureOperator()!;
  const there = (await call('/operator/workspaces', operator, { id: 'laptop', name: 'Laptop' })).result.owner_token as string;
  const theirs = (await call('/api/init', there, { name: 'Alex Reiner' })).result.me as string;
  await call('/api/change', there, { reason: 'x', ops: [{ op: 'create', type: 'task', title: 'From the laptop', owner: theirs }] });
  const backup = gzipSync(JSON.stringify(await dump((await workspaces.get('laptop')).lattice.db, { id: 'laptop', name: 'Laptop' }))).toString('base64');

  const db = (await workspaces.get('default')).lattice.db;
  const alex = (await createToken(db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const mine = (await call('/api/init', alex, { name: 'Alex R' })).result.me as string;
  await call('/api/change', alex, { reason: 'x', ops: [{ op: 'create', type: 'task', title: 'Mine alone' }] });

  const preview = (await call('/api/import_backup', alex, { backup })).result;
  assert.deepEqual(preview.owners, { here: { id: mine, title: 'Alex R' }, file: { id: theirs, title: 'Alex Reiner' }, made_one: false });
  const apart = (await call('/api/import_backup', alex, { backup, apply: true })).result;
  assert.equal(apart.owners.made_one, false, 'not unless asked');
  assert.equal((await call('/whoami', alex, undefined, 'GET')).actor.person, mine);

  // Asked afterwards, with a file that has nothing else new in it.
  const done = (await call('/api/import_backup', alex, { backup, apply: true, same_owner: true })).result;
  assert.deepEqual([done.owners.made_one, done.entities.added], [true, 0]);
  assert.equal((await call('/whoami', alex, undefined, 'GET')).actor.person, theirs, 'the token is now the person from the file');
  assert.equal((await call('/api/workspace_info', alex)).result.owner.id, theirs, 'who owns the workspace');
  const tasks = ((await call('/api/search', alex, { type: 'task' })).result as any[]).map((e) => e.title).sort();
  assert.deepEqual(tasks, ['From the laptop', 'Mine alone'], 'and still sees what was private to them');
  const people = ((await call('/api/search', alex, { type: 'person' })).result as any[]).map((e) => e.title);
  assert.deepEqual(people, ['Alex Reiner'], 'one person, not two');
  assert.equal((await call('/api/import_backup', alex, { backup })).result.owners, undefined, 'and later imports line up');
});

test('GitHub tells the map of a push: it is recorded against its repository, and what a commit says it finished is proposed closed', async () => {
  const { workspaces, call, base } = await serve('tokens');
  const db = (await workspaces.get('default')).lattice.db;
  const admin = (await createToken(db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const robot = (await createToken(db, 'default', { kind: 'agent', name: 'robot' })).token;
  const made = (
    await call('/api/change', admin, {
      reason: 'x',
      ops: [
        { op: 'create', ref: 'r', type: 'software.repo', title: 'Site repo', visibility: 'shared', props: { remote: 'https://github.com/Acme/Site.git' } },
        { op: 'create', ref: 't', type: 'task', title: 'Fix the footer', visibility: 'shared' },
        { op: 'create', ref: 'd', type: 'decision', title: 'Which font?', visibility: 'shared' },
        { op: 'link', type: 'software.lives_in', from: 't', to: 'r' },
      ],
    })
  ).result.created;

  assert.equal((await call('/api/github', admin)).result.connected, false);
  assert.match((await call('/agent/github', robot, { new_secret: true })).error, /humans only/);
  const connected = (await call('/api/github', admin, { new_secret: true })).result;
  assert.deepEqual([connected.connected, connected.webhook_path, connected.repos[0].github], [true, '/github/default', 'acme/site']);

  const deliver = async (
    payload: unknown,
    { event = 'push', secret = connected.secret as string, path = connected.webhook_path as string, delivery = '', form = false, raw = undefined as string | undefined } = {},
  ) => {
    const body = raw ?? (form ? `payload=${encodeURIComponent(JSON.stringify(payload))}` : JSON.stringify(payload));
    const res = await fetch(base + path, {
      method: 'POST',
      headers: {
        'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json',
        'x-github-event': event,
        'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`,
        ...(delivery && { 'x-github-delivery': delivery }),
      },
      body,
    });
    return { status: res.status, ...((await res.json()) as any) };
  };
  // Each push starts where the one before it on that branch ended, as real ones do.
  const heads = new Map<string, number>();
  const push = (branch: string, message: string, repo = 'Acme/Site') => ({
    ref: `refs/heads/${branch}`,
    before: String(heads.get(branch) ?? 0).padStart(40, '0').replace(/^0+$/, 'a'.repeat(40)),
    after: String(heads.set(branch, (heads.get(branch) ?? 0) + 1).get(branch)).padStart(40, '0'),
    repository: { full_name: repo, default_branch: 'main' },
    pusher: { name: 'sam' },
    commits: [{ id: 'c0ffee1' + '0'.repeat(33), message, url: 'https://github.com/Acme/Site/commit/c0ffee1', author: { name: 'Sam' } }],
  });

  assert.equal((await deliver(push('main', 'x'), { secret: 'not the secret' })).status, 401, 'only what GitHub signed with our secret');
  assert.equal((await deliver(push('main', 'x'), { path: '/github/nowhere' })).status, 401);
  assert.equal((await deliver({}, { event: 'ping' })).result.reason, 'pong');
  assert.equal((await deliver(push('main', 'x', 'Other/Repo'))).result.recorded, false, 'a repository the map does not know');

  // Work on a branch is not finished work.
  const onBranch = (await deliver(push('feat/footer', `Footer rebuilt\n\nCloses ${made.t}`))).result;
  assert.deepEqual([onBranch.recorded, onBranch.branch, onBranch.settled], [true, 'feat/footer', []]);
  // On the default branch the commit is taken at its word, for work; a decision is not a commit's to make.
  const merged = (await deliver(push('main', `Merge the footer\n\nFixes ${made.t} and closes ${made.d}`))).result;
  assert.deepEqual(merged.settled, [{ id: made.t, title: 'Fix the footer', status: 'done', result: 'proposed' }]);

  const [waiting] = (await call('/api/proposals', admin)).result as any[];
  assert.match(waiting.reason, /Commit c0ffee1 says it is finished: Merge the footer/);
  await call('/api/decide', admin, { proposal: waiting.id, approve: true });
  const work = (await call('/agent/view', robot, { name: 'repo_work', params: { repo: 'acme/site' } })).result;
  assert.deepEqual([work.repo.id, work.last_push.branch, work.ready.length], [made.r, 'main', 0], 'found by its GitHub name, with its last push, and the task is done');
  assert.equal((await call('/api/github', admin)).result.repos[0].last_push.subject, '1 commit to main: Merge the footer');

  // A tag, and a branch being deleted, are heard as what they are, and are not the repository's last push of work.
  const tagged = (await deliver({ ...push('main', `Fixes ${made.d}`), ref: 'refs/tags/v1.0' })).result;
  assert.deepEqual([tagged.recorded, tagged.tag, tagged.branch, tagged.settled], [true, 'v1.0', undefined, []]);
  const gone = (await deliver({ ...push('main', 'x'), commits: [], deleted: true, after: '0'.repeat(40) })).result;
  assert.deepEqual([gone.recorded, gone.deleted, gone.settled], [true, true, []]);
  const heard = (await call('/agent/events', robot, { target: made.r, limit: 2 })).result as any[];
  assert.deepEqual(heard.map((e) => e.reason), ['branch main deleted', 'tag v1.0 pushed']);
  assert.equal((await call('/api/github', admin)).result.repos[0].last_push.subject, '1 commit to main: Merge the footer');

  // A push that never arrived shows in the next one, which starts somewhere the last heard push did not end.
  const sha = (c: string) => c.repeat(40);
  const moved = (before: string, after: string) => deliver({ ...push('feat/gap', 'x'), before: sha(before), after: sha(after) });
  assert.equal((await moved('0', '1')).result.missed, undefined, 'a new branch has nothing before it');
  assert.equal((await moved('1', '2')).result.missed, undefined, 'one push after another');
  assert.deepEqual((await moved('3', '4')).result.missed, { from: sha('2'), to: sha('3') }, 'whatever moved it from 2 to 3 was not heard');
  assert.equal((await moved('4', '5')).result.missed, undefined, 'and then it is in step again');
  const warned = ((await call('/api/view', admin, { name: 'notifications' })).result as any[]).filter((n) => /was not heard/.test(n.title));
  assert.deepEqual(warned.map((n) => [n.title, n.level, n.about_id, /git log 2222222\.\.3333333/.test(n.body)]), [['A push to feat/gap of Site repo was not heard', 'warning', made.r, true]]);

  // The repository's address may be written any way GitHub shows it, a page of it in the browser included.
  await call('/api/change', admin, { reason: 'x', ops: [{ op: 'update', id: made.r, props: { remote: 'https://github.com/Acme/Site/tree/main' } }] });
  assert.equal((await call('/api/github', admin)).result.repos[0].github, 'acme/site');

  // A webhook left on GitHub's default content type sends a form; anything that is neither is refused, not crashed on.
  assert.equal((await deliver(push('feat/form', 'x'), { form: true })).result.branch, 'feat/form');
  assert.equal((await deliver(null, { raw: 'not json' })).status, 400);
  assert.equal((await deliver(null, { raw: 'ref=x', form: true })).status, 400);

  // Only what a commit says in its own words counts: not a denial, a quotation or a revert.
  const header = (await call('/api/change', admin, { reason: 'x', ops: [{ op: 'create', ref: 'h', type: 'task', title: 'Fix the header', visibility: 'shared' }] })).result.created.h;
  for (const message of [
    `Start on the header\n\nThis does not fix ${header} yet.`,
    `Header, first half\n\nOnly partly fixes ${header}`,
    `Reword the note that said "fixes ${header}"`,
    `Revert "Rebuild the header"\n\nThis reverts commit 1234567.\n\nFixes ${header}`,
    `Back out the header\n\nThis reverts commit 1234567.\n> Fixes ${header}`,
  ])
    assert.deepEqual((await deliver(push('main', message))).result.settled, [], message);
  const denied = (await deliver(push('main', `Not the footer this time. Fixes ${header}`), { delivery: 'd-1' })).result;
  assert.equal(denied.settled[0].result, 'proposed', 'a "not" in an earlier sentence takes nothing back');

  // A delivery sent again is taken in once, and a thing waiting to be closed is not proposed again.
  const resent = (await deliver(push('main', `Not the footer this time. Fixes ${header}`), { delivery: 'd-1' })).result;
  assert.deepEqual([resent.recorded, resent.reason], [false, 'This delivery was already taken in.']);
  assert.equal((await deliver(push('main', `Tidy up\n\nCloses ${header}`), { delivery: 'd-2' })).result.settled[0].result, 'already proposed');
  assert.equal(((await call('/api/proposals', admin)).result as any[]).length, 1);

  const again = (await call('/api/github', admin, { new_secret: true })).result.secret as string;
  assert.equal((await deliver(push('main', 'x'))).status, 401, 'a replaced secret no longer works');
  assert.equal((await deliver(push('main', 'x'), { secret: again })).status, 200);
});

test('a workspace chooses whether agents’ changes are applied as made or held, the answer to a question with them', async () => {
  const { workspaces, call } = await serve('tokens');
  const db = (await workspaces.get('default')).lattice.db;
  const admin = (await createToken(db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const member = (await createToken(db, 'default', { kind: 'human', name: 'sam' })).token;
  const robot = (await createToken(db, 'default', { kind: 'agent', name: 'robot' })).token;
  const change = (token: string, ops: unknown[], authority?: unknown) => call(token === admin ? '/api/change' : '/agent/change', token, { reason: 'x', ops, authority });
  const made = (await change(admin, [
    { op: 'create', ref: 'a', type: 'task', title: 'Paint the fence', visibility: 'shared' },
    { op: 'create', ref: 'b', type: 'task', title: 'Paint the fence again', visibility: 'shared' },
    { op: 'create', ref: 'd', type: 'decision', title: 'Which colour?', visibility: 'shared' },
  ])).result.created;

  assert.equal((await call('/api/workspace_info', admin)).result.agent_changes, 'hold', 'held unless the workspace says otherwise');
  assert.equal((await change(robot, [{ op: 'create', type: 'note', title: 'One', visibility: 'shared' }])).result.status, 'proposed');
  assert.match((await call('/api/workspace_set', member, { agent_changes: 'apply' })).error, /admin/);
  assert.match((await call('/agent/workspace_set', robot, { agent_changes: 'apply' })).error, /humans only/, 'an agent cannot let itself through');

  assert.equal((await call('/api/workspace_set', admin, { agent_changes: 'apply' })).result.agent_changes, 'apply');
  const applied = (await change(robot, [{ op: 'create', type: 'note', title: 'Two', visibility: 'shared' }])).result;
  assert.equal(applied.status, 'applied');
  assert.equal((await change(robot, [{ op: 'merge', keep: made.a, drop: made.b }])).result.status, 'applied', 'merging too');
  assert.equal((await change(robot, [{ op: 'archive', id: made.a }])).result.status, 'applied', 'and archiving');
  // An agent can settle a question too, when the record stands on its own, and the human is told.
  assert.match((await change(robot, [{ op: 'update', id: made.d, status: 'decided', props: { outcome: 'Green' } }])).error, /what was chosen \(props\.outcome\) and why \(props\.rationale\)/);
  const green = [{ op: 'update', id: made.d, status: 'decided', props: { outcome: 'Green', rationale: 'It is the paint we have.' } }];
  assert.match((await change(robot, green)).error, /on whose authority/, 'and on whose authority');
  assert.match((await change(robot, green, { of: 'human' })).error, /what they said and where/, 'a human\u2019s word has to be quoted');
  const word = { of: 'human', basis: 'Alex, in chat on 8 Oct: "go with green"' };
  const answer = (await change(robot, green, word)).result;
  const onWord = { ...word, stated_by: 'agent:robot/script' };
  assert.deepEqual([answer.status, answer.answered], ['applied', [{ id: made.d, title: 'Which colour?', status: 'decided', outcome: 'Green', authority: onWord }]]);
  const told = (await call('/api/view', admin, { name: 'notifications' })).result as any[];
  assert.deepEqual(told.map((n) => [n.title, n.about_id]), [['robot/script settled "Which colour?": Green', made.d]]);
  const guess = (await change(admin, [{ op: 'create', ref: 'h', type: 'hypothesis', title: 'Green hides dirt', visibility: 'shared' }])).result.created.h;
  assert.equal((await change(robot, [{ op: 'update', id: guess, status: 'supported' }], { of: 'agent', basis: 'Two weeks of photos' })).result.status, 'applied', 'and a hypothesis');
  // Every change says on whose authority it was made: the human's own, a human's word as an agent reports it, or the agent's judgment.
  const authorityOf = async (id: string) => ((await call('/api/events', admin, { target: id, limit: 1 })).result as any[])[0].detail.authority;
  assert.deepEqual(await authorityOf(made.d), onWord);
  assert.deepEqual(await authorityOf(guess), { of: 'agent', who: 'agent:robot/script', basis: 'Two weeks of photos' });
  assert.deepEqual(await authorityOf(applied.created['#1']), { of: 'agent', who: 'agent:robot/script' }, 'unsaid, it is the agent\u2019s own');
  const mine = (await change(admin, [{ op: 'create', ref: 'n', type: 'note', title: 'Mine', visibility: 'shared' }], { of: 'agent' })).result.created.n;
  assert.deepEqual([(await authorityOf(mine)).of, /alex/.test((await authorityOf(mine)).who)], ['human', true], 'a human\u2019s own change is theirs, whatever it claims');

  // What was applied is on the record, with who made it, and can be put back.
  const logged = ((await call('/agent/events', robot, { limit: 50 })).result as any[]).filter((e) => e.changeset === applied.changeset);
  assert.deepEqual([logged.length > 0, logged.every((e) => /robot/.test(e.actor))], [true, true]);
  assert.equal((await call('/api/undo', admin, { changeset: applied.changeset })).status, 200);
  // That a human looked is a record of its own, and nothing an agent can make for them.
  assert.match((await call('/agent/seen', robot, { upto: logged[0].seq })).error, /humans only/);
  assert.equal((await call('/api/seen', admin, { upto: logged[0].seq })).result.seen_upto, logged[0].seq);
  const looked = ((await call('/api/events', admin, { limit: 5 })).result as any[]).find((e) => e.action === 'changes.seen');
  assert.deepEqual([looked.detail.upto, /alex/.test(looked.actor), logged[0].target_type], [logged[0].seq, true, 'note']);

  await call('/api/workspace_set', admin, { agent_changes: 'hold' });
  assert.equal((await change(robot, [{ op: 'create', type: 'note', title: 'Three', visibility: 'shared' }])).result.status, 'proposed');
  const [held] = (await call('/api/proposals', admin)).result as any[];
  const let_in = (await call('/api/decide', admin, { proposal: held.id, approve: true })).result;
  const by = (await authorityOf(Object.values(let_in.created)[0] as string)) as any;
  assert.deepEqual([by.of, /alex/.test(by.who), by.stated_by], ['human', true, undefined], 'what a human applies rests on that human');
  const set = ((await call('/api/events', admin, { limit: 50 })).result as any[]).filter((e) => e.action === 'workspace.set').map((e) => e.reason);
  assert.deepEqual(set, ['agent_changes set to "hold"', 'agent_changes set to "apply"'], 'and the choice itself is in the log');
});
