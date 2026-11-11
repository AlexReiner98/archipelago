// The kit's model of the map (packs/canvas/layouts/kit/model.js), run as the page loads it, with no database: the order
// sorted by the links' ways. The kit's lanes, bundles and bands went with the strips layout (tag archive/layouts-2026-11-09).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { drawings, setOut } from './wired.ts';

const map = drawings.find((d) => d.id === 'core.map')!;
const house = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'packs/canvas/pack.json'), 'utf8')).styles.find((s: any) => s.id === 'core.house').props;
const measure = (text: string, px: number) => text.length * px * 0.55;
const item = (id: string, more: Record<string, unknown> = {}) => ({ id, type: 'task', title: `Step ${id}`, open: true, created_at: `2026-11-0${id.length}T00:00:${id.padStart(2, '0').slice(-2)}Z`, ...more });
const dep = (from: string, to: string) => ({ type: 'depends_on', from, to });
const args = (items: any[], links: any[]) => ({ items, links, measure, sizes: house.sizes, headless: house.headless, undrawn: house.undrawn ?? [] });
/** The map's modules, by name, as the page loads them. */
const withModules = <T>(use: (mod: (name: string) => Promise<any>) => Promise<T>) => setOut(map, (url) => use((name) => import(url(name))));

test('model: the order keeps every way, the free choice and a ring by when made, and says what runs up', () => withModules(async (mod) => {
  const { model, sorted } = await mod('model.js');
  assert.deepEqual(sorted(['c', 'b', 'a'], new Map([['b a', 3]]), (id: string) => ({ a: 2, b: 1, c: 0 })[id]), ['c', 'b', 'a']);
  assert.deepEqual(sorted(['a', 'b'], new Map([['a b', 1], ['b a', 1]]), (id: string) => (id === 'a' ? 0 : 1)), ['a', 'b'], 'a ring broken by when made');
  const m = model(args([item('a'), item('bb'), item('ccc')], [dep('bb', 'a'), dep('ccc', 'bb'), { type: 'relates_to', from: 'a', to: 'ccc' }]));
  assert.deepEqual(m.order, ['a', 'bb', 'ccc'], 'what is depended on first');
  const back = { a: 'ccc', b: 'a', type: 'relates_to' };
  assert.equal(m.against(back), true, 'a headed link from below to above runs up');
  assert.equal(m.against(m.chains[0]), false);
}));
