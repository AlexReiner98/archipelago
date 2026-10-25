// A page stays still while the map changes under it. The pulse says what the changes since the last look touched
// (src/touched.ts); in a real browser (skipped where there is no Chrome), an item's page left open while three agents
// write elsewhere is not drawn again, is not taken to what they changed, and a change to an item on it shows in place,
// with nothing reloaded and an open fold left open.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { touched } from '../src/touched.ts';
import { chrome, open } from './browser.ts';
import { fresh, make } from './map.ts';
import { serve } from './serve.ts';

test('the pulse says which items the changes since a look touched: what changed and both ends of a link', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'work.project', title: 'P' },
    { op: 'create', ref: 'q', type: 'work.project', title: 'Q' },
  ]);
  const { seq } = await touched(l.db);
  assert.deepEqual(await touched(l.db, seq), { seq, ids: [], made: 0 }, 'nothing changed since');
  const more = await make(l, [
    { op: 'create', ref: 't', type: 'work.task', title: 'T' },
    { op: 'link', type: 'part_of', from: 't', to: made.p },
  ]);
  const after = await touched(l.db, seq);
  assert.ok(after.seq > seq);
  assert.ok(after.ids!.includes(more.t) && after.ids!.includes(made.p), 'the new item and what it was linked to');
  assert.ok(!after.ids!.includes(made.q), 'not what was left alone');
  assert.equal(after.made, 1);
});

const browser = chrome();

test('in a browser, a page left open is still while agents write elsewhere, and shows a change on it in place', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  // As under the dev server: what agents change applies at once.
  await call('/api/workspace_set', undefined, { agent_changes: 'apply' });
  const change = async (actor: string, ops: unknown[]) => {
    const res = (await (await fetch(`${base}/agent/change`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor, reason: 'test', ops }) })).json()) as any;
    assert.equal(res.result?.status, 'applied', JSON.stringify(res));
    return res.result.created as Record<string, string>;
  };
  const made = await change('agent:setup', [
    { op: 'create', ref: 'p', type: 'work.project', title: 'Read here', body: 'What it is.\n\nA part of it\nFolded until it is asked for.' },
    { op: 'create', ref: 't', type: 'work.task', title: 'On the page' },
    { op: 'link', type: 'part_of', from: 't', to: 'p' },
    { op: 'create', ref: 'q', type: 'work.project', title: 'Elsewhere' },
    { op: 'create', ref: 'u', type: 'work.task', title: 'Away' },
    { op: 'link', type: 'part_of', from: 'u', to: 'q' },
  ]);
  const page = await open(`${base}/#/e/${made.p}`);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (expression: string) => {
    for (const end = Date.now() + 15000; Date.now() < end; await wait(200)) if (await page.evaluate(expression)) return true;
    return false;
  };
  try {
    assert.ok(await until(`document.querySelector('.part[data-part="item"] h1')?.textContent === 'Read here' && document.querySelector('main').textContent.includes('On the page')`), 'the page is drawn');
    await wait(2500);
    await page.evaluate(`(() => {
      window.stillMark = 1;
      window.swaps = 0;
      new MutationObserver((list) => (window.swaps += list.reduce((n, m) => n + m.addedNodes.length, 0))).observe(document.querySelector('.part[data-part="item"]'), { childList: true });
      const part = [...document.querySelectorAll('.part[data-part="item"] details.section')].at(-1);
      part.open = true;
    })()`);
    // Three agents at once, each changing what is not on the page, for a few pulses.
    for (let n = 1; n <= 4; n++) {
      await Promise.all(['agent:a', 'agent:b', 'agent:c'].map((actor, k) => change(actor, [{ op: 'update', id: k === 2 ? made.q : made.u, title: `Away ${actor} ${n}` }])));
      await wait(1000);
    }
    await wait(2500);
    const still = await page.evaluate<{ mark: number; swaps: number; hash: string; following: boolean }>(`({ mark: window.stillMark, swaps: window.swaps, hash: location.hash, following: document.querySelector('#follow input').checked })`);
    assert.deepEqual(still, { mark: 1, swaps: 0, hash: `#/e/${made.p}`, following: false }, 'not reloaded, not drawn again, not taken elsewhere: with three agents at work, nothing is followed unless the reader asks');
    // A change to what is on the page shows on it, in place.
    await change('agent:a', [{ op: 'update', id: made.t, title: 'Renamed on the page' }]);
    assert.ok(await until(`document.querySelector('main').textContent.includes('Renamed on the page')`), 'the change shows');
    const after = await page.evaluate<{ mark: number; open: boolean }>(`({ mark: window.stillMark, open: [...document.querySelectorAll('.part[data-part="item"] details.section')].at(-1).open })`);
    assert.deepEqual(after, { mark: 1, open: true }, 'not reloaded, the open fold still open');
  } finally {
    page.close();
  }
});
