// The compacted streams keep the fact stream's guarantees (docs/log.md, sections 4 and 5): what is someone's words is
// sealed with its item's key and opened on the way out, a member reads only the entries about what they may see, a
// forget puts what the item's keys sealed as its digests through the compaction role with every segment still
// verifying, and a backup carries the streams with the vault.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fresh, make } from './map.ts';
import { dump, restore } from '../src/backup.ts';
import { openDb } from '../src/db.ts';
import { verify } from '../src/log.ts';
import { Archipelago } from '../src/pelago.ts';
import { isSealed } from '../src/seal.ts';
import { opEntries, readOps, seal, verifySegments } from '../src/streams.ts';
import { dumpVault } from '../src/vault.ts';

const DAY = 86_400_000;
const tomorrow = () => new Date(Date.now() + DAY);
const stored = async (l: Archipelago) => JSON.stringify((await l.db.query(`select * from log_op`)).rows);

/** A run that told a story, a held resource with words on the hold, and a reason in each. */
async function setup(l: Archipelago) {
  const made = await make(l, [
    { op: 'create', ref: 'run', type: 'run', title: 'A run' },
    { op: 'create', ref: 'res', type: 'resource', title: 'The lane' },
    { op: 'create', ref: 'task', type: 'task', title: 'Hold it' },
  ]);
  await l.record('sessions', 'agent:test', [['+', made.run, 'story', [{ n: 1, said: 'Quill called' }]], ['+', made.run, 'status', 'running']], 'Quill asked for it');
  await l.claim({ kind: 'agent', name: 'test' }, { resource: made.res, holder: made.task, reason: 'Quill needs the lane', for: made.task });
  await l.record('settings', 'human:test', [['+', 'setting', 'x', 1]], 'Quill set it');
  return made;
}

test('a value about an item is sealed with its key in log_op, structure stays clear, and the reader opens it', async () => {
  const l = await fresh();
  const made = await setup(l);
  assert.ok(!(await stored(l)).includes('Quill'), 'no words in the stored streams');
  const [story] = await opEntries(l.db, 'sessions');
  assert.ok(isSealed(story.facts[0][3]) && isSealed(story.reason), 'a value and the reason, sealed');
  assert.deepEqual(story.facts[1], ['+', made.run, 'status', 'running'], 'structure stays clear');
  const [hold] = await opEntries(l.db, 'claims');
  const link = hold.facts.find((f) => f[2] === 'link')!;
  assert.deepEqual((link[3] as string[]).slice(1), [made.task, made.res], "a link's ends stay clear");
  assert.ok(isSealed(hold.facts.find((f) => f[2] === 'for')![3]) && isSealed(hold.reason), "a hold's field and reason, with the link's key");

  const [open] = await readOps(l.db, 'sessions');
  assert.deepEqual([open.facts[0][3], open.reason], [[{ n: 1, said: 'Quill called' }], 'Quill asked for it']);
  assert.equal((await readOps(l.db, 'settings'))[0].reason, 'Quill set it', "an entry about no item, with its stream's key");

  // A closed day's segment verifies with no key: it hashed each sealed value by its digest.
  assert.ok((await seal(l.db, 'default', tomorrow())).length >= 3);
  assert.deepEqual((await verifySegments(l.db)).problems, []);
});

test('a member reads only the entries about what they may see, and still appends after what they cannot', async () => {
  const l = await fresh();
  const { mine } = await make(l, [{ op: 'create', ref: 'mine', type: 'run', title: 'Mine', visibility: 'private' }]);
  await l.db.query(`update entity set private_to = 'e_owner' where id = $1`, [mine]);
  await l.record('sessions', 'agent:test', [['+', mine, 'tokens_used', 5]]);
  const theirs = l.as('e_other');
  assert.deepEqual(await opEntries(theirs.db, 'sessions'), [], 'the entry about a private item is not theirs to read');
  assert.equal((await readOps(l.as('e_owner').db, 'sessions'))[0].facts[0][3], 5, 'its owner reads it');
  const [next] = await theirs.record('sessions', 'agent:other', [['+', 'session', 'x', 1]]);
  assert.equal(next.pos, 2, 'the next position counts what they cannot see');
  assert.equal((await opEntries(theirs.db, 'sessions')).length, 1);
});

test('a forget digests what its keys sealed in log_op, through the compaction role, and every segment verifies', async () => {
  const l = await fresh();
  const made = await setup(l);
  assert.ok((await seal(l.db, 'default', tomorrow())).length >= 3);
  const bytes = (JSON.stringify([...(await opEntries(l.db, 'sessions')), ...(await opEntries(l.db, 'claims'))]).match(/"\$c":"[^"]+"/g) ?? []).map((c) => c.slice(6, -1));
  assert.ok(bytes.length >= 3);
  await make(l, [{ op: 'forget', id: made.run }]);
  await make(l, [{ op: 'forget', id: made.res }]);

  const [story] = await opEntries(l.db, 'sessions');
  assert.ok('$h' in (story.facts[0][3] as object) && '$h' in (story.reason as unknown as object), 'the value and the reason as their digests');
  assert.deepEqual(story.facts[1], ['+', made.run, 'status', 'running']);
  const [hold] = await opEntries(l.db, 'claims');
  assert.ok('$h' in (hold.facts.find((f) => f[2] === 'for')![3] as object) && '$h' in (hold.reason as unknown as object), "the hold's words go with the resource's link");
  const after = await stored(l);
  assert.deepEqual(bytes.filter((c) => after.includes(c)), [], 'the sealed bytes are dropped');
  assert.equal(typeof (await readOps(l.db, 'settings'))[0].reason, 'string', 'what is about no forgotten item stays');

  assert.deepEqual((await verifySegments(l.db)).problems, [], 'the segments still hash to what was sealed');
  assert.deepEqual((await verify(l.db)).problems, []);

  // Nobody but the compaction role changes a row, and it only to a digest.
  await assert.rejects(l.db.query(`update log_op set facts = '[]'`), /append-only/);
  await assert.rejects(l.db.transaction(async (tx) => {
    await tx.query(`set local role pelago_compactor`);
    await tx.query(`update log_op set facts = '[["+","setting","x",2]]' where stream = 'settings'`);
  }), /append-only/);
  await assert.rejects(l.db.transaction(async (tx) => {
    await tx.query(`set local role pelago_compactor`);
    await tx.query(`update log_op set head = head || '{"reason": "rewritten"}' where stream = 'settings'`);
  }), /append-only/);
});

test('a backup carries the compacted streams sealed, and a restore with the vault reads and verifies them', async () => {
  const l = await fresh();
  await setup(l);
  await seal(l.db, 'default', tomorrow());
  const file = JSON.parse(JSON.stringify(await dump(l.db, { id: 'default', name: 'Default' })));
  assert.equal(file.tables.log_op.length, (await l.db.query(`select 1 from log_op`)).rows.length);
  assert.ok(!JSON.stringify(file.tables.log_op).includes('Quill'), 'sealed in the file as in the log');

  const there = new Archipelago(await openDb(), l.registry);
  file.tables.log_op.reverse(); // as a forget leaves rows on disk, out of their order: a restore puts them back in it
  await restore(there.db, { ...file, vault: await dumpVault(l.db) });
  assert.deepEqual((await verifySegments(there.db)).problems, []);
  assert.equal((await readOps(there.db, 'sessions'))[0].reason, 'Quill asked for it', 'opened with the vault that came with it');
  await assert.rejects(there.db.query(`delete from log_op`), /append-only/);
});
