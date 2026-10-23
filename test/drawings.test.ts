// Pictures drawn by drawings (src/drawings.ts, ui/drawing.js): code a pack ships, changed on the map, run in the
// sandbox and answering with marks the page checks. The server sends a drawing once; the owner's version stands in
// for the pack's module by module. In a real browser (skipped where there is no Chrome): the architecture drawing
// draws what the kernel drew before it, mark for mark, look for look; and a drawing that tries what a drawing may not
// is stopped, and reaches nothing.

import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { chrome, open } from './browser.ts';
import { architectureCases } from './drawing-cases.ts';
import { stepsShown } from '../src/lens-steps.ts';
import { serve } from './serve.ts';

/** A small system on the map, its picture kept as a lens drawn as architecture. */
async function system(call: (path: string, token?: string, body?: unknown) => Promise<any>) {
  const made = await call('/api/change', undefined, {
    reason: 'test',
    ops: [
      { op: 'create', ref: 'p', type: 'work.project', title: 'A system' },
      { op: 'create', ref: 'e', type: 'software.environment', title: 'A server', status: 'up' },
      { op: 'create', ref: 'a', type: 'software.component', title: 'Doors', status: 'up' },
      { op: 'create', ref: 'b', type: 'software.component', title: 'Store', status: 'up', props: { role: 'data' } },
      { op: 'link', type: 'part_of', from: 'e', to: 'p' },
      { op: 'link', type: 'part_of', from: 'a', to: 'e' },
      { op: 'link', type: 'part_of', from: 'b', to: 'e' },
      { op: 'link', type: 'software.calls', from: 'a', to: 'b' },
      { op: 'create', ref: 'l', type: 'lens', title: 'What talks to what', status: 'current', props: { over: ['software.calls'] } },
      { op: 'link', type: 'about', from: 'l', to: 'p' },
      { op: 'create', ref: 's', type: 'style', title: 'As architecture', status: 'current', props: { shape: 'architecture' } },
      { op: 'link', type: 'about', from: 's', to: 'l' },
    ],
  });
  return made.result.created as Record<string, string>;
}

test('a picture is sent the drawing its shape is drawn by, once, and the owner’s version stands in module by module', async () => {
  const { call } = await serve('off');
  const { p, l } = await system(call);
  const first = (await call('/api/view', undefined, { name: 'lens', params: { from: p, lens: l } })).result.style.drawing;
  assert.equal(first.id, 'core.architecture');
  assert.deepEqual(Object.keys(first.modules).sort(), ['index.js', 'layout.js', 'look.js', 'marks.js', 'play.js', 'route.js', 'says.js', 'story-look.js', 'story.js']);
  assert.match(first.hash, /^[0-9a-f]{64}$/);
  // A page that has it is sent only its name.
  const again = (await call('/api/view', undefined, { name: 'lens', params: { from: p, lens: l, have: [first.hash] } })).result.style.drawing;
  assert.deepEqual(again, { id: 'core.architecture', title: 'Architecture', hash: first.hash });
  // What holds an item is drawn as a flow, which no drawing draws yet: no drawing is sent.
  const holding = (await call('/api/view', undefined, { name: 'lens', params: { from: p, lens: 'holding' } })).result.style;
  assert.equal(holding.drawing, undefined);

  // The owner's version changes one module; the rest are the pack's.
  const look = 'export const css = `.ar-part { cursor: help; }`;\n';
  await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', type: 'style', title: 'Architecture, mine', status: 'current', props: { preset: 'core.architecture', modules: { 'look.js': look } } }] });
  const mine = (await call('/api/view', undefined, { name: 'lens', params: { from: p, lens: l, have: [first.hash] } })).result.style.drawing;
  assert.notEqual(mine.hash, first.hash);
  assert.equal(mine.modules['look.js'], look);
  assert.equal(mine.modules['index.js'], first.modules['index.js']);

  // An agent's version waits for the human: it is code that runs in whoever looks.
  const asked = await call('/agent/change', undefined, { reason: 'test', ops: [{ op: 'create', type: 'style', title: 'Architecture, the agent’s', status: 'current', props: { modules: { 'look.js': look } } }] });
  assert.equal(asked.result.status, 'proposed');
  // Unless the owner lets agents change drawings here: it runs in the sandbox either way.
  assert.equal((await call('/api/workspace_set', undefined, { agent_code: true, agent_changes: 'apply' })).result.agent_code, true);
  const made = await call('/agent/change', undefined, { reason: 'test', ops: [{ op: 'create', type: 'style', title: 'Architecture, the agent’s again', status: 'current', props: { modules: { 'look.js': look } } }] });
  assert.equal(made.result.status, 'applied');
  // What else is held is held still: a change to what anyone sees is the human's.
  const shown = await call('/agent/change', undefined, { reason: 'test', ops: [{ op: 'update', id: p, visibility: 'public' }] });
  assert.equal(shown.result.status, 'proposed');
});

test('a picture with steps is sent them, and the finished parts they name, whatever it folds away', async () => {
  const { call } = await serve('off');
  const { p, l, e, a } = await system(call);
  const old = (await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'create', ref: 'o', type: 'software.component', title: 'Old backups', status: 'retired' }, { op: 'link', type: 'part_of', from: 'o', to: e }, { op: 'link', type: 'software.calls', from: a, to: 'o' }] })).result.created.o;
  const steps = [{ chapter: { name: 'Then', when: '7 Oct', count: 1 }, add: [a, old], titles: { [a]: 'Old doors' }, lines: [{ by: 'Alex', text: 'Back it up.' }] }, { remove: [old], lines: [{ by: 'Agent', text: 'It is gone.' }] }];
  await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: l, props: { steps } }] });
  const answer = (await call('/api/view', undefined, { name: 'lens', params: { from: p, lens: l } })).result;
  assert.deepEqual(answer.steps, steps);
  assert.ok(answer.items.some((i: any) => i.id === old && !i.open), 'the retired part is sent');
  assert.ok(answer.links.some((k: any) => k.from === a && k.to === old), 'and its wire');
  // Steps that cannot be read say why.
  await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: l, props: { steps: [{ add: 'all of it' }] } }] });
  assert.match((await call('/api/view', undefined, { name: 'lens', params: { from: p, lens: l } })).error ?? '', /add and remove are lists of ids/);
});

test('a published picture keeps its steps, naming only what it shows', () => {
  const steps = [{ add: ['e_shown000', 'e_hidden00'], titles: { e_shown000: 'Then', e_hidden00: 'Secret' }, flag: { e_hidden00: 'US' }, lit: [['e_shown000', 'e_hidden00'], ['e_shown000', 'e_shown001']] as [string, string][], lines: [{ by: 'Alex', text: 'Hello.' }] }];
  assert.deepEqual(stepsShown(steps, new Set(['e_shown000', 'e_shown001'])), [{ add: ['e_shown000'], titles: { e_shown000: 'Then' }, flag: {}, lit: [['e_shown000', 'e_shown001']], lines: [{ by: 'Alex', text: 'Hello.' }] }]);
});

const browser = chrome();
const GOLDEN = join(import.meta.dirname, 'fixtures', 'drawings', `architecture.golden.${process.platform}.json`);

test('in a browser, the architecture drawing draws what the kernel drew: the same marks, looks, hovering, lighting and key', { skip: !browser && 'no Chrome here (set CHROME)' }, async () => {
  const { call, base } = await serve('off');
  const { p, l } = await system(call);
  const { drawing } = (await call('/api/view', undefined, { name: 'lens', params: { from: p, lens: l } })).result.style;
  const page = await open(`${base}/`);
  try {
    await page.evaluate(readFileSync(join(import.meta.dirname, 'drawing-capture.js'), 'utf8'));
    const cases = architectureCases().map((c) => ({ ...c, style: { ...c.style, drawing } }));
    const now: any = await page.evaluate(`(async () => { const { drawWith } = await import('/drawing.js'); return captureDrawings(drawWith, ${JSON.stringify(cases)}); })()`);
    for (const c of cases) assert.ok(now[c.name].html.includes('ar-part'), `${c.name} is drawn: ${now[c.name].html.slice(0, 200)}`);
    // Text is measured by the fonts of the machine: compared with what was drawn on one like it.
    if (existsSync(GOLDEN)) {
      const was = JSON.parse(readFileSync(GOLDEN, 'utf8'));
      for (const name of Object.keys(was)) {
        const [a, b] = [was[name], now[name]];
        assert.equal(b.html, a.html, `${name}: the marks`);
        assert.deepEqual(b.styles.map((k: number) => b.looks[k]), a.styles.map((k: number) => a.looks[k]), `${name}: the looks`);
        for (const k of ['hover', 'after_hover', 'dim', 'key']) assert.deepEqual(b[k], a[k], `${name}: ${k}`);
      }
    }
    // And in the app: the lens view draws it, and asks for no drawing it has.
    const parts = await page.evaluate(`(async () => {
      const { lensView } = await import('/lens.js');
      const view = lensView({ lens: { from: ${JSON.stringify(p)}, lens: ${JSON.stringify(l)} } });
      document.body.append(view);
      await view.ready;
      for (let n = 0; n < 200 && !view.querySelector('.lf-stage a.ar-part'); n++) await new Promise((r) => setTimeout(r, 25));
      return view.querySelectorAll('.lf-stage a.ar-part').length;
    })()`);
    assert.equal(parts, 2);
    // A page that draws its body anew keeps the frame drawings run in: the next picture still draws.
    const after = await page.evaluate(`(async () => {
      const { drawWith } = await import('/drawing.js');
      const host = document.createElement('div');
      document.body.replaceChildren(host);
      drawWith(host, ${JSON.stringify(cases[0].answer)}, ${JSON.stringify(cases[0].style)}, () => {});
      for (let n = 0; n < 200 && !host.querySelector('.lf-stage svg'); n++) await new Promise((r) => setTimeout(r, 25));
      return host.querySelectorAll('.lf-stage a.ar-part').length;
    })()`);
    assert.equal(after, 21);
  } finally {
    page.close();
  }
});

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
      tip: hostile(`{ svg: ['svg', { key: 'x' }] }`, `setTimeout(() => tools.patch([{ tip: { key: 'x', mark: ['script', {}, 'parent.document.body.remove()'] } }]), 50)`),
    };
    const body = await page.evaluate('getComputedStyle(document.body).display');
    const got: Record<string, string> = await page.evaluate(`(async () => {
      const { drawWith } = await import('/drawing.js');
      const out = {};
      for (const [name, code] of Object.entries(${JSON.stringify(tries)})) {
        const host = document.createElement('div');
        document.body.append(host);
        drawWith(host, { items: [], links: [], lens: {} }, { drawing: { hash: name.padEnd(64, '0'), modules: { 'index.js': code } } }, () => {});
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
      const { drawWith } = await import('/drawing.js');
      const host = document.createElement('div');
      document.body.append(host);
      drawWith(host, { items: [], links: [], lens: {} }, { drawing: { hash: 'reach'.padEnd(64, '0'), modules: { 'index.js': ${JSON.stringify(reach)} } } }, () => {});
      for (let n = 0; n < 200 && !host.textContent; n++) await new Promise((r) => setTimeout(r, 25));
      return host.textContent;
    })()`);
    assert.match(String(said), /^undefined undefined undefined (no-idb|idb) blocked$/);

    // Code that never answers is stopped, and says so.
    const stuck = hostile(`{}`, 'for (;;) {}');
    const stopped = await page.evaluate(`(async () => {
      const { drawWith } = await import('/drawing.js');
      const host = document.createElement('div');
      document.body.append(host);
      drawWith(host, { items: [], links: [], lens: {} }, { drawing: { hash: 'stuck'.padEnd(64, '0'), modules: { 'index.js': ${JSON.stringify(stuck)} } } }, () => {});
      for (let n = 0; n < 800 && !host.textContent; n++) await new Promise((r) => setTimeout(r, 25));
      return host.textContent;
    })()`);
    assert.match(String(stopped), /did not answer for 12 seconds/);
  } finally {
    page.close();
  }
});
