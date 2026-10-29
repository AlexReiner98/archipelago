// The GitHub App's handler, tested without a database or a network: a stand-in context answers its acts, its
// requests to GitHub and its store, and records what it asked for.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import handler from './handler.js';

type Request = { host: string; method?: string; path: string; as?: string; anonymous?: boolean; keep?: Record<string, string> };

/** A context over a GitHub that answers `github`, connections by installation, and words begun. */
function ctxOver({ github = {} as Record<string, unknown>, connections = {} as Record<string, { workspace: string; account: string }>, begun = {} as Record<string, string>, store = {} as Record<string, unknown> } = {}) {
  const acts: [string, Record<string, any>][] = [];
  const requests: Request[] = [];
  const ctx = {
    origin: 'https://map.test',
    hosts: { api: 'https://api.github.test', web: 'https://github.test' },
    store: { get: async (k: string) => store[k] ?? null, put: async (k: string, v: unknown) => void (store[k] = v), take: async () => null },
    request: async (r: Request) => {
      requests.push(r);
      const key = `${r.method ?? 'GET'} ${r.path}`;
      if (!(key in github)) return { status: 404, body: { message: 'Not Found' } };
      const body = structuredClone(github[key]) as Record<string, unknown>;
      // The kernel keeps what it is told to and hands the rest on.
      const kept = Object.entries(r.keep ?? {}).filter(([field]) => body[field] !== undefined).map(([field, name]) => (delete body[field], name));
      return { status: 200, body, ...(r.keep && { kept }) };
    },
    act: async (name: string, input: Record<string, any>) => {
      acts.push([name, input]);
      if (name === 'begun.get' || name === 'begun.take') {
        if (!begun[input.state]) throw new Error('This was not started from Archipelago');
        const purpose = begun[input.state];
        if (name === 'begun.take') delete begun[input.state];
        return { purpose, workspace: 'acme' };
      }
      if (name === 'connection.get') return connections[input.id] ?? null;
      if (name === 'connection.make') {
        if (begun[input.state] !== 'connect') throw new Error('This was not started from Archipelago');
        return (connections[input.id] = { workspace: 'acme', account: input.account });
      }
      if (name === 'connection.drop') return { dropped: Boolean(delete connections[input.id]) };
      if (name === 'workspace.add') return { added: input.items.map((i: any) => i.title), known: [] };
      if (name === 'workspace.deliver') return { recorded: true, event: input.event };
      throw new Error(`no act ${name}`);
    },
  };
  return { ctx, acts, requests, store };
}

test('the server has its app once its owner made it: until then a workspace cannot connect, after it is sent to choose repositories', async () => {
  const none = ctxOver();
  assert.deepEqual((await handler.status({}, none.ctx)).answer, { ready: false, name: null });
  assert.deepEqual((await handler.start({ purpose: 'setup', state: 'default.s' }, none.ctx)).answer, { url: 'https://map.test/x/github_app/new?state=default.s' });
  await assert.rejects(handler.start({ purpose: 'connect', state: 'acme.s' }, none.ctx), /no GitHub App yet/);

  // An app given to the server by hand (its key in the environment) is known by asking GitHub, as the app.
  const byHand = ctxOver({ github: { 'GET /app': { slug: 'pelago-x', name: 'X' } } });
  assert.deepEqual((await handler.status({}, byHand.ctx)).answer, { ready: true, name: 'X' });
  assert.deepEqual(byHand.store.app, { slug: 'pelago-x', name: 'X' });
  assert.deepEqual((await handler.start({ purpose: 'connect', state: 'acme.s' }, byHand.ctx)).answer, { url: 'https://github.test/apps/pelago-x/installations/new?state=acme.s' });
  await assert.rejects(handler.start({ purpose: 'setup', state: 'default.s' }, byHand.ctx), /already has its GitHub App \(X\)/);
});

test('created once from its manifest: GitHub\'s key and secret go to the kernel, and the pack keeps only the app\'s name', async () => {
  const { ctx, requests, store } = ctxOver({ begun: { 'default.s': 'setup', 'acme.c': 'connect' }, github: { 'POST /app-manifests/abc/conversions': { id: 7, slug: 'pelago-x', name: 'X', pem: 'KEY', webhook_secret: 'whsec' } } });
  const { manifest, action } = (await handler.manifest({ state: 'default.s' }, ctx)).answer;
  assert.equal(action, 'https://github.test/settings/apps/new?state=default.s');
  assert.deepEqual([manifest.hook_attributes.url, manifest.redirect_url, manifest.setup_url, manifest.public], ['https://map.test/x/github_app/hook/events', 'https://map.test/x/github_app/created', 'https://map.test/x/github_app/installed', false]);
  await assert.rejects(handler.manifest({ state: 'acme.c' }, ctx), /not started from Archipelago/, 'a word begun to connect does not create');
  assert.deepEqual((await handler.created({ code: 'abc', state: 'default.s' }, ctx)).answer, { redirect: '/#/workspace' });
  assert.deepEqual(requests.at(-1), { host: 'api', method: 'POST', path: '/app-manifests/abc/conversions', anonymous: true, keep: { pem: 'key', webhook_secret: 'hook', id: 'app_id' } });
  assert.deepEqual(store.app, { slug: 'pelago-x', name: 'X' });
  await assert.rejects(handler.created({ code: 'abc', state: 'default.s' }, ctx), /not started/, 'once');

  // GitHub answering without the key is not an app.
  const short = ctxOver({ begun: { 'default.s': 'setup' }, github: { 'POST /app-manifests/abc/conversions': { id: 7, slug: 'pelago-x' } } });
  await assert.rejects(handler.created({ code: 'abc', state: 'default.s' }, short.ctx), /did not hand over the app/);
});

test('installed: the installation is asked of GitHub as the app, tied to the workspace, and its repositories put in that map', async () => {
  const github = {
    'GET /app/installations/42': { account: { login: 'acme' } },
    'GET /installation/repositories?per_page=100&page=1': { repositories: [{ full_name: 'Acme/Site' }, { full_name: 'Acme/Tools' }] },
  };
  const { ctx, acts, requests } = ctxOver({ github, begun: { 'acme.c': 'connect' } });
  await assert.rejects(handler.installed({ state: 'acme.c' }, ctx), /no installation back/);
  assert.deepEqual((await handler.installed({ installation_id: '42', state: 'acme.c' }, ctx)).answer, { redirect: '/#/workspace' });
  assert.deepEqual(acts.find(([n]) => n === 'connection.make')![1], { state: 'acme.c', id: '42', account: 'acme' });
  assert.deepEqual(requests.find((r) => r.path.startsWith('/installation/'))!.as, '42', 'the repositories are read as the installation');
  const added = acts.find(([n]) => n === 'workspace.add')![1];
  assert.deepEqual([added.connection, added.type, added.unique, added.items, added.reason], ['42', 'repo', 'remote', [{ title: 'Site repo', props: { remote: 'https://github.com/Acme/Site' } }, { title: 'Tools repo', props: { remote: 'https://github.com/Acme/Tools' } }], 'Connected through the GitHub App on acme']);

  // Chosen again later on GitHub, it comes back with no word: known already, it is not made again, and nothing is
  // read for an address anyone can open (the repositories added arrive signed).
  const later = ctxOver({ github, connections: { '42': { workspace: 'acme', account: 'acme' } } });
  assert.deepEqual((await handler.installed({ installation_id: '42', setup_action: 'update' }, later.ctx)).answer, { redirect: '/#/workspace' });
  assert.deepEqual(later.acts.map(([n]) => n), ['connection.get']);
  assert.equal(later.requests.length, 0);
  // Unknown and with no word, it is refused.
  await assert.rejects(handler.installed({ installation_id: '43' }, ctxOver({ github }).ctx), /not started from Archipelago/);
});

test('what GitHub delivers: a push handed to the connected workspace, repositories added, an installation removed', async () => {
  const { ctx, acts } = ctxOver({ connections: { '42': { workspace: 'acme', account: 'acme' } } });
  const deliver = (event: string, payload: Record<string, unknown>, delivery?: string) => handler.events({ payload, headers: { 'x-github-event': event, ...(delivery && { 'x-github-delivery': delivery }) } }, ctx).then((d: any) => d.answer);
  assert.deepEqual(await deliver('ping', {}), { recorded: false, reason: 'pong' });
  assert.match((await deliver('push', { installation: { id: 99 } })).reason, /No workspace here has connected/);
  assert.match((await deliver('issues', { installation: { id: 42 } })).reason, /Only pushes/);
  const push = { ref: 'refs/heads/main', installation: { id: 42 }, repository: { full_name: 'Acme/Site' } };
  assert.deepEqual(await deliver('push', push, 'd-1'), { recorded: true, event: 'repo.push' });
  assert.deepEqual(acts.at(-1), ['workspace.deliver', { connection: '42', event: 'repo.push', payload: push, headers: { 'x-github-event': 'push', 'x-github-delivery': 'd-1' } }]);
  assert.deepEqual(await deliver('installation_repositories', { installation: { id: 42, account: { login: 'acme' } }, repositories_added: [{ full_name: 'Acme/Docs' }] }), { added: ['Docs repo'], known: [] });
  assert.deepEqual(await deliver('installation', { action: 'deleted', installation: { id: 42 } }), { recorded: true, forgotten: 42 });
  assert.match((await deliver('push', push)).reason, /No workspace here has connected/, 'forgotten');
});

test('renamed on GitHub, the app is known by its new name', async () => {
  const github: Record<string, unknown> = { 'GET /app': { slug: 'pelago-x', name: 'X' } };
  const { ctx, store } = ctxOver({ github, store: { app: { slug: 'pelago-x', name: 'X' } } });
  assert.deepEqual((await handler.refresh({}, ctx)).answer, { changed: false });
  github['GET /app'] = { slug: 'pelago-y', name: 'Y' };
  assert.deepEqual((await handler.refresh({}, ctx)).answer, { changed: true, slug: 'pelago-y', name: 'Y' });
  assert.deepEqual(store.app, { slug: 'pelago-y', name: 'Y' });
  // With no app (no key), there is nothing to ask.
  assert.deepEqual((await handler.refresh({}, ctxOver().ctx)).answer, { changed: false });
});

test('the check on main: posted as the installation, kept while red, asked again each minute until green, and on Re-run', async () => {
  const github: Record<string, unknown> = { 'POST /repos/Acme/Site/check-runs': { id: 501 }, 'PATCH /repos/Acme/Site/check-runs/501': { id: 501 } };
  const { ctx, acts, requests, store } = ctxOver({ github, connections: { '42': { workspace: 'acme', account: 'acme' } } });
  const head = 'f'.repeat(40);
  const commits = [{ id: '1'.repeat(40), message: 'One' }];
  const red = { name: 'Every commit accounted for', head_sha: head, conclusion: 'failure', title: '1 of 1 commit not accounted for', summary: 'Not accounted for yet: ...', commits };
  // What the workspace's GitHub pack answers, push by push and question by question.
  let answer: Record<string, unknown> = { recorded: true, check: red };
  ctx.act = (async (name: string, input: Record<string, any>) => {
    acts.push([name, input]);
    if (name === 'connection.get') return { workspace: 'acme', account: 'acme' };
    if (name === 'workspace.deliver') return answer;
    throw new Error(`no act ${name}`);
  }) as typeof ctx.act;
  const push = { ref: 'refs/heads/main', installation: { id: 42 }, repository: { full_name: 'Acme/Site' } };

  const done = (await handler.events({ payload: push, headers: { 'x-github-event': 'push' } }, ctx)).answer;
  assert.deepEqual(done.check, { conclusion: 'failure', title: '1 of 1 commit not accounted for', posted: true, id: 501 });
  const posted = requests.find((r) => r.method === 'POST')! as any;
  assert.deepEqual([posted.path, posted.as, posted.body.name, posted.body.head_sha, posted.body.status, posted.body.conclusion], ['/repos/Acme/Site/check-runs', '42', 'Every commit accounted for', head, 'completed', 'failure']);
  assert.equal((store.checks as any[]).length, 1, 'kept while red');

  // Still red: asked as a question (nothing written there), and GitHub is not told again.
  answer = { recorded: false, check: red };
  assert.deepEqual((await handler.recheck({}, ctx)).answer, { asked: 1, green: [] });
  assert.deepEqual(acts.at(-1), ['workspace.deliver', { connection: '42', event: 'repo.push', ask: true, payload: { repository: { full_name: 'Acme/Site' }, head_sha: head, commits }, headers: { 'x-github-event': 'accounting' } }]);
  assert.equal(requests.filter((r) => r.method === 'PATCH').length, 0);

  // Accounted for on the map: the check is changed on GitHub, and let go.
  answer = { recorded: false, check: { ...red, conclusion: 'success', title: 'All one commit accounted for' } };
  assert.deepEqual((await handler.recheck({}, ctx)).answer, { asked: 1, green: ['Acme/Site@fffffff'] });
  const patched = requests.find((r) => r.method === 'PATCH')! as any;
  assert.deepEqual([patched.path, patched.as, patched.body.conclusion, patched.body.output.title], ['/repos/Acme/Site/check-runs/501', '42', 'success', 'All one commit accounted for']);
  assert.deepEqual(store.checks, []);

  // A pull request into main is handed over as what it is; Re-run of a check kept asks again at once.
  answer = { recorded: false, check: red };
  const pr = { action: 'opened', installation: { id: 42 }, repository: { full_name: 'Acme/Site' }, pull_request: { number: 3 } };
  await handler.events({ payload: pr, headers: { 'x-github-event': 'pull_request' } }, ctx);
  assert.equal((acts.at(-1)![1] as any).headers['x-github-event'], 'pull_request');
  answer = { recorded: false, check: { ...red, conclusion: 'success', title: 'All one commit accounted for' } };
  const rerun = (await handler.events({ payload: { action: 'rerequested', installation: { id: 42 }, repository: { full_name: 'Acme/Site' }, check_run: { id: 501, name: 'Every commit accounted for', head_sha: head } }, headers: { 'x-github-event': 'check_run' } }, ctx)).answer;
  assert.deepEqual(rerun.check, { conclusion: 'success', title: 'All one commit accounted for' });
  assert.deepEqual(store.checks, []);

  // Without the permission to write checks, GitHub refuses and the answer says why; nothing is kept.
  delete github['POST /repos/Acme/Site/check-runs'];
  answer = { recorded: true, check: red };
  const refused = (await handler.events({ payload: push, headers: { 'x-github-event': 'push' } }, ctx)).answer;
  assert.match(refused.check.reason, /lack the permission to write checks/);
  assert.deepEqual(store.checks, []);
});

test('the app asks GitHub for what the check needs: to write checks and read pull requests', async () => {
  const { ctx } = ctxOver({ begun: { 'default.s': 'setup' } });
  const { manifest } = (await handler.manifest({ state: 'default.s' }, ctx)).answer;
  assert.deepEqual(manifest.default_permissions, { contents: 'read', metadata: 'read', checks: 'write', pull_requests: 'read' });
  assert.deepEqual(manifest.default_events, ['push', 'pull_request', 'check_run']);
});
