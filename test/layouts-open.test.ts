// A style's own code (packs/walls/page/style-code.js, packs/walls/page/draw.js) runs in a frame walled in, unless the owner opens it for the
// workspace (drawings_open, e_eezrwza2): the frame's policy, and in a real browser (skipped where there is no Chrome)
// the same code run both ways. Beside test/layouts.test.ts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open, wait } from './browser.ts';
import { serve } from './serve.ts';

const browser = chrome();

// A style's own code that says what it reached: the page around it, this server, and a panel of its own in its page.
const REACH = `export default async function draw({ field, root, sandboxed }) {
  const tried = async (f) => { try { return Boolean(await f()); } catch { return false; } };
  const page = await tried(() => parent.document.body), net = await tried(() => fetch('/health').then((r) => r.ok));
  if (root) root.append(Object.assign(document.createElement('button'), { className: 'dial', textContent: 'A dial' }));
  field('said', { x: 0, y: 0, width: 300, height: 30, value: [sandboxed, page, net, Boolean(root)].join(' ') });
}`;

test('the frame a style’s code runs in is walled in, unless asked for opened: then only this server’s page may frame it', async () => {
  const { base } = await serve('off');
  const policy = async (path: string) => (await fetch(base + path)).headers.get('content-security-policy') ?? '';
  assert.match(await policy('/draw.html'), /^sandbox allow-scripts; default-src 'none'.*connect-src 'none'/);
  assert.equal(await policy('/draw.html?open=1'), "frame-ancestors 'self'");
  assert.match(await (await fetch(`${base}/draw.html?open=1`)).text(), /<html data-draw-open="on"/);
  assert.doesNotMatch(await (await fetch(`${base}/draw.html`)).text(), /data-draw-open/);
});

test('in a browser, a style’s code reaches nothing in the sandbox, and with the owner’s drawings_open, the page, the network and a panel an agent reads', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'a', type: 'work', title: 'Seed' },
      { op: 'create', ref: 'c', type: 'lens', title: 'Reaching', props: { filter: { find: ['type work'] } } },
      { op: 'create', ref: 's', type: 'layout', title: 'Reacher', props: { code: REACH } },
    ],
  })).result.created as Record<string, string>;
  await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: made.c, props: { style: { style: made.s } } }] });
  // What the code said, read in its frame: through the page when it shares the page's origin, else by attaching to it.
  const said = async (page: Awaited<ReturnType<typeof open>>) => {
    for (let n = 0; n < 100; n++, await wait(200)) {
      const near = await page.evaluate(`document.querySelector('iframe.lens-frame')?.contentDocument?.querySelector('input.field')?.value ?? ''`);
      if (near) return { said: near as string, dial: await page.evaluate(`document.querySelector('.code-stage > .code-panel > button.dial')?.textContent ?? ''`) };
      for (const t of (await page.send('Target.getTargets')).result.targetInfos as { targetId: string; type: string; url: string }[]) {
        if (t.type !== 'iframe' || !new URL(t.url).pathname.endsWith('/draw.html')) continue;
        const session = (await page.send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).result.sessionId;
        const far = (await page.send('Runtime.evaluate', { expression: `document.querySelector('input.field')?.value ?? ''`, returnByValue: true }, session)).result?.result?.value;
        if (far) return { said: far as string, dial: '' };
      }
    }
    return { said: '', dial: '' };
  };
  const look = async () => {
    const page = await open(`${base}/#/v?canvas=${made.c}`);
    try {
      await page.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
      return { ...(await said(page)), frame: String(await page.evaluate(`(() => { const f = document.querySelector('iframe.lens-frame'); return f ? [f.getAttribute('sandbox'), f.getAttribute('src')].join(' ') : ''; })()`)) };
    } finally {
      await page.close();
    }
  };
  const walled = await look();
  assert.equal(walled.said, 'true false false false', 'sandboxed, it reaches neither the page nor the network, and has no page of its own');
  assert.match(walled.frame, /^allow-scripts \/draw\.html(\?v=\w+)?$/);
  assert.equal((await call('/api/workspace_set', undefined, { drawings_open: true })).result.drawings_open, true);
  const opened = await look();
  assert.equal(opened.said, 'false true true true', 'opened, it reaches the page and the network, and has a page to put a panel in');
  assert.match(opened.frame, /^ \/draw\.html\?(v=\w+&)?open=1$/);
  assert.equal(opened.dial, 'A dial', 'its panel is read from the page, as an agent driving the browser would');
});

test('in a browser, a layout whose code is files by path runs from index.js, each import of ./name.js its file, walled in as one text is', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { base, call } = await serve('off');
  // The same code split in three: index.js re-exports the drawing, which imports a helper by './name.js'.
  const files = {
    'index.js': `export { default } from './reach.js';`,
    'reach.js': REACH.replace('export default async function draw', `import { joined } from './join.js';\nexport default async function draw`).replace(`[sandboxed, page, net, Boolean(root)].join(' ')`, `joined([sandboxed, page, net, Boolean(root)])`),
    'join.js': `export const joined = (list) => list.join(' ');`,
  };
  const made = (await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'a', type: 'work', title: 'Seed' },
      { op: 'create', ref: 'c', type: 'lens', title: 'Split', props: { filter: { find: ['type work'] } } },
      { op: 'create', ref: 's', type: 'layout', title: 'Split reacher', props: { code: files } },
    ],
  })).result.created as Record<string, string>;
  await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: made.c, props: { style: { style: made.s } } }] });
  const page = await open(`${base}/#/v?canvas=${made.c}`);
  try {
    await page.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true });
    let said = '';
    for (let n = 0; n < 100 && !said; n++, await wait(200)) {
      for (const t of (await page.send('Target.getTargets')).result.targetInfos as { targetId: string; type: string; url: string }[]) {
        if (t.type !== 'iframe' || !new URL(t.url).pathname.endsWith('/draw.html')) continue;
        const session = (await page.send('Target.attachToTarget', { targetId: t.targetId, flatten: true })).result.sessionId;
        said = (await page.send('Runtime.evaluate', { expression: `document.querySelector('input.field')?.value ?? ''`, returnByValue: true }, session)).result?.result?.value ?? '';
        if (said) break;
      }
    }
    assert.equal(said, 'true false false false', 'linked from its files, it reaches neither the page nor the network');
  } finally {
    await page.close();
  }
  // A file that is not a plain ./name.js module, or files with no index.js, is refused on write.
  for (const [code, why] of [[{ 'index.js': 'x', '../up.js': 'y' }, /plain names ending \.js/], [{ 'main.js': 'x' }, /index\.js among them/]] as const) {
    const refused = await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: made.s, props: { code } }] }).then((r) => JSON.stringify(r), (e) => String(e));
    assert.match(refused, why);
  }
});
