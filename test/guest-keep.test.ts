// Signing in to keep a guest map (packs/identity/kernel/guest-keep.ts, e_n2ayhy6u): the address becomes the map's
// owner's, the map is the same workspace untouched, the plan's sign-in step ticks itself, the seller's gate kept starts a
// trial once per address and machine, and only then does its agent connect.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { workspacesOf } from '../packs/identity/kernel/control-index.ts';
import { guestOf, guestsDue } from '../packs/identity/kernel/guests.ts';
import { codeSentTo, mailbox, serve } from './serve.ts';
import { until } from './wait.ts';

const FIXTURES = join(import.meta.dirname, 'keep-packs');
before(() => Object.assign(process.env, { PELAGO_SERVER_PACKS: FIXTURES }));
after(() => void delete process.env.PELAGO_SERVER_PACKS);

const MACHINE = 'a'.repeat(32);
const SIGN_IN = /A guest map cannot .*: sign in to keep this map/;

test('signing in keeps the guest map as it is, ticks its sign-in step, starts a trial, and lets its agent connect', async () => {
  const { workspaces, call } = await serve('tokens');
  const guest = async () => {
    const made = (await call('/guest', undefined, {})).result;
    return { id: made.workspace.id as string, page: made.page_token as string, key: made.link.split('/g/')[1] as string };
  };
  const keep = async (page: string, email: string, machine?: string) => {
    const before = mailbox.length;
    const asked = await call('/connect/keep', page, { email });
    assert.equal(asked.sent_to, email, asked.error);
    assert.ok(await until(() => mailbox.slice(before).some((m) => m.to === email), 10_000), `a mail to ${email}`);
    return call('/connect/keep', page, { email, code: codeSentTo(email), ...(machine && { machine }) });
  };

  const first = await guest();
  const owner = (await call('/whoami', first.page, undefined, 'GET')).actor.person as string;
  assert.equal((await call('/whoami', first.page, undefined, 'GET')).workspace.guest, true, 'the page knows it is a guest map');
  const drawn = await call('/agent/change', first.key, { reason: 'Setup plan', ops: [
    { op: 'create', ref: 'p', type: 'work', title: 'Lantern' },
    { op: 'create', ref: 's', type: 'task', title: 'Sign in to keep this map' },
    { op: 'link', type: 'part_of', from: 's', to: 'p' },
    { op: 'link', type: 'waits_on', from: 's', to: owner, props: { for: 'sign in' } },
    { op: 'define_type', type: { id: 'local.lamp', title: 'Lamp', description: 'A lamp.', extends: 'work' } },
  ] });
  assert.equal(drawn.result?.status, 'applied', drawn.error);
  const { p, s } = drawn.result.created;

  // The agent cannot connect until the map is kept: Allow on a guest map says to keep it first.
  const client = (await call('/oauth/register', undefined, { client_name: 'Claude Code hooks', redirect_uris: ['http://127.0.0.1/callback'] })).client_id;
  const query = new URLSearchParams({ response_type: 'code', client_id: client, redirect_uri: 'http://127.0.0.1:5555/callback', code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', state: 's', machine: MACHINE }).toString();
  const early = await call('/oauth/allow', first.page, { query, allow: true });
  assert.deepEqual([early.status, early.keep], [403, true], early.error);

  // Only the map's owner keeps it, in their browser: not its agent's key, not nobody.
  assert.equal((await call('/connect/keep', first.key, { email: 'kim@example.com' })).status, 403);
  assert.equal((await call('/connect/keep', undefined, { email: 'kim@example.com' })).status, 401);
  assert.equal((await call('/connect/keep', first.page, { email: 'kim@example.com', code: 'AAAA-AAAA' })).status, 410, 'a wrong code');

  const kept = await keep(first.page, 'kim@example.com', MACHINE);
  assert.equal(kept.status, 200, kept.error);
  assert.equal(kept.workspace.id, first.id, 'the same workspace: nothing copied');
  assert.ok(Date.parse(kept.trial?.ends) > Date.now() + 29 * 86_400_000, 'a 30-day trial begun');

  // Signed in as the map's owner, its member at that address; the map as it was, the sign-in step ticked.
  const who = await call('/whoami', kept.token, undefined, 'GET');
  assert.deepEqual([who.workspace.id, who.workspace.guest, who.actor.person, who.actor.name], [first.id, undefined, owner, 'kim@example.com']);
  const get = async (id: string) => (await call('/api/get', kept.token, { id })).result;
  assert.equal((await get(p)).entity.title, 'Lantern');
  const step = await get(s);
  assert.equal(step.entity.status, 'done', 'the step that waited on the sign-in is done');
  assert.ok(!step.outgoing.some((r: { type: string }) => r.type === 'waits_on'), 'and waits on nobody');
  const you = (await get(owner)).entity;
  assert.deepEqual([you.title, you.props?.email], ['You', 'kim@example.com'], 'the owner keeps their name and has the address');
  assert.ok((await call('/agent/query', first.key, { name: 'search', params: { q: 'Lamp' } })).result?.some((i: { type: string }) => i.type === 'type'), 'its own types kept');

  // What waited for sign-in no longer does; the week's end is gone; the seller's limits hold.
  assert.doesNotMatch((await call('/api/share_create', kept.token, { id: p })).error ?? '', SIGN_IN);
  const control = await workspaces.control();
  assert.ok((await guestOf(control, first.id))?.saved);
  assert.ok(!(await guestsDue(control, new Date(Date.now() + 60 * 86_400_000))).includes(first.id), 'never due to be deleted');
  assert.equal((await call('/connect/keep', kept.token, { email: 'kim@example.com' })).status, 409, 'kept once');

  // Now its agent connects: Allow gives a code for the kept map.
  const allowed = await call('/oauth/allow', kept.token, { query, allow: true });
  assert.equal(allowed.status, 200, allowed.error);
  assert.equal(allowed.workspace, first.id);

  // From the same machine, another address keeps its map but has no second trial: read-only, the way to pay said.
  const second = await guest();
  const again = await keep(second.page, 'rosa@example.com', MACHINE);
  assert.equal(again.status, 200, again.error);
  assert.deepEqual([again.trial, again.upgrade], [undefined, '/x/seller/upgrade']);
  assert.match((await call('/api/change', again.token, { reason: 'x', ops: [{ op: 'create', type: 'task', title: 'Late' }] })).error, /read-only/);

  // An address with a map already keeps a new one as one more workspace, and no second trial.
  const third = await guest();
  const more = await keep(third.page, 'kim@example.com', 'b'.repeat(32));
  assert.equal(more.upgrade, '/x/seller/upgrade');
  assert.deepEqual((await workspacesOf(control, 'kim@example.com', async () => [])).sort(), [first.id, third.id].sort());
});
