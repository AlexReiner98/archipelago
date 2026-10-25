// What still drew from the old lens, drawn from flat lenses (task e_vtvhebut), in a real browser (skipped where there
// is no Chrome): a document's kept view, drawn where its line names it, nested as before; and the pictures the packs'
// screens draw: the software pack's Releases on Home, the time pack's Invoices on a company, only invoices.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

test('in a browser, a document draws its kept view, and the packs’ screens draw their pictures, from flat lenses', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
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
    // The document: its kept view drawn where its line names it, the parts inside the place they are part of.
    assert.ok(await until(`document.querySelectorAll('.doc-lens .lf-stage a.ar-part').length === 2`), `the view is drawn in the document: ${page.logs().join('\n')}`);
    assert.ok(await page.evaluate<boolean>(`Boolean(document.querySelector('.doc-lens .lf-stage .ar-place-box'))`), 'the server a place holding them');

    // Home: the software pack's Releases, the open ones.
    await page.go(`${base}/#/v?ids=${made.p}`);
    await page.go(`${base}/#/you`);
    assert.ok(await until(linked('.lens-card', made.r)), `Releases drawn on Home: ${page.logs().join('\n')}`);
    assert.ok(!(await page.evaluate<boolean>(linked('.lens-card', made.old))), 'not what has happened');

    // A company: the time pack's Invoices, what is part of it and is an invoice.
    await page.go(`${base}/#/e/${made.co}`);
    assert.ok(await until(linked('.lens-card', made.inv)), `Invoices drawn on the company: ${page.logs().join('\n')}`);
    assert.ok(!(await page.evaluate<boolean>(linked('.lens-card', made.job))), 'only invoices');
  } finally {
    page.close();
  }
});
