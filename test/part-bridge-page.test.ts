// The bridge, in a real browser (packs/surface/page/part-bridge.js, packs/surface/page/part-going.js; task e_9ests3je): a part in its version's walled
// worker sends its pack's action over its port, and the page sends it as the person looking. One it sends on its own is
// shown going out at the canvas's foot; one after a press is not; one its pack does not declare for it is refused
// before anything is sent. The server's side is test/part-bridge.test.ts.

import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { Registry, type PackFile } from '../packs/loader/kernel/packs.ts';
import { hostFor } from '../packs/loader/kernel/packtools.ts';
import { partsFor } from '../packs/loader/kernel/ui-parts.ts';
import { chrome, open } from './browser.ts';
import { packsWith } from './map.ts';
import { serve } from './serve.ts';

const browser = chrome();

const input = { type: 'object', properties: { title: { type: 'string' } }, additionalProperties: false };
const shelf = {
  id: 'shelf', version: '1.0.0', title: 'Shelf', description: 'A part of the page.', requires: ['core'],
  actions: [
    { id: 'shelf.put', title: 'Put', description: 'Put it.', verb: 'capture', input },
    { id: 'shelf.other', title: 'Other', description: 'Not the part’s.', verb: 'capture', input },
  ],
  parts: [{ id: 'shelf.row', title: 'Row', slot: 'sheet', marks: ['box', 'text', 'button'], sends: ['shelf.put'], modules: { 'index.js': 'parts/row/index.js' } }],
};
/** The part: it sends on its own once mounted, and again on each event, the action the event names. */
const PART = `export default function row(input, tools) {
  setTimeout(async () => tools.marks('own ' + JSON.stringify(await tools.act('shelf.put', { title: 'On its own' }))), 0);
  return { marks: 'mounted', on: async (e) => e.name + ' ' + JSON.stringify(await tools.act(e.action, { title: 'Pressed' })) };
}
`;

test('in a browser, a part’s own change is shown going out, a pressed one is not, an undeclared one is refused', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const dir = packsWith(shelf as unknown as PackFile);
  writeFileSync(join(dir, 'shelf', 'handler.js'), "const put = (i) => ({ ops: [{ op: 'create', type: 'task', title: i.title ?? 'Put' }], reason: 'Put on the shelf' });\nexport default { 'shelf.put': put, 'shelf.other': put };\n");
  mkdirSync(join(dir, 'shelf', 'parts', 'row'), { recursive: true });
  writeFileSync(join(dir, 'shelf', 'parts', 'row', 'index.js'), PART);
  const reg = new Registry(dir);
  // The test pack's part: the repository's packs ship parts beside it (findings's).
  const row = partsFor(reg).find((p) => p.pack === 'shelf')!;
  hostFor(reg).stop();
  const { base } = await serve('off', undefined, undefined, dir);
  const page = await open(`${base}/`);
  try {
    const got: any = await page.evaluate(`(async () => {
      await (await import('/base.js')).loadMay();
      const { partPort } = await import('/layout.js');
      const { partBridge } = await import('/part-bridge.js');
      const port = await partPort('shelf@1', { 'shelf.row': ${JSON.stringify(row.modules)} });
      const part = ${JSON.stringify({ id: row.id, title: row.title, sends: row.sends, hash: row.hash })};
      const bridge = partBridge(port, { partOf: (id) => (id === 'a' ? part : null) });
      const said = [];
      port.onmessage = (ev) => bridge.heard(ev.data) || said.push(ev.data);
      const wait = async (n) => { for (let i = 0; i < 400 && said.filter((m) => m.type === 'marks').length < n; i++) await new Promise((r) => setTimeout(r, 25)); };
      const rows = () => [...document.querySelectorAll('.part-going-row')].map((r) => r.textContent);
      bridge.send({ type: 'mount', id: 'a', part: 'shelf.row', input: {} });
      await wait(2);
      const own = rows();
      bridge.send({ type: 'event', id: 'a', event: { name: 'press', action: 'shelf.put' } });
      await wait(3);
      bridge.send({ type: 'event', id: 'a', event: { name: 'other', action: 'shelf.other' } });
      await wait(4);
      return { marks: said.filter((m) => m.type === 'marks').map((m) => m.marks), errors: said.filter((m) => m.type === 'error'), own, after: rows() };
    })()`);
    assert.deepEqual(got.errors, []);
    const [, own, pressed, other] = got.marks;
    assert.match(own, /^own .*"status":"applied"/, own);
    assert.match(pressed, /^press .*"status":"applied"/, pressed);
    assert.match(other, /^other .*does not send/, other);
    assert.deepEqual(got.own, ['Row · Putsent'], 'its own change is shown, with what came of it');
    assert.deepEqual(got.after, ['Row · Putsent'], 'a pressed one and a refused one add no line');
  } finally {
    await page.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('in a browser, a part that declares go moves the page after a press or Enter, never on its own', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base } = await serve('off');
  const page = await open(`${base}/`);
  try {
    const got: any = await page.evaluate(`(async () => {
      const { partBridge } = await import('/part-bridge.js');
      const went = [];
      const parts = { a: { id: 'shelf.find', title: 'Find', go: true }, b: { id: 'shelf.row', title: 'Row' } };
      const bridge = partBridge({ postMessage() {} }, { partOf: (id) => parts[id], go: (address) => went.push(address) });
      const to = (id, n) => bridge.heard({ type: 'go', id, address: { query: { filter: { find: ['type task'] } }, n } });
      to('a', 'unasked');
      bridge.send({ type: 'event', id: 'a', event: { name: 'edit', value: 'ta' } });
      to('a', 'typing');
      bridge.send({ type: 'event', id: 'a', event: { name: 'submit', value: 'task' } });
      to('a', 'enter');
      to('a', 'again');
      bridge.send({ type: 'event', id: 'a', event: { name: 'press' } });
      to('a', 'press');
      bridge.send({ type: 'event', id: 'b', event: { name: 'press' } });
      to('b', 'undeclared');
      return went.map((a) => a.n);
    })()`);
    assert.deepEqual(got, ['enter', 'press'], 'one move for each press or Enter, none unasked, none from a part that does not declare go');
  } finally {
    await page.close();
  }
});

test('in a browser, a press that sent an action may move the page once it answers, however long it took', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base } = await serve('off');
  const page = await open(`${base}/`);
  try {
    const got: any = await page.evaluate(`(async () => {
      const { partBridge } = await import('/part-bridge.js');
      // The action answers late, as a save does on a loaded machine: past the moment a press lets a part move the page.
      const fetched = window.fetch;
      window.fetch = (url, init) => String(url).includes('/api/shelf_put') ? new Promise((done) => setTimeout(() => done(new Response(JSON.stringify({ status: 'applied', created: { view: 'e_aaaaaaaa' } }), { headers: { 'content-type': 'application/json' } })), 2300)) : fetched(url, init);
      const went = [];
      const parts = { a: { id: 'shelf.band', title: 'Band', go: true, sends: ['shelf.put'] } };
      const answered = [];
      const bridge = partBridge({ postMessage: (m) => answered.push(m) }, { partOf: (id) => parts[id], go: (address) => went.push(address) });
      const to = (n) => bridge.heard({ type: 'go', id: 'a', address: { query: { filter: { find: ['type task'] } }, n } });
      const acted = (n) => new Promise((done) => { const t = setInterval(() => answered.length >= n && (clearInterval(t), done()), 20); });
      // Pressed: the action goes, answers late, and the part's move after its answer is the press's.
      bridge.send({ type: 'event', id: 'a', event: { name: 'press' } });
      bridge.heard({ type: 'act', id: 'a', asked: 1, action: 'shelf.put', params: {} });
      await acted(1);
      to('after the press');
      // Of its own accord: the action goes and answers, and a move after it is still refused.
      bridge.heard({ type: 'act', id: 'a', asked: 2, action: 'shelf.put', params: {} });
      await acted(2);
      to('own accord');
      window.fetch = fetched;
      return went.map((a) => a.n);
    })()`);
    assert.deepEqual(got, ['after the press'], 'the pressed action’s move goes, its own accord’s does not');
  } finally {
    await page.close();
  }
});
