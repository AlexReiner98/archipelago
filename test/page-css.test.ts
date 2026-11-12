// A style's page_css (packs/walls/kernel/css-check.ts): checked when it is written by the rules the page reads it by (packs/walls/page/marks.js,
// checkedCss, imports the same file), refused there with what is wrong; and a published page keeps the look it was
// published in until it is published again (packs/publish/kernel/published.ts, packs/styles/kernel/styles.ts pageLook).

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { test } from 'node:test';
import { cssProblem } from '../packs/walls/kernel/css-check.ts';
import { packsWith } from './map.ts';
import { serve } from './serve.ts';

test('a sheet is refused for what could fetch or reach out of where it is read, and the line it is on is named', () => {
  assert.equal(cssProblem('h2 { letter-spacing: 3px; }', true), undefined);
  assert.equal(cssProblem('/* a & b */ h2 { color: red }', true), undefined, 'a comment is taken out first');
  assert.equal(cssProblem('h2 { color: red }\nh3 a:hover & b { color: blue }', true), 'the character & (line 2)');
  assert.match(cssProblem('@import x;', true)!, /^@import/);
  assert.match(cssProblem('h2 { background: url(https://example.com/) }', true)!, /^url\(/);
  assert.match(cssProblem('h2 { } > p { }', true)!, /starts with >/);
  assert.match(cssProblem('h2 { color: red', true)!, /never closed/);
  assert.match(cssProblem('h2 { } }', true)!, /closes nothing/);
  // A page may look at what a part holds; a drawing may not.
  assert.equal(cssProblem('section:has(> .doc-lens) > h2 { }', true), undefined);
  assert.match(cssProblem('section:has(> .doc-lens) > h2 { }')!, /^:has\(/);
});

test('the page checks a sheet by the same file the server does', async () => {
  const marks = await readFile(join(import.meta.dirname, '..', 'packs', 'walls', 'page', 'marks.js'), 'utf8');
  assert.match(marks, /import \{ cssProblem, uncommented \} from '\.\/css-check\.js'/);
  const { base } = await serve('off');
  const served = await (await fetch(`${base}/css-check.js`)).text();
  assert.match(served, /export function cssProblem\(text\s*, page = false\)\s*\{/, 'served with its types stripped');
});

test('a bad page_css is refused when it is written, and a published page keeps the look it was published in', async () => {
  // A test pack's writing is what can be published (test/packs/reader).
  const { call, base } = await serve('off', undefined, undefined, packsWith('reader'));
  const made = (
    await call('/api/change', undefined, {
      reason: 'test',
      ops: [
        { op: 'create', ref: 'look', type: 'style', title: 'The site', status: 'current', props: { page_css: 'h2 { letter-spacing: 3px; }' } },
        { op: 'create', ref: 'd', type: 'writing', title: 'A page', visibility: 'shared', body: 'Its words.' },
      ],
    })
  ).result.created as Record<string, string>;
  const refused = await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: made.look, props: { page_css: 'h2 { letter-spacing: 3px; }\nh3 a & b { color: red }' } }] });
  assert.equal(refused.status, 400, JSON.stringify(refused));
  assert.match(JSON.stringify(refused), /page_css is a stylesheet a page refuses: the character & \(line 2\)/);
  assert.equal((await call('/api/publish', undefined, { id: made.d })).status, 200);
  const data = async () => (await (await fetch(`${base}/p/default/${made.d}/data`)).json()) as Record<string, unknown>;
  assert.equal((await data()).page_css, 'h2 { letter-spacing: 3px; }');
  assert.equal((await data()).look, undefined, 'the look is sent as the page’s own fields, not twice');
  // A change to the style reaches the page only when it is published again.
  assert.equal((await call('/api/change', undefined, { reason: 'test', ops: [{ op: 'update', id: made.look, props: { page_css: 'h2 { letter-spacing: 5px; }' } }] })).status, 200);
  assert.equal((await data()).page_css, 'h2 { letter-spacing: 3px; }');
  assert.equal((await call('/api/publish', undefined, { id: made.d })).status, 200);
  assert.equal((await data()).page_css, 'h2 { letter-spacing: 5px; }');
});
