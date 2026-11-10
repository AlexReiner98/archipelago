import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createToken } from '../src/auth.ts';
import { linkFor } from '../src/members.ts';
import { mailbox, serve } from './serve.ts';

test('a guest is invited with no link, signs in by their address, and the server reads for them as the view shared with them, live', async () => {
  const { workspaces, call } = await serve('tokens');
  const db = (await workspaces.get('default')).pelago.db;
  const alex = (await createToken(db, 'default', { kind: 'human', name: 'alex', admin: true })).token;
  const made = (await call('/api/change', alex, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'a', type: 'question', title: 'SR&ED', visibility: 'shared' },
      { op: 'create', ref: 'o', type: 'task', title: 'Out of the view', visibility: 'shared' },
      { op: 'create', ref: 'lens', type: 'lens', title: 'Questions', visibility: 'shared', props: { filter: { find: ['type question'], not: [] }, walk: { over: [], steps: 0 } } },
    ],
  })).result.created;
  const given = (await call('/api/share_guest', alex, { id: made.lens, email: 'guest@example.com' })).result;
  assert.equal(given.invited, true, 'they are sent an invitation');

  assert.doesNotMatch(mailbox.findLast((m) => m.to === 'guest@example.com')!.text, /#\/join\/|https?:\/\//, 'the invitation carries no link: they sign in with their address');
  // Signed in as the sign-in page would, once they ask for a code: the sign-in made here, traded at the door.
  const code = (await linkFor(db, 'default', 'guest@example.com', 60_000)).split('/join/')[1];
  const guest = (await call('/connect/join', undefined, { code })).token as string;
  const who = (await call('/whoami', guest, undefined, 'GET')).actor;
  assert.deepEqual([who.kind, who.may, who.reads, who.admin, who.person], ['human', 'read', given.share, false, given.person], 'what the session may do says read');

  // The page's feed: where things stand, then what changed on what the view holds, and nothing else.
  const { pos } = (await call('/api/tail', guest, {})).result;
  await call('/api/change', alex, { reason: 'test', ops: [{ op: 'update', id: made.a, title: 'SR&ED, filed' }, { op: 'update', id: made.o, title: 'Still out' }] });
  const feed = (await call('/api/tail', guest, { after: pos, ids: [made.a] })).result;
  assert.deepEqual(feed.entries.flatMap((e: { facts: unknown[][] }) => e.facts.map((f) => [f[1], f[2], f[3]])), [[made.a, 'title', 'SR&ED, filed']]);

  // A write of any kind is refused.
  assert.match((await call('/api/change', guest, { reason: 'test', ops: [{ op: 'update', id: made.a, title: 'Mine' }] })).error, /A guest reads the view shared with them/);
  assert.match((await call('/api/member_list', guest)).error, /cannot call member_list/);

  // Revoked, the share is closed to them at once.
  await call('/api/share_revoke', alex, { id: given.share });
  assert.match((await call('/api/tail', guest, {})).error, /no longer shared with you/);
});
