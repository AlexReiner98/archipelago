import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createToken } from '../src/auth.ts';
import { dump } from '../src/backup.ts';
import { workspacesOf } from '../src/control-index.ts';
import { CODE_TRIES, linkFor } from '../src/members.ts';
import { dumpVault } from '../src/vault.ts';
import { codeSentTo, mailbox, serve } from './serve.ts';
import { until } from './wait.ts';

// A sign-in mail goes out after the answer (which is the same for a member and for nobody), so a test waits for it.
// Where no mail is owed none is ever started: the server knows that before it answers (an address in no workspace,
// one asked for within the minute, one removed), so there is nothing to wait for.
const mailed = async (to: string, since: number) => assert.ok(await until(() => mailbox.slice(since).some((m) => m.to === to), 10_000), `a mail to ${to}`);

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

  assert.doesNotMatch(invitation.text, /#\/join\/|https?:\/\//, 'no link: they sign in with their address and a code');
  assert.match(invitation.text, /sign in with this email address \(rosa@acme\.example\)/);

  const before = mailbox.length;
  await call('/connect/sign-in', undefined, { email: 'rosa@acme.example' });
  await mailed('rosa@acme.example', before);
  const signInMail = mailbox.slice(before).find((m) => m.to === 'rosa@acme.example')!;
  assert.doesNotMatch(signInMail.text, /#\/join\/|https?:\/\//, 'the sign-in mail carries a code, never a link');
  const joined = await call('/connect/code', undefined, { email: 'rosa@acme.example', code: codeSentTo('rosa@acme.example') });
  assert.equal(joined.status, 200);
  const who = await call('/whoami', joined.token, undefined, 'GET');
  assert.deepEqual([who.actor.kind, who.actor.name, who.actor.admin, who.actor.person], ['human', 'rosa@acme.example', true, added.result.person]);
  // A link is still made, but only handed over in the browser (a buyer's welcome page), never mailed.
  const code = (await linkFor(db, 'default', 'rosa@acme.example', 60_000)).split('/join/')[1];
  assert.equal((await call('/connect/join', undefined, { code })).status, 200);
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

test('anyone may ask for a sign-in code at an address, and is told nothing of who is a member where', async () => {
  const { workspaces, call } = await serve('tokens');
  const operator = (await workspaces.ensureOperator())!;
  const acme = (await call('/operator/workspaces', operator, { id: 'acme', name: 'Acme', email: 'owner@acme.test' })).result.owner_token as string;
  const main = (await createToken((await workspaces.get('default')).pelago.db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  await call('/api/member_add', main, { email: 'alex@example.com', name: 'Alex', admin: true });
  await call('/api/member_add', acme, { email: 'alex@example.com', name: 'Alex' });
  const before = mailbox.length;

  const nobody = await call('/connect/sign-in', undefined, { email: 'nobody@example.com' });
  const alex = await call('/connect/sign-in', undefined, { email: 'Alex@Example.com' });
  assert.deepEqual([nobody.status, alex.status], [200, 200], 'the same answer for a member and for nobody');
  assert.equal((await call('/connect/sign-in', undefined, { email: 'nope' })).status, 400);
  await mailed('alex@example.com', before);
  const sent = mailbox.slice(before);
  assert.deepEqual(sent.map((m) => m.to), ['alex@example.com'], 'only a member is sent mail');
  assert.doesNotMatch(sent[0].text, /#\/join\/|https?:\/\//, 'codes, never links');
  assert.match(sent[0].text, /^Default: [0-9A-Z]{4}-[0-9A-Z]{4}\nAcme: [0-9A-Z]{4}-[0-9A-Z]{4}$/m, 'one mail, with a code for each workspace');

  // Asking again within the minute sends nothing more.
  await call('/connect/sign-in', undefined, { email: 'alex@example.com' });
  assert.equal(mailbox.length, before + 1);

  const into = [];
  for (const name of ['Default', 'Acme']) {
    const signed = await call('/connect/code', undefined, { email: 'alex@example.com', code: codeSentTo('alex@example.com', name) });
    into.push((await call('/whoami', signed.token, undefined, 'GET')).workspace.id);
  }
  assert.deepEqual(into, ['default', 'acme']);
});

test('a code from the sign-in mail, typed with its address, signs in once; a few wrong ones and the address waits', async () => {
  const { workspaces, call } = await serve('tokens');
  const main = (await createToken((await workspaces.get('default')).pelago.db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  await call('/api/member_add', main, { email: 'kim@example.com', name: 'Kim' });
  const before = mailbox.length;
  await call('/connect/sign-in', undefined, { email: 'kim@example.com' });
  await mailed('kim@example.com', before);
  const code = codeSentTo('kim@example.com')!;

  assert.equal((await call('/connect/code', undefined, { email: 'someone@example.com', code })).status, 410, 'only with the address it was sent to');
  const signed = await call('/connect/code', undefined, { email: 'Kim@Example.com', code: ` ${code.toLowerCase().replace('-', ' ')} ` });
  assert.equal(signed.status, 200, 'typed loosely: any case, spaces for the dash');
  const who = await call('/whoami', signed.token, undefined, 'GET');
  assert.deepEqual([who.workspace.id, who.actor.name], ['default', 'kim@example.com']);
  assert.equal((await call('/connect/code', undefined, { email: 'kim@example.com', code })).status, 410, 'a code works once');

  for (let i = 1; i < CODE_TRIES; i++) assert.equal((await call('/connect/code', undefined, { email: 'kim@example.com', code: 'AAAA-AAAA' })).status, 410);
  assert.equal((await call('/connect/code', undefined, { email: 'kim@example.com', code: 'AAAA-AAAA' })).status, 429, 'past the tries, the address waits');
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
  const robot = (await call('/api/token_create', sam, { kind: 'agent', name: 'sam’s robot' })).result.token as string;
  assert.equal((await call('/agent/query', robot, { name: 'schema' })).status, 200);

  await call('/api/member_set', alex, { email: 'sam@example.com', remove: true });
  assert.equal((await call('/whoami', sam, undefined, 'GET')).status, 401, 'removed, they are signed out');
  assert.equal((await call('/agent/query', robot, { name: 'schema' })).status, 401, 'and so is every agent of theirs');
  const before = mailbox.length;
  await call('/connect/sign-in', undefined, { email: 'sam@example.com' });
  assert.equal(mailbox.length, before, 'and are sent no link');
  assert.deepEqual((await call('/api/member_list', alex)).result, []);
});

test('a member who only reads sees what any member sees, the database refuses their writes, and an admin switches them', async () => {
  const { workspaces, call, member } = await serve('tokens');
  const ws = await workspaces.get('default');
  const alex = (await createToken(ws.pelago.db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const shown = (await call('/api/change', alex, { reason: 'test', ops: [{ op: 'create', ref: 't', type: 'task', title: 'Shared work', visibility: 'shared' }] })).result.created.t as string;
  assert.match((await call('/api/member_add', alex, { email: 'no@example.com', admin: true, read_only: true })).error, /cannot be an admin/);
  const rosa = await member(alex, { email: 'rosa@example.com', name: 'Rosa', read_only: true });
  const person = ((await call('/api/member_list', alex)).result as any[]).find((m) => m.email === 'rosa@example.com');
  assert.equal(person.read_only, true, 'listed as one who only reads');

  const who = await call('/whoami', rosa, undefined, 'GET');
  assert.deepEqual([who.may, who.actor.may, who.actor.admin], [['read'], 'read', false], 'the page draws no control that writes');
  assert.equal((await call('/api/get', rosa, { id: shown })).result.entity.title, 'Shared work', 'they read what any member reads, with no reach of their own');
  assert.equal((await call('/api/tail', rosa, {})).status, 200, 'and follow the log as the page does');
  assert.match((await call('/api/change', rosa, { reason: 'test', ops: [{ op: 'update', id: shown, title: 'Mine now' }] })).error, /only reads/);
  const robot = (await createToken(ws.pelago.db, 'default', { kind: 'agent', name: 'rosa’s robot', entity: person.person_id })).token;
  assert.equal((await call('/agent/query', robot, { name: 'schema' })).status, 200, 'their agents read');
  assert.match((await call('/agent/change', robot, { reason: 'test', ops: [{ op: 'update', id: shown, title: 'Mine now' }] })).error, /only reads/, 'and do not write');

  // The database itself refuses, whatever the server's tools would let through.
  const theirs = ws.pelago.as(person.person_id, false, true);
  await assert.rejects(theirs.apply(`human:rosa`, { ops: [{ op: 'update', id: shown, title: 'Mine now' }], reason: 'test' }), /read-only transaction/);
  await assert.rejects(theirs.db.query(`update entity set title = 'Mine now' where id = $1`, [shown]), /read-only transaction/);
  await assert.rejects(theirs.db.transaction(async (tx) => { await tx.query(`set transaction read write`); await tx.query(`update entity set title = 'x' where id = $1`, [shown]); }), /read-only|read-write/, 'nor can a read-only transaction be made to write again');
  assert.equal((await ws.pelago.entity(shown))!.title, 'Shared work');

  // An admin switches them, and their sign-in follows at once; an admin never only reads.
  assert.equal((await call('/api/member_set', alex, { email: 'rosa@example.com', read_only: false })).result.read_only, false);
  assert.deepEqual((await call('/whoami', rosa, undefined, 'GET')).may, ['read', 'write']);
  assert.equal((await call('/api/change', rosa, { reason: 'test', ops: [{ op: 'update', id: shown, title: 'Rosa’s work' }] })).status, 200);
  assert.equal((await call('/api/member_set', alex, { email: 'rosa@example.com', admin: true })).result.admin, true);
  const back = (await call('/api/member_set', alex, { email: 'rosa@example.com', read_only: true })).result;
  assert.deepEqual([back.admin, back.read_only], [false, true], 'made to only read, an admin is one no more');
  assert.deepEqual([(await call('/whoami', rosa, undefined, 'GET')).actor.admin, (await call('/whoami', rosa, undefined, 'GET')).may], [false, ['read']]);
  assert.match((await call('/api/member_set', alex, { email: 'rosa@example.com', admin: true, read_only: true })).error, /cannot be an admin/);
});

test('a sign-in opens only the workspaces its address belongs to, as the index says, after a restore too', async () => {
  const { workspaces, call } = await serve('tokens');
  const operator = (await workspaces.ensureOperator())!;
  const acme = (await call('/operator/workspaces', operator, { id: 'acme', name: 'Acme', email: 'owner@acme.test' })).result.owner_token as string;
  const main = (await createToken((await workspaces.get('default')).pelago.db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  await call('/api/member_add', main, { email: 'dee@example.com' });
  await call('/api/member_add', acme, { email: 'ann@example.com' });
  // The first ask on a database that never had the index makes it, from every workspace, once.
  await call('/connect/sign-in', undefined, { email: 'first@example.com' });
  const opened: string[] = [];
  const get = workspaces.get.bind(workspaces);
  workspaces.get = (id) => (opened.push(id), get(id));
  await workspaces.closeIdle(0);

  // Random addresses, the attack: no workspace's database is opened for them.
  for (let i = 0; i < 5; i++) await call('/connect/sign-in', undefined, { email: `stranger${i}@example.com` });
  await call('/connect/code', undefined, { email: 'stranger9@example.com', code: 'AAAA-AAAA' });
  assert.ok(!opened.includes('acme'), 'an unknown address opens no workspace');
  const before = mailbox.length;
  await call('/connect/sign-in', undefined, { email: 'ann@example.com' });
  await mailed('ann@example.com', before);
  assert.equal(mailbox.length, before + 1, 'a member is still sent their link');
  assert.ok(opened.includes('acme'));

  // A member taken out leaves the index; a workspace made from a backup brings its members into it.
  await call('/api/member_set', acme, { email: 'ann@example.com', remove: true });
  const control = await workspaces.control();
  assert.deepEqual(await workspacesOf(control, 'ann@example.com', async () => []), []);
  const db = (await workspaces.get('default')).pelago.db;
  await workspaces.create('copy', 'Copy', { ...(await dump(db, { id: 'default', name: 'Default' })), vault: await dumpVault(db) });
  assert.deepEqual(await workspacesOf(control, 'dee@example.com', async () => []), ['default', 'copy']);
});
