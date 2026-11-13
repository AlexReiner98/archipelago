// An internal pack's action (packs/loader/kernel/internal-act.ts, task e_cx9tdunw): its code runs in the server's
// process as the service act.<verb>.<name>, and what it answers is made so as a sandboxed handler's is: one change
// set naming the action, its pack and the part that sent it, on the caller's authority, judged by the rules.

import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { test } from 'node:test';
import { entry } from '../packs/log/kernel/log.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';
import { partsFor } from '../packs/loader/kernel/ui-parts.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { agent, freshWith, human, packsWith } from './map.ts';

test("an internal pack's part sends its action: run in-process, its change the person's, naming the part", async () => {
  const dir = packsWith('kernel_shelf');
  const l = await freshWith(new Registry(dir));
  try {
    assert.ok(l.registry.internal.has('kernel_shelf'), 'the test pack is internal');
    const row = partsFor(l.registry).find((p) => p.pack === 'kernel_shelf')!;
    const part = { id: row.id, hash: row.hash };
    const done = (await callTool(l, human, 'kernel_shelf_put', { title: 'From the row', part })) as { status: string; changeset: string; created: Record<string, string>; answer: { item: string } };
    assert.equal(done.status, 'applied');
    assert.equal(done.answer.item, done.created.it, 'a {ref} in its answer is the id its change made');
    const logged = (await entry(l.db, done.changeset)) as unknown as { part?: unknown; action?: string; pack?: string; actor: { id: string } };
    assert.deepEqual(logged.part, part, 'the log names the part and its hash');
    assert.equal(logged.action, 'kernel_shelf.put');
    assert.match(logged.actor.id, /^human:/, "on the person's authority, not the pack's");
    const made = await l.db.query<{ title: string }>(`select title from entity where id = $1`, [done.created.it]);
    assert.equal(made.rows[0].title, 'From the row');

    // An agent's call, with no part, is judged by the rules as any change of an agent's.
    const theirs = (await callTool(l, agent, 'kernel_shelf_put', { title: 'By an agent' })) as { status: string; held_by?: { rule: string } };
    const plain = (await callTool(l, agent, 'change', { ops: [{ op: 'create', type: 'task', title: 'By hand' }], reason: 'x' })) as { status: string; held_by?: { rule: string } };
    assert.equal(theirs.status, plain.status, 'held or applied as the same change sent by hand');
    assert.deepEqual(theirs.held_by, plain.held_by, 'and by the same rule');
    assert.equal(theirs.held_by?.rule, 'agent_changes', "an agent's change waits, as core's rule says");

    // An action whose pack provides no service for it says so, and nothing is made.
    await assert.rejects(callTool(l, human, 'kernel_shelf_bare', { part }), /provides no act\.capture\.bare/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
