// A step's name in the flow takes two lines where one is too few, so a longer name shows whole; only where two are
// too few is the second cut with an ellipsis.

import assert from 'node:assert/strict';
import test from 'node:test';
import { lines } from './draw/flow/lines.js';

// One unit a letter: a line of 10 holds ten letters.
const measure = (t: string) => t.length;

test('a name that fits is one line', () => {
  assert.deepEqual(lines('Short name', 10, measure), ['Short name']);
});

test('a longer name goes on two lines, broken between words', () => {
  assert.deepEqual(lines('Find a repo by remote', 10, measure), ['Find a', 'repo by r…']);
  assert.deepEqual(lines('Find a repo by it', 10, measure), ['Find a', 'repo by it']);
});

test('only what two lines cannot hold is cut', () => {
  const [first, second] = lines('one two three four five six seven', 10, measure);
  assert.equal(first, 'one two');
  assert.ok(second.endsWith('…') && second.length <= 10, second);
});

test('a first word wider than a line is cut on its line, the rest after it', () => {
  assert.deepEqual(lines('Supercalifragilistic yes', 10, measure), ['Supercali…', 'yes']);
});
