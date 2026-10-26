// npm run principles: the facts in code read in by where they live, changed only when the code is, retired when gone.

import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { digestOf, principlesChange, readHere, rulesOf, testsOf, type Kept } from '../scripts/principles.ts';

test('a test is read by its name, quoted any way, and one built from a template is skipped', () => {
  const source = "test('one', () => {});\n  test(\"it's two\", async () => {});\ntest(`three`, () => {});\ntest(`four ${x}`, () => {});";
  assert.deepEqual(
    testsOf('test/x.test.ts', source).map((r) => r.key),
    ['test/x.test.ts: one', "test/x.test.ts: it's two", 'test/x.test.ts: three'],
  );
  assert.ok(testsOf('test/x.test.ts', `test('${'a'.repeat(80)}', () => {})`)[0].title.length <= 60);
});

test('what was read is made, changed when the code is, left when it is not, and retired when gone', () => {
  const read = rulesOf({ id: 'core', rules: [{ id: 'forget', then: 'hold', say: 'Forgetting is the owner’s.' }, { id: 'settle', then: 'hold', say: 'Settling is the owner’s.' }] });
  const made = principlesChange(read, [], 'e_repo');
  assert.deepEqual(made.map((o) => o.op), ['create', 'link', 'create', 'link']);

  const kept: Kept[] = [
    { id: 'e_1', type: 'software.rule', status: 'current', fields: { key: 'core/forget', digest: digestOf(read[0]) } },
    { id: 'e_2', type: 'software.rule', status: 'current', fields: { key: 'core/settle', digest: 'old' } },
    { id: 'e_3', type: 'software.rule', status: 'current', fields: { key: 'core/gone', digest: 'x' } },
    { id: 'e_4', type: 'software.test', status: 'current', fields: {} },
  ];
  assert.deepEqual(principlesChange(read, kept), [
    { op: 'update', id: 'e_2', title: read[1].title, body: read[1].body, status: 'current', props: { ...read[1].props, key: 'core/settle', digest: digestOf(read[1]) } },
    { op: 'update', id: 'e_3', status: 'retired' },
  ]);
});

test('this checkout reads in core’s rules, the kernel’s actions and its own tests', async () => {
  const read = await readHere(join(import.meta.dirname, '..'));
  const keys = new Set(read.map((r) => r.key));
  for (const key of ['core/forget', 'core/settle_said', 'report/tell', 'capture/session_start', 'test/principles.test.ts: this checkout reads in core’s rules, the kernel’s actions and its own tests']) assert.ok(keys.has(key), key);
  assert.equal(keys.size, read.length, 'every key is read once');
  const titles = read.map((r) => r.title);
  assert.deepEqual(titles.filter((t, i) => titles.indexOf(t) !== i), [], 'no title is said twice');
  assert.ok(titles.every((t) => t.length <= 60));
});
