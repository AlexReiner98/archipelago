// A published picture's first frame (src/published-frames.ts) and the page it is sent in (src/published-page.ts): at
// publish the server runs a drawing that is the pack's own and keeps the scene it opens on; the page carries its data
// and hints every module it starts with; a drawing's code is fetched by its hash. In a real browser (skipped where
// there is no Chrome): the page's text and the picture's first frame are on the page together, and the drawing then
// takes the picture over; a first frame that says what a drawing may not is not drawn.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { serve } from './serve.ts';

/** A document whose picture is a system drawn as architecture, played in two steps. */
async function published(call: (path: string, token?: string, body?: unknown) => Promise<any>, extra: unknown[] = []) {
  const made = (
    await call('/api/change', undefined, {
      reason: 'test',
      ops: [
        { op: 'create', ref: 'd', type: 'work.document', title: 'The system', visibility: 'shared', body: 'What it is: </script><script>alert(1)</script> $& $\'.\n\n{l}' },
        { op: 'create', ref: 'p', type: 'work.project', title: 'A system', visibility: 'shared' },
        { op: 'create', ref: 'e', type: 'software.environment', title: 'A server', status: 'up', visibility: 'shared' },
        { op: 'create', ref: 'a', type: 'software.component', title: 'Doors', status: 'up', visibility: 'shared' },
        { op: 'create', ref: 'b', type: 'software.component', title: 'Store', status: 'up', visibility: 'shared', props: { role: 'data' } },
        { op: 'link', type: 'part_of', from: 'e', to: 'p' },
        { op: 'link', type: 'part_of', from: 'a', to: 'e' },
        { op: 'link', type: 'part_of', from: 'b', to: 'e' },
        { op: 'link', type: 'software.calls', from: 'a', to: 'b' },
        { op: 'create', ref: 'l', type: 'lens', title: 'What talks to what', visibility: 'shared', status: 'current', props: { filter: { types: ['work.project', 'software.environment', 'software.component'] } } },
        { op: 'link', type: 'about', from: 'l', to: 'p' },
        { op: 'link', type: 'part_of', from: 'l', to: 'd' },
        { op: 'create', ref: 's', type: 'style', title: 'As architecture', status: 'current', props: { shape: 'architecture' } },
        { op: 'link', type: 'about', from: 's', to: 'l' },
        ...extra,
      ],
    })
  ).result.created as Record<string, string>;
  const steps = [{ add: [made.a], lines: [{ by: 'Alex', text: 'Doors first.' }] }, { add: [made.b], lines: [{ by: 'Agent', text: 'Then a store.' }] }];
  await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: made.l, props: { steps } }] });
  assert.equal((await call('/api/publish', undefined, { id: made.d })).status, 200);
  return made;
}

test('a published picture keeps its first frame, its page carries its data, and its drawing is fetched by its hash', async () => {
  const { call, base } = await serve('off');
  const { d, l } = await published(call);
  const data = await (await fetch(`${base}/p/default/${d}/data`)).json();
  const lens = data.lenses[l];
  assert.equal(lens.first.svg[0], 'svg', 'the scene the drawing opens on is kept');
  assert.ok(lens.first.before && lens.first.aside, 'with what is drawn above and beside it');
  const { drawing } = lens.style;
  assert.equal(drawing.modules, undefined, 'its code is not in the data');
  assert.equal(drawing.src, `/p/default/${d}/drawing/${drawing.hash}`);
  const code = await fetch(`${base}${drawing.src}`);
  assert.equal(code.status, 200);
  assert.match(code.headers.get('cache-control') ?? '', /immutable/);
  assert.ok(Object.keys(await code.json()).includes('index.js'));
  assert.equal((await fetch(`${base}/p/default/${d}/drawing/${'0'.repeat(64)}`)).status, 404);

  // The page holds the same data, nothing in it able to close its element, and hints each module the page starts with.
  const html = await (await fetch(`${base}/p/default/${d}`)).text();
  const inPage = /<script type="application\/json" id="page-data">([^<]*)<\/script>/.exec(html);
  assert.ok(inPage, 'the data is in the page');
  assert.deepEqual(JSON.parse(inPage[1]), data);
  assert.equal(html.match(/<script/g)?.length, 2, 'no script but its own and its data');
  for (const file of ['/doc-lens.js', '/drawing.js', '/marks.js', '/base.js']) assert.match(html, new RegExp(`<link rel="modulepreload" href="${file}[?]v=`), file);
  assert.ok(html.indexOf('src="/doc.js') < html.indexOf('id="page-data"'), 'its script is asked for before its data is read');
  assert.ok(!html.includes('Loading'));
  assert.ok(!html.includes('noindex'), 'what the text says is not read as a replacement pattern');
});

test('a picture drawn by the owner’s version of a drawing is drawn only in the sandbox', async () => {
  const { call, base } = await serve('off');
  const look = 'export const css = `.ar-part { cursor: help; }`;\n';
  const { d, l } = await published(call, [{ op: 'create', type: 'style', title: 'Architecture, mine', status: 'current', props: { preset: 'core.architecture', modules: { 'look.js': look } } }]);
  const data = await (await fetch(`${base}/p/default/${d}/data`)).json();
  assert.equal(data.lenses[l].first, undefined);
  assert.equal((await (await fetch(`${base}${data.lenses[l].style.drawing.src}`)).json())['look.js'], look);
});

const browser = chrome();

test('in a browser, the text and the first frame are on the page together, and the drawing takes the picture over', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { call, base } = await serve('off');
  const { d, l } = await published(call);
  const page = await open('about:blank');
  try {
    // Whether the picture was there when the text first was.
    await page.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `new MutationObserver((_, seen) => { const text = document.querySelector('main h1'); if (!text) return; window.together = Boolean(document.querySelector('[data-lens="${l}"] svg')); seen.disconnect(); }).observe(document, { childList: true, subtree: true })`,
    });
    await page.go(`${base}/p/default/${d}`);
    assert.equal(await page.evaluate('window.together'), true);
    assert.equal(await page.evaluate('document.body.textContent.includes("</script><script>alert(1)</script> $& $\'.")'), true, 'the text is the text');
    // The drawing plays it: the first step's part is drawn.
    const drawn = await page.evaluate(`(async () => {
      for (let n = 0; n < 400 && !document.querySelector('[data-lens] a.ar-part[opacity="1"]'); n++) await new Promise((r) => setTimeout(r, 25));
      return document.querySelectorAll('[data-lens] a.ar-part[opacity="1"]').length;
    })()`);
    assert.ok(Number(drawn) >= 1, 'the drawing played its first step');

    // A first frame that says what a drawing may not is not drawn: the drawing draws the picture.
    const said = await page.evaluate(`(async () => {
      const { drawWith } = await import('/drawing.js');
      const answer = JSON.parse(document.getElementById('page-data').textContent).lenses[${JSON.stringify(l)}];
      const host = document.createElement('div');
      document.body.append(host);
      drawWith(host, { ...answer, first: { svg: ['svg', {}, ['script', {}, 'parent.document.body.remove()']] } }, { ...answer.style, still: true }, () => {});
      const at = host.innerHTML;
      for (let n = 0; n < 400 && !host.querySelector('svg a.ar-part'); n++) await new Promise((r) => setTimeout(r, 25));
      return { at, scripts: document.querySelectorAll('script:not([src]):not([type])').length, drawn: Boolean(host.querySelector('svg a.ar-part')) };
    })()`);
    assert.deepEqual(said, { at: '', scripts: 0, drawn: true });
  } finally {
    page.close();
  }
});

test('a page opened with ?live is told when its document is published again', async () => {
  const { call, base } = await serve('off');
  const { d } = await published(call);
  const ac = new AbortController();
  const res = await fetch(`${base}/p/default/${d}/live`, { signal: ac.signal });
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  const reader = res.body!.getReader();
  const said = async () => new TextDecoder().decode((await reader.read()).value);
  assert.match(await said(), /listening/);
  await call('/api/publish', undefined, { id: d });
  assert.match(await said(), /event: published/);
  ac.abort();
  assert.equal((await fetch(`${base}/p/default/e_nothere0/live`)).status, 404);
});

test('in a browser, a page opened with ?live draws itself anew when published again, with no reload', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { call, base } = await serve('off');
  const { d, s } = await published(call);
  const page = await open(`${base}/p/default/${d}?live`);
  try {
    await page.evaluate(`(async () => { for (let n = 0; n < 200 && !document.querySelector('main h1'); n++) await new Promise((r) => setTimeout(r, 25)); window.stayed = true; })()`);
    await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: d, title: 'The system, renamed' }, { op: 'update', id: s, props: { lit: 'all' } }] });
    await call('/api/publish', undefined, { id: d });
    const title = await page.evaluate(`(async () => { for (let n = 0; n < 200 && document.querySelector('main h1')?.textContent !== 'The system, renamed'; n++) await new Promise((r) => setTimeout(r, 25)); return document.querySelector('main h1').textContent; })()`);
    assert.equal(title, 'The system, renamed');
    assert.equal(await page.evaluate('window.stayed'), true, 'the page was not loaded again');
  } finally {
    page.close();
  }
});

test('in a browser, the workspace style’s page_css is how a published page looks, checked as a drawing’s stylesheet is', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { call, base } = await serve('off');
  const { d } = await published(call, [{ op: 'create', ref: 'look', type: 'style', title: 'The site', status: 'current', props: { page_css: 'section:has(> .doc-lens) > h2 { letter-spacing: 3px; }' } }]);
  assert.equal((await (await fetch(`${base}/p/default/${d}/data`)).json()).page_css, 'section:has(> .doc-lens) > h2 { letter-spacing: 3px; }');
  const page = await open(`${base}/p/default/${d}`);
  const spacing = () => page.evaluate(`(async () => { for (let n = 0; n < 200 && !document.querySelector('section > h2'); n++) await new Promise((r) => setTimeout(r, 25)); return getComputedStyle(document.querySelector('section > h2')).letterSpacing; })()`);
  try {
    assert.equal(await spacing(), '3px');
    // One that would fetch something is not read, and the page is drawn as it is.
    const { rows } = { rows: (await call('/api/search', undefined, { q: 'The site', type: 'style' })).result };
    await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: rows[0].id, props: { page_css: 'h2 { letter-spacing: 3px; background: url(https://example.com/) }' } }] });
    await page.go(`${base}/p/default/${d}`);
    assert.equal(await spacing(), 'normal');
    assert.equal(await page.evaluate(`document.querySelector('main h1').textContent`), 'The system');
  } finally {
    page.close();
  }
});

test('in a browser, a part hovered says what it is in a tip its drawing makes, beside it, not in a line over the picture', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { call, base } = await serve('off');
  const { d, a } = await published(call);
  await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: a, body: 'Where everything comes in: the MCP server, the CLI and the web.' }] });
  await call('/api/publish', undefined, { id: d });
  const page = await open(`${base}/p/default/${d}`);
  try {
    const got = await page.evaluate(`(async () => {
      const until = async (test) => { for (let n = 0; n < 400 && !test(); n++) await new Promise((r) => setTimeout(r, 25)); return test(); };
      let part;
      await until(() => (part = document.querySelector('[data-lens] svg a[href="#/e/${a}"][opacity="1"]')));
      const tip = () => document.querySelector('[data-lens] .drawing-tip');
      part.dispatchEvent(new MouseEvent('mouseenter'));
      await until(() => tip() && !tip().hidden);
      const shown = { text: tip().textContent, styled: getComputedStyle(tip().firstChild).borderTopStyle, title: part.querySelector('title') === null, said: document.querySelector('.lens-said') === null };
      part.dispatchEvent(new MouseEvent('mouseleave'));
      await until(() => tip().hidden);
      const left = { after: tip().hidden, back: part.querySelector('title') !== null };
      // A place says what it is from its name only: its box, around its parts, says nothing.
      document.querySelector('[data-lens] svg rect.ar-place-box[opacity="1"]').dispatchEvent(new MouseEvent('mouseenter'));
      await new Promise((r) => setTimeout(r, 300));
      const boxSays = !tip().hidden;
      document.querySelector('[data-lens] svg a.ar-place[opacity="1"]').dispatchEvent(new MouseEvent('mouseenter'));
      return { ...shown, ...left, boxSays, nameSays: await until(() => !tip().hidden) };
    })()`);
    assert.deepEqual(got, { text: 'DoorsWhere everything comes in: the MCP server, the CLI and the web.', styled: 'solid', title: true, said: true, after: true, back: true, boxSays: false, nameSays: true });
  } finally {
    page.close();
  }
});
