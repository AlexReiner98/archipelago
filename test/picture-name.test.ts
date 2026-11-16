// A kept picture's name (task e_rw7wkw6x, packs/walls/page/picture-name.js): what it was drawn from, said short. Two
// pictures drawn from anything different are named apart, the same are named alike however often they are asked, and
// naming one on a 50-item canvas takes under 2 ms, since it comes before every drawing.

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-ignore: a module of the page, plain JavaScript
import { nameOf, pictureKey } from '../packs/walls/page/picture-name.js';

/** An answer as a 50-item canvas gets one: items with their state and notes, links, the lens; `n` makes it its own. */
function answer(n: number, size = 50) {
  const items = Array.from({ length: size }, (_, i) => ({
    state: { needs_you: false, blocked: i % 7 === 0, sessions: 0, waits_on: [] },
    within: { items: i % 3, needs_you: 0, blocked: 0, work: 1, sessions: 0 },
    id: `e_${String(n).padStart(4, '0')}${String(i).padStart(4, '0')}`,
    type: i % 4 ? 'task' : 'decision',
    title: `Step ${i} of the plan ${n}`,
    body: `What step ${i} does, and why. `.repeat(20),
    status: i % 2 ? 'todo' : 'doing',
    created_at: '2026-11-02T18:24:25.301Z',
    updated_at: '2026-11-02T18:24:25.301Z',
  }));
  const links = items.slice(1).map((it, i) => ({ kind: 'depends_on', id: `r_${n}_${i}`, type: 'depends_on', from: it.id, to: items[i].id }));
  return { lens: { find: ['type task'], only: [], not: ['kind system'] }, viewer: 'e_j8t9uprx', items, links, pos: 100 + n };
}
/** A style as the house style is: some hundred thousand characters of looks, the same picture after picture. */
const style = { shape: 'map', sizes: Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`size_${i}`, i])), numbers: Object.fromEntries(Array.from({ length: 400 }, (_, i) => [`number_${i}`, i / 7])), theme: { light: Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`colour_${i}`, `#${(i * 99991).toString(16).padStart(6, '0').slice(0, 6)}`])) }, notes: 'x'.repeat(90_000) };
const styleText = JSON.stringify(style);
const input = (a: object, extra: object = {}) => ({ answer: a, style: JSON.parse(styleText), types: { task: 'Task', decision: 'Decision' }, fields: {}, relations: { depends_on: 'Depends on' }, width: 1280, height: 800, reduced: false, may: ['read', 'write'], ...extra });
const name = (a: object, extra: object = {}, text = styleText, hash = 'h1') => pictureKey(hash, input(a, extra), text).key;

test('the same picture asked again is named alike, from new objects, and when its answer was read does not count', () => {
  const first = name(answer(1));
  for (let k = 0; k < 3; k++) assert.equal(name(JSON.parse(JSON.stringify(answer(1)))), first, 'asked again, the same name');
  assert.equal(name({ ...answer(1), pos: 999 }), first, 'read at another position, the same answer is the same picture');
  assert.equal(nameOf('Ünïcode ✓ 字'), nameOf('Ünïcode ✓ 字'), 'any text is named alike each time');
});

test('pictures drawn from anything different are named apart', () => {
  const base = answer(1);
  const changed = (edit: (a: ReturnType<typeof answer>) => void) => {
    const a = JSON.parse(JSON.stringify(base));
    edit(a);
    return name(a);
  };
  const names = [
    name(base),
    changed((a) => (a.items[49].title += '!')),
    changed((a) => (a.items[1].state.blocked = true)),
    changed((a) => a.links.pop()),
    changed((a) => (a.lens.not = [])),
    changed((a) => (a.viewer = 'e_someone2')),
    name(base, { width: 1281 }),
    name(base, { height: 801 }),
    name(base, { reduced: true }),
    name(base, { may: ['read'] }),
    name(base, { types: { task: 'Job', decision: 'Decision' } }),
    name(base, {}, JSON.stringify({ ...style, shape: 'flow' })),
    name(base, {}, JSON.stringify({ ...style, sizes: { ...style.sizes, size_399: 400 } })),
    name(base, {}, styleText, 'h2'),
  ];
  assert.equal(new Set(names).size, names.length, `each is its own: ${names.join('\n')}`);
  // Many answers, each differing from the last in one character: no two share a name.
  const many = new Set<string>();
  for (let n = 0; n < 3000; n++) many.add(nameOf(JSON.stringify(answer(n % 10, 3)) + String.fromCharCode(n)));
  assert.equal(many.size, 3000, 'three thousand texts, three thousand names');
  // Texts of every length to a few words over, and the same bytes in another order, are named apart.
  const short = new Set(Array.from({ length: 40 }, (_, i) => nameOf('ab'.repeat(i).slice(0, i))));
  assert.equal(short.size, 40);
  assert.notEqual(nameOf('abcdefgh'), nameOf('efghabcd'));
});

test('naming a picture on a 50-item canvas takes under 2 ms', () => {
  const answers = Array.from({ length: 40 }, (_, n) => answer(n));
  // Warmed as a page is after its first picture.
  for (const a of answers.slice(0, 10)) name(a);
  const took: number[] = [];
  for (const a of answers.slice(10)) {
    const fresh = JSON.parse(JSON.stringify(a));
    const t = performance.now();
    name(fresh);
    took.push(performance.now() - t);
  }
  took.sort((a, b) => a - b);
  const median = took[took.length >> 1];
  assert.ok(JSON.stringify(input(answers[0])).length > 100_000, 'the input is as large as a live canvas\'s');
  assert.ok(median < 2, `a new answer is named in ${median.toFixed(2)} ms (median of ${took.length})`);
});
