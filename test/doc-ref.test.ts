import assert from 'node:assert/strict';
import { test } from 'node:test';

const { carried } = (await import(`../ui/${'doc-ref'}.js`)) as { carried: (href: string, here: string) => string };

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
