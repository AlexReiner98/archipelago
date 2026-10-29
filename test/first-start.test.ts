// The first start's secrets reach a person at a terminal, and with nobody at one a file, never the log.
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { FIRST_START_FILE, firstStart } from '../src/first-start.ts';
import { Workspaces } from '../src/workspaces.ts';

test('with nobody at a terminal, the first start writes its secrets to a file and the log says only where', async () => {
  const root = mkdtempSync(join(tmpdir(), 'pelago-first-'));
  const workspaces = new Workspaces({ dataDir: null, rootDir: join(root, 'workspaces'), packsDir: join(import.meta.dirname, '..', 'packs') });
  const logged: string[] = [];
  const log = console.log;
  console.log = (...said: unknown[]) => void logged.push(said.join(' '));
  try {
    const main = await workspaces.get('default');
    const file = await firstStart(workspaces, main, root, false);
    assert.equal(file, join(root, FIRST_START_FILE));
    const held = readFileSync(file!, 'utf8');
    assert.match(held, /latop_[0-9a-f]+/, 'the operator secret is in the file');
    assert.match(held, /pel_default_[0-9a-f]{40}/, 'and the owner token');
    assert.doesNotMatch(logged.join('\n'), /latop_|pel_default_/, 'the log holds neither');
    assert.match(logged.join('\n'), /first-start-secrets\.txt/);
    assert.equal(await firstStart(workspaces, main, root, false), undefined, 'given once: a second start has nothing to give');
  } finally {
    console.log = log;
    await workspaces.closeAll();
    rmSync(root, { recursive: true, force: true });
  }
});
