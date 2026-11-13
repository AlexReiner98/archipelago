// The bar pack's part bar.query (packs/bar/parts/query), run as its worker runs it: the page's address in, marks the
// host's check takes out (packs/walls/page/part-check.js), and the lens each gesture names. Was ui/query-bar.js and the
// modules beside it (task e_yxkdcdh6).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
// @ts-ignore: a module of the page, plain JavaScript
import { checkMarks } from '../packs/walls/page/part-check.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import query, { heard, stepsOf } from '../packs/bar/parts/query/index.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { added, filterSaid, namer, without } from '../packs/bar/parts/query/terms.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { around, ranked, uses } from '../packs/bar/parts/query/rank.js';
// @ts-expect-error: a plain module of the pack, with no types of its own.
import { changes, litBy } from '../packs/bar/parts/query/lit-by.js';

const pack = JSON.parse(readFileSync(new URL('../packs/bar/pack.json', import.meta.url), 'utf8'));
const kinds = pack.parts.find((p: { id: string }) => p.id === 'bar.query').marks;
const check = (m: unknown) => checkMarks(m, { kinds });
const text = (m: unknown) => JSON.stringify(m);

const words = {
  types: { task: { title: 'Task', open: ['todo', 'doing'], closed: ['done'] }, decision: { title: 'Decision', open: ['open'], closed: ['decided'] }, 'sys.run': { title: 'Run', open: [], closed: [] } },
  links: { part_of: 'part of', depends_on: 'depends on', 'sys.ran': 'ran' },
};
const lens = { filter: { find: ['type task', 'part_of e_abcdefgh'], only: ['blocked'] }, walk: { over: ['depends_on>'], steps: 2 }, limit: 50 };
const input = (q: unknown = lens, more = {}) => ({ address: { query: q, layout: {}, drawn: { count: 12, cut: false } }, words, style: { numbers: { only_since_short: 1, only_since_days: 7, only_since_long: 30 } }, piece: {}, ...more });

/** Mount the part, with tools that record where it goes and what it keeps. */
function mount(given = input()) {
  const went: unknown[] = [], kept: unknown[] = [];
  const part = query(given, { go: (a: unknown) => went.push(a), keep: (v: unknown, n: string) => kept.push([n, v]) });
  return { part, went, kept };
}

test('the line says the lens in one line, each part by its word, and how many are drawn', () => {
  const { part } = mount();
  check(part.marks);
  const said = text(part.marks);
  assert.match(said, /Find Task or part of an item · Only blocked · Walk → depends on ×2/);
  assert.match(said, /"12 of 50"/);
  assert.doesNotMatch(said, /"Find","Only"/, 'the rows wait for a press');
});

test('Home says find on the map, and nothing drawn', () => {
  const { part } = mount(input(null, {}));
  check(part.marks);
  assert.match(text(part.marks), /Find on the map/);
  assert.doesNotMatch(text(part.marks), /of 50/);
});

test('pressed, the line opens a row for each part, every term with its ×', () => {
  const { part } = mount();
  const open = part.on({ key: 'line', name: 'press' });
  check(open);
  const said = text(open);
  for (const w of ['"Find"', '"Only"', '"Not"', '"Walk"', '"Limit"', '"x:find:0"', '"x:only:0"', '"way:0"', '"wx:0"', '"add:find"', '"fits":true']) assert.ok(said.includes(w), w);
});

test('a term’s × names the lens without it', () => {
  const { part, went } = mount();
  part.on({ key: 'line', name: 'press' });
  part.on({ key: 'x:find:0', name: 'press' });
  assert.deepEqual(went, [{ query: { ...lens, filter: { ...lens.filter, find: ['part_of e_abcdefgh'] } } }]);
});

test('adding is a kind, then the thing of that kind: never words taken for a term', () => {
  const { part, went } = mount();
  const kindsShown = part.on({ key: 'line', name: 'press' });
  check(kindsShown);
  assert.match(text(kindsShown), /"Find…","Words","Type","Link"/);
  // A kind is a pick, so the menu stays open and its things are drawn under it, each a button that adds its term.
  const typesShown = part.on({ key: 'kind:find:0', name: 'pick', value: 'type' });
  check(typesShown);
  assert.match(text(typesShown), /\["button",\{"key":"choice:find:0","look":"quiet","tip":"Task"\},"Task"\]/);
  assert.doesNotMatch(text(typesShown), /"Run"/, 'the system’s types are not offered');
  part.on({ key: 'choice:find:1', name: 'press' });
  assert.deepEqual((went[0] as { query: { filter: { find: string[] } } }).query.filter.find, ['type task', 'part_of e_abcdefgh', 'type decision']);
});

test('an item picked by name is added by its id and named by its title from then on', () => {
  const { part, went, kept } = mount();
  part.on({ key: 'line', name: 'press' });
  part.on({ key: 'kind:find:0', name: 'pick', value: 'link' });
  const ends = part.on({ key: 'kind:find:1', name: 'pick', value: 'part_of' });
  assert.match(text(ends), /"key":"item:find"/);
  const drawn = part.on({ key: 'item:find', name: 'pick', value: { id: 'e_zzzzzzzz', title: 'Server', type: 'task' } });
  assert.deepEqual((went[0] as { query: { filter: { find: string[] } } }).query.filter.find.at(-1), 'part_of e_zzzzzzzz');
  assert.deepEqual(kept, [['names', { e_zzzzzzzz: 'Server' }]]);
  const after = part.update(input({ ...lens, filter: { find: ['part_of e_zzzzzzzz'] } }));
  assert.match(text(after), /part of Server/);
  check(drawn);
});

test('what is written is taken only where the kind takes writing, and refused when it is not', () => {
  const { part, went } = mount();
  part.on({ key: 'line', name: 'press' });
  part.on({ key: 'kind:only:0', name: 'pick', value: 'changed-since' });
  const wrong = part.on({ key: 'typed:only', name: 'submit', value: 'last week' });
  assert.match(text(wrong), /Not what this takes/);
  assert.equal(went.length, 0);
  part.on({ key: 'typed:only', name: 'submit', value: '2026-10-01' });
  assert.deepEqual((went[0] as { query: { filter: { only: string[] } } }).query.filter.only, ['blocked', 'changed since 2026-10-01']);
});

test('Only offers its plain words, those already there left out, and the statuses of the types Find names', () => {
  const s = { input: input(), open: true, adding: null, wrong: false, names: new Map() };
  const ids = stepsOf(s, 'only')[0].choices.map((c: { id: string }) => c.id);
  assert.ok(ids.includes('w:done') && !ids.includes('w:blocked'));
  const statuses = heard(s, { key: 'kind:only:0', name: 'pick', value: 'status' });
  assert.deepEqual(stepsOf(statuses, 'only')[1].choices.map((c: { id: string }) => c.id), ['todo', 'doing', 'done']);
  assert.equal(heard(statuses, { key: 'choice:only:0', name: 'press' }).go.filter.only.at(-1), 'status todo');
});

test('the walk: an arrow turns a link’s way, steps go up and down, × takes a link out', () => {
  const s = { input: input(), open: true, adding: null, wrong: false, names: new Map() };
  assert.deepEqual(heard(s, { key: 'way:0', name: 'press' }).go.walk, { over: ['depends_on<'], steps: 2 });
  assert.deepEqual(heard(s, { key: 'steps:more', name: 'press' }).go.walk, { over: ['depends_on>'], steps: 3 });
  assert.deepEqual(heard(s, { key: 'steps:less', name: 'press' }).go.walk, { over: ['depends_on>'], steps: 1 });
  assert.deepEqual(heard(s, { key: 'wx:0', name: 'press' }).go.walk, { over: [], steps: 0 });
  assert.deepEqual(stepsOf(s, 'walk')[0].choices.map((c: { id: string }) => c.id), ['all', 'part_of']);
  assert.deepEqual(heard(s, { key: 'choice:walk:0', name: 'press' }).go.walk, { over: 'all', steps: 2 });
  assert.equal(heard(s, { key: 'limit', name: 'submit', value: '20' }).go.limit, 20);
  assert.equal(heard(s, { key: 'limit', name: 'submit', value: '0' }), s, 'a limit under one is no lens');
});

test('with the answer handed, what is used here is offered first, and a term says what it brought', () => {
  const answer = { items: [{ id: 'e_00000001', type: 'decision', terms: ['type task'] }, { id: 'e_00000002', type: 'decision', step: 1 }], links: [{ id: 'l1', type: 'depends_on', from: 'e_00000002', to: 'e_00000001' }] };
  const s = { input: input(lens, { answer }), open: true, adding: null, wrong: false, names: new Map() };
  const types = heard(s, { key: 'kind:find:0', name: 'pick', value: 'type' });
  assert.equal(stepsOf(types, 'find')[1].choices[0].id, 'decision');
  const { part } = mount(input(lens, { answer }));
  const open = part.on({ key: 'line', name: 'press' });
  check(open);
  assert.match(text(open), /"tip":"Items of this type: 2 drawn","lights":\["e_00000001","e_00000002"\]/);
});

test('the lens algebra and its words, as the bar kept them', () => {
  assert.deepEqual(added({ view: 'e_aaaaaaaa', filter: { not: ['done'] } }, { only: 'done' }), { filter: { not: [], only: ['done'] } });
  assert.deepEqual(without({ filter: { find: ['type task'] } }, 'find', 'type task'), { filter: {} });
  const said = namer(words, new Map([['e_abcdefgh', 'Server']]));
  assert.equal(filterSaid({ find: ['text road', 'type task', 'type decision', 'part_of e_abcdefgh'], only: ['blocked'] }, said.termSaid), '“road” · 2 types · part of Server · only blocked');
  assert.deepEqual(ranked([{ id: 'a' }, { id: 'b' }, { id: 'c', retired: true }], new Map([['b', 2]])).map((d: { id: string; near?: string }) => `${d.id}${d.near ? `:${d.near}` : ''}`), ['b:here', 'a']);
  assert.deepEqual([...around({ items: [{ id: 'x', type: 't' }] }, { items: [{ id: 'x', type: 't' }, { id: 'y', type: 'u' }] }).types], [['u', 1]]);
  assert.deepEqual([...uses([{ type: 't' }], []).types], [['t', 1]]);
  assert.ok(changes(1, 3) && !changes(3, 3));
  assert.deepEqual([...litBy({ items: [{ id: 'a', terms: ['x'] }, { id: 'b', step: 1 }], links: [{ from: 'a', to: 'b' }] }, 'x')], ['a', 'b']);
});
