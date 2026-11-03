// Holds off (the owner, 3 Nov 2026, decision e_66mwta3w): one workspace setting, and every change applies as it is
// made, whatever rule would hold it, forget included. A wait the change or its token asked for still holds.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { hostFor } from '../src/packtools.ts';
import type { Actor, Archipelago } from '../src/pelago.ts';
import { decide } from '../src/rules.ts';
import { callTool } from '../src/tools.ts';
import { fresh, make } from './map.ts';

const owner: Actor = { kind: 'human', name: 'owner', admin: true };
const agent: Actor = { kind: 'agent', name: 'test' };
const maps: Archipelago[] = [];
after(() => maps.forEach((l) => hostFor(l.registry).stop()));

async function map() {
  const l = await fresh();
  maps.push(l);
  assert.equal(((await callTool(l, owner, 'workspace_set', { agent_changes: 'hold' })) as { holds_off: boolean }).holds_off, false);
  return l;
}

test('holds are on until the owner turns them off, and the Workspace page reads the setting', async () => {
  const l = await map();
  const held = (await callTool(l, agent, 'change', { reason: 'test', ops: [{ op: 'create', type: 'task', title: 'Held' }] })) as { status: string };
  assert.equal(held.status, 'proposed');
  assert.equal(((await callTool(l, owner, 'workspace_set', { holds_off: true })) as { holds_off: boolean }).holds_off, true);
});

test('with holds off, what a rule would hold applies, and the answer says holds are off', async () => {
  const l = await map();
  const { t } = await make(l, [{ op: 'create', ref: 't', type: 'task', title: 'To forget' }]);
  await callTool(l, owner, 'workspace_set', { holds_off: true });
  const verdict = await decide(l.db, l.registry, { human: false }, [{ op: 'create', type: 'task', visibility: 'public' } as never]);
  assert.equal(verdict.outcome, 'apply');
  assert.equal(verdict.holds_off, true);
  assert.ok(verdict.spared[0].some((r) => r.rule === 'public'), 'the rule it passed over is kept in what was spared');
  const made = (await callTool(l, agent, 'change', { reason: 'test', ops: [{ op: 'create', type: 'style', title: 'Coded', props: { code: 'export default () => []' } }] })) as { status: string; holds: string };
  assert.equal(made.status, 'applied');
  assert.equal(made.holds, 'off');
  const forgot = (await callTool(l, agent, 'change', { reason: 'test', ops: [{ op: 'forget', id: t }] })) as { status: string };
  assert.equal(forgot.status, 'applied', 'forget goes through too');
});

test('with holds off, a change that asks to wait still waits', async () => {
  const l = await map();
  await callTool(l, owner, 'workspace_set', { holds_off: true });
  const asked = (await callTool(l, agent, 'change', { reason: 'test', hold: true, ops: [{ op: 'create', type: 'task', title: 'Look first' }] })) as { status: string; held_by: { rule: string } };
  assert.equal(asked.status, 'proposed');
  assert.equal(asked.held_by.rule, 'asked');
});
