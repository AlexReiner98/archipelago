// The pack model's two ways across (packs/loader/kernel/pack-model.ts, lane e_z3ppa6fe): a pack file becomes items,
// and the items become the same manifest again, so a registry built from the map loads what the file declared.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { Manifest } from '../packs/loader/kernel/manifest.ts';
import { canonical, entryOf, hashFile, hashOf, manifestsOf, MODEL_KINDS, partsOf, type ModelItem } from '../packs/loader/kernel/pack-model.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { PACKS } from './map.ts';

const files = readdirSync(PACKS).filter((d) => existsSync(join(PACKS, d, 'pack.json'))).map((d) => JSON.parse(readFileSync(join(PACKS, d, 'pack.json'), 'utf8')) as Manifest);
const itemsOf = (m: Manifest, facts = {}): ModelItem[] => { const { pack, parts } = partsOf(m, facts); return [pack, ...parts]; };

test('every pack file comes back from its items as it was', () => {
  for (const m of files) {
    const back = manifestsOf(itemsOf(m)).get(m.id);
    assert.ok(back, `${m.id} has a manifest`);
    assert.equal(canonical(back.manifest), canonical(m), `${m.id} comes back whole`);
    assert.equal(back.hash, hashOf(m), `${m.id}'s hash is its file's`);
  }
});

test('every part is one of the model kinds, with declares, spec and what it shipped as', () => {
  const core = files.find((m) => m.id === 'core')!;
  const kinds = new Registry(PACKS).found.find((p) => p.id === 'core')!.types!.map((t) => ('id' in t ? t.id : ''));
  for (const kind of MODEL_KINDS) assert.ok(kinds.includes(kind), `core declares ${kind}`);
  const { pack, parts } = partsOf(core);
  assert.equal(pack.props.name, 'core');
  assert.equal((pack.props.manifest as Record<string, unknown>).types, undefined, 'what makes parts is not on the pack item');
  const task = parts.find((p) => p.type === 'type' && p.props.declares === 'task')!;
  assert.equal(task.title, 'Task');
  assert.equal((task.props.spec as Record<string, unknown>).extends, 'work');
  assert.equal((task.props.spec as Record<string, unknown>).id, undefined, 'the id is declares');
  const shipped = task.props.shipped as { pack: string; version: string; hash: string; value: { id: string } };
  assert.deepEqual([shipped.pack, shipped.version, shipped.value.id], ['core', core.version, 'task']);
  assert.equal(shipped.hash, hashOf(shipped.value));
  assert.match(shipped.hash, /^[0-9a-f]{64}$/, "a hash is hex, as the registry keeps a pack's");
  for (const p of parts) assert.ok(MODEL_KINDS.includes(p.type) && p.props.declares && p.props.spec, `${p.type} ${String(p.props.declares)}`);
  assert.ok(parts.some((p) => p.type === 'rule'), 'rules are parts');
});

test("an owner's edit is read over the file, and a part they add comes after the file's", () => {
  const core = files.find((m) => m.id === 'core')!;
  const items = itemsOf(core).map((i) => (i.props.declares === 'task' ? { ...i, title: 'Job', props: { ...i.props, spec: { ...(i.props.spec as object), extends: 'work', altitude: 'step' } } } : i));
  items.push({ type: 'rule', title: 'core.mine', body: '', props: { declares: 'mine', spec: { when: { op: 'create', type: 'task' }, then: 'hold', say: 'Mine.' }, shipped: { pack: 'core', version: core.version, hash: '', value: undefined } } });
  const back = manifestsOf(items).get('core')!.manifest;
  const task = back.types!.find((t) => 'id' in t && t.id === 'task') as unknown as Record<string, unknown>;
  assert.equal(task.title, 'Job');
  assert.equal(task.altitude, 'step');
  assert.equal(back.rules!.at(-1)!.id, 'mine');
  assert.notEqual(manifestsOf(items).get('core')!.hash, hashOf(core), 'an edited pack hashes otherwise');
});

test('code is named by path and hash, the modules on their part and the rest on the pack', () => {
  const m = { id: 'drawn', version: '0.1.0', title: 'Drawn', layouts: [{ id: 'drawn.flow', title: 'Flow', shape: 'flow', modules: { 'index.js': 'layouts/flow/index.js' } }], handlers: [{ event: 'item.due' }] } as unknown as Manifest;
  const { pack, parts } = partsOf(m, { files: { 'layouts/flow/index.js': 'aa', 'handler.js': 'bb' } });
  assert.deepEqual(parts[0].props.runs, [{ path: 'packs/drawn/layouts/flow/index.js', hash: 'aa' }]);
  assert.deepEqual(pack.props.runs, [{ path: 'packs/drawn/handler.js', hash: 'bb' }]);
  assert.equal(entryOf(parts[0]).shape, 'flow');
});

test('a pack kept as an item with no file is left where it is read today', () => {
  const authored: ModelItem = { type: 'pack', title: 'Recipes', body: '', props: { name: 'recipes', manifest: { types: [] } } };
  assert.equal(manifestsOf([authored]).size, 0);
});

test('a retired part drops out, and a part the owner made comes in by the pack it is part_of', () => {
  const core = files.find((m) => m.id === 'core')!;
  const items = itemsOf(core).map((i) => (i.props.declares === 'agent_changes' ? { ...i, is_open: false } : i));
  items.push({ type: 'view', title: 'Mine', body: '', pack: 'core', props: { declares: 'mine', spec: { shape: 'flat' } } });
  const back = manifestsOf(items).get('core')!;
  assert.ok(!back.manifest.rules!.some((r) => r.id === 'agent_changes'));
  assert.equal(back.manifest.views!.at(-1)!.id, 'mine');
  assert.equal(back.hash, hashFile(back.text), 'the hash is the text the log keeps');
  assert.deepEqual(JSON.parse(back.text), back.manifest);
});
