// The pack model (feature e_k8nqby7n, lane e_z3ppa6fe): every part a pack declares can be an item of one of core's part
// types, part_of its pack's item, recording what it shipped as. The types are core's, read by the kernel; the pack_model
// pack keeps the ties between parts, words only, so an island map takes it. packs/pack_model/README.md is the contract.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { islandProblems, packKind, sharedOf } from '../packs/loader/kernel/islands.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { PACKS } from './map.ts';

/** core and pack_model alone, as a map beginning with them would read them. */
function registry() {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-pack-model-'));
  for (const id of ['core', 'pack_model']) cpSync(join(PACKS, id), join(dir, id), { recursive: true });
  return new Registry(dir);
}

const PART_TYPES = ['type', 'link_type', 'rule', 'view', 'screen', 'instruction', 'reflex', 'style', 'lens', 'layout', 'part', 'automation'];

test('every part type records what it declares and what it shipped as', () => {
  const reg = registry();
  for (const id of PART_TYPES) {
    const t = reg.type(id);
    assert.ok(t, `core declares ${id}`);
    assert.equal(t.fields.declares?.type, 'string', `${id} has declares`);
    assert.equal(t.fields.shipped?.type, 'json', `${id} has shipped`);
    assert.ok(t.fields.shipped?.large, `${id}'s shipped may hold a large declaration`);
  }
  for (const id of ['type', 'link_type', 'rule', 'view']) assert.equal(reg.type(id)!.fields.spec?.type, 'json', `${id} keeps its declaration in spec`);
  for (const id of ['layout', 'part', 'pack']) assert.equal(reg.type(id)!.fields.runs?.type, 'json', `${id} names its code by path and hash`);
  assert.equal(reg.type('pack')!.fields.shipped?.type, 'json');
});

test('pack_model loads beside core, and its ties join the part types', () => {
  const reg = registry();
  assert.equal(reg.states.get('pack_model')?.state, 'active', JSON.stringify(reg.states.get('pack_model')));
  for (const id of ['requires', 'flavour_of', 'stands_over']) assert.equal(reg.relations.get(id)?.pack, 'pack_model', `pack_model declares ${id}`);
  assert.ok(reg.relations.get('flavour_of')!.from.includes('type'));
  assert.ok(reg.relations.get('stands_over')!.to.includes('rule'));
});

test('an island map takes pack_model: it is words only', () => {
  const reg = registry();
  const core = reg.found.find((p) => p.id === 'core')!;
  const model = reg.found.find((p) => p.id === 'pack_model')!;
  const shared = sharedOf([core]);
  assert.equal(packKind(model, shared), 'island');
  assert.deepEqual(islandProblems(model, shared), []);
});
