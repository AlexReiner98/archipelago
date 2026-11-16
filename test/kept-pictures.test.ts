// The page keeps each answer's picture (task e_vc8nnf8g), in a real browser (skipped where there is no Chrome): a
// canvas gone back to is mounted from the scene its drawing answered before, with no layout run, and so is one on a
// page loaded again, from the browser's storage (task e_7as2t6eq); an answer that changed is laid out as ever, and a
// page whose storage is refused draws as it would without it. The drawing measure (`drawing <id>`, packs/walls/page/layout.js) says which: a kept
// picture is measured with `kept` and took nothing in the drawing.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createToken } from '../packs/identity/kernel/auth.ts';
import { chrome, open, pageModule } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

/** What this browser keeps of each picture (packs/walls/page/pictures-kept.js): `field` of each, in a page. */
const keptOf = (field: string) => `(async () => {
  if (!(await indexedDB.databases()).some((d) => d.name === 'pelago-pictures')) return [];
  return new Promise((r) => { const q = indexedDB.open('pelago-pictures'); q.onerror = () => r([]); q.onsuccess = () => { if (!q.result.objectStoreNames.contains('names')) return (q.result.close(), r([])); const all = q.result.transaction('names').objectStore('names').getAll(); all.onsuccess = () => (q.result.close(), r(all.result.map((n) => n.${field}))); }; });
})()`;
const keptNames = keptOf('name'), keptScopes = keptOf('scope');

test('in a browser, a canvas gone back to or loaded again is not laid out again, and a changed answer is', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'site', type: 'aim', title: 'Site works' },
      { op: 'create', ref: 'roof', type: 'task', title: 'Roof frame' },
      { op: 'create', ref: 'wall', type: 'task', title: 'Wall' },
      { op: 'create', ref: 'beam', type: 'task', title: 'Beam' },
      { op: 'link', type: 'part_of', from: 'roof', to: 'site' },
      { op: 'link', type: 'part_of', from: 'wall', to: 'site' },
      { op: 'link', type: 'depends_on', from: 'roof', to: 'beam' },
    ],
  })).result.created as Record<string, string>;
  const first = `#/v?find=in+${made.site}`;
  const page = await open(`${base}/${first}`);
  const drawn = `[...document.querySelectorAll('#canvas svg a')].map((a) => a.textContent)`;
  const has = (title: string) => `${drawn}.some((t) => t.includes(${JSON.stringify(title)}))`;
  const measures = `performance.getEntriesByType('measure').filter((m) => m.name.startsWith('drawing ')).map((m) => ({ kept: Boolean(m.detail?.kept), drawing: m.detail?.drawing, stored: Boolean(m.detail?.stored) }))`;
  try {
    assert.ok(await page.until(`${has('Wall')} && ${has('Roof frame')}`, 30000), `the canvas is drawn: ${page.logs().join('\n')}`);
    assert.ok(await page.until(`${measures}.length >= 1`), 'its drawing is measured');
    // Another canvas, then back: the first is mounted from what was kept.
    await page.evaluate(`performance.clearMeasures(); location.hash = '#/v?find=type+task'`);
    assert.ok(await page.until(`${has('Beam')} && ${measures}.length >= 1`, 30000), `the second canvas is drawn: ${page.logs().join('\n')}`);
    await page.evaluate(`performance.clearMeasures(); performance.clearMarks('drawing-begun'); history.back()`);
    const back = `${has('Wall')} && !${has('Beam')}`;
    assert.ok(await page.until(`${back} && ${measures}.length >= 1`, 30000), `the first canvas is back: ${await page.evaluate(`JSON.stringify([location.hash, ${drawn}, ${measures}])`)} ${page.logs().join('\n')}`);
    // Nothing more comes: the drawing is not run behind the picture kept.
    await new Promise((r) => setTimeout(r, 1500));
    assert.deepEqual(await page.evaluate(measures), [{ kept: true, drawing: 0, stored: false }], 'gone back to, the canvas is mounted from what was kept, with no layout');
    const begun = `performance.getEntriesByName('drawing-begun').length`;
    assert.equal(await page.evaluate(begun), 0, 'its drawing is not started');
    // Asked something (a step hovered), the drawing is started then, and answers.
    await page.evaluate(`document.querySelector('#canvas svg a').dispatchEvent(new MouseEvent('mouseenter'))`);
    assert.ok(await page.until(`${begun} === 1`, 5000), 'hovered, its drawing is started');
    assert.ok(await page.until(`document.querySelector('#canvas .lighting')`, 30000), `and answers the hover: ${page.logs().join('\n')}`);
    await page.evaluate(`document.querySelector('#canvas svg a').dispatchEvent(new MouseEvent('mouseleave'))`);

    // An answer that changed is laid out as ever.
    await page.evaluate('performance.clearMeasures()');
    await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: made.wall, title: 'Wall north' }] });
    assert.ok(await page.until(`${has('Wall north')} && ${measures}.length >= 1`, 30000), `the changed answer is drawn: ${page.logs().join('\n')}`);
    assert.deepEqual((await page.evaluate<{ kept: boolean }[]>(measures)).map((m) => m.kept), [false], 'a changed answer is laid out');

    // Loaded again, the page mounts the picture this browser kept, with no layout. Kept when the page is idle: waited for.
    // The picture on screen is kept under the name it was drawn by (`drawn` on its host).
    const keptNow = `(async () => {
      const drawn = [...document.querySelectorAll('#canvas *')].find((e) => e.drawn)?.drawn;
      return drawn && (await ${keptNames}).includes(drawn);
    })()`;
    // Loaded again: waited for on the new page, not the one before it, which drew the same.
    const reloaded = async () => {
      await page.evaluate('window.before = true');
      await page.send('Page.reload');
      return page.until(`!window.before && ${has('Wall north')} && ${measures}.length >= 1`, 30000);
    };
    // The answer the page kept current from the log may hold its items in another order than one read afresh (the
    // item just changed comes first): another answer, so another picture. One load reads it afresh, and keeps its picture.
    assert.ok(await reloaded(), `loaded again, the canvas is drawn: ${page.logs().join('\n')}`);
    assert.ok(await page.until(keptNow, 15000), `the picture on screen is kept in this browser: ${await page.evaluate(`JSON.stringify(${keptNames})`)}`);
    await page.evaluate('performance.clearMeasures()');
    assert.ok(await reloaded(), `loaded again, the canvas is drawn: ${page.logs().join('\n')}`);
    await new Promise((r) => setTimeout(r, 1500));
    assert.deepEqual(await page.evaluate(measures), [{ kept: true, drawing: 0, stored: true }], 'loaded again, the canvas is mounted from storage, with no layout');
    assert.equal(await page.evaluate(begun), 0, 'and its drawing is not started');

    // Storage refused (a private window, blocked site data): the page lays the canvas out, as it would without it.
    await page.send('Page.addScriptToEvaluateOnNewDocument', { source: "Object.defineProperty(window, 'indexedDB', { get() { throw new DOMException('refused', 'SecurityError'); } })" });
    assert.ok(await reloaded(), `with storage refused, the canvas is drawn: ${page.logs().join('\n')}`);
    assert.deepEqual((await page.evaluate<{ kept: boolean }[]>(measures)).map((m) => m.kept), [false], 'with storage refused, it is laid out');
    assert.ok(await page.evaluate(`!document.querySelector('.lens-error')`), 'and nothing stopped');
  } finally {
    await page.close();
  }
});


test('in a browser, signing out or in as another lets go of the pictures kept, so none is drawn for the next person', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { workspaces, call, base, member } = await serve('tokens');
  const db = (await workspaces.get('default')).pelago.db;
  const owner = (await createToken(db, 'default', { kind: 'human', name: 'owner', admin: true })).token;
  const sam = await member(owner, { email: 'sam@example.com', name: 'Sam' });
  const kim = await member(owner, { email: 'kim@example.com', name: 'Kim' });
  const samIs = (await call('/whoami', sam, undefined, 'GET')).actor.person as string;
  await call('/api/change', sam, { reason: 'test', ops: [{ op: 'create', type: 'task', title: 'Sam secret plan', visibility: 'private' }, { op: 'create', type: 'task', title: 'Shared step' }] });
  const canvas = '#/v?find=type+task';
  const page = await open(`${base}/`);
  const drawn = `[...document.querySelectorAll('#canvas svg a')].map((a) => a.textContent)`;
  const has = (title: string) => `${drawn}.some((t) => t.includes(${JSON.stringify(title)}))`;
  const measures = `performance.getEntriesByType('measure').filter((m) => m.name.startsWith('drawing ')).map((m) => ({ kept: Boolean(m.detail?.kept), stored: Boolean(m.detail?.stored) }))`;
  const base_ = `(await ${pageModule('base.js')})`;
  // Signed in as `token` the way the page enters a workspace: the token kept, and the page loaded again on the canvas.
  const signIn = async (token: string) => {
    await page.evaluate(`(async () => { window.before = true; ${base_}.store.token = ${JSON.stringify(token)}; history.replaceState(null, '', ${JSON.stringify(canvas)}); setTimeout(() => location.reload()); })()`);
    // Waited for on the new page, not the one before it.
    assert.ok(await page.until(`!window.before && document.readyState === 'complete'`, 30000), 'the page is loaded again');
  };
  const scopes = () => page.evaluate<string[]>(keptScopes);
  try {
    await signIn(sam);
    assert.ok(await page.until(`${has('Sam secret plan')}`, 30000), `Sam's canvas is drawn: ${page.logs().join('\n')}`);
    assert.ok(await page.until(`${keptScopes}.then((s) => s.length >= 1)`, 15000), 'and its picture is kept');
    assert.ok((await scopes()).every((s) => s.endsWith(`|${samIs}`)), 'kept as Sam\'s');

    // Signed out: nothing is kept.
    await page.evaluate(`(async () => { ${base_}.store.token = ''; })()`);
    assert.ok(await page.until(`${keptScopes}.then((s) => s.length === 0)`, 10000), `signed out, nothing is kept: ${JSON.stringify(await scopes())}`);

    // Sam again, then Kim straight after, with no sign-out between: nothing of Sam's is kept or drawn for Kim.
    await signIn(sam);
    assert.ok(await page.until(`${has('Sam secret plan')}`, 30000), 'Sam\'s canvas is drawn again');
    assert.ok(await page.until(`${keptScopes}.then((s) => s.length >= 1)`, 15000), 'and kept again');
    await signIn(kim);
    assert.ok(await page.until(`${has('Shared step')} && ${measures}.length >= 1`, 30000), `Kim's canvas is drawn: ${page.logs().join('\n')}`);
    assert.ok(!(await page.evaluate(has('Sam secret plan'))), 'Sam\'s private step is not drawn for Kim');
    assert.deepEqual(await page.evaluate(measures), [{ kept: false, stored: false }], 'Kim\'s canvas is laid out, not given back from Sam\'s');
    assert.ok((await scopes()).every((s) => !s.endsWith(`|${samIs}`)), `nothing of Sam's is kept: ${JSON.stringify(await scopes())}`);
  } finally {
    await page.close();
  }
});
