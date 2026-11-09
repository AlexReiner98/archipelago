// A flow of any size draws in the time a page gives it (bug: "How is Archipelago built, and why?" stopped at twelve
// seconds, 7 Nov 2026). The drawing's polish (trials, a second drawing, the wires' shaping, a bundle's splits) spends from
// one budget per picture (layouts/flow/effort.js), so the time is bounded however large the answer; past the budget the
// picture takes its plain way, and still draws. Drawn here as the page draws it, through `picture`, with the house style.
// The answer is test/fixtures/layouts/flow-built.json, that view with every word hidden, and four of it side by side.

import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const pack = JSON.parse(readFileSync(join(import.meta.dirname, 'pack.json'), 'utf8'));
const house = { ...pack.styles.find((s: any) => s.id === 'core.house').props, shape: 'flow' };
const laid = mkdtempSync(join(tmpdir(), 'pelago-flow-time-'));
for (const [name, file] of Object.entries(pack.layouts.find((d: any) => d.id === 'core.flow').modules)) copyFileSync(join(import.meta.dirname, file as string), join(laid, name));
const { picture } = await import(pathToFileURL(join(laid, 'index.js')).href);
const { result: built } = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'test', 'fixtures', 'layouts', 'flow-built.json'), 'utf8'));
const measure = (t: string, px: number) => String(t).length * px * 0.55;

/** `copies` of the answer side by side, each item's id its own, each copy tied to the first by a few part_of links. */
function times(answer: any, copies: number) {
  const ids = new Set(answer.items.map((i: any) => i.id)), letters = 'abcdefghjkmnpqrstvwxyz';
  const items: any[] = [], links: any[] = [];
  for (let c = 0; c < copies; c++) {
    const as = (id: string) => (c && ids.has(id) ? `${id.slice(0, -1)}${letters[c]}` : id);
    items.push(...answer.items.map((i: any) => ({ ...i, id: as(i.id) })));
    links.push(...answer.links.map((l: any) => ({ ...l, id: `${l.id}${c}`, from: as(l.from), to: as(l.to) })));
    if (c) answer.items.slice(0, 5).forEach((i: any, k: number) => i.island === answer.items[k + 5].island && links.push({ id: `r_across${c}${k}`, type: 'part_of', from: as(i.id), to: answer.items[k + 5].id }));
  }
  return { ...answer, items: [...new Map(items.map((i) => [i.id, i])).values()], links };
}

/** The scene drawn, and the milliseconds of work it took: this process's CPU time, not the clock's, which the shards run beside it slow. */
function drawn(answer: any) {
  const before = process.cpuUsage();
  const out = picture({ answer, style: house, width: 1400, height: 900 }, { measure });
  const { user, system } = process.cpuUsage(before);
  return { out, took: (user + system) / 1000 };
}

/**
 * About five seconds of work alone and eight in a full run beside other files (7 Nov 2026), against 3.6 s on the clock
 * in Chrome: a bound for what has gone badly wrong, not the page's twelve seconds, which the next test keeps.
 */
const MOST = 20000;
let one = 0;

test('the view that stopped draws', () => {
  const { out, took } = drawn(built);
  one = took;
  assert.ok(out.scene && !out.scene.message, 'it draws');
  assert.ok(took < MOST, `drawn in ${Math.round(took)} ms of work`);
});

/**
 * How much longer four of the view may take than one. The work is counted, so both draw the same each time, but their CPU
 * time is not: alone it ran 1.7 to 2.2 times as long (9 Nov 2026, six runs), 2.1 to 2.2 in CI's shards. Before the
 * budget, twice the view took seven times as long: that is what this keeps out.
 */
const FOUR_TIMES = 2.5;

test('four of it side by side, some two hundred and seventy items and six hundred links, take no more than two and a half times as long', () => {
  // The budget bounds the polish, so the time stops growing with the size.
  const big = times(built, 4);
  assert.ok(big.items.length > 250 && big.links.length > 580, `${big.items.length} items, ${big.links.length} links`);
  const { out, took } = drawn(big);
  assert.ok(out.scene && !out.scene.message, 'it draws');
  // No bound of its own: the one is held under MOST, and this to FOUR_TIMES that, which a slow runner's 20 s for four (9 Nov) met.
  assert.ok(took < FOUR_TIMES * one, `drawn in ${Math.round(took)} ms of work, against ${Math.round(one)} for one`);
});

test('a picture comes out the same drawn afresh or again, after another has spent its own budget', () => {
  const first = JSON.stringify(drawn(built).out.scene);
  drawn(times(built, 2));
  assert.equal(JSON.stringify(drawn(built).out.scene), first);
});
