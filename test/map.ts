// What the map's tests share: a fresh map in memory, the two actors, and quick ways to change and ask it.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.ts';
import { Archipelago, type Actor, type Op } from '../src/pelago.ts';
import { Registry } from '../src/packs.ts';
import { callTool } from '../src/tools.ts';
import { syncTypes } from '../src/typetable.ts';

export const human: Actor = { kind: 'human', name: 'test' };
export const agent: Actor = { kind: 'agent', name: 'test' };

/** A fresh in-memory map with its own copy of the packs, so tests can define types. */
export async function fresh() {
  const packs = mkdtempSync(join(tmpdir(), 'pelago-packs-'));
  cpSync(join(import.meta.dirname, '..', 'packs'), packs, { recursive: true });
  const l = new Archipelago(await openDb(), new Registry(packs));
  return (await syncTypes(l), l); // as a workspace is opened: the type table holds what the public rule reads
}

export const attend = async (l: Archipelago, params: Record<string, unknown>) => (await callTool(l, human, 'view', { name: 'attention', params })) as any;

export async function make(l: Archipelago, ops: Op[]) {
  const result = await l.change(human, { ops, reason: 'test' });
  assert.equal(result.status, 'applied');
  return (result as { created: Record<string, string> }).created;
}

/** A project in a repo, with one task that needs the live lane and one that does not. */
export async function laneSetup(l: Archipelago) {
  return make(l, [
    { op: 'create', ref: 'repo', type: 'software.repo', title: 'Apex repo', props: { path: 'C:\\code\\Apex' } },
    { op: 'create', ref: 'proj', type: 'work.project', title: 'Apex' },
    { op: 'create', ref: 'lane', type: 'resource', title: 'Live lane' },
    { op: 'create', ref: 'rule', type: 'work.decision', title: 'One live lane.', status: 'decided', props: { outcome: 'Only one session drives the CAD app.' } },
    { op: 'create', ref: 'live', type: 'work.task', title: 'Capture probe' },
    { op: 'create', ref: 'offline', type: 'work.task', title: 'Write unit tests' },
    { op: 'create', ref: 'q', type: 'work.decision', title: 'Which target?' },
    { op: 'create', ref: 'gated', type: 'work.task', title: 'Tune the solver' },
    { op: 'link', type: 'software.lives_in', from: 'proj', to: 'repo' },
    { op: 'link', type: 'part_of', from: 'live', to: 'proj' },
    { op: 'link', type: 'part_of', from: 'offline', to: 'proj' },
    { op: 'link', type: 'part_of', from: 'gated', to: 'proj' },
    { op: 'link', type: 'depends_on', from: 'gated', to: 'q' },
    { op: 'link', type: 'needs', from: 'live', to: 'lane' },
    { op: 'link', type: 'work.governed_by', from: 'lane', to: 'rule' },
  ]);
}
