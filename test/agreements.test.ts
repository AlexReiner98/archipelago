import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { owed, recordAgreement, type Agreement } from '../src/agreements.ts';
import { checkServerPack } from '../src/server-packs.ts';
import { mailbox, serve } from './serve.ts';

const FIXTURES = join(import.meta.dirname, 'agreement-packs');
before(() => Object.assign(process.env, { PELAGO_SERVER_PACKS: FIXTURES }));
after(() => delete process.env.PELAGO_SERVER_PACKS);

test('a version agreed to is kept with every one before it; a new version is owed again, a stale one is not recorded', async () => {
  const { workspaces } = await serve('off');
  const control = (await workspaces.get('default')).pelago.db;
  const v1: Agreement[] = [{ id: 'terms', title: 'Terms', url: '/t', version: '1' }];
  const v2: Agreement[] = [{ ...v1[0], version: '2' }];
  assert.deepEqual(await recordAgreement(control, 'rosa@acme.example', undefined, v1, 'test'), v1, 'nothing given, all owed');
  assert.deepEqual(await recordAgreement(control, 'rosa@acme.example', [{ id: 'terms', version: '1' }], v1, 'test'), []);
  assert.deepEqual(await recordAgreement(control, 'rosa@acme.example', [{ id: 'terms', version: '1' }], v2, 'test'), v2, 'the old version does not answer for the new');
  assert.deepEqual(await recordAgreement(control, 'rosa@acme.example', [{ id: 'terms', version: '2' }], v2, 'test'), []);
  assert.deepEqual(owed(v1, {}), v1);
  assert.match(checkServerPack({ id: 'x', version: '1', title: 'X', reach: { server: { agreements: 'nowhere' } } }, FIXTURES).join(), /agreements name no entry/);
});

test('a sign-in waits until the documents in force are agreed to, without spending its link or code', async () => {
  const { base, call } = await serve('tokens');
  const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  const both = [
    { id: 'terms', version: '2026-10-21' },
    { id: 'privacy', version: 'v1' },
  ];

  // What is in force, for a signup page: the malformed one left out.
  const { agreements } = await fetch(`${base}/connect/agreements`).then((r) => r.json());
  assert.deepEqual(agreements.map((a: Agreement) => [a.id, a.title, a.version]), [['terms', 'Terms of Service', '2026-10-21'], ['privacy', 'Privacy Policy', 'v1']]);
  assert.deepEqual(agreements[0].also, [{ title: "Conditions d'utilisation", url: '/x/terms/terms_fr' }], 'another language, named in its own; one that is no address is left out');
  assert.equal(agreements[1].also, undefined);

  const { workspace } = (await post('/x/terms/make', { name: 'Acme', members: ['rosa@acme.example', 'sam@acme.example', 'kim@acme.example'] })).result;
  const linkTo = async (email: string) => /#\/join\/(inv_[a-z0-9-]+_[0-9a-f]{40})$/.exec((await post('/x/terms/link', { workspace, email })).result.link)![1];

  // A link: asked to agree, and the link still works afterwards; agreed to, it signs in, once.
  const code = await linkTo('rosa@acme.example');
  assert.deepEqual((await post('/connect/join', { code })).agree.map((a: Agreement) => a.id), ['terms', 'privacy']);
  assert.deepEqual((await post('/connect/join', { code, agree: [both[0]] })).agree.map((a: Agreement) => a.id), ['privacy'], 'one of two agreed to is kept, the other still owed');
  assert.deepEqual((await post('/connect/join', { code, agree: [{ id: 'privacy', version: 'v0' }] })).agree.map((a: Agreement) => a.id), ['privacy'], 'a version not in force is not taken');
  const { token } = await post('/connect/join', { code, agree: both });
  assert.equal((await call('/whoami', token, undefined, 'GET')).actor.name, 'rosa@acme.example');
  assert.equal((await post('/connect/join', { code, agree: both })).status, 410, 'the link worked once');
  // Agreed once, the next sign-in goes straight through.
  assert.ok((await post('/connect/join', { code: await linkTo('rosa@acme.example') })).token);
  assert.equal((await post('/connect/join', { code: `inv_${workspace}_${'0'.repeat(40)}` })).status, 410, 'a link that is no link is not asked to agree');

  // A typed code: a wrong one is refused as before, saying nothing of what is owed; a right one asks first.
  await post('/connect/sign-in', { email: 'sam@acme.example' });
  // The mail goes out after the answer: wait for it, however slow the database.
  for (let tries = 0; tries < 100 && !mailbox.some((m) => m.to === 'sam@acme.example'); tries++) await new Promise((r) => setTimeout(r, 50));
  const typed = /type this code on the sign-in page: ([A-Z0-9]{4}-[A-Z0-9]{4})/.exec(mailbox.findLast((m) => m.to === 'sam@acme.example')!.text)![1];
  assert.equal((await post('/connect/code', { email: 'sam@acme.example', code: 'AAAA-AAAA' })).status, 410);
  assert.ok((await post('/connect/code', { email: 'sam@acme.example', code: typed })).agree);
  assert.ok((await post('/connect/code', { email: 'sam@acme.example', code: typed, agree: both })).token);

  // A buyer who ticked the box at the signup is recorded by the pack, and not asked again; only a member of its own.
  assert.deepEqual((await post('/x/terms/agreed', { workspace, email: 'kim@acme.example', agreed: both })).result, { owes: [] });
  assert.ok((await post('/connect/join', { code: await linkTo('kim@acme.example') })).token);
  assert.match((await post('/x/terms/agreed', { workspace, email: 'stranger@example.com', agreed: both })).error, /not a member/);
  assert.match((await post('/x/terms/agreed', { workspace: 'default', email: 'kim@acme.example', agreed: both })).error, /not a workspace this pack made/);
});
