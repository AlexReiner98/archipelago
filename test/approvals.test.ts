// What becomes of a change, as a table (test/approvals.ts): the rows under the server's policy as shipped, and every
// row of the fixture under a policy one of the three files checks.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkPolicy, POLICIES } from './approvals.ts';

checkPolicy('review');

test('every row of the approvals table is under a policy that is checked', () => {
  const rows = Object.keys(JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'approvals.json'), 'utf8')));
  assert.deepEqual(rows.filter((row) => !(row.split(' | ')[0] in POLICIES)), []);
  assert.deepEqual(Object.keys(POLICIES).filter((p) => !rows.some((row) => row.startsWith(`${p} | `))), [], 'every policy has its rows');
});
