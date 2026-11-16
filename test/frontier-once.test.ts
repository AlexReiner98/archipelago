// The frontier read at once (task e_k25mjqq3): what it and attention read of its sessions' work is one statement
// (the reads frontier_state and attention_state, packs/surface/kernel/packreads-frontier.ts), not some twenty-five.
// Read either way, on a map that gives every reason the frontier weighs, its answer is the same; at once, it asks the
// database a few times, not once for each read.

import assert from 'node:assert/strict';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import * as frontierPack from '../packs/runs/kernel/frontier.ts';
import { attention } from '../packs/attention/kernel/attention.ts';
import { type Actor } from '../packs/write/kernel/pelago.ts';
import { Registry } from '../packs/loader/kernel/packs.ts';
import * as sessionsPack from '../packs/sessions/kernel/sessions.ts';
import { callTool } from '../packs/surface/kernel/tools.ts';
import { kernelContext, ownContext } from '../packs/loader/kernel/kernel-context.ts';
import { timed, timing } from '../src/timing.ts';
import { freshWith, human } from './map.ts';

const agent: Actor = { kind: 'agent', name: 'test' };

/** The statements a read asks of the database. */
const asked = <T>(fn: () => Promise<T>) => timed(async () => ({ answer: await fn(), statements: timing()!.statements }));

test('the frontier read at once answers as it does read by read, every reason alike', async () => {
  const packs = mkdtempSync(join(tmpdir(), 'pelago-frontier-once-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), packs, { recursive: true });
  const l = await freshWith(new Registry(packs));
  await callTool(l, human, 'init', { name: 'Alex' });
  await l.db.query(`insert into setting (key, value) values ('agent_changes', '"apply"') on conflict (key) do update set value = excluded.value`);

  const first = (await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, { session_id: 'one', cwd: '/srv/app' })).run;
  const made = ((await l.change(agent, {
    run: first,
    reason: 'Plan',
    ops: [
      { op: 'create', ref: 'hub', type: 'task', title: 'Ship login' },
      { op: 'create', ref: 'table', type: 'task', title: 'User table' },
      { op: 'create', ref: 'form', type: 'task', title: 'Login form' },
      { op: 'create', ref: 'ask', type: 'task', title: 'Copy for the form' },
      { op: 'create', ref: 'late', type: 'task', title: 'Deploy', props: { due: '2020-01-01' } },
      { op: 'create', ref: 'begun', type: 'task', title: 'Session store', status: 'doing' },
      { op: 'create', ref: 'built', type: 'task', title: 'Reset mail', props: { seen_working: false, to_see: 'a mail arrives' } },
      { op: 'create', ref: 'gpu', type: 'place', title: 'Build box', status: 'unavailable', props: { exclusive: true } },
      { op: 'create', ref: 'bench', type: 'task', title: 'Load test' },
      { op: 'create', ref: 'hash', type: 'decision', title: 'Which hashing library?' },
      { op: 'create', ref: 'store', type: 'decision', title: 'Where sessions live' },
      { op: 'create', ref: 'rate', type: 'finding', title: 'Logins per second', props: { value: 40, value_type: 'number' } },
      { op: 'create', ref: 'cap', type: 'task', title: 'Rate limit' },
      { op: 'create', ref: 'polish', type: 'task', title: 'Polish the form' },
      { op: 'create', ref: 'bea', type: 'person', title: 'Bea' },
      ...['table', 'form', 'ask', 'late', 'begun', 'built', 'bench', 'hash', 'store', 'cap', 'polish'].map((from) => ({ op: 'link' as const, type: 'part_of', from, to: 'hub' })),
      { op: 'link', type: 'depends_on', from: 'form', to: 'table' },
      { op: 'link', type: 'waits_on', from: 'ask', to: 'bea', props: { for: 'the words' } },
      { op: 'link', type: 'needs', from: 'bench', to: 'gpu' },
      { op: 'link', type: 'reads', from: 'cap', to: 'rate' },
    ],
  })) as { created: Record<string, string> }).created;
  // An agent settles a question on its own judgment; what a reader reads moves; the owner corrects a step.
  await l.change(agent, { run: first, reason: 'Chose', authority: { of: 'agent', basis: 'the load test' }, ops: [{ op: 'update', id: made.store, status: 'decided', props: { outcome: 'In the database', rationale: 'One place to back up' }, }] });
  await l.change(agent, { run: first, reason: 'Measured', ops: [{ op: 'update', id: made.rate, props: { value: 25 } }] });
  await sessionsPack.sessionEnd(ownContext(l, 'sessions'), agent as sessionsPack.Actor, { run: first, outcome: 'finished' });
  await l.change(human, { reason: 'Rename', ops: [{ op: 'update', id: made.table, title: 'User table, email unique' }] });
  // A second session is at work on a step.
  const second = (await sessionsPack.sessionStart(ownContext(l, 'sessions'), agent as sessionsPack.Actor, { session_id: 'two', cwd: '/srv/app', task: made.form })).run;

  const ctx = kernelContext(l, 'runs');
  for (const input of [{}, { run: second }, { cwd: '/srv/elsewhere' }]) {
    const apart = await asked(() => frontierPack.frontier(ctx, { ...input, limit: 100 }, true));
    const once = await asked(() => frontierPack.frontier(ctx, { ...input, limit: 100 }));
    assert.deepEqual(once.answer, apart.answer, `the frontier of ${JSON.stringify(input)} is the same read either way`);
    if (input.cwd) continue;
    assert.ok(once.statements <= 4 && apart.statements > 15, `at once it asks a few statements (${once.statements}), read by read many (${apart.statements})`);
  }

  // The map gives every reason the frontier weighs, so each part read at once is checked. What an agent settled is
  // closed, and the frontier hands attention the open items alone: it is checked among all of them, below.
  const f = await frontierPack.frontier(ctx, { limit: 100 });
  const reasons = new Set(f.items.flatMap((i) => i.reasons.map((r) => r.why)));
  assert.deepEqual([...frontierPack.FRONTIER_REASONS].filter((r) => r !== 'to_confirm' && !reasons.has(r)), [], 'every reason is on the frontier');

  // Attention among some items, open and closed, alike either way.
  const among = Object.values(made);
  const own = kernelContext(l, 'attention');
  const once = await attention(own, { among });
  assert.deepEqual(once, await attention(own, { among, state: false }));
  assert.ok(once.items.some((i) => i.id === made.store && i.reasons.some((r) => r.why === 'to_confirm')), 'what an agent settled is to confirm');
});
