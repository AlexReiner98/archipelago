// The reader, text in and data out: value and type imports, relative targets, the pack and the header comment.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { headerOf, importsOf, kernelCodeOf, packOf, readModule, resolve, rootCodeOf, rootPacksOf, typeImports, valueImports } from './reader.ts';

const MODULE = [
  '// The map and its single write path.',
  '// Every change goes through change().',
  '',
  "import { decide, type Policy } from '../anatomy_sync/rules.ts';",
  "import type { Registry } from '../anatomy_sync/registry.ts';",
  "import { a } from './a.ts'; import { b } from './b.ts';",
  "export { c } from './c.ts';",
  "export type { D } from './d.ts';",
  "import 'node:fs';",
  "const later = await import('./lazy.ts');",
  "const old = require('./old.js');",
  "import zlib from 'node:zlib';",
].join('\n');

test('value and type imports are told apart', () => {
  const at = 'packs/anatomy_sync/reader.ts';
  assert.deepEqual(valueImports(MODULE, at).map((i) => [i.kind, i.spec]), [
    ['import', '../anatomy_sync/rules.ts'],
    ['import', './a.ts'],
    ['import', './b.ts'],
    ['export', './c.ts'],
    ['bare', 'node:fs'],
    ['dynamic', './lazy.ts'],
    ['require', './old.js'],
    ['import', 'node:zlib'],
  ]);
  assert.deepEqual(typeImports(MODULE, at).map((i) => [i.kind, i.spec]), [
    ['import', '../anatomy_sync/registry.ts'],
    ['export', './d.ts'],
  ]);
});

test('a relative import is resolved from its file; a dependency or built-in is not', () => {
  const found = importsOf(MODULE, 'packs/anatomy_sync/reader.ts');
  const to = Object.fromEntries(found.map((i) => [i.spec, i.to]));
  assert.equal(to['../anatomy_sync/rules.ts'], 'packs/anatomy_sync/rules.ts');
  assert.equal(to['./a.ts'], 'packs/anatomy_sync/a.ts');
  assert.equal(to['node:zlib'], undefined);
  assert.equal(to['node:fs'], undefined);
  assert.equal(resolve('src/boot.ts', '../packs/core/kernel/x.ts'), 'packs/core/kernel/x.ts');
  assert.ok(importsOf(MODULE).every((i) => i.to === undefined), 'without a path, nothing is resolved');
});

test('Windows line endings read alike', () => {
  const crlf = MODULE.replace(/\n/g, '\r\n');
  assert.deepEqual(importsOf(crlf, 'a/b.ts').map((i) => i.spec), importsOf(MODULE, 'a/b.ts').map((i) => i.spec));
  assert.equal(headerOf(crlf), headerOf(MODULE));
});

test('the header comment is kept, its markers off', () => {
  assert.equal(headerOf(MODULE), 'The map and its single write path.\nEvery change goes through change().');
  assert.equal(headerOf('#!/usr/bin/env node\n// Runs the server.\nimport os from "node:os";'), 'Runs the server.');
  assert.equal(headerOf('/**\n * A block that says\n * two lines.\n */\nexport const x = 1;'), 'A block that says\ntwo lines.');
  assert.equal(headerOf("import os from 'node:os';\n// not a header"), '');
});

test('a module knows its pack from its path', () => {
  assert.equal(packOf('packs/write/kernel/pelago.ts'), 'write');
  assert.equal(packOf('packs/anatomy_sync/reader.ts'), 'anatomy_sync');
  assert.equal(packOf('src/boot.ts'), undefined);
  const m = readModule('packs/anatomy_sync/reader.ts', MODULE);
  assert.equal(m.pack, 'anatomy_sync');
  assert.equal(m.header.split('\n')[0], 'The map and its single write path.');
  assert.equal(m.imports.length, 10);
  assert.equal('pack' in readModule('src/boot.ts', ''), false);
});

test('the kernel is src/ and the root packs\' code', () => {
  const roots = rootPacksOf({ core: { kernel: { trust: 'root' } }, mentions: { kernel: { trust: 'service' } }, refine: {} });
  assert.deepEqual(roots, ['core']);
  const files = ['src/boot.ts', 'src/boot.test.ts', 'src/notes.md', 'packs/core/kernel/a.ts', 'packs/core/kernel/a.test.ts', 'packs/core/pack.json', 'packs/mentions/kernel/m.ts'];
  assert.deepEqual(rootCodeOf(files, roots), ['packs/core/kernel/a.ts']);
  assert.deepEqual(kernelCodeOf(files, roots), ['src/boot.ts', 'src/boot.test.ts', 'packs/core/kernel/a.ts']);
});
