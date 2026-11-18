// A look draws its taker's own live tries (report preview, packs/surface/kernel/tool-preview.ts), as their open page
// draws them, and names them (tries: [{ item, field }]); nobody else's look draws them, tries: false draws the map as it
// is, and nothing is logged. In a real browser (skipped where there is no Chrome).

import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createToken } from '../packs/identity/kernel/auth.ts';
import { stopLayout } from '../packs/look_draw/kernel/look-draw.ts';
import { setIslands } from '../packs/loader/kernel/packstate.ts';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

after(stopLayout);

// An island's look is handed a canvas of 1 by 1 and sizes it itself, to the surface (packs/canvas/layouts/flow/painted.js).
const paintIsle = (colour: string) => `export default function draw({ canvas, size }) { canvas.width = Math.round(size.width * (size.dpr || 1)); canvas.height = Math.round(size.height * (size.dpr || 1)); const c = canvas.getContext('2d'); c.fillStyle = '${colour}'; c.fillRect(0, 0, canvas.width, canvas.height); }`;
const paint = (colour: string) => `export default function draw({ canvas }) { const c = canvas.getContext('2d'); c.fillStyle = '${colour}'; c.fillRect(0, 0, canvas.width, canvas.height); }`;

test('in a browser, a look draws its taker’s own preview, and only theirs: a view’s layout and an island’s own look', { skip: !chrome() && 'no Chrome here (set CHROME)' }, async () => {
  const { workspaces, call, member } = await serve('tokens');
  const { pelago } = await workspaces.get('default');
  const db = pelago.db;
  await setIslands(pelago, 'system', true); // an island's own look is the second case
  const owner = (await createToken(db, 'default', { kind: 'human', name: 'owner', admin: true })).token;
  const agentOf = async (email: string, name: string) => {
    const person = (await call('/whoami', await member(owner, { email, name }), undefined, 'GET')).actor.person as string;
    return (await createToken(db, 'default', { kind: 'agent', name: `${name}’s agent`, entity: person })).token;
  };
  const [sam, kim] = [await agentOf('sam@example.com', 'Sam'), await agentOf('kim@example.com', 'Kim')];
  const islandOf = async (title: string) => (await call('/api/change', owner, { reason: 'test', ops: [{ op: 'create', ref: 'i', type: 'island', title, props: { pack: 'core' } }] })).result.created.i as string;
  const plainIsle = await islandOf('Plain isle');
  const made = (await call('/api/change', owner, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'a', type: 'task', title: 'A step', props: { island: plainIsle } },
      { op: 'create', ref: 's', type: 'layout', title: 'Painted', props: { code: paint('#ff00ff') } },
    ],
  })).result.created as Record<string, string>;
  const view = (await call('/api/change', owner, { reason: 'test', ops: [{ op: 'create', ref: 'c', type: 'lens', title: 'Painted step', props: { filter: { find: [`id ${made.a}`] }, style: { style: made.s } } }] })).result.created.c as string;
  const look = (token: string, params: Record<string, unknown> = {}) => call('/agent/query', token, { name: 'look', params: { entity: view, width: 800, height: 500, ...params } }).then((r) => r.result ?? r);
  const reader = await open('about:blank');
  const middle = (data: string) =>
    reader.evaluate<number[]>(`(async () => { const img = new Image(); img.src = 'data:image/png;base64,${data}'; await img.decode(); const c = document.createElement('canvas'); Object.assign(c, { width: img.width, height: img.height }); const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0); return [...ctx.getImageData(img.width >> 1, img.height >> 1, 1, 1).data.slice(0, 3)]; })()`);
  const count = (data: string, rgb: number[]) =>
    reader.evaluate<number>(`(async () => { const img = new Image(); img.src = 'data:image/png;base64,${data}'; await img.decode(); const c = document.createElement('canvas'); Object.assign(c, { width: img.width, height: img.height }); const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0); const px = ctx.getImageData(0, 0, img.width, img.height).data; let n = 0; for (let i = 0; i < px.length; i += 4) if (px[i] === ${rgb[0]} && px[i + 1] === ${rgb[1]} && px[i + 2] === ${rgb[2]}) n++; return n; })()`);
  const events = async () => JSON.stringify((await call('/agent/query', owner, { name: 'events', params: { limit: 1 } })).result);
  try {
    const before = await look(sam);
    assert.equal(before.state, 'drawn', JSON.stringify({ ...before, image: undefined }));
    assert.deepEqual(await middle(before.image.data), [255, 0, 255], 'the map’s code');
    assert.equal(before.tries, undefined, 'no try, none named');

    const head = await events();
    const sent = (await call('/agent/report', sam, { action: 'preview', params: { item: made.s, field: 'code', value: paint('#00ff00') } })).result;
    assert.equal(sent.previewing, true, JSON.stringify(sent));

    // Sam's look draws Sam's try, as Sam's open page would, and says so: kept, it keeps that it was a try.
    const tried = await look(sam, { keep: true });
    assert.equal(tried.state, 'drawn', JSON.stringify({ ...tried, image: undefined }));
    assert.deepEqual(await middle(tried.image.data), [0, 255, 0], 'the try painted');
    assert.deepEqual(tried.tries, [{ item: made.s, field: 'code' }]);
    assert.deepEqual(tried.errors, []);
    assert.notEqual(tried.look, before.look, 'a look with a try is not the one without');
    const kept = (await call('/agent/query', sam, { name: 'picture', params: { look: tried.kept.id } })).result;
    assert.deepEqual(kept.tries, [{ item: made.s, field: 'code' }], 'a kept look records the try');

    // Kim's look is the map's: Sam's try is Sam's alone.
    const theirs = await look(kim);
    assert.deepEqual(await middle(theirs.image.data), [255, 0, 255], 'nobody else’s look draws it');
    assert.equal(theirs.tries, undefined);

    // tries: false draws the map as it is.
    const plain = await look(sam, { tries: false });
    assert.deepEqual(await middle(plain.image.data), [255, 0, 255], 'tries: false is the map');
    assert.equal(plain.tries, undefined);

    assert.equal(await events(), head, 'a try and its looks log nothing');
    await call('/agent/report', sam, { action: 'preview', params: { item: made.s, field: 'code', discard: true } });
    assert.deepEqual(await middle((await look(sam)).image.data), [255, 0, 255], 'discarded, the map again');

    // An island's own look (a layout that draws it, packs/walls/page/island-looks.js) is drawn with a try too.
    const isle = await islandOf('Painted isle');
    const madeOwn = await call('/api/change', owner, {
      reason: 'test',
      ops: [
        { op: 'create', ref: 't', type: 'task', title: 'On the isle', props: { island: isle } },
        { op: 'create', ref: 'p', type: 'layout', title: 'Isle painter', props: { code: paintIsle('#0000ff') } },
        { op: 'link', type: 'draws', from: 'p', to: isle },
      ],
    });
    const own = madeOwn.result?.created as Record<string, string>;
    assert.ok(own, JSON.stringify(madeOwn));
    const isleLook = (params: Record<string, unknown> = {}) => look(sam, { entity: own.t, ...params });
    const mapIsle = await isleLook();
    assert.equal(mapIsle.state, 'drawn', JSON.stringify({ ...mapIsle, image: undefined }));
    assert.ok((await count(mapIsle.image.data, [0, 0, 255])) > 0, 'the island’s look painted it');
    await call('/agent/report', sam, { action: 'preview', params: { item: own.p, field: 'code', value: paintIsle('#ffff00') } });
    const triedIsle = await isleLook();
    assert.deepEqual(triedIsle.tries, [{ item: own.p, field: 'code' }]);
    assert.deepEqual([await count(triedIsle.image.data, [255, 255, 0]) > 0, await count(triedIsle.image.data, [0, 0, 255])], [true, 0], 'the try painted the island');
    assert.equal(await count((await isleLook({ tries: false })).image.data, [255, 255, 0]), 0, 'tries: false, the island as the map has it');
  } finally {
    await reader.close();
  }
});
