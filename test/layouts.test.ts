// The walls a drawing runs behind (packs/walls/page/draw.js, ui/draw.html, packs/walls/page/layout.js), in a real browser (skipped where there is
// no Chrome): a drawing that tries what a drawing may not is stopped, and reaches nothing; one that asks for a surface
// paints pixels over its picture and reaches nothing more. A style's own code, walled in and opened, is
// test/layouts-open.test.ts; the drawings drawing what the kernel drew, test/layouts-flow.test.ts and
// test/layouts-architecture.test.ts; what a picture is sent, test/layouts-sent.test.ts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { house } from './layout-cases.ts';
import { serve } from './serve.ts';

const browser = chrome();

/** The house style's numbers, which the frame a picture moves in is moved by (packs/walls/page/pan-zoom.js). */
const numbers = JSON.stringify(house('flow').numbers);
/** A drawing's index.js that answers with this scene, after what `before` runs. */
const hostile = (scene: string, before = '') => `export async function picture(input, tools) { ${before}; return { scene: ${scene} }; }`;

test('in a browser, a drawing that tries what it may not is stopped, and reaches nothing', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base } = await serve('off');
  const page = await open(`${base}/`);
  try {
    const tries: Record<string, string> = {
      script: hostile(`{ svg: ['svg', {}, ['script', {}, 'parent.document.body.remove()']] }`),
      handler: hostile(`{ svg: ['svg', { onload: 'alert(1)' }] }`),
      link: hostile(`{ svg: ['svg', {}, ['a', { href: 'javascript:alert(1)' }]] }`),
      elsewhere: hostile(`{ svg: ['svg', {}, ['a', { href: 'https://example.com/' }]] }`),
      style: hostile(`{ svg: ['svg', { style: 'position: fixed' }] }`),
      foreign: hostile(`{ svg: ['svg', {}, ['foreignObject', {}, ['iframe', {}]]] }`),
      escape: hostile(`{ css: '} body { display: none } x {', svg: ['svg', {}] }`),
      sibling: hostile(`{ css: '~ * { display: none }', svg: ['svg', {}] }`),
      fetch: hostile(`{ css: 'x { background: url(https://example.com/) }', svg: ['svg', {}] }`),
      viewport: `export async function picture() { return { scene: { svg: ['svg', { key: 'x' }], size: { width: 100, height: 100 } }, viewport: () => [{ key: 'x', mark: ['script', {}, 'parent.document.body.remove()'] }] }; }`,
      tip: hostile(`{ svg: ['svg', { key: 'x' }] }`, `setTimeout(() => tools.patch([{ tip: { key: 'x', mark: ['script', {}, 'parent.document.body.remove()'] } }]), 50)`),
    };
    const body = await page.evaluate('getComputedStyle(document.body).display');
    const got: Record<string, string> = await page.evaluate(`(async () => {
      const { drawWith } = await import('/layout.js');
      const out = {};
      for (const [name, code] of Object.entries(${JSON.stringify(tries)})) {
        const host = document.createElement('div');
        document.body.append(host);
        drawWith(host, { items: [], links: [], lens: {} }, { numbers: ${numbers}, drawing: { hash: name.padEnd(64, '0'), modules: { 'index.js': code } } }, () => {});
        // What it sends after its scene (a tip) is checked when it comes: wait for what it says then.
        for (let n = 0; n < 200 && !host.textContent.startsWith('This drawing stopped'); n++) await new Promise((r) => setTimeout(r, 25));
        out[name] = host.textContent;
      }
      return out;
    })()`);
    for (const [name, said] of Object.entries(got)) assert.match(said, /^This drawing stopped: The drawing sent what cannot be drawn/, `${name}: ${said}`);
    assert.equal(await page.evaluate('getComputedStyle(document.body).display'), body);

    // What it may reach: nothing of the page, nothing on the network.
    const reach = hostile(
      `{ message: [typeof document, typeof parent, typeof localStorage, typeof indexedDB === 'undefined' ? 'no-idb' : 'idb', reached].join(' ') }`,
      `let reached = 'blocked'; try { await fetch(${JSON.stringify(`${base}/api/view`)}, { method: 'POST' }); reached = 'reached'; } catch {}`,
    );
    const said = await page.evaluate(`(async () => {
      const { drawWith } = await import('/layout.js');
      const host = document.createElement('div');
      document.body.append(host);
      drawWith(host, { items: [], links: [], lens: {} }, { numbers: ${numbers}, drawing: { hash: 'reach'.padEnd(64, '0'), modules: { 'index.js': ${JSON.stringify(reach)} } } }, () => {});
      for (let n = 0; n < 200 && !host.textContent; n++) await new Promise((r) => setTimeout(r, 25));
      return host.textContent;
    })()`);
    assert.match(String(said), /^undefined undefined undefined (no-idb|idb) blocked$/);

    // Code that never answers is stopped, and says so.
    const stuck = hostile(`{}`, 'for (;;) {}');
    const stopped = await page.evaluate(`(async () => {
      const { drawWith } = await import('/layout.js');
      const host = document.createElement('div');
      document.body.append(host);
      drawWith(host, { items: [], links: [], lens: {} }, { numbers: ${numbers}, drawing: { hash: 'stuck'.padEnd(64, '0'), modules: { 'index.js': ${JSON.stringify(stuck)} } } }, () => {});
      for (let n = 0; n < 800 && !host.textContent; n++) await new Promise((r) => setTimeout(r, 25));
      return host.textContent;
    })()`);
    assert.match(String(stopped), /did not answer for 12 seconds/);
  } finally {
    await page.close();
  }
});

test('in a browser, a drawing that asks for a surface paints pixels under its picture, moved by the page camera, and reaches nothing more', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base } = await serve('off');
  const page = await open(`${base}/`);
  try {
    // One paints its surface red and says what it was given; one whose scene asks for no surface is given none.
    const painter = `export async function picture(input, tools) {
      setTimeout(async () => {
        const s = await tools.surface();
        s.canvas.width = 4; s.canvas.height = 4;
        const g = s.canvas.getContext('2d'); g.fillStyle = 'red'; g.fillRect(0, 0, 4, 4); s.show();
        const three = typeof (await s.three()).WebGLRenderer;
        tools.patch([{ key: 's', toggle: { ['got-' + s.canvas.constructor.name]: true, ['doc-' + typeof document]: true, ['three-' + three]: true, ['sized-' + (s.size.width > 0)]: true } }]);
      }, 10);
      return { scene: { svg: ['svg', { width: 40, height: 40 }], size: { width: 40, height: 40 }, surface: { key: 's' } } };
    }`;
    const plain = `export async function picture(input, tools) { setTimeout(async () => { const s = await tools.surface(); tools.patch([{ key: 'svg', toggle: { ['none-' + (s === null)]: true } }]); }, 10); return { scene: { svg: ['svg', { key: 'svg' }] } }; }`;
    const at: { x: number; y: number } = await page.evaluate(`(async () => {
      const { drawWith } = await import('/layout.js');
      const draw = async (name, code, done) => {
        const host = document.createElement('div');
        document.body.append(host);
        drawWith(host, { items: [], links: [], lens: {} }, { numbers: ${numbers}, drawing: { hash: name.padEnd(64, '0'), modules: { 'index.js': code } } }, () => {});
        for (let n = 0; n < 400 && !done(host); n++) await new Promise((r) => setTimeout(r, 25));
        return host;
      };
      const a = await draw('painter', ${JSON.stringify(painter)}, (h) => h.querySelector('.lf-surface')?.className.includes('got-') && h.querySelector('.lf-surface > canvas'));
      const b = await draw('plain', ${JSON.stringify(plain)}, (h) => h.querySelector('svg')?.getAttribute('class')?.includes('none-'));
      const layer = a.querySelector('.lf-surface'), c = layer.querySelector('canvas'), seen = document.createElement('canvas');
      seen.width = seen.height = 4;
      seen.getContext('2d').drawImage(c, 0, 0, 4, 4);
      c.scrollIntoView({ block: 'center' });
      const box = c.getBoundingClientRect(), still = box.width;
      window.painted = { a, c, layer, b, seen, still, at: { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) } };
      return window.painted.at;
    })()`);
    // A frame shown at rest is on screen at once, with no move to bring it (as a look takes the page).
    const shot = (await page.screenshot()).toString('base64');
    const onScreen = await page.evaluate(`new Promise((done) => {
      const img = new Image();
      img.onload = () => { const k = document.createElement('canvas'); k.width = img.width; k.height = img.height; const g = k.getContext('2d'); g.drawImage(img, 0, 0); done([...g.getImageData(${at.x}, ${at.y}, 1, 1).data]); };
      img.src = 'data:image/png;base64,${shot}';
    })`);
    const got: any = await page.evaluate(`(async () => {
      const { a, c, layer, b, seen, still } = window.painted;
      // The page's camera moves the paint with the marks, in the frame it moves them, before the drawing paints again.
      a.moves.zoomBy(2);
      await new Promise((r) => requestAnimationFrame(r));
      const under = getComputedStyle(layer).zIndex + ' ' + getComputedStyle(layer.parentElement).isolation;
      return { still, moved: c.getBoundingClientRect().width, under, cls: layer?.className, inside: a.contains(layer), pixel: [...seen.getContext('2d').getImageData(1, 1, 1, 1).data], said: a.textContent, plain: b.querySelector('svg')?.getAttribute('class'), surfaces: b.querySelectorAll('canvas').length };
    })()`);
    assert.doesNotMatch(got.said, /This drawing stopped/, 'the painter was not stopped');
    for (const cls of ['got-OffscreenCanvas', 'doc-undefined', 'three-function', 'sized-true']) assert.ok(got.cls.includes(cls), `${cls} in ${got.cls}`);
    assert.ok(got.inside, 'the surface is inside the picture');
    assert.ok(Math.abs(got.moved - 2 * got.still) < 0.5, `zoomed in twice, the paint is drawn twice as large at once: ${got.still} → ${got.moved}`);
    assert.match(got.under, /^-1 isolate/, `the surface lies under the marks: ${got.under}`);
    assert.deepEqual(got.pixel, [255, 0, 0, 255], 'what it painted is shown');
    assert.deepEqual(onScreen, [255, 0, 0, 255], 'what it painted at rest is on screen, unmoved');
    assert.match(got.plain, /none-true/);
    assert.equal(got.surfaces, 0);
  } finally {
    await page.close();
  }
});

test('in a browser, the helpers of a drawing reach nothing more than it does, and one stuck stops it', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base } = await serve('off');
  const page = await open(`${base}/`);
  try {
    // Its helpers say what they can reach; a picture asks one, once the frame has started them (the first may have none).
    const reach = `export const helpers = {
      reach: async () => { let reached = 'blocked'; try { await fetch(${JSON.stringify(`${base}/api/view`)}, { method: 'POST' }); reached = 'reached'; } catch {} return [typeof document, typeof parent, typeof localStorage, reached].join(' '); },
      stuck: () => { for (;;) {} },
    };
    export async function picture(input, tools) {
      if (!tools.helpers?.size) return { scene: { message: 'none' } };
      return { scene: { message: 'helper ' + (await tools.helpers.run(input.answer.lens.ask, null, tools.helpers.size - 1)) } };
    }`;
    const said = (ask: string, wait: number) => page.evaluate(`(async () => {
      const { drawWith } = await import('/layout.js');
      for (let tries = 0; tries < 80; tries++) {
        const host = document.createElement('div');
        document.body.append(host);
        // Each try a picture of its own, so none is a picture kept from the one before.
        drawWith(host, { items: [], links: [], lens: { ask: ${JSON.stringify(ask)}, tries } }, { numbers: ${numbers}, drawing: { hash: ${JSON.stringify(ask)}.padEnd(64, '0'), modules: { 'index.js': ${JSON.stringify(reach)} } } }, () => {});
        for (let n = 0; n < ${wait} && !host.textContent; n++) await new Promise((r) => setTimeout(r, 25));
        if (host.textContent !== 'none') return host.textContent;
        await new Promise((r) => setTimeout(r, 100));
      }
      return 'no helper was started';
    })()`);
    assert.match(String(await said('reach', 200)), /^helper undefined undefined undefined blocked$/);
    // A helper that never answers stops the drawing, as the drawing itself would be.
    assert.match(String(await said('stuck', 800)), /did not answer for 12 seconds/);
  } finally {
    await page.close();
  }
});
