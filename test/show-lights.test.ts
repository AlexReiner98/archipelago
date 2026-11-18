// A show of an item on an island never moves the reader's view (decision e_mnuthcap): the island goes on their canvas
// and the item is lit in the side bar (hooks.lightIsland, the picker's), and the canvas stays where it was
// (packs/surface/page/live.js, light). In a file of its own: the steps a server keeps outlive a test in one process.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open, pageModule } from './browser.ts';
import { until as holds } from './wait.ts';
import { serve } from './serve.ts';
import { PANE, agent, ready } from './agent-page.ts';

const browser = chrome();

test('in a browser, a show of an item on an island puts the island on and lights the item, and the view stays', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  await call('/api/workspace_set', undefined, { islands: true });
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'harbour', type: 'island', title: 'Harbour works', props: { pack: 'core' } },
      { op: 'create', ref: 'pier', type: 'task', title: 'Rebuild the pier', props: { island: '{harbour}' } },
    ],
  })).result.created as Record<string, string>;
  const { run } = (await call('/agent/capture', undefined, { actor: agent, action: 'session_start', params: { session_id: 'lights', title: 'Lights' } })).result;
  const page = await open(`${base}/`);
  const until = async (what: string, ok: () => Promise<boolean>) => {
    if (!(await holds(ok, 20_000, 250))) assert.fail(`${what}: ${page.logs().join('\n')}`);
  };
  try {
    await ready(page);
    // Start from a canvas with nothing on it, so putting the island on is seen.
    await page.evaluate(`(async () => { const { keepList } = await ${pageModule('islands-on.js')}; await keepList([], 'test'); })()`);
    await page.evaluate(`(async () => { const { hooks } = await ${pageModule('base.js')}; window.lit = []; hooks.lightIsland = (island, item, by) => lit.push([island, item, by]); })()`);
    const where = await page.evaluate<string>('location.hash');
    const shown = (await call('/agent/report', undefined, { actor: agent, action: 'show', params: { entity: made.pier, run, note: 'The pier' } })).result;
    assert.equal(shown.sight.looking, false, 'nothing brought into sight');
    await until('the item is lit', () => page.evaluate<boolean>(`JSON.stringify(window.lit) === ${JSON.stringify(JSON.stringify([[made.harbour, made.pier, 'Lights']]))}`));
    await until('its island is on the canvas', () => page.evaluate<boolean>(`(async () => (await (await ${pageModule('islands-on.js')}).islandsOn()).includes(${JSON.stringify(made.harbour)}))()`));
    assert.equal(await page.evaluate<number>(`document.querySelectorAll('${PANE}').length`), 1, 'no canvas opened for it');
    assert.equal(await page.evaluate<string>('location.hash'), where, 'the view stays where it was');
  } finally {
    await page.close();
  }
});
