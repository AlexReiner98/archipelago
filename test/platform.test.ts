import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHmac, createVerify, generateKeyPairSync } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { clientAddress, trustedProxies } from '../src/address.ts';
import { createToken, OPERATOR_RESET_FILE, workspaceOf } from '../src/auth.ts';
import { dump } from '../src/backup.ts';
import { loadConfig } from '../src/config.ts';
import { DEFAULT_AGENT_POLICY } from '../src/lattice.ts';
import { GithubApp } from '../src/github-app.ts';
import { configureReader, readUnread, sought, within } from '../src/reader.ts';
import { limiter, type Limit } from '../src/limit.ts';
import { createHttpServer, lenient } from '../src/server.ts';
import { configureRestart } from '../src/tools.ts';
import { Workspaces } from '../src/workspaces.ts';

const closers: (() => Promise<void>)[] = [];
after(async () => {
  for (const close of closers) await close();
});

/** A server on its own port with in-memory databases and its own copy of the packs. */
async function serve(auth: 'off' | 'tokens', github?: (origin: string) => GithubApp, limits?: { open?: Limit; deliveries?: Limit; refused?: Limit }) {
  const root = mkdtempSync(join(tmpdir(), 'lattice-platform-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), join(root, 'packs'), { recursive: true });
  const workspaces = new Workspaces({ dataDir: null, rootDir: join(root, 'workspaces'), packsDir: join(root, 'packs') });
  // The server checks the Host header against its port, so the port must be known first.
  const probe = createHttpServer(workspaces, 0);
  await new Promise<void>((r) => probe.listen(0, '127.0.0.1', r));
  const port = (probe.address() as AddressInfo).port;
  await new Promise((r) => probe.close(r));
  const server = createHttpServer(workspaces, port, { auth, github: github?.(`http://127.0.0.1:${port}`), limits });
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
  // Health also says which code is answering and since when, so a deploy can be told from the server it replaces.
  const health = await call('/health', undefined, undefined, 'GET');
  assert.equal(health.status, 200);
  assert.match(health.commit, /^[0-9a-f]{40}$/);
  assert.ok(!Number.isNaN(Date.parse(health.started)));
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

  // A picture is as private as the result it is of.
  const shot = await api(alex, 'change', { reason: 'x', ops: [{ op: 'create', ref: 'r', type: 'software.test_result', title: 'Alex private result' }] });
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString('base64');
  await api(alex, 'picture_put', { result: shot.created.r, data: png, content_type: 'image/png' });
  assert.equal((await api(alex, 'picture', { result: shot.created.r })).data, png);
  assert.equal(await api(sam, 'picture', { result: shot.created.r }), null);
  assert.match((await call('/api/picture_put', sam, { result: shot.created.r, data: png, content_type: 'image/png' })).error, /not a test result/);

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

  // A session that began before this server did has lived through a restart: it is told, once, that its tools may be old.
  const { workspaces: ws, call: later } = await serve('off');
  const old = (await later('/agent/session_start', undefined, { session_id: 'before', title: 'Began before the deploy' })).result.run;
  await (await ws.get('default')).lattice.db.query(`update entity set created_at = now() - interval '1 hour' where id = $1`, [old]);
  const restarted = await later('/hooks/prompt', undefined, { session_id: 'before' });
  assert.match(restarted.hookSpecificOutput.additionalContext, /server has restarted since this session began .*now running commit [0-9a-f]{7}\).*POST \/agent\/<tool>/s);
  assert.deepEqual(await later('/hooks/prompt', undefined, { session_id: 'before' }), { status: 200 }, 'told once');
  await later('/hooks/session-start', undefined, { session_id: 'after', cwd: '/nowhere' });
  assert.deepEqual(await later('/hooks/prompt', undefined, { session_id: 'after' }), { status: 200 }, 'a session that began on this server is not told');
});

test('a project with nothing of Lattice\'s in it is connected by one command, which adds to what is there and can be run again', async () => {
  const { base } = await serve('tokens');
  const project = mkdtempSync(join(tmpdir(), 'lattice-customer-'));
  writeFileSync(join(project, 'CLAUDE.md'), '# Their project\n\nTheir own rules.\n');
  mkdirSync(join(project, '.claude'));
  writeFileSync(join(project, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['Bash(npm test)'] }, hooks: { SessionEnd: [{ hooks: [{ type: 'command', command: 'echo bye' }] }], UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'node scripts/lattice-hook.mjs prompt' }] }] } }));
  // The command the Workspace screen gives: no token is asked for, since the script holds no secret.
  const run = () =>
    new Promise<{ out: string; code: number | null }>((done) => {
      const child = spawn(process.execPath, ['-e', `fetch('${base}/connect/setup.mjs').then(r=>r.text()).then(t=>import('data:text/javascript,'+encodeURIComponent(t)))`, '--', '--yes'], { cwd: project, env: { ...process.env, LATTICE_AGENT_TOKEN: '' } });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (out += d));
      child.on('close', (code) => done({ out, code }));
    });
  const first = await run();
  assert.equal(first.code, 0, first.out);
  assert.match(first.out, /written {4}\.mcp\.json[\s\S]*added to {3}CLAUDE\.md[\s\S]*this machine has no token yet/);
  const file = (path: string) => readFileSync(join(project, path), 'utf8');
  assert.equal(JSON.parse(file('.mcp.json')).mcpServers.lattice.url, `\${LATTICE_URL:-${base}}/mcp`);
  // What was theirs is kept; the three hooks are added beside it, and call the script that was written.
  const settings = JSON.parse(file('.claude/settings.json'));
  assert.deepEqual(settings.permissions, { allow: ['Bash(npm test)'] });
  assert.deepEqual(settings.hooks.SessionEnd.map((h: any) => h.hooks[0].command), ['echo bye', 'node .claude/lattice-hook.mjs session-end']);
  assert.deepEqual(settings.hooks.UserPromptSubmit.map((h: any) => h.hooks[0].command), ['node .claude/lattice-hook.mjs prompt'], 'a hook registered at another place is pointed at the one the setup wrote');
  assert.equal(settings.hooks.SessionStart[0].hooks[0].command, 'node .claude/lattice-hook.mjs session-start');
  assert.equal(settings.hooks.Stop[0].hooks[0].command, 'node .claude/lattice-hook.mjs stop', 'the end of a turn is heard too');
  assert.ok(file('.claude/lattice-hook.mjs').includes(`process.env.LATTICE_URL || "${base}"`), 'the hook falls back on the server that handed it out');
  assert.match(file('.claude/skills/lattice-bump/SKILL.md'), /^---\nname: lattice-bump/);
  assert.match(file('.claude/lattice.md'), /view` with name `handoff`/);
  assert.match(file('CLAUDE.md'), /^# Their project\n\nTheir own rules\.\n\n## Lattice\n[\s\S]*@\.claude\/lattice\.md\n$/);
  // Run again, it changes nothing.
  const before = [file('CLAUDE.md'), file('.claude/settings.json')];
  const again = await run();
  assert.doesNotMatch(again.out, /written|added to/);
  assert.deepEqual([file('CLAUDE.md'), file('.claude/settings.json')], before);
  // The first time on a machine the command carries the token in and asks for it to be kept: it is, with the
  // address, where the shell finds them, an older token replaced and nothing else there disturbed. It is not printed.
  const profile = join(project, 'profile');
  writeFileSync(profile, 'export PATH="$PATH:/opt/bin"\nexport LATTICE_AGENT_TOKEN="lat_default_old"\n');
  const kept = await new Promise<string>((done) => {
    const child = spawn(process.execPath, ['-e', `fetch('${base}/connect/setup.mjs').then(r=>r.text()).then(t=>import('data:text/javascript,'+encodeURIComponent(t)))`, '--', '--yes'], { cwd: project, env: { ...process.env, LATTICE_AGENT_TOKEN: 'lat_default_new', LATTICE_SETUP_SAVE: '1', LATTICE_SETUP_PROFILE: profile } });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', () => done(out));
  });
  assert.match(kept, /kept {7}the server\u2019s address and the token, for this machine[\s\S]*Connected to/);
  assert.ok(!kept.includes('lat_default_new'));
  assert.equal(file('profile'), `export PATH="$PATH:/opt/bin"\nexport LATTICE_URL="${base}"\nexport LATTICE_AGENT_TOKEN="lat_default_new"\n`);

  // And the hook it wrote reaches the server from that folder.
  const hooked = await new Promise<string>((done) => {
    const child = spawn(process.execPath, ['.claude/lattice-hook.mjs', 'session-start'], { cwd: project, env: { ...process.env, LATTICE_URL: '', LATTICE_AGENT_TOKEN: '' } });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('close', () => done(err));
    child.stdin.end(JSON.stringify({ session_id: 'c1', cwd: project }));
  });
  assert.match(hooked, new RegExp(`${base.replace(/[.:/]/g, '\\$&')} answered 401`), 'it called this server, which wants the token the machine does not have yet');
});

test('a project whose settings file is not JSON is left as it was: the setup writes nothing at all', async () => {
  const { base } = await serve('tokens');
  const project = mkdtempSync(join(tmpdir(), 'lattice-broken-'));
  mkdirSync(join(project, '.claude'));
  writeFileSync(join(project, '.claude', 'settings.json'), '{ "hooks": ');
  const { out, code } = await new Promise<{ out: string; code: number | null }>((done) => {
    const child = spawn(process.execPath, ['-e', `fetch('${base}/connect/setup.mjs').then(r=>r.text()).then(t=>import('data:text/javascript,'+encodeURIComponent(t)))`], { cwd: project, env: { ...process.env, LATTICE_AGENT_TOKEN: '' } });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => done({ out, code }));
  });
  assert.equal(code, 1, out);
  assert.match(out, /settings\.json is there but is not JSON[\s\S]*Nothing was written/);
  // .mcp.json and the hook come before the settings file in the setup: neither is there.
  assert.deepEqual([existsSync(join(project, '.mcp.json')), existsSync(join(project, '.claude', 'lattice-hook.mjs')), existsSync(join(project, 'CLAUDE.md'))], [false, false, false]);
  assert.equal(readFileSync(join(project, '.claude', 'settings.json'), 'utf8'), '{ "hooks": ');
});

test('the setup shows what it will change and waits for a yes, keeps a copy of what it changes, and can be taken out again', async () => {
  const { base } = await serve('tokens');
  const project = mkdtempSync(join(tmpdir(), 'lattice-careful-'));
  const at = (path: string) => join(project, path);
  const file = (path: string) => readFileSync(at(path), 'utf8');
  // A project with its own MCP server, its own hook and its own rules, and a machine with its own start-up file.
  const theirs = {
    '.mcp.json': JSON.stringify({ mcpServers: { other: { type: 'http', url: 'https://example.test/mcp' } } }),
    '.claude/settings.json': JSON.stringify({ permissions: { allow: ['Bash(npm test)'] }, hooks: { SessionEnd: [{ hooks: [{ type: 'command', command: 'echo bye' }] }] } }),
    'CLAUDE.md': '# Their project\n\nTheir own rules.\n',
    profile: 'export PATH="$PATH:/opt/bin"\n',
  };
  mkdirSync(at('.claude'));
  for (const [path, text] of Object.entries(theirs)) writeFileSync(at(path), text);
  const untouched = () => assert.deepEqual(Object.fromEntries(Object.keys(theirs).map((path) => [path, file(path)])), theirs);
  const setup = (flags: string[] = [], env: Record<string, string> = {}) =>
    new Promise<{ out: string; code: number | null }>((done) => {
      const child = spawn(process.execPath, ['-e', `fetch('${base}/connect/setup.mjs').then(r=>r.text()).then(t=>import('data:text/javascript,'+encodeURIComponent(t)))`, ...(flags.length ? ['--', ...flags] : [])], {
        cwd: project,
        env: { ...process.env, LATTICE_AGENT_TOKEN: '', LATTICE_SETUP_PROFILE: at('profile'), ...env },
      });
      let out = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (out += d));
      child.on('close', (code) => done({ out, code }));
    });
  const first = { LATTICE_AGENT_TOKEN: 'lat_default_secret', LATTICE_SETUP_SAVE: '1' };

  // With nobody to ask and no yes, a first setup is shown and refused.
  const refused = await setup();
  assert.equal(refused.code, 1, refused.out);
  assert.match(refused.out, /this would:[\s\S]*change {5}\.mcp\.json {2}\(adds the lattice tools\) {2}\(a copy is kept: \.mcp\.json\.lattice-backup\)[\s\S]*write {6}\.claude\/lattice-hook\.mjs[\s\S]*add to {5}CLAUDE\.md[\s\S]*Nothing was written[\s\S]*-- --yes/);
  untouched();
  assert.ok(!existsSync(at('.claude/lattice-hook.mjs')));

  // A dry run names what it would keep for the machine, and where, without the token and without writing.
  const dry = await setup(['--dry-run'], first);
  assert.equal(dry.code, 0, dry.out);
  assert.ok(dry.out.includes(`keep       LATTICE_URL and LATTICE_AGENT_TOKEN in ${at('profile')}, outside this folder`), dry.out);
  assert.match(dry.out, /Nothing was written \(--dry-run\)/);
  assert.ok(!dry.out.includes('lat_default_secret'));
  untouched();
  assert.equal((await setup(['--force'])).code, 1, 'an option it does not know stops it');
  untouched();

  // With a yes it writes, and what it changed of theirs has a copy beside it holding what was there.
  const done = await setup(['--yes'], first);
  assert.equal(done.code, 0, done.out);
  assert.ok(!done.out.includes('lat_default_secret'));
  for (const path of Object.keys(theirs)) assert.equal(file(`${path}.lattice-backup`), theirs[path as keyof typeof theirs], `${path} is copied as it was`);
  assert.ok(JSON.parse(file('.mcp.json')).mcpServers.lattice && JSON.parse(file('.mcp.json')).mcpServers.other);
  assert.deepEqual(Object.keys(JSON.parse(file('.claude/lattice-setup.json')).files).sort(), ['.claude/lattice-hook.mjs', '.claude/lattice.md', '.claude/skills/lattice-bump/SKILL.md', '.claude/skills/lattice-bump/references/home.md']);

  // Later, with nobody to ask: what Lattice wrote is brought up to date; what is theirs is left, and said.
  writeFileSync(at('.claude/lattice.md'), 'rules as an older server handed them out\n');
  writeFileSync(at('.mcp.json'), theirs['.mcp.json']);
  const renewed = await setup();
  assert.equal(renewed.code, 0, renewed.out);
  assert.match(renewed.out, /not done {3}\.mcp\.json {2}\(it needs a yes\)[\s\S]*written {4}\.claude\/lattice\.md[\s\S]*Some of it was left/);
  assert.match(file('.claude/lattice.md'), /view` with name `handoff`/);
  assert.equal(file('.mcp.json'), theirs['.mcp.json']);
  assert.equal((await setup(['--yes'])).code, 0);
  assert.ok(JSON.parse(file('.mcp.json')).mcpServers.lattice);
  assert.equal(file('.mcp.json.lattice-backup'), theirs['.mcp.json'], 'the first copy is not written over');

  // Taking it out needs a yes too. A file of Lattice's that was changed by hand is kept, and named.
  writeFileSync(at('.claude/skills/lattice-bump/SKILL.md'), file('.claude/skills/lattice-bump/SKILL.md') + '\nOur own note.\n');
  assert.equal((await setup(['--remove'])).code, 1);
  assert.equal((await setup(['--remove', '--dry-run'])).code, 0);
  assert.ok(existsSync(at('.claude/lattice-hook.mjs')), 'neither took anything out');
  const out = await setup(['--remove', '--yes']);
  assert.equal(out.code, 0, out.out);
  assert.match(out.out, /kept {7}\.claude\/skills\/lattice-bump\/SKILL\.md {2}\(changed since the setup wrote it\)[\s\S]*Lattice is out of[\s\S]*add --machine/);
  assert.deepEqual(JSON.parse(file('.mcp.json')), JSON.parse(theirs['.mcp.json']));
  assert.deepEqual(JSON.parse(file('.claude/settings.json')), JSON.parse(theirs['.claude/settings.json']));
  assert.equal(file('CLAUDE.md'), theirs['CLAUDE.md']);
  assert.deepEqual(readdirSync(at('.claude')).sort(), ['settings.json', 'settings.json.lattice-backup', 'skills']);
  assert.deepEqual(readdirSync(at('.claude/skills/lattice-bump')), ['SKILL.md']);
  assert.match(file('profile'), /LATTICE_AGENT_TOKEN/, 'what is kept for the machine is left unless asked');
  const forgot = await setup(['--remove', '--machine', '--yes']);
  assert.match(forgot.out, /forgot {5}the server’s address and the token, on this machine/);
  assert.equal(file('profile'), theirs.profile);

  // A folder that held nothing before the setup holds nothing after it is taken out.
  const empty = mkdtempSync(join(tmpdir(), 'lattice-empty-'));
  const inEmpty = (flags: string[]) =>
    new Promise<number | null>((done) => {
      const child = spawn(process.execPath, ['-e', `fetch('${base}/connect/setup.mjs').then(r=>r.text()).then(t=>import('data:text/javascript,'+encodeURIComponent(t)))`, '--', ...flags], { cwd: empty, env: { ...process.env, LATTICE_AGENT_TOKEN: '' } });
      child.on('close', done);
    });
  assert.equal(await inEmpty(['--yes']), 0);
  assert.ok(readdirSync(empty).length >= 3);
  assert.equal(await inEmpty(['--remove', '--yes']), 0);
  assert.deepEqual(readdirSync(empty), []);
});

test('the hook script takes a Claude Code hook to whichever server the machine is connected to, with its token', async () => {
  const { workspaces, call, base } = await serve('tokens');
  const db = (await workspaces.get('default')).lattice.db;
  const robot = (await createToken(db, 'default', { kind: 'agent', name: 'robot' })).token;
  const hook = (name: string, input: unknown, env: Record<string, string>) =>
    new Promise<{ out: string; err: string; code: number | null }>((done) => {
      const child = spawn(process.execPath, [join(import.meta.dirname, '..', 'scripts', 'lattice-hook.mjs'), name], { env: { ...process.env, LATTICE_URL: base, LATTICE_AGENT_TOKEN: '', ...env } });
      let out = '';
      let err = '';
      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('close', (code) => done({ out, err, code }));
      child.stdin.end(JSON.stringify(input));
    });

  const started = await hook('session-start', { session_id: 'desk-1', cwd: '/nowhere' }, { LATTICE_AGENT_TOKEN: robot });
  assert.match(JSON.parse(started.out).hookSpecificOutput.additionalContext, /registered in Lattice/, 'the server\u2019s answer comes back for Claude Code to read');
  // A project whose files are not the ones the server now hands out is told so, with the command that brings them up to date.
  const { SETUP_VERSION, setupScript } = await import('../src/connect.ts');
  const behind = /Lattice files \(hooks, working rules, the bump skill\) are older than the server\u2019s|are older than the server's[^]*connect\/setup\.mjs/;
  assert.match(JSON.parse(started.out).hookSpecificOutput.additionalContext, behind, 'the script in this repository is not a hand-out: it says no version');
  const current = (await call('/hooks/session-start', robot, { session_id: 'desk-1', cwd: '/nowhere', setup: SETUP_VERSION })).hookSpecificOutput.additionalContext;
  assert.doesNotMatch(current, /older than the server/);
  assert.ok(setupScript(base).includes(`const SETUP = '${SETUP_VERSION}';`), 'the hook a project is given says which hand-out it is');
  const open = (await call('/agent/view', robot, { name: 'sessions' })).result.open;
  assert.deepEqual(open.map((s: any) => s.surface), ['claude-code'], 'and the session is on that server\u2019s map');
  // At the end of a turn the session's count so far goes to its run: one long turn is not a session without tokens.
  const transcript = join(mkdtempSync(join(tmpdir(), 'lattice-transcript-')), 'desk-1.jsonl');
  writeFileSync(transcript, JSON.stringify({ type: 'assistant', uuid: 'a1', message: { id: 'm1', usage: { input_tokens: 1200, output_tokens: 300 } } }) + '\n');
  assert.deepEqual([(await hook('stop', { session_id: 'desk-1', transcript_path: transcript }, { LATTICE_AGENT_TOKEN: robot })).out, open.length], ['{}', 1]);
  assert.equal((await call('/agent/get', robot, { id: open[0].id })).result.entity.props.tokens_used, 1500);
  await hook('session-end', { session_id: 'desk-1', reason: 'exit' }, { LATTICE_AGENT_TOKEN: robot });
  assert.equal((await call('/agent/view', robot, { name: 'sessions' })).result.open.length, 0, 'and is closed there');

  // A client with an old tool list sends an input it does not know as a string: it is taken as what it spells.
  const { z } = await import('zod');
  assert.equal(lenient(z.boolean().optional()).parse('true'), true);
  assert.deepEqual(lenient(z.array(z.string()).optional()).parse('["e_1","e_2"]'), ['e_1', 'e_2']);
  assert.deepEqual(lenient(z.array(z.object({ at: z.number() }))).parse('[{"at":2}]'), [{ at: 2 }]);
  assert.equal(lenient(z.string()).parse('true'), 'true', 'a string stays a string');
  assert.equal(lenient(z.number().optional()).parse(undefined), undefined);
  assert.throws(() => lenient(z.boolean()).parse('maybe'));

  // Refused or unreachable, it says so and still lets the session go on.
  const refused = await hook('prompt', { session_id: 'desk-1' }, {});
  assert.deepEqual([refused.code, refused.out, /answered 401/.test(refused.err)], [0, '', true]);
  const away = await hook('prompt', { session_id: 'desk-1' }, { LATTICE_URL: 'http://127.0.0.1:9' });
  assert.deepEqual([away.code, away.out, /did not answer/.test(away.err)], [0, '', true]);
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

test('the GitHub App: the server\'s owner creates it once, a workspace connects by choosing repositories, and pushes arrive at one address', async () => {
  // A stand-in for GitHub: it hands over the app for a code, and answers the app and its installation only when each proves who it is.
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;
  const asked: string[] = [];
  const hub = createServer((req, res) => {
    const say = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    const bearer = (req.headers.authorization ?? '').replace('Bearer ', '');
    const isApp = () => {
      const [head, body, sig] = bearer.split('.');
      return Boolean(sig) && createVerify('RSA-SHA256').update(`${head}.${body}`).verify(publicKey, sig, 'base64url') && JSON.parse(Buffer.from(body, 'base64url').toString()).iss === '7';
    };
    asked.push(`${req.method} ${req.url}`);
    if (req.method === 'POST' && req.url === '/app-manifests/thecode/conversions') return say(201, { id: 7, slug: 'lattice-test', name: 'Lattice (test)', pem, webhook_secret: 'whsec' });
    if (req.url === '/app/installations/42') return isApp() ? say(200, { account: { login: 'acme' } }) : say(401, { message: 'Bad credentials' });
    if (req.method === 'POST' && req.url === '/app/installations/42/access_tokens') return isApp() ? say(201, { token: 'ghs_forty-two', expires_at: new Date(Date.now() + 3600_000).toISOString() }) : say(401, { message: 'Bad credentials' });
    if (req.url?.startsWith('/repos/Acme/Tools/compare/')) return bearer === 'ghs_forty-two' ? say(200, { commits: [{ sha: 'b'.repeat(40), commit: { message: 'Sharpen the tools\n\nThe whetstone still needs oiling.', author: { name: 'sam' } } }], files: [{ filename: 'tools/sharpen.ts', status: 'modified', additions: 4, deletions: 1 }] }) : say(401, { message: 'Bad credentials' });
    if (req.url === '/repos/Acme/Tools') return say(200, { default_branch: 'main' });
    if (req.url?.startsWith('/installation/repositories')) return bearer === 'ghs_forty-two' ? say(200, { repositories: [{ full_name: 'Acme/Site' }, { full_name: 'Acme/Tools' }] }) : say(401, { message: 'Bad credentials' });
    say(404, { message: 'Not Found' });
  });
  await new Promise<void>((r) => hub.listen(0, '127.0.0.1', r));
  closers.push(async () => void hub.close());
  const hubAt = `http://127.0.0.1:${(hub.address() as AddressInfo).port}`;

  let theApp: GithubApp | undefined;
  const { workspaces, call, base } = await serve('tokens', (origin) => (theApp ??= new GithubApp({ dir: null, origin, api: hubAt, web: 'https://github.test' })));
  const db = (await workspaces.get('default')).lattice.db;
  const admin = (await createToken(db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const robot = (await createToken(db, 'default', { kind: 'agent', name: 'robot' })).token;
  await call('/api/change', admin, { reason: 'x', ops: [{ op: 'create', type: 'software.repo', title: 'Site repo', props: { remote: 'https://github.com/acme/site.git' } }] });
  const page = (path: string) => fetch(base + path, { redirect: 'manual' });

  // 1. The server has no app until its owner creates one. An agent cannot.
  assert.deepEqual((await call('/api/github_app', admin)).result, { available: true, app: null, can_create: true, installation: null, reader: { key: false, model: 'claude-sonnet-5-5' } });
  assert.match((await call('/agent/github_app', robot, { create: true })).error, /humans only/);
  assert.match((await call('/api/github_app', admin, { connect: true })).error, /no GitHub App yet/);
  const create = (await call('/api/github_app', admin, { create: true })).result.url as string;
  const form = await (await page(create.slice(base.length))).text();
  const state = /settings\/apps\/new\?state=([0-9a-f]+)/.exec(form)![1];
  assert.ok(form.includes('action="https://github.test/settings/apps/new?state='), 'the page sends its reader to GitHub with the manifest');
  const manifest = JSON.parse(/name="manifest" value="([^"]+)"/.exec(form)![1].replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
  assert.deepEqual([manifest.hook_attributes.url, manifest.setup_url, manifest.default_permissions, manifest.default_events], [`${base}/github/app/hook`, `${base}/github/app/installed`, { contents: 'read', metadata: 'read' }, ['push']]);
  assert.equal((await page('/github/app/created?code=thecode&state=not-ours')).status, 400, 'a code is taken only from someone who started here');
  assert.equal((await page(`/github/app/created?code=thecode&state=${state}`)).status, 302);
  assert.equal((await page(`/github/app/created?code=thecode&state=${state}`)).status, 400, 'and once');
  assert.deepEqual((await call('/api/github_app', admin)).result.app, { slug: 'lattice-test', name: 'Lattice (test)' });

  // 2. A workspace connects: its admin is sent to choose repositories, and comes back with the installation.
  const connect = (await call('/api/github_app', admin, { connect: true })).result.url as string;
  assert.match(connect, /^https:\/\/github\.test\/apps\/lattice-test\/installations\/new\?state=[0-9a-f]+$/);
  assert.equal((await page('/github/app/installed?installation_id=42&state=guessed')).status, 400);
  assert.equal((await page(`/github/app/installed?installation_id=42&${connect.split('?')[1]}`)).status, 302);
  assert.deepEqual((await call('/api/github_app', admin)).result.installation, { id: '42', account: 'acme' });
  assert.ok(asked.includes('GET /app/installations/42'), 'the installation was asked of GitHub, as the app');
  // Each repository chosen is in the map: the one it knew is left alone, the other is made with its address.
  const repos = (await call('/api/github', admin)).result.repos.map((r: any) => [r.title, r.github]).sort();
  assert.deepEqual(repos, [['Site repo', 'acme/site'], ['Tools repo', 'acme/tools']]);

  // 3. Pushes arrive at one address, signed with the app's secret; the installation says whose map they are for.
  const deliver = async (event: string, payload: unknown, secret = 'whsec') => {
    const body = JSON.stringify(payload);
    const res = await fetch(`${base}/github/app/hook`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-github-event': event, 'x-hub-signature-256': `sha256=${createHmac('sha256', secret).update(body).digest('hex')}` }, body });
    return { status: res.status, ...((await res.json()) as any) };
  };
  const push = (installation: number) => ({ ref: 'refs/heads/main', before: '0'.repeat(40), after: 'a'.repeat(40), installation: { id: installation }, repository: { full_name: 'Acme/Tools', default_branch: 'main' }, pusher: { name: 'sam' }, commits: [{ id: 'a'.repeat(40), message: 'Sharpen the tools' }] });
  assert.equal((await deliver('push', push(42), 'someone-elses')).status, 401);
  const heard = (await deliver('push', push(42))).result;
  assert.deepEqual([heard.recorded, heard.repo.title, heard.commits], [true, 'Tools repo', 1]);
  assert.equal((await deliver('push', push(99))).result.recorded, false, 'an installation no workspace connected is not anyone\'s');
  // 4. With a key, the agent on this server reads the push: it looks at the commits through the app, asks the map,
  // and sends what the commits show. Here the model is a script, so what is tried is everything around it.
  assert.deepEqual((await call('/api/github_app', admin)).result.reader, { key: false, model: 'claude-sonnet-5-5' });
  assert.equal(heard.reading, false, 'without a key a push is recorded and not read');
  assert.match((await call('/agent/github_app', robot, { key: 'sk-ant-' + 'x'.repeat(30) })).error, /humans only/);
  // Something that is not this repository's: the reader is held to the repository it reads, whatever it is told there.
  const outside = (await call('/api/change', admin, { reason: 'x', ops: [{ op: 'create', type: 'task', title: 'Pay the invoice' }] })).result.created['#1'];
  const asks: any[] = [];
  const script = [
    { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Reading the push.' }, { type: 'tool_use', id: 'tu_1', name: 'commits', input: { base: 'a'.repeat(40), head: 'b'.repeat(40) } }, { type: 'tool_use', id: 'tu_2', name: 'view', input: { name: 'repo_work', params: { repo: 'acme/tools' } } }, { type: 'tool_use', id: 'tu_3', name: 'no_such_tool', input: {} }] },
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_4', name: 'change', input: { reason: 'The commit says the whetstone still needs oiling', authority: { of: 'agent', basis: 'Message of commit bbbbbbb' }, ops: [{ op: 'create', ref: 't', type: 'task', title: 'Oil the whetstone' }, { op: 'link', type: 'software.lives_in', from: 't', to: heard.repo.id }, { op: 'update', id: outside, title: 'Steered by a file in the repository' }] } }] },
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_5', name: 'change', input: { reason: 'The commit says the whetstone still needs oiling', authority: { of: 'agent', basis: 'Message of commit bbbbbbb' }, ops: [{ op: 'create', ref: 't', type: 'task', title: 'Oil the whetstone' }, { op: 'link', type: 'software.lives_in', from: 't', to: heard.repo.id }] } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Made one task: Oil the whetstone.' }] },
  ];
  configureReader((key) => async (params) => {
    asks.push({ key, ...params, messages: structuredClone(params.messages) }); // as they stood when asked: the run goes on adding to them
    return { id: `msg_${asks.length}`, type: 'message', role: 'assistant', model: params.model, usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 }, ...script[asks.length - 1] } as any;
  }, async (key) => !key.includes('revoked'));
  // A key is tried when it is given: one Anthropic will not take is not saved, and a sign-in token is told from an API key.
  assert.match((await call('/api/github_app', admin, { key: 'sk-ant-api03-revoked-' + 'x'.repeat(20) })).error, /Anthropic refused that key, so it was not saved/);
  assert.match((await call('/api/github_app', admin, { key: 'sk-ant-oat01-' + 'x'.repeat(30) })).error, /sign-in token[\s\S]*needs an API key/);
  assert.equal((await call('/api/github_app', admin)).result.reader.key, false);
  assert.equal((await call('/api/github_app', admin, { key: 'sk-ant-' + 'x'.repeat(30) })).result.reader.key, true);
  // The key is sealed where it is stored, so neither the database nor a backup of it holds it; nor does the log of its being set.
  const kept = (await db.query<{ value: string }>(`select value from setting where key = 'anthropic_key'`)).rows[0].value;
  assert.match(kept, /^sealed:v1:/);
  assert.ok(!JSON.stringify(await dump(db, { id: 'default', name: 'Default' })).includes('sk-ant-'));
  // One stored before secrets were sealed leaves in a backup sealed all the same, and is sealed where it lies once it is read.
  await db.query(`update setting set value = $1::jsonb where key = 'anthropic_key'`, [JSON.stringify('sk-ant-' + 'x'.repeat(30))]);
  assert.ok(!JSON.stringify(await dump(db, { id: 'default', name: 'Default' })).includes('sk-ant-'));
  assert.equal((await call('/api/github_app', admin)).result.reader.key, true);
  assert.match((await db.query<{ value: string }>(`select value from setting where key = 'anthropic_key'`)).rows[0].value, /^sealed:v1:/);
  const read = (await deliver('push', { ...push(42), before: 'a'.repeat(40), after: 'b'.repeat(40) })).result;
  assert.deepEqual([read.recorded, read.reading], [true, true]);
  let runs: any[] = [];
  for (let i = 0; i < 50 && !runs.length; i++) {
    await new Promise((r) => setTimeout(r, 100));
    runs = (await call('/api/view', admin, { name: 'agent_usage', params: { repo: 'acme/tools' } })).result.runs;
  }
  assert.deepEqual([runs[0].title, runs[0].surface, runs[0].status, runs[0].tokens, runs[0].turns], ['Read the push to main (bbbbbbb)', 'server', 'finished', 4800, 4]);
  // A change that reached outside the repository was refused whole, and the reader was told why; nothing outside was touched.
  assert.match(asks[2].messages.at(-1).content[0].content, /limited to the work of Tools repo\. "Pay the invoice" is not part of it/);
  assert.equal(asks[2].messages.at(-1).content[0].is_error, true);
  assert.equal((await call('/api/get', admin, { id: outside })).result.entity.title, 'Pay the invoice');
  // It asked with the workspace's key, on the model chosen, with the map's tools and the repository's beside them.
  assert.deepEqual([asks[0].key, asks[0].model, asks[0].fallbacks], ['sk-ant-' + 'x'.repeat(30), 'claude-sonnet-5-5', 'default']);
  assert.ok(['view', 'change', 'commits', 'diff', 'file'].every((name) => asks[0].tools.some((t: any) => t.name === name)));
  assert.match(asks[0].messages[0].content, /branch "main" of Acme\/Tools[\s\S]*aaaaaaa.*\.\.b{40}/);
  // What it asked for was done, all of a turn answered together, and a tool that is not there said so without ending the run.
  const answers = asks[1].messages.at(-1).content;
  assert.deepEqual(answers.map((a: any) => [a.tool_use_id, Boolean(a.is_error)]), [['tu_1', false], ['tu_2', false], ['tu_3', true]]);
  assert.match(answers[0].content, /whetstone still needs oiling[\s\S]*tools\/sharpen\.ts/);
  // What it sent is an agent's change like any other: here, where agents' changes are held, it waits for the owner.
  const held = (await call('/api/proposals', admin)).result;
  assert.deepEqual(held.map((p: any) => [p.actor, p.ops[0].title]), [['agent:reader', 'Oil the whetstone']]);
  // The same push said twice (a webhook left in the repository beside the app) is taken in once, and read once.
  assert.deepEqual((await deliver('push', { ...push(42), before: 'a'.repeat(40), after: 'b'.repeat(40) })).result.recorded, false);
  // A push recorded while its reading was cut off (the server stopped) has no run: the next server reads it, with any
  // pushed before it that were not read either, as one. What was read, even badly, is not read again.
  const whole = (await workspaces.get('default')).lattice;
  const app = (await call('/api/github_app', admin)).result;
  assert.equal(app.installation.id, '42');
  await whole.log(whole.db, { actor: 'github:sam', action: 'repo.push', target: heard.repo.id, origin: 'github', reason: '1 commit to main: Hone', detail: { repo: 'acme/tools', branch: 'main', before: 'b'.repeat(40), after: 'c'.repeat(40), commits: [{ sha: 'ccccccc' }] } });
  await whole.log(whole.db, { actor: 'github:sam', action: 'repo.push', target: heard.repo.id, origin: 'github', reason: '1 commit to main: Strop', detail: { repo: 'acme/tools', branch: 'main', before: 'c'.repeat(40), after: 'd'.repeat(40), commits: [{ sha: 'ddddddd' }] } });
  script.push({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Nothing needed changing.' }] });
  assert.deepEqual(await readUnread(whole, theApp!, '42'), [{ repo: 'Acme/Tools', branch: 'main', after: 'd'.repeat(40) }]);
  assert.match(asks.at(-1).messages[0].content, new RegExp(`${'b'.repeat(40)}\\.\\.${'d'.repeat(40)}`), 'from the last push that was read to the newest');
  assert.deepEqual(await readUnread(whole, theApp!, '42'), [], 'and once');

  // Its admin can ask for a re-check of a repository now; only of one the app was given, and no agent can.
  assert.match((await call('/agent/github_app', robot, { recheck: heard.repo.id })).error, /humans only/);
  assert.match((await call('/api/github_app', admin, { recheck: 'e_notarepo' })).error, /not a repository the GitHub App was given/);
  assert.equal((await call('/api/github_app', admin, { recheck: heard.repo.id })).result.started, true);

  // The key is never given back, and removing it stops the reading.
  assert.ok(!JSON.stringify((await call('/api/github_app', admin)).result).includes('sk-ant-'));
  assert.equal((await call('/api/github_app', admin, { forget_key: true })).result.reader.key, false);

  assert.deepEqual((await deliver('installation_repositories', { action: 'added', installation: { id: 42, account: { login: 'acme' } }, repositories_added: [{ full_name: 'Acme/Docs' }] })).result, { added: ['Acme/Docs'], known: [] });
  // Chosen again on GitHub later, they come back with no word: the installation is known, and the map is brought up to date.
  assert.equal((await page('/github/app/installed?installation_id=42&setup_action=update')).status, 302);
  // Removed on GitHub, it is forgotten here.
  assert.equal((await deliver('installation', { action: 'deleted', installation: { id: 42 } })).result.forgotten, 42);
  assert.equal((await call('/api/github_app', admin)).result.installation, null);
  assert.equal((await deliver('push', push(42))).result.recorded, false);
});

test('an agent\'s token can be limited to some repositories, and its owner hears when a token is used from a new place', async () => {
  const { workspaces, call, base } = await serve('tokens');
  const db = (await workspaces.get('default')).lattice.db;
  const admin = (await createToken(db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const made = (
    await call('/api/change', admin, {
      reason: 'x',
      ops: [
        { op: 'create', ref: 'r', type: 'software.repo', title: 'Site repo', props: { remote: 'https://github.com/acme/site' } },
        { op: 'create', ref: 'other', type: 'software.repo', title: 'Books repo', props: { remote: 'https://github.com/acme/books' } },
        { op: 'create', ref: 'p', type: 'project', title: 'Site' },
        { op: 'create', ref: 't', type: 'task', title: 'Fix the footer' },
        { op: 'create', ref: 'o', type: 'task', title: 'Close the year' },
        { op: 'link', type: 'software.lives_in', from: 'p', to: 'r' },
        { op: 'link', type: 'part_of', from: 't', to: 'p' },
      ],
    })
  ).result.created;
  // Its owner makes it for one repository, with an end. Only a repository can be the limit, and only an agent limited.
  assert.match((await call('/api/token_create', admin, { kind: 'agent', name: 'x', repos: [made.t] })).error, /not a repository/);
  assert.match((await call('/api/token_create', admin, { kind: 'human', name: 'x', repos: [made.r] })).error, /Only an agent/);
  const site = (await call('/api/token_create', admin, { kind: 'agent', name: 'site-machine', repos: [made.r], expires_days: 90 })).result.token;
  const free = (await call('/api/token_create', admin, { kind: 'agent', name: 'everywhere' })).result.token;
  const listed = (await call('/api/token_list', admin)).result.find((t: any) => t.name === 'site-machine');
  assert.deepEqual([listed.repos, Math.round((Date.parse(listed.expires_at) - Date.now()) / 86_400_000)], [[made.r], 90]);

  const change = (token: string, ops: unknown[]) => call('/agent/change', token, { reason: 'test', ops });
  // What is the repository's it can change; what is not, it cannot, though it can read it.
  assert.equal((await change(site, [{ op: 'update', id: made.t, status: 'doing' }])).result.status, 'proposed');
  assert.match((await change(site, [{ op: 'update', id: made.o, status: 'done' }])).error, /limited to the work of Site repo\. "Close the year" is not part of it, so this token cannot change it/);
  assert.equal((await call('/agent/get', site, { id: made.o })).result.entity.title, 'Close the year');
  assert.equal((await change(free, [{ op: 'update', id: made.o, status: 'doing' }])).result.status, 'proposed', 'a token with no limit is as before');
  // What it makes has to be tied into that work in the same change; then it may be.
  assert.match((await change(site, [{ op: 'create', type: 'task', title: 'Loose' }])).error, /made without being tied to anything there/);
  assert.equal((await change(site, [{ op: 'create', ref: 'n', type: 'task', title: 'Test the footer' }, { op: 'create', ref: 'q', type: 'decision', title: 'Which footer?' }, { op: 'link', type: 'part_of', from: 'n', to: made.p }, { op: 'link', type: 'depends_on', from: 'n', to: 'q' }])).result.status, 'proposed');
  // It may say its work waits on something outside, but not hang anything on what is outside, nor merge, archive or retype the map.
  assert.equal((await change(site, [{ op: 'link', type: 'depends_on', from: made.t, to: made.o }])).result.status, 'proposed');
  assert.match((await change(site, [{ op: 'link', type: 'depends_on', from: made.o, to: made.t }])).error, /cannot change what it is linked to/);
  assert.match((await change(site, [{ op: 'archive', id: made.o }])).error, /cannot archive it/);
  assert.match((await change(site, [{ op: 'merge', keep: made.t, drop: made.o }])).error, /cannot merge it/);
  assert.match((await change(site, [{ op: 'define_type', type: { id: 'local.x', title: 'X', description: 'x' } }])).error, /cannot define a type/);
  // Nor speak for another repository, or take on work that is not its own.
  assert.match((await call('/agent/rechecked', site, { repo: 'acme/books' })).error, /cannot speak for another repository/);
  assert.equal((await call('/agent/rechecked', site, { repo: 'acme/site' })).status, 200);
  const run = (await call('/agent/session_start', site, { title: 'On the site' })).result.run;
  assert.match((await call('/agent/session_update', site, { run, task: made.o })).error, /cannot take it on/);
  assert.equal((await call('/agent/session_update', site, { run, task: made.t })).status, 200);

  // What it may call is a list. Beyond changing its own work it reads, and what else writes is held to that work too.
  const more = (
    await call('/api/change', admin, {
      reason: 'x',
      ops: [
        { op: 'create', ref: 'q', type: 'software.proof', title: 'Does the footer stay down?' },
        { op: 'create', ref: 'mine', type: 'software.test', title: 'Footer stays down', props: { entrypoint: 'Footer.StaysDown' } },
        { op: 'create', ref: 'theirs', type: 'software.test', title: 'Books balance', props: { entrypoint: 'Books.Balance' } },
        { op: 'create', ref: 'lane', type: 'resource', title: 'The one browser' },
        { op: 'create', ref: 'press', type: 'resource', title: 'The printing press' },
        { op: 'create', ref: 'shared', type: 'resource', title: 'The one lane' },
        { op: 'link', type: 'part_of', from: 'q', to: made.p },
        { op: 'link', type: 'software.answers', from: 'mine', to: 'q' },
        { op: 'link', type: 'needs', from: made.t, to: 'lane' },
        { op: 'link', type: 'needs', from: made.o, to: 'press' },
      ],
    })
  ).result.created;
  for (const tool of ['backup', 'confirmed', 'check_connections', 'import_audit']) {
    const input = tool === 'confirmed' ? { upto: 1, basis: 'x' } : tool === 'import_audit' ? { connection: 'x' } : {};
    assert.match((await call(`/agent/${tool}`, site, input)).error, new RegExp(`limited to the work of Site repo\\. It cannot call ${tool}\\.`));
  }
  for (const tool of ['schema', 'search', 'proposals']) assert.equal((await call(`/agent/${tool}`, site, {})).status, 200, `${tool} only reads`);
  // A test's results: for a test that helps answer a question of its work, not for another's.
  const report = (results: unknown[]) => call('/agent/test_report', site, { build: '1.0.0', results });
  assert.match((await report([{ test: 'Books.Balance', passed: true }])).error, /"Books balance" is not a test of it/);
  assert.match((await report([{ test: 'Footer.StaysDown', passed: true }, { test: more.theirs, passed: true }])).error, /not a test of it/);
  assert.equal((await report([{ test: 'Footer.StaysDown', passed: true }])).status, 200);
  assert.deepEqual((await report([{ test: 'Nobody.KnowsThis', passed: true }])).result.unknown, ['Nobody.KnowsThis'], 'a test the map does not know is named, as for any token');
  const theirResult = (await call('/api/test_report', admin, { build: '1.0.0', results: [{ test: 'Books.Balance', passed: true }] })).result;
  assert.equal(theirResult.recorded, 1);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64');
  const resultOf = async (test: string) => (await call('/api/get', admin, { id: test })).result.outgoing.find((r: any) => r.type === 'produced')?.id;
  assert.match((await call('/agent/picture_put', site, { result: await resultOf(more.theirs), data: png, content_type: 'image/png' })).error, /not the result of a test of it/);
  // A resource: one its work needs or that no work is said to need, held for its work; not one that is other work's.
  assert.equal((await call('/agent/claim', site, { resource: more.shared, holder: run, reason: 'x' })).status, 200);
  assert.equal((await call('/agent/release', site, { resource: more.shared, holder: run, reason: 'x' })).status, 200);
  assert.match((await call('/agent/claim', site, { resource: more.press, holder: run, reason: 'x' })).error, /Nothing there needs "The printing press"/);
  assert.match((await call('/agent/release', site, { resource: more.press, reason: 'x' })).error, /cannot release it/);
  assert.match((await call('/agent/claim', site, { resource: more.lane, holder: run, for: made.o, reason: 'x' })).error, /cannot hold a resource for it/);
  assert.equal((await call('/agent/claim', site, { resource: more.lane, holder: run, for: made.t, reason: 'x' })).status, 200);
  assert.equal((await call('/agent/release', site, { resource: more.lane, holder: run, reason: 'x' })).status, 200);
  // And it tells the owner only of its own work.
  assert.match((await call('/agent/notify', site, { title: 'Look', about: made.o })).error, /cannot send a notification about it/);
  assert.equal((await call('/agent/notify', site, { title: 'Look', about: made.t })).status, 200);
  assert.equal((await call('/agent/check_connections', free, {})).status, 200, 'a token with no limit calls what it could');

  // The hooks of a machine with such a token register and speak for sessions in its repositories, and no others.
  const sessions = async () => (await call('/agent/view', free, { name: 'sessions' })).result.open.map((s: any) => s.title);
  const before = await sessions();
  const elsewhere = await call('/hooks/session-start', site, { session_id: 'desk-books', cwd: '/x', remote: 'https://github.com/acme/books.git' });
  assert.match(elsewhere.hookSpecificOutput.additionalContext, /limited to some repositories[^]*not registered in Lattice/);
  assert.deepEqual(await sessions(), before, 'nothing was registered');
  const here = await call('/hooks/session-start', site, { session_id: 'desk-site', cwd: '/x', remote: 'https://github.com/acme/site.git' });
  assert.match(here.hookSpecificOutput.additionalContext, /registered in Lattice[^]*Site repo/);
  // A session another token registered in another repository is not ended, or counted for, by this one.
  await call('/hooks/session-start', free, { session_id: 'desk-other', cwd: '/x', remote: 'https://github.com/acme/books.git' });
  assert.equal((await sessions()).length, before.length + 2);
  await call('/hooks/session-end', site, { session_id: 'desk-other', reason: 'exit' });
  assert.equal((await sessions()).length, before.length + 2, 'still open');
  await call('/hooks/session-end', site, { session_id: 'desk-site', reason: 'exit' });
  assert.equal((await sessions()).length, before.length + 1, 'its own is ended');

  // Used from a network it has not been used from, its owner is told, once for that network. The first place is not news.
  const from = (address: string) => fetch(`${base}/agent/search`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${site}`, 'x-forwarded-for': address }, body: '{}' });
  const notices = async () => (await call('/api/view', admin, { name: 'notifications' })).result.filter((n: any) => /new place/.test(n.title));
  assert.equal((await notices()).length, 0);
  await from('203.0.113.9');
  assert.deepEqual((await notices()).map((n: any) => [n.title, /203\.0\.113\.x/.test(n.body)]), [['The token "site-machine" was used from a new place', true]]);
  await from('203.0.113.200, 10.0.0.1');
  assert.equal((await notices()).length, 1, 'the same network is the same place');
  await from('198.51.100.7');
  assert.equal((await notices()).length, 2);
  assert.equal((await call('/api/token_list', admin)).result.find((t: any) => t.name === 'site-machine').seen.length, 3);
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
  // The human is not sent a notification for each: what agents settled is put to them in one list, by the next session they talk to.
  assert.deepEqual((await call('/api/view', admin, { name: 'notifications' })).result, []);
  const asked = (await call('/agent/view', robot, { name: 'to_confirm' })).result;
  assert.deepEqual(asked.questions.map((q: any) => [q.title, q.answer, q.on, q.basis]), [['Which colour?', 'Green', 'the owner\u2019s word, as the agent reports it', word.basis]]);
  // Their answer is recorded as their word, as the agent reports it: not as a human having looked.
  assert.match((await call('/agent/confirmed', robot, { upto: asked.upto })).error, /basis/);
  const said = (await call('/agent/confirmed', robot, { upto: asked.upto, basis: 'Alex, in chat on 9 Oct: "yes, green"' })).result;
  assert.deepEqual([said.questions, said.left], [1, 0]);
  // What an agent settled on its own judgment comes first and is counted apart: it is what the owner has not seen.
  const guessed = (await change(admin, [{ op: 'create', ref: 'h', type: 'hypothesis', title: 'Green fades', visibility: 'shared' }, { op: 'create', ref: 'd', type: 'decision', title: 'Which brush?', visibility: 'shared' }])).result.created;
  await change(robot, [{ op: 'update', id: guessed.d, status: 'decided', props: { outcome: 'The wide one', rationale: 'It is the one we have.' } }], word);
  await change(robot, [{ op: 'update', id: guessed.h, status: 'refuted' }], { of: 'agent', basis: 'A month of photos' });
  await change(robot, [{ op: 'create', type: 'note', title: 'Three', visibility: 'shared' }]);
  const sorted = (await call('/agent/view', robot, { name: 'to_confirm' })).result;
  assert.deepEqual([sorted.on_agents_judgment, sorted.on_owners_word, sorted.questions.map((q: any) => q.title)], [1, 1, ['Green fades', 'Which brush?']]);  const relayed = ((await call('/agent/events', robot, { limit: 50 })).result as any[]).find((e) => e.action === 'questions.confirmed');
  assert.deepEqual(relayed.detail.authority, { of: 'human', basis: 'Alex, in chat on 9 Oct: "yes, green"', stated_by: 'agent:robot/script' });
  // An agent reads what one actor did by naming them, and reads the log back by page.
  const byRobot = (await call('/agent/events', robot, { by: 'agent:robot/script', limit: 50 })).result as any[];
  assert.ok(byRobot.length > 0 && byRobot.every((e) => e.actor === 'agent:robot/script'));
  assert.ok(((await call('/agent/events', robot, { before: byRobot[0].seq, limit: 50 })).result as any[]).every((e) => e.seq < byRobot[0].seq));
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

test('a product\u2019s public page is open to anyone, and says nothing until something is made public', async () => {
  const { call, base } = await serve('off');
  const made = await call('/api/change', undefined, {
    reason: 'x',
    ops: [
      { op: 'create', ref: 'app', type: 'project', title: 'App', body: 'An internal note' },
      { op: 'create', ref: 'sun', type: 'software.proof', title: 'How do we know the sun is correct?' },
      { op: 'link', type: 'part_of', from: 'sun', to: 'app' },
    ],
  });
  const app = made.result.created.app;
  const get = (path: string) => call(path, undefined, undefined, 'GET');
  assert.equal((await get(`/p/default/${app}/data`)).status, 404);
  await call('/api/change', undefined, { reason: 'x', ops: [{ op: 'update', id: app, visibility: 'public' }, { op: 'update', id: made.result.created.sun, visibility: 'public' }] });
  const page = await get(`/p/default/${app}/data`);
  assert.deepEqual([page.status, page.title, page.questions.map((q: any) => q.title)], [200, 'App', ['How do we know the sun is correct?']]);
  assert.ok(!JSON.stringify(page).includes('internal note'));
  // The page itself is a shell that asks for the data; it carries nothing of the map, and may load nothing from elsewhere.
  const shell = await fetch(`${base}/p/default/${app}`);
  assert.equal(shell.status, 200);
  assert.match(shell.headers.get('content-security-policy') ?? '', /default-src 'none'/);
  assert.match(await shell.text(), /public\.js/);
  assert.equal((await fetch(`${base}/public.js`)).status, 200);
  // What is not there is not there: another product, another workspace, a picture that was never kept.
  assert.equal((await get(`/p/default/e_nothing1/data`)).status, 404);
  assert.equal((await get(`/p/elsewhere/${app}/data`)).status, 404);
  assert.equal((await get(`/p/default/${app}/picture/${made.result.created.sun}`)).status, 404);
});

test('what answers without a token is asked only so often: by one address, and by all together', async () => {
  // The count itself: so many a minute for each address, and the minute starts again.
  let clock = 0;
  const count = limiter({ each: 2, all: 3 }, () => clock);
  assert.deepEqual([count.take('a'), count.take('a'), count.take('a')], [0, 0, 60]);
  clock = 30_000;
  assert.deepEqual([count.take('b'), count.take('b'), count.take('c')], [0, 30, 30], 'a third address is stopped by what all have asked together');
  clock = 60_000;
  assert.equal(count.take('a'), 0);

  const { base, call } = await serve('tokens', undefined, { open: { each: 3, all: 5 }, deliveries: { each: 2 } });
  const get = (path: string, address: string) => fetch(base + path, { headers: { 'x-forwarded-for': address } });
  const statuses = async (path: string, address: string, times: number) => {
    const seen: number[] = [];
    for (let i = 0; i < times; i++) seen.push((await get(path, address)).status);
    return seen;
  };
  // Nothing is public here, so a page's data is not found; asked a fourth time, it is refused instead, and says for how long.
  assert.deepEqual(await statuses('/p/default/e_nothing1/data', '198.51.100.1', 3), [404, 404, 404]);
  const refused = await get('/p/default/e_nothing1/data', '198.51.100.1');
  assert.equal(refused.status, 429);
  assert.ok(Number(refused.headers.get('retry-after')) >= 1 && Number(refused.headers.get('retry-after')) <= 60);
  assert.match(((await refused.json()) as { error: string }).error, /too often/);
  // The page, its pictures and the setup script are counted together.
  assert.deepEqual([(await get('/p/default/e_nothing1', '198.51.100.1')).status, (await get('/connect/setup.mjs', '198.51.100.1')).status], [429, 429]);
  // Another address is not held up by the first, until all together have asked as much as all may.
  assert.deepEqual(await statuses('/connect/setup.mjs', '198.51.100.2', 2), [200, 200]);
  assert.equal((await get('/connect/setup.mjs', '198.51.100.3')).status, 429);
  // Deliveries are counted apart, and an unsigned one is refused as unsigned until it is asked too often.
  const deliver = async () => (await fetch(base + '/github/default', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.1' }, body: '{}' })).status;
  assert.deepEqual([await deliver(), await deliver(), await deliver()], [401, 401, 429]);
  // What needs a token, and health, are not counted.
  assert.equal((await get('/health', '198.51.100.1')).status, 200);
  assert.equal((await call('/api/search', undefined, {})).status, 401);
});

test('a request larger than any honest one is refused, before it is known who sent it', async () => {
  const { base } = await serve('tokens');
  const send = (headers: Record<string, string>, megabytes: number, whole = true) =>
    new Promise<number | 'ended'>((resolve, reject) => {
      const req = request(base + '/github/default', { method: 'POST', agent: false, headers: { 'content-type': 'application/json', ...headers } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
        if (!whole) req.destroy();
      });
      // The server answers while the body is still on its way and ends the connection, so the answer can be lost to the sender.
      req.on('error', (err: NodeJS.ErrnoException) => (err.code === 'ECONNRESET' || err.code === 'EPIPE' ? resolve('ended') : reject(err)));
      req.flushHeaders();
      const piece = Buffer.alloc(1_000_000, 0x20);
      for (let i = 0; i < megabytes; i++) req.write(piece);
      if (whole) req.end();
    });
  // By what it says it carries, and by what arrives when it does not say.
  assert.equal(await send({ 'content-length': '33000000' }, 0, false), 413);
  assert.ok([413, 'ended'].includes(await send({}, 33)));
  assert.equal(await send({}, 1), 401, 'one that is not too large is refused for the reason it would have been: it is not signed');
});

test('the reader asks GitHub only about the one repository, whatever the text it read there tells it to ask', () => {
  // A path or a ref is part of an address under the repository: a step up would land in another one.
  assert.equal(within('src/a file.ts'), 'src/a%20file.ts');
  assert.equal(within('feature/x'), 'feature/x');
  assert.equal(within(undefined), '');
  for (const path of ['../../other/contents/secrets.txt', 'src/../../../other', './x', '..']) assert.throws(() => within(path), /steps outside the repository/);
  // An encoded step is a name like any other to GitHub, and stays encoded.
  assert.equal(within('%2e%2e/x'), '%252e%252e/x');
  // A search is of this repository: words that say where to search are dropped.
  assert.equal(sought('api key repo:someone/private'), 'api key');
  assert.equal(sought('ORG:acme user: me token'), 'token');
  assert.equal(sought('reporter: is a word'), 'reporter: is a word');
});

test('the hook says which repository a session is in without the name and password its address may carry', async () => {
  // A server that only keeps what it is sent.
  const heard: { remote?: string }[] = [];
  const listener = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      heard.push(JSON.parse(body));
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    });
  });
  await new Promise<void>((r) => listener.listen(0, '127.0.0.1', r));
  closers.push(async () => void listener.close());
  const project = mkdtempSync(join(tmpdir(), 'lattice-checkout-'));
  const git = (...args: string[]) => new Promise<void>((done, fail) => spawn('git', ['-C', project, ...args], { stdio: 'ignore' }).on('close', (code) => (code === 0 ? done() : fail(new Error(`git ${args[0]} failed`)))).on('error', fail));
  await git('init', '--quiet');
  await git('remote', 'add', 'origin', 'https://someone:ghp_notforanyone@github.com/acme/site.git');
  await new Promise<void>((done) => {
    const child = spawn(process.execPath, [join(import.meta.dirname, '..', 'scripts', 'lattice-hook.mjs'), 'session-start'], { env: { ...process.env, LATTICE_URL: `http://127.0.0.1:${(listener.address() as AddressInfo).port}`, LATTICE_AGENT_TOKEN: '' }, stdio: ['pipe', 'ignore', 'ignore'] });
    child.on('close', () => done());
    child.stdin!.end(JSON.stringify({ session_id: 'desk-2', cwd: project }));
  });
  assert.deepEqual(heard.map((h) => h.remote), ['https://github.com/acme/site.git']);
});

test('where a request came from is what the trusted proxies say, not what the caller wrote ahead of them', async () => {
  const hosted = trustedProxies('cloudflare');
  const bare = trustedProxies();
  // Straight to the server: the connection is the caller, whatever the header says.
  assert.equal(clientAddress(undefined, '198.51.100.7', bare), '198.51.100.7');
  assert.equal(clientAddress('203.0.113.77', '198.51.100.7', bare), '198.51.100.7');
  // Through a platform's balancer on a private network, and Cloudflare before it: the address Cloudflare was reached from.
  assert.equal(clientAddress('198.51.100.7, 172.70.1.2', '::ffff:10.0.3.4', hosted), '198.51.100.7');
  assert.equal(clientAddress('198.51.100.7, 172.70.1.2, 10.9.9.9', '10.0.3.4', hosted), '198.51.100.7');
  assert.equal(clientAddress(['198.51.100.7', '2606:4700::1'], '10.0.3.4', hosted), '198.51.100.7');
  assert.equal(clientAddress('2001:db8::5, 172.70.1.2', '10.0.3.4', hosted), '2001:db8::5');
  // What the caller wrote himself stands before it, and is not believed: one made-up address or ten.
  assert.equal(clientAddress('203.0.113.77, 198.51.100.7, 172.70.1.2', '10.0.3.4', hosted), '198.51.100.7');
  assert.equal(clientAddress('10.1.1.1, 172.70.9.9, 198.51.100.7, 172.70.1.2', '10.0.3.4', hosted), '198.51.100.7');
  assert.equal(clientAddress('not an address, 198.51.100.7, 172.70.1.2', '10.0.3.4', hosted), '198.51.100.7');
  // A server that was not told about Cloudflare takes Cloudflare for the caller: wrong, but nothing a caller can choose.
  assert.equal(clientAddress('203.0.113.77, 198.51.100.7, 172.70.1.2', '10.0.3.4', bare), '172.70.1.2');
  // From inside, through nothing but trusted proxies, it is the first of them.
  assert.equal(clientAddress('10.1.1.1', '127.0.0.1', bare), '10.1.1.1');
  assert.equal(clientAddress(undefined, undefined, bare), '');
  // Other proxies are named as networks; what is not one is refused when the server starts.
  assert.equal(clientAddress('198.51.100.7, 192.0.2.9', '10.0.3.4', trustedProxies('192.0.2.0/24, 2001:db8:1::/48')), '198.51.100.7');
  assert.throws(() => trustedProxies('cloudfront'), /LATTICE_TRUSTED_PROXIES: "cloudfront" is not an address/);

  // On a server: a caller who claims a new address with every request is still one caller.
  const { base } = await serve('tokens', undefined, { open: { each: 3 } });
  const seen: number[] = [];
  for (let i = 0; i < 5; i++) seen.push((await fetch(base + '/connect/setup.mjs', { headers: { 'x-forwarded-for': `203.0.113.${i}, 198.51.100.7` } })).status);
  assert.deepEqual(seen, [200, 200, 200, 429, 429]);
  assert.equal((await fetch(base + '/connect/setup.mjs', { headers: { 'x-forwarded-for': '203.0.113.1, 198.51.100.8' } })).status, 200, 'and another caller is another');
});

test('refused tokens are counted by address, a backup unpacks only so far, and the UI comes with a policy for what it may load', async () => {
  const { base, call, workspaces } = await serve('tokens', undefined, { refused: { each: 3 } });
  const db = (await workspaces.get('default')).lattice.db;
  const good = (await createToken(db, 'default', { kind: 'agent', name: 'robot' })).token;
  const wrong = `lat_default_${'0'.repeat(40)}`;
  const from = (token: string | undefined, address: string) =>
    fetch(`${base}/agent/search`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': address, ...(token && { authorization: `Bearer ${token}` }) }, body: '{}' }).then((r) => r.status);
  // Three refusals from one address, and the fourth request is not looked at, whatever token it carries.
  assert.deepEqual([await from(wrong, '198.51.100.1'), await from(undefined, '198.51.100.1'), await from('nonsense', '198.51.100.1')], [401, 401, 401]);
  assert.deepEqual([await from(wrong, '198.51.100.1'), await from(good, '198.51.100.1')], [429, 429]);
  // Another address is not held up by it, and a good token is never counted.
  for (let i = 0; i < 5; i++) assert.equal(await from(good, '198.51.100.2'), 200);
  assert.equal((await call('/agent/search', good, {})).status, 200);

  // A file that unpacks to more than a backup is taken to be is refused before it is read.
  const { parseBackup } = await import('../src/backup.ts');
  assert.throws(() => parseBackup(gzipSync(Buffer.alloc(257_000_000, 0x20))), /unpacks to more than 256 MB/);
  assert.throws(() => parseBackup(Buffer.from('not a backup')), /not a Lattice backup file/);

  // The page may load its own script and stylesheet and talk to this server; the public page has its own, stricter still.
  const page = await fetch(base + '/');
  assert.match(page.headers.get('content-security-policy') ?? '', /default-src 'none'; script-src 'self'; style-src 'self';.*frame-ancestors 'none'/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await fetch(base + '/app.js')).headers.get('x-content-type-options'), 'nosniff');
});
