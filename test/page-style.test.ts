// How a page looks is its style (the style view): the presets the packs ship, under what the map keeps. A document
// reads through with no picture, because the work pack's preset on documents says so; anything else has the house
// style's page; and the owner's version of a preset changes it for every such item.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { lengthsSheet } from '../src/styles.ts';
import { VIEWS } from '../src/views.ts';
import { fresh, make } from './map.ts';

test('a page is drawn by its style: the house style, a kind\'s preset over it, the owner\'s version over that', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'work.project', title: 'P' },
    { op: 'create', ref: 'd', type: 'work.document', title: 'D' },
  ]);
  const of = async (id?: string) => (await VIEWS.style.run(l, id ? { of: id } : {})) as { style: any; used: { id: string; preset?: string }[] };
  const workspace = await of();
  assert.deepEqual([workspace.style.page.picture, workspace.style.page.notes, typeof workspace.style.numbers.note_opening_most], [true, 'open', 'number']);
  // The page's colours are the house style's theme, light and dark alike, every name in both.
  const { light, dark } = workspace.style.theme;
  assert.deepEqual([typeof light.bg, typeof dark.bg, Object.keys(light).sort()], ['string', 'string', Object.keys(dark).sort()]);
  // Every length, face and text role the app, the reader and the public page read is one the house style names, and /layout.css says it.
  const named = new Set([...Object.keys(light), ...Object.keys(workspace.style.lengths), ...Object.keys(workspace.style.faces).map((n) => `face_${n}`), ...Object.keys(workspace.style.type).flatMap((r) => ['family', 'weight', 'style', 'case', 'track'].map((p) => `type_${r}_${p}`))].map((n) => n.replaceAll('_', '-')));
  const sheet = lengthsSheet(l.registry.packs);
  for (const file of ['ui/style.css', 'ui/doc.css', 'ui/public.css']) {
    const css = readFileSync(file, 'utf8');
    const local = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1].slice(2)));
    // Set on an element by the page's own code, not by a style: the graph's zoom, a ring's share, a calendar's lane,
    // the main canvas's frame among the panes and the frame of the one the bar acts on (ui/panes.js).
    const byCode = new Set(['k', 'pct', 'cal-agents', 'cal-hue', 'main-top', 'main-left', 'main-right', 'main-bottom', 'active-top', 'active-left', 'active-right', 'active-bottom']);
    const unnamed = [...css.matchAll(/var\(--([a-z0-9-]+)/g)].map((m) => m[1]).filter((n) => !named.has(n) && !local.has(n) && !byCode.has(n) && !n.startsWith('ln-'));
    assert.deepEqual([...new Set(unnamed)], [], `${file} reads lengths the house style does not name`);
  }
  assert.match(sheet, /--space-5: 8px;/);
  assert.match(sheet, /--face-chart: Georgia/);
  const project = await of(made.p);
  assert.deepEqual([project.style.page.picture, project.style.page.notes], [true, 'open'], 'a project has the house style');
  const doc = await of(made.d);
  assert.deepEqual([doc.style.page.picture, doc.style.page.notes, doc.style.page.ties], [false, 'whole', 'open'], 'a document reads through, the rest of its page the house style\'s');
  assert.deepEqual(doc.used.map((u) => u.preset), ['core.house', 'canvas.house', 'work.reading']);
  // The owner's version of the reading preset: documents fold again, the picture still left out.
  await make(l, [{ op: 'create', ref: 'v', type: 'style', title: 'Mine', props: { preset: 'work.reading', page: { notes: 'folded' } } }]);
  const mine = await of(made.d);
  assert.deepEqual([mine.style.page.picture, mine.style.page.notes], [false, 'folded']);
  await assert.rejects(of('e_nothing0'), /No item/);
});

test("the canvas pack's flow lies over a workspace style that says list, and under a view's own", async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'ws', type: 'style', title: 'House style', props: { shape: 'list' } },
    { op: 'create', ref: 'p', type: 'work.project', title: 'P' },
  ]);
  const of = async (id?: string) => (await VIEWS.style.run(l, id ? { of: id } : {})) as { style: any; used: { id: string; preset?: string }[] };
  // A workspace style kept from before the canvas does not turn the canvas back into lists.
  const page = await of(made.p);
  assert.equal(page.style.shape, 'flow');
  assert.deepEqual(page.used.map((u) => u.preset ?? u.id), ['core.house', made.ws, 'canvas.house']);
  // A style kept about the item is nearer, and wins.
  await make(l, [{ op: 'create', ref: 'own', type: 'style', title: 'P as a list', props: { shape: 'list' } }, { op: 'link', type: 'about', from: 'own', to: made.p }]);
  assert.equal((await of(made.p)).style.shape, 'list');
});
