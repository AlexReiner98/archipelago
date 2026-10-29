// The meters drawing (draw/meters/): the usage view's answer in, marks out. A band for each limit with its number
// and a bar filled to its share; storage's shares in the bar, each named in the key; every other part a row in a list
// under its bar, leading to its item's page where it stands for one, and what the reader cannot see untitled.

import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8'));
const laid = mkdtempSync(join(tmpdir(), 'meters-'));
for (const [name, file] of Object.entries(pack.drawings.find((d: any) => d.id === 'plan.meters').modules as Record<string, string>)) copyFileSync(join(import.meta.dirname, file), join(laid, name));
const { picture } = await import(pathToFileURL(join(laid, 'index.js')).href);

const marks = (mark: any): any[] => (Array.isArray(mark) && typeof mark[0] === 'string' ? [mark, ...mark.slice(2).flatMap(marks)] : []);
const limit = (name: string, use: Record<string, unknown>) => ({ id: `use:${name}`, kind: 'record', type: 'usage', title: name, open: true, status: 'within', use: { as: 'limit', ...use } });
const part = (id: string, to: string, title: string, use: Record<string, unknown>) => [{ id, kind: 'record', type: 'usage', title, open: true, status: 'within', use }, { id: `u_${id}`, type: 'part_of', from: id, to: `use:${to}`, props: {} }];

test('a band for each limit: its number, a bar filled to its share, its shares in the key and its rows in lists', () => {
  const pieces = [
    part('use:storage:log_fact', 'storage', 'Facts', { as: 'share', used: 300e6, shown: '300 MB', share: 0.6 }),
    part('use:storage:picture', 'storage', 'Images', { as: 'share', used: 50e6, shown: '50 MB', share: 0.1 }),
    part('use:storage:item:e_aaaa0000', 'storage', 'The landing page', { as: 'row', list: 'Largest items', used: 4e6, shown: '4 MB', share: 0.5, item: 'e_aaaa0000' }),
    part('use:storage:hidden', 'storage', 'Items you cannot see', { as: 'row', list: 'Largest items', used: 2e6, shown: '2 MB', share: 0.25 }),
    part('use:sessions:e_bbbb0000', 'sessions', 'Iona', { as: 'row', list: 'At work', used: 1, shown: '1', share: 0.2, item: 'e_bbbb0000' }),
  ];
  const answer = {
    plan: 'Solo',
    as_of: '2026-10-29T12:00:00.000Z',
    items: [limit('storage', { used: 350e6, shown: '350 MB', of: 500e6, of_shown: '500 MB', share: 0.7 }), limit('sessions', { used: 5, shown: '5', of: 5, of_shown: '5 agent sessions at once', share: 1, near: true, over: true }), ...pieces.map((p) => p[0])],
    links: pieces.map((p) => p[1]),
  };
  const { scene } = picture({ answer, style: { hues: ['#2e7d4f', '#2f5fb3'] } });
  const all = marks(scene.svg);
  const bands = all.filter((x) => /\bmt-band\b/.test(x[1].class ?? ''));
  assert.deepEqual(bands.map((b) => b[1].key), ['l:use:storage', 'l:use:sessions']);
  assert.match(bands[1][1].class, /\bover\b/, 'at the limit, said by its band');
  assert.equal(all.find((x) => x[1].key === 's:use:storage:log_fact')[1].width, '600', 'a share is as wide as its share of the allowance');
  assert.equal(all.find((x) => x[1].key === 's:use:storage:picture')[1].x, '600', 'shares follow one another');
  assert.deepEqual(scene.key.map((k: any) => k.label), ['Facts · 300 MB', 'Images · 50 MB']);
  const row = all.find((x) => x[1].key === 'r:use:storage:item:e_aaaa0000');
  assert.equal(row[0], 'a');
  assert.equal(row[1].href, '#/e/e_aaaa0000', 'a part that stands for an item opens its page');
  const hidden = all.find((x) => x[1].key === 'r:use:storage:hidden');
  assert.equal(hidden[0], 'div', 'what the reader cannot see leads nowhere');
  assert.match(hidden[1].class, /hidden-part/);
  assert.ok(all.some((x) => x[1].class === 'mt-list-head' && x[2] === 'At work'));
  assert.match(scene.css, /\.mt-h-2e7d4f \{ --mt-hue: #2e7d4f; \}/);
});

test('with no limits there is no allowance, and with no limits to draw it says so', () => {
  const { scene } = picture({ answer: { plan: null, items: [limit('storage', { used: 10e6, shown: '10 MB', share: 1 })], links: [] }, style: {} });
  const all = marks(scene.svg);
  assert.ok(all.some((x) => x[0] === 'strong' && x[2] === '10 MB'));
  assert.ok(!JSON.stringify(scene.svg).includes(' of '), 'no "of" where nothing is allowed');
  assert.ok(all.some((x) => x[2] === 'No plan limits'));
  assert.ok(picture({ answer: { items: [], links: [] }, style: {} }).scene.message);
});
