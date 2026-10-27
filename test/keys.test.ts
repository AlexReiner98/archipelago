// Per-item keys and forgetting (docs/log.md, section 5): every value that is someone's words is sealed in the log with
// the key of what it belongs to, opened on the way out for whoever may see it; a forget destroys the keys, leaves the
// sealed values as their digests, and takes the item out of every read, while the chain still verifies; a backup taken
// before the forget cannot bring it back.

import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { agent, fresh, human, make, replayed } from './map.ts';
import { backupVault, dump, restore } from '../src/backup.ts';
import { openDb } from '../src/db.ts';
import { mentions } from '../src/forget.ts';
import { entries, stored, verify, type Entry } from '../src/log.ts';
import { Archipelago } from '../src/pelago.ts';
import { isSealed, open } from '../src/seal.ts';
import { undo } from '../src/undo.ts';
import { dumpVault, keysOf } from '../src/vault.ts';

async function all(l: Archipelago, read = entries) {
  const out: Entry[] = [];
  for (let page = await read(l.db, 'facts', 1); page.length; page = await read(l.db, 'facts', out.at(-1)!.pos + 1)) out.push(...page);
  return out;
}

const raw = async (l: Archipelago, id: string) => (await l.db.query<{ field: string; value: unknown }>(`select field, value from log_fact where id = $1 order by pos, n`, [id])).rows;

/** A person, a project, a task about the person with words in every place, and a link with a field into the person. */
async function setup(l: Archipelago) {
  const made = await make(l, [
    { op: 'create', ref: 'sam', type: 'person', title: 'Sam Quill', body: 'Salary talks in March.' },
    { op: 'create', ref: 'p', type: 'project', title: 'Hiring' },
    { op: 'create', ref: 't', type: 'task', title: 'Offer letter', body: 'For {sam}.', owner: 'sam', props: { priority: 'high' } },
    { op: 'link', type: 'part_of', from: 't', to: 'p' },
    { op: 'link', type: 'waits_on', from: 't', to: 'sam', props: { for: 'Quill to sign' } },
  ]);
  // An agent's word, applied: the basis is free text too.
  const said = await l.apply('agent:test', { reason: 'Sam Quill asked for more time', ops: [{ op: 'update', id: made.t, status: 'doing' }] }, { authority: { of: 'agent', who: 'agent:test', basis: 'Quill on the phone' } });
  return { ...made, said: (said as { changeset: string }).changeset } as Record<string, string>;
}

test('every value that is words is sealed in the log with its own key, and opened for whoever may see it', async () => {
  const l = await fresh();
  const made = await setup(l);
  const [first, second] = await all(l, stored);
  const fact = (e: Entry, id: string, field: string) => e.facts.find((f) => f[1] === id && f[2] === field)?.[3];

  // Stored: title, note and declared fields sealed; structure clear; the reason sealed with the change set's key.
  for (const field of ['title', 'body', 'priority']) assert.ok(isSealed(fact(first, made.t, field)), `${field} is sealed`);
  for (const [field, value] of [['status', 'todo'], ['owner', made.sam], ['type', 'task'], ['visibility', 'private']]) assert.equal(fact(first, made.t, field), value, `${field} stays clear`);
  const waits = first.facts.find((f) => f[2] === 'link' && (f[3] as string[])[0] === 'waits_on')![1];
  assert.ok(isSealed(fact(first, waits, 'for')), "a link's fields with the link's own key");
  assert.ok(isSealed(first.reason) && isSealed((second.authority as { basis: unknown }).basis), 'reason and basis sealed');
  assert.deepEqual(first.keys, [first.id, made.p, made.sam, made.t, waits].sort(), 'keys names every key the entry uses');
  assert.ok(!JSON.stringify(await l.db.query(`select * from log_entry e join log_fact f using (stream, pos)`)).includes('Quill'), 'no words in the stored log');

  // Opened: as they were written. The additional data names the item and field, so a value moved elsewhere opens to nothing.
  const [plain, plain2] = await all(l);
  assert.deepEqual([fact(plain, made.t, 'title'), fact(plain, made.t, 'body'), fact(plain, waits, 'for'), plain.reason], ['Offer letter', `For ${made.sam}.`, 'Quill to sign', 'test']);
  assert.equal((plain2.authority as { basis: string }).basis, 'Quill on the phone');
  const ring = await keysOf(l.db, [made.t]);
  assert.equal(open(ring.get(made.t), 'title', fact(first, made.t, 'title') as never), 'Offer letter');
  assert.equal(open(ring.get(made.t), 'body', fact(first, made.t, 'title') as never), undefined, 'not as another field');
  assert.equal(open(ring.get(made.sam), 'title', fact(first, made.t, 'title') as never), undefined, 'not with another key');

  // The chain verifies with no key at all: it hashes each sealed value by its digest.
  assert.deepEqual((await verify(l.db)).problems, []);

  // Who may not see an item reads its values as digests, and the header of an entry about it only.
  const mine = (await make(l, [{ op: 'create', ref: 'h', type: 'task', title: 'Kept to myself', visibility: 'private' }])).h;
  await l.db.query(`update entity set private_to = 'e_owner' where id = $1`, [mine]);
  const theirs = await entries(l.as('e_other').db, 'facts', 1);
  const hidden = theirs.find((e) => e.facts.some((f) => f[1] === mine))!;
  assert.deepEqual(hidden.facts.find((f) => f[2] === 'title')![3], { $h: (hidden.facts.find((f) => f[2] === 'title')![3] as { $h: string }).$h });
  assert.ok(!JSON.stringify(theirs).includes('Kept to myself'));
  assert.ok(JSON.stringify(await entries(l.as('e_owner').db, 'facts', 1)).includes('Kept to myself'));
});

test('a forget destroys the keys, leaves digests where the words were, and the chain still verifies', async () => {
  const l = await fresh();
  const made = await setup(l);
  const head = (await verify(l.db)).head;
  const waits = (await l.db.query<{ id: string }>(`select id from relation where type = 'waits_on'`)).rows[0].id;

  // What mentions Sam is offered; only what is chosen goes with Sam.
  const offered = await mentions(l.db, made.sam);
  assert.deepEqual(offered.map((m) => m.id), [made.said]);
  // Held for an agent: forgetting is the owner's, whatever the workspace lets agents do.
  await l.db.query(`insert into setting (key, value) values ('agent_changes', '"apply"')`);
  const asked = await l.change(agent, { reason: 'Forget Sam', ops: [{ op: 'forget', id: made.sam }] });
  assert.deepEqual([asked.status, (asked as { held_by: { rule: string } }).held_by.rule], ['proposed', 'forget']);
  const forgot = (await l.change(human, { reason: 'Sam asked to be forgotten', ops: [{ op: 'forget', id: made.sam, reasons: [made.said] }] })) as { changeset: string };

  const after = await verify(l.db);
  assert.deepEqual(after.problems, [], 'the chain still verifies');
  assert.equal(after.entries, 3);
  const byDigest = (rows: { value: unknown }[]) => rows.filter((r) => typeof r.value === 'object' && r.value !== null && '$h' in r.value).length;
  assert.equal(byDigest(await raw(l, made.sam)), 2, "the person's title and note are digests now");
  assert.equal(byDigest(await raw(l, waits)), 1, 'and the field of the link into them');
  assert.equal(byDigest(await raw(l, made.t)), 0, 'the task keeps its words');
  assert.deepEqual([...(await keysOf(l.db, [made.sam, waits, made.said])).keys()], [], 'their keys are gone');

  const log = await all(l);
  const told = log.find((e) => e.id === made.said)!;
  assert.ok('$h' in (told.reason as never) && '$h' in (told.authority as { basis: never }).basis, 'the reason chosen is forgotten');
  assert.equal(log[0].reason, 'test', 'the others stay');
  assert.deepEqual(log.at(-1)!.facts, [['+', made.sam, 'forgotten', true]]);
  assert.equal(log.at(-1)!.id, forgot.changeset);
  assert.ok(!JSON.stringify(log).includes('Quill') && !JSON.stringify(log).includes('Salary'));
  assert.ok(head !== after.head);

  // The held change that asked to forget Sam touched Sam: it leaves the queue, its ops with it.
  const { rows: held } = await l.db.query<{ status: string; ops: unknown[] }>(`select status, ops from proposal where id = $1`, [(asked as { proposal: string }).proposal]);
  assert.deepEqual(held[0], { status: 'superseded', ops: [] });
  await assert.rejects(undo(l, human, { changeset: forgot.changeset }), /cannot be undone/);
});

test('a forgotten item is gone from every read', async () => {
  const l = await fresh();
  const made = await setup(l);
  const picture = Buffer.from('a picture of Sam');
  await l.db.query(`insert into picture (entity_id, content_type, bytes, size) values ($1, 'image/png', $2, $3)`, [made.sam, picture, picture.length]);
  await make(l, [{ op: 'forget', id: made.sam, reasons: (await mentions(l.db, made.sam)).map((m) => m.id) }]);

  assert.equal(await l.entity(made.sam), undefined);
  await assert.rejects(l.get(made.sam));
  assert.deepEqual(await l.search({ q: 'Quill' }), []);
  assert.deepEqual(await l.search({ q: 'Salary' }), []);
  const task = (await l.get(made.t)) as { entity: { owner: string | null }; outgoing: { type: string }[] };
  assert.equal(task.entity.owner, null, 'what it owned is owned by no one');
  assert.deepEqual(task.outgoing.map((r) => r.type), ['part_of'], 'its links are gone with it');
  const tables = JSON.stringify((await l.db.query(`select (select jsonb_agg(e) from event e) as events, (select jsonb_agg(p) from proposal p) as proposals, (select count(*) from picture) as pictures`)).rows);
  assert.ok(!tables.includes('Quill') && !tables.includes('Salary'), 'not in the events, proposals or pictures');
  assert.ok(tables.includes('"pictures":0'));

  // The fact stream replays into the rows the map has: the forgotten item and its links nowhere.
  const { live, replay } = await replayed(l);
  assert.deepEqual(replay.items, live.items);
  assert.deepEqual(replay.links, live.links);
  assert.equal((replay.items as { id: string; owner: string | null }[]).find((i) => i.id === made.t)!.owner, null);
});

test('a backup taken before a forget cannot bring the item back', async () => {
  const l = await fresh();
  const made = await setup(l);
  const vaultThen = await dumpVault(l.db);
  const before = JSON.parse(JSON.stringify(await dump(l.db, { id: 'default', name: 'Default' })));
  assert.equal(before.format, 3);
  assert.ok(!JSON.stringify(before).includes('Quill') && !JSON.stringify(vaultThen).includes('Quill'), 'the file holds no words, and its keys are wrapped');
  await make(l, [{ op: 'forget', id: made.sam, reasons: [made.said] }]);

  // Restored with the vault as it is now: what was forgotten has no key, and stays out.
  const now = new Archipelago(await openDb(), l.registry);
  await restore(now.db, { ...before, vault: await dumpVault(l.db) });
  assert.equal(await now.entity(made.sam), undefined);
  assert.equal((await now.entity(made.t))!.title, 'Offer letter', 'the rest comes back whole');
  assert.equal((await now.entity(made.t))!.owner, null);
  assert.ok(!JSON.stringify((await now.db.query(`select * from entity, relation, event`)).rows).includes('Quill'));
  assert.deepEqual((await verify(now.db)).problems, [], 'its log comes with it, and verifies');

  // Without a vault it cannot be read at all; with the vault of before it can: the vault's backups bound the window.
  await assert.rejects(restore((await openDb()) as never, before), /give the backup of the key vault/);
  const then = new Archipelago(await openDb(), l.registry);
  await restore(then.db, { ...before, vault: vaultThen });
  assert.equal((await then.entity(made.sam))!.title, 'Sam Quill');

  // The vault's backups are kept 30 days, then deleted.
  const dir = mkdtempSync(join(tmpdir(), 'pelago-vault-'));
  writeFileSync(join(dir, '2026-09-01T00-00-00.000Z.json.gz'), '');
  backupVault(dir, vaultThen, Date.parse('2026-10-24T00:00:00Z'));
  assert.deepEqual(readdirSync(dir).filter((f) => f.startsWith('2026-09')), []);
});
