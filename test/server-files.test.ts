// A server pack hands out files of its files/ folder (src/server-files.ts): each filled with only the values it
// names, sent public and kept by nobody, under a version that moves when any of its files does; a session's folder is
// behind when its hook says another version than the setup pack's, and the kernel's own setup counts only while no
// pack takes the setup mount.

import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { filesVersion, handsOut, serveFile, setupBehind, setupPack, setupVersion } from '../packs/surface/kernel/server-files.ts';
import { loadServerPacks } from '../packs/loader/kernel/server-packs.ts';
import { workingRules } from '../packs/loader/kernel/working-rules.ts';

const FIXTURES = join(import.meta.dirname, 'server-packs', 'setup');
const dir = mkdtempSync(join(tmpdir(), 'pelago-files-'));
after(() => rmSync(dir, { recursive: true, force: true }));

/** What serveFile writes, caught. */
function caught() {
  const got = { status: 0, headers: {} as Record<string, string>, body: '' };
  const res = {
    writeHead(status: number, headers: Record<string, string>) {
      Object.assign(got, { status, headers });
      return res;
    },
    end(body: string) {
      got.body = body;
      return res;
    },
  };
  return { res: res as unknown as ServerResponse, got };
}

const AT = { origin: 'https://maps.example', tokens: false };

test('a file is sent with its type, public and kept by nobody, filled with only what it names', async () => {
  const { packs, refused } = loadServerPacks([FIXTURES]);
  assert.deepEqual(refused, []);
  const [pack] = packs;
  const version = filesVersion(pack.file, pack.folder);
  assert.match(version, /^[0-9a-f]{12}$/);

  const script = caught();
  await serveFile(script.res, pack.file, 'setup', { ...AT, folder: pack.folder });
  assert.equal(script.got.status, 200);
  assert.equal(script.got.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal(script.got.headers['cache-control'], 'no-store');
  assert.equal(script.got.headers['x-content-type-options'], 'nosniff');
  // In a script each value is a JavaScript value, so the file runs as it is.
  const lines = script.got.body.split(/\r?\n/);
  assert.equal(lines[0], 'const ORIGIN = "https://maps.example";');
  assert.equal(lines[1], 'const TOKENS = false;');
  assert.equal(lines[2], `const VERSION = "${version}";`);
  assert.equal(lines[3], `const RULES = ${JSON.stringify(workingRules())};`);
  assert.doesNotMatch(script.got.body, /\{(origin|tokens|version|rules)\}/);

  // Any other file takes the values as text, and only those it names: its {version} is left as written.
  const notes = caught();
  await serveFile(notes.res, pack.file, 'notes', { ...AT, folder: pack.folder });
  assert.equal(notes.got.headers['content-type'], 'text/markdown; charset=utf-8');
  assert.match(notes.got.body, /^https:\/\/maps\.example, at version \{version\}\.$/m);

  // A file it does not declare is not there.
  const none = caught();
  await serveFile(none.res, pack.file, 'pack', { ...AT, folder: pack.folder });
  assert.equal(none.got.status, 404);
});

test('the version moves when a file does, and a folder is behind on any other version', () => {
  cpSync(FIXTURES, join(dir, 'setup'), { recursive: true });
  const read = () => loadServerPacks([join(dir, 'setup')]).packs;
  const before = setupVersion(read());
  assert.equal(setupPack(read())?.id, 'setup');
  assert.equal(setupBehind(before, read()), false);

  writeFileSync(join(dir, 'setup', 'handout', 'files', 'notes.md'), '# Moved\n');
  const now = setupVersion(read());
  assert.notEqual(now, before);
  assert.equal(setupBehind(before, read()), true);
  assert.equal(setupBehind(now, read()), false);
  assert.equal(setupBehind(undefined, read()), true);
});

test('with no pack on the setup mount, the kernel’s own setup is what a folder is checked against', () => {
  handsOut('kernel000000');
  assert.equal(setupPack([]), undefined);
  assert.equal(setupVersion([]), 'kernel000000');
  assert.equal(setupBehind('kernel000000', []), false);
  assert.equal(setupBehind('older0000000', []), true);
});
