import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createToken } from '../src/auth.ts';
import { serve } from './serve.ts';

// One agent token per person (bug e_94ag6443): it reaches every workspace its person is a member of, as that person's
// member there, with what is private to them; each call names its workspace, else it acts at home.
test('a person token reaches every workspace its person is a member of, as them, and nothing more', async () => {
  const { workspaces, call, base, member } = await serve('tokens');
  const adminOf = async (id: string) => {
    const ws = (await workspaces.has(id)) ? await workspaces.get(id) : await workspaces.create(id, id);
    return (await createToken(ws.pelago.db, id, { kind: 'human', name: `admin of ${id}`, admin: true })).token;
  };
  const [home, acme, other] = [await adminOf('default'), await adminOf('acme'), await adminOf('other')];
  const sam = { home: await member(home, { email: 'sam@x.org', name: 'Sam' }), acme: await member(acme, { email: 'sam@x.org', name: 'Sam' }) };
  const kim = await member(acme, { email: 'kim@x.org', name: 'Kim' });
  await member(other, { email: 'nobody@x.org' });
  const made = async (token: string, title: string) => (await call('/api/change', token, { reason: 'x', ops: [{ op: 'create', ref: 'a', type: 'task', title, visibility: 'private' }] })).result.created.a as string;
  const samsHome = await made(sam.home, 'Sam at home'), samsAcme = await made(sam.acme, 'Sam at Acme'), kims = await made(kim, 'Kim at Acme');

  // Sam makes it signed in at home: an agent's, for themself alone, never an admin's or within items.
  assert.match((await call('/api/token_create', sam.home, { kind: 'human', name: 'x', everywhere: true })).error, /person token is an agent/);
  assert.match((await call('/api/token_create', sam.home, { kind: 'agent', name: 'x', everywhere: true, within: [samsHome] })).error, /person token is an agent/);
  assert.match((await call('/api/token_create', home, { kind: 'agent', name: 'x', everywhere: true })).error, /Only a member signed in by email/);
  const made1 = (await call('/api/token_create', sam.home, { kind: 'agent', name: 'claude', everywhere: true })).result;
  const pep = made1.token as string;
  assert.match(pep, /^pep_[a-f0-9]{48}$/);
  assert.deepEqual([made1.emails, made1.home], [['sam@x.org'], 'default']);

  const get = (id: string, ws?: string, token = pep) =>
    fetch(`${base}/agent/get`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(ws && { 'x-pelago-workspace': ws }) }, body: JSON.stringify({ id }) }).then(async (r) => ({ status: r.status, ...(await r.json()) }));
  // At home with no workspace named, and at Acme when named: as Sam, with what is private to Sam.
  assert.equal((await get(samsHome)).result.entity.title, 'Sam at home');
  assert.equal((await get(samsAcme, 'acme')).result.entity.title, 'Sam at Acme');
  // Not what is private to another member there, and nowhere Sam is no member, nor a workspace that is not.
  const kimsSeen = await get(kims, 'acme');
  assert.equal(kimsSeen.result?.entity?.title, undefined, `Kim's private item is not Sam's to read: ${JSON.stringify(kimsSeen).slice(0, 200)}`);
  assert.equal((await call('/agent/get', kim, { id: kims })).result.entity.title, 'Kim at Acme', 'it is there, for Kim');
  assert.equal((await get(samsHome, 'other')).status, 401);
  assert.equal((await get(samsHome, 'nowhere')).status, 401);
  // A workspace's own token cannot be pointed at another workspace.
  assert.equal((await get(samsAcme, 'acme', sam.home)).status, 401);

  // Who it is there: an agent acting as Sam's record in that workspace, never an admin.
  const whoami = async (ws: string) => (await fetch(`${base}/whoami`, { headers: { authorization: `Bearer ${pep}`, 'x-pelago-workspace': ws } })).json();
  const there = await whoami('acme');
  assert.deepEqual([there.workspace.id, there.actor.kind, there.actor.admin], ['acme', 'agent', false]);
  assert.equal(there.actor.person, (await call('/api/member_list', acme)).result.find((m: any) => m.email === 'sam@x.org').person_id);
  assert.notEqual((await whoami('default')).actor.person, there.actor.person, 'a member record of each workspace, not one id across them');
  assert.match((await call('/api/member_list', pep)).error ?? '', /./, 'it is no admin, and no human');

  // What it changes is an agent's in that workspace, under that workspace's rules.
  await call('/api/workspace_set', acme, { agent_changes: 'hold' });
  await call('/api/workspace_set', home, { agent_changes: 'apply' });
  const change = (ws: string, id: string) => fetch(`${base}/agent/change`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${pep}`, 'x-pelago-workspace': ws }, body: JSON.stringify({ reason: 'test', ops: [{ op: 'update', id, status: 'doing' }] }) }).then((r) => r.json());
  assert.equal((await change('acme', samsAcme)).result.status, 'proposed');
  assert.equal((await change('default', samsHome)).result.status, 'applied');

  // Over MCP a call names it in its arguments, read before the call is answered, or the connection's address does.
  const mcp = async (args: Record<string, unknown>, at = '/mcp') =>
    (
      await fetch(`${base}${at}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${pep}`, 'mcp-protocol-version': '2025-06-18' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'query', arguments: { name: 'get', params: { id: samsAcme }, ...args } } }),
      })
    ).text();
  assert.match(await mcp({ workspace: 'acme' }), /Sam at Acme/);
  assert.doesNotMatch(await mcp({}), /Sam at Acme/, 'at home, the item of Acme is not there');
  assert.match(await mcp({}, '/mcp/acme'), /Sam at Acme/);
  assert.doesNotMatch(await mcp({ workspace: 'default' }, '/mcp/acme'), /Sam at Acme/, 'what a call names comes before its address');

  // Sam's other address, signed in on a third workspace, lets the same token reach it too.
  const elsewhere = await member(other, { email: 'sam@elsewhere.org' });
  const ownThere = await made(elsewhere, 'Sam elsewhere');
  assert.equal((await get(ownThere, 'other')).status, 401);
  assert.deepEqual((await call('/api/token_create', elsewhere, { kind: 'agent', name: 'x', reach: pep })).result.emails, ['sam@x.org', 'sam@elsewhere.org']);
  assert.equal((await get(ownThere, 'other')).result.entity.title, 'Sam elsewhere');
  assert.match((await call('/api/token_create', elsewhere, { kind: 'agent', name: 'x', reach: 'pep_' + '0'.repeat(48) })).error, /no live person token/);

  // Listed for Sam, and for an admin of a workspace it reaches; only Sam revokes it.
  assert.ok((await call('/api/token_list', sam.acme)).result.some((t: any) => t.id === made1.id && t.everywhere));
  assert.ok((await call('/api/token_list', acme)).result.some((t: any) => t.id === made1.id));
  assert.ok(!(await call('/api/token_list', kim)).result.some((t: any) => t.id === made1.id));
  assert.match((await call('/api/token_revoke', acme, { id: made1.id })).error, /No active token/);

  // A member removed is cut off there at once; elsewhere it goes on.
  await call('/api/member_set', acme, { email: 'sam@x.org', remove: true });
  assert.equal((await get(samsAcme, 'acme')).status, 401);
  assert.equal((await get(samsHome)).status, 200);

  // One revoke ends it everywhere.
  assert.equal((await call('/api/token_revoke', elsewhere, { id: made1.id })).result.everywhere, true);
  assert.equal((await get(samsHome)).status, 401);
  assert.equal((await get(ownThere, 'other')).status, 401);
});
