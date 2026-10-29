// The pages drawing (draw/pages/): a lens answer in, pages out. Each item that nothing in the answer brings in is a
// page, its note read as blocks; a line holding only an item's id draws that item there as a section, once; an id the
// answer lacks is named, leading to its page; a note's dialect becomes marks a drawing may send.

import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

// The drawing's modules laid out by the names it imports them by, as the sandbox serves them (pack.json, drawings).
const core = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8'));
const laid = mkdtempSync(join(tmpdir(), 'pages-'));
for (const [name, file] of Object.entries(core.drawings.find((d: any) => d.id === 'core.pages').modules as Record<string, string>)) copyFileSync(join(import.meta.dirname, file), join(laid, name));
const { picture } = await import(pathToFileURL(join(laid, 'index.js')).href);

const item = (id: string, title: string, body = '', extra: Record<string, unknown> = {}) => ({ id, kind: 'record', type: 'document', title, body, open: true, status: 'draft', ...extra });
const draw = (items: any[], here?: string) => picture({ answer: { items, links: [] }, style: { here } }, {}).scene;
/** Every mark of a scene, flattened, with the text in it. */
const marks = (mark: any): any[] => (Array.isArray(mark) && typeof mark[0] === 'string' ? [mark, ...mark.slice(2).flatMap(marks)] : []);
const text = (mark: any): string => (typeof mark === 'string' ? mark : Array.isArray(mark) ? mark.slice(2).map(text).join('') : '');

test('each item nothing brings in is a page; a section is read where its line stands, and only there', () => {
  const doc = item('e_doc00000', 'Guide', 'The point first.\n\ne_sec00000\n\nAfter the section.');
  const sec = item('e_sec00000', 'Install', '## Steps\n- one\n- [x] two');
  const loose = item('e_lone0000', 'Loose note', 'Alone.');
  const scene = draw([doc, sec, loose]);
  const pages = scene.svg.slice(2);
  assert.deepEqual(pages.map((p: any) => p[1].key), ['p:e_doc00000', 'p:e_lone0000'], 'the section is not a page of its own');
  const guide = text(pages[0]);
  assert.ok(guide.indexOf('The point first.') < guide.indexOf('Install') && guide.indexOf('Install') < guide.indexOf('After the section.'), 'the section stands where its line does');
  const all = marks(pages[0]);
  assert.ok(all.some((x) => x[0] === 'a' && x[1].href === '#/e/e_sec00000'), "the section's title leads to its page");
  assert.ok(all.some((x) => x[0] === 'li' && x[1].class === 'check done'), 'a ticked line is a ticked check');
  assert.ok(all.some((x) => x[1].class === 'pg-h pg-h2' && text(x) === 'Steps'), 'a title is a title');
});

test('an id the lens did not bring is named and leads to its page; a loop is read once', () => {
  const a = item('e_aaaa0000', 'A', 'e_bbbb0000\ne_gone0000');
  const b = item('e_bbbb0000', 'B', 'e_aaaa0000');
  const scene = draw([a, b]);
  const all = marks(scene.svg);
  assert.ok(all.some((x) => x[0] === 'a' && x[1].href === '#/e/e_gone0000'), 'the missing section leads to its page');
  assert.equal(scene.svg.slice(2).length, 2, 'two notes that bring each other in are both pages');
  assert.ok(text(scene.svg).includes(' again'), 'and neither is read inside itself');
});

test('the dialect: emphasis, code, a link to an item, a table and a callout', () => {
  const doc = item('e_dial0000', 'Dialect', 'Some **strong**, *soft* and `code`, see e_sec00000.\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> [!warning] Mind this.');
  const all = marks(draw([doc, item('e_sec00000', 'Named')]).svg);
  assert.ok(all.some((x) => x[0] === 'strong' && text(x) === 'strong'));
  assert.ok(all.some((x) => x[0] === 'em' && text(x) === 'soft'));
  assert.ok(all.some((x) => x[0] === 'a' && x[1].href === '#/e/e_sec00000' && text(x) === 'Named'), 'an id in a line reads as its title');
  assert.equal(all.filter((x) => x[1].class?.startsWith('pg-row')).length, 2, 'a table, its rule line left out');
  assert.ok(all.some((x) => x[1].class === 'pg-quote warning' && text(x) === 'Mind this.'));
  // Only marks a drawing may send (ui/marks.js): HTML, no style, no script.
  const allowed = new Set(['div', 'span', 'p', 'b', 'strong', 'em', 'i', 'small', 'ul', 'ol', 'li', 'br', 'a', 'button']);
  for (const x of all) assert.ok(allowed.has(x[0]), x[0]);
  // Its stylesheet keeps to what the page takes (ui/marks.js, cssFor): no quote, backslash, & or <.
  assert.doesNotMatch(draw([doc]).css, /[\\"'&<]/);
});

test('the page open is lit and brought into sight; nothing to read says so', () => {
  const scene = draw([item('e_doc00000', 'Guide', 'Text.')], 'e_doc00000');
  assert.equal(scene.focus, 'p:e_doc00000');
  assert.match(scene.svg[2][1].class, /\bhere\b/);
  assert.ok(draw([]).message);
});
