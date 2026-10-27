// Altitude: how high an item sits, read from its type, so a page can list one level and count the rest
// (docs/ui-strategy.md). A kind gives it; a type may set its own; a flavour inherits it.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Registry, type PackFile } from '../src/packs.ts';

function packsWith(extra?: PackFile): string {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-altitude-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), dir, { recursive: true });
  if (extra) {
    mkdirSync(join(dir, extra.id));
    writeFileSync(join(dir, extra.id, 'pack.json'), JSON.stringify(extra));
  }
  return dir;
}

test('a project, its streams and their steps each sit at their own level', () => {
  const reg = new Registry(packsWith());
  const at = (id: string) => reg.type(id)!.altitude;
  assert.equal(at('goal'), 'workspace');
  assert.equal(at('project'), 'project');
  for (const id of ['feature', 'component', 'release', 'document']) assert.equal(at(id), 'stream', id);
  for (const id of ['task', 'issue', 'bug', 'decision', 'hypothesis', 'note']) assert.equal(at(id), 'step', id);
  // People and places are not in the hierarchy.
  assert.equal(at('person'), undefined);
  assert.equal(at('repo'), undefined);
  // The UI is told it with the schema.
  assert.equal(reg.describe().types.find((t) => t.id === 'project')?.altitude, 'project');
});

test('a type with a level that is not one stops the registry', () => {
  const bad: PackFile = { id: 'odd', version: '1', title: 'Odd', types: [{ id: 'odd.thing', title: 'Thing', description: 'x', extends: 'work', altitude: 'moon' as never }] };
  assert.throws(() => new Registry(packsWith(bad)), /altitude "moon"/);
});
