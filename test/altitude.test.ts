// Altitude: how high an item sits, read from its type, so a page can list one level and count the rest
// (docs/ui-strategy.md). A kind gives it; a type may set its own; a flavour inherits it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Registry, type PackFile } from '../packs/loader/kernel/packs.ts';
import { packsWith } from './map.ts';

const levels: PackFile = {
  id: 'levels', version: '1', title: 'Levels', requires: ['core'],
  types: [
    { id: 'levels.project', title: 'Project', description: 'x', extends: 'work', altitude: 'project' },
    { id: 'levels.stream', title: 'Stream', description: 'x', extends: 'work', altitude: 'stream' },
    { id: 'levels.part', title: 'Part', description: 'x', extends: 'levels.stream' },
  ],
};

test('an aim, a project, its streams and their steps each sit at their own level', () => {
  const reg = new Registry(packsWith(levels));
  const at = (id: string) => reg.type(id)!.altitude;
  assert.equal(at('aim'), 'workspace');
  assert.equal(at('levels.project'), 'project', 'a type sets its own');
  assert.equal(at('levels.part'), 'stream', 'a flavour inherits it');
  for (const id of ['task', 'decision', 'question', 'finding', 'event']) assert.equal(at(id), 'step', id);
  // People and places are not in the hierarchy.
  assert.equal(at('person'), undefined);
  assert.equal(at('place'), undefined);
  // The UI is told it with the schema.
  assert.equal(reg.describe().types.find((t) => t.id === 'levels.project')?.altitude, 'project');
});

test('a type with a level that is not one stops the registry', () => {
  const bad: PackFile = { id: 'odd', version: '1', title: 'Odd', types: [{ id: 'odd.thing', title: 'Thing', description: 'x', extends: 'work', altitude: 'moon' as never }] };
  assert.throws(() => new Registry(packsWith(bad)), /altitude "moon"/);
});
