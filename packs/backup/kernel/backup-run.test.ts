// The backup pack without a database: what the root services answer goes in, files and reports come out.

import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { gunzipSync } from 'node:zlib';
import type { KernelContext } from '#pelago/kernel';
import { backupAll, backupVault, merge, newestBackup } from './backup-run.ts';

/** A context whose calls answer from a table of root services; every call is kept. */
const fake = (answers: Record<string, (input: any) => unknown>, calls: [string, unknown][] = []) =>
  ({ call: async (name: string, input: unknown) => (calls.push([name, input]), answers[name](input)) }) as unknown as KernelContext;

test('a merge report is made of what root.merge did', async () => {
  const calls: [string, unknown][] = [];
  const ctx = fake({ 'root.merge': () => ({
    from: { id: 'w', name: 'W' }, taken: 't',
    plan: [{ title: 'A', what: 'added' }, { title: 'B', what: 'updated' }, { title: 'C', what: 'same' }, { title: 'D', what: 'added' }],
    relations: [{ added: true }, { added: false }], proposals: [{ added: false }], events: [7, 5, 6], owner_set: true, open_sessions: 2, holds: 1,
  }) }, calls);
  const report = await merge(ctx, { workspace: { id: 'w', name: 'W' }, taken: 't', tables: {} }, { sessionTypes: ['run'], apply: true });
  assert.deepEqual(calls[0][1], { dump: { workspace: { id: 'w', name: 'W' }, taken: 't', tables: {} }, session_types: ['run'], apply: true });
  assert.deepEqual(report.entities, { added: 2, updated: 1, kept_newer_here: 0, same: 1 });
  assert.deepEqual(report.examples.added, ['A', 'D']);
  assert.deepEqual([report.relations, report.proposals, report.events, report.left_out, report.owner_set, report.applied], [{ added: 1, ended: 1 }, { added: 0, decided: 1 }, { added: 3, first_seq: 5, last_seq: 7 }, { open_sessions: 2, holds: 1 }, true, true]);
});

test('every workspace root.workspaces names is written with its vault, the oldest pruned, a failure reported', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-backup-pack-'));
  try {
    let n = 0;
    const ctx = fake({
      'root.workspaces': () => [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }],
      'root.dump': ({ workspace }: { workspace: string }) => {
        if (workspace === 'b') throw new Error('b is broken');
        const taken = `2026-11-12T10:00:0${n++}.000Z`;
        return { dump: { workspace: { id: workspace, name: 'A' }, taken, tables: { entity: [{ id: 'e_1' }, { id: 'e_2' }] } }, vault: { taken } };
      },
    });
    for (let i = 0; i < 3; i++) {
      const done = await backupAll(ctx, dir, 2);
      assert.deepEqual(done.map((d) => [d.workspace, d.rows, d.error]), [['a', 2, undefined], ['b', undefined, 'b is broken']]);
    }
    const files = readdirSync(join(dir, 'a')).filter((f) => f.endsWith('.json.gz')).sort();
    assert.deepEqual(files, ['2026-11-12T10-00-01.000Z.json.gz', '2026-11-12T10-00-02.000Z.json.gz']);
    assert.equal(JSON.parse(gunzipSync(readFileSync(join(dir, 'a', files[1]))).toString()).taken, '2026-11-12T10:00:02.000Z', 'the dump as root.dump answered it');
    assert.equal(readdirSync(join(dir, 'a', 'vault')).length, 3);
    assert.equal(newestBackup(dir, 'a')?.toISOString(), '2026-11-12T10:00:02.000Z');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a vault's backup is kept 30 days", () => {
  const dir = mkdtempSync(join(tmpdir(), 'pelago-vault-pack-'));
  try {
    backupVault(dir, { taken: '2026-10-01T00:00:00.000Z' }, Date.parse('2026-10-01T00:00:00Z'));
    backupVault(dir, { taken: '2026-11-12T00:00:00.000Z' }, Date.parse('2026-11-12T00:00:00Z'));
    assert.deepEqual(readdirSync(dir), ['2026-11-12T00-00-00.000Z.json.gz']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
