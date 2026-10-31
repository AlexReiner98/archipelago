// A style is an item like any other (task e_q3yfvnz7), in a real browser (skipped where there is no Chrome): find finds
// it and opens its page over the canvas with nothing applied; Apply, a button its type declares on a screen, draws the
// canvas in it as the style switch does; and any type's screen can declare a button, with no code naming the type.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

test('in a browser, find opens a style’s page and Apply draws the canvas in it', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 't', type: 'task', title: 'Pour the slab' },
      { op: 'create', ref: 's', type: 'style', title: 'Harbour blueprint', props: { shape: 'list' } },
    ],
  })).result.created as Record<string, string>;
  const page = await open(`${base}/#/v?find=id+${made.t}`);
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const until = async (expression: string) => {
    for (const end = Date.now() + 20000; Date.now() < end; await wait(150)) if (await page.evaluate(expression)) return true;
    return false;
  };
  const type = (q: string) => page.evaluate(`(() => { if (!document.getElementById('find').classList.contains('open')) document.getElementById('find-lens').click(); const i = document.querySelector('#find input[type=search]'); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const list = `document.querySelector('#find .find-choices')`;
  const choice = (kind: string, name: string) => `[...${list}.querySelectorAll('.find-choice')].find((c) => c.querySelector('.q-label').textContent === ${JSON.stringify(kind)} && c.querySelector('.find-name').textContent === ${JSON.stringify(name)})`;
  const take = (kind: string, name: string) => page.evaluate(`${choice(kind, name)}.click()`);
  const hash = `new URLSearchParams(location.hash.split('?')[1] ?? '')`;
  const applied = (id: string) => `(${hash}.get('style') === ${JSON.stringify(id)})`;
  const onPage = (id: string) => `document.body.dataset.sheet === 'open' && location.hash.startsWith('#/e/${id}?')`;
  const button = `document.querySelector('#sheet .item-button')`;
  // Its page shut and the switch back on the house's, as a person does.
  const shut = async () => {
    await page.evaluate(`document.body.dataset.sheet === 'open' && document.getElementById('sheet-close').click()`);
    await until(`document.body.dataset.sheet !== 'open' && Boolean(document.querySelector('#query .q-look'))`);
    await page.evaluate(`(() => { const s = document.querySelector('#query .q-look'); s.value = ''; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  };
  try {
    assert.ok(await until(`Boolean(document.querySelector('#find-lens .q-sum'))`), `the canvas is up: ${page.logs().join('\n')}`);
    for (const width of [1280, 560]) {
      await page.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      // In Find a style is found as an item: its page opens over the lens, and nothing is applied.
      await type('Harbour');
      assert.ok(await until(`Boolean(${choice('Item', 'Harbour blueprint')})`), `a style is found by its name: ${await page.evaluate(`${list}.textContent`)}`);
      // Read once the counts have come: the choices are drawn again with them.
      await until(`[...${list}.querySelectorAll('.find-count')].length > 0 || !${list}.textContent.includes('Pour')`);
      await wait(300);
      const row = await page.evaluate<{ tall: number; bar: number; note: string; drawing: boolean }>(`(() => { const c = ${choice('Item', 'Harbour blueprint')}; return { tall: c.getBoundingClientRect().height, bar: document.querySelector('#find .find-row').getBoundingClientRect().height, note: c.querySelector('.find-note')?.textContent ?? '', drawing: [...${list}.querySelectorAll('.q-label')].some((l) => l.textContent === 'Style') }; })()`);
      assert.equal(row.note, 'Style', 'it says its type');
      assert.ok(!row.drawing, 'and no choice in Find draws the canvas in it');
      assert.ok(row.tall <= row.bar, `one line at ${width} px`);
      await take('Item', 'Harbour blueprint');
      assert.ok(await until(onPage(made.s)), `its page opens: ${await page.evaluate('location.hash')} ${page.logs().join('\n')}`);
      assert.equal(await page.evaluate(`${hash}.get('find')`), `id ${made.t}`, 'over the lens as it was');
      assert.ok(!(await page.evaluate(applied(made.s))), 'with nothing applied');
      assert.equal(await page.evaluate(`document.querySelector('#query .q-look').value`), '', 'the switch still says the house’s');

      // Apply stands in the page's head, says what it does, and draws the canvas in the style as the switch does.
      assert.ok(await until(`${button}?.textContent === 'Apply'`), 'the style’s page offers Apply');
      assert.match(await page.evaluate<string>(`${button}.title`), /Draw this canvas in this style/);
      assert.ok(await page.evaluate(`${button}.nextElementSibling === document.querySelector('#sheet .walk-from') || !document.querySelector('#sheet .walk-from')`), 'beside Walk from it');
      await page.evaluate(`${button}.click()`);
      assert.ok(await until(applied(made.s)), `Apply draws the canvas in it: ${await page.evaluate('location.hash')}`);
      assert.equal(await page.evaluate(`${hash}.get('find')`), `id ${made.t}`, 'the lens kept');
      assert.ok(await until(`document.querySelector('#query .q-look').value === 'style:${made.s}'`), 'and the switch says so');
      assert.equal(await page.evaluate(`document.querySelector('#query .q-look').selectedOptions[0].textContent`), 'Harbour blueprint');

      await shut();
      assert.ok(await until(`!${applied(made.s)} && document.body.dataset.sheet !== 'open'`), 'back to the canvas');
    }
    await page.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

    // A style about one item is that item's: the switch does not offer it, find still does, and Apply puts it in the
    // switch while it is drawn.
    const own = (await call('/api/change', undefined, {
      reason: 'test',
      ops: [
        { op: 'create', ref: 'o', type: 'style', title: 'Slab section look', props: { shape: 'list' } },
        { op: 'link', type: 'about', from: 'o', to: made.t },
      ],
    })).result.created as Record<string, string>;
    await page.evaluate(`location.reload()`);
    const options = `[...document.querySelectorAll('#query .q-look option')].map((o) => o.textContent)`;
    assert.ok(await until(`${options}.includes('Harbour blueprint')`), 'the switch offers a style about nothing');
    assert.ok(!(await page.evaluate(`${options}.includes('Slab section look')`)), 'and not one about an item');
    await type('style slab');
    assert.ok(await until(`Boolean(${choice('Style', 'Slab section look')})`), `find still lists it: ${await page.evaluate(`${list}.textContent`)}`);
    await take('Style', 'Slab section look');
    assert.ok(await until(onPage(own.o)), 'its page opens');
    assert.ok(await until(`${button}?.textContent === 'Apply'`), 'with Apply');
    await page.evaluate(`${button}.click()`);
    assert.ok(await until(`document.querySelector('#query .q-look')?.value === 'style:${own.o}'`), 'and the switch says what is drawn');
    await shut();

    // The word "style " lists styles too, each opening its page; a drawing is no item, so only it draws at once.
    await type('style harbour');
    assert.ok(await until(`Boolean(${choice('Style', 'Harbour blueprint')})`), `Style lists it: ${await page.evaluate(`${list}.textContent`)}`);
    await take('Style', 'Harbour blueprint');
    assert.ok(await until(onPage(made.s)), 'its page opens');
    assert.ok(!(await page.evaluate(applied(made.s))), 'nothing applied');
    await shut();
    await type('style list');
    assert.ok(await until(`Boolean(${choice('Drawing', 'List')})`), 'a drawing is offered under Style');
    await take('Drawing', 'List');
    assert.ok(await until(`${hash}.get('shape') === 'list'`), `a drawing draws: ${await page.evaluate('location.hash')}`);
    await shut();
    assert.ok(await until(`!${hash}.has('shape')`), 'back to the house’s');

    // A button is the screen's, not the kernel's: one more declared on any type stands on its pages. The first is in
    // sight, the next in the menu.
    await page.evaluate(`import(performance.getEntriesByType('resource').map((r) => r.name).find((n) => n.includes('/base.js'))).then(({ state }) => void state.schema.screens.push({ id: 'test.buttons', title: 'T', on: ['work'], pieces: [{ piece: 'button', label: 'Draw as a list', tip: 'As a list', draw: { shape: 'list' } }, { piece: 'button', label: 'Draw as it is', tip: 'Here', draw: { style: '{here}' } }] }))`);
    await page.evaluate(`(location.hash = '#/e/${made.t}?find=id+${made.t}')`);
    assert.ok(await until(`${onPage(made.t)} && ${button}?.textContent === 'Draw as a list'`), `a declared button stands on the page: ${page.logs().join('\n')}`);
    assert.equal(await page.evaluate(`document.querySelectorAll('#sheet .item-button').length`), 1, 'one in sight');
    assert.ok(await page.evaluate(`[...document.querySelectorAll('#sheet .menu-items button')].some((b) => b.textContent === 'Draw as it is')`), 'the next in the menu');
    await page.evaluate(`${button}.click()`);
    assert.ok(await until(`${hash}.get('shape') === 'list'`), 'and does what it says');
  } finally {
    await page.close();
  }
});
