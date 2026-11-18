// A piece a pack places in the band (place: "lead") reads as band lines, a label and its value each, not as a card
// under a header (task e_xvs85n4s). The page module is served by name and imports the page's own modules, so its pure
// part is read out of the file and run here: input in, lines out. How the lines look is seen in a browser.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const source = readFileSync(join(import.meta.dirname, '..', 'packs', 'sheet', 'page', 'screens.js'), 'utf8');

type Line = { field: string; label: string; value: string };
type LeadLines = (props: Record<string, unknown> | undefined, fields: string[] | undefined, name: (f: string) => string) => Line[];
const leadLines = (() => {
  const at = source.match(/export const leadLines = ([\s\S]*?\);)\n/);
  assert.ok(at, 'screens.js exports leadLines');
  return new Function(`return ${at[1].replace(/;$/, '')}`)() as LeadLines;
})();
const name = (f: string) => f.toUpperCase();

test('each field set is one line: its label and its value', () => {
  assert.deepEqual(leadLines({ branch: 'claude/x', outcome: 'Lane 7 writes them' }, ['branch', 'outcome'], name), [
    { field: 'branch', label: 'BRANCH', value: 'claude/x' },
    { field: 'outcome', label: 'OUTCOME', value: 'Lane 7 writes them' },
  ]);
});

test('a field not set has no line, and none set draws nothing', () => {
  assert.deepEqual(leadLines({ branch: '', head: null }, ['branch', 'head', 'checks'], name), []);
  assert.deepEqual(leadLines(undefined, ['branch'], name), []);
  assert.deepEqual(leadLines({ branch: 'b' }, undefined, name), []);
});

test('a value that is not words is said as words: yes or no, a list as JSON', () => {
  const lines = leadLines({ published: false, files: ['a/*', 'b/*'], n: 0 }, ['published', 'files', 'n'], name);
  assert.deepEqual(lines.map((l) => l.value), ['no', '["a/*","b/*"]', '0']);
});

test('in the band, no piece is drawn under a header', () => {
  assert.match(source, /if \(ctx\.lead\) return bandLines\(leadLines\(/, 'fields: band lines');
  assert.match(source, /ctx\.lead \? h\('div', \{ class: 'lead-piece'/, "a part's piece: no section heading");
  assert.match(source, /drawnOn\(data, piecesOn\(data\)\.filter\(\(p\) => p\.place === 'lead'[^\n]*, true\)/, 'leadsOn draws in the band');
});
