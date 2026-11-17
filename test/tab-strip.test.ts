// How the strip of tabs looks (packs/surface/page/shell.css, the tabs the panes part draws; Alex, 17 Nov 2026), in a
// real browser: a tab is no wider than the style's tab length however long its chat's title, its × shows on the tab
// in sight only (and under the pointer), keeping its room, and at 560 px the tabs give way so every one and + stay in
// the bar, the one in sight whole.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { until as holds } from './wait.ts';
import { serve } from './serve.ts';
import { TAB, agent } from './tab-page.ts';

const browser = chrome();

test('in a browser, tabs are cut to the style’s length, their × only on the tab in sight, and fit a narrow bar', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const titles = ['Rebalance CI shards for faster tests', 'Islands placement on the canvas with a long chat title that runs on', 'Fix the bar under the tabs'];
  const made = (await call('/api/change', undefined, { reason: 'test', ops: titles.map((t, n) => ({ op: 'create', ref: `i${n}`, type: 'work', title: `Step ${n}` })) })).result.created as Record<string, string>;
  const runs: string[] = [];
  for (const [n, title] of titles.entries()) runs.push((await call('/agent/capture', undefined, { actor: agent, action: 'session_start', params: { session_id: `strip-${n}`, title, surface: 'codex' } })).result.run);
  const page = await open(`${base}/`);
  const until = async (what: string, ok: () => Promise<boolean>) => {
    if (!(await holds(ok, 20_000, 250))) assert.fail(`${what}: ${page.logs().join('\n')}`);
  };
  for (const [n, run] of runs.entries()) await call('/agent/report', undefined, { actor: agent, action: 'show', params: { entity: made[`i${n}`], run, focus: n === 1 } });
  /** Each tab: its width, whether it is in sight, whether its × shows, and whether it stands whole inside the bar. */
  const tabs = `(() => { const bar = document.getElementById('tabs').getBoundingClientRect(); return [...document.querySelectorAll('${TAB}')].map((t) => { const r = t.getBoundingClientRect(), x = t.querySelector('[data-key^="close:"]');
    return { width: r.width, front: t.getAttribute('aria-selected') === 'true', cross: x ? getComputedStyle(x).visibility === 'visible' : null, inside: r.left >= bar.left - 1 && r.right <= bar.right + 1 }; }); })()`;
  type Tab = { width: number; front: boolean; cross: boolean | null; inside: boolean };
  /** Whether + stands inside the bar. */
  const plus = `(() => { const bar = document.getElementById('tabs').getBoundingClientRect(), p = document.querySelector('#tabs [data-key="new"]').getBoundingClientRect(); return p.width > 0 && p.right <= bar.right + 1; })()`;
  try {
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    await until('three chats’ tabs, the long one in sight', () => page.evaluate<boolean>(`(() => { const t = ${tabs}; return t.length === 4 && t.filter((x) => x.front).length === 1; })()`));
    const most = await page.evaluate<number>(`parseFloat(getComputedStyle(document.body).getPropertyValue('--tab-most') || getComputedStyle(document.body).getPropertyValue('--side-least'))`);
    const wide = await page.evaluate<Tab[]>(tabs);
    for (const t of wide) assert.ok(t.width <= most + 1, `no tab wider than ${most}px: ${JSON.stringify(wide)}`);
    // The tab in sight shows its ×; a chat's tab out of sight keeps the room but not the mark; Home has none to show.
    assert.deepEqual(wide.filter((t) => t.cross !== null).map((t) => t.cross), wide.filter((t) => t.cross !== null).map((t) => t.front), 'the × on the tab in sight only');
    await page.send('Emulation.setDeviceMetricsOverride', { width: 560, height: 800, deviceScaleFactor: 1, mobile: false });
    await until('every tab inside the narrow bar', () => page.evaluate<boolean>(`${tabs}.every((t) => t.inside) && ${plus}`));
    const narrow = await page.evaluate<Tab[]>(tabs);
    const front = narrow.find((t) => t.front)!;
    assert.ok(narrow.every((t) => t.front || t.width <= front.width + 1), `the tab in sight keeps the most room: ${JSON.stringify(narrow)}`);
  } finally {
    await page.close();
  }
});
