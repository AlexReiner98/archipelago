// Test files that passed on this same code are not run again (test/passes.ts): a pass is found under its key, a key
// moves with what the file reads and with the engine, and a file keeps only its newest keys.
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { keys, passed, remember } from './passes.ts';
import { allTests } from './sets.ts';

// Two test files, taken from the list rather than named, so a change to them does not pick this test (sets.ts).
const files = allTests().slice(0, 2);
const [one] = files;

test('a file passed under its key is skipped, and only under that key', () => {
  const temp = mkdtempSync(join(tmpdir(), 'pelago-passes-'));
  const key = keys(files, 'pglite');
  assert.equal(key.size, 2);
  assert.deepEqual(passed(temp, key), [], 'nothing has passed yet');
  remember(temp, key, [one]);
  assert.deepEqual(passed(temp, key), [one]);
  assert.deepEqual(passed(temp, keys(files, 'postgres')), [], 'a pass on one engine is not one on the other');
  const moved = new Map([[one, 'other code']]);
  assert.deepEqual(passed(temp, moved), [], 'nor on other code');
  remember(temp, moved, [one]);
  assert.deepEqual(passed(temp, key), [one], 'the older pass is kept beside the newer: another worktree may be on it');
  for (let i = 0; i < 20; i++) remember(temp, new Map([[one, `code ${i}`]]), [one]);
  assert.deepEqual(passed(temp, key), [], 'a file keeps only its newest keys');
  rmSync(temp, { recursive: true });
});

test('the same code gives the same key', () => {
  const [a, b] = [keys(files, 'pglite'), keys(files, 'pglite')];
  assert.deepEqual([...a], [...b]);
  assert.notEqual(a.get(files[0]), a.get(files[1]), 'each file its own');
});
