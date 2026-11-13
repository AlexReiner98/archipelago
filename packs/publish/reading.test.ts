// The publish pack's reading part, tested without a database: how a note names what the document knows. Its marks, checked
// as the host checks them, are in test/reading-part.test.ts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { named } from './parts/reading/sections.js';

test('names stand in for ids the document knows, and only those', () => {
  const names = new Map([['e_bbbbbbbb', 'A [name]']]);
  assert.equal(named('e_bbbbbbbb e_zzzzzzzz', names), '[A name](e_bbbbbbbb) e_zzzzzzzz');
});
