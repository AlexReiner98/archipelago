// The fence is a flag, not the system kind (task e_f9jvs6ee, decision e_w46v6jf9): the kernel's own types (views,
// styles, screens, runs) carry the kernel flag, and every view that left out kind system reads it. Core's system kind
// declares it, so the same types are fenced as before, and the term `kind system` the kept views hold still works.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Registry, type PackFile } from '../src/packs.ts';
import { flatRead } from '../src/query-flat.ts';
import { kernelTypes, notKernel } from '../src/head.ts';
import { fresh, make, PACKS } from './map.ts';

function packsWith(extra: PackFile): string {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-kernel-'));
  cpSync(PACKS, dir, { recursive: true });
  mkdirSync(join(dir, extra.id));
  writeFileSync(join(dir, extra.id, 'pack.json'), JSON.stringify(extra));
  return dir;
}

test('the types with the kernel flag are the types of the system kind', async () => {
  const l = await fresh();
  const flagged = kernelTypes(l.registry).sort();
  // The system kind's types, and the two of the kernel's own that stand on a starter of the work (a connection, a shared document).
  const ofKind = [...l.registry.types.values()].filter((t) => t.starter === 'system' || ['connection', 'shared_document'].includes(t.id)).map((t) => t.id).sort();
  assert.ok(flagged.length > 5, 'views, styles, runs and the rest');
  assert.deepEqual(flagged, ofKind);
  assert.deepEqual(l.registry.having('kernel').sort(), ofKind, 'the flag is a capability, inherited by flavours');
  for (const t of ['lens', 'style', 'run', 'instruction', 'screen', 'automation']) assert.ok(flagged.includes(t), `${t} is the kernel's own`);
  for (const t of ['task', 'project', 'decision', 'person', 'note']) assert.ok(!flagged.includes(t), `${t} is not`);
  const schema = l.registry.describe().types;
  assert.ok(schema.find((t) => t.id === 'lens')?.system, 'the schema the page reads says so');
  assert.ok(!schema.find((t) => t.id === 'task')?.system);
  assert.match(notKernel(l.registry, 'e.type'), /^e\.type <> all\(array\['/);
});

test('a type outside the kernel packs cannot carry the kernel flag, its own or by extending one that does', () => {
  const pack = (types: PackFile['types']) => ({ id: 'outside', version: '1', title: 'Outside', requires: ['core'], types }) as PackFile;
  assert.throws(() => new Registry(packsWith(pack([{ id: 'own', title: 'Own', description: 'x', capabilities: { kernel: true }, statuses: { open: ['open'], closed: ['closed'] } }]))), /cannot carry the kernel flag/);
  assert.throws(() => new Registry(packsWith(pack([{ id: 'myview', extends: 'lens', title: 'My view', description: 'x' }]))), /cannot carry the kernel flag/);
});

test('kind system in a query reads the flag: left out by default, by the term, and kept when asked', async () => {
  const l = await fresh();
  const { p, t, v } = await make(l, [
    { op: 'create', ref: 'p', type: 'project', title: 'Apex' },
    { op: 'create', ref: 't', type: 'task', title: 'Ship it' },
    { op: 'create', ref: 'v', type: 'lens', title: 'Apex at a glance' },
    { op: 'link', type: 'part_of', from: 't', to: 'p' },
    { op: 'link', type: 'part_of', from: 'v', to: 'p' },
  ]);
  const ids = async (filter: Record<string, unknown>) => ((await flatRead(l, { filter })) as { items: { id: string }[] }).items.map((i) => i.id).sort();
  assert.deepEqual(await ids({ find: [`in ${p}`] }), [t], 'the default Not leaves the view out');
  assert.deepEqual(await ids({ find: [`in ${p}`], not: ['kind system'] }), [t], 'as a kept view says it');
  assert.deepEqual(await ids({ find: [`in ${p}`], not: [] }), [t, v].sort(), 'and keeps it when asked');
  assert.deepEqual(await ids({ find: [`in ${p}`], only: ['kind system'], not: [] }), [v], 'Only reads the flag too');
});
