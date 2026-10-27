// What the owner's page drew, for an agent that showed it something and asked to see it (report show, look: true;
// src/looks.ts, ui/look.js). The picture is made in the owner's browser and comes back with its next tail: asked of
// one screen, answered once, read again with query picture. In a real browser (skipped where there is no Chrome): a
// view drawn by the flow comes back as a PNG of the canvas, and so does one a style's own code paints, its pixels
// given by its sandboxed frame.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

// The smallest PNG there is: one pixel.
const DOT = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG = /^iVBORw0KGgo/;

test('a look is asked of the screen a show points, answered once by a page, and read again with query picture', async () => {
  const { call } = await serve('off');
  const made = (await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 't', type: 'work.task', title: 'Something to see' }] })).result.created as Record<string, string>;
  const show = (params: Record<string, unknown>) => call('/agent/report', undefined, { actor: 'robot', action: 'show', params: { entity: made.t, look: true, ...params } }).then((r) => r.result);
  // With no page following, nothing will draw it: said at once.
  const none = await show({});
  assert.equal(none.picture, null);
  assert.match(none.why, /No page of theirs follows/);
  // A page that follows is open; the show answers with the look to read later.
  const page = { page: 'p1', on: true, muted: [] };
  await call('/api/tail', undefined, { page });
  const asked = await show({ wait_seconds: 0 });
  assert.match(asked.look, /^l_[0-9a-f]{12}$/);
  assert.deepEqual((await call('/agent/query', undefined, { name: 'picture', params: { look: asked.look } })).result, { look: asked.look, picture: null, why: 'No page has answered yet.' });
  // The page's step carries the look, so it knows to answer.
  const steps = (await call('/api/tail', undefined, { page })).result.steps;
  assert.ok(steps.some((s: { kind: string; look?: string }) => s.kind === 'show' && s.look === asked.look));
  // A page that did not go there says why; one that drew it sends the picture, which stands over the why.
  await call('/api/tail', undefined, { page, drew: { look: asked.look, why: 'They were busy on the page.' } });
  assert.match((await call('/agent/query', undefined, { name: 'picture', params: { look: asked.look } })).result.why, /busy/);
  await call('/api/tail', undefined, { page, drew: { look: asked.look, data: DOT, content_type: 'image/png', width: 1, height: 1 } });
  const got = (await call('/agent/query', undefined, { name: 'picture', params: { look: asked.look } })).result;
  assert.deepEqual({ ...got, data: undefined }, { look: asked.look, content_type: 'image/png', width: 1, height: 1, size: 70, data: undefined });
  assert.equal(got.data, DOT);
  // Answered once: a second picture does not replace the first.
  await call('/api/tail', undefined, { page, drew: { look: asked.look, data: DOT.replace('AAAAA', 'AAAAB'), content_type: 'image/png' } });
  assert.equal((await call('/agent/query', undefined, { name: 'picture', params: { look: asked.look } })).result.data, DOT);
  // A look nobody asked for is not kept, and what is not a picture is let go without stopping the page's tail.
  assert.equal((await call('/api/tail', undefined, { page, drew: { look: 'l_000000000000', data: DOT, content_type: 'image/png' } })).status, 200);
  assert.match((await call('/agent/query', undefined, { name: 'picture', params: { look: 'l_000000000000' } })).error, /No look/);
  const other = await show({ wait_seconds: 0 });
  assert.equal((await call('/api/tail', undefined, { page, drew: { look: other.look, data: DOT, content_type: 'text/html' } })).status, 200);
  assert.equal((await call('/agent/query', undefined, { name: 'picture', params: { look: other.look } })).result.why, 'No page has answered yet.');
  // A test result's picture is read as before.
  assert.match((await call('/agent/query', undefined, { name: 'picture', params: {} })).error, /needs "result" or "look"/);
});

const browser = chrome();

test('in a browser, a show with a look answers with what the canvas drew: a flow, and a style’s own code', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const steps = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'a', type: 'work.task', title: 'First step' },
      { op: 'create', ref: 'b', type: 'work.task', title: 'Second step' },
      { op: 'link', type: 'depends_on', from: 'b', to: 'a' },
    ],
  })).result.created as Record<string, string>;
  // A ref in a lens's props is not made an id (issue e_vw733yx9): the views are made with the ids.
  const lens = { filter: { ids: [steps.a] }, walk: { over: ['depends_on'], steps: 1 } };
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'f', type: 'lens', title: 'The steps', status: 'current', props: lens },
      { op: 'create', ref: 'c', type: 'lens', title: 'The steps, painted', status: 'current', props: lens },
      { op: 'create', ref: 's', type: 'style', title: 'Painted', status: 'current', props: { code: "export default function draw({ canvas }) { const c = canvas.getContext('2d'); c.fillStyle = '#ff00ff'; c.fillRect(0, 0, canvas.width, canvas.height); }" } },
      { op: 'link', type: 'about', from: 's', to: 'c' },
    ],
  })).result.created as Record<string, string>;
  const page = await open(`${base}/`);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  // The colours in a picture, read by the browser: how many there are, and the one at its middle.
  const colours = (data: string) =>
    page.evaluate<{ count: number; middle: number[] }>(`(async () => {
      const img = new Image(); img.src = 'data:image/png;base64,${data}'; await img.decode();
      const c = document.createElement('canvas'); Object.assign(c, { width: img.width, height: img.height });
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, img.width, img.height).data, seen = new Set();
      for (let i = 0; i < px.length; i += 4 * 97) seen.add(px[i] << 16 | px[i + 1] << 8 | px[i + 2]);
      const m = ctx.getImageData(img.width >> 1, img.height >> 1, 1, 1).data;
      return { count: seen.size, middle: [m[0], m[1], m[2]] };
    })()`);
  try {
    // The page follows agents (it would by itself with one at work), and has heard where things stand before it is shown anything.
    await page.evaluate(`localStorage.setItem('pelago-follow', 'on')`);
    await wait(3000);
    const flow = (await call('/agent/report', undefined, { actor: 'robot', action: 'show', params: { entity: made.f, look: true, wait_seconds: 30 } })).result;
    assert.ok(flow.pages.following >= 1, 'the page follows');
    assert.match(flow.data ?? '', PNG, `a PNG of the canvas: ${JSON.stringify({ ...flow, data: undefined })} ${page.logs().join('\n')}`);
    assert.ok(flow.width > 600 && flow.height > 400, `the canvas's size: ${flow.width} × ${flow.height}`);
    assert.ok((await colours(flow.data)).count > 2, 'something is drawn on it');
    assert.ok(await page.evaluate(`document.querySelector('#canvas svg')?.textContent.includes('Second step')`), 'what it drew is the view');
    assert.ok(await page.evaluate(`document.getElementById('followed').textContent.includes('An image of this canvas went to robot')`), 'the owner is told what left the page');

    const painted = (await call('/agent/report', undefined, { actor: 'robot', action: 'show', params: { entity: made.c, look: true, wait_seconds: 30 } })).result;
    assert.match(painted.data ?? '', PNG, `a PNG of the painted canvas: ${JSON.stringify({ ...painted, data: undefined })} ${page.logs().join('\n')}`);
    assert.deepEqual((await colours(painted.data)).middle, [255, 0, 255], 'what the style’s code painted, as its frame gave it');
  } finally {
    page.close();
  }
});
