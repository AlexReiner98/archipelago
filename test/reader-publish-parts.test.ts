// The reader's page part (packs/publish/parts/doc) and a product's public page part (packs/publish/parts/public): page
// data in, the marks they answer with out, each checked as the host checks them (packs/walls/page/part-check.js),
// held to the marks their pack entries name.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import doc from '../packs/publish/parts/doc/index.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import publicPage from '../packs/publish/parts/public/index.js';
// @ts-ignore: a module of the page, plain JavaScript
import { checkMarks } from '../packs/walls/page/part-check.js';

const kindsOf = (file: string, id: string) => JSON.parse(readFileSync(new URL(file, import.meta.url), 'utf8')).parts.find((p: { id: string }) => p.id === id).marks;
const docKinds = kindsOf('../packs/publish/pack.json', 'publish.doc');
const publicKinds = kindsOf('../packs/publish/pack.json', 'publish.public');
/** Every mark of a kind, through the tree. */
const all = (m: any, kind: string): any[] => (Array.isArray(m) ? [...(m[0] === kind ? [m] : []), ...m.slice(1).flatMap((k: unknown) => all(k, kind))] : []);
const words = (m: any): string[] => all(m, 'text').map((t) => t[t.length - 1]);

const page = {
  title: 'A guide',
  published_at: '2026-11-01T10:00:00Z',
  parts: [
    { text: 'Start at e_bbbbbbbb, then read [the other](e_dddddddd).' },
    { section: { id: 'e_bbbbbbbb', title: 'Where it stands', body: 'A section note.' } },
    { section: { id: 'e_cccccccc', title: 'A figure', body: '', picture: true } },
    { section: { id: 'e_eeeeeeee', title: 'Shared picture', body: '', picture: true } },
  ],
  share: 'e_eeeeeeee',
  lenses: { e_bbbbbbbb: { items: [{ id: 'e_ffffffff', title: 'A task', type: 'task', status: 'doing', gist: 'Its first line.' }], style: {} } },
  types: { task: 'Task' },
  links: { e_dddddddd: 'Another page' },
  start: 'Start a map of your own',
};
const at = { published: true, frozen: true };

test("a document's page: its heading, its text, each section with its picture, and the style's share left out", () => {
  const part = doc({ page, at });
  checkMarks(part.marks, { kinds: docKinds });
  assert.equal(part.title, 'A guide');
  assert.ok(words(part.marks).includes('A guide'));
  assert.ok(words(part.marks).some((w) => w.startsWith('Published ')));
  assert.equal(all(part.marks, 'note')[0][2], 'Start at [Where it stands](e_bbbbbbbb), then read [the other](e_dddddddd).', 'a bare id reads as its name, a named link as it is');
  assert.deepEqual(all(part.marks, 'picture').map((p) => p[1].item), ['e_bbbbbbbb', 'e_cccccccc'], 'a lens and a figure are pictures; the shared picture is not on the page');
  assert.ok(!words(part.marks).includes('Start a map of your own'), 'what is around the page as it is served is the host’s');
});

test('run as the page is published, it keeps the sheet of every item its pictures froze', () => {
  const part = doc({ page, at });
  assert.deepEqual(Object.keys(part.sheets), ['e_ffffffff']);
  checkMarks(part.sheets.e_ffffffff, { kinds: docKinds });
  assert.ok(words(part.sheets.e_ffffffff).includes('A task'));
  assert.equal(doc({ page, at: { own: true } }).sheets, undefined, 'drawn in a browser, it opens them as asked');
});

test('an invoice has its own head', () => {
  const invoice = { ...page, title: 'Invoice 7: work', head: 'invoice', status: 'paid', fields: { number: 'INV-7', issued: '2026-11-01', total: 100, paid: 100 } };
  const part = doc({ page: invoice, at });
  checkMarks(part.marks, { kinds: docKinds });
  assert.equal(part.title, 'INV-7 work');
  assert.ok(words(part.marks).includes('Invoice') && words(part.marks).includes('Paid') && words(part.marks).includes('Total'));
});

test('an item a picture shows opens read only beside the page, and closes', () => {
  const part = doc({ page, at });
  const open = part.on({ name: 'open', item: 'e_ffffffff' });
  checkMarks(open, { kinds: docKinds });
  assert.ok(words(open).includes('A task') && words(open).includes('Task · doing'));
  assert.ok(all(open, 'note').some((n) => n[2] === 'Its first line.'));
  assert.equal(part.on({ name: 'open', item: 'e_zzzzzzzz' }), undefined, 'what no picture froze does not open');
  assert.ok(!words(part.on({ name: 'press', key: 'close' })).includes('A task'));
  assert.equal(doc({ page, at: { own: true } }).on({ name: 'open', item: 'e_ffffffff' }), undefined, 'read with a sign-in, a part opens in the app instead');
});

test('a page with nothing to read says so', () => {
  assert.equal(checkMarks(doc({}).marks, { kinds: docKinds }).mark, 'text');
});

const product = {
  title: 'Shadow',
  build: 'b2',
  builds: ['b2', 'b1'],
  counts: { questions: 1, answered: 0, tests: 2, passed: 1, failed: 1 },
  questions: [
    {
      id: 'q1',
      title: 'Is the sun right?',
      total: 2,
      passed: 1,
      failed: 1,
      tests: [
        { title: 'Noon', written: true, result: { passed: true, value: '0.1°', picture: 'e_gggggggg' }, tolerance: '< 1°' },
        { title: 'Dusk', written: true, result: { passed: false } },
      ],
    },
  ],
  changelog: [{ title: 'Shadows', status: 'shipped', at: '2026-11-01T10:00:00Z', release: { title: 'First', version: '1.0' } }],
};

test("a product's page kept for its reader has every question open", () => {
  const marks = publicPage({ page: product, at: { frozen: true } }).marks;
  checkMarks(marks, { kinds: publicKinds });
  assert.deepEqual(all(marks, 'picture').map((p) => p[1].item), ['e_gggggggg']);
});

test("a product's page: how we know, folded, its tests open with their pictures and marks, and its changelog", () => {
  const part = publicPage({ page: product });
  checkMarks(part.marks, { kinds: publicKinds });
  assert.equal(part.title, 'Shadow: how we know');
  assert.ok(words(part.marks).includes('How we know') && words(part.marks).includes('Changelog') && words(part.marks).includes('0/1 answered'));
  assert.deepEqual(all(part.marks, 'input').map((i) => i[1].values), [['b2', 'b1']], 'a page of several builds offers each');
  assert.equal(all(part.marks, 'picture').length, 0, 'folded, a question shows no tests');
  const open = part.on({ name: 'press', key: 'open:q1' });
  checkMarks(open, { kinds: publicKinds });
  assert.deepEqual(all(open, 'picture').map((p) => p[1].item), ['e_gggggggg']);
  assert.ok(words(open).includes('0.1°') && words(open).includes('failed') && words(open).includes('no image'));
});

test('a product with nothing public says so', () => {
  const empty = publicPage({ page: { ...product, questions: [], changelog: [] } }).marks;
  checkMarks(empty, { kinds: publicKinds });
  assert.ok(words(empty).includes('Nothing is public here yet.'));
  assert.equal(checkMarks(publicPage({}).marks, { kinds: publicKinds }).mark, 'text');
});
