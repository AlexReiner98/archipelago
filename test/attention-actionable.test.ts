// Attention reads capabilities, not kinds (decision e_w46v6jf9): a type of no kind that is actionable is counted as
// work is (blocked, holding up, stale, unowned), and ready when it is plannable and estimated. One that is not
// actionable is not counted at all.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Archipelago, type Op } from '../packs/write/kernel/pelago.ts';
import { Registry, type PackFile } from '../packs/loader/kernel/packs.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { freshWith, human, PACKS } from './map.ts';

const CHORES = {
  id: 'chores',
  version: '1',
  title: 'Chores',
  requires: ['core'],
  types: [
    {
      id: 'chore',
      title: 'Chore',
      description: 'Something to do around the house.',
      capabilities: { owned: true, actionable: true, plannable: true },
      statuses: { open: ['todo'], closed: ['done'] },
      fields: { tokens_estimated: { type: 'number' } },
    },
    { id: 'period', title: 'Period', description: 'A month.', statuses: { open: ['open'], closed: ['closed'] } },
  ],
} as unknown as PackFile;

async function map() {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-actionable-'));
  cpSync(PACKS, dir, { recursive: true });
  mkdirSync(join(dir, CHORES.id));
  writeFileSync(join(dir, CHORES.id, 'pack.json'), JSON.stringify(CHORES));
  const l = await freshWith(new Registry(dir));
  await callTool(l, human, 'init', { name: 'Alex' });
  return l;
}

/** The same small map in a type: one waits on another, one untouched for a month. Nobody owns them; what is not blocked is ready, as its type can be estimated. */
async function reasonsFor(l: Archipelago, type: string) {
  const ops: Op[] = [
    { op: 'create', ref: 'paint', type, title: `${type}: paint` },
    { op: 'create', ref: 'buy', type, title: `${type}: buy paint` },
    { op: 'link', type: 'depends_on', from: 'paint', to: 'buy' },
    { op: 'create', ref: 'old', type, title: `${type}: old` },
    { op: 'create', ref: 'est', type, title: `${type}: estimated`, props: { tokens_estimated: 1000 } },
  ];
  const { created } = (await l.change(human, { reason: 'test', ops })) as { created: Record<string, string> };
  await l.db.query(`update entity set updated_at = now() - interval '30 days' where id = $1`, [created.old]);
  const answer = (await callTool(l, human, 'view', { name: 'attention', params: { person: 'me' } })) as { items: { id: string; reasons: { why: string }[] }[] };
  const of = (ref: string) => (answer.items.find((i) => i.id === created[ref])?.reasons.map((r) => r.why) ?? []).sort();
  return { paint: of('paint'), buy: of('buy'), old: of('old'), est: of('est') };
}

test('a kindless actionable type appears in attention as work does', async () => {
  const l = await map();
  assert.equal(l.registry.type('chore')!.starter, 'chore', 'chore extends nothing: it is its own starter type');
  const task = await reasonsFor(l, 'task');
  const chore = await reasonsFor(l, 'chore');
  assert.deepEqual(chore, task);
  assert.deepEqual(chore, { paint: ['blocked'], buy: ['holding_up', 'ready'], old: ['ready', 'stale'], est: ['ready'] });
});

test('every type from core’s starters is plannable exactly when it is work, so the live map reads the same', async () => {
  const l = await map();
  for (const t of l.registry.types.values()) if (l.registry.type(t.starter)?.pack === 'core') assert.equal(Boolean(t.capabilities.plannable), t.starter === 'work', t.id);
});

test('a kindless type that is not actionable is not counted', async () => {
  const l = await map();
  const { created } = (await l.change(human, { reason: 'test', ops: [{ op: 'create', ref: 'oct', type: 'period', title: 'October' }] })) as { created: Record<string, string> };
  await l.db.query(`update entity set updated_at = now() - interval '30 days' where id = $1`, [created.oct]);
  const answer = (await callTool(l, human, 'view', { name: 'attention', params: { person: 'me' } })) as { items: { id: string }[] };
  assert.ok(!answer.items.some((i) => i.id === created.oct));
});
