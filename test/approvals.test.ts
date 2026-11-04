// What becomes of a change, as a table (test/approvals.ts): every row of the fixture under a policy and a setting that
// are checked, and every policy's settings checked by exactly one file (approvals-<policy>-<part>.test.ts).
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { PARTS, POLICIES, SETTINGS, settingsOf } from './approvals.ts';

const parts = Array.from({ length: PARTS }, (_, i) => i + 1);

test('every row of the approvals table is under a policy and a setting that are checked', () => {
  const rows = Object.keys(JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'approvals.json'), 'utf8')));
  assert.deepEqual(rows.filter((row) => !(row.split(' | ')[0] in POLICIES) || !(row.split(' | ')[1] in SETTINGS)), []);
  const pairs = Object.keys(POLICIES).flatMap((p) => Object.keys(SETTINGS).map((s) => `${p} | ${s} | `));
  assert.deepEqual(pairs.filter((pair) => !rows.some((row) => row.startsWith(pair))), [], 'every policy and setting has its rows');
});

test('every policy and setting is checked by exactly one part, and each part by its own file', () => {
  const dealt = parts.flatMap((part) => settingsOf(part));
  assert.deepEqual([...dealt].sort(), Object.keys(SETTINGS).sort(), 'each setting in exactly one part');
  assert.ok(parts.every((part) => settingsOf(part).length > 0), 'no part is empty');
  const files = readdirSync(import.meta.dirname).filter((f) => /^approvals-.+\.test\.ts$/.test(f)).sort();
  const wanted = Object.keys(POLICIES).flatMap((p) => parts.map((part) => `approvals-${p}-${part}.test.ts`)).sort();
  assert.deepEqual(files, wanted, 'a file for each policy and part, and no other');
  for (const f of wanted) {
    const [, p, part] = f.match(/^approvals-(.+)-(\d+)\.test\.ts$/)!;
    const calls = [...readFileSync(join(import.meta.dirname, f), 'utf8').matchAll(/checkPolicy\(([^)]*)\)/g)].map((m) => m[1]);
    assert.deepEqual(calls, [`'${p}', ${part}`], `${f} checks its own policy and part, once`);
  }
});
