import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createToken, verifyToken } from '../src/auth.ts';
import { guestFacts, guestMap } from '../src/guests.ts';
import type { Actor, Archipelago } from '../src/pelago.ts';
import { configureOutbox } from '../src/outbox.ts';
import { headPos } from '../src/tail.ts';
import { callTool } from '../src/tools.ts';
import { fresh, make } from './map.ts';

/** A map with a view of the questions on it, an item and a link out of the view, and one question private to Ann. */
async function shared() {
  const l = await fresh();
  configureOutbox(async () => l);
  const { ann } = await make(l, [{ op: 'create', ref: 'ann', type: 'person', title: 'Ann', visibility: 'shared' }]);
  const owner: Actor = { kind: 'human', name: 'ann', person: ann, admin: true };
  const mine = l.as(ann, true);
  const made = ((await mine.change(owner, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'a', type: 'question', title: 'SR&ED', body: 'Claimed after the work.', visibility: 'shared' },
      { op: 'create', ref: 'b', type: 'question', title: 'IRAP', body: 'Call the advisor.', visibility: 'shared' },
      { op: 'create', ref: 'p', type: 'question', title: 'Private', body: 'Only Ann.', visibility: 'private' },
      { op: 'create', ref: 'o', type: 'task', title: 'Out of the view', body: 'Not a question.', visibility: 'shared' },
      { op: 'create', ref: 'lens', type: 'lens', title: 'Questions', visibility: 'shared', props: { filter: { find: ['type question'], not: [] }, walk: { over: [], steps: 0 } } },
      { op: 'link', type: 'depends_on', from: 'a', to: 'b' },
      { op: 'link', type: 'depends_on', from: 'a', to: 'o' },
    ],
  })) as { created: Record<string, string> }).created;
  const given = (await callTool(mine, owner, 'share_guest', { id: made.lens, email: 'Guest@Example.com' })) as { share: string; person: string; email: string };
  return { l, mine, owner, made, given };
}

const ids = async (g: Archipelago, table: 'entity' | 'relation') => (await g.db.query<{ id: string }>(`select id from ${table} order by id`)).rows.map((r) => r.id);
const links = async (l: Archipelago, from: string, to: string) => (await l.db.query<{ id: string }>(`select id from relation where from_id = $1 and to_id = $2`, [from, to])).rows[0].id;

test('a guest reads the items and links of the view shared with them, and nothing else', async () => {
  const { l, made, given } = await shared();
  assert.equal(given.email, 'guest@example.com');
  const g = await guestMap(l, given.share, given.person);

  assert.deepEqual(await ids(g, 'entity'), [made.a, made.b, made.lens].sort(), 'the view and its questions: not the task out of it, not what is private to Ann, not the guest themself');
  assert.deepEqual(await ids(g, 'relation'), [await links(l, made.a, made.b)], 'the link inside the view, not the one out of it');
  assert.equal((await g.db.query(`select id from entity where id = $1`, [made.p])).rows.length, 0, 'a private item, though the one who shared sees it');

  // Under another share's name it reaches nothing: the share is said by the server, and its reach is its own.
  const other = await g.db.transaction(async (tx) => {
    await tx.query(`select set_config('pelago.share', 's_nothere', true)`);
    return (await tx.query(`select id from entity`)).rows.length;
  });
  assert.equal(other, 0);
});

test('the database refuses a guest every write, and every table but what a view is read from', async () => {
  const { l, made, given } = await shared();
  const g = await guestMap(l, given.share, given.person);
  const refused = [
    [`insert into entity (id, type, title) values ('e_zzzzzzzz', 'task', 'x')`, []],
    [`update entity set title = 'changed' where id = $1`, [made.a]],
    [`delete from entity where id = $1`, [made.a]],
    [`insert into relation (id, type, from_id, to_id) values ('r_zzzzzzzz', 'depends_on', $1, $2)`, [made.a, made.b]],
    [`update relation set type = 'about'`, []],
    [`insert into reach (share_id, id) values ($1, $2)`, [given.share, made.o]],
    [`select * from log_fact limit 1`, []],
    [`select * from log_entry limit 1`, []],
    [`select * from log_op limit 1`, []],
    [`select * from member`, []],
    [`select * from token`, []],
    [`select * from share`, []],
    [`select * from proposal`, []],
    [`insert into vault_key (ws, id, version, wrapped) values ('default', 'e_zzzzzzzz', 1, '\\x00')`, []],
  ] as const;
  for (const [sql, params] of refused) await assert.rejects(g.db.query(sql, [...params]), /permission denied/, sql);
  // A setting a read needs is there; the rest are not.
  assert.deepEqual((await g.db.query<{ key: string }>(`select key from setting order by key`)).rows.map((r) => r.key).filter((k) => !['me', 'default_visibility'].includes(k)), []);
  // A key opens only what the guest may see.
  assert.deepEqual((await g.db.query<{ id: string }>(`select id from vault_key where id = any($1::text[])`, [[made.o, made.p]])).rows, []);
  // And the tools: a guest calls only the reads.
  const guest: Actor = { kind: 'human', name: 'guest@example.com', person: given.person, may: 'read', reads: given.share };
  await assert.rejects(callTool(g, guest, 'change', { reason: 'test', ops: [{ op: 'update', id: made.a, title: 'Mine' }] }), /A guest reads the view shared with them: they cannot call change/);
  await assert.rejects(callTool(g, guest, 'share_create', { id: made.a }), /cannot call share_create/);
});

test("a guest's feed of the log is the facts on what the view holds, its words opened", async () => {
  const { l, mine, owner, made, given } = await shared();
  const before = await headPos(l.db);
  await mine.change(owner, {
    reason: 'test',
    ops: [
      { op: 'update', id: made.b, title: 'IRAP, filed', body: 'Filed in March.' },
      { op: 'update', id: made.o, title: 'Still out' },
      { op: 'update', id: made.p, title: 'Still private' },
    ],
  });
  const g = await guestMap(l, given.share, given.person);
  const feed = await guestFacts(g, { after: before, ids: [made.a, made.b, made.o] });
  assert.ok('entries' in feed);
  const facts = feed.entries.flatMap((e) => e.facts);
  assert.deepEqual([...new Set(facts.map((f) => f[1]))], [made.b], 'only the item in the view');
  assert.deepEqual(facts.filter((f) => f[2] === 'title').map((f) => f[3]), ['IRAP, filed'], 'its words in clear');
  assert.deepEqual(feed.gone, [made.o], 'what the page holds and the guest cannot see');
  assert.equal(feed.pos, await headPos(l.db));
  assert.deepEqual(await guestFacts(g, {}), { pos: feed.pos }, 'where things stand, for a page that has read nothing yet');
});

test("a guest's reach follows the view as it changes, and ends with the share", async () => {
  const { l, mine, owner, made, given } = await shared();
  await guestMap(l, given.share, given.person);
  const { c } = ((await mine.change(owner, { reason: 'test', ops: [{ op: 'create', ref: 'c', type: 'question', title: 'SBIR', visibility: 'shared' }] })) as { created: Record<string, string> }).created;
  await mine.change(owner, { reason: 'test', ops: [{ op: 'update', id: made.a, visibility: 'private' }] });
  const g = await guestMap(l, given.share, given.person);
  assert.deepEqual(await ids(g, 'entity'), [made.b, c, made.lens].sort(), 'live: what joins the view is read, what leaves it is not');
  assert.deepEqual(await ids(g, 'relation'), [], 'nor a link to what left');

  await l.db.query(`update share set revoked_at = now() where id = $1`, [given.share]);
  await assert.rejects(guestMap(l, given.share, given.person), /no longer shared with you/);
  await assert.rejects(guestFacts(g, { after: 0 }), /no longer shared with you/, 'the feed ends with it, whatever the server held');
});

test("every token tied to a guest reads, and only under their share; a person token does not reach them", async () => {
  const { l, mine, owner, made, given } = await shared();
  const { token } = await createToken(l.db, 'default', { kind: 'human', name: 'guest@example.com', entity: given.person, admin: true, expires_days: 30 });
  const who = (await verifyToken(l.db, token))!.actor;
  assert.deepEqual([who.may, who.reads, who.admin, who.person], ['read', given.share, false, given.person], 'read, never admin, whatever the token was made with');
  const agent = (await createToken(l.db, 'default', { kind: 'agent', name: 'their agent', entity: given.person })).token;
  assert.equal((await verifyToken(l.db, agent))!.actor.may, 'read');

  // Sharing another view with them ends the first.
  const { other } = ((await mine.change(owner, { reason: 'test', ops: [{ op: 'create', ref: 'other', type: 'lens', title: 'Tasks', visibility: 'shared', props: { filter: { find: ['type task'], not: [] }, walk: { over: [], steps: 0 } } }] })) as { created: Record<string, string> }).created;
  const again = (await callTool(mine, owner, 'share_guest', { id: other, email: 'guest@example.com' })) as { share: string; person: string };
  assert.equal(again.person, given.person);
  await assert.rejects(guestMap(l, given.share, given.person), /no longer shared/);
  assert.equal((await verifyToken(l.db, token))!.actor.reads, again.share);
  assert.deepEqual(await ids(await guestMap(l, again.share, given.person), 'entity'), [made.o, other].sort());

  // A member is not made a guest, nor is anything but a view shared.
  await l.db.query(`insert into member (email, person_id, admin) values ('ann@example.com', $1, true)`, [owner.person]);
  await assert.rejects(callTool(mine, owner, 'share_guest', { id: made.lens, email: 'ann@example.com' }), /a member already/);
  await assert.rejects(callTool(mine, owner, 'share_guest', { id: made.a, email: 'x@example.com' }), /only a view can be shared/);
  await assert.rejects(callTool(mine, { ...owner, admin: false }, 'share_guest', { id: made.lens, email: 'x@example.com' }), /Only a workspace admin/);
});
