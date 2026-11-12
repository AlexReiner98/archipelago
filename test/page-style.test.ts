// How a page looks is its style (the style view): the presets the packs ship, under what the map keeps. A writing
// reads through with no picture, because its pack's preset on it says so (test/packs/reader); anything else has the
// house style's page; and the owner's version of a preset changes it for every such item. The canvas pack's own
// preset is tried among that pack's own tests (house-style.test.ts).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { lengthsSheet } from '../packs/styles/kernel/styles.ts';
import { VIEWS } from '../packs/query/kernel/views.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { fresh, freshWith, make, packsWith } from './map.ts';
import { kernelContext } from '../packs/loader/kernel/kernel-context.ts';

test('a page is drawn by its style: the house style, a kind\'s preset over it, the owner\'s version over that', async () => {
  const l = await freshWith(new Registry(packsWith('reader')));
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'aim', title: 'P' },
    { op: 'create', ref: 'd', type: 'writing', title: 'D' },
  ]);
  const of = async (id?: string) => (await VIEWS.style.run(kernelContext(l, 'query'), id ? { of: id } : {})) as { style: any; used: { id: string; preset?: string }[] };
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
    // Set on an element by the page's own code, not by a style: the graph's zoom, a ring's share, a calendar's lane, a session's hue,
    // the main canvas's frame among the panes and the frame of the one the bar acts on (ui/panes.js).
    const byCode = new Set(['k', 'pct', 'cal-agents', 'cal-hue', 'session-hue', 'main-top', 'main-left', 'main-right', 'main-bottom', 'active-top', 'active-left', 'active-right', 'active-bottom']);
    const unnamed = [...css.matchAll(/var\(--([a-z0-9-]+)/g)].map((m) => m[1]).filter((n) => !named.has(n) && !local.has(n) && !byCode.has(n) && !n.startsWith('ln-'));
    assert.deepEqual([...new Set(unnamed)], [], `${file} reads lengths the house style does not name`);
  }
  assert.match(sheet, /--space-5: 8px;/);
  assert.match(sheet, /--face-chart: Georgia/);
  const aim = await of(made.p);
  assert.deepEqual([aim.style.page.picture, aim.style.page.notes], [true, 'open'], 'an aim has the house style');
  assert.ok(!aim.used.some((u) => u.preset === 'reader.reading'), 'the preset on writing is not read for an aim');
  const doc = await of(made.d);
  assert.deepEqual([doc.style.page.picture, doc.style.page.notes, doc.style.page.ties], [false, 'whole', 'open'], 'a writing reads through, the rest of its page the house style\'s');
  const used = doc.used.map((u) => u.preset);
  assert.deepEqual([used[0], used.at(-1)], ['core.house', 'reader.reading'], 'the house style first, the preset on its type last');
  // The owner's version of the reading preset: writings fold again, the picture still left out.
  await make(l, [{ op: 'create', ref: 'v', type: 'style', title: 'Mine', props: { preset: 'reader.reading', page: { notes: 'folded' } } }]);
  const mine = await of(made.d);
  assert.deepEqual([mine.style.page.picture, mine.style.page.notes], [false, 'folded']);
  await assert.rejects(of('e_nothing0'), /No item/);
});

test('the layout chosen in the view band reaches the style read, with its drawing; one no pack draws is drawn as the map', async () => {
  const l = await fresh();
  const read = async (input: Record<string, unknown>) => ((await VIEWS.style.run(kernelContext(l, 'query'), { ...input, have: [] })) as { style: any }).style;
  assert.equal((await read({ shape: 'map' })).drawing.id, 'core.map');
  const retired = await read({ shape: 'grid' });
  assert.deepEqual([retired.shape, retired.drawing.id], ['map', 'core.map'], 'a layout retired on 9 Nov 2026 draws as the map');
  assert.equal(retired.drawing.notes, undefined, 'a drawing that reads the start of each note asks for nothing more');
});

test('what is made for a reader, of any pack, opens as reading: canvas’s preset is on has:deliverable', async () => {
  const l = await fresh();
  await make(l, [{ op: 'define_type', type: { id: 'local.report', title: 'Report', description: 'Written for a client.', extends: 'record', deliverable: true } }]);
  const made = await make(l, [
    { op: 'create', ref: 'r', type: 'local.report', title: 'The report' },
    { op: 'create', ref: 't', type: 'task', title: 'A task' },
  ]);
  const of = async (id: string) => (await VIEWS.style.run(kernelContext(l, 'query'), { of: id })) as { style: any; used: { id: string; preset?: string }[] };
  const report = await of(made.r);
  assert.deepEqual([report.style.page.picture, report.style.page.notes, report.style.notes.measure], [false, 'whole', 'reader_measure']);
  assert.ok(report.used.some((u) => u.preset === 'core.reading'), 'by canvas’s reading preset');
  const task = await of(made.t);
  assert.equal(task.style.page.picture, true, 'not on what is not made for a reader');
  assert.ok(!task.used.some((u) => u.preset === 'core.reading'));
});
