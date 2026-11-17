// What a press in the island picker does to the list the canvas draws (packs/surface/page/islands-list.js): it starts
// from the islands the canvas draws now, an agent's show or an item's page among them, and brings the canvas Home to
// draw the new list (the owner, 17 Nov 2026: an island turned on marked on but not drawn).

import assert from 'node:assert/strict';
import { test } from 'node:test';
// @ts-expect-error a page module, plain JavaScript
import { atHome, capital, drawnAt, islandsIn, pressed, recentFirst } from '../packs/surface/page/islands-list.js';

const mine = ['e_xgrowth1'];

test('Home draws the person’s own list, and a press there changes it in place', () => {
  for (const hash of ['', '#', '#/', '#/v']) assert.ok(atHome(hash), hash);
  assert.deepEqual(drawnAt('#/', mine), mine);
  assert.deepEqual(pressed('#/', mine, 'e_lightcor'), { list: ['e_xgrowth1', 'e_lightcor'], home: false });
  assert.deepEqual(pressed('#/', mine, 'e_xgrowth1'), { list: [], home: false });
});

test('a canvas at an address that names islands draws those, and a press there goes Home with them', () => {
  const hash = '#/v?islands=e_shown001';
  assert.ok(!atHome(hash));
  assert.deepEqual(drawnAt(hash, mine), ['e_shown001']);
  assert.deepEqual(pressed(hash, mine, 'e_lightcor'), { list: ['e_shown001', 'e_lightcor'], home: true }, 'what was drawn, the island added: drawn at once');
  assert.deepEqual(pressed('#/e/e_item0001?islands=e_shown001', mine, 'e_shown001'), { list: [], home: true });
});

test("an item's page draws its own island: a press goes Home with the person's list changed", () => {
  assert.deepEqual(pressed('#/e/e_item0001', mine, 'e_lightcor'), { list: ['e_xgrowth1', 'e_lightcor'], home: true });
});

test('the list read after a press is the new one, so Home drawn again draws what was put on', async () => {
  // islands-on.js as the page loads it, its base.js a stand-in: no person (sign-in off), so the list is kept in this browser.
  const { readFileSync } = await import('node:fs');
  const { pathToFileURL } = await import('node:url');
  const store = new Map<string, string>();
  Object.assign(globalThis, { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) } });
  const base = `data:text/javascript,${encodeURIComponent('export const api = async (name) => { if (name === "search") return [{ id: "e_latest01" }, { id: "e_latest02" }]; throw new Error("no server"); }; export const whoami = async () => ({});')}`;
  const list = pathToFileURL('packs/surface/page/islands-list.js').href;
  const text = readFileSync('packs/surface/page/islands-on.js', 'utf8').replace("'./base.js'", `'${base}'`).replace("'./islands-list.js'", `'${list}'`);
  const on = await import(`data:text/javascript,${encodeURIComponent(text)}`);
  store.set('pelago-islands', JSON.stringify(['e_xgrowth1']));
  assert.deepEqual(await on.islandsOn(), ['e_xgrowth1']);
  await on.keepList(['e_xgrowth1', 'e_lightcor'], 'test');
  assert.deepEqual(await on.islandsOn(), ['e_xgrowth1', 'e_lightcor'], 'not the list as first read');
});

test('a person who has chosen no islands sees the map’s latest, until a press makes the list their own', async () => {
  const { readFileSync } = await import('node:fs');
  const { pathToFileURL } = await import('node:url');
  const store = new Map<string, string>();
  Object.assign(globalThis, { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) } });
  const base = `data:text/javascript,${encodeURIComponent('export const api = async (name) => { if (name === "search") return [{ id: "e_latest01" }, { id: "e_latest02" }]; throw new Error("no server"); }; export const whoami = async () => ({});')}`;
  const list = pathToFileURL('packs/surface/page/islands-list.js').href;
  // A copy of its own (the comment makes it another module), so its list is read afresh.
  const text = readFileSync('packs/surface/page/islands-on.js', 'utf8').replace("'./base.js'", `'${base}'`).replace("'./islands-list.js'", `'${list}'`) + '// unchosen';
  const on = await import(`data:text/javascript,${encodeURIComponent(text)}`);
  assert.deepEqual(await on.islandsOn(), ['e_latest01', 'e_latest02'], 'nothing kept: the map’s latest islands');
  await on.keepList(['e_latest01'], 'test');
  assert.equal(store.get('pelago-islands'), JSON.stringify(['e_latest01']), 'a press keeps the list as theirs');
});

test('an address names islands and live reads only', () => {
  assert.deepEqual(islandsIn('islands=e_aaaaaaaa,frontier,bad,e_aaaaaaaa'), ['e_aaaaaaaa', 'frontier']);
  assert.equal(islandsIn('find=x'), null);
});

test("a pack's title shows with a capital", () => {
  assert.equal(capital('ridges'), 'Ridges');
  assert.equal(capital('Pack anatomy'), 'Pack anatomy');
});

test('the side list puts the islands worked on lately first, the latest first, then the rest by name', () => {
  const now = Date.parse('2026-11-17T12:00:00Z'), day = (n: number) => new Date(now - n * 86_400_000).toISOString();
  const { recent, rest } = recentFirst([
    { id: 'a', title: 'Zebra', worked_at: day(1) },
    { id: 'b', title: 'Apple', worked_at: day(30) },
    { id: 'c', title: 'Mango', worked_at: day(0.5) },
    { id: 'd', title: 'Banana', worked_at: day(8) },
    { id: 'e', title: 'Cherry' },
  ], now, 7);
  assert.deepEqual(recent.map((i: { id: string }) => i.id), ['c', 'a'], 'within the days, the latest first');
  assert.deepEqual(rest.map((i: { title: string }) => i.title), ['Apple', 'Banana', 'Cherry'], 'every other by name, one with no time among them');
  const capped = recentFirst([{ id: 'a', title: 'Zebra', worked_at: day(1) }, { id: 'c', title: 'Mango', worked_at: day(0.5) }, { id: 'b', title: 'Apple', worked_at: day(30) }], now, 7, 1);
  assert.deepEqual(capped.recent.map((i: { id: string }) => i.id), ['c'], 'no more than the most, the latest kept');
  assert.deepEqual(capped.rest.map((i: { title: string }) => i.title), ['Apple', 'Zebra'], 'the rest by name, the one left over among them');
});
