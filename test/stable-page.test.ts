// A page stays still while the map changes under it. It reads the log forward on what it shows (`tail`,
// packs/log/kernel/tail.ts); in a real browser (skipped where there is no Chrome), an item's page left open while three agents
// write elsewhere is not drawn again, is not taken to what they changed, and a change to an item on it shows in place,
// with nothing reloaded and an open fold left open. A store holding a flat lens's answer (packs/surface/page/replica.js) is brought up
// to date by an agent's change with no lens read.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { chrome, open } from './browser.ts';
import { heard } from './tab-page.ts';
import { fresh, human, make } from './map.ts';
import { serve } from './serve.ts';

test('the tail says what the changes since a look did to what is shown: what changed and the link made to it', async () => {
  const l = await fresh();
  const made = await make(l, [
    { op: 'create', ref: 'p', type: 'task', title: 'P' },
    { op: 'create', ref: 'q', type: 'task', title: 'Q' },
  ]);
  const tail = (input: Record<string, unknown>) => callTool(l, human, 'tail', input) as Promise<any>;
  const { pos, seq } = await tail({});
  const still = await tail({ after: pos, seq, ids: [made.p, made.q] });
  assert.deepEqual([still.pos, still.entries, still.events, still.made], [pos, [], [], 0], 'nothing changed since');
  const more = await make(l, [
    { op: 'create', ref: 't', type: 'task', title: 'T' },
    { op: 'link', type: 'part_of', from: 't', to: made.p },
  ]);
  const after = await tail({ after: pos, seq, ids: [made.p, made.q] });
  assert.ok(after.pos > pos);
  const named = new Set(after.entries.flatMap((e: any) => e.facts.flatMap((f: any) => (f[2] === 'link' ? f[3].slice(1) : [f[1]]))));
  assert.ok(named.has(more.t) && named.has(made.p), 'the new item and what it was linked to');
  assert.ok(!named.has(made.q), 'not what was left alone');
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
    { op: 'create', ref: 'p', type: 'task', title: 'Read here', body: 'What it is.\n\nA part of it\nFolded until it is asked for.' },
    { op: 'create', ref: 't', type: 'task', title: 'On the page' },
    { op: 'link', type: 'part_of', from: 't', to: 'p' },
    { op: 'create', ref: 'q', type: 'task', title: 'Elsewhere' },
    { op: 'create', ref: 'u', type: 'task', title: 'Away' },
    { op: 'link', type: 'part_of', from: 'u', to: 'q' },
  ]);
  const page = await open(`${base}/#/e/${made.p}`);
  try {
    assert.ok(await page.until(`document.querySelector('.part[data-part="item"] h1')?.textContent === 'Read here'`), 'the page is drawn');
    await heard(page);
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
      await heard(page);
    }
    const still = await page.evaluate<{ mark: number; swaps: number; hash: string }>(`({ mark: window.stillMark, swaps: window.swaps, hash: location.hash })`);
    assert.deepEqual(still, { mark: 1, swaps: 0, hash: `#/e/${made.p}` }, 'not reloaded, not drawn again, not taken elsewhere: with three agents at work, a change moves no pane its session has not shown into (packs/panes/page/pane-route.js)');
    // A change to what is on the page shows on it, in place.
    await change('agent:a', [{ op: 'update', id: made.p, title: 'Renamed on the page' }]);
    assert.ok(await page.until(`document.querySelector('.part[data-part="item"] h1')?.textContent === 'Renamed on the page'`), 'the change shows');
    const after = await page.evaluate<{ mark: number; open: boolean }>(`({ mark: window.stillMark, open: [...document.querySelectorAll('.part[data-part="item"] details.section')].at(-1).open })`);
    assert.deepEqual(after, { mark: 1, open: true }, 'not reloaded, the open fold still open');
  } finally {
    await page.close();
  }
});

test("in a browser, an agent's change reaches a view of the store with no lens read, and what may move its answer asks again", { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  await call('/api/workspace_set', undefined, { agent_changes: 'apply' });
  const change = async (ops: unknown[]) => {
    const res = (await (await fetch(`${base}/agent/change`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ actor: 'agent:test', reason: 'test', ops }) })).json()) as any;
    assert.equal(res.result?.status, 'applied', JSON.stringify(res));
    return res.result.created as Record<string, string>;
  };
  const made = await change([
    { op: 'create', ref: 'p', type: 'task', title: 'Canvas' },
    { op: 'create', ref: 'a', type: 'task', title: 'Flat lens' },
    { op: 'link', type: 'part_of', from: 'a', to: 'p' },
  ]);
  const page = await open(`${base}/#/e/${made.p}`);
  try {
    assert.ok(await page.until(`document.querySelector('.part[data-part="item"] h1')?.textContent === 'Canvas'`), 'the page is drawn');
    // The page's own modules, as it loaded them: a store from live.js, holding the flat lens around the hub.
    await page.evaluate(`(async () => {
      const at = (name) => document.querySelector('link[rel="modulepreload"][href^="/' + name + '.js"]').getAttribute('href');
      const [{ api }, live] = await Promise.all([import(at('base')), import(at('live'))]);
      window.store = await live.replicate(() => api('view', { name: 'flat', params: { filter: { find: ['id ${made.p}'] }, walk: { over: ['part_of'], steps: 1 }, follow: true } }));
      window.heard = [];
      window.store.on((changed) => window.heard.push(changed));
      // Every lens read from here on is counted.
      window.reads = 0;
      const fetched = window.fetch;
      window.fetch = (url, init) => ((String(init?.body ?? '').includes('"name":"flat"') && (window.reads += 1)), fetched(url, init));
    })()`);
    assert.equal(await page.evaluate(`window.store.answer().items.length`), 2);
    await change([{ op: 'update', id: made.a, title: 'A flat lens' }]);
    assert.ok(await page.until(`window.store.item('${made.a}')?.title === 'A flat lens'`), 'the change reaches the store');
    const renamed = await page.evaluate<{ reads: number; asked: boolean; changed: string[] }>(`({ reads: window.reads, asked: window.heard.some((c) => c.ask), changed: window.heard.flatMap((c) => c.items.changed) })`);
    assert.deepEqual(renamed, { reads: 0, asked: false, changed: [made.a] }, 'with no lens read, the listener told what changed');
    // A new task linked under it may change what the walk finds: the server is asked, not the store.
    const more = await change([
      { op: 'create', ref: 'r', type: 'task', title: 'Replica' },
      { op: 'link', type: 'part_of', from: 'r', to: made.p },
    ]);
    assert.ok(await page.until(`window.heard.some((c) => c.ask)`), 'the view is told to ask again');
    assert.equal(await page.evaluate(`window.store.item('${more.r}')`), undefined, 'what the view finds is the server’s to say');
  } finally {
    await page.close();
  }
});
