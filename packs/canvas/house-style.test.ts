// The canvas pack's house preset draws a page as a flow: it lies over a workspace style kept from before the canvas,
// which says list, and under a style kept about the item (moved from test/page-style.test.ts, 9 Nov 2026).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { call, human, make, mapWith } from '#pelago/test';

const style = (l: Awaited<ReturnType<typeof mapWith>>, id: string) => call<{ style: any; used: { id: string; preset?: string }[] }>(l, human, 'query', { name: 'style', params: { of: id } });

test("the canvas pack's flow lies over a workspace style that says list, and under a view's own", async () => {
  const l = await mapWith();
  const made = await make(l, [
    { op: 'create', ref: 'ws', type: 'style', title: 'House style', props: { shape: 'list' } },
    { op: 'create', ref: 'p', type: 'task', title: 'P' },
  ]);
  // A workspace style kept from before the canvas does not turn the canvas back into lists.
  const page = await style(l, made.p);
  assert.equal(page.style.shape, 'flow');
  const used = page.used.map((u) => u.preset ?? u.id);
  assert.deepEqual(used.slice(-2), [made.ws, 'canvas.house'], 'the canvas preset is read after the workspace style');
  // A style kept about the item is nearer, and wins.
  await make(l, [{ op: 'create', ref: 'own', type: 'style', title: 'P as a list', props: { shape: 'list' } }, { op: 'link', type: 'about', from: 'own', to: made.p }]);
  assert.equal((await style(l, made.p)).style.shape, 'list');
});
