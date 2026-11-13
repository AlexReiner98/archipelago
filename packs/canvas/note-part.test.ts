// The canvas pack's note part (piece.note): a screen's short note, as marks the host checks, run without a page.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-ignore: a part's module, plain JavaScript
import note from './parts/note/index.js';
// @ts-ignore: a module of the page, plain JavaScript
import { checkMarks } from '../walls/page/part-check.js';

test("a screen's note is drawn as a note mark, and nothing when it says nothing", () => {
  const made = note({ piece: { text: '## Why\nSay why.' } });
  assert.deepEqual(made.marks, ['note', {}, '## Why\nSay why.']);
  assert.equal(checkMarks(made.marks).words, '## Why\nSay why.');
  assert.deepEqual(made.update({ piece: { text: '  ' } }), ['box']);
  assert.deepEqual(note({}).marks, ['box']);
});
