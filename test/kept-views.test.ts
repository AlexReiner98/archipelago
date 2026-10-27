// What still drew from the old lens, drawn from flat lenses (task e_vtvhebut), in a real browser (skipped where there
// is no Chrome): a document's kept view, opened as a canvas, drawn flat; and the pictures the packs' screens draw on Home
// (the software pack's Releases). An item's page is bare (task e_cbjpfd2f; the owner, 26 Oct 2026: bare means bare):
// a company's page draws no pack's screen. A document's sheet reads it as it will publish, its view drawn (the owner,
// 27 Oct 2026).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

test('in a browser, a document’s kept view is drawn as a canvas, the packs’ screens draw Home, and an item’s page is bare', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { call, base } = await serve('off');
  const change = async (body: unknown) => {
    const got = await call('/api/change', undefined, body);
    assert.ok(got.result?.created, JSON.stringify(got.error ?? got));
    return got.result.created as Record<string, string>;
  };
  const made = await change({
    reason: 'test',
    ops: [
      { op: 'create', ref: 'p', type: 'work.project', title: 'A system' },
      { op: 'create', ref: 'e', type: 'software.environment', title: 'A server', status: 'up' },
      { op: 'create', ref: 'a', type: 'software.component', title: 'Doors', status: 'up' },
      { op: 'create', ref: 'b', type: 'software.component', title: 'Store', status: 'up' },
      { op: 'link', type: 'part_of', from: 'e', to: 'p' },
      { op: 'link', type: 'part_of', from: 'a', to: 'e' },
      { op: 'link', type: 'part_of', from: 'b', to: 'e' },
      { op: 'link', type: 'software.calls', from: 'a', to: 'b' },
      { op: 'create', ref: 'r', type: 'software.release', title: 'Version 2.0' },
      { op: 'create', ref: 'old', type: 'software.release', title: 'Version 0.1', status: 'happened' },
      { op: 'create', ref: 'co', type: 'company', title: 'Client Co' },
      { op: 'create', ref: 'inv', type: 'time.invoice', title: 'Invoice INV-2026-001: Client Co', status: 'draft' },
      { op: 'create', ref: 'job', type: 'work.project', title: 'A job for them' },
      { op: 'link', type: 'part_of', from: 'inv', to: 'co' },
      { op: 'link', type: 'part_of', from: 'job', to: 'co' },
    ],
  });
  const kept = await change({
    reason: 'test',
    ops: [
      { op: 'create', ref: 'l', type: 'lens', title: 'What talks to what', status: 'current', props: { filter: { ids: [made.p] }, walk: { over: ['part_of', 'software.calls'], steps: 3 }, style: { shape: 'architecture' } } },
      { op: 'link', type: 'about', from: 'l', to: made.p },
      { op: 'create', ref: 'd', type: 'work.document', title: 'How it works', body: `Opening words.\n\n{l}\n\nClosing words.` },
      // Home is the owner's to fill: Releases put on it.
      { op: 'create', type: 'screen', title: 'Releases', status: 'current', props: { preset: 'software.releases', home: true } },
    ],
  });
  const page = await open(`${base}/#/e/${kept.d}`);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (expression: string, ms = 20000) => {
    for (const end = Date.now() + ms; Date.now() < end; await wait(150)) if (await page.evaluate(expression)) return true;
    return false;
  };
  const linked = (scope: string, id: string) => `Boolean(document.querySelector('${scope} a[href="#/e/${id}"]'))`;
  try {
    // The document: its page in the sheet reads it as it will publish, its words and its view drawn in its place
    // (the owner, 27 Oct 2026: a document is reviewed in its sheet as it will publish).
    assert.ok(await until(`(document.querySelector('#sheet')?.textContent ?? '').includes('Closing words')`), `the document's words: ${page.logs().join('\n')}`);
    assert.ok(await until(`Boolean(document.querySelector('#sheet .reading .doc-lens .lens-view')?.childElementCount)`), `its view drawn in the sheet: ${page.logs().join('\n')}`);
    // Its kept view, opened as a canvas: drawn flat (depth is never drawn on the canvas), the server and both parts.
    await page.go(`${base}/#/v?canvas=${kept.l}`);
    assert.ok(await until(`${linked('#canvas', made.a)} && ${linked('#canvas', made.b)} && ${linked('#canvas', made.e)}`), `the view is drawn as a canvas: ${page.logs().join('\n')}`);

    // Home: the software pack's Releases, the open ones.
    await page.go(`${base}/#/v?ids=${made.p}`);
    await page.go(`${base}/#/you`);
    assert.ok(await until(linked('.lens-card', made.r)), `Releases drawn on Home: ${page.logs().join('\n')}`);
    assert.ok(!(await page.evaluate<boolean>(linked('.lens-card', made.old))), 'not what has happened');

    // A company: its page is bare, with no pack's screen drawn on it.
    await page.go(`${base}/#/e/${made.co}`);
    assert.ok(await until(`(document.querySelector('#sheet')?.textContent ?? '').includes('Client Co')`), `the company's page: ${page.logs().join('\n')}`);
    assert.ok(!(await page.evaluate<boolean>(`Boolean(document.querySelector('#sheet .lens-card'))`)), 'no pack screen on a bare page');
  } finally {
    page.close();
  }
});
