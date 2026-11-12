// The styles pack checks a published page's stylesheet with its own copy of the walls' check (a pack imports nothing of
// the kernel): the two answer alike, sheet by sheet.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cssProblem } from '../src/css-check.ts';
import { cssProblem as packs } from '../packs/styles/kernel/page-css.ts';

const SHEETS = [
  'a { color: red }', '@import url(x);', 'a { background: url(x) }', ':root { --x: 1 }', 'a:has(b) { color: red }', '> a { }',
  'a { content: "x" }', 'a { }}', 'a {', '/* @import */ a { }', 'a { b: image-set(x) }', 'a, + b { }', '@font-face { }', 'a & b { }',
];

test("the styles pack's check of page_css is the walls' own", () => {
  for (const sheet of SHEETS) for (const page of [true, false]) assert.equal(packs(sheet, page), cssProblem(sheet, page), `${sheet} (${page ? 'page' : 'drawing'})`);
});
