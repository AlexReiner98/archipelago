// A theme is a style's colours, finished on the server: chosen by keeping a version of its preset, a person's own
// over it on the pages they see, and a published page drawn as the map's styles stood when it was published.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { publish, publishedDocument } from '../src/published.ts';
import { pageLook, pageStyle } from '../src/styles.ts';
import { fresh, human, make } from './map.ts';

const OPEN_WATER = { light: '#216bc0', dark: '#70a4e6' };
const BAY = { light: '#077783', dark: '#28b1c3' };

test('a theme is used once the owner keeps a version of it, and every page and agent reads its finished colours', async () => {
  const l = await fresh();
  const house = (await pageStyle(l, {})).style.theme as any;
  assert.notEqual(house.light.accent, OPEN_WATER.light);
  assert.ok(!(await pageStyle(l, {})).used.some((u) => u.preset === 'themes.open_water'), 'a theme nobody chose is not used');
  const made = await make(l, [{ op: 'create', ref: 'v', type: 'style', title: 'Open water', props: { preset: 'themes.open_water' } }]);
  const { style, used } = await pageStyle(l, {});
  const theme = style.theme as any;
  assert.deepEqual([theme.light.accent, theme.dark.accent, theme.light.bg], [OPEN_WATER.light, OPEN_WATER.dark, '#f5f6f0']);
  assert.equal(theme.light.reader_link, OPEN_WATER.light, "the work pack's document colours follow it");
  assert.equal(theme.light.ok, house.light.ok, 'the states stay the house\'s');
  assert.ok(Object.values(theme.light).every((c) => /^#[0-9a-f]{6}$/.test(String(c))), 'every colour sent is finished');
  assert.ok(used.some((u) => u.id === made.v && u.preset === 'themes.open_water'));
  // The public page reads the same.
  assert.equal(((await pageLook(l)).theme as any).light.accent, OPEN_WATER.light);
});

test('a theme is tried on one read: drawn as if kept, over the one kept, and nothing is kept', async () => {
  const l = await fresh();
  const tried = await pageStyle(l, { try: 'themes.bay' });
  assert.equal((tried.style.theme as any).light.accent, BAY.light);
  assert.ok(!(await pageStyle(l, {})).used.some((u) => u.preset === 'themes.bay'), 'trying keeps nothing');
  await make(l, [{ op: 'create', ref: 'v', type: 'style', title: 'Open water', props: { preset: 'themes.open_water' } }]);
  assert.equal(((await pageStyle(l, { try: 'themes.bay' })).style.theme as any).light.accent, BAY.light, 'the one tried lies over the one kept');
  assert.equal(((await pageStyle(l, {})).style.theme as any).light.accent, OPEN_WATER.light);
  assert.equal(((await pageLook(l)).theme as any).light.accent, OPEN_WATER.light, 'a page read with no login never sees it');
});

test("a person's own theme lies over the workspace's on the pages they see, and never on one read with no login", async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'me', type: 'person', title: 'Me' },
    { op: 'create', ref: 'v', type: 'style', title: 'Open water', props: { preset: 'themes.open_water' } },
    { op: 'create', ref: 'mine', type: 'style', title: 'My colours', props: { theme: { light: { sea: BAY.light }, dark: { sea: BAY.dark } } } },
    { op: 'link', type: 'about', from: 'mine', to: 'me' },
  ]);
  await l.db.query(`insert into setting (key, value) values ('me', $1::jsonb) on conflict (key) do update set value = excluded.value`, [JSON.stringify(made.me)]);
  const theirs = (await pageStyle(l, {})).style.theme as any;
  assert.deepEqual([theirs.light.accent, theirs.dark.accent], [BAY.light, BAY.dark], 'their sea, worked out by the workspace theme\'s rules');
  assert.equal(theirs.light.bg, '#f5f6f0', 'the rest is the workspace\'s');
  assert.equal(((await pageStyle(l, {}, false)).style.theme as any).light.accent, OPEN_WATER.light, 'a page before sign-in reads no one\'s own');
  assert.equal(((await pageLook(l)).theme as any).light.accent, OPEN_WATER.light, 'a page read with no login reads no one\'s own');
});

test("a published page keeps the colours it was published with, its own style's over the workspace's", async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'd', type: 'work.document', title: 'Landing', visibility: 'shared', body: 'What it is, in a line.' },
    { op: 'create', ref: 'own', type: 'style', title: 'Its own', props: { theme: { light: { muted: '#555555' } } } },
    { op: 'link', type: 'about', from: 'own', to: 'd' },
  ]);
  await publish(l, human, made.d);
  const read = async () => (await pageLook(l, { ...(await publishedDocument(l, made.d))!, id: made.d })).theme as any;
  const then = await read();
  assert.equal(then.light.muted, '#555555', "the document's own style is over the workspace's");
  // The workspace chooses a theme after: what is published keeps its colours until it is published again.
  await make(l, [{ op: 'create', ref: 'v', type: 'style', title: 'Bay', props: { preset: 'themes.bay' } }]);
  assert.equal((await read()).light.accent, then.light.accent);
  await publish(l, human, made.d);
  assert.equal((await read()).light.accent, BAY.light);
});
