// Saved canvases (task e_uq77ps44): a flat lens and a style kept as an item of core's `lens` type. An agent makes and
// changes one through change and opens it on the owner's screen with report show; in a real browser (skipped where
// there is no Chrome) one is saved from the query bar and listed on Home one line each, at 1280 px here and at 560 px
// in test/saved-canvases-narrow.test.ts; opened and switched to from the bar in test/saved-canvases-switch.test.ts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome } from './browser.ts';
import { agent, fresh, freshWith, human, make, packsWith } from './map.ts';
import { Registry } from '../src/packs.ts';
import { savedCanvasPage } from './saved-canvas-page.ts';
import { callTool } from '../src/tools.ts';

const browser = chrome();

test('an agent makes and changes a saved canvas through change, and report show opens it', async () => {
  const l = await fresh();
  const { p } = await make(l, [{ op: 'create', ref: 'p', type: 'task', title: 'P' }]);
  const asked = { reason: 'test: a canvas of P', ops: [{ op: 'create' as const, ref: 'c', type: 'lens', title: 'P and its parts', body: 'P and what it holds.', props: { filter: { find: [`id ${p}`] }, walk: { over: ['part_of'], steps: 1 }, style: { shape: 'map' } } }] };
  const made = (await callTool(l, agent, 'change', asked)) as { status: string; created?: Record<string, string>; proposal?: string };
  // Held for a person, as every agent's change is until the owner lets them apply: approved, it is made.
  const id = made.created?.c ?? ((await l.change(human, asked)) as { created: Record<string, string> }).created.c;
  const got = (await callTool(l, agent, 'query', { name: 'get', params: { id } })) as { entity: { kind: string; props: Record<string, unknown> } };
  assert.equal(got.entity.kind, 'system', 'of the system kind: views of the work leave it out');
  assert.deepEqual(got.entity.props.filter, { find: [`id ${p}`] });
  await l.change(human, { reason: 'test', ops: [{ op: 'update', id, props: { limit: 50 } }] });
  await assert.rejects(l.change(human, { reason: 'test', ops: [{ op: 'update', id, props: { lens: 'x' } }] }), /lens/, 'only the fields it declares');
  const shown = (await callTool(l, agent, 'report', { action: 'show', params: { entity: id } })) as { hash: string };
  assert.equal(shown.hash, `v?canvas=${id}`, 'opened as their canvas, not as an item page');
  const drawn = (await callTool(l, human, 'view', { name: 'flat', params: { filter: { find: ['type task'] } } })) as { items: { id: string }[] };
  assert.ok(!drawn.items.some((i) => i.id === id), 'not drawn on a canvas of the work');
});

test("a pack ships canvases as presets: the schema offers each, its lens answers, and the owner keeps their version under its id", async () => {
  // Core ships no waiting lens since it went to work_views (task e_2a94ypah): a pack of the test's own ships one.
  const shelf = { id: 'shelf', version: '1.0.0', title: 'Shelf', description: 'A canvas.', requires: ['core'], styles: [{ id: 'shelf.waiting', type: 'lens', title: 'Waiting on you', props: { filter: { find: ['waits_on me'] }, walk: { over: [], steps: 0 } } }] };
  const l = await freshWith(new Registry(packsWith(shelf)));
  const { canvases, shapes } = (await callTool(l, human, 'schema', {})) as { canvases: { id: string; pack: string; title: string; props: { filter: Record<string, unknown>; walk: unknown } }[]; shapes: { shape: string }[] };
  const waiting = canvases.find((c) => c.id === 'shelf.waiting');
  assert.ok(waiting && waiting.pack === 'shelf' && waiting.title, 'the pack ships what waits on you');
  assert.deepEqual(shapes.filter((s) => s.shape === 'map').length, 1, 'the shapes the drawings draw, for the style switch');
  // What waits on the person looking: the lens answers as a saved one does.
  const { me } = await l.init(human, { name: 'Me' });
  const { t } = await make(l, [{ op: 'create', ref: 't', type: 'task', title: 'T' }]);
  await l.change(human, { reason: 'test', ops: [{ op: 'link', type: 'waits_on', from: t, to: me }] });
  const drawn = (await callTool(l, human, 'view', { name: 'flat', params: { filter: waiting.props.filter, walk: waiting.props.walk } })) as { items: { id: string }[] };
  assert.ok(drawn.items.some((i) => i.id === t), 'what waits on you is drawn');
  const kept = (await l.change(human, { reason: 'test', ops: [{ op: 'create', ref: 'c', type: 'lens', title: waiting.title, props: { ...waiting.props, preset: waiting.id } }] })) as { created: Record<string, string> };
  const got = (await callTool(l, human, 'query', { name: 'get', params: { id: kept.created.c } })) as { entity: { props: Record<string, unknown> } };
  assert.equal(got.entity.props.preset, 'shelf.waiting', 'the owner’s version names the preset it stands for');
});

test('in a browser, a canvas is saved from the bar at 1280 px and listed on Home', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { page, savePass } = await savedCanvasPage();
  try {
    await savePass(1280);
  } finally {
    await page.close();
  }
});
