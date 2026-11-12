// A public page's links carry on what its data says (data.carry), to the site and the names under it, and nowhere else.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { uiFile } from '../packs/surface/kernel/ui-files.ts';

// The page's module as the server serves it, loaded as a browser would.
const dir = mkdtempSync(join(tmpdir(), 'pelago-doc-ref-'));
writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
writeFileSync(join(dir, 'doc-ref.js'), (await uiFile('doc-ref.js', null)).body as string);
const { carried } = (await import(pathToFileURL(join(dir, 'doc-ref.js')).href)) as { carried: (href: string, here: string, carry?: unknown) => string };

const HERE = 'https://site.example/pricing';
const REF = { ref: 'linkedin' };

test('a public page’s links carry what its data names, to the site and the names under it, and nowhere else', () => {
  assert.equal(carried('https://app.site.example/join?plan=solo', HERE, REF), 'https://app.site.example/join?plan=solo&ref=linkedin');
  assert.equal(carried('/quickstart', HERE, REF), 'https://site.example/quickstart?ref=linkedin');
  assert.equal(carried('https://app.site.example/', 'https://www.site.example/', { ref: 'x' }), 'https://app.site.example/?ref=x');
  assert.equal(carried('https://app.site.example/?ref=old', HERE, REF), 'https://app.site.example/?ref=linkedin', 'what it carries wins');
  assert.equal(carried('https://github.com/someone/thing', HERE, REF), 'https://github.com/someone/thing', 'another site learns nothing');
  assert.equal(carried('https://notsite.example/', HERE, REF), 'https://notsite.example/');
  assert.equal(carried('mailto:hello@site.example', HERE, REF), 'mailto:hello@site.example');
});

test('with nothing to carry, a link is left as it is', () => {
  assert.equal(carried('/quickstart', HERE), '/quickstart');
  assert.equal(carried('/quickstart', HERE, {}), '/quickstart');
  assert.equal(carried('/quickstart', HERE, { ref: '' }), '/quickstart');
  assert.equal(carried('/quickstart', HERE, { ref: 3 }), '/quickstart', 'only words');
  assert.equal(carried('/quickstart', HERE, 'ref=x'), '/quickstart');
});
