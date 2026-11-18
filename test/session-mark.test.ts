// A session's mark on an item it works on (packs/runs/kernel/sessions-on.ts, task e_7csnapar): its hue by its name,
// as everywhere; how fresh it is by how long since it was heard; dormant only when it sleeps, never in a long turn.

import assert from 'node:assert/strict';
import test from 'node:test';
import { freshness, sessionOn } from '../packs/runs/kernel/sessions-on.ts';

test('the mark: hue by name, fresh by age, dormant only asleep', () => {
  const numbers = { session_fade_from: 60, session_fade_to: 1440, session_dormant_after: 240 };
  const names = ['Skye', 'Islay', 'Mull'], hues = ['#111111', '#222222'];
  const now = Date.parse('2026-11-18T12:00:00Z');
  const ago = (min: number) => new Date(now - min * 60_000).toISOString();
  const mark = (state: string, min: number, name = 'Mull') => sessionOn({ run: 'e_r', title: 'Chat', name, tokens: 5 }, { state, since: null, heard: ago(min) }, { names, hues, numbers, now });
  assert.equal(mark('working', 1).hue, '#111111', 'Mull is the third name: the first hue again');
  assert.equal(mark('working', 1, 'Islay').hue, '#222222');
  assert.equal(mark('working', 1).fresh, 1);
  assert.equal(mark('idle', 1440).fresh, 0);
  assert.equal(freshness(750, numbers), 0.5);
  assert.equal(mark('idle', 300).dormant, true, 'silent past session_dormant_after, not at work');
  assert.equal(mark('working', 300).dormant, false, 'a long turn is not asleep');
  assert.equal(mark('idle', 30).dormant, false);
  assert.equal(mark('working', 1).tokens, 5);
  assert.equal(freshness(5000, {}), 1, 'a style that names no fade leaves it fresh');
});
