import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createToken } from '../src/auth.ts';
import type { Actor } from '../src/pelago.ts';
import { readLink, trade } from '../src/share-link.ts';
import { callTool } from '../src/tools.ts';
import { fresh } from './map.ts';
import { serve } from './serve.ts';

const secretOf = (path: string) => path.split('/').at(-1)!;
const owner: Actor = { kind: 'human', name: 'owner' };
type Flat = { items: { id: string; title: string; type: string }[]; links: unknown[] };

test('a link keeps its view frozen: its reader token reads exactly that, and nothing else', async () => {
  const l = await fresh();
  const made = ((await l.change(owner, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'open', type: 'question', title: 'SR&ED', body: 'Claimed after the work.', visibility: 'shared' },
      { op: 'create', ref: 'hidden', type: 'question', title: 'IRAP', body: 'Call the advisor first.', visibility: 'private' },
      { op: 'create', ref: 'lens', type: 'lens', title: 'Notes', visibility: 'shared', props: { filter: { find: ['type question'], not: [] }, walk: { over: [], steps: 0 }, style: { shape: 'list' } } },
    ],
  })) as { created: Record<string, string> }).created;
  const link = (await callTool(l, owner, 'share_create', { id: made.lens })) as { path: string; share: string };
  const secret = secretOf(link.path);

  // The secret is traded once for a short token; nothing else is a key.
  const got = (await trade(l, secret))!;
  assert.match(got.token, /^link_default_[0-9a-f]{40}$/);
  assert.ok(got.expires_in > 0 && got.expires_in <= 3600, 'short-lived');
  assert.equal(await trade(l, 'f'.repeat(48)), null, 'a secret no link has opens nothing');
  await assert.rejects(readLink(l, secret, 'view', { name: 'flat' }), /revoked|run out/, 'the secret itself reads nothing');

  // Changed after sharing: a new question, a renamed one. The link shows neither.
  await l.change(owner, { reason: 'test', ops: [{ op: 'create', ref: 'later', type: 'question', title: 'SBIR', body: 'Later.', visibility: 'shared' }, { op: 'update', id: made.open, title: 'SR&ED claim', body: 'Rewritten.' }] });
  const flat = (await readLink(l, got.token, 'view', { name: 'flat', params: { filter: { find: ['type question'] } } })) as Flat;
  assert.deepEqual(flat.items.filter((i) => i.type === 'question').map((i) => i.title), ['SR&ED'], 'as it was when shared, the private one left out');
  // However widely it is asked, the answer is the one frozen.
  const wider = (await readLink(l, got.token, 'view', { name: 'flat', params: { filter: { find: ['type person', 'type task'] }, limit: 2000 } })) as Flat;
  assert.deepEqual(wider.items.map((i) => i.id), flat.items.map((i) => i.id));
  const page = (await readLink(l, got.token, 'get', { id: made.open })) as { entity: { title: string; body: string } };
  assert.deepEqual([page.entity.title, page.entity.body], ['SR&ED', 'Claimed after the work.']);
  const lens = (await readLink(l, got.token, 'get', { id: made.lens })) as { entity: { props: { filter: unknown } } };
  assert.ok(lens.entity.props.filter, 'the view itself, with its query, for the canvas to read');
  assert.ok(((await readLink(l, got.token, 'view', { name: 'style' })) as { style: object }).style, 'the look it is drawn in');
  assert.ok(((await readLink(l, got.token, 'schema', {})) as { types: unknown[] }).types.length, 'the types, which hold nothing of the map');
  for (const id of [made.hidden, made.later]) await assert.rejects(readLink(l, got.token, 'get', { id }), /does not show that item/);
  const kept = (await l.db.query<{ snapshot: unknown }>(`select snapshot from share where id = $1`, [link.share])).rows[0].snapshot;
  assert.doesNotMatch(JSON.stringify(kept), /IRAP|advisor/, 'nothing private is kept at all');

  // It writes nothing and reads nothing else.
  for (const [name, input] of [['change', { reason: 'x', ops: [{ op: 'update', id: made.open, title: 'x' }] }], ['search', {}], ['events', {}], ['share_create', { id: made.lens }], ['proposals', {}]] as const)
    await assert.rejects(readLink(l, got.token, name, input), /only reads what it shows/, name);
  for (const name of ['brief', 'attention', 'saved_views', 'sessions']) await assert.rejects(readLink(l, got.token, 'view', { name }), /only reads what it shows/, name);
  assert.equal((await l.entity(made.open))!.title, 'SR&ED claim');

  // It runs out.
  const second = (await trade(l, secret))!;
  await l.db.query(`update transient set until = now() - interval '1 second' where key like 'linkreader:%'`);
  await assert.rejects(readLink(l, second.token, 'view', { name: 'flat' }), /run out/);

  // And dies with the link: no new token, and none out still reads.
  const third = (await trade(l, secret))!;
  assert.ok(await readLink(l, third.token, 'view', { name: 'flat' }));
  await callTool(l, owner, 'share_revoke', { id: link.share });
  await assert.rejects(readLink(l, third.token, 'view', { name: 'flat' }), /revoked/);
  assert.equal(await trade(l, secret), null);
});

test('over HTTP a link is traded at its address, and its token is good only for the reads it shows', async () => {
  const { call, base, workspaces } = await serve('tokens');
  const db = (await workspaces.get('default')).pelago.db;
  const human = (await createToken(db, 'default', { kind: 'human', name: 'owner', admin: true })).token;
  const made = await call('/api/change', human, { reason: 'test', ops: [{ op: 'create', ref: 'q', type: 'question', title: 'SR&ED', visibility: 'shared' }, { op: 'create', ref: 'lens', type: 'lens', title: 'Notes', visibility: 'shared', props: { filter: { find: ['type question'], not: [] }, walk: { over: [], steps: 0 } } }] });
  const lens = made.result.created.lens as string;
  const link = (await call('/api/share_create', human, { id: lens })).result as { path: string; share: string };
  // Today's page goes on answering at the link's address.
  assert.equal((await fetch(`${base}${link.path}/data`)).status, 200);
  // The link's own address is the app, which trades the secret for a token itself; a secret no link has, the old page.
  const page = await fetch(`${base}${link.path}`);
  assert.match(await page.text(), /src="\/app\.js/);
  assert.doesNotMatch(await (await fetch(`${base}/s/default/${'a'.repeat(48)}`)).text(), /src="\/app\.js/);
  // What it would leave out as private is asked before a link is made, since what it shows is frozen then.
  assert.deepEqual((await call('/api/share_private', human, { id: lens })).result, []);

  const traded = await call(`${link.path}/token`);
  assert.equal(traded.status, 200);
  assert.equal(traded.of, lens, 'the view it opens on');
  const reader = traded.token as string;
  assert.equal((await call('/s/default/' + 'a'.repeat(48) + '/token')).status, 404);

  const flat = await call('/api/view', reader, { name: 'flat', params: {} });
  assert.equal(flat.status, 200);
  assert.ok((flat.result as Flat).items.some((i) => i.title === 'SR&ED'));
  assert.equal((await call('/api/get', reader, { id: lens })).status, 200);
  assert.equal((await call('/api/change', reader, { reason: 'x', ops: [{ op: 'create', type: 'question', title: 'x' }] })).status, 403);
  assert.equal((await call('/api/view', reader, { name: 'brief', params: {} })).status, 403);
  // Anywhere else it is a token nobody made.
  for (const path of ['/agent/query', '/agent/change', '/mcp', '/whoami']) assert.equal((await call(path, reader, {}, path === '/whoami' ? 'GET' : 'POST')).status, 401, path);

  await call('/api/share_revoke', human, { id: link.share });
  assert.equal((await call('/api/view', reader, { name: 'flat', params: {} })).status, 401);
  assert.equal((await call(`${link.path}/token`)).status, 404);
});
