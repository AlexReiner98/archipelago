// What one request leaves for the next is kept in the workspace's database, so another server can answer the next.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { openDb } from '../src/db.ts';
import { GithubApp } from '../src/github-app.ts';
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

test('a GitHub sign-up begun on one server is finished on another, once', async () => {
  const db = await openDb();
  const asked: string[] = [];
  const store = async (workspace: string) => (asked.push(workspace), db);
  const options = { origin: 'https://map.test', api: 'http://127.0.0.1:9', web: 'https://github.test', store };
  const one = new GithubApp(options);
  const url = await one.startCreate('acme');
  const state = new URL(url).searchParams.get('state')!;
  assert.match(state, /^acme\./, 'the state names its workspace, whose database keeps it');
  const other = new GithubApp(options);
  assert.match(await other.createPage(state), /settings\/apps\/new\?state=/, 'another server knows it');
  await assert.rejects(other.createPage('acme.guessed'), /not started from Archipelago/);
  // The code exchange fails (nothing answers at the api address), but only after the state is taken: it cannot be used twice.
  await assert.rejects(other.created('code', state));
  await assert.rejects(one.created('code', state), /not started from Archipelago/);
  assert.ok(asked.every((w) => w === 'acme'));
});
