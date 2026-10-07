import assert from 'node:assert/strict';
import { cpSync, mkdtempSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createToken, workspaceOf } from '../src/auth.ts';
import { createHttpServer } from '../src/server.ts';
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
  assert.equal((await call('/api/init', undefined, { name: 'Alex' })).status, 200, '/api is the human');
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
  assert.deepEqual(set.result, { id: 'acme', default_visibility: 'private', accepts_from: ['default'] });
  assert.deepEqual((await send(mine, 'acme')).result, { delivered_to: 'acme' });

  const inbox = (await call('/api/view', theirs, { name: 'notifications' })).result as any[];
  assert.deepEqual([inbox[0].title, inbox[0].level, inbox[0].from], ['The shadow study is ready', 'warning', 'agent:workspace:default/alex']);
  assert.equal(((await call('/api/view', mine, { name: 'notifications' })).result as any[]).length, 0, 'nothing lands in the sender\'s own inbox');
  // Accepting is one-way: Acme cannot write back until the other side accepts it.
  assert.match((await send(theirs, 'default')).error, /does not accept notifications from "acme"/);
  const sent = (await call('/api/events', mine, { limit: 5 })).result as any[];
  assert.ok(sent.some((e) => e.action === 'workspace.notify' && e.detail.to === 'acme'), 'the sender\'s log records it');
});
