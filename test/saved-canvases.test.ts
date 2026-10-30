// Saved canvases (task e_uq77ps44): a flat lens and a style kept as an item of core's `lens` type. An agent makes and
// changes one through change and opens it on the owner's screen with report show; in a real browser (skipped where
// there is no Chrome) one is saved from the query bar, listed on Home one line each, opened in one click and switched
// to from the bar, its places kept apart from the map's, at 1280 and at 560 px.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { agent, fresh, human, make } from './map.ts';
import { serve } from './serve.ts';
import { callTool } from '../src/tools.ts';

const browser = chrome();

test('an agent makes and changes a saved canvas through change, and report show opens it', async () => {
  const l = await fresh();
  const { p } = await make(l, [{ op: 'create', ref: 'p', type: 'project', title: 'P' }]);
  const asked = { reason: 'test: a canvas of P', ops: [{ op: 'create' as const, ref: 'c', type: 'lens', title: 'P and its parts', props: { filter: { find: [`id ${p}`] }, walk: { over: ['part_of'], steps: 1 }, style: { shape: 'flow' } } }] };
  const made = (await callTool(l, agent, 'change', asked)) as { status: string; created?: Record<string, string>; proposal?: string };
  // Held for a person, as every agent's change is until the owner lets them apply: approved, it is made.
  const id = made.created?.c ?? ((await l.change(human, asked)) as { created: Record<string, string> }).created.c;
  const got = (await callTool(l, agent, 'query', { name: 'get', params: { id } })) as { entity: { kind: string; props: Record<string, unknown> } };
  assert.equal(got.entity.kind, 'system', 'of the system kind: views of the work leave it out');
  assert.deepEqual(got.entity.props.filter, { find: [`id ${p}`] });
  await l.change(human, { reason: 'test', ops: [{ op: 'update', id, props: { limit: 50 } }] });
  await assert.rejects(l.change(human, { reason: 'test', ops: [{ op: 'update', id, props: { lens: 'x' } }] }), /lens/, 'only the fields it declares');
  const shown = (await callTool(l, agent, 'report', { action: 'show', params: { entity: id } })) as { hash: string };
  assert.equal(shown.hash, `v?canvas=${id}`, 'opened as their canvas, not as an item page');
  const drawn = (await callTool(l, human, 'view', { name: 'flat', params: { filter: { find: ['type project'] } } })) as { items: { id: string }[] };
  assert.ok(!drawn.items.some((i) => i.id === id), 'not drawn on a canvas of the work');
});

test("a pack ships canvases as presets: the schema offers each, its lens answers, and the owner keeps their version under its id", async () => {
  const l = await fresh();
  const { canvases, shapes } = (await callTool(l, human, 'schema', {})) as { canvases: { id: string; pack: string; title: string; props: { filter: Record<string, unknown>; walk: unknown } }[]; shapes: { shape: string }[] };
  const waiting = canvases.find((c) => c.id === 'core.waiting');
  assert.ok(waiting && waiting.pack === 'core' && waiting.title, 'core ships what waits on you');
  assert.ok(shapes.some((s) => s.shape === 'flow'), 'the shapes the drawings draw, for the style switch');
  // What waits on the person looking: the lens answers as a saved one does.
  const { me } = await l.init(human, { name: 'Me' });
  const { t } = await make(l, [{ op: 'create', ref: 't', type: 'task', title: 'T' }]);
  await l.change(human, { reason: 'test', ops: [{ op: 'link', type: 'waits_on', from: t, to: me }] });
  const drawn = (await callTool(l, human, 'view', { name: 'flat', params: { filter: waiting.props.filter, walk: waiting.props.walk } })) as { items: { id: string }[] };
  assert.ok(drawn.items.some((i) => i.id === t), 'what waits on you is drawn');
  const kept = (await l.change(human, { reason: 'test', ops: [{ op: 'create', ref: 'c', type: 'lens', title: waiting.title, props: { ...waiting.props, preset: waiting.id } }] })) as { created: Record<string, string> };
  const got = (await callTool(l, human, 'query', { name: 'get', params: { id: kept.created.c } })) as { entity: { props: Record<string, unknown> } };
  assert.equal(got.entity.props.preset, 'core.waiting', 'the owner’s version names the preset it stands for');
});

test('in a browser, a canvas is saved from the bar, listed on Home, opened and switched to, its places its own', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'p', type: 'project', title: 'Saved here' },
      { op: 'create', ref: 'a', type: 'task', title: 'A step of it' },
      { op: 'link', type: 'part_of', from: 'a', to: 'p' },
      { op: 'create', ref: 'q', type: 'project', title: 'Another project' },
    ],
  })).result.created as Record<string, string>;
  await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'v', type: 'lens', title: 'A view of it', props: { filter: { find: [`id ${made.p}`] }, walk: { over: ['part_of'], steps: 2 } } }, { op: 'link', type: 'about', from: 'v', to: made.p }] });
  const page = await open(`${base}/#/v?find=id+${made.p}&over=part_of&steps=1`);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (expression: string, ms = 20000) => {
    for (const end = Date.now() + ms; Date.now() < end; await wait(150)) if (await page.evaluate(expression)) return true;
    return false;
  };
  const drawn = (id: string) => `Boolean(document.querySelector('#canvas svg a[href="#/e/${id}"]'))`;
  const canvasUp = () => page.evaluate<string | null>(`new URLSearchParams(location.hash.split('?')[1] ?? '').get('canvas')`);
  const picked = `document.querySelector('#query .q-pick')?.selectedOptions[0]?.textContent`;
  const canvases = async () => (await call('/api/search', undefined, { type: 'lens', limit: 50 })).result as { id: string; title: string; props: Record<string, any> }[];
  try {
    for (const width of [1280, 560]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      const name = `Saved at ${width}`;
      await page.go(`${base}/#/v?find=id+${made.p}&over=part_of&steps=1`);
      assert.ok(await until(drawn(made.a)), `drawn: ${page.logs().join('\n')}`);
      assert.ok(await until(`document.querySelector('#query .q-pick')?.title.startsWith('Not saved')`), 'the bar says what is up is not saved');

      // Saved from the bar: a name asked in the page.
      await page.evaluate(`document.querySelector('#query .q-save[aria-label="Save this canvas"]').click()`);
      assert.ok(await until(`Boolean(document.querySelector('dialog.ask[open] textarea'))`), 'a name is asked');
      await page.evaluate(`(() => { const d = document.querySelector('dialog.ask'); d.querySelector('textarea').value = ${JSON.stringify(name)}; d.querySelector('button[value="ok"]').click(); })()`);
      assert.ok(await until(`${picked} === ${JSON.stringify(name)}`), `the bar names it: ${await page.evaluate(picked)}`);
      const saved = (await canvases()).find((c) => c.title === name)!;
      assert.ok(saved, 'kept on the map');
      assert.deepEqual([saved.props.filter.find, saved.props.walk], [[`id ${made.p}`], { over: ['part_of'], steps: 1 }], 'its lens: the filter, the walk');
      assert.equal(await canvasUp(), saved.id, 'its id in the address');

      // Moved on it: written under its own id, not the item's canvas or the map's.
      await page.evaluate(`document.querySelector('#canvas .pane-canvas').dispatchEvent(new CustomEvent('drawing-drop', { detail: { id: '${made.a}', x: ${width}, y: 77 } }))`);
      await page.evaluate(`location.hash = '#/'`);
      let mine: Record<string, [number, number]> = {};
      for (const end = Date.now() + 10000; Date.now() < end && !mine[made.a]; await wait(200)) mine = (await call('/api/places', undefined, { canvas: saved.id })).result;
      assert.deepEqual(mine[made.a], [width, 77], 'kept in its places');
      assert.equal((await call('/api/places', undefined, { canvas: made.p })).result[made.a], undefined, 'not in the places of the item it is drawn from');
      assert.equal((await call('/api/places', undefined, {})).result[made.a], undefined, 'not in the map’s');

      // Home: one line each, opening in one click.
      await page.evaluate(`location.hash = '#/you'`);
      // Waited for by its name: the canvas saved on the pass before is listed already.
      assert.ok(await until(`[...document.querySelectorAll('.canvases > .rows > li a')].some((a) => a.textContent === ${JSON.stringify(name)})`), 'listed on Home');
      const rows = await page.evaluate<{ title: string; tall: number; line: number; wide: boolean }[]>(
        `[...document.querySelectorAll('.canvases > .rows > li')].map((li) => ({ title: li.querySelector('a').textContent, tall: li.getBoundingClientRect().height, line: parseFloat(getComputedStyle(li).lineHeight) || 20, wide: li.scrollWidth > li.clientWidth + 1 }))`,
      );
      for (const r of rows) assert.ok(r.tall < 3 * r.line && !r.wide, `one line at ${width}: ${JSON.stringify(r)}`);
      assert.ok(rows.some((r) => r.title === name));
    }

    // An agent's canvas of another project; switched between from the bar.
    const other = (await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'c', type: 'lens', title: 'The other one', props: { filter: { find: [`id ${made.q}`] }, walk: { over: [], steps: 0 } } }] })).result.created.c as string;
    await page.go(`${base}/#/v?find=id+${made.q}`);
    await page.go(`${base}/#/you`);
    assert.ok(await until(`[...document.querySelectorAll('.canvases a')].some((a) => a.textContent === 'The other one')`), 'the new one is listed');
    await page.evaluate(`[...document.querySelectorAll('.canvases a')].find((a) => a.textContent === 'The other one').click()`);
    assert.ok(await until(drawn(made.q)), 'opened in one click: its lens drawn');
    assert.equal(await canvasUp(), other);
    assert.ok(await until(`${picked} === 'The other one'`), 'named in the bar');
    // As a chip, or in the folded line when the bar is narrow (560 px, from the loop above).
    assert.ok(await until(`[...document.querySelectorAll('#find .q-id, #find .q-more')].some((c) => (c.textContent + c.title).includes('Another project'))`), 'its lens in the bar');
    await page.evaluate(`(() => { const s = document.querySelector('#query .q-pick'); s.value = [...s.options].find((o) => o.textContent === 'Saved at 1280').value; s.dispatchEvent(new Event('change')); })()`);
    assert.ok(await until(drawn(made.a)), 'switched from the bar');
    assert.ok(await until(`${picked} === 'Saved at 1280'`));

    // A view kept about an item: folded on Home under the views of items, and opened from there.
    await page.go(`${base}/#/you`);
    assert.ok(await until(`Boolean(document.querySelector('.canvases .old-views'))`), 'the views of items are folded');
    assert.ok(!(await page.evaluate<boolean>(`[...document.querySelectorAll('.canvases > .rows a')].some((a) => a.textContent === 'A view of it')`)), 'not among the workspace’s own');
    await page.evaluate(`(() => { const d = document.querySelector('.canvases .old-views'); d.open = true; [...d.querySelectorAll('a')].find((a) => a.textContent === 'A view of it').click(); })()`);
    assert.ok(await until(`${picked} === 'A view of it'`), `opened as a canvas: ${page.logs().join(' | ')}`);
    assert.ok(await until(drawn(made.a)));
  } finally {
    await page.close();
  }
});
