// The structure guard: a check's known breaks rising stops the sync and names it; falling, new or gone does not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { risen, rose } from './guard.ts';
import type { Held } from './plan.ts';

const check = (name: string, breaks: number) => ({ key: `check:${name}`, type: 'anatomy.principle', title: name, body: '', props: { check: name, breaks } });
const held = (name: string, breaks: number): [string, Held] => [`check:${name}`, { id: `e_${name}`, type: 'anatomy.principle', title: name, body: '', props: { island: 'isl', check: name, breaks } }];
const island = { byKey: new Map([held('no file over 500 lines', 3), held('the kernel names no pack', 0), held('gone', 2)]) };

test('a count that rises stops the sync and names its check', () => {
  const want = { items: [check('no file over 500 lines', 4), check('the kernel names no pack', 1)], links: [] };
  assert.deepEqual(risen(want, island), [{ check: 'no file over 500 lines', was: 3, now: 4 }, { check: 'the kernel names no pack', was: 0, now: 1 }]);
  assert.match(rose(risen(want, island)), /"no file over 500 lines" rose from 3 to 4.*--force/);
});

test('a count that falls or stays, a new check and one gone let it go on', () => {
  const want = { items: [check('no file over 500 lines', 2), check('the kernel names no pack', 0), check('a new rule', 5), { key: 'module:a.ts', type: 'anatomy.module', title: 'a', body: '', props: { breaks: 9 } }], links: [] };
  assert.deepEqual(risen(want, island), []);
});
