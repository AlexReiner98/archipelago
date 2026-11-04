import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sourceOf } from '../src/source-tag.ts';
import { uiFile } from '../src/ui-files.ts';

// The page's module as the server serves it, with the shared rule it imports (src/source-tag.ts), loaded as a browser would.
const dir = mkdtempSync(join(tmpdir(), 'pelago-doc-ref-'));
writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
for (const f of ['source-tag.js', 'doc-ref.js']) writeFileSync(join(dir, f), (await uiFile(f, null)).body as string);
const { carried } = (await import(pathToFileURL(join(dir, 'doc-ref.js')).href)) as { carried: (href: string, here: string, referrer?: string) => string };

const HERE = 'https://site.example/pricing?ref=linkedin';

test('a public page’s links carry where its reader came from, to the site and the names under it, and nowhere else', () => {
  assert.equal(carried('https://app.site.example/join?plan=solo', HERE), 'https://app.site.example/join?plan=solo&ref=linkedin');
  assert.equal(carried('/quickstart', HERE), 'https://site.example/quickstart?ref=linkedin');
  assert.equal(carried('https://app.site.example/', 'https://www.site.example/?ref=x'), 'https://app.site.example/?ref=x');
  assert.equal(carried('https://github.com/someone/thing', HERE), 'https://github.com/someone/thing', 'another site learns nothing');
  assert.equal(carried('https://notsite.example/', HERE), 'https://notsite.example/');
  assert.equal(carried('mailto:hello@site.example', HERE), 'mailto:hello@site.example');
  assert.equal(carried('/quickstart', 'https://site.example/pricing'), '/quickstart', 'no ref, no change');
  assert.equal(carried('/quickstart', 'https://site.example/?ref=not%20a%20tag'), '/quickstart', 'only what could be a tag');
});

test('without a ref, a public page’s links carry its utm_source, or else the other site that sent its reader', () => {
  const join = 'https://app.site.example/join';
  assert.equal(carried(join, 'https://site.example/?ref=linkedin&utm_source=chatgpt.com', 'https://claude.ai/'), `${join}?ref=linkedin`, 'a ref wins');
  assert.equal(carried(join, 'https://site.example/?utm_source=chatgpt.com', 'https://claude.ai/'), `${join}?ref=chatgpt`, 'then utm_source');
  assert.equal(carried(join, 'https://site.example/', 'https://claude.ai/chat/1'), `${join}?ref=claude`, 'then the referrer');
  assert.equal(carried(join, 'https://site.example/', 'https://www.google.com/'), `${join}?ref=google`);
  assert.equal(carried(join, 'https://site.example/', 'https://perplexity.ai/search'), `${join}?ref=perplexity`);
  assert.equal(carried(join, 'https://site.example/', 'https://news.ycombinator.com/item?id=1'), `${join}?ref=ycombinator`);
  assert.equal(carried(join, 'https://site.example/', 'https://site.example/pricing'), join, 'the site itself is no source');
  assert.equal(carried(join, 'https://www.site.example/', 'https://app.site.example/'), join, 'nor a name under it');
  assert.equal(carried(join, 'https://site.example/', ''), join, 'no referrer, no change');
  assert.equal(carried(join, 'https://site.example/?utm_source=Newsletter', 'https://claude.ai/'), `${join}?ref=newsletter`, 'a plain word is the tag');
  assert.equal(carried(join, 'https://site.example/?utm_source=a%20b', 'https://claude.ai/'), join, 'a utm_source that makes no tag');
  assert.equal(carried(join, 'https://site.example/?utm_source=%2A%2A.x', ''), join);
  assert.equal(carried(join, 'https://site.example/', 'https://localhost/'), join, 'a referrer that makes no tag');
  assert.equal(carried(join, 'https://site.example/?ref=a%20b', 'https://claude.ai/'), join, 'a ref that is no tag falls back to nothing');
  assert.equal(carried('https://github.com/x', 'https://site.example/?utm_source=chatgpt.com', 'https://claude.ai/'), 'https://github.com/x', 'another site learns nothing');
});

test('the server reads the same tag the page carries, from the one rule', () => {
  const at = (q: string) => new URL(`https://site.example/${q}`);
  assert.equal(sourceOf(at('?ref=linkedin'), 'site.example', ''), 'linkedin');
  assert.equal(sourceOf(at('?utm_source=chatgpt.com'), 'site.example', ''), 'chatgpt');
  assert.equal(sourceOf(at('?utm_source=Newsletter'), 'site.example', ''), 'newsletter');
  assert.equal(sourceOf(at(''), 'site.example', 'https://news.ycombinator.com/item?id=1'), 'ycombinator');
  assert.equal(sourceOf(at(''), 'site.example', 'https://app.site.example/'), null, 'the site itself is no source');
  assert.equal(sourceOf(at('?ref=a%20b'), 'site.example', 'https://claude.ai/'), null, 'junk');
  assert.equal(sourceOf(at(''), 'site.example', 'not a url'), null);
});
