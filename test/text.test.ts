// The one dialect a note is written in (Rule 11, ui/text.js): read the same by the item page and the published reader,
// text in and blocks out, with no page to draw on.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
// @ts-expect-error a page's module, plain JavaScript with no types
import { readSpans, readText, ticked } from '../ui/text.js';

const NOTE = [
  'The point, in a sentence.',
  '',
  '## What to check',
  '- [ ] Reads at 16 px',
  '- [x] Drawn on a light ground',
  '- a plain point',
  '',
  '> [!WARNING]',
  '> Never a UI token.',
  '',
  '> Just a quote.',
  '',
  'Steps',
  '1. Pull',
  '2. Test',
  '',
  '```',
  'npm test',
  '```',
  '',
  'WHAT IS LEFT',
  '| Place | Paper |',
  '| --- | --: |',
  '| Faroe | 0.007 |',
].join('\n');

test('a note reads as titles, lists, checklists, callouts, code and tables', () => {
  const blocks = readText(NOTE);
  assert.deepEqual(
    blocks.map((b: { kind: string }) => b.kind),
    ['para', 'title', 'list', 'callout', 'callout', 'title', 'list', 'code', 'title', 'table'],
  );
  assert.equal(blocks[1].level, 2);
  assert.deepEqual(
    blocks[2].items.map((it: { check: boolean | null; line: number }) => [it.check, it.line]),
    [
      [false, 3],
      [true, 4],
      [null, 5],
    ],
  );
  assert.equal(blocks[3].tone, 'warning');
  assert.equal(blocks[3].blocks[0].text, 'Never a UI token.');
  assert.equal(blocks[4].tone, null);
  assert.deepEqual([blocks[5].level, blocks[5].text], [0, 'Steps']);
  assert.equal(blocks[6].ordered, true);
  assert.equal(blocks[7].text, 'npm test');
  assert.deepEqual([blocks[8].level, blocks[8].text], [0, 'WHAT IS LEFT']);
  assert.deepEqual(blocks[9].aligns, ['left', 'right']);
});

test('a sentence of its own is not a title', () => {
  assert.deepEqual(readText('A short line that ends.\nAnd goes on.').map((b: { kind: string }) => b.kind), ['para']);
});

test('ticking changes one line of the note and nothing else', () => {
  assert.deepEqual(ticked(NOTE, 3, true), { was: '- [ ] Reads at 16 px', now: '- [x] Reads at 16 px' });
  assert.deepEqual(ticked(NOTE, 4, false), { was: '- [x] Drawn on a light ground', now: '- [ ] Drawn on a light ground' });
  assert.equal(ticked(NOTE, 5, true), null);
});

test('a line reads as spans: strong, said so, code, links, pages of the site and items', () => {
  const spans = readSpans('See e_abcd1234, [the plan](e_wxyz9876), **bold** and *said* `x` and https://example.com/a, [Start here](/quickstart) or [home](/).');
  assert.deepEqual(
    spans.filter((s: { t: string }) => s.t !== 'text').map((s: { t: string; id?: string; text?: string | null; href?: string; path?: string }) => [s.t, s.id ?? s.href ?? s.path ?? s.text]),
    [
      ['item', 'e_abcd1234'],
      ['item', 'e_wxyz9876'],
      ['strong', undefined],
      ['em', undefined],
      ['code', 'x'],
      ['link', 'https://example.com/a'],
      ['page', '/quickstart'],
      ['page', '/'],
    ],
  );
});

test('the item page and the published reader read one dialect', () => {
  for (const page of ['ui/body.js', 'ui/doc.js']) {
    const code = readFileSync(page, 'utf8');
    assert.match(code, /from '\.\/text\.js'/, `${page} reads notes through ui/text.js`);
    assert.doesNotMatch(code, /TABLE_RULE|function readTable/, `${page} keeps no reader of its own`);
  }
});
