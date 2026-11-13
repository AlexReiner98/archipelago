// The lenses pack's parts (packs/lenses/parts), run as their worker runs them: the saved_views answer in, marks the
// host's check takes out (packs/walls/page/part-check.js). Home's list of views, and what the bar's view button opens.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-ignore: a module of the page, plain JavaScript
import { checkMarks } from '../packs/walls/page/part-check.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import saved from '../packs/lenses/parts/saved.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import switcher from '../packs/lenses/parts/switch.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { lensWords } from '../packs/lenses/parts/views.js';

const pictures = [
  { lens: 'e_kept0001', title: 'Old board', life: 'kept', updated_at: '2026-11-01T00:00:00Z', filter: { find: ['type task'] }, walk: { over: [], steps: 0 } },
  { lens: 'e_kept0002', title: 'New board', life: 'kept', note: 'Work by its status', updated_at: '2026-11-10T00:00:00Z', filter: { find: ['type task'] }, walk: { over: ['part_of<'], steps: 2 } },
  { lens: 'e_work0001', title: 'An agent’s flow', life: 'working', updated_at: '2026-11-11T00:00:00Z', filter: { find: ['id e_aaaaaaaa'] } },
  { lens: 'e_docs0001', title: 'In a document', life: 'kept', document: { id: 'e_doc00001', title: 'A page' }, updated_at: '2026-11-12T00:00:00Z' },
  { lens: 'e_gone0001', title: 'Cannot draw', life: 'kept', cannot: 'its layout e_x is not on this map', updated_at: '2026-10-01T00:00:00Z' },
  { lens: 'findings.moved', title: 'Findings moved', life: 'kept', preset: true, filter: { find: ['moved'] } },
];
const words = { types: { task: { title: 'Task', open: [], closed: [] } }, links: {} };
const views = { saved_views: { pictures, more: 0 } };
const text = (m: unknown) => JSON.stringify(m);
/** The views a list names, in order. */
const named = (m: unknown): string[] => [...text(m).matchAll(/"key":"v:([^"]+)"/g)].map((x) => x[1]);

test('a view is said in words: its terms by the schema’s names, then its walk', () => {
  assert.equal(lensWords(pictures[1], words), 'Task · ← part of × 2');
  assert.equal(lensWords({ filter: { find: ['text roadmap'], only: ['type task'] }, walk: { over: 'all', steps: 1 } }, words), '“roadmap” · only type task · every link × 1');
});

test('Home’s list: the kept newest first, agents’ and the packs’ folded, a document’s left out, the view up marked', () => {
  const part = saved({ views, words, up: 'e_kept0001', piece: { title: 'Views' } });
  checkMarks(part.marks);
  assert.deepEqual(named(part.marks), ['e_kept0002', 'e_kept0001', 'e_gone0001'], 'folded views are not drawn until opened');
  assert.match(text(part.marks), /"Task · ← part of × 2"/);
  assert.match(text(part.marks), /"up"/);
  assert.match(text(part.marks), /cannot draw/);
  assert.match(text(part.marks), /\["thumb",\{"view":"e_kept0002"\}\]/, 'each row names its thumbnail; the host draws it');
  const open = part.on({ name: 'press', key: 'agents' });
  checkMarks(open);
  assert.deepEqual(named(open), ['e_kept0002', 'e_kept0001', 'e_gone0001', 'e_work0001']);
  assert.deepEqual(named(part.on({ name: 'press', key: 'packs' })).slice(-1), ['findings.moved']);
  assert.match(text(part.update({ views: { saved_views: null }, piece: {} })), /Could not read/);
});

test('the bar’s panel: Home, the kept newest first, agents’ folded; found by words, what packs ship too', () => {
  const part = switcher({ views, words, piece: { current: 'e_kept0001', home: false } });
  checkMarks(part.marks);
  assert.deepEqual(named(part.marks), ['home', 'e_kept0002', 'e_kept0001', 'e_gone0001']);
  assert.match(text(part.marks), /"tone":"accent"/, 'the view up is marked');
  const folded = part.on({ name: 'press', key: 'agents' });
  assert.ok(named(folded).includes('e_work0001'), 'agents’ views open on a press');
  const found = part.on({ key: 'find', name: 'edit', value: 'moved' });
  checkMarks(found);
  assert.deepEqual(named(found), ['findings.moved'], 'a pack’s view is found by its name, and Home is not listed while finding');
  assert.deepEqual(named(part.on({ key: 'find', name: 'edit', value: 'status' })), ['e_kept0002'], 'found by its note too');
  assert.match(text(part.on({ key: 'find', name: 'edit', value: 'zzz' })), /No view by that name/);
});

test('a view a mark names is checked: an id, a pack’s view or home, and nothing else', () => {
  checkMarks(['box', { view: 'home' }]);
  checkMarks(['box', { view: 'core.held' }, ['thumb', { view: 'e_kept0001' }]]);
  assert.throws(() => checkMarks(['box', { view: 'javascript:alert(1)' }]), /not a view's id/);
  assert.throws(() => checkMarks(['thumb', {}]), /a thumb with no view/);
  assert.throws(() => checkMarks(['thumb', { view: 'home' }, 'words']), /holding something/);
});
