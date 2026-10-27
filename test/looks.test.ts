// What a view looks like, for an agent (src/looks.ts, decision e_wsz3wdzp): drawn by the server in its own headless
// Chrome, from the app's page in look mode, with a pass that reads as the asking agent and only reads. Without a
// browser: what a pass may read and call, and the picture going out as an MCP image. In a real browser (skipped where
// there is no Chrome): a flow, a style whose own code paints its canvas, and a lens that finds nothing, each taken once
// the page says it has drawn, with no page of the owner's open.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createToken } from '../src/auth.ts';
import { chromeBinary } from '../src/chrome.ts';
import { stopDrawing } from '../src/look-draw.ts';
import { passFor } from '../src/looks.ts';
import { contentOf } from '../src/mcp.ts';
import { open } from './browser.ts';
import { serve } from './serve.ts';

after(stopDrawing);

test('a look pass reads as its agent’s person, only through /api, and only what the canvas reads', async () => {
  const { workspaces, call, member } = await serve('tokens');
  const db = (await workspaces.get('default')).pelago.db;
  const owner = (await createToken(db, 'default', { kind: 'human', name: 'owner', admin: true })).token;
  const sam = await member(owner, { email: 'sam@example.com', name: 'Sam' });
  const kim = await member(owner, { email: 'kim@example.com', name: 'Kim' });
  const samId = (await call('/whoami', sam, undefined, 'GET')).actor.person as string;
  const make = async (token: string, title: string) => ((await call('/api/change', token, { reason: 'test', ops: [{ op: 'create', ref: 'x', type: 'work.task', title, visibility: 'private' }] })).result.created as Record<string, string>).x;
  const [mine, theirs] = [await make(sam, 'Sam’s own'), await make(kim, 'Kim’s own')];
  const pass = await passFor(db, { workspace: 'default', viewer: samId }, 'claude/look');
  // It reads the map as Sam does: their private item, not Kim's.
  const flat = (await call('/api/view', pass, { name: 'flat', params: { filter: { ids: [mine, theirs] } } })).result;
  assert.deepEqual(flat.items.map((i: { id: string }) => i.id), [mine]);
  // It writes nothing, and is no token anywhere but the page's reads.
  const refused = await call('/api/change', pass, { reason: 'test', ops: [{ op: 'create', type: 'work.task', title: 'From a look' }] });
  assert.equal(refused.status, 403);
  assert.match(refused.error, /A look reads/);
  for (const path of ['/agent/query', '/mcp']) assert.equal((await call(path, pass, { name: 'search', params: {} })).status, 401, `${path} takes no look pass`);
  // One nobody made, or for another workspace, is no pass.
  assert.equal((await call('/api/view', `look_default_${'0'.repeat(40)}`, { name: 'flat', params: { filter: { ids: [mine] } } })).status, 401);
  assert.equal((await call('/api/view', pass.replace('look_default_', 'look_acme_'), { name: 'flat', params: { filter: { ids: [mine] } } })).status, 401);
});

test('a picture in a tool’s answer goes to MCP as an image of its own, out of the text', () => {
  const [text, image] = contentOf({ look: 'l_0123456789ab', state: 'drawn', image: { data: 'AAAA', content_type: 'image/png' } });
  assert.deepEqual(image, { type: 'image', data: 'AAAA', mimeType: 'image/png' });
  assert.equal(text.type, 'text');
  assert.deepEqual(JSON.parse((text as { text: string }).text), { look: 'l_0123456789ab', state: 'drawn' });
  assert.equal(contentOf({ a: 1 }).length, 1);
});

const browser = chromeBinary();
const PNG = /^iVBORw0KGgo/;

test('in a browser, a look is the view as drawn: a flow, a style’s own code, a lens that finds nothing', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const steps = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'a', type: 'work.task', title: 'First step' },
      { op: 'create', ref: 'b', type: 'work.task', title: 'Second step' },
      { op: 'link', type: 'depends_on', from: 'b', to: 'a' },
    ],
  })).result.created as Record<string, string>;
  const lens = { filter: { ids: [steps.a] }, walk: { over: ['depends_on'], steps: 1 } };
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'f', type: 'lens', title: 'The steps', status: 'current', props: lens },
      { op: 'create', ref: 'c', type: 'lens', title: 'The steps, painted', status: 'current', props: lens },
      // It paints only after a wait, as code that loads or lays out first does: the look waits for it.
      { op: 'create', ref: 's', type: 'style', title: 'Painted', status: 'current', props: { code: "export default async function draw({ canvas }) { await new Promise((r) => setTimeout(r, 1500)); const c = canvas.getContext('2d'); c.fillStyle = '#ff00ff'; c.fillRect(0, 0, canvas.width, canvas.height); }" } },
      { op: 'link', type: 'about', from: 's', to: 'c' },
    ],
  })).result.created as Record<string, string>;
  const look = (params: Record<string, unknown>) => call('/agent/query', undefined, { actor: 'robot', name: 'look', params }).then((r) => r.result ?? r);
  // A page to read the pictures with: not the owner's (none is open), only a browser to decode them in.
  const reader = await open('about:blank');
  const colours = (data: string) =>
    reader.evaluate<{ count: number; middle: number[]; width: number }>(`(async () => {
      const img = new Image(); img.src = 'data:image/png;base64,${data}'; await img.decode();
      const c = document.createElement('canvas'); Object.assign(c, { width: img.width, height: img.height });
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
      const px = ctx.getImageData(0, 0, img.width, img.height).data, seen = new Set();
      for (let i = 0; i < px.length; i += 4 * 97) seen.add(px[i] << 16 | px[i + 1] << 8 | px[i + 2]);
      const m = ctx.getImageData(img.width >> 1, img.height >> 1, 1, 1).data;
      return { count: seen.size, middle: [m[0], m[1], m[2]], width: img.width };
    })()`);
  try {
    const flow = await look({ entity: made.f });
    assert.equal(flow.state, 'drawn', JSON.stringify({ ...flow, image: undefined }));
    assert.match(flow.image?.data ?? '', PNG);
    assert.deepEqual([flow.width, flow.height], [1200, 750]);
    const seen = await colours(flow.image.data);
    assert.equal(seen.width, 1200);
    assert.ok(seen.count > 3, 'something is drawn on it');
    // The same view, the map unchanged: the picture already taken.
    const again = await look({ entity: made.f });
    assert.equal(again.again, true);
    assert.equal(again.look, flow.look);
    assert.equal((await call('/agent/query', undefined, { name: 'picture', params: { look: flow.look } })).result.image.data, flow.image.data);

    // Drawn dark unless asked light: the page's own colours follow the scheme the look is drawn in.
    assert.equal(flow.scheme, 'dark');
    const light = await look({ entity: made.f, scheme: 'light' });
    assert.equal(light.scheme, 'light');
    assert.notEqual(light.look, flow.look, 'a light look is not the dark one again');
    const corner = (data: string) => reader.evaluate<number[]>(`(async () => { const img = new Image(); img.src = 'data:image/png;base64,${data}'; await img.decode(); const c = document.createElement('canvas'); Object.assign(c, { width: img.width, height: img.height }); const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0); return [...ctx.getImageData(600, 700, 1, 1).data.slice(0, 3)]; })()`);
    const [d, l] = [await corner(flow.image.data), await corner(light.image.data)];
    assert.ok(d.reduce((a, b) => a + b) < l.reduce((a, b) => a + b), `dark is darker: ${d} against ${l}`);

    const painted = await look({ entity: made.c, width: 800, height: 500 });
    assert.equal(painted.state, 'drawn', JSON.stringify({ ...painted, image: undefined }));
    assert.deepEqual((await colours(painted.image.data)).middle, [255, 0, 255], 'what the style’s code painted, once it had');

    const none = await look({ lens: { filter: { text: 'nothing is called this zzqx' } } });
    assert.equal(none.state, 'empty', JSON.stringify({ ...none, image: undefined }));
    // A show with a look points the owner's screen and answers with the same kind of picture.
    const shown = (await call('/agent/report', undefined, { actor: 'robot', action: 'show', params: { entity: made.f, look: true } })).result;
    assert.equal(shown.hash, `v?canvas=${made.f}`);
    assert.equal(shown.state, 'drawn');
  } finally {
    reader.close();
  }
});
