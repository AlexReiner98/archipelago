// What one request leaves for the next is kept in the workspace's database, so another server can answer the next.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDb } from '../src/db.ts';
import { begin, connectAct } from '../src/server-connect.ts';
import { keep, kept, take } from '../src/transient.ts';

test('a value is kept until it runs out, and taken once', async () => {
  const db = await openDb();
  await keep(db, 'a', { n: 1 }, 60_000, Buffer.from('file'));
  assert.deepEqual(await kept(db, 'a'), { n: 1 });
  await keep(db, 'a', { n: 2 }, 60_000);
  assert.deepEqual(await kept(db, 'a'), { n: 2 }, 'kept again in place of what was there');
  assert.deepEqual(await take(db, 'a'), { value: { n: 2 } });
  assert.equal(await take(db, 'a'), undefined, 'once');
  await keep(db, 'b', 'x', 60_000, Buffer.from('file'));
  assert.equal((await take(db, 'b'))?.data?.toString(), 'file');
  await keep(db, 'gone', 'x', -1000);
  assert.equal(await kept(db, 'gone'), undefined, 'run out');
  assert.equal(await take(db, 'gone'), undefined);
});

test('a connection begun on one server is finished on another, once', async () => {
  // Every server reads the one control plane: what was begun on one is known on the next, and taken once.
  const db = await openDb();
  const pack = { id: 'acme_app', version: '1', title: 'Acme App', reach: { server: { acts: [] } } };
  const at = { has: async () => true, get: async () => { throw new Error('no workspace is reached'); }, hold: () => () => {} } as never;
  const state = await begin(db, pack.id, 'setup', 'acme');
  assert.match(state, /^acme\./, 'the state names its workspace');
  assert.deepEqual(await connectAct(at, db, pack, 'begun.get', { state }), { purpose: 'setup', workspace: 'acme' });
  await assert.rejects(connectAct(at, db, pack, 'begun.get', { state: 'acme.guessed' }), /not started from Archipelago/);
  await assert.rejects(connectAct(at, db, { ...pack, id: 'other_app' }, 'begun.get', { state }), /not started from Archipelago/, 'another pack’s word is not this one’s');
  assert.equal((await connectAct(at, db, pack, 'begun.take', { state }) as { purpose: string }).purpose, 'setup');
  await assert.rejects(connectAct(at, db, pack, 'begun.take', { state }), /not started from Archipelago/, 'once');
});
