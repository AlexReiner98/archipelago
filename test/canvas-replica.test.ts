// The canvas as a replica of the log, in a real browser (skipped where there is no Chrome): an agent's change to an
// item drawn reaches the open canvas through the facts the page tails, and is drawn without the lens being read again;
// a link made to something the canvas does not hold reads the lens again, so the walk can reach it.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

test("in a browser, an agent's change reaches an open canvas without a lens read", { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'a', type: 'task', title: 'First step' },
      { op: 'create', ref: 'b', type: 'task', title: 'Second step' },
      { op: 'create', ref: 'd', type: 'task', title: 'Elsewhere' },
      { op: 'link', type: 'depends_on', from: 'b', to: 'a' },
    ],
  })).result.created as Record<string, string>;
  const page = await open(`${base}/#/v?ids=${made.a}&over=depends_on&steps=1`);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (expression: string) => {
    for (const end = Date.now() + 20000; Date.now() < end; await wait(200)) if (await page.evaluate(expression)) return true;
    return false;
  };
  // An agent's change, approved as the owner would (it waits under the core rule agent_changes).
  const agentChange = async (ops: unknown[]) => {
    const asked = (await call('/agent/change', undefined, { actor: 'robot', reason: 'test', ops })).result;
    if (asked.proposal) await call('/api/decide', undefined, { proposal: asked.proposal, approve: true });
    return asked;
  };
  const drawn = (title: string) => `[...document.querySelectorAll('#canvas svg a')].some((a) => a.textContent.includes(${JSON.stringify(title)}))`;
  try {
    assert.ok(await until(drawn('Second step')), `the canvas is drawn: ${page.logs().join('\n')}`);
    // Agents' steps are not followed here: the page stays on this canvas.
    await page.evaluate(`(localStorage.setItem('pelago-follow', 'off'), (document.querySelector('#follow input').checked = false))`);
    // Count the lens reads the page makes from here on.
    await page.evaluate(`(() => { window.flatReads = 0; const was = window.fetch; window.fetch = (url, init) => { if (String(init?.body ?? '').includes('"name":"flat"')) window.flatReads++; return was(url, init); }; })()`);
    await agentChange([{ op: 'update', id: made.b, title: 'Renamed step' }]);
    const probe = `(() => { const v = document.querySelector('#canvas .pane-canvas > .lens-wrap'); const s = v?.store; return JSON.stringify({ has: Boolean(v), store: Boolean(s), pos: s?.pos, titles: s ? [...s.items.values()].map((r) => r.title) : null, drawn: [...document.querySelectorAll('#canvas svg a')].map((a) => a.textContent) }); })()`;
    assert.ok(await until(drawn('Renamed step')), `the new title is drawn: ${await page.evaluate(probe)} ${page.logs().join('\n')}`);
    assert.equal(await page.evaluate('window.flatReads'), 0, 'drawn from the facts, with no lens read');
    // An item made in the same change as its link to what is drawn comes with the facts: still no lens read.
    await agentChange([{ op: 'create', ref: 'c', type: 'task', title: 'Third step' }, { op: 'link', type: 'depends_on', from: 'c', to: made.a }]);
    assert.ok(await until(drawn('Third step')), `a new item linked in is drawn: ${await page.evaluate(probe)} ${page.logs().join('\n')}`);
    assert.equal(await page.evaluate('window.flatReads'), 0, 'what came with its link needs no lens read');
    // A link to an item that was there all along, not held: the lens is read again, and the walk reaches it.
    await agentChange([{ op: 'link', type: 'depends_on', from: made.d, to: made.a }]);
    assert.ok(await until(drawn('Elsewhere')), `what a new link reaches is drawn: ${await page.evaluate(probe)} ${page.logs().join('\n')}`);
    assert.ok((await page.evaluate<number>('window.flatReads')) >= 1, 'read again for what it did not hold');
  } finally {
    await page.close();
  }
});
