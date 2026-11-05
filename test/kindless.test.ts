// A type may declare no kind (decision e_w46v6jf9: kinds become starter types). It then keeps in its row what it
// declares: status, confidence and source for its statuses, and an owner only when it is owned. The kinds declare
// owned and actionable, so every type that had an owner or counted as work or a question through its kind still does.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { openDb } from '../src/db.ts';
import { Archipelago } from '../src/pelago.ts';
import { Registry, type PackFile } from '../src/packs.ts';
import { syncTypes } from '../src/typetable.ts';
import { fresh, human, make, PACKS, replayed } from './map.ts';

const LEDGER: PackFile = {
  id: 'ledger',
  version: '1',
  title: 'Ledger',
  requires: ['core'],
  types: [
    { id: 'account', title: 'Account', description: 'An account in the chart.', capabilities: { owned: true }, statuses: { open: ['open'], closed: ['closed'] }, fields: { number: { type: 'string' } } },
    { id: 'period', title: 'Fiscal period', description: 'A month the books close for.', statuses: { open: ['open'], closed: ['closed'] } },
    { id: 'savings', extends: 'account', title: 'Savings account', description: 'An account that earns.' },
  ],
} as PackFile;

function packsWith(extra: PackFile): string {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-kindless-'));
  cpSync(PACKS, dir, { recursive: true });
  mkdirSync(join(dir, extra.id));
  writeFileSync(join(dir, extra.id, 'pack.json'), JSON.stringify(extra));
  return dir;
}

async function ledger() {
  const l = new Archipelago(await openDb(), new Registry(packsWith(LEDGER)));
  return (await syncTypes(l), l);
}

test('a type of no kind keeps status, confidence and source in its row, and an owner only when owned', async () => {
  const l = await ledger();
  const columns = (type: string) => Object.keys(l.registry.type(type)!.columns).sort();
  assert.deepEqual(columns('account'), ['confidence', 'owner', 'source', 'status']);
  assert.deepEqual(columns('savings'), ['confidence', 'owner', 'source', 'status'], 'a flavour inherits owned');
  assert.deepEqual(columns('period'), ['confidence', 'source', 'status']);
  assert.equal(l.registry.type('account')!.kind, undefined);
  assert.equal(l.registry.type('savings')!.base, 'account');
  assert.deepEqual(l.registry.type('period')!.columns.status!.values, ['open', 'closed']);
  assert.ok(!l.registry.kinds().some((k) => k.id === 'account'), 'it is no kind');
});

test('a kindless item writes, closes, gets an owner only when owned, and rebuilds from the log', async () => {
  const l = await ledger();
  const { a, p, s, who } = await make(l, [
    { op: 'create', ref: 'who', type: 'person', title: 'Sam' },
    { op: 'create', ref: 'a', type: 'account', title: 'Cash', confidence: 0.9, props: { number: '1000' } },
    { op: 'create', ref: 'p', type: 'period', title: 'October' },
    { op: 'create', ref: 's', type: 'savings', title: 'Rainy day' },
    { op: 'link', type: 'part_of', from: 's', to: 'a' },
  ]);
  const cash = (await l.entity(a))!;
  assert.deepEqual([cash.kind, cash.status, cash.is_open, cash.confidence, cash.props.number], [null, 'open', true, 0.9, '1000']);
  await make(l, [{ op: 'update', id: a, owner: who }]);
  assert.equal((await l.entity(a))!.owner, who);
  await assert.rejects(l.change(human, { reason: 'test', ops: [{ op: 'update', id: p, owner: who }] }), /period has no field "owner"/);
  await assert.rejects(l.change(human, { reason: 'test', ops: [{ op: 'update', id: p, status: 'done' }] }), /status/);
  await make(l, [{ op: 'update', id: p, status: 'closed' }]);
  assert.deepEqual([(await l.entity(p))!.status, (await l.entity(p))!.is_open], ['closed', false]);
  assert.equal((await l.entity(s))!.status, 'open');
  const { live, replay } = await replayed(l);
  assert.deepEqual(replay, live, 'the log projects the same rows again');
});

test('owned and actionable are capabilities: true or left out', () => {
  const bad = { ...LEDGER, types: [{ ...LEDGER.types![1], capabilities: { owned: false } }] } as unknown as PackFile;
  assert.throws(() => new Registry(packsWith(bad)), /owned is true, or left out/);
  const odd = { ...LEDGER, types: [{ ...LEDGER.types![1], capabilities: { actionable: 'yes' } }] } as unknown as PackFile;
  assert.throws(() => new Registry(packsWith(odd)), /actionable is true, or left out/);
});

test('every type with an owner is owned, and the work and the questions are actionable, as their kinds were', async () => {
  const l = await fresh();
  for (const t of l.registry.types.values()) {
    if (!t.kind) continue;
    assert.equal(Boolean(t.capabilities.owned), Boolean(t.columns.owner), `${t.id}: owned exactly when it has an owner`);
    assert.equal(Boolean(t.capabilities.actionable), t.kind === 'work' || t.kind === 'question', `${t.id}: actionable exactly when work or a question`);
  }
  assert.deepEqual(l.registry.having('owned').sort(), [...l.registry.types.values()].filter((t) => t.columns.owner).map((t) => t.id).sort());
});
