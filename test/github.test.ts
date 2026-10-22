import assert from 'node:assert/strict';
import { createHmac, createVerify, generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createToken } from '../src/auth.ts';
import { dump } from '../src/backup.ts';
import { GithubApp } from '../src/github-app.ts';
import { configureModels } from '../src/model-account.ts';
import { readUnread } from '../src/reader.ts';
import { serve, closers } from './serve.ts';

test('GitHub tells the map of a push: it is recorded against its repository, and what a commit says it finished is proposed closed', async () => {
  const { workspaces, call, base } = await serve('tokens');
  const db = (await workspaces.get('default')).pelago.db;
  const admin = (await createToken(db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const robot = (await createToken(db, 'default', { kind: 'agent', name: 'robot' })).token;
  const made = (
    await call('/api/change', admin, {
      reason: 'x',
      ops: [
        { op: 'create', ref: 'r', type: 'software.repo', title: 'Site repo', visibility: 'shared', props: { remote: 'https://github.com/Acme/Site.git' } },
        { op: 'create', ref: 't', type: 'work.task', title: 'Fix the footer', visibility: 'shared' },
        { op: 'create', ref: 'd', type: 'work.decision', title: 'Which font?', visibility: 'shared' },
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
  const header = (await call('/api/change', admin, { reason: 'x', ops: [{ op: 'create', ref: 'h', type: 'work.task', title: 'Fix the header', visibility: 'shared' }] })).result.created.h;
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
  let renamed = false;
  const hub = createServer((req, res) => {
    const say = (status: number, body: unknown) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    const bearer = (req.headers.authorization ?? '').replace('Bearer ', '');
    const isApp = () => {
      const [head, body, sig] = bearer.split('.');
      return Boolean(sig) && createVerify('RSA-SHA256').update(`${head}.${body}`).verify(publicKey, sig, 'base64url') && JSON.parse(Buffer.from(body, 'base64url').toString()).iss === '7';
    };
    asked.push(`${req.method} ${req.url}`);
    if (req.url === '/app') return isApp() ? say(200, renamed ? { slug: 'pelago-renamed', name: 'Archipelago (renamed)' } : { slug: 'pelago-test', name: 'Archipelago (test)' }) : say(401, { message: 'Bad credentials' });
    if (req.method === 'POST' && req.url === '/app-manifests/thecode/conversions') return say(201, { id: 7, slug: 'pelago-test', name: 'Archipelago (test)', pem, webhook_secret: 'whsec' });
    if (req.url === '/app/installations/42') return isApp() ? say(200, { account: { login: 'acme' } }) : say(401, { message: 'Bad credentials' });
    if (req.method === 'POST' && req.url === '/app/installations/42/access_tokens') return isApp() ? say(201, { token: 'ghs_forty-two', expires_at: new Date(Date.now() + 3600_000).toISOString() }) : say(401, { message: 'Bad credentials' });
    if (req.url?.startsWith('/repos/Acme/Tools/commits/')) return say(200, { sha: 'b'.repeat(40), commit: { message: 'Sharpen the tools. The whetstone still needs oiling.' }, files: [{ filename: 'tools/sharpen.ts', status: 'modified', additions: 4, deletions: 1, patch: '+  oil()' }] });
    if (req.url?.startsWith('/repos/Acme/Tools/compare/')) return bearer === 'ghs_forty-two' ? say(200, { commits: [{ sha: 'b'.repeat(40), commit: { message: 'Sharpen the tools\n\nThe whetstone still needs oiling.', author: { name: 'sam' } } }], files: [{ filename: 'tools/sharpen.ts', status: 'modified', additions: 4, deletions: 1 }] }) : say(401, { message: 'Bad credentials' });
    if (req.url === '/repos/Acme/Tools') return say(200, { default_branch: 'main' });
    if (req.url?.startsWith('/installation/repositories')) return bearer === 'ghs_forty-two' ? say(200, { repositories: [{ full_name: 'Acme/Site' }, { full_name: 'Acme/Tools' }] }) : say(401, { message: 'Bad credentials' });
    say(404, { message: 'Not Found' });
  });
  await new Promise<void>((r) => hub.listen(0, '127.0.0.1', r));
  closers.push(async () => void hub.close());
  const hubAt = `http://127.0.0.1:${(hub.address() as AddressInfo).port}`;

  let theApp: GithubApp | undefined;
  const { workspaces, call, base } = await serve('tokens', (origin) => (theApp ??= new GithubApp({ origin, api: hubAt, web: 'https://github.test' })));
  const db = (await workspaces.get('default')).pelago.db;
  const admin = (await createToken(db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const robot = (await createToken(db, 'default', { kind: 'agent', name: 'robot' })).token;
  await call('/api/change', admin, { reason: 'x', ops: [{ op: 'create', type: 'software.repo', title: 'Site repo', props: { remote: 'https://github.com/acme/site.git' } }] });
  const page = (path: string) => fetch(base + path, { redirect: 'manual' });

  // 1. The server has no app until its owner creates one. An agent cannot.
  assert.deepEqual((await call('/api/github_app', admin)).result, { available: true, app: null, can_create: true, installation: null, reader: { model: null, from: null } });
  assert.match((await call('/agent/github_app', robot, { create: true })).error, /humans only/);
  assert.match((await call('/api/github_app', admin, { connect: true })).error, /no GitHub App yet/);
  const create = (await call('/api/github_app', admin, { create: true })).result.url as string;
  const form = await (await page(create.slice(base.length))).text();
  const state = /settings\/apps\/new\?state=([0-9a-z.-]+)/.exec(form)![1];
  assert.ok(form.includes('action="https://github.test/settings/apps/new?state='), 'the page sends its reader to GitHub with the manifest');
  const manifest = JSON.parse(/name="manifest" value="([^"]+)"/.exec(form)![1].replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
  assert.deepEqual([manifest.hook_attributes.url, manifest.setup_url, manifest.default_permissions, manifest.default_events], [`${base}/github/app/hook`, `${base}/github/app/installed`, { contents: 'read', metadata: 'read' }, ['push']]);
  assert.equal((await page('/github/app/created?code=thecode&state=not-ours')).status, 400, 'a code is taken only from someone who started here');
  assert.equal((await page(`/github/app/created?code=thecode&state=${state}`)).status, 302);
  assert.equal((await page(`/github/app/created?code=thecode&state=${state}`)).status, 400, 'and once');
  assert.deepEqual((await call('/api/github_app', admin)).result.app, { slug: 'pelago-test', name: 'Archipelago (test)' });

  // 2. A workspace connects: its admin is sent to choose repositories, and comes back with the installation.
  const connect = (await call('/api/github_app', admin, { connect: true })).result.url as string;
  assert.match(connect, /^https:\/\/github\.test\/apps\/pelago-test\/installations\/new\?state=[0-9a-z.-]+$/);
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
  // 4. With a model account, the agent on this server reads the push: it looks at the commits through the app, asks the map,
  // and sends what the commits show. Here the model is a script, so what is tried is everything around it.
  assert.deepEqual((await call('/api/github_app', admin)).result.reader, { model: null, from: null });
  assert.equal(heard.reading, false, 'without a model account a push is recorded and not read');
  assert.match((await call('/agent/model_account', robot, { provider: 'anthropic', key: 'sk-ant-' + 'x'.repeat(30) })).error, /humans only/);
  // Something that is not this repository's: the reader is held to the repository it reads, whatever it is told there.
  const outside = (await call('/api/change', admin, { reason: 'x', ops: [{ op: 'create', type: 'work.task', title: 'Pay the invoice' }] })).result.created['#1'];
  const asks: any[] = [];
  // The push is read with five narrow tools, what changed and the open work handed over first (src/reader-push.ts).
  const script = [
    { stop_reason: 'tool_use', content: [{ type: 'text', text: 'Reading the push.' }, { type: 'tool_use', id: 'tu_1', name: 'diff', input: { sha: 'b'.repeat(40) } }, { type: 'tool_use', id: 'tu_2', name: 'find', input: { words: 'whetstone' } }, { type: 'tool_use', id: 'tu_3', name: 'no_such_tool', input: {} }] },
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_4', name: 'update', input: { id: outside, title: 'Steered by a file in the repository', why: 'The file said to' } }] },
    { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'tu_5', name: 'create', input: { type: 'work.task', title: 'Oil the whetstone', why: 'The commit says the whetstone still needs oiling' } }] },
    { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Made one task: Oil the whetstone.' }] },
  ];
  configureModels({ ask: (key) => async (params) => {
    asks.push({ key, ...params, messages: structuredClone(params.messages) }); // as they stood when asked: the run goes on adding to them
    return { id: `msg_${asks.length}`, type: 'message', role: 'assistant', model: params.model, usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0 }, ...script[asks.length - 1] } as any;
  }, fetch: (async (_url: string, init?: RequestInit) => new Response('{}', { status: String((init?.headers as Record<string, string>)['x-api-key']).includes('revoked') ? 401 : 200 })) as typeof fetch });
  // A key is tried when it is given: one Anthropic will not take is not saved, and a sign-in token is told from an API key.
  assert.match((await call('/api/model_account', admin, { provider: 'anthropic', key: 'sk-ant-api03-revoked-' + 'x'.repeat(20) })).error, /Anthropic refused that key, so it was not saved/);
  assert.match((await call('/api/model_account', admin, { provider: 'anthropic', key: 'sk-ant-oat01-' + 'x'.repeat(30) })).error, /sign-in token[\s\S]*needs an API key/);
  assert.equal((await call('/api/github_app', admin)).result.reader.from, null);
  // The Anthropic key set before there were model accounts is read as one.
  await (await workspaces.get('default')).pelago.setSecret('anthropic_key', 'sk-ant-' + 'x'.repeat(30));
  assert.deepEqual((await call('/api/github_app', admin)).result.reader, { model: 'claude-sonnet-5-5', from: 'workspace' });
  // The key is sealed where it is stored, so neither the database nor a backup of it holds it; nor does the log of its being set.
  const kept = (await db.query<{ value: string }>(`select value from setting where key = 'anthropic_key'`)).rows[0].value;
  assert.match(kept, /^sealed:v1:/);
  assert.ok(!JSON.stringify(await dump(db, { id: 'default', name: 'Default' })).includes('sk-ant-'));
  // One stored before secrets were sealed leaves in a backup sealed all the same, and is sealed where it lies once it is read.
  await db.query(`update setting set value = $1::jsonb where key = 'anthropic_key'`, [JSON.stringify('sk-ant-' + 'x'.repeat(30))]);
  assert.ok(!JSON.stringify(await dump(db, { id: 'default', name: 'Default' })).includes('sk-ant-'));
  assert.equal((await call('/api/github_app', admin)).result.reader.from, 'workspace');
  assert.match((await db.query<{ value: string }>(`select value from setting where key = 'anthropic_key'`)).rows[0].value, /^sealed:v1:/);
  // Connected as an account on the Workspace page, it replaces that key, sealed the same way; the page sees its last four characters.
  const connectedModel = (await call('/api/model_account', admin, { provider: 'anthropic', key: 'sk-ant-' + 'x'.repeat(30) })).result;
  assert.deepEqual(connectedModel.account, { provider: 'anthropic', name: 'Anthropic', model: 'claude-sonnet-5-5', url: null, price: { input: 2, output: 10 }, key: '…xxxx' }, 'Anthropic priced as it lists its model');
  // Its price can be set on its own, keeping the key: what each run is said to cost.
  assert.match((await call('/api/model_account', admin, { price_in: 1 })).error, /Give both prices/);
  assert.deepEqual((await call('/api/model_account', admin, { price_in: 3, price_out: 15 })).result.account.price, { input: 3, output: 15 });
  assert.match((await db.query<{ value: string }>(`select value from setting where key = 'model_account'`)).rows[0].value, /^sealed:v1:/);
  assert.equal((await db.query(`select 1 from setting where key = 'anthropic_key'`)).rows.length, 0);
  assert.ok(!JSON.stringify(await dump(db, { id: 'default', name: 'Default' })).includes('sk-ant-'));
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
  // It asked with the workspace's key, on the model chosen, with the push's narrow tools, starting from what the push changed.
  assert.deepEqual([asks[0].key, asks[0].model, asks[0].fallbacks], ['sk-ant-' + 'x'.repeat(30), 'claude-sonnet-5-5', 'default']);
  assert.deepEqual(asks[0].tools.map((t: any) => t.name), ['update', 'create', 'look', 'find', 'diff', 'file']);
  assert.ok(JSON.stringify(asks[0].tools).length < 3000, 'small enough to send every turn');
  assert.match(asks[0].messages[0].content, /Branch "main"[\s\S]*a{40}\.\.b{40}[\s\S]*whetstone still needs oiling[\s\S]*tools\/sharpen\.ts[\s\S]*Open items of this repository/);
  // What it asked for was done, all of a turn answered together, and a tool that is not there said so without ending the run.
  const answers = asks[1].messages.at(-1).content;
  assert.deepEqual(answers.map((a: any) => [a.tool_use_id, Boolean(a.is_error)]), [['tu_1', false], ['tu_2', false], ['tu_3', true]]);
  assert.match(answers[0].content, /whetstone still needs oiling|tools\/sharpen\.ts/);
  // What it sent is an agent's change like any other: here, where agents' changes are held, it waits for the owner.
  const held = (await call('/api/proposals', admin)).result;
  assert.deepEqual(held.map((p: any) => [p.actor, p.ops[0].title]), [['agent:reader', 'Oil the whetstone']]);
  // And it would wait wherever agents' changes are applied: a push started the run, not the owner. The run says so.
  const { rows: started } = await db.query<{ by: unknown }>(`select props->'started_by' as by from entity where title = 'Read the push to main (bbbbbbb)'`);
  assert.deepEqual(started.map((r) => r.by), [{ kind: 'webhook', name: 'a push to main' }]);
  // The same push said twice (a webhook left in the repository beside the app) is taken in once, and read once.
  assert.deepEqual((await deliver('push', { ...push(42), before: 'a'.repeat(40), after: 'b'.repeat(40) })).result.recorded, false);
  // A push recorded while its reading was cut off (the server stopped) has no run: the next server reads it, with any
  // pushed before it that were not read either, as one. What was read, even badly, is not read again.
  const whole = (await workspaces.get('default')).pelago;
  const app = (await call('/api/github_app', admin)).result;
  assert.equal(app.installation.id, '42');
  await whole.log(whole.db, { actor: 'github:sam', action: 'repo.push', target: heard.repo.id, origin: 'github', reason: '1 commit to main: Hone', detail: { repo: 'acme/tools', branch: 'main', before: 'b'.repeat(40), after: 'c'.repeat(40), commits: [{ sha: 'ccccccc' }] } });
  await whole.log(whole.db, { actor: 'github:sam', action: 'repo.push', target: heard.repo.id, origin: 'github', reason: '1 commit to main: Strop', detail: { repo: 'acme/tools', branch: 'main', before: 'c'.repeat(40), after: 'd'.repeat(40), commits: [{ sha: 'ddddddd' }] } });
  script.push({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Nothing needed changing.' }] });
  assert.deepEqual(await readUnread(whole, theApp!, '42'), [{ repo: 'Acme/Tools', branch: 'main', after: 'd'.repeat(40) }]);
  assert.match(asks.at(-1).messages[0].content, new RegExp(`${'b'.repeat(40)}\\.\\.${'d'.repeat(40)}`), 'from the last push that was read to the newest');
  assert.deepEqual(await readUnread(whole, theApp!, '42'), [], 'and once');

  // Renamed on GitHub by its owner, the app is asked its name, and a workspace is sent to where it now is.
  await theApp!.refresh();
  assert.equal((await theApp!.app())?.slug, 'pelago-test', 'asked, and as it was');
  renamed = true;
  await theApp!.refresh();
  assert.deepEqual(await theApp!.app(), { slug: 'pelago-renamed', name: 'Archipelago (renamed)' });
  assert.match(await theApp!.startConnect('default'), /^https:\/\/github\.test\/apps\/pelago-renamed\/installations\/new\?state=/);

  // Its admin can ask for a re-check of a repository now; only of one the app was given, and no agent can.
  assert.match((await call('/agent/github_app', robot, { recheck: heard.repo.id })).error, /humans only/);
  assert.match((await call('/api/github_app', admin, { recheck: 'e_notarepo' })).error, /not a repository the GitHub App was given/);
  assert.equal((await call('/api/github_app', admin, { recheck: heard.repo.id })).result.started, true);

  // The key is never given back, and removing the account stops the reading.
  assert.ok(!JSON.stringify((await call('/api/github_app', admin)).result).includes('sk-ant-'));
  assert.ok(!JSON.stringify((await call('/api/model_account', admin)).result).includes('sk-ant-'));
  assert.equal((await call('/api/model_account', admin, { remove: true })).result.account, null);
  assert.equal((await call('/api/github_app', admin)).result.reader.from, null);

  assert.deepEqual((await deliver('installation_repositories', { action: 'added', installation: { id: 42, account: { login: 'acme' } }, repositories_added: [{ full_name: 'Acme/Docs' }] })).result, { added: ['Acme/Docs'], known: [] });
  // Chosen again on GitHub later, they come back with no word: the installation is known, and the map is brought up to date.
  assert.equal((await page('/github/app/installed?installation_id=42&setup_action=update')).status, 302);
  // Removed on GitHub, it is forgotten here.
  assert.equal((await deliver('installation', { action: 'deleted', installation: { id: 42 } })).result.forgotten, 42);
  assert.equal((await call('/api/github_app', admin)).result.installation, null);
  assert.equal((await deliver('push', push(42))).result.recorded, false);
});

