// What a session is called (./session-name.ts): its name is the person's own words, never what their client added
// to the prompt (the study e_unru8ftt: a session was titled "<system-reminder>").

import assert from 'node:assert/strict';
import test from 'node:test';
import { ownWords, promptTitle, saidTitle } from './session-name.ts';

test('a prompt that opens with what its client added is named by what the person asked', () => {
  const prompt = '<system-reminder>\nCodebase and user instructions are shown below.\n</system-reminder>\n<system-reminder>Linked sessions now</system-reminder>\nFix the ring on a step\nso it says who';
  assert.equal(promptTitle(prompt), 'Fix the ring on a step');
});

test('a tag left alone is not a name', () => {
  assert.equal(promptTitle('<system-reminder>'), '');
  assert.equal(saidTitle('<system-reminder>'), '');
  assert.equal(saidTitle('  Lane 4: sessions on the canvas <br/>'), 'Lane 4: sessions on the canvas');
});

test('words that only look like a comparison are kept', () => {
  assert.equal(ownWords('a < b and c > d'), 'a < b and c > d');
  assert.equal(promptTitle('Why is 3 < 4?'), 'Why is 3 < 4?');
});
