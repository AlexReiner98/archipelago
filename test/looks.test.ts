// What a view looks like, for an agent (src/looks.ts, decision e_wsz3wdzp): drawn by the server in its own headless
// Chrome, from the app's page in look mode, with a pass that reads as the asking agent and only reads. Without a
// browser: what a pass may read and call, and the picture going out as an MCP image. In a real browser (skipped where
// there is no Chrome): a flow, a style whose own code paints its canvas, and a lens that finds nothing, each taken once
// the page says it has drawn, with no page of the owner's open.

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createToken } from '../src/auth.ts';
import { chromeBinary } from '../src/chrome.ts';
import { askedFace, fellBack, stopLayout } from '../src/look-draw.ts';
import { passFor } from '../src/looks.ts';
import { contentOf } from '../src/mcp.ts';
import { open } from './browser.ts';
import { serve } from './serve.ts';

after(stopLayout);

test('a look pass reads as its agent’s person, only through /api, and only what the canvas reads', async () => {
  const { workspaces, call, member } = await serve('tokens');
  const db = (await workspaces.get('default')).pelago.db;
  const owner = (await createToken(db, 'default', { kind: 'human', name: 'owner', admin: true })).token;
  const sam = await member(owner, { email: 'sam@example.com', name: 'Sam' });
  const kim = await member(owner, { email: 'kim@example.com', name: 'Kim' });
  const samId = (await call('/whoami', sam, undefined, 'GET')).actor.person as string;
  const make = async (token: string, title: string) => ((await call('/api/change', token, { reason: 'test', ops: [{ op: 'create', ref: 'x', type: 'task', title, visibility: 'private' }] })).result.created as Record<string, string>).x;
  const [mine, theirs] = [await make(sam, 'Sam’s own'), await make(kim, 'Kim’s own')];
  const pass = await passFor(db, { workspace: 'default', viewer: samId }, 'claude/look');
  // It reads the map as Sam does: their private item, not Kim's.
  const flat = (await call('/api/view', pass, { name: 'flat', params: { filter: { find: [`id ${mine}`, `id ${theirs}`] } } })).result;
  assert.deepEqual(flat.items.map((i: { id: string }) => i.id), [mine]);
  // It asks what a reader frame asks: whether a document is published (the pages, ui/reader-frame.js).
  assert.deepEqual((await call('/api/published', pass, { id: mine })).result, { published: false, publishable: false });
  // It writes nothing, and is no token anywhere but the page's reads.
  const refused = await call('/api/change', pass, { reason: 'test', ops: [{ op: 'create', type: 'task', title: 'From a look' }] });
  assert.equal(refused.status, 403);
  assert.match(refused.error, /A look reads/);
  for (const path of ['/agent/query', '/mcp']) assert.equal((await call(path, pass, { name: 'search', params: {} })).status, 401, `${path} takes no look pass`);
  // One nobody made, or for another workspace, is no pass.
  assert.equal((await call('/api/view', `look_default_${'0'.repeat(40)}`, { name: 'flat', params: { filter: { find: [`id ${mine}`] } } })).status, 401);
  assert.equal((await call('/api/view', pass.replace('look_default_', 'look_acme_'), { name: 'flat', params: { filter: { find: [`id ${mine}`] } } })).status, 401);
});

test('a picture in a tool’s answer goes to MCP as an image of its own, out of the text', () => {
  const [text, image] = contentOf({ look: 'l_0123456789ab', state: 'drawn', image: { data: 'AAAA', content_type: 'image/png' } });
  assert.deepEqual(image, { type: 'image', data: 'AAAA', mimeType: 'image/png' });
  assert.equal(text.type, 'text');
  assert.deepEqual(JSON.parse((text as { text: string }).text), { look: 'l_0123456789ab', state: 'drawn' });
  assert.equal(contentOf({ a: 1 }).length, 1);
});

test('a face asked for is the first named in its family, and fell back when Chrome drew none of it', () => {
  assert.equal(askedFace("Georgia, 'Noto Serif', serif"), 'Georgia');
  assert.equal(askedFace('"Iowan Old Style", serif'), 'Iowan Old Style');
  // A family that starts with the system's face, or a generic, asks for whatever the machine has.
  for (const family of ["system-ui, -apple-system, 'Segoe UI', sans-serif", 'ui-monospace, Consolas, monospace', 'serif']) assert.equal(askedFace(family), null, family);
  assert.equal(fellBack('Georgia', [{ familyName: 'DejaVu Serif' }]), true);
  assert.equal(fellBack('Georgia', [{ familyName: 'georgia' }, { familyName: 'Segoe UI Symbol' }]), false);
  // A web font of the page's own is named inside its file, not by its family: it is what was asked for.
  assert.equal(fellBack('House', [{ familyName: 'Inter', isCustomFont: true }]), false);
  assert.equal(fellBack('Georgia', []), false);
});

const browser = chromeBinary();
const PNG = /^iVBORw0KGgo/;

test('in a browser, a look is the view as drawn: a flow, a style’s own code, a lens that finds nothing', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const steps = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'a', type: 'task', title: 'First step' },
      { op: 'create', ref: 'b', type: 'task', title: 'Second step' },
      { op: 'link', type: 'depends_on', from: 'b', to: 'a' },
    ],
  })).result.created as Record<string, string>;
  const lens = { filter: { find: [`id ${steps.a}`] }, walk: { over: ['depends_on'], steps: 1 } };
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'f', type: 'lens', title: 'The steps', status: 'current', props: lens },
      { op: 'create', ref: 'c', type: 'lens', title: 'The steps, painted', status: 'current', props: lens },
      // It paints only after a wait, as code that loads or lays out first does: the look waits for it.
      { op: 'create', ref: 's', type: 'style', title: 'Painted', status: 'current', props: { code: "export default async function draw({ canvas }) { await new Promise((r) => setTimeout(r, 1500)); const c = canvas.getContext('2d'); c.fillStyle = '#ff00ff'; c.fillRect(0, 0, canvas.width, canvas.height); }" } },
    ],
  })).result.created as Record<string, string>;
  await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: made.c, props: { style: { style: made.s } } }] });
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

    const none = await look({ lens: { filter: { find: ['text nothing is called this zzqx'] } } });
    assert.equal(none.state, 'empty', JSON.stringify({ ...none, image: undefined }));
    // A show with a look points the owner's screen and answers with the same kind of picture.
    const shown = (await call('/agent/report', undefined, { actor: 'robot', action: 'show', params: { entity: made.f, look: true } })).result;
    assert.equal(shown.hash, `v?canvas=${made.f}`);
    assert.equal(shown.state, 'drawn');
    // Fresh draws again, from look and from show alike, and every answer says when its picture was drawn.
    assert.equal(again.drawn_at, flow.drawn_at);
    const anew = await look({ entity: made.f, fresh: true });
    assert.notEqual(anew.look, flow.look);
    assert.ok(anew.drawn_at > flow.drawn_at, `${anew.drawn_at} after ${flow.drawn_at}`);
    const shownAnew = (await call('/agent/report', undefined, { actor: 'robot', action: 'show', params: { entity: made.f, look: true, fresh: true } })).result;
    assert.ok(shownAnew.look !== shown.look && !shownAnew.again, 'show with fresh draws again');
  } finally {
    reader.close();
  }
});

test('in a browser, a look of another workspace’s view draws it, and a document as it would publish, saying a face that fell back', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { workspaces, call } = await serve('tokens');
  const db = (await workspaces.create('acme', 'Acme')).pelago.db;
  const owner = (await createToken(db, 'acme', { kind: 'human', name: 'owner', admin: true })).token;
  const agent = (await createToken(db, 'acme', { kind: 'agent', name: 'robot' })).token;
  const made = (await call('/api/change', owner, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'a', type: 'work', title: 'Only in Acme' },
      { op: 'create', ref: 'd', type: 'document', title: 'Acme’s page', visibility: 'shared', body: 'What a reader reads.' },
      // The whole workspace asks for a face no machine has.
      { op: 'create', ref: 's', type: 'style', title: 'Nowhere', status: 'current', props: { faces: { text: "'Nowhere Zq', serif" } } },
    ],
  })).result.created as Record<string, string>;
  made.v = (await call('/api/change', owner, { reason: 'test', ops: [{ op: 'create', ref: 'v', type: 'lens', title: 'Acme’s view', status: 'current', props: { filter: { find: [`id ${made.a}`] } } }] })).result.created.v;
  const look = (params: Record<string, unknown>) => call('/agent/query', agent, { name: 'look', params }).then((r) => r.result ?? r);
  const view = await look({ entity: made.v });
  assert.equal(view.state, 'drawn', JSON.stringify({ ...view, image: undefined }));
  assert.equal(view.workspace, 'acme');
  const page = await look({ entity: made.d, published: true });
  assert.equal(page.state, 'drawn', JSON.stringify({ ...page, image: undefined }));
  assert.equal(page.view, `preview/${made.d}`);
  assert.match(page.image?.data ?? '', PNG);
  assert.ok(page.fell_back?.some((f: { asked: string }) => f.asked === 'Nowhere Zq'), JSON.stringify(page.fell_back));
});
