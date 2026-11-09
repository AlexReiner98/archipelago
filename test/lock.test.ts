// One test run on the machine at a time (test/lock.ts): taken, waited for, given back, and taken over from a dead run.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { holder, LOCK, lock, tryLock, unlock } from './lock.ts';

const me = { cwd: 'here', what: 'npm test' };
const folder = () => mkdtempSync(join(tmpdir(), 'pelago-lock-'));

test('a run takes the lock, a second cannot, and it is free once given back', () => {
  const temp = folder();
  assert.equal(tryLock(temp, me), true);
  assert.equal(holder(temp)?.pid, process.pid);
  assert.equal(JSON.parse(readFileSync(join(temp, LOCK), 'utf8')).what, 'npm test');
  assert.equal(tryLock(temp, me), false);
  unlock(temp);
  assert.equal(holder(temp), null);
  rmSync(temp, { recursive: true });
});

test("a dead run's lock is taken over, and another's is never given back for it", () => {
  const temp = folder();
  const dead = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' });
  writeFileSync(join(temp, LOCK), JSON.stringify({ pid: Number(dead.stdout), cwd: 'gone', what: 'npm test', started: 0 }));
  assert.equal(tryLock(temp, me), true);
  writeFileSync(join(temp, LOCK), JSON.stringify({ pid: process.ppid, cwd: 'there', what: 'npm test', started: 0 }));
  unlock(temp);
  assert.equal(holder(temp)?.cwd, 'there');
  writeFileSync(join(temp, LOCK), '{"pid":');
  assert.equal(holder(temp), null, 'a lock half written is no lock');
  rmSync(temp, { recursive: true });
});

test('a second run waits, says whose run it waits on, and goes once the first is done', async () => {
  const temp = folder();
  writeFileSync(join(temp, LOCK), JSON.stringify({ pid: process.ppid, cwd: 'C:/other', what: 'npm run test:changed', started: Date.now() }));
  const said: string[] = [];
  const waiting = lock(temp, me, 10, (s) => said.push(s));
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(said.length, 1);
  assert.match(said[0], /C:\/other \(npm run test:changed/);
  rmSync(join(temp, LOCK));
  await waiting;
  assert.equal(holder(temp)?.pid, process.pid);
  rmSync(temp, { recursive: true });
});
