// The pages drawing (draw/pages/): a lens answer in, rows out. Each item that nothing in the answer brings in is a
// row: its title leading to its page, and a reader of its draft beside one of what is published, which the page
// makes from the item's id alone (ui/reader-frame.js). An item a note brings in as a section is read there.

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

const item = (id: string, title: string, body = '') => ({ id, kind: 'record', type: 'document', title, body, open: true, status: 'draft' });
const draw = (items: any[], here?: string) => picture({ answer: { items, links: [] }, style: { here } }, {}).scene;
/** Every mark of a scene, flattened. */
const marks = (mark: any): any[] => (Array.isArray(mark) && typeof mark[0] === 'string' ? [mark, ...mark.slice(2).flatMap(marks)] : []);

test('each item nothing brings in is a row: its title, and a reader of its draft beside one of what is published', () => {
  // The section's line is far down the note: the notes come whole, so it is found.
  const doc = item('e_doc00000', 'Guide', `${'Words. '.repeat(60)}\n\ne_sec00000\n\nAfter.`);
  const scene = draw([doc, item('e_sec00000', 'Install', 'Steps.'), item('e_lone0000', 'Loose note', 'Alone.')]);
  const rows = scene.svg.slice(2);
  assert.deepEqual(rows.map((r: any) => r[1].key), ['p:e_doc00000', 'p:e_lone0000'], 'the section is read in its document, not as a row');
  const all = marks(rows[0]);
  assert.ok(all.some((x) => x[0] === 'a' && x[1].href === '#/e/e_doc00000'), 'the title leads to its page');
  assert.deepEqual(all.filter((x) => x[0] === 'reader').map((x) => [x[1].item, x[1].as]), [['e_doc00000', 'draft'], ['e_doc00000', 'published']]);
  assert.match(String(all.find((x) => x[1].class === 'pg-meta')[2]), /1 section/);
});

test('two notes that bring each other in are both rows; the page open is lit and brought into sight; nothing says so', () => {
  assert.equal(draw([item('e_aaaa0000', 'A', 'e_bbbb0000'), item('e_bbbb0000', 'B', 'e_aaaa0000')]).svg.slice(2).length, 2);
  const scene = draw([item('e_doc00000', 'Guide', 'Text.')], 'e_doc00000');
  assert.equal(scene.focus, 'p:e_doc00000');
  assert.match(scene.svg[2][1].class, /\bhere\b/);
  assert.ok(draw([]).message);
});

test('only marks a drawing may send, and a stylesheet the page takes', () => {
  const allowed = new Set(['div', 'span', 'p', 'b', 'strong', 'em', 'i', 'small', 'ul', 'ol', 'li', 'br', 'a', 'button', 'reader']);
  const scene = draw([item('e_doc00000', 'Guide', 'Text.')]);
  for (const x of marks(scene.svg)) assert.ok(allowed.has(x[0]), x[0]);
  // No quote, backslash, & or < (ui/marks.js, cssFor).
  assert.doesNotMatch(scene.css, /[\\"'&<]/);
});

test('a private document has no preview: it is read as its reader sees it, alone', () => {
  const doc = { ...item('e_mine0000', 'Notes to self', 'Text.'), visibility: 'private' };
  const readers = marks(draw([doc]).svg).filter((x) => x[0] === 'reader').map((x) => [x[1].item, x[1].as]);
  assert.deepEqual(readers, [['e_mine0000', 'own']]);
});

test('the rows are in the order a reader meets the site, however recently each changed', () => {
  const page = (id: string, title: string, body: string, fields: Record<string, unknown> = {}) => ({ ...item(id, title, body), fields });
  const scene = draw([
    // The lens gives them newest first; the order drawn is the site's own.
    page('e_zeta0000', 'Zeta, pointed at by nothing', 'Alone.'),
    page('e_deep0000', 'Deep page', 'Back to [the start](/).', { path: 'deep' }),
    page('e_alfa0000', 'Alpha, pointed at by nothing', 'Alone.'),
    page('e_tool0000', 'Tools', 'See [deep](/deep).', { path: 'tools', menu: 2 }),
    page('e_quik0000', 'Quickstart', 'Then e_prin0000.', { path: 'quickstart', menu: 1 }),
    page('e_prin0000', 'Principles', 'Read [tools](/tools).', { path: 'principles' }),
    page('e_home0000', 'Welcome', 'Start with [the quickstart](/quickstart) or [deep](/deep).', { path: 'home' }),
    // Every page ends with the footer: it is read last, and what only it points at just before what nothing does.
    page('e_foot0000', 'Footer', '[Pricing](/pricing) · [Tools](/tools)', { path: 'footer' }),
    page('e_cost0000', 'Pricing', 'Plans.', { path: 'pricing' }),
  ]);
  assert.deepEqual(
    scene.svg.slice(2).map((r: any) => r[1].key.slice(2)),
    ['e_home0000', 'e_quik0000', 'e_tool0000', 'e_deep0000', 'e_prin0000', 'e_cost0000', 'e_alfa0000', 'e_zeta0000', 'e_foot0000'],
  );
});
