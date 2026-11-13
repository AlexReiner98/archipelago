// The publish pack's part on an item's menu (packs/publish/parts/share): what `shared` read of the item and the page's
// origin in, marks out, checked as the host checks them and held to the marks its pack entry names. Sharing itself is a
// person's act the part never sends (decision e_3mdf9gn8): the part only opens, copies and prints.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import share from '../packs/publish/parts/share/index.js';
// @ts-ignore: a module of the page, plain JavaScript
import { checkMarks } from '../packs/walls/page/part-check.js';

const entry = JSON.parse(readFileSync(new URL('../packs/publish/pack.json', import.meta.url), 'utf8')).parts.find((p: { id: string }) => p.id === 'publish.share');
const check = (m: unknown) => checkMarks(m, { kinds: entry.marks });
const all = (m: any, kind: string): any[] => (Array.isArray(m) ? [...(m[0] === kind ? [m] : []), ...m.slice(1).flatMap((k: unknown) => all(k, kind))] : []);
const input = (shared: unknown, origin = 'https://app.example.org') => ({ item: { id: 'e_aaaaaaaa', type: 'document' }, views: { shared }, origin });

test('it fills item.menu and reads the item’s public view, sending nothing', () => {
  assert.equal(entry.slot, 'item.menu');
  assert.deepEqual(entry.sends ?? [], [], 'sharing and taking down are a person’s own acts');
});

test('a shared document: its public view opened apart, its address to copy, and a way to print it', () => {
  const marks = share(input({ address: '/p/acme/e_aaaaaaaa', document: true })).marks;
  check(marks);
  assert.deepEqual(all(marks, 'text').map((t) => t[1].href), ['https://app.example.org/p/acme/e_aaaaaaaa', 'https://app.example.org/read/e_aaaaaaaa']);
  assert.equal(all(marks, 'button')[0][1].copy, 'https://app.example.org/p/acme/e_aaaaaaaa');
});

test('an item not shared, or not a document, offers only what it has; no origin, nothing', () => {
  const part = share(input({ document: false }));
  assert.deepEqual(part.marks, ['box', { flow: 'row', gap: 4, align: 'end' }]);
  assert.equal(all(part.update(input({ document: true })), 'text').length, 1, 'a document not shared is printed');
  assert.deepEqual(share(input({ address: '/p/acme/e_aaaaaaaa' }, 'javascript:alert(1)')).marks, ['box', {}]);
  assert.equal(all(share(input({ address: 'https://elsewhere.example/x' })).marks, 'text').length, 0, 'an address is this server’s own');
});
