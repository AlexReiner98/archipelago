import assert from 'node:assert/strict';
import { test } from 'node:test';

const { carried } = (await import(`../ui/${'doc-ref'}.js`)) as { carried: (href: string, here: string, referrer?: string) => string };

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
