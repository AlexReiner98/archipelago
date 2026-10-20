import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createToken } from '../src/auth.ts';
import { codeSentTo, mailbox, serve } from './serve.ts';

test('an admin adds a member by email; the invitation signs them in once, for a month, as an admin or not', async () => {
  const { workspaces, call } = await serve('tokens');
  const db = (await workspaces.get('default')).pelago.db;
  const alex = (await createToken(db, 'default', { kind: 'human', name: 'alex', admin: true })).token;

  const added = await call('/api/member_add', alex, { email: '  Rosa@Acme.example ', name: 'Rosa', admin: true });
  assert.deepEqual([added.result.email, added.result.invited], ['rosa@acme.example', true], 'the address is kept as one, in lower case');
  const invitation = mailbox.findLast((m) => m.to === 'rosa@acme.example')!;
  assert.match(invitation.subject, /^alex invited you to Default on Archipelago$/);
  assert.match(invitation.text, /alex has invited you to Default on Archipelago/);
  assert.equal(invitation.replyTo, undefined, 'a reply goes to the inviter only when they have an address');
  assert.match((await call('/api/member_add', alex, { email: 'rosa@acme.example' })).error, /a member already/);
  assert.match((await call('/api/member_add', alex, { email: 'not an address' })).error, /not an email address/);

  const code = codeSentTo('rosa@acme.example');
  const joined = await call('/connect/join', undefined, { code });
  assert.equal(joined.status, 200);
  const who = await call('/whoami', joined.token, undefined, 'GET');
  assert.deepEqual([who.actor.kind, who.actor.name, who.actor.admin, who.actor.person], ['human', 'rosa@acme.example', true, added.result.person]);
  assert.equal((await call('/connect/join', undefined, { code })).status, 410, 'a link works once');
  assert.equal((await call('/connect/join', undefined, { code: 'inv_default_' + '0'.repeat(40) })).status, 410);
  const token = ((await call('/api/token_list', alex)).result as any[]).find((t) => t.name === 'rosa@acme.example');
  const days = (Date.parse(token.expires_at) - Date.now()) / 86_400_000;
  assert.ok(days > 29.9 && days <= 30, 'a sign-in lasts a month');

  // The person is the one with that address when there is one, a new one when not.
  const listed = (await call('/api/member_list', alex)).result as any[];
  assert.deepEqual(listed.map((m) => [m.email, m.name, m.admin]), [['rosa@acme.example', 'Rosa', true]]);
  assert.ok(listed[0].last_used, 'when they last used a sign-in');
});

test('anyone may ask for a sign-in link at an address, and is told nothing of who is a member where', async () => {
  const { workspaces, call } = await serve('tokens');
  const operator = (await workspaces.ensureOperator())!;
  const acme = (await call('/operator/workspaces', operator, { id: 'acme', name: 'Acme' })).result.owner_token as string;
  const main = (await createToken((await workspaces.get('default')).pelago.db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  await call('/api/member_add', main, { email: 'alex@example.com', name: 'Alex', admin: true });
  await call('/api/member_add', acme, { email: 'alex@example.com', name: 'Alex' });
  const before = mailbox.length;

  const nobody = await call('/connect/sign-in', undefined, { email: 'nobody@example.com' });
  const alex = await call('/connect/sign-in', undefined, { email: 'Alex@Example.com' });
  assert.deepEqual([nobody.status, alex.status], [200, 200], 'the same answer for a member and for nobody');
  assert.equal((await call('/connect/sign-in', undefined, { email: 'nope' })).status, 400);
  await new Promise((r) => setTimeout(r, 200));
  const sent = mailbox.slice(before);
  assert.deepEqual(sent.map((m) => m.to), ['alex@example.com'], 'only a member is sent mail');
  assert.equal((sent[0].text.match(/#\/join\//g) ?? []).length, 2, 'one mail, with a link for each workspace');
  assert.match(sent[0].text, /Default:\n.*\n\nAcme:\n/s);

  // Asking again within the minute sends nothing more.
  await call('/connect/sign-in', undefined, { email: 'alex@example.com' });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(mailbox.length, before + 1);

  const codes = [...sent[0].text.matchAll(/#\/join\/(\S+)/g)].map((m) => m[1]);
  const into = await Promise.all(codes.map(async (code) => (await call('/whoami', (await call('/connect/join', undefined, { code })).token, undefined, 'GET')).workspace.id));
  assert.deepEqual(into, ['default', 'acme']);
});

test('an admin changes a member’s standing or removes them, and their sign-ins follow at once', async () => {
  const { workspaces, call, member } = await serve('tokens');
  const db = (await workspaces.get('default')).pelago.db;
  const alex = (await createToken(db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const sam = await member(alex, { email: 'sam@example.com', name: 'Sam' });
  assert.match((await call('/api/member_add', sam, { email: 'eve@example.com' })).error, /Only a workspace admin/);
  assert.match((await call('/api/member_list', sam)).error, /Only a workspace admin/);

  assert.equal((await call('/api/member_set', alex, { email: 'sam@example.com', admin: true })).result.admin, true);
  assert.equal((await call('/whoami', sam, undefined, 'GET')).actor.admin, true, 'the sign-in they have is an admin’s now');
  assert.match((await call('/api/member_set', sam, { email: 'sam@example.com', remove: true })).error, /cannot remove yourself/);

  await call('/api/member_set', alex, { email: 'sam@example.com', remove: true });
  assert.equal((await call('/whoami', sam, undefined, 'GET')).status, 401, 'removed, they are signed out');
  const before = mailbox.length;
  await call('/connect/sign-in', undefined, { email: 'sam@example.com' });
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(mailbox.length, before, 'and are sent no link');
  assert.deepEqual((await call('/api/member_list', alex)).result, []);
});
