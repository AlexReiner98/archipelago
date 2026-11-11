// A step's name cut to fit (packs/canvas/layouts/flow/lines.js), without a database: the start a cut keeps is found by
// halving (task e_e2qv3dsh), and is the one a cut a character at a time from the end found, in far fewer measures.
import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error A drawing's module is plain JavaScript, typed by nothing.
import { cut, lines, longest } from '../packs/canvas/layouts/flow/lines.js';

/** How wide a text is, near enough to a face: each character its own width, by what it is. */
const widthOf = (text: string) => [...text].reduce((w, c) => w + (/[il.,' ]/.test(c) ? 3 : /[mwMW…]/.test(c) ? 11 : /[A-Z]/.test(c) ? 8 : 6.5), 0);
const counted = () => {
  const seen: string[] = [];
  return { seen, measure: (t: string) => (seen.push(t), widthOf(t)) };
};

/** The cut and the lines as they were before halving: a character, or a word, at a time. */
function cutBefore(text: string, width: number, measure: (t: string) => number) {
  if (measure(text) <= width) return text;
  let t = text;
  while (t.length > 1 && measure(`${t}…`) > width) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}
function linesBefore(text: string, width: number, measure: (t: string) => number) {
  const said = String(text ?? '').trim();
  if (measure(said) <= width) return [said];
  const words = said.split(/\s+/);
  let first = '', n = 0;
  for (; n < words.length; n++) {
    const next = first ? `${first} ${words[n]}` : words[n];
    if (measure(next) > width) break;
    first = next;
  }
  if (!first) return [cutBefore(words[0], width, measure), ...(words.length > 1 ? [cutBefore(words.slice(1).join(' '), width, measure)] : [])];
  return [first, cutBefore(words.slice(n).join(' '), width, measure)];
}

// Names of every length, words of every length, some a single word wider than any line.
const WORDS = ['a', 'map', 'island', 'Wire', 'placement', 'is', 'Supercalifragilisticexpialidocious', 'of', 'the', 'MMMMWWWW', 'findings', 'reads'];
let seed = 7;
const next = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648);
const names = Array.from({ length: 400 }, () => Array.from({ length: 1 + Math.floor(next() * 14) }, () => WORDS[Math.floor(next() * WORDS.length)]).join(next() < 0.1 ? '  ' : ' '));

test('a cut keeps the start a cut from the end kept, at every width', () => {
  for (const name of names) for (const width of [4, 20, 60, 120, 240, 1000]) assert.equal(cut(name, width, widthOf), cutBefore(name, width, widthOf), `${name} at ${width}`);
});

test('a name falls into the lines it fell into a word at a time', () => {
  for (const name of names) for (const width of [10, 50, 90, 160, 400]) assert.deepEqual(lines(name, width, widthOf), linesBefore(name, width, widthOf), `${name} at ${width}`);
});

test('the longest start is one character at the least, the whole where it all fits', () => {
  assert.equal(longest('Wire placement', () => false), 'W');
  assert.equal(longest('Wire placement', () => true), 'Wire placement');
  assert.equal(longest('Wire placement', (t: string) => widthOf(t) <= 40), 'Wire');
});

test('a long name cut short is measured some ten times, not once for every character it loses', () => {
  const name = 'A view of a few hundred findings that each read a published value from another island';
  const now = counted(), before = counted();
  assert.equal(cut(name, 50, now.measure), cutBefore(name, 50, before.measure));
  assert.ok(before.seen.length > 70, `${before.seen.length} before`);
  assert.ok(now.seen.length <= 9, `${now.seen.length} now`);
});
