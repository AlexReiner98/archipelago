// Where an agent points the screen, and the steps it takes, reach a page that polls another server.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDb } from '../src/db.ts';
import * as one from '../src/presence.ts';

// The module loaded a second time is a second server: its own process, the same database.
const other: typeof one = await import(`${new URL('../src/presence.ts', import.meta.url).href}?other`);

test('a show on one server moves a page polling another; read steps follow within a flush', async () => {
  const db = await openDb();
  const w = { workspace: 'default', viewer: 'e_owner000' };
  assert.deepEqual(await other.presence(db, w), { focus: undefined, steps: [], told: 0, listening: 0 });

  await one.point(db, w, { at: 1, hash: 'e/e_x', actor: 'robot', note: 'Look' });
  await one.took(db, w, { kind: 'show', actor: 'robot', did: 'Look', hash: 'e/e_x' }, true);
  const seen = await other.presence(db, w);
  assert.equal(seen.focus?.hash, 'e/e_x', 'the other server knows where the screen was pointed');
  assert.deepEqual(seen.steps.map((s) => s.kind), ['show']);

  await one.took(db, w, { kind: 'read', actor: 'robot', did: 'is reading this' });
  assert.equal((await one.presence(db, w)).steps.length, 2, 'the server that took it sees it at once');
  assert.equal((await other.presence(db, w)).steps.length, 1, 'a read waits for the flush: no write per call');
  await one.flushAll();
  assert.deepEqual((await other.presence(db, w)).steps.map((s) => s.kind), ['show', 'read']);

  await other.took(db, w, { kind: 'search', actor: 'robot' }, true);
  assert.deepEqual((await one.presence(db, w)).steps.map((s) => s.kind), ['show', 'read', 'search'], 'both servers\' steps, in order');
  assert.deepEqual((await one.presence(db, { workspace: 'default', viewer: 'e_someone' })).steps, [], 'another person\'s screen is not this one');

  await other.tellStamp(db, 'default');
  assert.ok((await one.presence(db, w)).told > 0, 'a beat told on one server moves the stamp on the other');
});

test('agents listening on two servers are counted on both', async () => {
  const db = await openDb();
  const w = { workspace: 'default' };
  await one.listening(db, 'default', 1);
  await other.listening(db, 'default', 1);
  await other.listening(db, 'default', 1);
  assert.equal((await one.presence(db, w)).listening, 3);
  assert.equal((await other.presence(db, { workspace: 'elsewhere' })).listening, 0, 'another workspace hears none of them');
  await other.listening(db, 'default', -1);
  await one.listening(db, 'default', -1);
  assert.equal((await other.presence(db, w)).listening, 1);
  await other.listening(db, 'default', -1);
  assert.equal((await one.presence(db, w)).listening, 0);
});

test('a show says how many of the owner\'s pages are open and how many follow it, on any server', async () => {
  const db = await openDb();
  const w = { workspace: 'default', viewer: 'e_owner111' };
  assert.deepEqual(await one.watching(db, w), { open: 0, following: 0 });
  await one.looked(db, w, { page: 'p1', on: false });
  assert.deepEqual(await one.watching(db, w), { open: 1, following: 0 }, 'a page whose tabs follow nobody is open, and takes no show');
  await other.looked(db, w, { page: 'p2', on: true });
  assert.deepEqual(await one.watching(db, w), { open: 2, following: 1 }, 'a page on another server counts');
  assert.deepEqual(await one.watching(db, { workspace: 'default', viewer: 'e_someone' }), { open: 0, following: 0 }, 'another person\'s pages are not these');
});
