// An island's shore lists what it stands by (task e_p27ddjqt): each finding the answer's `islands` give it as published,
// one line under its name before its legend (the claim, its value, how sure only when less than sure, as of, how many
// read it), cut to what the style lets it take, a link to the finding with its whole line as a tip.

import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8'));
const house = { ...pack.styles.find((s: any) => s.id === 'core.house').props, shape: 'flow' };
const laid = mkdtempSync(join(tmpdir(), 'pelago-flow-shore-'));
for (const [name, file] of Object.entries(pack.layouts.find((d: any) => d.id === 'core.map').modules)) copyFileSync(join(import.meta.dirname, file as string), join(laid, name));
const { picture } = await import(pathToFileURL(join(laid, 'index.js')).href);
const { findingSaid } = await import(pathToFileURL(join(laid, 'islands.js')).href);
const measure = (t: string, px: number) => t.length * px * 0.55;
const state = { blocked: false, waits_on: [], sessions: 0, needs_you: false };
const item = (id: string, title: string, island: string) => ({ id, type: 'task', is: ['work'], title, open: true, status: 'todo', state, island });

test('a finding on the shore says its claim, value, how sure when unsure, as of and readers', () => {
  assert.equal(findingSaid({ title: 'Peak load is 42 kW', value: '42 kW', confidence: 1, as_of: '2026-11-05', readers: 2 }), 'Peak load is 42 kW · 42 kW · 5 Nov · ⇠2');
  assert.equal(findingSaid({ title: 'Hosting costs 400', value: '400 EUR', confidence: 0.7, readers: 0 }), 'Hosting costs 400 · 400 EUR · 70% · ⇠0');
});

test("an island's published findings are links on its shore, before its legend", () => {
  const long = 'A claim far too long to stand on a shore whole, so it is cut where the style says and kept whole in its tip';
  const answer = {
    items: [item('e_roofzzzz', 'Roof the shed', 'e_islezzzz'), item('e_wallzzzz', 'Walls', 'e_islezzzz')],
    links: [{ type: 'depends_on', from: 'e_roofzzzz', to: 'e_wallzzzz' }],
    islands: [{ id: 'e_islezzzz', title: 'Build', findings: [{ id: 'e_findzzzz', title: 'Walls stand 3 m', value: '3 m', confidence: 1, as_of: '2026-11-05', readers: 1 }, { id: 'e_longzzzz', title: long, value: 'x', confidence: 1, readers: 0 }], findings_more: 2 }],
  };
  const scene = picture({ answer, style: house, reduced: true }, { measure, patch: () => {}, frame: () => Promise.resolve(0), open: () => {} }).scene;
  const links: { href: string; text: string }[] = [];
  // A mark is [tag, attrs, ...kids]: the words are its text kids'.
  const texts = (m: any): string[] => (typeof m === 'string' ? [m] : Array.isArray(m) ? (typeof m[0] === 'string' && m[1] && typeof m[1] === 'object' && !Array.isArray(m[1]) ? m.slice(2) : m).flatMap(texts) : []);
  const walk = (m: any) => {
    if (!Array.isArray(m)) return;
    if (m[0] === 'a' && /^#\/e\/e_(find|long|isle)/.test(m[1]?.href ?? '') && JSON.stringify(m).includes('lf-island-finding')) links.push({ href: m[1].href, text: texts(m).join(' ') });
    m.forEach(walk);
  };
  walk(scene.svg);
  assert.deepEqual(links.map((l) => l.href), ['#/e/e_findzzzz', '#/e/e_longzzzz', '#/e/e_islezzzz'], JSON.stringify(links));
  assert.match(links[0].text, /Walls stand 3 m · 3 m · 5 Nov · ⇠1/);
  assert.match(links[1].text, /… · x · ⇠0$/, 'a long claim is cut, what follows it kept');
  assert.match(links[2].text, /2 more published/);
});
