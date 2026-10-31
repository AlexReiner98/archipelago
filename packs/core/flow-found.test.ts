// The flow drawing lights what the lens's words found (e_d9q8b5zr): where the flat answer says the text term found
// some of what is drawn and not all, those steps stay lit and the rest are dimmed. Where the words found all of it, or
// there are no words, nothing is dimmed for them.

import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8'));
const house = { ...pack.styles.find((s: any) => s.id === 'core.house').props, shape: 'flow' };
const laid = mkdtempSync(join(tmpdir(), 'flow-found-'));
for (const [name, file] of Object.entries(pack.layouts.find((d: any) => d.id === 'core.flow').modules)) copyFileSync(join(import.meta.dirname, file as string), join(laid, name));
const { picture } = await import(pathToFileURL(join(laid, 'index.js')).href);
const measure = (t: string, px: number) => t.length * px * 0.55;
const state = { blocked: false, waits_on: [], sessions: 0, needs_you: false };
const item = (id: string, title: string, why: Record<string, unknown>) => ({ id, kind: 'work', type: 'task', title, open: true, status: 'todo', state, ...why });
const draw = (items: any[]) => picture({ answer: { items, links: [{ type: 'part_of', from: 'e_roofzzzz', to: 'e_sitezzzz' }] }, style: house, reduced: true }, { measure, patch: () => {}, frame: () => Promise.resolve(0), open: () => {} }).scene;
/** The ids of the steps drawn dimmed. */
function dimmed(scene: unknown): string[] {
  const out: string[] = [];
  const walk = (m: any) => {
    if (!m || typeof m !== 'object') return;
    if (Array.isArray(m)) return m.forEach(walk);
    const cls = String(m.attrs?.class ?? m.class ?? '');
    const href = String(m.attrs?.href ?? m.href ?? '');
    if (/\blf-step\b/.test(cls) && /\bdim\b/.test(cls)) out.push(href.replace('#/e/', '') || String(m.key ?? '').slice(2));
    Object.values(m).forEach(walk);
  };
  walk(scene);
  return out.sort();
}

test("what the lens's words found among the rest is lit, the rest dimmed", () => {
  const scene = draw([
    item('e_roofzzzz', 'Roof the shed', { found: ['text'] }),
    item('e_sitezzzz', 'Site works', { step: 1 }),
    item('e_wallzzzz', 'Walls', { found: ['type'] }),
  ]);
  assert.deepEqual(dimmed(scene), ['e_sitezzzz', 'e_wallzzzz'], JSON.stringify(scene).slice(0, 400));
});

test('found by the words and another term, it is lit', () => {
  const scene = draw([item('e_roofzzzz', 'Roof the shed', { found: ['id', 'text'] }), item('e_sitezzzz', 'Site works', { found: ['id'] })]);
  assert.deepEqual(dimmed(scene), ['e_sitezzzz']);
});

test('where the words found everything drawn, or there are none, nothing is dimmed for them', () => {
  assert.deepEqual(dimmed(draw([item('e_roofzzzz', 'Roof the shed', { found: ['text'] }), item('e_sitezzzz', 'Site works', { found: ['text'] })])), []);
  assert.deepEqual(dimmed(draw([item('e_roofzzzz', 'Roof the shed', { found: ['type'] }), item('e_sitezzzz', 'Site works', { step: 1 })])), []);
});
