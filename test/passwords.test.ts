import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createToken } from '../src/auth.ts';
import { PASSWORD_TRIES } from '../src/passwords.ts';
import { serve } from './serve.ts';

test('a member sets a password and signs in with it; it is changed, taken away, and never kept as given', async () => {
  const { workspaces, call, member } = await serve('tokens');
  const db = (await workspaces.get('default')).pelago.db;
  const alex = (await createToken(db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const sam = await member(alex, { email: 'sam@example.com', name: 'Sam' });

  assert.deepEqual(await call('/connect/password/set', sam, {}), { status: 200, email: 'sam@example.com', set: null }, 'none until one is set');
  assert.equal((await call('/connect/password/set', sam, { password: 'short' })).status, 400);
  const set = await call('/connect/password/set', sam, { password: 'correct horse battery' });
  assert.ok(set.set, 'when it was set');
  const kept = JSON.stringify((await (await workspaces.control()).query(`select value from control_value where key like 'password:%'`)).rows);
  assert.ok(!kept.includes('correct horse'), 'only a hash is kept');

  const signed = await call('/connect/password', undefined, { email: 'Sam@Example.com', password: 'correct horse battery' });
  assert.equal(signed.status, 200);
  const who = await call('/whoami', signed.token, undefined, 'GET');
  assert.deepEqual([who.workspace.id, who.actor.kind, who.actor.name], ['default', 'human', 'sam@example.com']);

  assert.equal((await call('/connect/password', undefined, { email: 'sam@example.com', password: 'wrong horse battery' })).status, 401);
  assert.equal((await call('/connect/password', undefined, { email: 'nobody@example.com', password: 'correct horse battery' })).status, 401, 'the same answer for an address with none');

  await call('/connect/password/set', sam, { password: 'a different password' });
  assert.equal((await call('/connect/password', undefined, { email: 'sam@example.com', password: 'correct horse battery' })).status, 401, 'the old one stops working');
  assert.equal((await call('/connect/password', undefined, { email: 'sam@example.com', password: 'a different password' })).status, 200);
  await call('/connect/password/set', sam, { password: null });
  assert.equal((await call('/connect/password', undefined, { email: 'sam@example.com', password: 'a different password' })).status, 401, 'taken away, email alone again');
});

test('an agent cannot keep a password, nor a removed member sign in with one, and wrong ones run out', async () => {
  const { workspaces, call, member } = await serve('tokens');
  const db = (await workspaces.get('default')).pelago.db;
  const alex = (await createToken(db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const kim = await member(alex, { email: 'kim@example.com', name: 'Kim' });
  const robot = (await call('/api/token_create', kim, { kind: 'agent', name: 'kim’s robot' })).result.token as string;
  assert.equal((await call('/connect/password/set', robot, { password: 'an agent’s password' })).status, 403);
  assert.equal((await call('/connect/password/set', undefined, { password: 'nobody signed in here' })).status, 401);

  await call('/connect/password/set', kim, { password: 'kim’s long password' });
  for (let i = 1; i < PASSWORD_TRIES; i++) assert.equal((await call('/connect/password', undefined, { email: 'kim@example.com', password: `guess ${i} is wrong` })).status, 401);
  assert.equal((await call('/connect/password', undefined, { email: 'kim@example.com', password: 'the last wrong guess' })).status, 429);
  assert.equal((await call('/connect/password', undefined, { email: 'kim@example.com', password: 'kim’s long password' })).status, 429, 'past the tries, even the right one waits');

  const { workspaces: w2, call: c2, member: m2 } = await serve('tokens');
  const a2 = (await createToken((await w2.get('default')).pelago.db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const ann = await m2(a2, { email: 'ann@example.com', name: 'Ann' });
  await c2('/connect/password/set', ann, { password: 'ann’s long password' });
  await c2('/api/member_set', a2, { email: 'ann@example.com', remove: true });
  assert.equal((await c2('/connect/password', undefined, { email: 'ann@example.com', password: 'ann’s long password' })).status, 403, 'a removed member has no workspace to enter');
});

test('a member of several workspaces sets one password for their address, and picks a workspace with it', async () => {
  const { workspaces, call } = await serve('tokens');
  const operator = (await workspaces.ensureOperator())!;
  const acme = (await call('/operator/workspaces', operator, { id: 'acme', name: 'Acme', email: 'owner@acme.test' })).result.owner_token as string;
  const main = (await createToken((await workspaces.get('default')).pelago.db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  await call('/api/member_add', main, { email: 'lee@example.com', name: 'Lee' });
  await call('/api/member_add', acme, { email: 'lee@example.com', name: 'Lee' });
  assert.equal((await call('/connect/password/set', acme, { password: 'the owner of acme' })).status, 200, 'a workspace’s owner keeps one too');
  assert.ok((await call('/connect/password', undefined, { email: 'owner@acme.test', password: 'the owner of acme' })).token);

  // Lee, signed in to Acme, sets it there; it opens either workspace.
  const acmeDb = (await workspaces.get('acme')).pelago.db;
  const person = (await acmeDb.query<{ person_id: string }>(`select person_id from member where email = 'lee@example.com'`)).rows[0].person_id;
  const leeToken = (await createToken(acmeDb, 'acme', { kind: 'human', name: 'lee@example.com', entity: person })).token;
  assert.equal((await call('/connect/password/set', leeToken, { password: 'lee’s long password' })).status, 200);
  const asked = await call('/connect/password', undefined, { email: 'lee@example.com', password: 'lee’s long password' });
  assert.deepEqual(asked.workspaces.map((w: { id: string }) => w.id).sort(), ['acme', 'default']);
  const into = await call('/connect/password', undefined, { email: 'lee@example.com', password: 'lee’s long password', workspace: 'acme' });
  assert.equal((await call('/whoami', into.token, undefined, 'GET')).workspace.id, 'acme');
});
